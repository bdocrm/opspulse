import * as XLSX from "xlsx";

// Representative fixture only; these are not the inaccessible customer files.
export function augustFixture() {
  const workbook = XLSX.utils.book_new();
  const headers = ["CAMPAIGN", "SEAT", "GOAL TYPE", "GOAL", "W1", "W2", "W3", "W4", "W5", "MTD", "Achievement", "RR", "RR Achievement", "WDays", "Days Lapsed", "DATE", null];
  const rows = Array.from({ length: 31 }, (_, index) => [index < 2 ? "RBSC" : `Campaign ${index + 1}`, 10, index === 1 ? "Conversion Rate" : "Gross Transmittals", 100, 1, 2, null, 4, 5, 99, 0.99, 100, 1, 22, 20, "As of August 20, 2026", index % 2 ? "Final unofficial" : "FINAL"]);
  const sheet = XLSX.utils.aoa_to_sheet([["August Production"], ["Reporting period: August 2026"], headers, ...rows]);
  sheet.P14 = { t: "e", v: 23, f: "#REF!" };
  for (const address of ["L32", "M32", "L34", "M34"]) sheet[address] = { t: "e", v: 7, f: "1/0" };
  sheet.K4.z = "0.00%";
  sheet.D4.z = '"PHP" #,##0.00';
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
export function encryptedFixture() {
  // Container markers exercise detection only. No assertion of real decryption.
  const container = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(container, "EncryptionInfo", Buffer.from("representative encryption metadata"));
  XLSX.CFB.utils.cfb_add(container, "EncryptedPackage", Buffer.from("inaccessible representative payload"));
  return Buffer.from(XLSX.CFB.write(container, { type: "buffer" }));
}
