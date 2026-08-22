"use client";

import { ChangeEvent, DragEvent, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/toast-provider";
import type { KpiPreviewRecord } from "@/types/kpi";
import type { CampaignOption } from "@/types/campaign";

type Preview = {
  fileName: string;
  campaign: CampaignOption;
  worksheets: Array<{ name: string; month: number | null; supported: boolean; recordCount: number; error?: string }>;
  agents: Array<{ id: string; name: string; seatNumber: number | null }>;
  records: KpiPreviewRecord[];
  stats: Record<"total" | "valid" | "warnings" | "invalid" | "duplicates" | "unmatched", number>;
};
type ImportResult = { batchId: string; imported: number; updated: number; skipped: number; failed: number; duplicates: number; unmatched: number; warnings: number };

const statusStyle: Record<KpiPreviewRecord["status"], string> = {
  VALID: "bg-green-100 text-green-800",
  WARNING: "bg-amber-100 text-amber-800",
  INVALID: "bg-red-100 text-red-800",
  DUPLICATE: "bg-violet-100 text-violet-800",
  UNMATCHED: "bg-slate-100 text-slate-700",
};

export function KpiImportDialog({
  campaigns,
  defaultCampaignId,
  onImported,
}: {
  campaigns: CampaignOption[];
  defaultCampaignId?: string;
  onImported: () => void;
}) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [campaignId, setCampaignId] = useState(defaultCampaignId || "");
  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [records, setRecords] = useState<KpiPreviewRecord[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [duplicateMode, setDuplicateMode] = useState<"SKIP" | "UPDATE">("SKIP");

  const reset = () => {
    setFile(null);
    setPreview(null);
    setRecords([]);
    setResult(null);
    setBusy(false);
    setFilter("ALL");
    setSearch("");
    setDuplicateMode("SKIP");
    setCampaignId(defaultCampaignId || campaigns[0]?.id || "");
  };
  const chooseFile = (selected: File | null) => {
    if (selected && !/\.xlsx$/i.test(selected.name)) {
      addToast("error", "Only .xlsx workbooks are supported.");
      return;
    }
    setFile(selected);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    chooseFile(event.dataTransfer.files[0] ?? null);
  };
  const analyze = async () => {
    if (!file || !campaignId) {
      addToast("warning", "Choose a campaign and Excel workbook first.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("campaignId", campaignId);
      form.set("reportYear", String(reportYear));
      const response = await fetch("/api/kpi/import/preview", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Workbook analysis failed.");
      setPreview(data);
      setRecords(data.records);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Workbook analysis failed.");
    } finally {
      setBusy(false);
    }
  };
  const updateMatch = (rowKey: string, employeeId: string) => {
    setRecords((current) => current.map((record) => {
      if (record.rowKey !== rowKey) return record;
      if (employeeId === "__skip") return { ...record, skipped: true };
      const agent = preview?.agents.find((candidate) => candidate.id === employeeId);
      const status = record.duplicateWithinFile
        ? "DUPLICATE"
        : record.errors.length
          ? "INVALID"
          : record.warnings.length
            ? "WARNING"
            : "VALID";
      return { ...record, matchedEmployeeId: employeeId || null, matchedEmployeeName: agent?.name ?? null, matchMethod: "MANUAL", matchConfidence: null, skipped: false, status };
    }));
  };
  const visibleRecords = useMemo(() => records.filter((record) => {
    if (filter !== "ALL" && record.status !== filter) return false;
    return !search || record.employeeName.toLowerCase().includes(search.toLowerCase());
  }), [filter, records, search]);
  const readyCount = records.filter((record) =>
    !record.skipped && record.matchedEmployeeId && !record.duplicateWithinFile && record.errors.length === 0
  ).length;
  const unresolvedCount = records.filter((record) => !record.skipped && !record.matchedEmployeeId).length;

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const response = await fetch("/api/kpi/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: preview.campaign.id,
          fileName: preview.fileName,
          duplicateMode,
          records: records.map((record) => ({ ...record, skipRequested: Boolean(record.skipped) })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Import failed.");
      setResult(data);
      onImported();
      addToast("success", "KPI import completed.");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button className="gap-2"><UploadCloud className="h-4 w-4" /> Import Excel</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import KPI Data</DialogTitle>
          <DialogDescription>Analyze, match, and validate workbook records before anything is saved.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-6 py-4">
            <div className="flex flex-col items-center text-center">
              <CheckCircle2 className="h-14 w-14 text-green-600" />
              <h3 className="mt-3 text-xl font-semibold">Import completed</h3>
              <p className="text-sm text-muted-foreground">Batch {result.batchId}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {[["Imported", result.imported], ["Updated", result.updated], ["Skipped", result.skipped], ["Warnings", result.warnings], ["Failed", result.failed]].map(([label, value]) => (
                <div key={label} className="rounded-lg border p-4 text-center"><p className="text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>
              ))}
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => window.location.assign(`/performance/kpi/imports/${result.batchId}`)}>View import details</Button>
              <Button onClick={() => setOpen(false)}>View KPI dashboard</Button>
            </div>
          </div>
        ) : !preview ? (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm font-medium">Campaign
                <select className="mt-2 h-10 w-full rounded-md border bg-background px-3" value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
                  <option value="">Choose campaign</option>
                  {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.campaignName}</option>)}
                </select>
              </label>
              <label className="space-y-2 text-sm font-medium">Reporting year fallback
                <Input className="mt-2" type="number" min={2000} max={2100} value={reportYear} onChange={(event) => setReportYear(Number(event.target.value))} />
              </label>
            </div>
            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop}
              className="rounded-xl border-2 border-dashed p-10 text-center transition-colors hover:border-primary"
            >
              <FileSpreadsheet className="mx-auto h-12 w-12 text-primary" />
              <p className="mt-3 font-medium">Drag and drop an Excel file</p>
              <p className="mt-1 text-sm text-muted-foreground">or browse below · .xlsx · maximum 10 MB</p>
              <label className="mt-4 inline-flex cursor-pointer rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
                Browse file
                <input type="file" accept=".xlsx" className="sr-only" onChange={(event: ChangeEvent<HTMLInputElement>) => chooseFile(event.target.files?.[0] ?? null)} />
              </label>
              {file && <p className="mt-4 text-sm font-semibold text-primary">{file.name}</p>}
            </div>
            <div className="flex justify-end"><Button onClick={analyze} disabled={busy || !file || !campaignId}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Analyze workbook</Button></div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{preview.fileName}</p><p className="text-sm text-muted-foreground">{preview.campaign.campaignName}</p></div><Button variant="outline" size="sm" onClick={() => { setPreview(null); setRecords([]); }}>Choose another file</Button></div>
              <div className="mt-3 flex flex-wrap gap-2">
                {preview.worksheets.map((sheet) => <span key={sheet.name} title={sheet.error} className={`rounded-full px-2.5 py-1 text-xs font-medium ${sheet.supported && !sheet.error ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>{sheet.supported && !sheet.error ? "✓" : "–"} {sheet.name} ({sheet.recordCount})</span>)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
              {[["Records", records.length], ["Ready", readyCount], ["Warnings", records.filter((r) => r.status === "WARNING").length], ["Duplicates", records.filter((r) => r.status === "DUPLICATE").length], ["Unmatched", unresolvedCount], ["Invalid", records.filter((r) => r.status === "INVALID").length]].map(([label, value]) => (
                <div key={label} className="rounded-lg border p-3"><p className="text-xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>
              ))}
            </div>
            <div className="flex flex-col gap-2 md:flex-row">
              <Input placeholder="Search employee" value={search} onChange={(event) => setSearch(event.target.value)} className="md:max-w-xs" />
              <select value={filter} onChange={(event) => setFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm">
                {['ALL', 'VALID', 'WARNING', 'INVALID', 'DUPLICATE', 'UNMATCHED'].map((value) => <option key={value} value={value}>{value === 'ALL' ? 'All records' : value}</option>)}
              </select>
            </div>
            <div className="max-h-[36vh] overflow-auto rounded-lg border">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="sticky top-0 z-10 bg-muted"><tr>{["Employee", "Period", "Tenure", "QA", "AHT", "Adherence", "CM", "CD", "Validation", "Employee match"].map((heading) => <th key={heading} className="px-3 py-2 text-left font-medium">{heading}</th>)}</tr></thead>
                <tbody>{visibleRecords.map((record) => (
                  <tr key={record.rowKey} className={`border-t ${record.skipped ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2"><p className="font-medium">{record.employeeName}</p><p className="text-xs text-muted-foreground">{record.sourceSheet} row {record.sourceRow}</p></td>
                    <td className="px-3 py-2">{record.month}/{record.year}</td><td className="px-3 py-2">{record.tenure || "—"}</td>
                    {[record.actualQa, record.actualAht, record.actualAdherence, record.actualCm, record.actualCd].map((value, index) => <td key={index} className="px-3 py-2 tabular-nums">{value ?? "—"}</td>)}
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${statusStyle[record.status]}`}>{record.skipped ? "SKIPPED" : record.status}</span>{(record.errors[0] || record.warnings[0]) && <p className="mt-1 max-w-48 text-xs text-muted-foreground">{record.errors[0] || record.warnings[0]}</p>}</td>
                    <td className="px-3 py-2"><select aria-label={`Match ${record.employeeName}`} className="h-9 max-w-60 rounded-md border bg-background px-2 text-xs" value={record.skipped ? "__skip" : record.matchedEmployeeId || ""} onChange={(event) => updateMatch(record.rowKey, event.target.value)}><option value="">Matching required</option>{record.suggestions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.confidence}%)</option>)}{preview.agents.filter((agent) => !record.suggestions.some((candidate) => candidate.id === agent.id)).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}<option value="__skip">Skip record</option></select></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {records.some((record) => record.existingRecordId) && <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900"><p className="font-semibold">Existing KPI data detected</p><div className="mt-2 flex gap-4"><label><input type="radio" checked={duplicateMode === "SKIP"} onChange={() => setDuplicateMode("SKIP")} /> <span className="ml-1">Skip existing records (safest)</span></label><label><input type="radio" checked={duplicateMode === "UPDATE"} onChange={() => setDuplicateMode("UPDATE")} /> <span className="ml-1">Update existing records</span></label></div></div>}
            {unresolvedCount > 0 && <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4" /><span>{unresolvedCount} employee match{unresolvedCount === 1 ? "" : "es"} remain unresolved and will be skipped.</span></div>}
            <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">Ready to import: <strong className="text-foreground">{readyCount}</strong> records</p><Button onClick={commit} disabled={busy || readyCount === 0}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Import KPI data</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
