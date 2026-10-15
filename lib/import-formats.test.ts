import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseFile } from "./smart-import/parser";
import { buildCandidates, defaultOptions } from "./smart-import/engine";
import { parseProductionWorkbook } from "./production-workbook";
import { parseKpiWorkbook } from "./kpi-workbook";
import { parseBdoDashboardWorkbook } from "./bdo-dashboard-import";
import { parseBpiDashboardWorkbook } from "./bpi-dashboard-import";
import { parseBdoSgmWorksheet } from "./bdo-sgm-ranking-import";
import { parseBdoSgmConsolidatedWorksheet } from "./bdo-sgm-consolidated-import";
import { parseMbPaMonthlyRows } from "./mb-pa-import";
import { parseMbGoalAchievementRows } from "./mb-goal-achievement-import";
import { compareProductionMonths, productionMonthKey } from "./production-month-import";

const date = new Date(2026, 0, 31);
function workbook(rows: unknown[][], name = "January 2026") {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return book;
}
const bytes = (book: XLSX.WorkBook, type: XLSX.BookType = "xlsx") => XLSX.write(book, { type: "buffer", bookType: type }) as Buffer;

describe("supported import format regression checks", () => {
  it.each(["xlsx", "xls", "csv"] as const)("Smart Import parses %s with the same values and preserves unknown columns", type => {
    const book = workbook([["Campaign", "KPI", "Goal", "W1", "MTD", "Achievement", "Report Date", "External note"], ["BPI PL", "Booked Volume", 100, 0, 50, "50%", "January 31, 2026", "Keep this"]]);
    const parsed = parseFile(bytes(book, type), `report.${type}`, type);
    const rows = buildCandidates(parsed.rows, parsed.inspection, defaultOptions(parsed.inspection), { campaigns: [{ id: "bpi", name: "BPI PL", aliases: [] }], configs: [], units: [], existing: [] }).candidates;
    expect(parsed.inspection.coveragePassed).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ campaignId: "bpi", reportYear: 2026, reportMonth: 1, source: { target: 100, week1: 0, mtd: 50, achievement: 0.5 } });
    expect(parsed.rows[1].cells[7].value).toBe("Keep this");
  });

  it("production workbook retains a zero week and the campaign/unit identity", () => {
    const result = parseProductionWorkbook(bytes(workbook([["Campaign", "Business Unit", "Metric Type", "Goal", "Week 1", "MTD"], ["BPI PL", "Inbound", "COUNT", 100, 0, 50]])), "prod.xlsx", { year: 2026, month: 1 });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ campaignSource: "BPI PL", businessUnitSource: "INBOUND", reportYear: 2026, reportMonth: 1, target: 100, week1: 0, mtd: 50 });
  });

  it("KPI workbook finds the employee and actual/goal fields in a monthly sheet", () => {
    const result = parseKpiWorkbook(bytes(workbook([["Employee Name", "Employee Code", "QA Goal", "QA Actual", "AHT Goal", "AHT Actual", "Adherence Goal", "Adherence Actual"], ["Test Agent", "EMP-001", 90, 95, 300, 280, 95, 98]])), "kpi-2026.xlsx", 2026);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ employeeName: "Test Agent", employeeCode: "EMP-001", month: 1, year: 2026, goalQa: 90, actualQa: 95, goalAht: 300, actualAht: 280 });
  });

  const monthlyRows = [["Agent Name", "January 2026", "January 2026", "January 2026", "February 2026", "February 2026", "February 2026"], [null, "Target", "Actual", "Achievement", "Target", "Actual", "Achievement"], ["Test Agent", 100, 50, "50%", 100, 0, "0%"], ["Grand Total", 100, 50, "50%", 100, 0, "0%"]];
  it.each(["CI Agents Monitoring", "CI HOH Monitoring", "Cross Sell Agents Monitoring", "CROSS SELL HOH Monitoring"])("BDO %s splits monthly values and excludes totals", name => {
    const result = parseBdoDashboardWorkbook(workbook(monthlyRows, name), date);
    expect(result.records).toHaveLength(2);
    expect(result.records.map(row => [row.entityName, row.month, row.actual, row.achievement])).toEqual([["Test Agent", 1, 50, 0.5], ["Test Agent", 2, 0, 0]]);
  });
  it.each(["PA Agents Monitoring", "PA HOH Monitoring", "PL HOH Monitoring"])("BPI %s splits monthly values and excludes totals", name => {
    const result = parseBpiDashboardWorkbook(workbook(monthlyRows, name), date);
    expect(result.records).toHaveLength(2);
    expect(result.records.map(row => [row.entityName, row.year, row.month, row.actual, row.achievement])).toEqual([["Test Agent", 2026, 1, 50, 0.5], ["Test Agent", 2026, 2, 0, 0]]);
  });

  it("BDO SGM ranking separates first/bundle cards and retains zero months", () => {
    const result = parseBdoSgmWorksheet([["Card Level", "1st CARD"], ["Agent Name", "January 2026", "February 2026", "Grand Total"], ["Test Agent", 3, 0, 3], ["Grand Total", 3, 0, 3], ["Card Level", "BUNDLE CARD"], ["Agent Name", "January 2026", "February 2026", "Grand Total"], ["Test Agent", 2, null, 2]], "Ranking", date);
    expect(result.detected).toBe(true);
    expect(result.records.map(row => [row.name, row.cardLevel, row.reportDate.getMonth(), row.count])).toEqual([["Test Agent", "FIRST_CARD", 0, 3], ["Test Agent", "FIRST_CARD", 1, 0], ["Test Agent", "BUNDLE_CARD", 0, 2]]);
    expect(result.invalidRows).toBe(0);
  });

  it.each(["monthly", "yearly", "daily"] as const)("BDO SGM consolidated respects the %s period", period => {
    const sheet = XLSX.utils.aoa_to_sheet([[null, null, "January", "January", "February", "February"], ["NICKNAME", "NAMES", "FINAL FC TOTAL", "FINAL BC TOTAL", "FINAL FC TOTAL", "FINAL BC TOTAL"], ["Tester", "Test Agent", 3, 2, 5, 0]]);
    const result = parseBdoSgmConsolidatedWorksheet(sheet, "HOH", new Date(2026, 1, 28), period);
    expect(result.detected).toBe(true);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({ fullName: "Test Agent", finalFcTotal: period === "monthly" ? 5 : 8, finalBcTotal: period === "monthly" ? 0 : 2, wholeYearTotalFc: 8, wholeYearTotalBc: 2 });
  });

  it("MB PA annual format separates transaction counts and billing amounts", () => {
    const rows = [["Name", "January 2026", null, null, null, null, null, null, null, null, null], [null, "TRANS", null, null, "BILLINGS", null, null, "TOTAL TRANS", "TOTAL BILLINGS", "TARGET", "ACHIEVEMENT"], [null, "C2G", "BT", "BALCON", "C2G", "BT", "BALCON"], ["Test Agent", 1, 2, 3, 100, 200, 300, 6, 600, 1000, "60%"], ["Grand Total", 1, 2, 3, 100, 200, 300, 6, 600, 1000, "60%"]];
    const result = parseMbPaMonthlyRows(rows, date);
    expect(result?.entries).toHaveLength(1);
    expect(result?.entries[0]).toMatchObject({ name: "Test Agent", count: 6, volume: 600, c2gTxn: 1, btTxn: 2, balconTxn: 3, c2gVol: 100, btVol: 200, balconVol: 300 });
    expect(result?.entries[0].reportDate.getMonth()).toBe(0);
    expect(result?.invalidRows).toBe(0);
  });

  it("MB goal/achievement format keeps NTB and supplementary metrics separate", () => {
    const rows = [["Name", "January 2026", null, null, null, null, null], [null, "TARGET", null, "ACTUAL", null, "% ACHIEVEMENT", null], [null, "NTB", "SUPPLE", "NTB", "SUPPLE", "NTB", "SUPPLE"], ["Test Agent", 10, 20, 5, 10, "50%", "50%"], ["Grand Total", 10, 20, 5, 10, "50%", "50%"]];
    const result = parseMbGoalAchievementRows(rows, date);
    expect(result?.entries).toHaveLength(1);
    expect(result?.entries[0].normalizedMetrics).toEqual(expect.arrayContaining([expect.objectContaining({ metricType: "ntb", goal: 10, actual: 5, achievement: 0.5 }), expect.objectContaining({ metricType: "supplementary", goal: 20, actual: 10, achievement: 0.5 })]));
    expect(result?.invalidRows).toBe(0);
  });

  it("monthly import skips or updates existing periods according to the selected strategy", () => {
    const rows = [{ campaignId: "bpi", year: 2026, month: 1 }, { campaignId: "bpi", year: 2026, month: 2 }];
    const existing = new Set([productionMonthKey("bpi", 2026, 1)]);
    expect(compareProductionMonths(rows, existing, "fill_missing").map(row => row.action)).toEqual(["SKIP", "IMPORT"]);
    expect(compareProductionMonths(rows, existing, "update_existing").map(row => row.action)).toEqual(["UPDATE", "IMPORT"]);
  });
});
