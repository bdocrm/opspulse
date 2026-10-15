import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseFile } from "./parser";
import { defaultOptions, buildCandidates } from "./engine";
import { compatibleLayout, reuseLayout } from "./automatic-mappings";

const parse = (rows: unknown[][]) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Notes only"]]), "Notes");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Production");
  return parseFile(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "report.xlsx", "xlsx");
};
describe("automatic import layouts", () => {
  it("selects the data worksheet and maps common headers below a title", () => {
    const parsed = parse([["October report"], ["Account Name", "KPI Name", "Monthly Target", "Week #1 Actual", "MTD Actual", "% Achievement", "RR Achievement (%)"], ["BPI PL", "Booked Volume", 100, 20, 30, "30%", "40%"]]);
    expect(defaultOptions(parsed.inspection).selectedSheets).toEqual(["Production"]);
    expect(parsed.inspection.sheets[1].headerRow).toBe(2);
    expect(parsed.inspection.sheets[1].headers.map(header => header.field)).toEqual(["campaign", "goalType", "target", "week1", "mtd", "achievement", "rrAchievement"]);
  });
  it("recognizes an unmerged header split across two rows", () => {
    const parsed = parse([["Account", "Goal", "Week", "Month to date"], ["Name", "Type", "1", "Actual"], ["BPI PL", "Booked Volume", 20, 30]]);
    expect(parsed.inspection.sheets[1].regions?.filter(region => region.kind === "OPERATIONAL")).toHaveLength(1);
    expect(parsed.inspection.sheets[1].headerRow).toBe(2);
    expect(parsed.inspection.sheets[1].headers.map(header => header.field)).toEqual(["campaign", "goalType", "week1", "mtd"]);
  });
  it("remembers reviewed unfamiliar headers while keeping periods and permissions current", () => {
    const previous = parse([["Report"], ["Portfolio", "Measure", "Result"], ["BPI PL", "Booked Volume", 30]]);
    const current = parse([["Report"], ["Portfolio", "Measure", "Result"], ["BPI PL", "Booked Volume", 40]]);
    const saved = { ...defaultOptions(previous.inspection), selectedSheets: ["Production"], headerRows: { Production: 2 }, columnMappings: { Production: { "0": "campaign" as const, "1": "goalType" as const, "2": "mtd" as const } }, campaignMappings: { PRIVATE: "private" }, conflictSelections: { row: "stale" }, fallbackMonth: 8, fallbackYear: 2026 };
    expect(compatibleLayout(current.inspection, previous.inspection, saved)).toBe(true);
    const reused = reuseLayout({ ...defaultOptions(current.inspection), fallbackMonth: 10, fallbackYear: 2026 }, saved, current.inspection, new Set(["bpi"]));
    expect(reused).toMatchObject({ fallbackMonth: 10, campaignMappings: {}, conflictSelections: {}, configs: {} });
    const result = buildCandidates(current.rows, current.inspection, reused, { campaigns: [{ id: "bpi", name: "BPI PL", aliases: [] }], units: [], configs: [], existing: [] });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ campaignId: "bpi", source: { mtd: 40 } });
    const changed = parse([["Report"], ["Result", "Measure", "Portfolio"], [40, "Booked Volume", "BPI PL"]]);
    expect(compatibleLayout(changed.inspection, previous.inspection, saved)).toBe(false);
  });
});
