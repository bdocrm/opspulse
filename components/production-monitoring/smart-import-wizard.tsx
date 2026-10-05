"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { useRouter } from "next/navigation";
import { Upload, Loader2, History, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle } from "@/components/layout/page-title";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { normalizeProductionName } from "@/lib/production-normalization";
import { FIELDS, SKIP_CONFLICT, type Candidate, type Config, type Preview, type ReviewOptions } from "@/lib/smart-import/types";

const endpoint = "/api/production-monitoring/smart-import";
const campaignGroup = (name: string) => name.trim().split(/[\s-]+/)[0].toUpperCase();
const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const statusClasses: Record<string, string> = { NEW: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", UPDATE: "bg-blue-500/15 text-blue-700 dark:text-blue-400", DUPLICATE: "bg-muted text-muted-foreground", WARNING: "bg-amber-500/15 text-amber-700 dark:text-amber-400", PENDING: "bg-purple-500/15 text-purple-700 dark:text-purple-400", CONFLICT: "bg-orange-500/15 text-orange-700 dark:text-orange-400", INVALID: "bg-red-500/15 text-red-700 dark:text-red-400" };
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Import request failed.");
  return data;
}
const send = <T,>(id: string, body: unknown) => request<T>(`${endpoint}/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
type HistoryRow = { id: string; fileName: string; status: string; createdAt: string; recordsDetected: number; recordsImported: number; recordsUpdated: number; importedBy: { name: string } };
function number(value: number | null | undefined, percent = false) { return value == null ? "—" : percent ? `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 3 })}%` : value.toLocaleString("en-US", { maximumFractionDigits: 8 }); }

export function SmartImportWizard() {
  const { mutate } = useSWRConfig();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [options, setOptions] = useState<ReviewOptions | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [campaignFilter, setCampaignFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("sourceRow");
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null);
  const rawRequest = useRef(0);
  const receivedBatchId = useRef<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPages, setHistoryPages] = useState(1);
  const [sourceSheet, setSourceSheet] = useState("");
  const [sourceRow, setSourceRow] = useState(1);
  const [sourceData, setSourceData] = useState<Record<string, unknown> | null>(null);
  const readOnly = Boolean(preview && !["STAGED", "READY", "FAILED"].includes(preview.status));
  const duplicatesOnly = Boolean(preview && preview.summary.duplicates > 0 && preview.summary.ready === 0);

  const receive = useCallback((data: Preview) => {
    if (data.id !== receivedBatchId.current) setCampaignFilter("");
    receivedBatchId.current = data.id;
    setPreview(data); setOptions({ ...data.options, configs: data.configs }); setSelected(new Set(data.records.filter(row => row.action !== "BLOCK" && row.action !== "SKIP").map(row => row.rowKey)));
    setDirty(false); setPage(1); setExpanded(null); setRaw(null); setResult(data.result ?? null); setHistory(null);
    setSourceSheet(data.inspection.sheets[0]?.name ?? ""); setSourceRow(1); setSourceData(null);
    window.history.replaceState(null, "", `${window.location.pathname}?batch=${encodeURIComponent(data.id)}`);
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("batch");
    if (!id) return;
    let active = true;
    setBusy("Loading saved preview");
    request<Preview>(`${endpoint}/${encodeURIComponent(id)}`).then(data => { if (active) receive(data); }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setBusy(""); });
    return () => { active = false; };
  }, [receive]);
  function change(next: ReviewOptions) { setOptions(next); setDirty(true); setResult(null); }
  async function analyze() {
    if (!file || busy) return;
    setError(""); setBusy("Reading all sheets and preserving source data");
    try { const form = new FormData(); form.set("file", file); receive(await request<Preview>(endpoint, { method: "POST", body: form })); }
    catch (error) { setError((error as Error).message); } finally { setBusy(""); }
  }
  async function revalidate(reviewOptions = options) {
    if (!preview || !reviewOptions || busy) return;
    setError(""); setBusy("Validating mappings and comparing current records");
    try { receive(await send<Preview>(preview.id, { action: "review", options: reviewOptions })); }
    catch (error) { setError((error as Error).message); } finally { setBusy(""); }
  }
  async function commit() {
    if (!preview || busy || dirty || (!selected.size && !duplicatesOnly)) return;
    setBusy("Committing selected records and history"); setError("");
    try {
      const saved = await send<Record<string, unknown>>(preview.id, { action: "commit", previewHash: preview.previewHash, selectedRows: [...selected] });
      setResult(saved); setPreview(current => current ? { ...current, status: String(saved.status) } : current);
      await mutate(key => typeof key === "string" && /\/api\/(?:dashboard|collectors|production-monitoring|om-dashboard|campaigns|reports|analytics|goals)/.test(key), undefined, { revalidate: true });
      router.refresh(); setConfirm(false);
    } catch (error) { setError((error as Error).message); setConfirm(false); } finally { setBusy(""); }
  }
  async function showHistory(targetPage = 1) {
    setBusy("Loading import history"); setError("");
    try { const data = await request<{ batches: HistoryRow[]; totalPages: number }>(`${endpoint}?page=${targetPage}`); setHistory(data.batches); setHistoryPage(targetPage); setHistoryPages(data.totalPages); }
    catch (error) { setError((error as Error).message); } finally { setBusy(""); }
  }
  async function loadBatch(id: string) {
    setBusy("Loading import snapshot"); setError("");
    try { receive(await request<Preview>(`${endpoint}/${id}`)); } catch (error) { setError((error as Error).message); } finally { setBusy(""); }
  }
  async function viewRaw(row: Candidate) {
    const revision = ++rawRequest.current;
    setExpanded(expanded === row.rowKey ? null : row.rowKey); setRaw(null);
    if (expanded === row.rowKey) return;
    try {
      const data = await request<Record<string, unknown>>(`${endpoint}/${preview!.id}?format=raw&sheet=${encodeURIComponent(row.sourceSheet)}&row=${row.sourceRow}`);
      if (revision === rawRequest.current) setRaw(data);
    } catch (error) { if (revision === rawRequest.current) setError((error as Error).message); }
  }
  async function cancel() {
    if (!preview || busy) return;
    setBusy("Cancelling import");
    try { await send(preview.id, { action: "cancel" }); setPreview(current => current ? { ...current, status: "CANCELLED" } : null); }
    catch (error) { setError((error as Error).message); } finally { setBusy(""); }
  }
  async function inspectSource() {
    if (!preview || busy || !sourceSheet) return;
    setBusy("Loading captured source row"); setError("");
    try { setSourceData(await request<Record<string, unknown>>(`${endpoint}/${preview.id}?format=raw&sheet=${encodeURIComponent(sourceSheet)}&row=${sourceRow}`)); }
    catch (error) { setError((error as Error).message); } finally { setBusy(""); }
  }
  const campaignOptions = useMemo(() => [...new Set((preview?.records ?? []).map(row => row.campaignName ?? row.campaignSource).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [preview]);
  const campaignGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const campaign of campaignOptions) {
      const group = campaignGroup(campaign);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return [...counts].filter(([, count]) => count > 1).map(([group]) => group).sort();
  }, [campaignOptions]);
  const filtered = useMemo(() => {
    const rows = (preview?.records ?? []).filter(row => (!campaignFilter || (campaignFilter.startsWith("group:") ? campaignGroup(row.campaignName ?? row.campaignSource) === campaignFilter.slice(6) : (row.campaignName ?? row.campaignSource) === campaignFilter.slice(9))) && (filter === "ALL" || row.status === filter || (filter === "WARNING" && row.issues.some(issue => issue.level === "WARNING"))) && `${row.campaignSource} ${row.goalLabel} ${row.sourceSheet} ${row.issues.map(issue => issue.message).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
    return rows.sort((a, b) => {
      const av = sort === "mtd" ? a.values.mtd : a[sort as "sourceRow" | "campaignSource" | "goalLabel" | "status"];
      const bv = sort === "mtd" ? b.values.mtd : b[sort as "sourceRow" | "campaignSource" | "goalLabel" | "status"];
      return (typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true })) * (ascending ? 1 : -1);
    });
  }, [preview, campaignFilter, filter, search, sort, ascending]);
  const visible = filtered.slice((page - 1) * 50, page * 50);
  const configEntries = Object.entries(options?.configs ?? {});
  const unreviewedConfigs = configEntries.filter(([, config]) => !config.reviewed);
  const selectableRows = filtered.filter(row => row.action !== "BLOCK" && row.action !== "SKIP");
  const selectedFilteredCount = selectableRows.filter(row => selected.has(row.rowKey)).length;
  const selectionDisabled = readOnly || Boolean(busy) || dirty;
  const selectAllFiltered = (checked: boolean) => setSelected(current => {
    const next = new Set(current);
    for (const row of selectableRows) checked ? next.add(row.rowKey) : next.delete(row.rowKey);
    return next;
  });
  async function confirmConfigurations() {
    if (!options) return;
    const next = { ...options, configs: Object.fromEntries(configEntries.map(([key, config]) => [key, { ...config, reviewed: true }])) };
    setOptions(next); setDirty(true);
    await revalidate(next);
  }
  const toggle = (row: Candidate) => setSelected(current => { const next = new Set(current); next.has(row.rowKey) ? next.delete(row.rowKey) : next.add(row.rowKey); return next; });
  const updateConfig = (key: string, patch: Partial<Config>) => {
    if (!options) return;
    const configs = { ...options.configs, [key]: { ...options.configs[key], ...patch } };
    if (patch.isPrimary) for (const other of Object.keys(configs)) if (other !== key && configs[other].campaignId === configs[key].campaignId) configs[other] = { ...configs[other], isPrimary: false };
    change({ ...options, configs });
  };

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><PageTitle className="mb-0" title="Smart Bulk Import" subtitle="Upload productivity files with automatic campaign matching, then review and confirm." /><div className="flex gap-2"><Button variant="outline" disabled={Boolean(busy)} onClick={() => showHistory()}><History className="mr-2 h-4 w-4" />Import history</Button><Link href="/production-monitoring"><Button variant="outline">View imported records</Button></Link></div></div>
    <ol className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Import progress">{["Upload", "Inspect & map", "Validate & review", "Confirm", "Result"].map((step, index) => <li key={step} className={index === (result ? 4 : preview ? dirty ? 1 : 2 : 0) ? "font-semibold text-primary" : ""}>{index + 1}. {step}</li>)}</ol>
    {busy && <div role="status" className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{busy}…</div>}
    {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">{error}</div>}
    {history ? <Card><CardHeader><CardTitle>Import history</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["File", "Uploaded", "By", "Status", "Rows", "Inserted", "Updated", "Review"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{history.map(row => <tr key={row.id} className="border-t"><td className="p-2">{row.fileName}</td><td className="p-2">{new Date(row.createdAt).toLocaleString()}</td><td className="p-2">{row.importedBy.name}</td><td className="p-2">{row.status}</td><td className="p-2">{row.recordsDetected}</td><td className="p-2">{row.recordsImported}</td><td className="p-2">{row.recordsUpdated}</td><td className="p-2"><Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => loadBatch(row.id)}>Open</Button></td></tr>)}</tbody></table>{!history.length && <p className="p-5 text-sm text-muted-foreground">No smart import batches yet.</p>}</div><div className="mt-4 flex items-center justify-between"><Button variant="outline" onClick={() => setHistory(null)}>Back</Button><div className="flex items-center gap-3"><Button variant="outline" disabled={historyPage <= 1 || Boolean(busy)} onClick={() => showHistory(historyPage - 1)}>Previous</Button><span className="text-sm">{historyPage} / {historyPages}</span><Button variant="outline" disabled={historyPage >= historyPages || Boolean(busy)} onClick={() => showHistory(historyPage + 1)}>Next</Button></div></div></CardContent></Card> : !preview ? <Card><CardHeader><CardTitle>Upload productivity file</CardTitle></CardHeader><CardContent className="space-y-5"><div onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) setFile(event.dataTransfer.files[0] ?? null); }} className="rounded-xl border-2 border-dashed p-10 text-center"><Upload className="mx-auto h-10 w-10 text-primary" /><p className="mt-3 font-medium">Drop your Excel or CSV file here</p><p className="mt-1 text-sm text-muted-foreground">.xlsx, .xls, .csv · Up to 10 MB · All sheets are preserved</p><Input aria-label="Productivity file" type="file" accept=".xlsx,.xls,.csv" className="mx-auto mt-4 max-w-sm" disabled={Boolean(busy)} onChange={event => setFile(event.target.files?.[0] ?? null)} />{file && <p className="mt-3 text-sm font-medium">{file.name} ({(file.size / 1024).toFixed(1)} KB)</p>}</div><Button onClick={analyze} disabled={!file || Boolean(busy)}>Inspect file</Button></CardContent></Card> : <>
      {result && <Card className="border-emerald-500/30"><CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" />Import Completed</CardTitle></CardHeader><CardContent><p className="mb-3 text-sm">{preview.inspection.fileName} · Current dashboards have been refreshed.</p><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{["inserted", "updated", "duplicates", "pending", "warnings", "conflicts", "invalid", "skipped"].map(key => <div key={key}><p className="text-xl font-semibold">{String(result[key] ?? 0)}</p><p className="text-xs capitalize text-muted-foreground">{key === "conflicts" ? "Conflicts not imported" : key}</p></div>)}</div><div className="mt-4 flex flex-wrap gap-2"><Link href="/production-monitoring"><Button>View imported records</Button></Link><Button variant="outline" onClick={() => showHistory()}>View import history</Button><a href={`${endpoint}/${preview.id}?format=errors`}><Button variant="outline">View errors</Button></a></div></CardContent></Card>}
      <Card><CardContent className="space-y-4 pt-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{preview.inspection.fileName}</p><p className="text-sm text-muted-foreground">{preview.inspection.fileType.toUpperCase()} · {preview.inspection.sheets.length} sheets · Batch {preview.status}</p></div><div className="flex gap-2"><a href={`${endpoint}/${preview.id}?format=source`}><Button variant="outline" size="sm"><Download className="mr-2 h-4 w-4" />Original file</Button></a><Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => { setPreview(null); setOptions(null); setResult(null); setError(""); window.history.replaceState(null, "", window.location.pathname); }}>New upload</Button></div></div><p className="rounded-lg bg-emerald-500/10 p-3 text-sm">Source coverage: {preview.inspection.capturedCells.toLocaleString()} / {preview.inspection.nonEmptyCells.toLocaleString()} non-empty cells preserved. Formulas, errors, and unmapped values remain in raw history.</p>
      <p className="text-sm">Reporting periods: {[...new Set(preview.records.filter(row => row.reportMonth && row.reportYear).map(row => `${row.reportMonth}/${row.reportYear}`))].join(", ") || "Not yet resolved"}</p>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Inspect any captured source row</summary><p className="mt-2 text-xs text-muted-foreground">View headers, titles, blank cells, and unmapped sheets as well as production rows.</p><div className="mt-3 flex flex-wrap items-end gap-3"><label className="text-xs">Sheet<select className={`${selectClass} mt-1 min-w-40`} value={sourceSheet} onChange={event => { setSourceSheet(event.target.value); setSourceRow(1); setSourceData(null); }}>{preview.inspection.sheets.map(sheet => <option key={sheet.name}>{sheet.name}</option>)}</select></label><label className="text-xs">Source row<Input className="mt-1 w-28" type="number" min={1} max={preview.inspection.sheets.find(sheet => sheet.name === sourceSheet)?.rows ?? 1} value={sourceRow} onChange={event => setSourceRow(Number(event.target.value))} /></label><Button variant="outline" disabled={Boolean(busy)} onClick={inspectSource}>View source</Button></div>{sourceData && <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-xs">{JSON.stringify(sourceData.rawPayload, null, 2)}</pre>}</details>
      {preview.previousImports.map(previous => <p key={previous.id} className="rounded-lg bg-amber-500/10 p-3 text-sm"><AlertTriangle className="mr-2 inline h-4 w-4" />This exact file was imported {new Date(previous.createdAt).toLocaleString()} by {previous.importedBy.name}: {previous.status}. Row comparisons still apply.</p>)}
      {preview.lastError && <p role="alert" className="text-sm text-red-600">Last attempt: {preview.lastError}. Revalidate to retry.</p>}
      {options && <fieldset disabled={readOnly || Boolean(busy)} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Fallback reporting month<select className={`${selectClass} mt-1`} value={options.fallbackMonth ?? ""} onChange={event => change({ ...options, fallbackMonth: event.target.value ? Number(event.target.value) : null })}><option value="">Detect from source</option>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{new Date(2026, index).toLocaleString("en-US", { month: "long" })}</option>)}</select></label><label className="text-sm">Fallback reporting year<Input className="mt-1" type="number" min={2000} max={2100} placeholder="Required if not detected" value={options.fallbackYear ?? ""} onChange={event => change({ ...options, fallbackYear: event.target.value ? Number(event.target.value) : null })} /></label></div>
      {preview.inspection.sheets.map(sheet => <details key={sheet.name} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{sheet.name} · {sheet.rows} rows · {sheet.columns} columns · {sheet.nonEmptyCells} values{!sheet.detected && " · Mapping required"}</summary><div className="mt-3 space-y-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={options.selectedSheets.includes(sheet.name)} onChange={event => change({ ...options, selectedSheets: event.target.checked ? [...options.selectedSheets, sheet.name] : options.selectedSheets.filter(name => name !== sheet.name) })} />Process this sheet (source data is preserved for every sheet)</label><label className="block max-w-xs text-sm">Header row<Input type="number" min={1} max={sheet.rows} value={options.headerRows[sheet.name] ?? sheet.headerRow ?? 1} onChange={event => change({ ...options, headerRows: { ...options.headerRows, [sheet.name]: Number(event.target.value) } })} /></label>{sheet.warnings.map(warning => <p key={warning} className="text-xs text-amber-700 dark:text-amber-400">{warning}</p>)}<p className="text-xs text-muted-foreground">Unmapped Columns Detected: choose a field or Save as metadata. Ignoring production mapping still preserves the source value.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{sheet.headers.map(column => <label key={column.index} className="text-xs">{column.letter}: {column.header} · {column.populatedRows} populated rows<select className={`${selectClass} mt-1`} value={options.columnMappings[sheet.name]?.[String(column.index)] ?? column.field ?? "metadata"} onChange={event => change({ ...options, columnMappings: { ...options.columnMappings, [sheet.name]: { ...options.columnMappings[sheet.name], [column.index]: event.target.value as typeof FIELDS[number] | "metadata" } } })}><option value="metadata">Save as metadata / ignore production mapping</option>{FIELDS.map(field => <option key={field} value={field}>{field}</option>)}</select></label>)}</div></div></details>)}
      {preview.records.some(row => !row.campaignId && row.campaignSource) && <div className="rounded-lg border p-3"><h3 className="text-sm font-semibold">Campaign mappings</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">{[...new Set(preview.records.filter(row => !row.campaignId && row.campaignSource).map(row => row.campaignSource))].map(source => <label key={source} className="text-xs">{source}<select className={`${selectClass} mt-1`} value={options.campaignMappings[normalizeProductionName(source)] ?? ""} onChange={event => { const campaignMappings = { ...options.campaignMappings }; if (event.target.value) campaignMappings[normalizeProductionName(source)] = event.target.value; else delete campaignMappings[normalizeProductionName(source)]; change({ ...options, campaignMappings }); }}><option value="">Select authorized campaign</option>{preview.campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>)}</div></div>}
      {configEntries.length > 0 && <details className="rounded-lg border p-3" open><summary className="cursor-pointer text-sm font-semibold">Campaign + KPI configuration</summary><p className="mt-2 text-xs text-muted-foreground">Confirm first-time mappings. Gross Transmittals may be count or currency; choose the campaign-specific unit. Mark one KPI per campaign for its dashboard card. All KPIs remain visible in Production Monitoring.</p><div className="mt-3 space-y-3">{configEntries.map(([key, config]) => <div key={key} className="rounded-md bg-muted/30 p-3"><p className="text-sm font-medium">{preview.campaigns.find(campaign => campaign.id === config.campaignId)?.name} · {config.label}{config.version ? " · Saved configuration" : ` · Suggested (${config.confidence ?? 55}% confidence)`}</p><fieldset disabled={Boolean(config.version)} className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6"><label className="text-xs">Unit<select className={selectClass} value={config.unitType} onChange={event => updateConfig(key, { unitType: event.target.value as Config["unitType"], calculationMethod: ["PERCENTAGE", "RATE", "SCORE"].includes(event.target.value) ? "DIRECT_VALUE" : "SUM", aggregationMethod: ["PERCENTAGE", "RATE", "SCORE"].includes(event.target.value) ? "DIRECT_VALUE" : "SUM" })}>{["COUNT", "CURRENCY", "PERCENTAGE", "RATE", "SCORE", "CUSTOM"].map(value => <option key={value}>{value}</option>)}</select></label>{(["calculationMethod", "aggregationMethod"] as const).map(field => <label key={field} className="text-xs">{field === "calculationMethod" ? "Weekly calculation" : "Aggregation"}<select className={selectClass} value={config[field]} onChange={event => updateConfig(key, { [field]: event.target.value })}>{["SUM", "AVERAGE", "WEIGHTED_AVERAGE", "DIRECT_VALUE", "CUSTOM"].map(value => <option key={value}>{value}</option>)}</select></label>)}<label className="text-xs">Goal direction<select className={selectClass} value={config.goalDirection} onChange={event => updateConfig(key, { goalDirection: event.target.value as Config["goalDirection"] })}><option value="HIGHER">Higher is better</option><option value="LOWER">Lower is better</option></select></label><label className="text-xs">Decimal precision<Input type="number" min={0} max={8} value={config.decimalPrecision} onChange={event => updateConfig(key, { decimalPrecision: Number(event.target.value) })} /></label><label className="text-xs">Mismatch tolerance<Input type="number" min={0} step="0.001" value={config.tolerance} onChange={event => updateConfig(key, { tolerance: Number(event.target.value) })} /></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={config.isPrimary} onChange={event => updateConfig(key, { isPrimary: event.target.checked })} />Use on dashboard</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={config.reviewed} onChange={event => updateConfig(key, { reviewed: event.target.checked })} />Configuration reviewed</label></fieldset></div>)}</div></details>}
      {preview.records.some(row => row.conflictRows.length) && <div className="rounded-lg border border-orange-500/30 p-3"><h3 className="text-sm font-semibold">Resolve Conflicts</h3><p className="mt-1 text-xs text-muted-foreground">Compare source values and choose one row per conflicting campaign/KPI/month, then revalidate. You can skip a conflict and import the other valid records. Invalid and skipped rows remain in history.</p>{[...new Map(preview.records.filter(row => row.conflictRows.length && row.key).map(row => [row.key!, row])).entries()].map(([key, row]) => <label key={key} className="mt-3 block text-sm">{row.campaignSource} · {row.goalLabel} · {row.reportMonth}/{row.reportYear}<select className={`${selectClass} mt-1`} value={options.conflictSelections[key] ?? ""} onChange={event => change({ ...options, conflictSelections: { ...options.conflictSelections, [key]: event.target.value } })}><option value="">Require review / do not import</option><option value={SKIP_CONFLICT}>Skip this conflict / proceed with valid records</option>{preview.records.filter(candidate => candidate.key === key).map(candidate => <option key={candidate.rowKey} value={candidate.rowKey}>{candidate.sourceSheet} row {candidate.sourceRow}: Goal {number(candidate.source.target)} · MTD {number(candidate.source.mtd)} · {candidate.reportDate ?? "No date"}</option>)}</select></label>)}</div>}
      {!readOnly && <Button disabled={Boolean(busy)} onClick={() => revalidate()}>{dirty ? "Apply mappings & revalidate" : "Revalidate against current data"}</Button>}
      </fieldset>}</CardContent></Card>
      <div className="grid grid-cols-3 gap-2 md:grid-cols-9">{["total", "ready", "new", "updates", "duplicates", "pending", "warnings", "conflicts", "invalid"].map(key => <div key={key} className="rounded-lg border p-3"><p className="text-xl font-semibold">{preview.summary[key]}</p><p className="text-xs capitalize text-muted-foreground">{key}</p></div>)}</div>
      <Card><CardHeader><CardTitle>Bulk Import Preview</CardTitle><div className="flex flex-wrap gap-2"><Input aria-label="Search import rows" className="max-w-xs" placeholder="Search campaign, KPI, sheet, or issues" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /><select aria-label="Campaign filter" className={`${selectClass} max-w-56`} value={campaignFilter} onChange={event => { setCampaignFilter(event.target.value); setPage(1); }}><option value="">All campaigns</option><optgroup label="Campaign groups">{campaignGroups.map(group => <option key={group} value={`group:${group}`}>ALL {group} CAMPAIGN</option>)}</optgroup><optgroup label="Individual campaigns">{campaignOptions.map(campaign => <option key={campaign} value={`campaign:${campaign}`}>{campaign}</option>)}</optgroup></select><select aria-label="Status filter" className={`${selectClass} max-w-40`} value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}>{["ALL", "NEW", "UPDATE", "DUPLICATE", "PENDING", "WARNING", "CONFLICT", "INVALID"].map(value => <option key={value}>{value}</option>)}</select><select aria-label="Sort rows" className={`${selectClass} max-w-40`} value={sort} onChange={event => setSort(event.target.value)}>{[["sourceRow", "Source row"], ["campaignSource", "Campaign"], ["goalLabel", "KPI"], ["mtd", "MTD"], ["status", "Status"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button variant="outline" size="sm" onClick={() => setAscending(current => !current)}>{ascending ? "Ascending" : "Descending"}</Button><a href={`${endpoint}/${preview.id}?format=errors`}><Button variant="outline" size="sm"><Download className="mr-2 h-4 w-4" />Export issues CSV</Button></a></div></CardHeader><CardContent>
      {!readOnly && (unreviewedConfigs.length > 0 || dirty || preview.records.some(row => row.action === "BLOCK")) && <div className="mb-4 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
        {unreviewedConfigs.length > 0 && <><p>{unreviewedConfigs.length} campaign/KPI configurations need confirmation before their rows can be selected. Check the units in Campaign + KPI configuration above, then confirm.</p><Button variant="outline" disabled={Boolean(busy)} onClick={confirmConfigurations}>Confirm KPI configurations &amp; revalidate</Button></>}
        {dirty && <p>Mappings changed. Apply mappings &amp; revalidate to enable selection.</p>}
        {preview.records.some(row => !row.campaignId) && <p>Some campaigns have no authorized match. Choose them in Campaign mappings above, then revalidate.</p>}
        <p className="text-xs text-muted-foreground">Select All selects importable rows across all pages matching your filters. Invalid and skipped rows stay unchecked; their Issues column explains what needs fixing.</p>
      </div>}
      <div className="max-h-[65vh] overflow-auto rounded-lg border"><table className="w-full min-w-[1700px] text-left text-xs"><thead className="sticky top-0 z-10 bg-muted"><tr>{["Select", "Row", "Campaign", "KPI", "Seat", "Goal", "W1", "W2", "W3", "W4", "W5", "MTD", "Achievement", "RR", "RR Achievement", "Report Date", "Status", "Action", "Issues", "Details"].map(label => <th key={label} className="p-2">{label === "Select" ? <label className="flex items-center gap-2 whitespace-nowrap"><Checkbox aria-label="Select All importable matching rows" checked={selectedFilteredCount > 0 && selectedFilteredCount < selectableRows.length ? "indeterminate" : selectableRows.length > 0 && selectedFilteredCount === selectableRows.length} disabled={selectionDisabled || !selectableRows.length} onCheckedChange={checked => selectAllFiltered(checked === true)} />Select All</label> : label}</th>)}</tr></thead><tbody>{visible.map(row => <SmartRow key={row.rowKey} row={row} selected={selected.has(row.rowKey)} disabled={readOnly || Boolean(busy) || dirty} onSelect={() => toggle(row)} expanded={expanded === row.rowKey} raw={expanded === row.rowKey ? raw : null} onExpand={() => viewRaw(row)} />)}</tbody></table>{!filtered.length && <p className="p-6 text-sm text-muted-foreground">No rows match. Check sheet selection and column mappings.</p>}</div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{filtered.length} matching rows · {selected.size} selected</span><div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-sm">{page} / {Math.max(1, Math.ceil(filtered.length / 50))}</span><Button variant="outline" size="sm" disabled={page * 50 >= filtered.length} onClick={() => setPage(page + 1)}>Next</Button></div></div>
      {!readOnly && <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2"><Button variant="outline" disabled={Boolean(busy) || dirty} onClick={() => setSelected(new Set(preview.records.filter(row => row.action !== "BLOCK" && row.action !== "SKIP").map(row => row.rowKey)))}>Select valid records</Button><Button variant="outline" disabled={Boolean(busy)} onClick={() => setSelected(new Set())}>Clear selection</Button></div><div className="flex gap-2"><Button variant="outline" disabled={Boolean(busy)} onClick={cancel}>Cancel import</Button><Button disabled={Boolean(busy) || dirty || (!selected.size && !duplicatesOnly)} onClick={() => setConfirm(true)}>{duplicatesOnly ? "Complete import — skip duplicates" : `Import selected records (${selected.size})`}</Button></div></div>}
      {dirty && <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">Mappings changed. Apply and revalidate before confirming.</p>}
      </CardContent></Card>
    </>}
    <ConfirmDialog open={confirm} title="Confirm import" description={`${selected.size} selected rows will be committed transactionally. Duplicates are skipped, older reports are kept in history, and unavailable fields preserve existing valid values. Source data and all changes remain auditable.`} actionLabel="Confirm import" isLoading={Boolean(busy)} onConfirm={commit} onCancel={() => { if (!busy) setConfirm(false); }} />
  </div>;
}

function SmartRow({ row, selected, disabled, onSelect, expanded, raw, onExpand }: { row: Candidate; selected: boolean; disabled: boolean; onSelect: () => void; expanded: boolean; raw: Record<string, unknown> | null; onExpand: () => void }) {
  const percent = row.config?.isPercentage;
  return <><tr className="border-t align-top"><td className="p-2"><input aria-label={`Select ${row.sourceSheet} row ${row.sourceRow}`} type="checkbox" title={row.action === "BLOCK" ? row.issues.filter(issue => issue.level === "ERROR").map(issue => issue.message).join(" ") : row.action === "SKIP" ? "This row is skipped and retained in history." : undefined} disabled={disabled || row.action === "BLOCK" || row.action === "SKIP"} checked={selected} onChange={onSelect} /></td><td className="p-2">{row.sourceSheet}<br />{row.sourceRow}</td><td className="p-2 font-medium">{row.campaignName ?? row.campaignSource}</td><td className="p-2">{row.goalLabel}</td><td className="p-2 tabular-nums">{number(row.source.seat)}</td><td className="p-2 tabular-nums">{number(row.source.target, percent)}</td>{(["week1", "week2", "week3", "week4", "week5", "mtd"] as const).map(field => <td key={field} className="p-2 tabular-nums">{number(row.source[field], percent)}{field === "mtd" && row.source[field] == null && row.calculated.mtd != null && <span className="block text-muted-foreground">Calc: {number(row.calculated.mtd, percent)}</span>}</td>)}<td className="p-2 tabular-nums">{number(row.source.achievement, true)}</td><td className="p-2 tabular-nums">{number(row.source.runRate, percent)}</td><td className="p-2 tabular-nums">{number(row.source.rrAchievement, true)}</td><td className="p-2">{row.reportDate ?? `${row.reportMonth ?? "?"}/${row.reportYear ?? "?"}`}<span className="block text-muted-foreground">{row.reportStatus}</span></td><td className="p-2"><span className={`rounded-full px-2 py-1 ${statusClasses[row.status]}`}>{row.status}</span></td><td className="p-2">{row.action}</td><td className="max-w-64 p-2"><span className="line-clamp-3">{row.issues.map(issue => issue.message).join(" ") || "Valid"}</span></td><td className="p-2"><Button variant="outline" size="sm" onClick={onExpand}>{expanded ? "Close" : "Raw / changes"}</Button></td></tr>{expanded && <tr className="border-t bg-muted/20"><td colSpan={20} className="p-4"><div className="grid gap-4 lg:grid-cols-3"><div><h4 className="font-semibold">Field changes</h4>{row.changes.length ? row.changes.map(change => <p key={change.field} className="mt-1">{change.field}: {JSON.stringify(change.oldValue)} → {JSON.stringify(change.newValue)}</p>) : <p className="mt-2 text-muted-foreground">No existing field differences.</p>}<h4 className="mt-4 font-semibold">Issues</h4>{row.issues.map((issue, index) => <p key={index} className="mt-1">{issue.code}: {issue.message}</p>)}</div><div><h4 className="font-semibold">Normalized / calculated data</h4><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border p-3">{JSON.stringify({ source: row.source, calculated: row.calculated, currentValues: row.values, availability: row.availability }, null, 2)}</pre></div><div><h4 className="font-semibold">Raw source cells</h4><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border p-3">{raw ? JSON.stringify(raw.rawPayload, null, 2) : "Loading source cells…"}</pre></div></div></td></tr>}</>;
}
