import assert from "assert";
import * as XLSX from "xlsx";
import { normalizeProductionName } from "../lib/production-normalization";
import { formatProductionMetric, getProductionStatus } from "../lib/production-metrics";
import { parseProductionWorkbook } from "../lib/production-workbook";

const rows = [
  ["MONTH", "May-26"],
  ["OMS", "CAMPAIGN", "BUSSINESS UNIT", "TARGET", "WEEK 1", "WEEK 2", "WEEK 3", "WEEK 4", "WEEK 5", "MTD", "ACHIEVEMENT", "RUNRATE", "WORKING DAYS", "DAYS LAPSE", "DATE UPDATED"],
  ["Sensitive Person A", "MEDICARD", "PPN", "85%", "90%", "92%", "", "", "", "92%", "108.24%", "92%", "22", "10", "May 15, 2026"],
  ["Sensitive Person B", "", "DENTAL", "0.85", "0", "91%", "", "", "", "91%", "0.34", "91%", "22", "10", "May 15, 2026"],
  ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["MONTH", "June-26"],
  ["OPERATIONS MANAGER", "CAMPAIGN NAME", "BUSINESS UNIT", "TARGET", "WK 1", "WK 2", "WK 3", "WK 4", "MTD", "ACHIEVEMENT", "RUN RATE", "WORK DAYS", "DAYS ELAPSED", "LAST UPDATED"],
  ["Sensitive Person C", "XSELL", "VIRTUAL", "77,738", "10,000", "20,000", "30,000", "17,738", "77,738", "100%", "80,000", "21", "21", "June 30, 2026"],
  ["Sensitive Person D", "", "BROKEN", "100", "10/2", "", "", "", "10", "10%", "10", "21", "5", "June 5, 2026"],
  ["Sensitive Person E", "XSELL", "VIRTUAL", "77,738", "10,000", "20,000", "30,000", "17,738", "77,738", "100%", "80,000", "21", "21", "June 30, 2026"],
];

const sheet = XLSX.utils.aoa_to_sheet(rows);
sheet["F3"] = { t: "n", f: "0.9+0.02", v: 0.92, w: "92%" };
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "PROD MONITORING");
const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
const parsed = parseProductionWorkbook(buffer, "production-test.xlsx", { month: 8, year: 2026 });

assert.equal(parsed.records.length, 5, "all data rows should be detected across monthly sections");
assert.deepEqual(parsed.reportingPeriods, [{ year: 2026, month: 5 }, { year: 2026, month: 6 }]);
assert.equal(parsed.records[1].campaignSource, "MEDICARD", "blank campaigns must forward-fill within a section");
assert.equal(parsed.records[2].campaignSource, "XSELL", "an explicit campaign must override prior campaign context");
assert.equal(parsed.records[0].metricType, "percentage");
assert.equal(parsed.records[0].target, 0.85);
assert.equal(parsed.records[1].target, 0.85, "decimal percentage targets must not be divided by 100 again");
assert.equal(parsed.records[1].achievement, 0.34, "decimal achievement values must remain ratios");
assert.equal(parsed.records[0].week5, null, "missing Week 5 must remain null");
assert.equal(parsed.records[1].week1, 0, "explicit zero must remain distinct from null");
assert.equal(parsed.records[2].metricType, "volume");
assert.equal(parsed.records[2].target, 77738);
assert(parsed.records[3].issues.some((issue) => issue.code === "INVALID_NUMBER"), "malformed numbers must be rejected");
assert(parsed.records[4].issues.some((issue) => issue.code === "DUPLICATE_IN_WORKBOOK"), "duplicate natural keys must be detected");
assert.deepEqual(parsed.excludedFields, ["Operations Manager columns"]);
const serialized = JSON.stringify(parsed);
assert(!serialized.includes("Sensitive Person"), "Operations Manager values must never be returned by parser output");
assert(!/"(?:om|oms|operationsManager|manager)"\s*:/i.test(serialized), "Operations Manager fields must not exist in parser output");
assert.equal(normalizeProductionName("  Medicard  "), normalizeProductionName("MEDICARD"));
assert.equal(normalizeProductionName("medicard"), "MEDICARD");
assert.equal(formatProductionMetric(0.85, "percentage"), "85.0%");
assert.equal(getProductionStatus(1), "ON_TRACK");
assert.equal(getProductionStatus(0.8), "AT_RISK");

console.log(`Production Monitoring tests passed (${parsed.records.length} parsed rows, ${parsed.reportingPeriods.length} periods).`);
