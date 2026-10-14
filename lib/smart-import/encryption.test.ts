import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { encryptedFixture, augustFixture } from "./fixtures";
import { decryptWorkbook } from "./decryption";
import { inspectEncryption } from "./encryption";
import { parseFile, readUpload } from "./parser";
import { reconcile } from "./reconciliation";

let agile: Buffer, standard: Buffer;
beforeAll(() => { agile = encryptedFixture(); standard = encryptedFixture("fixture-only-password", augustFixture(), "standard"); });
describe("secure Office decryption", () => {
  it("detects encryption independently from sheet protection and password-to-modify", async () => {
    expect(inspectEncryption(agile)).toMatchObject({ supported: true, kind: "AGILE" });
    expect(inspectEncryption(standard)).toMatchObject({ supported: true, kind: "STANDARD" });
    const book = XLSX.read(augustFixture(), { type: "buffer" });
    book.Sheets.Sheet1["!protect"] = { password: "sheet-only", selectLockedCells: false };
    const plain = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const archive = XLSX.CFB.read(plain, { type: "buffer" });
    const workbookXml = archive.FileIndex[archive.FullPaths.findIndex((value: string) => value.endsWith("/xl/workbook.xml"))];
    workbookXml.content = Buffer.from(Buffer.from(workbookXml.content).toString("utf8").replace(/(<workbook[^>]*>)/, '$1<fileSharing readOnlyRecommended="1" reservationPassword="DAA7"/>'));
    const protectedOnly = Buffer.from(XLSX.CFB.write(archive, { type: "buffer", fileType: "zip" }));
    expect(await readUpload(new File([new Uint8Array(protectedOnly)], "sheet-protected.xlsx"))).toMatchObject({ encrypted: false });
    expect(parseFile(protectedOnly, "sheet-protected.xlsx", "xlsx").inspection.coveragePassed).toBe(true);
  });
  it.each(["agile", "standard"])("decrypts %s without rewriting workbook bytes", async type => {
    const output = await decryptWorkbook(type === "agile" ? agile : standard, "fixture-only-password");
    expect(output.equals(augustFixture())).toBe(true);
    expect(reconcile(parseFile(output, "source.xlsx", "xlsx").inspection, parseFile(output, "source.xlsx", "xlsx").rows).passed).toBe(true);
  });
  it("verifies the independent msoffcrypto-tool known-output fixture", async () => {
    const input = readFileSync(path.resolve("lib/smart-import/test-fixtures/msoffcrypto-agile.xlsx"));
    const output = await decryptWorkbook(input, "Password1234_");
    expect(createHash("sha256").update(output).digest("hex")).toBe("4dd9dd0ccbfc7fb8769f1f3307830d3cc4c5042e32d619f4b2835fada89d13c6");
  });
  it.each(["wrong-fixture-password", "", " ", "x".repeat(256)])("rejects incorrect/blank/oversized passwords", async password => {
    await expect(decryptWorkbook(agile, password)).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
  });
  it("preserves every sheet, hidden state, formula/cache, errors, and source coordinates", async () => {
    const book = XLSX.read(augustFixture(), { type: "buffer", cellFormula: true });
    const notes = XLSX.utils.aoa_to_sheet([["Private supporting notes", true], ["Formula", 42]]);
    notes.B2 = { t: "n", v: 42, f: "6*7" };
    XLSX.utils.book_append_sheet(book, notes, "Hidden notes");
    book.Workbook = { ...book.Workbook, Sheets: [{ name: "Sheet1", Hidden: 0 }, { name: "Hidden notes", Hidden: 1 }] };
    const source = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const output = await decryptWorkbook(encryptedFixture("another-fixture-password", source), "another-fixture-password");
    const parsed = parseFile(output, "multi-sheet.xlsx", "xlsx");
    expect(parsed.inspection.sheets).toHaveLength(2);
    expect(parsed.inspection.sheets[1].visibility).toBe("HIDDEN");
    expect(parsed.rows.find(row => row.sourceSheet === "Hidden notes" && row.sourceRow === 2)?.cells[1]).toMatchObject({ address: "B2", formula: "6*7", value: 42 });
    expect(reconcile(parsed.inspection, parsed.rows).passed).toBe(true);
  });
  it("rejects unsupported algorithms before password processing", async () => {
    const container = XLSX.CFB.read(agile, { type: "buffer" });
    const info = (container.FileIndex as { name: string; content: Buffer }[]).find(entry => entry.name === "EncryptionInfo")!;
    info.content.writeUInt16LE(3, 2);
    const unsupported = Buffer.from(XLSX.CFB.write(container, { type: "buffer" }));
    expect(inspectEncryption(unsupported)).toMatchObject({ encrypted: true, supported: false });
    await expect(decryptWorkbook(unsupported, "fixture-only-password")).rejects.toMatchObject({ code: "UNSUPPORTED_ENCRYPTION" });
  });
  it("detects corrupted encrypted content using Agile HMAC verification", async () => {
    const container = XLSX.CFB.read(agile, { type: "buffer" });
    const entry = (container.FileIndex as { name: string; content: Buffer }[]).find(entry => entry.name === "EncryptedPackage")!;
    entry.content[20] ^= 0xff;
    const corrupted = Buffer.from(XLSX.CFB.write(container, { type: "buffer" }));
    await expect(decryptWorkbook(corrupted, "fixture-only-password")).rejects.toMatchObject({ code: "CORRUPTED_WORKBOOK" });
  });
  it("bounds CPU work with worker termination and handles interrupted requests", async () => {
    await expect(decryptWorkbook(agile, "fixture-only-password", undefined, 1)).rejects.toMatchObject({ code: "PROCESSING_TIMEOUT" });
    const controller = new AbortController(); controller.abort();
    await expect(decryptWorkbook(agile, "fixture-only-password", controller.signal)).rejects.toMatchObject({ code: "REQUEST_INTERRUPTED" });
  });
  it("rejects forged payload sizes and excessive spin counts", () => {
    const container = XLSX.CFB.read(agile, { type: "buffer" });
    const entries = container.FileIndex as { name: string; content: Buffer }[];
    const info = entries.find(entry => entry.name === "EncryptionInfo")!;
    info.content = Buffer.from(info.content.toString("binary").replace('spinCount="100000"', 'spinCount="999999"'), "binary");
    expect(inspectEncryption(Buffer.from(XLSX.CFB.write(container, { type: "buffer" })))).toMatchObject({ supported: false });
    entries.find(entry => entry.name === "EncryptedPackage")!.content.writeBigUInt64LE(100000000n, 0);
    expect(() => inspectEncryption(Buffer.from(XLSX.CFB.write(container, { type: "buffer" })))).toThrow(/bounds/);
  });
});
