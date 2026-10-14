import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { canonical, sourceDigest } from "./discovery";
import { createHash } from "crypto";
import { compressRawRow, packRawRow, unpackRawRow } from "./raw-storage";
import { parseFile } from "./parser";

describe("large workbook source preservation", () => {
  it("retains the inflated declared dimension while extracting every real cell", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Campaign", "MTD"], ["BPI", 42]]);
    sheet["!ref"] = "A1:XEQ68";
    XLSX.utils.book_append_sheet(book, sheet, "DISPOSITION");
    const parsed = parseFile(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "inflated.xlsx", "xlsx");
    expect(parsed.inspection.sheets[0]).toMatchObject({ rows: 2, columns: 2, usedRange: "A1:XEQ68", nonEmptyCells: 4 });
    expect(parsed.rows[1].cells[1].value).toBe(42);
  });
  it("round-trips implicit blanks without losing styled stubs or cell metadata", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Campaign", null, "MTD"], ["BPI", null, 42]]);
    sheet.B2 = { t: "z", z: "0.00", c: [{ a: "Fixture", t: "Preserve this blank note" }] };
    XLSX.utils.book_append_sheet(book, sheet, "Data");
    const rows = parseFile(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "blanks.xlsx", "xlsx").rows;
    const encoded = rows.map(packRawRow);
    expect(encoded[0].cells.length).toBeLessThan(rows[0].cells.length);
    const restored = JSON.parse(JSON.stringify(encoded)).map(unpackRawRow);
    expect(restored).toEqual(rows);
    expect(sourceDigest(restored)).toBe(sourceDigest(rows));
    expect(sourceDigest(rows)).toBe(createHash("sha256").update(JSON.stringify(canonical(rows))).digest("hex"));
    expect(rows.map(compressRawRow).map(unpackRawRow)).toEqual(rows);
  });
  it("accepts actual source cells beyond row 50,000 without dropping gaps", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Source"]]);
    sheet.A81080 = { t: "n", v: 7 }; sheet["!ref"] = "A1:A81080";
    XLSX.utils.book_append_sheet(book, sheet, "Large supporting data");
    const parsed = parseFile(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "large.xlsx", "xlsx");
    expect(parsed.rows).toHaveLength(81080);
    expect(parsed.rows[81079].cells[0]).toMatchObject({ address: "A81080", value: 7 });
    expect(parsed.rows[50000].cells[0].value).toBeNull();
    expect(parsed.inspection.coveragePassed).toBe(true);
  });
});
