import { createHash } from "crypto";
import * as XLSX from "xlsx";
import { identifyHeader } from "./headers";
import { cellText, detectPeriod, nonEmpty, parseReportDate } from "./normalization";
import type { Inspection, RawCell, RawRow, Sheet } from "./types";
import { encryptedOffice, featureInventory, inspectZip } from "./archive";
import { discoverRegions, sourceDigest, xmlCells } from "./discovery";

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_CELLS = 250_000;
const MAX_ROWS = 50_000;
const MAX_COLUMNS = 1_000;
const MIME: Record<string, Set<string>> = {
  xlsx: new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/octet-stream", ""]),
  xls: new Set(["application/vnd.ms-excel", "application/octet-stream", ""]),
  csv: new Set(["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream", ""]),
};
export async function readUpload(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!MIME[extension]) throw new Error("Only .xlsx, .xls, and .csv files are supported.");
  if (!file.size || file.size > MAX_FILE_SIZE) throw new Error("Choose a file between 1 byte and 10 MB.");
  if (!MIME[extension].has(file.type.toLowerCase())) throw new Error("File type does not match a supported Excel/CSV MIME type.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const zip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const ole = buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const encrypted = ole && encryptedOffice(buffer);
  if ((extension === "xlsx" && !zip && !encrypted) || (extension === "xls" && !ole) || (extension === "csv" && (zip || ole || buffer.includes(0)))) throw new Error("File contents do not match its extension.");
  if (extension === "xlsx" && !encrypted) inspectZip(buffer);
  return { buffer, extension, encrypted, fileName: file.name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f]/g, "_").slice(0, 255) };
}
function rawCell(sheet: XLSX.WorkSheet, row: number, column: number): RawCell {
  const address = XLSX.utils.encode_cell({ r: row, c: column });
  const cell = sheet[address] as XLSX.CellObject | undefined;
  const metadata: Record<string, unknown> = {};
  if (cell) for (const [key, value] of Object.entries(cell)) if (!["t", "v", "w", "f", "z"].includes(key)) metadata[key] = value;
  return { address, type: cell?.t ?? null, value: cell?.v instanceof Date ? cell.v.toISOString() : cell?.v ?? null, formatted: cell?.w ?? null, formula: cell?.f ?? null, numberFormat: typeof cell?.z === "string" ? cell.z : null, ...(Object.keys(metadata).length ? { metadata } : {}) };
}
export function parseFile(buffer: Buffer, fileName: string, fileType: string): { inspection: Inspection; rows: RawRow[] } {
  if (buffer.length > MAX_FILE_SIZE) throw new Error("File exceeds the 10 MB inspection limit.");
  if (encryptedOffice(buffer)) throw new Error("PASSWORD_REQUIRED: Upload an authorized decrypted copy.");
  const archive = fileType === "xlsx" ? inspectZip(buffer) : new Map<string, Buffer>();
  const sourceXml = archive.size ? xmlCells(archive) : new Map<string, Map<string, string>>();
  // Formulas/macros are captured as source text; XLSX does not execute them.
  const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: true, cellNF: true, cellText: true, cellDates: false, sheetStubs: true, raw: fileType === "csv" });
  if (!workbook.SheetNames.length) throw new Error("The file contains no worksheets.");
  const sheets: Sheet[] = [];
  const rows: RawRow[] = [];
  const reportingPeriods = new Map<string, { year: number; month: number }>();
  let inspectedCells = 0;
  let nonEmptyCells = 0;
  for (const [sheetIndex, name] of workbook.SheetNames.entries()) {
    const sheet = workbook.Sheets[name];
    const addresses = Object.keys(sheet).filter(key => /^[A-Z]+\d+$/.test(key));
    let end = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]).e : { r: -1, c: -1 };
    for (const address of addresses) {
      const pos = XLSX.utils.decode_cell(address);
      end = { r: Math.max(end.r, pos.r), c: Math.max(end.c, pos.c) };
    }
    const rowCount = end.r + 1;
    const columnCount = end.c + 1;
    inspectedCells += rowCount * columnCount;
    if (rowCount > MAX_ROWS || columnCount > MAX_COLUMNS || inspectedCells > MAX_CELLS) throw new Error("Workbook exceeds the safe inspection limit (50,000 rows, 1,000 columns per sheet, or 250,000 total cells). No data was truncated. Split the workbook and try again.");
    const sheetRows: RawRow[] = [];
    let count = 0;
    let headerIndex: number | null = null;
    let score = 0;
    for (let row = 0; row < rowCount; row++) {
      const cells = Array.from({ length: columnCount }, (_, column) => rawCell(sheet, row, column));
      for (const cell of cells) {
        cell.metadata = { ...cell.metadata, date1904: Boolean(workbook.Workbook?.WBProps?.date1904) };
        const xml = sourceXml.get(name)?.get(cell.address);
        if (xml) cell.metadata.sourceXml = xml;
      }
      count += cells.filter(nonEmpty).length;
      const fields = new Set(cells.map(cell => identifyHeader(cellText(cell))).filter(Boolean));
      const candidateScore = fields.size;
      if (fields.has("campaign") && candidateScore >= 2 && candidateScore > score) { headerIndex = row; score = candidateScore; }
      for (const cell of cells) {
        const date = cell.type === "d" || /[dy]/i.test(cell.numberFormat ?? "") || /\bas of\b|\b20\d{2}\b/i.test(cellText(cell)) ? parseReportDate(cell) : null;
        if (date?.date) reportingPeriods.set(date.date.slice(0, 7), { year: Number(date.date.slice(0, 4)), month: Number(date.date.slice(5, 7)) });
      }
      sheetRows.push({ sourceSheet: name, sourceRow: row + 1, cells });
    }
    const headers = Array.from({ length: columnCount }, (_, index) => {
      const header = headerIndex == null ? "" : cellText(sheetRows[headerIndex].cells[index]);
      return { index, letter: XLSX.utils.encode_col(index), header: header || `Unnamed ${XLSX.utils.encode_col(index)}`, field: headerIndex == null ? null : identifyHeader(header), populatedRows: sheetRows.filter(row => (headerIndex == null || row.sourceRow > headerIndex + 1) && nonEmpty(row.cells[index])).length };
    });
    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sheet)) if (key.startsWith("!")) metadata[key] = value;
    const warnings = headerIndex == null ? ["No recognizable campaign header. All cells are preserved; map columns to process this sheet."] : [];
    const duplicateFields = headers.filter(header => header.field && headers.filter(other => other.field === header.field).length > 1);
    if (duplicateFields.length) warnings.push("Multiple columns map to the same field. Review column mappings before importing.");
    const regions = discoverRegions(sheetRows, columnCount, name, sheet["!merges"]);
    const first = regions.find(region => region.kind === "OPERATIONAL");
    if (regions.some(region => region.ambiguous && region.kind === "OPERATIONAL")) warnings.push("Side-by-side campaign tables are ambiguous. Preserve raw cells and review a single table mapping before normalization.");
    metadata.date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
    const visibility = workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden ?? 0;
    sheets.push({ name, id: JSON.stringify([sheetIndex, name]), index: sheetIndex, visibility: visibility === 2 ? "VERY_HIDDEN" : visibility === 1 ? "HIDDEN" : "VISIBLE", usedRange: sheet["!ref"] ?? null, regions, sourceDigest: sourceDigest(sheetRows), rows: rowCount, columns: columnCount, headerRow: first?.headerRows.at(-1) ?? (headerIndex == null ? null : headerIndex + 1), detected: Boolean(first), headers: first?.headers ?? headers, warnings, nonEmptyCells: count, metadata });
    rows.push(...sheetRows);
    // Verify capture independently against actual workbook cell addresses.
    const sourceCount = addresses.filter(address => {
      const position = XLSX.utils.decode_cell(address);
      return nonEmpty(rawCell(sheet, position.r, position.c));
    }).length;
    if (count !== sourceCount) throw new Error(`Source coverage verification failed for sheet ${name}. Import blocked.`);
    const xml = sourceXml.get(name);
    if (xml) for (const address of xml.keys()) {
      const pos = XLSX.utils.decode_cell(address);
      const cell = sheetRows[pos.r]?.cells[pos.c];
      if (!cell?.metadata?.sourceXml) throw new Error(`OOXML source coverage verification failed at ${name}!${address}.`);
    }
    nonEmptyCells += sourceCount;
  }
  // Filename suggestions are never accepted as verified reporting periods.
  for (const row of rows) for (const cell of row.cells) {
    const period = detectPeriod(cellText(cell));
    if (period.month && period.year) reportingPeriods.set(`${period.year}-${String(period.month).padStart(2, "0")}`, { month: period.month, year: period.year });
  }
  const capturedCells = rows.reduce((total, row) => total + row.cells.filter(nonEmpty).length, 0);
  if (capturedCells !== nonEmptyCells) throw new Error("Source coverage verification failed. Import blocked.");
  return { rows, inspection: { fileName, fileType, fileHash: createHash("sha256").update(buffer).digest("hex"), sheets, nonEmptyCells, capturedCells, coveragePassed: capturedCells === nonEmptyCells, encryptionStatus: "NONE", fileSize: buffer.length, scope: "All worksheet values, formula expressions and available caches; original workbook preserves unsupported objects. Formula caches are unverified.", features: [{ name: "Worksheet cells, formulas, formats, merges, comments and hyperlinks", scope: "STRUCTURED", count: capturedCells }, ...featureInventory([...archive.keys()])], metadata: { properties: workbook.Props ?? {}, customProperties: workbook.Custprops ?? {}, workbook: workbook.Workbook ?? {}, archiveParts: [...archive.keys()] }, warnings: fileType === "xls" ? ["Legacy XLS feature inventory is limited; all unsupported objects remain in the original file."] : [], reportingPeriods: [...reportingPeriods.values()] } };
}
