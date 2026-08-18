"use client";

import { ChangeEvent, DragEvent, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/toast-provider";
import type { ParsedProductionRecord } from "@/types/production-monitoring";

type Mapping = {
  source: string; normalizedSource: string; matchedCampaignId: string | null; matchedCampaignName: string | null;
  suggestion: { id: string; name: string; confidence: number } | null; resolution: string; requiresReview: boolean;
};
type BusinessMapping = {
  key: string; campaignNormalized: string; source: string; normalizedSource: string;
  matchedBusinessUnitId: string | null; matchedBusinessUnitName: string | null;
  suggestion: { id: string; name: string; confidence: number } | null; resolution: string; requiresReview: boolean;
};
type PreviewRecord = ParsedProductionRecord & { existingRecordId: string | null; status: "NEW" | "UPDATED" | "UNCHANGED" | "CONFLICT" | "WARNING" | "ERROR" };
type Preview = {
  fileName: string;
  worksheets: Array<{ name: string; supported: boolean; recordCount: number; periods: string[]; error?: string }>;
  reportingPeriods: Array<{ year: number; month: number }>;
  excludedFields: string[];
  campaignMappings: Mapping[];
  businessUnitMappings: BusinessMapping[];
  availableCampaigns: Array<{ id: string; name: string }>;
  availableBusinessUnits: Array<{ id: string; campaignId: string; name: string }>;
  records: PreviewRecord[];
  stats: { total: number; valid: number; new: number; updated: number; unchanged: number; conflicts: number; warnings: number; errors: number };
};
type ImportResult = { importId: string; imported: number; updated: number; unchanged: number; skipped: number; warnings: number; errors: number; status: string };

const STATUS_STYLE: Record<PreviewRecord["status"], string> = {
  NEW: "bg-emerald-100 text-emerald-800",
  UPDATED: "bg-blue-100 text-blue-800",
  UNCHANGED: "bg-slate-100 text-slate-700",
  CONFLICT: "bg-amber-100 text-amber-900",
  WARNING: "bg-amber-100 text-amber-900",
  ERROR: "bg-red-100 text-red-800",
};

export function ProductionImportDialog({ onImported }: { onImported: () => void }) {
  const { addToast } = useToast();
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [reportMonth, setReportMonth] = useState(now.getMonth() + 1);
  const [reportYear, setReportYear] = useState(now.getFullYear());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [campaignSelections, setCampaignSelections] = useState<Record<string, string>>({});
  const [businessSelections, setBusinessSelections] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [filter, setFilter] = useState("ALL");

  const reset = () => {
    setFile(null); setPreview(null); setCampaignSelections({}); setBusinessSelections({});
    setBusy(false); setResult(null); setFilter("ALL");
  };
  const chooseFile = (selected: File | null) => {
    if (selected && !/\.xlsx$/i.test(selected.name)) return addToast("error", "Only .xlsx workbooks are supported.");
    setFile(selected); setPreview(null);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); chooseFile(event.dataTransfer.files[0] ?? null); };
  const analyze = async () => {
    if (!file) return addToast("warning", "Choose an Excel workbook first.");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file); form.set("reportMonth", String(reportMonth)); form.set("reportYear", String(reportYear));
      const response = await fetch("/api/production-monitoring/import/preview", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Workbook analysis failed.");
      const next = data as Preview;
      setPreview(next);
      setCampaignSelections(Object.fromEntries(next.campaignMappings.map((mapping) => [mapping.normalizedSource, mapping.matchedCampaignId || "__create"])));
      setBusinessSelections(Object.fromEntries(next.businessUnitMappings.map((mapping) => [mapping.key, mapping.matchedBusinessUnitId || "__create"])));
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Workbook analysis failed.");
    } finally { setBusy(false); }
  };
  const selectedCampaignFor = (campaignSource: string) => campaignSelections[campaignSource] || "__create";
  const updateCampaignSelection = (campaignSource: string, targetId: string) => {
    setCampaignSelections((current) => ({ ...current, [campaignSource]: targetId }));
    setBusinessSelections((current) => ({
      ...current,
      ...Object.fromEntries((preview?.businessUnitMappings ?? [])
        .filter((mapping) => mapping.campaignNormalized === campaignSource)
        .map((mapping) => [mapping.key, "__create"])),
    }));
  };
  const visibleRecords = useMemo(() => preview?.records.filter((record) => filter === "ALL" || record.status === filter) ?? [], [filter, preview]);
  const validRecords = preview?.records.filter((record) => !record.issues.some((issue) => issue.level === "ERROR")).length ?? 0;

  const downloadErrors = () => {
    if (!preview) return;
    const rows = [["Sheet", "Row", "Campaign", "Business Unit", "Level", "Code", "Message"]];
    preview.records.forEach((record) => record.issues.forEach((issue) => rows.push([
      record.sourceSheet, String(record.sourceRow), record.campaignSource, record.businessUnitSource, issue.level, issue.code, issue.message,
    ])));
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "production-import-report.csv"; link.click(); URL.revokeObjectURL(url);
  };
  const commit = async () => {
    if (!file || !preview) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file); form.set("reportMonth", String(reportMonth)); form.set("reportYear", String(reportYear));
      form.set("validRowKeys", JSON.stringify(preview.records.filter((record) => !record.issues.some((issue) => issue.level === "ERROR")).map((record) => record.rowKey)));
      form.set("importStrategy", "fill_missing");
      form.set("campaignMappings", JSON.stringify(preview.campaignMappings.map((mapping) => ({
        source: mapping.normalizedSource,
        targetId: campaignSelections[mapping.normalizedSource] === "__create" ? null : campaignSelections[mapping.normalizedSource],
      }))));
      form.set("businessUnitMappings", JSON.stringify(preview.businessUnitMappings.map((mapping) => ({
        campaignSource: mapping.campaignNormalized,
        source: mapping.normalizedSource,
        targetId: businessSelections[mapping.key] === "__create" ? null : businessSelections[mapping.key],
      }))));
      const response = await fetch("/api/production-monitoring/import/commit", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Import failed.");
      setResult(data); onImported(); addToast("success", "Production monitoring import completed.");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Import failed.");
    } finally { setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
    <DialogTrigger asChild><Button className="gap-2"><UploadCloud className="h-4 w-4" />Import Excel</Button></DialogTrigger>
    <DialogContent className="max-h-[94vh] max-w-7xl overflow-y-auto">
      <DialogHeader><DialogTitle>Import Production Monitoring</DialogTitle><DialogDescription>Preview, validate, and map campaign-centric production data before it is saved. Operations Manager columns are discarded.</DialogDescription></DialogHeader>
      {result ? <div className="space-y-5 py-4">
        <div className="text-center"><CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" /><h3 className="mt-3 text-xl font-semibold">Import completed</h3><p className="text-sm text-muted-foreground">Import {result.importId}</p></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">{[["Imported", result.imported], ["Updated", result.updated], ["Unchanged", result.unchanged], ["Skipped", result.skipped], ["Warnings", result.warnings], ["Errors", result.errors]].map(([label, value]) => <div key={label} className="rounded-lg border p-3 text-center"><p className="text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>)}</div>
        <div className="flex justify-center gap-2"><Button variant="outline" onClick={() => window.location.assign("/production-monitoring/imports")}>Import history</Button><Button onClick={() => setOpen(false)}>View dashboard</Button></div>
      </div> : !preview ? <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Fallback month<select className="mt-2 h-10 w-full rounded-md border bg-background px-3" value={reportMonth} onChange={(event) => setReportMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Date(2020, index).toLocaleString("en-US", { month: "long" })}</option>)}</select></label><label className="text-sm font-medium">Fallback year<Input className="mt-2" type="number" min={2000} max={2100} value={reportYear} onChange={(event) => setReportYear(Number(event.target.value))} /></label></div>
        <div onDragOver={(event) => event.preventDefault()} onDrop={onDrop} className="rounded-xl border-2 border-dashed p-10 text-center hover:border-primary"><FileSpreadsheet className="mx-auto h-12 w-12 text-primary" /><p className="mt-3 font-medium">Drag and drop the production workbook</p><p className="mt-1 text-sm text-muted-foreground">.xlsx · maximum 10 MB</p><label className="mt-4 inline-flex cursor-pointer rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">Browse file<input type="file" accept=".xlsx" className="sr-only" onChange={(event: ChangeEvent<HTMLInputElement>) => chooseFile(event.target.files?.[0] ?? null)} /></label>{file && <p className="mt-4 font-semibold text-primary">{file.name}</p>}</div>
        <div className="flex justify-end"><Button onClick={analyze} disabled={!file || busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Analyze workbook</Button></div>
      </div> : <div className="space-y-5">
        <div className="rounded-lg border bg-muted/30 p-4"><div className="flex flex-wrap justify-between gap-3"><div><p className="font-semibold">{preview.fileName}</p><p className="text-sm text-muted-foreground">{preview.reportingPeriods.map((period) => new Date(Date.UTC(period.year, period.month - 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })).join(" · ")}</p></div><Button variant="outline" size="sm" onClick={() => setPreview(null)}>Choose another file</Button></div><div className="mt-3 flex flex-wrap gap-2"><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">✓ OM data excluded</span>{preview.worksheets.map((sheet) => <span key={sheet.name} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{sheet.name}: {sheet.recordCount} rows</span>)}</div></div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-7">{[["Records", preview.stats.total], ["Valid", preview.stats.valid], ["New", preview.stats.new], ["Updates", preview.stats.updated], ["Unchanged", preview.stats.unchanged], ["Warnings", preview.stats.warnings], ["Errors", preview.stats.errors]].map(([label, value]) => <div key={label} className="rounded-lg border p-3"><p className="text-xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>)}</div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border p-4"><h3 className="font-semibold">Campaign mappings</h3><div className="mt-3 max-h-52 space-y-3 overflow-y-auto">{preview.campaignMappings.map((mapping) => <label key={mapping.normalizedSource} className="grid gap-1 text-xs"><span>{mapping.source}{mapping.requiresReview && <strong className="ml-2 text-amber-700">Review suggested match</strong>}</span><select className="h-9 rounded-md border bg-background px-2 text-sm" value={campaignSelections[mapping.normalizedSource]} onChange={(event) => updateCampaignSelection(mapping.normalizedSource, event.target.value)}><option value="__create">Create “{mapping.source}”</option>{preview.availableCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}{mapping.suggestion?.id === campaign.id ? ` (${mapping.suggestion.confidence}% suggested)` : ""}</option>)}</select></label>)}</div></div>
          <div className="rounded-lg border p-4"><h3 className="font-semibold">Business unit mappings</h3><div className="mt-3 max-h-52 space-y-3 overflow-y-auto">{preview.businessUnitMappings.map((mapping) => { const campaignId = selectedCampaignFor(mapping.campaignNormalized); const options = preview.availableBusinessUnits.filter((unit) => unit.campaignId === campaignId); return <label key={mapping.key} className="grid gap-1 text-xs"><span>{mapping.source}{mapping.requiresReview && <strong className="ml-2 text-amber-700">Review suggested match</strong>}</span><select className="h-9 rounded-md border bg-background px-2 text-sm" value={businessSelections[mapping.key]} onChange={(event) => setBusinessSelections((current) => ({ ...current, [mapping.key]: event.target.value }))}><option value="__create">Create “{mapping.source}”</option>{options.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{mapping.suggestion?.id === unit.id ? ` (${mapping.suggestion.confidence}% suggested)` : ""}</option>)}</select></label>; })}</div></div>
        </div>
        <div className="flex flex-wrap items-center gap-2"><select className="h-10 rounded-md border bg-background px-3 text-sm" value={filter} onChange={(event) => setFilter(event.target.value)}>{["ALL", "NEW", "UPDATED", "UNCHANGED", "CONFLICT", "WARNING", "ERROR"].map((value) => <option key={value}>{value}</option>)}</select>{preview.records.some((record) => record.issues.length) && <Button variant="outline" className="gap-2" onClick={downloadErrors}><Download className="h-4 w-4" />Download error report</Button>}</div>
        <div className="max-h-[34vh] overflow-auto rounded-lg border"><table className="w-full min-w-[1050px] text-sm"><thead className="sticky top-0 bg-muted"><tr>{["Campaign", "Business Unit", "Period", "Metric", "Target", "MTD", "Achievement", "Status", "Validation"].map((heading) => <th key={heading} className="px-3 py-2 text-left font-medium">{heading}</th>)}</tr></thead><tbody>{visibleRecords.map((record) => <tr key={record.rowKey} className="border-t"><td className="px-3 py-2">{record.campaignSource}</td><td className="px-3 py-2 font-medium">{record.businessUnitSource}<p className="text-xs text-muted-foreground">{record.sourceSheet} row {record.sourceRow}</p></td><td className="px-3 py-2">{record.reportMonth}/{record.reportYear}</td><td className="px-3 py-2 capitalize">{record.metricType}</td><td className="px-3 py-2 tabular-nums">{record.target ?? "—"}</td><td className="px-3 py-2 tabular-nums">{record.mtd ?? "—"}</td><td className="px-3 py-2 tabular-nums">{record.achievement == null ? "—" : `${(record.achievement * 100).toFixed(1)}%`}</td><td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLE[record.status]}`}>{record.status}</span></td><td className="max-w-72 px-3 py-2 text-xs">{record.issues[0]?.message || "Valid"}</td></tr>)}</tbody></table></div>
        {preview.stats.errors > 0 && <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" /><span>{preview.stats.errors} invalid row{preview.stats.errors === 1 ? "" : "s"} will be skipped. Valid records can still be imported.</span></div>}
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Ready to import: <strong className="text-foreground">{validRecords}</strong> records</p><div className="flex gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={commit} disabled={busy || validRecords === 0}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Import valid records</Button></div></div>
      </div>}
    </DialogContent>
  </Dialog>;
}
