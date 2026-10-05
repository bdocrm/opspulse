import { matchImportCampaign } from "./campaign-mapping";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseFile, readUpload } from "./parser";
import { buildCandidates, defaultOptions, type Context, type ExistingRecord } from "./engine";
import { calculate } from "./calculation";
import { identifyHeader } from "./headers";
import { cellText, normalizeNumber, parseReportDate } from "./normalization";
import { configKey, SKIP_CONFLICT, NUMBER_FIELDS, type Config, type Numbers, type RawCell } from "./types";
import { validateOptions } from "./review";
import { csvCell } from "./export";
import { summarizeSmartDashboard, type SmartDashboardRecord } from "./dashboard";

const headers = ["CAMPAIGN", "SEAT", "GOAL TYPE", "GOAL", "W1", "W2", "W3", "W4", "W5", "MTD", "Achievement", "RR", "RR Achievement", "WDays", "Days Lapsed", "DATE", "Special Remarks"];
const row = [" BPI PL ", 10, "Booked Volume", 100, 1, 2, 3, 4, 5, 15, "15%", 30, "30%", 20, 10, "as of August 31, 2026 - UNOFFICIAL", "Keep every value"];
const config: Config = { campaignId: "bpi", goalType: "BOOKED VOLUME", label: "Booked Volume", unitType: "CURRENCY", calculationMethod: "SUM", aggregationMethod: "SUM", goalDirection: "HIGHER", decimalPrecision: 2, tolerance: 0.01, isPercentage: false, isCurrency: true, isPrimary: true, reviewed: true, version: null };
const context: Context = { campaigns: [{ id: "bpi", name: "BPI PL", aliases: [] }], units: [], configs: [], existing: [] };
const numbers = (overrides: Partial<Numbers> = {}): Numbers => ({ ...Object.fromEntries(NUMBER_FIELDS.map(key => [key, null])), ...overrides }) as Numbers;
function workbook(rows: unknown[][], type: "xlsx" | "xls" = "xlsx", second?: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "August");
  if (second) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(second), "Notes");
  return XLSX.write(book, { type: "buffer", bookType: type }) as Buffer;
}
function parse(rows: unknown[][] = [headers, row], ctx = context) {
  const parsed = parseFile(workbook(rows), "AUGUST PROD 2026.xlsx", "xlsx");
  const options = defaultOptions(parsed.inspection);
  options.configs[configKey(config.campaignId, config.goalType)] = config;
  return { ...parsed, options, ...buildCandidates(parsed.rows, parsed.inspection, options, ctx) };
}
const cell = (value: RawCell["value"], overrides: Partial<RawCell> = {}): RawCell => ({ address: "A1", type: typeof value === "number" ? "n" : "s", value, formatted: null, formula: null, numberFormat: null, ...overrides });

