import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { importAccuracy } from "./accuracy";
import { parseFile } from "./parser";
import { reconcile } from "./reconciliation";
import type { Inspection } from "./types";

function parsed(type: "xlsx" | "xls" | "csv" = "xlsx") {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Source label", "Value"], ["LINE 1", 0], ["LINE 2", "50%"]]), "Source");
  return parseFile(XLSX.write(book, { type: "buffer", bookType: type }), `source.${type}`, type);
}

describe("import source accuracy", () => {
  it.each(["xlsx", "xls", "csv"] as const)("reports 100%% for exact %s contents without requiring campaign mappings", type => {
    const { inspection, rows } = parsed(type);
    expect(importAccuracy(inspection, reconcile(inspection, rows))).toMatchObject({ status: "VERIFIED", percent: 100, sourceCells: 6, storedCells: 6, sourceRows: 3, storedRows: 3, verifiedSheets: 1, totalSheets: 1 });
  });
  it("detects changed values even when the row and cell counts still match", () => {
    const { inspection, rows } = parsed();
    rows[1].cells[0].value = "Changed label";
    const result = importAccuracy(inspection, reconcile(inspection, rows));
    expect(result.storedCells).toBe(result.sourceCells);
    expect(result).toMatchObject({ status: "FAILED", percent: null, verifiedSheets: 0 });
  });
  it("does not invent a partial accuracy score for missing rows", () => {
    const { inspection, rows } = parsed();
    rows.pop();
    expect(importAccuracy(inspection, reconcile(inspection, rows))).toMatchObject({ status: "FAILED", percent: null, sourceRows: 3, storedRows: 2 });
  });
  it("rejects reordered coordinates even when all values were captured", () => {
    const { inspection, rows } = parsed();
    rows[1].cells[1].address = "B3";
    expect(importAccuracy(inspection, reconcile(inspection, rows))).toMatchObject({ status: "FAILED", percent: null });
  });
  it("keeps verification pending when only counts are available without source checksums", () => {
    const { inspection, rows } = parsed();
    delete inspection.sheets[0].sourceDigest;
    expect(importAccuracy(inspection, reconcile(inspection, rows))).toMatchObject({ status: "PENDING", percent: null, storedCells: 6, verifiedSheets: 0 });
  });
  it("shows pending rather than 100 percent before a password-protected file is extracted", () => {
    const inspection = { ...parsed().inspection, coveragePassed: false, sheets: [], nonEmptyCells: 0, encryptionStatus: "PASSWORD_REQUIRED" } as Inspection;
    expect(importAccuracy(inspection, reconcile(inspection, []))).toMatchObject({ status: "PENDING", percent: null, sourceCells: null, storedCells: null, totalSheets: null });
    expect(importAccuracy(parsed().inspection)).toMatchObject({ status: "PENDING", percent: null });
  });
  it("does not claim 100 percent for an empty workbook", () => {
    const inspection = { ...parsed().inspection, sheets: [], nonEmptyCells: 0, capturedCells: 0 };
    expect(importAccuracy(inspection, reconcile(inspection, []))).toMatchObject({ status: "NO_DATA", percent: null });
  });
  it("distinguishes faithfully copied source formula errors from import errors", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Excel error", 0]]);
    sheet.B1 = { t: "e", v: 7, f: "1/0" };
    XLSX.utils.book_append_sheet(book, sheet, "Formula");
    const { inspection, rows } = parseFile(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "formula.xlsx", "xlsx");
    expect(importAccuracy(inspection, reconcile(inspection, rows))).toMatchObject({ status: "VERIFIED", percent: 100 });
  });
});
