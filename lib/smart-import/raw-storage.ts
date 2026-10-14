import * as XLSX from "xlsx";
import { deflateRawSync, inflateRawSync } from "zlib";
import type { RawCell, RawRow } from "./types";

function emptyCell(row: number, column: number): RawCell {
  return { address: XLSX.utils.encode_cell({ r: row - 1, c: column }), type: null, value: null, formatted: null, formula: null, numberFormat: null };
}
// Only implicit, completely empty cells can be encoded as the row's width.
// Explicit stubs, formats, comments, XML, formulas and values remain intact.
export function packRawRow(row: RawRow) {
  return { sourceSheet: row.sourceSheet, sourceRow: row.sourceRow, encoding: "IMPLICIT_BLANKS_V1", width: row.cells.length,
    cells: row.cells.filter(cell => cell.type !== null || cell.value !== null || cell.formatted !== null || cell.formula !== null || cell.numberFormat !== null || cell.metadata !== undefined) };
}
export function compressRawRow(row: RawRow) {
  return { encoding: "DEFLATE_RAW_ROW_V1", data: deflateRawSync(Buffer.from(JSON.stringify(packRawRow(row))), { level: 1 }).toString("base64") };
}
export function unpackRawRow(input: unknown): RawRow {
  const envelope = input as { encoding?: string; data?: string };
  if (envelope.encoding === "DEFLATE_RAW_ROW_V1") {
    if (typeof envelope.data !== "string") throw new Error("Stored source compression is invalid.");
    input = JSON.parse(inflateRawSync(Buffer.from(envelope.data, "base64"), { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8"));
  }
  const stored = input as RawRow & { encoding?: string; width?: number };
  if (stored.encoding !== "IMPLICIT_BLANKS_V1") return stored;
  if (!Number.isInteger(stored.width) || stored.width! < 0 || stored.width! > 1000) throw new Error("Stored source width is invalid.");
  const cells = Array.from({ length: stored.width! }, (_, column) => emptyCell(stored.sourceRow, column));
  const seen = new Set<number>();
  for (const cell of stored.cells) {
    const position = XLSX.utils.decode_cell(cell.address);
    if (position.r !== stored.sourceRow - 1 || position.c >= cells.length || seen.has(position.c)) throw new Error("Stored source coordinates are invalid.");
    seen.add(position.c); cells[position.c] = cell;
  }
  return { sourceSheet: stored.sourceSheet, sourceRow: stored.sourceRow, cells };
}