describe("complete source capture", () => {
  it.each(["xlsx", "xls"] as const)("reads valid %s workbooks and preserves all sheets and unknown columns", type => {
    const buffer = workbook([headers, row], type, [["Notes", "Custom Boolean"], ["Unknown source data", true]]);
    const parsed = parseFile(buffer, `AUGUST PROD 2026.${type}`, type);
    expect(parsed.inspection.sheets).toHaveLength(2);
    expect(parsed.inspection.coveragePassed).toBe(true);
    expect(parsed.inspection.capturedCells).toBe(parsed.inspection.nonEmptyCells);
    expect(parsed.rows.flatMap(row => row.cells).some(cell => cell.value === "Unknown source data")).toBe(true);
    expect(parsed.inspection.sheets[0].headers.at(-1)?.field).toBeNull();
  });
  it("reads CSV without losing zero, blanks, future columns, or text", () => {
    const parsed = parseFile(Buffer.from('Campaign,GOAL TYPE,MTD,Future Column\r\nBPI PL,Booked Volume,0,custom\r\nBPI PL,Quality,,pending'), "August 2026.csv", "csv");
    expect(parsed.rows[1].cells[2].value).toBe("0");
    expect(normalizeNumber(parsed.rows[1].cells[2]).value).toBe(0);
    expect(normalizeNumber(parsed.rows[2].cells[2]).value).toBeNull();
    expect(parsed.rows[1].cells[3].value).toBe("custom");
  });
  it("captures formula, evaluated value, Excel error, blank cells, dates, decimals, booleans, and cells outside !ref", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([headers, row, ["Custom", true, new Date("2026-08-31T00:00:00Z"), 1.25]]);
    sheet["J2"] = { t: "e", v: 7, w: "#DIV/0!", f: "1/0" };
    sheet["L2"] = { t: "n", v: 30, f: "J2/O2*N2" };
    sheet["Z10"] = { t: "s", v: "Outside declared range" };
    XLSX.utils.book_append_sheet(book, sheet, "August");
    // XLSX writer honors !ref, so extend for writing and then test direct capture
    // of all meaningful source cells in the resulting workbook.
    sheet["!ref"] = "A1:Z10";
    const parsed = parseFile(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "August 2026.xlsx", "xlsx");
    const error = parsed.rows[1].cells[9];
    expect(error.formula).toBe("1/0");
    expect(cellText(error)).toBe("#DIV/0!");
    expect(normalizeNumber(error)).toMatchObject({ value: null, status: "FORMULA_ERROR" });
    expect(parsed.rows[1].cells[11]).toMatchObject({ formula: "J2/O2*N2", value: 30 });
    expect(parsed.rows[9].cells[25].value).toBe("Outside declared range");
    expect(parsed.rows[5].cells[5].value).toBeNull();
    expect(parsed.inspection.coveragePassed).toBe(true);
  });
  it("handles reordered columns and missing optional columns", () => {
    const result = parse([["MTD", "Goal Type", "Campaign Name", "DATE"], [0, "Booked Volume", "bpi pl", "August 31, 2026 final"]]);
    expect(result.candidates[0]).toMatchObject({ campaignId: "bpi", source: { mtd: 0, seat: null, target: null }, reportStatus: "FINAL" });
    expect(result.candidates[0].status).toBe("WARNING");
  });
  it("preserves and marks missing required columns invalid", () => {
    const result = parse([["Campaign", "MTD", "Future field"], ["BPI PL", 10, "Do not discard"]]);
    expect(result.candidates[0].status).toBe("INVALID");
    expect(result.candidates[0].issues.some(issue => issue.code === "KPI_REQUIRED")).toBe(true);
    expect(result.rows[1].cells[2].value).toBe("Do not discard");
  });
  it("blocks oversized sheet dimensions without silently truncating", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Campaign", "MTD"]]);
    sheet["!ref"] = "A1:ALM1";
    XLSX.utils.book_append_sheet(book, sheet, "Huge");
    const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    expect(() => parseFile(buffer, "huge.xlsx", "xlsx")).toThrow(/No data was truncated/);
  });
});

describe("safe header and value normalization", () => {
  it.each(["W1", "Week 1", "Week1", "Week 01"])("matches %s by alias", value => expect(identifyHeader(value)).toBe("week1"));
  it.each([["1,098,000,000", 1098000000], [" ₱40,000,000 ", 40000000], ["85%", 0.85], ["1.25", 1.25], [0, 0], ["0", 0]])("normalizes %s without losing raw values", (value, expected) => {
    const input = cell(value); expect(normalizeNumber(input).value).toBe(expected); expect(input.value).toBe(value);
  });
  it.each([null, "", "N/A", "NULL", "pending", "not yet available"])("keeps %s unavailable instead of zero", value => expect(normalizeNumber(cell(value))).toMatchObject({ value: null, status: "PENDING" }));
  it.each(["#REF!", "#DIV/0!", "#VALUE!", "#N/A", "#NAME?"])("preserves %s", value => expect(normalizeNumber(cell(value))).toMatchObject({ value: null, status: "FORMULA_ERROR", reason: value }));
  it("does not divide native Excel fractions twice", () => expect(normalizeNumber(cell(0.85, { numberFormat: "0%", formatted: "85%" })).value).toBe(0.85));
  it("blocks booleans, invalid numbers, and ambiguous number syntax", () => {
    expect(normalizeNumber(cell(true, { type: "b" })).status).toBe("INVALID");
    expect(normalizeNumber(cell("12abc")).status).toBe("INVALID");
    expect(normalizeNumber(cell("1,09,80")).status).toBe("INVALID");
  });
  it.each([["As of August 20, 2026", "2026-08-20", "UNKNOWN"], ["as of August 31, 2026 - UNOFFICIAL", "2026-08-31", "UNOFFICIAL"], ["as of August 31, 2026 final", "2026-08-31", "FINAL"], ["August 31, 2026 preliminary", "2026-08-31", "PRELIMINARY"]])("detects dates and report status: %s", (value, date, status) => expect(parseReportDate(cell(value))).toMatchObject({ date, reportStatus: status }));
  it("rejects impossible/error dates", () => {
    expect(parseReportDate(cell("February 31, 2026")).invalid).toBe(true);
    expect(parseReportDate(cell("#REF!")).invalid).toBe(true);
  });
  it("validates extension and file content without executing embedded code", async () => {
    await expect(readUpload(new File(["not a workbook"], "file.xlsx"))).rejects.toThrow(/extension/);
    await expect(readUpload(new File(["hello"], "file.exe"))).rejects.toThrow(/supported/);
    await expect(readUpload(new File([""], "file.csv"))).rejects.toThrow(/1 byte/);
    const buffer = workbook([headers, row]);
    await expect(readUpload(new File([new Uint8Array(buffer)], "file.xlsx"))).resolves.toMatchObject({ extension: "xlsx" });
  });
});

