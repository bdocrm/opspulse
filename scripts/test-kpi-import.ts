import * as assert from "assert";
import * as XLSX from "xlsx";
import { calculateKpiAchievements, getKpiStatus, normalizeEmployeeName } from "../lib/kpi-performance";
import { detectKpiWorksheetMonth, parseKpiWorkbook } from "../lib/kpi-workbook";

assert.equal(detectKpiWorksheetMonth(" JAN "), 1);
assert.equal(detectKpiWorksheetMonth("September KPI"), 9);
assert.equal(detectKpiWorksheetMonth("Instructions"), null);
assert.equal(normalizeEmployeeName("  TOCA, MARY-JOY  "), "TOCA, MARY JOY");

const achievements = calculateKpiAchievements({
  actualQa: 90, goalQa: 85,
  actualAht: 360, goalAht: 540,
  actualAdherence: 95, goalAdherence: 93,
  actualCm: 0, goalCm: 1,
  actualCd: 0.5, goalCd: 3,
});
assert.equal(achievements.achievementAht, 1.5);
assert.equal(achievements.achievementCm, 1);
assert.equal(getKpiStatus(achievements.overallScore), "EXCEEDS_TARGET");

const rows = [
  ["Employee", "Tenure", "Actual KPI", "Actual KPI", "Actual KPI", "Actual KPI", "Actual KPI", "KPI Goal", "KPI Goal", "KPI Goal", "KPI Goal", "KPI Goal"],
  ["Employee Name", "Classification", "QA", "AHT", "Adherence", "CM", "CD", "QA", "AHT", "Adherence", "CM", "CD"],
  ["TOCA, MARY JOY", "TENURED", "94.69%", 362, "99.95%", "0.85%", "0.49%", "85%", 540, "93%", "1%", "3%"],
];
const sheet = XLSX.utils.aoa_to_sheet(rows);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "JUL 2026");
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Notes"]]), "Instructions");
const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
const parsed = parseKpiWorkbook(buffer, "KPI 2026.xlsx", 2025);
assert.equal(parsed.records.length, 1);
assert.equal(parsed.records[0].month, 7);
assert.equal(parsed.records[0].year, 2026);
assert.equal(parsed.records[0].actualQa, 94.69);
assert.equal(parsed.records[0].goalAdherence, 93);
assert.deepEqual(parsed.records[0].errors, []);

console.log("KPI parser and calculation checks passed.");
