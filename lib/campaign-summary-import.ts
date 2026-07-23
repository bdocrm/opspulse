import { mapWorksheetCampaign, type ImportCampaignOption } from "./campaign-import-selection";
import { parseImportNumber } from "./import-number";
import { normalizeMetricHeader } from "./metric-import-mapping";

export interface CampaignSummaryEntry {
  name: string;
  count: number;
  volume: number;
  monthlyGoal?: number;
  monthlyActual?: number;
  monthlyAchievement?: number;
  normalizedMetrics: Array<{
    metricType: string;
    goal?: number;
    actual?: number;
    achievement?: number;
  }>;
  metricType: string;
  sourceSheet: string;
  campaignId: string;
  campaignName: string;
  reportDate: Date;
  rowIdx: number;
}

export interface CampaignSummaryParseResult {
  format: "Campaign Summary";
  entries: CampaignSummaryEntry[];
  invalidRows: number;
  warnings: string[];
  errors: string[];
  detectedHeaders: string[];
  detectedCampaigns: string[];
}

function normalizeHeader(value: unknown) {
  return normalizeMetricHeader(
    String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
  );
}

function cellText(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function rowHasAnyValue(row: unknown[]) {
  return row.some((cell) => cell != null && String(cell).trim() !== "");
}

function findHeaderAlias(rows: unknown[][], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  for (const alias of normalizedAliases) {
    for (let row = 0; row < Math.min(rows.length, 20); row++) {
      for (let column = 0; column < (rows[row] || []).length; column++) {
        if (normalizeHeader(rows[row][column]) === alias) return { row, column };
      }
    }
  }
  return null;
}

function numeric(value: unknown) {
  const parsed = parseImportNumber(value);
  if (!parsed.valid) {
    return { value: 0, error: `Invalid number "${String(value).slice(0, 30)}"` };
  }
  if (parsed.value == null) return { value: 0 };
  if (parsed.value < 0) return { value: 0, error: "Negative values are not allowed" };
  return {
    value: parsed.percentage ? parsed.value / 100 : parsed.value,
  };
}

export function parseCampaignSummaryWorksheet(
  rows: unknown[][],
  sheetName: string,
  selectedCampaigns: ImportCampaignOption[],
  reportDate: Date
): CampaignSummaryParseResult | null {
  const campaignHit = findHeaderAlias(rows, [
    "campaign",
    "campaign name",
    "account",
    "program",
    "client",
  ]);
  const actualHit = findHeaderAlias(rows, [
    "mtd",
    "mtd production",
    "production",
    "collection",
    "collected amount",
    "actual collection",
    "actual",
  ]);
  const goalHit = findHeaderAlias(rows, [
    "campaign goal",
    "team goal",
    "campaign target",
    "team target",
    "goal",
    "target",
  ]);
  const achievementHit = findHeaderAlias(rows, [
    "achievement",
    "attainment",
    "achievement percent",
  ]);
  if (!campaignHit || !actualHit || campaignHit.row !== actualHit.row) return null;

  const headerRow = Math.max(
    campaignHit.row,
    actualHit.row,
    goalHit?.row ?? 0,
    achievementHit?.row ?? 0
  );
  const entries: CampaignSummaryEntry[] = [];
  const warnings: string[] = [];
  const unresolvedCampaigns = new Set<string>();
  let invalidRows = 0;

  for (let rowIndex = headerRow + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    if (!rowHasAnyValue(row)) continue;
    const importedCampaignName = cellText(row[campaignHit.column]);
    if (!importedCampaignName || /^campaign(?: name)?$/i.test(importedCampaignName)) continue;
    const mapping = mapWorksheetCampaign(importedCampaignName, selectedCampaigns);
    if (mapping.source === "unresolved") {
      if (!unresolvedCampaigns.has(importedCampaignName)) {
        unresolvedCampaigns.add(importedCampaignName);
        warnings.push(
          `Row ${rowIndex + 1}: campaign "${importedCampaignName}" is not one of the selected authorized campaigns.`
        );
      }
      invalidRows++;
      continue;
    }

    const actual = numeric(row[actualHit.column]);
    const goal = goalHit ? numeric(row[goalHit.column]) : { value: 0 };
    const achievement = achievementHit
      ? numeric(row[achievementHit.column])
      : { value: 0 };
    const rowErrors = [actual.error, goal.error, achievement.error].filter(Boolean);
    if (rowErrors.length > 0) {
      invalidRows++;
      warnings.push(`Row ${rowIndex + 1}: ${rowErrors.join(", ")}`);
      continue;
    }
    if (actual.value === 0 && goal.value === 0 && achievement.value === 0) continue;

    entries.push({
      name: `${mapping.campaign.campaignName} Total`,
      count: 0,
      volume: 0,
      monthlyGoal: goalHit ? goal.value : undefined,
      monthlyActual: actual.value,
      monthlyAchievement: achievementHit ? achievement.value : undefined,
      normalizedMetrics: [
        {
          metricType: "actual",
          goal: goalHit ? goal.value : undefined,
          actual: actual.value,
          achievement: achievementHit ? achievement.value : undefined,
        },
      ],
      metricType: "actual",
      sourceSheet: sheetName,
      campaignId: mapping.campaign.id,
      campaignName: mapping.campaign.campaignName,
      reportDate,
      rowIdx: rowIndex + 1,
    });
  }

  return {
    format: "Campaign Summary",
    entries,
    invalidRows,
    warnings,
    errors: entries.length ? [] : ["No valid campaign summary rows were found."],
    detectedHeaders: (rows[headerRow] || [])
      .map(cellText)
      .filter(Boolean),
    detectedCampaigns: [...new Set(entries.map((entry) => entry.campaignName))],
  };
}