describe("reconciliation and integrity", () => {
  function current(value: Partial<ExistingRecord> = {}): ExistingRecord {
    const first = parse().candidates[0];
    return { ...first.values, id: "existing", campaignId: "bpi", businessUnitId: "unit", reportYear: 2026, reportMonth: 8, metricType: "BOOKED VOLUME", metricUnit: "CURRENCY", dateUpdated: new Date("2026-08-31"), reportStatus: "UNOFFICIAL", updatedAt: new Date("2026-09-01"), ...value };
  }
  it("identifies new records and requires first-time KPI configuration review", () => {
    expect(parse().candidates[0].action).toBe("INSERT");
    const result = parse();
    result.options.configs = {};
    const candidate = buildCandidates(result.rows, result.inspection, result.options, context).candidates[0];
    expect(candidate.status).toBe("INVALID");
    expect(candidate.issues.some(issue => issue.code === "KPI_CONFIGURATION_REQUIRED")).toBe(true);
  });
  it("does not classify production amounts as percentages because achievement columns contain percent values", () => {
    const result = parse(); result.options.configs = {};
    const suggested = buildCandidates(result.rows, result.inspection, result.options, context).candidates[0];
    expect(suggested.config?.unitType).toBe("CURRENCY");
    result.options.configs[configKey("bpi", "BOOKED VOLUME")] = { ...suggested.config!, reviewed: true };
    const confirmed = buildCandidates(result.rows, result.inspection, result.options, context).candidates[0];
    expect(confirmed.action).toBe("INSERT");
    expect(confirmed.values.target).toBe(100);
    expect(confirmed.issues.some(issue => issue.code === "KPI_CONFIGURATION_REQUIRED")).toBe(false);
  });
  it("matches campaign whitespace/case without fuzzy-merging separate names", () => {
    expect(parse().candidates[0].campaignId).toBe("bpi");
    const changed = [...row]; changed[0] = "BPI PLL";
    expect(parse([headers, changed]).candidates[0].campaignId).toBeNull();
  });
  it.each(["BPIPL", "PL BPI", "BPI PL Campaign"])("automatically maps an unambiguous campaign variation: %s", name => {
    const changed = [...row]; changed[0] = name;
    const candidate = parse([headers, changed]).candidates[0];
    expect(candidate.campaignId).toBe("bpi");
    expect(candidate.action).toBe("INSERT");
    expect(candidate.issues.some(issue => issue.code === "CAMPAIGN_AUTO_MAPPED")).toBe(true);
  });
  it("maps saved alias variations and keeps exact names ahead of variation matches", () => {
    const campaigns = [{ id: "one", name: "BPI PA OUTBOUND", aliases: ["BPI OUT"] }, { id: "two", name: "OUT BPI", aliases: [] }];
    expect(matchImportCampaign("BPIPAOUTBOUND", campaigns)?.campaign.id).toBe("one");
    expect(matchImportCampaign("BPI OUT", campaigns)?.campaign.id).toBe("one");
    expect(matchImportCampaign("OUT BPI", campaigns)?.campaign.id).toBe("two");
    expect(matchImportCampaign("BPIOUT", campaigns)?.campaign.id).toBe("one");
  });
  it("requires manual mapping for ambiguous names, typos, broad groups and inaccessible campaigns", () => {
    const campaigns = [{ id: "one", name: "BPI PL", aliases: [] }, { id: "two", name: "B PIPL", aliases: [] }];
    expect(matchImportCampaign("BPIPL", campaigns)).toBeNull();
    expect(matchImportCampaign("BPI PLL", campaigns)).toBeNull();
    expect(matchImportCampaign("ALL BPI CAMPAIGN", campaigns)).toBeNull();
    expect(matchImportCampaign("BPI PA OUTBOUND", campaigns)).toBeNull();
    expect(matchImportCampaign("#REF!", campaigns)).toBeNull();
  });
  it("keeps explicit authorized mapping overrides", () => {
    const result = parse();
    const extra = { id: "other", name: "BPI PA", aliases: [] };
    result.options.campaignMappings["BPI PL"] = extra.id;
    expect(buildCandidates(result.rows, result.inspection, result.options, { ...context, campaigns: [...context.campaigns, extra] }).candidates[0].campaignId).toBe(extra.id);
  });
  it("identifies an exact existing duplicate", () => {
    expect(parse([headers, row], { ...context, existing: [current()] }).candidates[0]).toMatchObject({ status: "DUPLICATE", action: "SKIP", changes: [] });
  });
  it("detects field-level updates and preserves valid values when the source is blank", () => {
    const changed = [...row]; changed[8] = ""; changed[9] = 25;
    const candidate = parse([headers, changed], { ...context, existing: [current()] }).candidates[0];
    expect(candidate.action).toBe("UPDATE");
    expect(candidate.changes).toContainEqual({ field: "mtd", oldValue: 15, newValue: 25 });
    expect(candidate.source.week5).toBeNull();
    expect(candidate.values.week5).toBe(5);
    expect(candidate.availability.week5).toBe("PENDING");
  });
  it("preserves zero as an explicit update", () => {
    const changed = [...row]; changed[9] = 0;
    expect(parse([headers, changed], { ...context, existing: [current()] }).candidates[0].values.mtd).toBe(0);
  });
  it("keeps older report snapshots in history without replacing current values", () => {
    const changed = [...row]; changed[15] = "As of August 20, 2026";
    expect(parse([headers, changed], { ...context, existing: [current()] }).candidates[0].action).toBe("HISTORY_ONLY");
  });
  it("blocks undated replacements of a dated current record", () => {
    const changed = [...row]; changed[15] = ""; changed[9] = 25;
    expect(parse([headers, changed], { ...context, existing: [current()] }).candidates[0].status).toBe("CONFLICT");
  });
  it("skips internal identical duplicates and flags competing values", () => {
    expect(parse([headers, row, row]).candidates[1]).toMatchObject({ status: "DUPLICATE", action: "SKIP" });
    const changed = [...row]; changed[3] = 50;
    const result = parse([headers, row, changed]);
    expect(result.candidates.map(row => row.status)).toEqual(["CONFLICT", "CONFLICT"]);
    result.options.conflictSelections[result.candidates[0].key!] = result.candidates[0].rowKey;
    const resolved = buildCandidates(result.rows, result.inspection, result.options, context).candidates;
    expect(resolved[0].action).toBe("INSERT");
    expect(resolved[1].action).toBe("SKIP");
  });
  it("skips an invalid conflict group while leaving other valid records importable", () => {
    const invalid = [...row]; invalid[15] = "#REF!";
    const competing = [...invalid]; competing[3] = 50;
    const result = parse([headers, row, invalid, competing]);
    const key = result.candidates[0].key!;
    result.options.conflictSelections[key] = SKIP_CONFLICT;
    // Use a separate KPI/month for the valid row.
    result.rows[1].cells[15].value = "September 1, 2026 final";
    const resolved = buildCandidates(result.rows, result.inspection, result.options, context).candidates;
    expect(resolved[0].action).toBe("INSERT");
    for (const candidate of resolved.slice(1)) {
      expect(candidate.action).toBe("SKIP");
      expect(candidate.issues.some(issue => issue.code === "INVALID_REPORT_DATE")).toBe(true);
      expect(candidate.issues.some(issue => issue.code === "CONFLICT_SKIPPED")).toBe(true);
      expect(candidate.conflictRows).toHaveLength(1);
    }
    expect(result.rows[2].cells[15].value).toBe("#REF!");
    result.options.conflictSelections[key] = "";
    expect(buildCandidates(result.rows, result.inspection, result.options, context).candidates[1].action).toBe("BLOCK");
  });
  it("saves pending values as NULL and validates elapsed-day bounds", () => {
    const changed = [...row]; changed[9] = "not yet available"; changed[8] = "";
    expect(parse([headers, changed]).candidates[0]).toMatchObject({ status: "PENDING", action: "PENDING", values: { mtd: null } });
    changed[14] = 21;
    expect(parse([headers, changed]).candidates[0].issues.some(issue => issue.code === "INVALID_DAYS_LAPSED")).toBe(true);
  });
  it("does not import a config or mapping outside authorized campaigns", () => {
    const result = parse();
    result.options.campaignMappings["BPI PL"] = "unauthorized";
    expect(() => validateOptions(result.options, result.inspection, new Set(["bpi"]))).toThrow(/authorized/);
  });
  it("keeps every original value including values in invalid and unmapped sheets recoverable", () => {
    const parsed = parseFile(workbook([headers, row], "xlsx", [["unmapped", "future"], ["invalid metadata", 0], [null, true]]), "AUGUST 2026.xlsx", "xlsx");
    const recovered = JSON.parse(JSON.stringify(parsed.rows)) as typeof parsed.rows;
    const sourceValues = parsed.rows.flatMap(row => row.cells).filter(cell => cell.value != null || cell.formula != null);
    expect(recovered.flatMap(row => row.cells).filter(cell => cell.value != null || cell.formula != null)).toEqual(sourceValues);
  });
});

