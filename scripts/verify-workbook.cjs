const fs = require("fs");
const path = require("path");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS", moduleResolution: "node" } });
const { parseFile, readUpload } = require("../lib/smart-import/parser");
const { reconcile } = require("../lib/smart-import/reconciliation");
const { augustFixture } = require("../lib/smart-import/fixtures");

async function main() {
  const source = process.argv[2];
  const fixture = !source;
  const buffer = fixture ? augustFixture() : fs.readFileSync(path.resolve(source));
  const filename = fixture ? "representative-AUGUST-PROD.xlsx" : path.basename(source);
  const upload = await readUpload(new File([new Uint8Array(buffer)], filename));
  let report;
  if (upload.encrypted) report = { fixture, filename, status: "PASSWORD_REQUIRED", extracted: false, message: "No contents inspected. Open with an authorized password and supply a decrypted copy." };
  else {
    const parsed = parseFile(buffer, filename, upload.extension);
    // This command does not persist data; the API verifies database storage.
    const recovered = JSON.parse(JSON.stringify(parsed.rows));
    report = { fixture, filename, scope: "Extraction and JSON round-trip only; no database commit", reconciliation: reconcile(parsed.inspection, recovered), worksheets: parsed.inspection.sheets.map(sheet => ({ name: sheet.name, usedRange: sheet.usedRange, headerRow: sheet.headerRow, columns: sheet.columns, rows: sheet.rows, nonEmptyCells: sheet.nonEmptyCells, regions: sheet.regions?.length, visibility: sheet.visibility })) };
  }
  const output = process.argv[3];
  if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => { console.error("Verification failed. Check workbook integrity and supported resource limits; no source contents were logged."); process.exitCode = 1; });
