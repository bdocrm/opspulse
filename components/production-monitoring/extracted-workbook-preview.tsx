"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Preview, RawCell, RawRow, ReviewOptions } from "@/lib/smart-import/types";

function cellText(cell: RawCell) {
  const errors: Record<number, string> = { 0: "#NULL!", 7: "#DIV/0!", 15: "#VALUE!", 23: "#REF!", 29: "#NAME?", 36: "#NUM!", 42: "#N/A", 43: "#GETTING_DATA" };
  return cell.formatted ?? (cell.type === "e" ? errors[Number(cell.value)] ?? "#ERROR!" : cell.value == null ? "" : String(cell.value));
}

type Page = { total: number; page: number; rows: { sourceRow: number; rawPayload: RawRow }[] };
export function ExtractedWorkbookPreview({ preview, options, disabled, onChange }: { preview: Preview; options: ReviewOptions | null; disabled: boolean; onChange: (options: ReviewOptions) => void }) {
  const [sheetName, setSheetName] = useState(() => {
    const populated = preview.inspection.sheets.filter(sheet => sheet.nonEmptyCells > 0);
    return populated.find(sheet => sheet.detected)?.name ?? [...populated].sort((a, b) => Number(b.visibility === "VISIBLE") - Number(a.visibility === "VISIBLE") || b.nonEmptyCells - a.nonEmptyCells)[0]?.name ?? preview.inspection.sheets[0]?.name ?? "";
  });
  const [page, setPage] = useState(1);
  const [columnPage, setColumnPage] = useState(0);
  const [jump, setJump] = useState("1");
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formulas, setFormulas] = useState(false);
  const sheet = preview.inspection.sheets.find(sheet => sheet.name === sheetName);
  useEffect(() => {
    if (!sheetName) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    void fetch(`/api/production-monitoring/smart-import/${preview.id}?format=rows&sheet=${encodeURIComponent(sheetName)}&page=${page}`, { signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Worksheet preview could not be loaded."); if (active) setData(result); })
      .catch(error => { if (active) setError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [preview.id, sheetName, page]);
  const columns = sheet?.headers.slice(columnPage * 25, (columnPage + 1) * 25) ?? [];
  const total = data?.total ?? sheet?.rows ?? 0;
  const pages = Math.max(1, Math.ceil(total / 50));
  function chooseSheet(value: string) { setData(null); setSheetName(value); setPage(1); setColumnPage(0); setJump("1"); }
  function chooseHeader(row: number) {
    if (!options || !sheet) return;
    onChange({ ...options, selectedSheets: [...new Set([...options.selectedSheets, sheet.name])], headerRows: { ...options.headerRows, [sheet.name]: row } });
  }
  return <Card id="extracted-excel-preview"><CardHeader><CardTitle>Extracted Excel Preview</CardTitle><p className="text-sm text-muted-foreground">Browse the saved worksheet cells, including hidden sheets and supporting data. Campaign/KPI mapping and confirmation are required before business records are imported.</p></CardHeader><CardContent className="space-y-4">
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Preview worksheet<select aria-label="Preview worksheet" className="mt-1 block h-9 max-w-full rounded-md border bg-background px-2" value={sheetName} onChange={event => chooseSheet(event.target.value)}>{preview.inspection.sheets.map(sheet => <option key={sheet.name} value={sheet.name}>{sheet.name} · {sheet.visibility ?? "VISIBLE"} · {sheet.rows.toLocaleString()} rows</option>)}</select></label><label className="text-sm">Go to worksheet row<Input aria-label="Go to worksheet row" className="mt-1 w-36" type="number" min={1} max={Math.max(1, total)} value={jump} onChange={event => setJump(event.target.value)} /></label><Button variant="outline" disabled={loading || !Number.isInteger(Number(jump)) || Number(jump) < 1 || Number(jump) > total} onClick={() => setPage(Math.ceil(Number(jump) / 50))}>Go to row</Button><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={formulas} onChange={event => setFormulas(event.target.checked)} />Show formula expressions</label></div>
    <p className="text-sm">{sheetName} · {total.toLocaleString()} saved rows · {sheet?.columns ?? 0} columns · {sheet?.nonEmptyCells.toLocaleString() ?? 0} non-empty cells{options?.headerRows[sheetName] && ` · Selected header: row ${options.headerRows[sheetName]}`}</p>
    {loading && <p role="status" className="text-sm">Loading worksheet rows…</p>}{error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    {!loading && data && <div className="max-h-[60vh] overflow-auto rounded-lg border"><table aria-label="Extracted worksheet rows" className="w-full text-left text-xs"><thead className="sticky top-0 z-10 bg-muted"><tr><th className="p-2">Excel row</th>{columns.map(column => <th key={column.index} className="min-w-36 p-2">{column.letter}{!column.header.startsWith("Unnamed ") && <span className="block font-normal">{column.header}</span>}</th>)}{options && <th className="min-w-40 p-2">Header mapping</th>}</tr></thead><tbody>{data.rows.map(row => <tr key={row.sourceRow} className={`border-t ${row.sourceRow === (options?.headerRows[sheetName] ?? sheet?.headerRow) ? "bg-primary/10" : ""}`}><th className="p-2 align-top tabular-nums">{row.sourceRow}</th>{columns.map(column => { const cell = row.rawPayload.cells[column.index]; return <td key={column.index} className="max-w-80 whitespace-pre-wrap break-words p-2 align-top" title={`${cell.address}${cell.formula ? ` · =${cell.formula}` : ""}`}>{formulas && cell.formula ? `=${cell.formula}` : cell.type === "e" ? cellText(cell) : cell.formatted ?? (cell.value == null ? "" : String(cell.value))}</td>; })}{options && <td className="p-2 align-top"><Button size="sm" variant="outline" aria-label={`Use worksheet row ${row.sourceRow} as header`} disabled={disabled || !["READY", "STAGED"].includes(preview.status)} onClick={() => chooseHeader(row.sourceRow)}>Use as header</Button></td>}</tr>)}</tbody></table>{!data.rows.length && <p className="p-4 text-sm text-muted-foreground">This worksheet has no stored cell rows. Its original layout and objects remain in the source archive.</p>}</div>}
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => setPage(current => current - 1)}>Previous worksheet rows</Button><span className="text-xs">Page {page} / {pages}</span><Button variant="outline" size="sm" disabled={loading || page >= pages} onClick={() => setPage(current => current + 1)}>Next worksheet rows</Button></div>{(sheet?.columns ?? 0) > 25 && <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={columnPage <= 0} onClick={() => setColumnPage(current => current - 1)}>Previous columns</Button><span className="text-xs">Columns {columns[0]?.letter}–{columns.at(-1)?.letter}</span><Button variant="outline" size="sm" disabled={(columnPage + 1) * 25 >= (sheet?.columns ?? 0)} onClick={() => setColumnPage(current => current + 1)}>Next columns</Button></div>}</div>
    {!preview.records.length && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">Extraction succeeded. No campaign/KPI table was recognized automatically. Choose the correct worksheet and header row, review the column mappings below, then apply mappings and revalidate.</p>}
  </CardContent></Card>;
}
