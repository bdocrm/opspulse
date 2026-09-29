import { configKey, FIELDS, type Config, type Inspection, type ReviewOptions } from "./types";
import { normalizeName } from "./normalization";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function strings(value: unknown) { return Object.fromEntries(Object.entries(object(value)).filter(([key, entry]) => key.length <= 1000 && typeof entry === "string" && entry.length <= 1000)) as Record<string, string>; }
export function validateConfig(value: unknown, campaignIds: Set<string>): Config {
  const input = object(value);
  if (!campaignIds.has(String(input.campaignId)) || !normalizeName(input.goalType) || typeof input.label !== "string" || input.label.length > 255) throw new Error("Invalid KPI configuration campaign or goal type.");
  if (!["COUNT", "CURRENCY", "PERCENTAGE", "RATE", "SCORE", "CUSTOM"].includes(String(input.unitType))) throw new Error("Choose a valid KPI unit.");
  const methods = ["SUM", "AVERAGE", "WEIGHTED_AVERAGE", "DIRECT_VALUE", "CUSTOM"];
  if (!methods.includes(String(input.calculationMethod)) || !methods.includes(String(input.aggregationMethod))) throw new Error("Choose a valid KPI calculation and aggregation method.");
  if (["PERCENTAGE", "RATE", "SCORE"].includes(String(input.unitType)) && (input.calculationMethod === "SUM" || input.aggregationMethod === "SUM")) throw new Error("Rate/percentage/score KPIs cannot use SUM. Choose an average, direct value, or custom method.");
  if (!["HIGHER", "LOWER"].includes(String(input.goalDirection))) throw new Error("Choose the KPI goal direction.");
  const precision = Number(input.decimalPrecision);
  const tolerance = Number(input.tolerance);
  if (!Number.isInteger(precision) || precision < 0 || precision > 8 || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1e9) throw new Error("Invalid decimal precision or reconciliation tolerance.");
  return { campaignId: String(input.campaignId), goalType: normalizeName(input.goalType), label: input.label, unitType: input.unitType as Config["unitType"], calculationMethod: input.calculationMethod as Config["calculationMethod"], aggregationMethod: input.aggregationMethod as Config["aggregationMethod"], goalDirection: input.goalDirection as Config["goalDirection"], decimalPrecision: precision, tolerance, isPercentage: input.unitType === "PERCENTAGE", isCurrency: input.unitType === "CURRENCY", isPrimary: input.isPrimary === true, reviewed: input.reviewed === true, version: typeof input.version === "string" ? input.version : null };
}
export function validateOptions(value: unknown, inspection: Inspection, campaignIds: Set<string>): ReviewOptions {
  const input = object(value);
  if (!Array.isArray(input.selectedSheets) || input.selectedSheets.some(name => typeof name !== "string" || !inspection.sheets.some(sheet => sheet.name === name))) throw new Error("Select valid worksheets.");
  const columnMappings: ReviewOptions["columnMappings"] = {};
  const headerRows: Record<string, number> = {};
  for (const sheet of inspection.sheets) {
    const row = object(input.headerRows)[sheet.name];
    if (row != null) {
      if (!Number.isInteger(row) || Number(row) < 1 || Number(row) > sheet.rows) throw new Error("Choose a valid header row.");
      headerRows[sheet.name] = Number(row);
    }
    columnMappings[sheet.name] = {};
    for (const [column, mapping] of Object.entries(object(object(input.columnMappings)[sheet.name]))) {
      if (!/^\d+$/.test(column) || Number(column) >= sheet.columns || (mapping !== "metadata" && !FIELDS.includes(mapping as typeof FIELDS[number]))) throw new Error("Invalid column mapping.");
      columnMappings[sheet.name][column] = mapping as typeof FIELDS[number] | "metadata";
    }
  }
  const campaignMappings = strings(input.campaignMappings);
  for (const id of Object.values(campaignMappings)) if (!campaignIds.has(id)) throw new Error("Campaign mapping is outside your authorized scope.");
  const configs: ReviewOptions["configs"] = {};
  for (const [key, entry] of Object.entries(object(input.configs))) {
    const config = validateConfig(entry, campaignIds);
    if (key !== configKey(config.campaignId, config.goalType)) throw new Error("Invalid campaign/KPI configuration key.");
    configs[key] = config;
  }
  const primaryCampaigns = Object.values(configs).filter(config => config.isPrimary).map(config => config.campaignId);
  if (new Set(primaryCampaigns).size !== primaryCampaigns.length) throw new Error("Choose only one primary dashboard KPI per campaign.");
  const month = input.fallbackMonth == null ? null : Number(input.fallbackMonth);
  const year = input.fallbackYear == null ? null : Number(input.fallbackYear);
  if ((month != null && (!Number.isInteger(month) || month < 1 || month > 12)) || (year != null && (!Number.isInteger(year) || year < 2000 || year > 2100))) throw new Error("Choose a valid reporting month/year.");
  return { selectedSheets: [...new Set(input.selectedSheets as string[])], headerRows, columnMappings, campaignMappings, conflictSelections: strings(input.conflictSelections), configs, fallbackMonth: month, fallbackYear: year };
}
