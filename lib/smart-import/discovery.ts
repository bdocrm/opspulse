import { createHash } from "crypto";
import * as XLSX from "xlsx";
import { identifyHeader } from "./headers";
import { cellText, nonEmpty } from "./normalization";
import type { Column, RawRow, Region } from "./types";

export function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
export function sourceHasher() {
  const digest = createHash("sha256").update("[");
  let first = true;
  return { add(row: RawRow) { if (!first) digest.update(","); first = false; digest.update(JSON.stringify(canonical(row))); }, finish() { return digest.update("]").digest("hex"); } };
}
// Preserve the existing digest format without allocating a canonical copy and
// one giant JSON string for the whole worksheet.
export function sourceDigest(rows: RawRow[]) { const digest = sourceHasher(); rows.forEach(row => digest.add(row)); return digest.finish(); }
export function discoverRegions(rows: RawRow[], columns: number, sheetName: string, merges: XLSX.Range[] = []): Region[] {
  const headerCandidates: { row: number; headers: Column[]; multi: boolean; ambiguous: boolean }[] = [];
  const getText = (row: number, column: number) => {
    const direct = rows[row]?.cells[column];
    if (direct && nonEmpty(direct)) return cellText(direct);
    const merge = merges.find(range => range.s.r <= row && range.e.r >= row && range.s.c <= column && range.e.c >= column);
    return merge ? cellText(rows[merge.s.r]?.cells[merge.s.c]) : "";
  };
  for (let index = 0; index < rows.length; index++) {
    const direct = Array.from({ length: columns }, (_, column) => getText(index, column));
    // Only combine adjacent header bands if the previous row contains a merged header.
    const multi = index > 0 && merges.some(range => range.s.r === index - 1 && range.e.r >= index)
      || index > 0 && direct.some((label, column) => !identifyHeader(label) && identifyHeader([getText(index - 1, column), label].filter(Boolean).join(" ")) !== null && Boolean(label));
    const labels = multi ? direct.map((label, column) => identifyHeader(label) ? label : [getText(index - 1, column), label].filter(Boolean).join(" ")) : direct;
    const fields = labels.map(identifyHeader);
    if (!fields.includes("campaign") || new Set(fields.filter(Boolean)).size < 2) continue;
    // Headerless status fields are suggestions only, based on source content.
    fields.forEach((field, column) => {
      if (field || labels[column]) return;
      const values = rows.slice(index + 1).map(row => cellText(row.cells[column])).filter(Boolean);
      if (values.length && values.every(value => /^(?:final(?: unofficial)?|unofficial|preliminary|pending)$/i.test(value))) fields[column] = "sourceRemarks";
    });
    const headers = labels.map((header, column) => ({ index: column, letter: XLSX.utils.encode_col(column), header: header || `Unnamed ${XLSX.utils.encode_col(column)}`, field: fields[column], populatedRows: 0 }));
    if (multi && headerCandidates.at(-1)?.row === index) headerCandidates.pop();
    headerCandidates.push({ row: index + 1, headers, multi, ambiguous: fields.filter(field => field === "campaign").length > 1 });
  }
  const regions: Region[] = [];
  if (!headerCandidates.length) return rows.length ? [{ id: JSON.stringify([sheetName, 1, "supplemental"]), kind: "SUPPLEMENTAL", startRow: 1, endRow: rows.length, startColumn: 1, endColumn: columns, headerRows: [], headers: [], ambiguous: true }] : [];
  const firstStart = headerCandidates[0].row - (headerCandidates[0].multi ? 1 : 0);
  if (firstStart > 1) regions.push({ id: JSON.stringify([sheetName, 1, "titles"]), kind: "SUPPLEMENTAL", startRow: 1, endRow: firstStart - 1, startColumn: 1, endColumn: columns, headerRows: [], headers: [], ambiguous: false });
  headerCandidates.forEach((candidate, index) => {
    const endRow = index + 1 < headerCandidates.length ? headerCandidates[index + 1].row - (headerCandidates[index + 1].multi ? 2 : 1) : rows.length;
    candidate.headers.forEach(header => { header.populatedRows = rows.filter(row => row.sourceRow > candidate.row && row.sourceRow <= endRow && nonEmpty(row.cells[header.index])).length; });
    regions.push({ id: JSON.stringify([sheetName, candidate.row, "table"]), kind: "OPERATIONAL", startRow: candidate.row - (candidate.multi ? 1 : 0), endRow, startColumn: 1, endColumn: columns, headerRows: candidate.multi ? [candidate.row - 1, candidate.row] : [candidate.row], headers: candidate.headers, ambiguous: candidate.ambiguous });
  });
  return regions;
}

const decode = (text: string) => text.replace(/&(?:amp|lt|gt|quot|apos);|&#(?:x[\da-f]+|\d+);/gi, entity => {
  const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
  return named[entity] ?? String.fromCodePoint(entity[2].toLowerCase() === "x" ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1)));
});
const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1], decode(match[2])]));
// Independent coordinate census from OOXML before normalization; retain lexical
// cell XML as well, including formulas with missing caches and rich inline text.
export function xmlCells(files: Map<string, Buffer>): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  let serializedCells = 0;
  const workbook = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const relationships = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const targets = new Map([...relationships.matchAll(/<(?:\w+:)?Relationship\b[^>]*\/?\s*>/g)].map(match => { const value = attrs(match[0]); return [value.Id, value.Target]; }));
  for (const match of workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*\/?\s*>/g)) {
    const values = attrs(match[0]);
    const target = targets.get(values["r:id"]);
    if (!target) throw new Error("Workbook sheet relationship is missing.");
    const segments = (target.startsWith("/") ? target.slice(1) : `xl/${target}`).split("/");
    const parts: string[] = [];
    for (const segment of segments) { if (segment === "..") parts.pop(); else if (segment !== ".") parts.push(segment); }
    const content = files.get(parts.join("/"));
    if (!content) throw new Error("Workbook sheet XML is missing.");
    const xml = content.toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsafe XML declarations in workbook.");
    const cells = new Map<string, string>();
    for (const cell of xml.matchAll(/<(?:\w+:)?c\b[^>]*(?:\/>|>[\s\S]*?<\/(?:\w+:)?c\s*>)/g)) {
      if (++serializedCells > 1200000) throw new Error("Workbook exceeds the 1,200,000 serialized cell inspection limit. No data was truncated.");
      const address = attrs(cell[0].slice(0, cell[0].indexOf(">") + 1)).r;
      if (!address || !/^[A-Z]+[1-9]\d*$/.test(address) || cells.has(address)) throw new Error("Ambiguous or duplicate worksheet cell coordinate.");
      const position = XLSX.utils.decode_cell(address);
      if (position.r >= 100000 || position.c >= 1000) throw new Error("Workbook exceeds coordinate inspection limits (100,000 rows or 1,000 columns). No data was truncated.");
      if (/<(?:\w+:)?(?:f|v|is)\b/.test(cell[0])) cells.set(address, cell[0]);
    }
    result.set(values.name, cells);
  }
  return result;
}
