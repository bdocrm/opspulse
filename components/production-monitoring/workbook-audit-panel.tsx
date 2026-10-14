"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EncryptedWorkbookUnlock } from "./encrypted-workbook-unlock";
import { FIELDS, type Preview, type ReviewOptions } from "@/lib/smart-import/types";

const endpoint = "/api/production-monitoring/smart-import";
type Template = { id: string; name: string; version: number };
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Import request failed.");
  return data;
}
export function WorkbookAuditPanel({ preview, options, dirty, disabled, onChange, onReceive }: { preview: Preview; options: ReviewOptions | null; dirty: boolean; disabled: boolean; onChange: (options: ReviewOptions) => void; onReceive: (preview: Preview) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  const reconciliation = preview.reconciliation;
  const encrypted = ["PASSWORD_REQUIRED", "INVALID_PASSWORD", "UNSUPPORTED_ENCRYPTION", "DECRYPTING", "EXTRACTION_FAILED"].includes(preview.status);
  const editable = preview.status === "READY" && !disabled && !busy;
  return <Card><CardHeader><CardTitle>Workbook preservation and reconciliation</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm">Raw extraction: <strong>{reconciliation?.rawStatus ?? "UNVERIFIED"}</strong> · Business import: <strong>{preview.status}</strong></p>
    {preview.stages && <p className="text-sm text-muted-foreground">Access: {preview.stages.access} ? Extraction: {preview.stages.extraction} ? Business: {preview.stages.business}</p>}
    {reconciliation && !encrypted && <><div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
      <p>Source cells: {reconciliation.sourceNonEmptyCells}</p><p>Stored cells: {reconciliation.persistedRawNonEmptyCells}</p><p>Source rows: {reconciliation.sourceRows}</p><p>Stored rows: {reconciliation.persistedRows}</p>
      <p>Regions: {reconciliation.regions}</p><p>Detail records: {reconciliation.parsedRecords}</p><p>Unmapped detail fields: {reconciliation.unmappedFields}</p><p>Committed: {reconciliation.committedRecords}</p>
    </div><p className="text-xs text-muted-foreground">{preview.inspection.scope ?? "Original workbook retained. Extraction has not been verified."}</p></>}
    {encrypted && <p className="text-sm text-muted-foreground">Worksheets, rows, columns, and source-cell counts: Pending until extraction succeeds.</p>}
    <a className="inline-block text-sm text-primary underline" href={`${endpoint}/${preview.id}?format=report`}>Download reconciliation and record report</a>
    {preview.parentImportId && <a className="ml-4 text-sm text-primary underline" href={`?batch=${encodeURIComponent(preview.parentImportId)}`}>View retained encrypted original</a>}
    {encrypted && <EncryptedWorkbookUnlock key={preview.id} preview={preview} disabled={disabled} onReceive={onReceive} />}
    {Boolean(preview.events?.length) && <details><summary className="cursor-pointer text-sm font-medium">Workbook processing audit</summary><ul className="mt-3 space-y-2 text-xs">{preview.events?.map((event, index) => <li key={index}>{new Date(event.createdAt).toLocaleString("en-US", { timeZone: "Asia/Manila" })} · {event.code}: {event.message}{event.actorId && ` · Actor ${event.actorId}`}</li>)}</ul></details>}
    {preview.inspection.features?.length ? <details><summary className="cursor-pointer text-sm font-medium">Workbook feature inventory</summary><table className="mt-3 w-full text-left text-sm"><thead><tr><th>Feature</th><th>Preservation scope</th><th>Count</th></tr></thead><tbody>{preview.inspection.features.map(feature => <tr key={feature.name} className="border-t"><td className="py-2">{feature.name}</td><td>{feature.scope}</td><td>{feature.count}</td></tr>)}</tbody></table><p className="mt-2 text-xs text-muted-foreground">Archive objects remain recoverable in the original file. Macros, external connections and formulas are never executed.</p></details> : null}
    {preview.inspection.sheets.map(sheet => <details key={sheet.name} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">{sheet.name} · {sheet.visibility ?? "Visibility unavailable"} · {sheet.usedRange ?? "Empty"} · {sheet.regions?.length ?? 0} regions · {reconciliation?.sheets.find(row => row.name === sheet.name)?.passed ? "Verified" : "Unverified"}</summary>
      {sheet.regions?.map(region => <div key={region.id} className="mt-3 border-t pt-3"><p className="text-xs">{region.kind} · Rows {region.startRow}–{region.endRow} · Headers {region.headerRows.join(", ") || "None"}{region.ambiguous && " · Requires review"}</p>
        {region.kind === "OPERATIONAL" && options && <div className="mt-2 grid gap-2 sm:grid-cols-3">{region.headers.map(column => <label key={column.index} className="text-xs">{column.letter}: {column.header}<select aria-label={`${sheet.name} region ${region.startRow} ${column.letter} mapping`} className="mt-1 h-9 w-full rounded-md border bg-background px-2" disabled={!editable} value={options.regionMappings?.[region.id]?.[String(column.index)] ?? options.columnMappings[sheet.name]?.[String(column.index)] ?? column.field ?? "metadata"} onChange={event => onChange({ ...options, regionMappings: { ...options.regionMappings, [region.id]: { ...options.regionMappings?.[region.id], [column.index]: event.target.value as typeof FIELDS[number] | "metadata" } } })}><option value="metadata">Preserve supplemental field</option>{FIELDS.map(field => <option key={field}>{field}</option>)}</select></label>)}</div>}
      </div>)}
    </details>)}
    {!encrypted && <details><summary className="cursor-pointer text-sm font-medium">Versioned mapping templates</summary><div className="mt-3 flex flex-wrap gap-2"><Input aria-label="Mapping template name" placeholder="Template name" className="max-w-xs" value={name} onChange={event => setName(event.target.value)} /><Button variant="outline" disabled={!editable || dirty || !name.trim()} onClick={() => void run(async () => { const saved = await call<Template>(`${endpoint}/templates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: preview.id, name }) }); setMessage(`Saved ${saved.name} version ${saved.version}.`); })}>Save new version</Button><Button variant="outline" disabled={busy || disabled} onClick={() => void run(async () => setTemplates(await call<Template[]>(`${endpoint}/templates`)))}>Load saved templates</Button></div><div className="mt-2 space-y-2">{templates.map(template => <Button className="mr-2" key={template.id} size="sm" variant="outline" disabled={!editable} onClick={() => void run(async () => onReceive(await call<Preview>(`${endpoint}/${preview.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "template", templateId: template.id }) })))}>{template.name} v{template.version}</Button>)}</div><p className="mt-2 text-xs text-muted-foreground">Templates retain layout mappings. Reporting periods, row decisions and KPI approvals require review for each import.</p></details>}
    {busy && <p role="status" className="text-sm">Processing workbook request…</p>}{message && <p role="status" className="text-sm">{message}</p>}
  </CardContent></Card>;
}
