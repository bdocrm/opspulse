import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { augustFixture, encryptedFixture } from "./fixtures";
import { parseFile, readUpload } from "./parser";
import { reconcile } from "./reconciliation";
import { buildCandidates, defaultOptions } from "./engine";
import { calculate } from "./calculation";
import { hash } from "./engine";
import { cellText, parseReportDate } from "./normalization";
import { featureInventory, inspectZip } from "./archive";
import type { Config, Numbers, RawCell, RawRow } from "./types";

function analyzed() { return parseFile(augustFixture(), "AUGUST PROD(1).xlsx", "xlsx"); }
function candidates(parsed = analyzed()) {
  const campaigns = ["RBSC", ...Array.from({ length: 29 }, (_, index) => `Campaign ${index + 3}`)].map(name => ({ id: name, name, aliases: [] }));
  return buildCandidates(parsed.rows, parsed.inspection, defaultOptions(parsed.inspection), { campaigns, configs: [], units: [], existing: [] }).candidates;
}
describe("August representative source reconciliation", () => {
  it("discovers row 3, accounts for 31 records, all 17 columns and both RBSC records", () => {
    const parsed = analyzed();
    expect(parsed.inspection.sheets[0]).toMatchObject({ headerRow: 3, rows: 34, columns: 17, usedRange: "A1:Q34" });
    const records = candidates(parsed);
    expect(records).toHaveLength(31);
    expect(parsed.inspection.reportingPeriods).toEqual([{ year: 2026, month: 8 }]);
    expect(records.find(record => record.sourceRow === 14)?.reportMonth).toBe(8);
    expect(records.filter(record => record.campaignSource === "RBSC")).toHaveLength(2);
    expect(records.every(record => record.sourceRegionId && record.sourceFields?.mtd && record.sourceFingerprint)).toBe(true);
    expect(parsed.rows[0].cells[0].value).toBe("August Production");
    expect(parsed.rows[1].cells[0].value).toBe("Reporting period: August 2026");
    expect(reconcile(parsed.inspection, parsed.rows, records).passed).toBe(true);
  });
  it("preserves headerless remarks, formulas, errors, formats and exact coordinates", () => {
    const parsed = analyzed();
    expect(parsed.rows[3].cells[16]).toMatchObject({ address: "Q4", value: "FINAL" });
    expect(parsed.rows[4].cells[16].value).toBe("Final unofficial");
    for (const address of ["P14", "L32", "M32", "L34", "M34"]) {
      const position = XLSX.utils.decode_cell(address);
      const cell = parsed.rows[position.r].cells[position.c];
      expect(cell.type).toBe("e");
      expect(cellText(cell)).toBe(address === "P14" ? "#REF!" : "#DIV/0!");
      expect(cell.metadata?.sourceXml).toContain(address);
    }
    expect(candidates(parsed)[0].sourceRemarks).toBe("FINAL");
    expect(candidates(parsed)[0].sourceFields?.sourceRemarks).toBe("Q4");
    expect(parsed.rows[3].cells[10].numberFormat).toContain("%");
    expect(parsed.rows[3].cells[3].numberFormat).toContain("PHP");
  });
  it("retains date-error records and does not synthesize figures from weekly observations", () => {
    const records = candidates();
    expect(records.find(record => record.sourceRow === 14)?.issues.some(issue => issue.code === "FORMULA_ERROR")).toBe(true);
    expect(records.every(record => record.calculationStatus === "NOT_CONFIGURED" && Object.keys(record.calculated).length === 0)).toBe(true);
    expect(records[0].source.mtd).toBe(99);
    expect(records[0].source.week3).toBeNull();
  });
  it("detects removed cells, altered values, swapped coordinates and missing regions' rows", () => {
    for (const mutate of [(rows: RawRow[]) => { rows[3].cells[16].value = null; rows[3].cells[16].formatted = null; }, (rows: RawRow[]) => { rows[3].cells[16].value = "Changed"; }, (rows: RawRow[]) => { rows[3].cells[16].address = "Q5"; }, (rows: RawRow[]) => { rows.splice(1, 1); }]) {
      const parsed = analyzed();
      const rows = structuredClone(parsed.rows);
      mutate(rows);
      expect(reconcile(parsed.inspection, rows).passed).toBe(false);
    }
  });
  it("survives JSONB object key reordering while checking complete source content", () => {
    const parsed = analyzed();
    const rows = JSON.parse(JSON.stringify(parsed.rows), (_, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value);
    expect(reconcile(parsed.inspection, rows).passed).toBe(true);
    const persistedConfig = { version: "test", createdAt: new Date("2026-10-14T00:00:00Z") };
    expect(hash(persistedConfig)).toBe(hash(JSON.parse(JSON.stringify(persistedConfig))));
  });
});

describe("workbook discovery and safe access", () => {
  it("processes differently ordered tables below title rows and discovers hidden auxiliary data", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Title"], [null, "CAMPAIGN", "GOAL TYPE", "MTD"], [null, "RBSC", "Count", 10], [], ["MTD", "GOAL TYPE", "CAMPAIGN"], [0.8, "Conversion Rate", "RBSC"]]), "Mixed");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Auxiliary notes", true]]), "Hidden");
    book.Workbook = { Sheets: [{ name: "Mixed", Hidden: 0 }, { name: "Hidden", Hidden: 2 }] };
    const parsed = parseFile(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "future.xlsx", "xlsx");
    expect(parsed.inspection.sheets[0].regions?.filter(region => region.kind === "OPERATIONAL")).toHaveLength(2);
    expect(parsed.inspection.sheets[1]).toMatchObject({ index: 1, visibility: "VERY_HIDDEN" });
    const records = buildCandidates(parsed.rows, parsed.inspection, { ...defaultOptions(parsed.inspection), fallbackMonth: 9, fallbackYear: 2026 }, { campaigns: [{ id: "r", name: "RBSC", aliases: [] }], configs: [], units: [], existing: [] }).candidates;
    expect(records.map(record => record.source.mtd)).toEqual([10, 0.8]);
    expect(new Set(records.map(record => record.sourceRegionId)).size).toBe(2);
    expect(reconcile(parsed.inspection, parsed.rows).passed).toBe(true);
  });
  it("retains merged header bands and propagates only their header identities", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["CAMPAIGN", "GOAL TYPE", "Week"], [null, null, "1"], ["RBSC", "Count", 4]]);
    sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }, { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } }];
    XLSX.utils.book_append_sheet(book, sheet, "Merged");
    const parsed = parseFile(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "merged.xlsx", "xlsx");
    expect(parsed.inspection.sheets[0].metadata["!merges"]).toHaveLength(2);
    expect(parsed.rows[1].cells[0].value).toBeNull();
    expect(parsed.inspection.sheets[0].regions?.find(region => region.kind === "OPERATIONAL")?.headerRows).toEqual([1, 2]);
    expect(parsed.inspection.sheets[0].headers[2].field).toBe("week1");
  });
  it("detects encrypted Office containers before extraction and rejects disguised workbooks", async () => {
    const buffer = encryptedFixture();
    expect(await readUpload(new File([new Uint8Array(buffer)], "protected.xlsx"))).toMatchObject({ encrypted: true });
    expect(() => parseFile(buffer, "protected.xlsx", "xlsx")).toThrow(/PASSWORD_REQUIRED/);
    await expect(readUpload(new File([new Uint8Array(augustFixture())], "fake.csv"))).rejects.toThrow(/extension/);
  });
  it("reports archive-only objects and validates actual ZIP integrity", () => {
    const features = featureInventory(["xl/charts/chart1.xml", "xl/media/image1.png", "xl/pivotTables/pivotTable1.xml", "xl/vbaProject.bin", "xl/externalLinks/externalLink1.xml", "xl/tables/table1.xml", "custom/data.xml"]);
    expect(features).toHaveLength(7);
    expect(features.find(feature => feature.name === "Macros")?.scope).toBe("SPECIAL_HANDLING");
    expect(features.find(feature => feature.name === "Other workbook parts")?.details).toEqual(["custom/data.xml"]);
    const corrupted = Buffer.from(augustFixture());
    corrupted[100] ^= 0xff;
    expect(() => inspectZip(corrupted)).toThrow();
  });
  it("handles both date systems without changing native source serials", () => {
    const serial = XLSX.SSF.parse_date_code(46254);
    expect(serial).toBeTruthy();
    const cell: RawCell = { address: "P4", type: "n", value: 44792, formula: null, formatted: null, numberFormat: "m/d/yyyy", metadata: { date1904: true } };
    const expected = XLSX.SSF.parse_date_code(44792, { date1904: true });
    expect(parseReportDate(cell).date).toBe(`${expected.y}-${String(expected.m).padStart(2, "0")}-${String(expected.d).padStart(2, "0")}`);
    expect(cell.value).toBe(44792);
    expect(parseReportDate({ ...cell, metadata: { date1904: false } }).date).not.toBe(parseReportDate(cell).date);
  });
  it("does not accept a filename as the reporting date or period", () => {
    const parsed = parseFile(Buffer.from("Campaign,GOAL TYPE,MTD\nRBSC,Count,1"), "August 2026.csv", "csv");
    expect(defaultOptions(parsed.inspection).fallbackMonth).toBeNull();
    expect(defaultOptions(parsed.inspection).fallbackYear).toBeNull();
  });
  it("requires review for ambiguous slash dates and preserves comments and hyperlinks", () => {
    const cell: RawCell = { address: "P4", type: "s", value: "08/09/2026", formula: null, formatted: null, numberFormat: null };
    expect(parseReportDate(cell)).toMatchObject({ date: null, invalid: true });
    expect(parseReportDate({ ...cell, value: "31/08/2026" }).date).toBe("2026-08-31");
    const book = XLSX.read(augustFixture(), { type: "buffer" });
    book.Sheets.Sheet1.Q4.c = [{ a: "Fixture", t: "Retained note" }];
    book.Sheets.Sheet1.Q4.l = { Target: "https://example.invalid/reference" };
    const parsed = parseFile(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "annotated.xlsx", "xlsx");
    expect(parsed.rows[3].cells[16].metadata?.c).toEqual(expect.arrayContaining([expect.objectContaining({ a: "Fixture", t: "Retained note" })]));
    expect(parsed.rows[3].cells[16].metadata?.l).toMatchObject({ Target: "https://example.invalid/reference" });
  });
  it("requires explicit approved weekly and goal calculation rules", () => {
    const record = candidates()[0];
    const source = { ...record.source, week3: 3 } as Numbers;
    const config = { ...record.config!, reviewed: true, calculationMethod: "SUM" } as Config;
    expect(calculate(source, { ...config, calculationRules: null }).calculated).toEqual({});
    expect(calculate(source, { ...config, calculationRules: { weeklySemantics: "CUMULATIVE", achievement: false, runRate: false } }).calculated).toEqual({});
    expect(calculate(source, { ...config, calculationRules: { weeklySemantics: "INCREMENTAL", achievement: false, runRate: false } }).calculated.mtd).toBe(15);
    expect(calculate(source, { ...config, calculationRules: { weeklySemantics: "INCREMENTAL", achievement: false, runRate: false } }).values.mtd).toBe(99);
  });
});