describe("configuration-driven calculation and dashboard", () => {
  it.each(["COUNT", "CURRENCY"] as const)("calculates additive %s metrics", unitType => {
    const output = calculate(numbers({ week1: 1, week2: 2, week3: 3, week4: 4, week5: 5, target: 100, workingDays: 20, daysLapse: 10 }), { ...config, unitType });
    expect(output.calculated).toMatchObject({ mtd: 15, achievement: 0.15, runRate: 30, rrAchievement: 0.3 });
  });
  it("does not derive a full monthly total from incomplete weeks", () => expect(calculate(numbers({ week1: 1, week2: 2, week3: 3, week4: 4 }), config).calculated.mtd).toBeUndefined());
  it("keeps source values when reconciliation finds formula differences", () => {
    const source = numbers({ mtd: 50, week1: 1, week2: 2, week3: 3, week4: 4, week5: 5, target: 100 });
    const output = calculate(source, config);
    expect(output.values.mtd).toBe(50); expect(output.calculated.mtd).toBe(15);
    expect(output.issues.some(issue => issue.code === "CALCULATION_MISMATCH")).toBe(true);
  });
  it("uses direct percentage values without additive run-rate projections", () => {
    const output = calculate(numbers({ mtd: 0.85, target: 0.9, week1: 0.7, workingDays: 20, daysLapse: 10 }), { ...config, unitType: "PERCENTAGE", calculationMethod: "DIRECT_VALUE", aggregationMethod: "DIRECT_VALUE" });
    expect(output.calculated.runRate).toBeUndefined(); expect(output.calculated.mtd).toBeUndefined(); expect(output.calculated.achievement).toBeCloseTo(0.85 / 0.9);
  });
  it.each([null, 0])("does not divide by unavailable/zero goals or days: %s", value => {
    const output = calculate(numbers({ mtd: 10, target: value, workingDays: 20, daysLapse: value }), config);
    expect(output.calculated.achievement).toBeUndefined(); expect(output.calculated.runRate).toBeUndefined();
  });
  it("does not invent working days or weighted averages", () => {
    expect(calculate(numbers({ mtd: 10, daysLapse: 5 }), config).calculated.runRate).toBeUndefined();
    expect(calculate(numbers({ week1: 0.8, week2: 0.7 }), { ...config, calculationMethod: "WEIGHTED_AVERAGE" }).calculated.mtd).toBeUndefined();
  });
  it("supports lower-is-better KPI achievement and run-rate achievement", () => {
    const output = calculate(numbers({ mtd: 5, target: 10, workingDays: 20, daysLapse: 10 }), { ...config, goalDirection: "LOWER" });
    expect(output.calculated).toMatchObject({ achievement: 2, runRate: 10, rrAchievement: 1 });
  });
  it("retains valid source percentages when dashboard chooses a primary metric", () => {
    const base: SmartDashboardRecord = { campaignId: "bpi", metricType: "QUALITY", reportYear: 2026, reportMonth: 8, target: 0.9, mtd: 0.85, achievement: 0.85 / 0.9, runRate: null, rrAchievement: null, workingDays: 20, daysLapse: 10, dateUpdated: new Date("2026-08-31"), updatedAt: new Date("2026-09-01"), reportStatus: "FINAL" };
    const configs = [{ ...config, goalType: "QUALITY", unitType: "PERCENTAGE", aggregationMethod: "DIRECT_VALUE", isPrimary: true }];
    const records = [base, { ...base, metricType: "BOOKED VOLUME", mtd: 1000000 }];
    expect(summarizeSmartDashboard(records, configs).get("bpi")?.metrics.mtdProduction).toBe(0.85);
    expect(summarizeSmartDashboard(records, []).size).toBe(0);
  });
  it("exports formula-like text safely", () => expect(csvCell("=HYPERLINK(\"malicious\")")).toBe('"\'=HYPERLINK(""malicious"")"'));
});
