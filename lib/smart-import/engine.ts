import { createHash } from "crypto";
import { matchImportCampaign } from "./campaign-mapping";
import { calculate } from "./calculation";
import { cellText, detectPeriod, nonEmpty, normalizeName, normalizeNumber, parseReportDate } from "./normalization";
import { identifyHeader } from "./headers";
import { configKey, SKIP_CONFLICT, NUMBER_FIELDS, rowKey, SUMMARY_UNIT, type Candidate, type Config, type Field, type Inspection, type Numbers, type RawCell, type RawRow, type ReviewOptions } from "./types";

export type ExistingRecord = Numbers & { id: string; campaignId: string; businessUnitId: string; reportYear: number; reportMonth: number; metricType: string; dateUpdated: Date | string | null; updatedAt: Date | string; reportStatus?: string | null; metricUnit?: string | null; sourceDateText?: string | null };
export type Context = { campaigns: { id: string; name: string; aliases: string[] }[]; units: { id: string; campaignId: string; normalizedName: string }[]; configs: Config[]; existing: ExistingRecord[] };
export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function suggestConfig(campaignId: string, goalType: string, label: string, cells: RawCell[]): Config {
  const percentage = cells.some(cell => /%/.test(cell.formatted ?? "") || /%/.test(cell.numberFormat ?? "") || /%/.test(cellText(cell))) || /(?:rate|quality|service level|achievement)/i.test(label);
  const currency = !percentage && (cells.some(cell => /[₱$€£]|\bPHP\b/i.test(cellText(cell)) || /[₱$€£]/.test(cell.numberFormat ?? "")) || /volume|amount|currency/i.test(label));
  return { campaignId, goalType, label, unitType: percentage ? "PERCENTAGE" : currency ? "CURRENCY" : "COUNT", calculationMethod: percentage ? "DIRECT_VALUE" : "SUM", aggregationMethod: percentage ? "DIRECT_VALUE" : "SUM", goalDirection: "HIGHER", decimalPrecision: 2, tolerance: 0.01, isPercentage: percentage, isCurrency: currency, isPrimary: false, reviewed: false, version: null, confidence: percentage || currency ? 85 : 55 };
}
export function defaultOptions(inspection: Inspection): ReviewOptions {
  return { selectedSheets: inspection.sheets.filter(sheet => sheet.detected).map(sheet => sheet.name), headerRows: {}, columnMappings: {}, campaignMappings: {}, conflictSelections: {}, configs: {}, fallbackMonth: inspection.reportingPeriods.length === 1 ? inspection.reportingPeriods[0].month : null, fallbackYear: inspection.reportingPeriods.length === 1 ? inspection.reportingPeriods[0].year : null };
}
function resolveCell(raw: RawRow, column: number, rows: Map<number, RawRow>, metadata: Record<string, unknown>) {
  const cell = raw.cells[column];
  if (cell && nonEmpty(cell)) return cell;
  const merges = metadata["!merges"] as { s: { r: number; c: number }; e: { r: number; c: number } }[] | undefined;
  const merge = merges?.find(item => item.s.r <= raw.sourceRow - 1 && item.e.r >= raw.sourceRow - 1 && item.s.c <= column && item.e.c >= column);
  return merge ? rows.get(merge.s.r + 1)?.cells[merge.s.c] : cell;
}
export function buildCandidates(rawRows: RawRow[], inspection: Inspection, options: ReviewOptions, context: Context) {
  const candidates: Candidate[] = [];
  const configs: Record<string, Config> = {};
  const existingLookup = new Map(context.existing.map(record => [JSON.stringify([record.campaignId, record.metricType, record.reportYear, record.reportMonth]), record]));
  for (const sheet of inspection.sheets) {
    if (!options.selectedSheets.includes(sheet.name)) continue;
    const headerRow = options.headerRows[sheet.name] ?? sheet.headerRow ?? 1;
    const sheetRows = rawRows.filter(row => row.sourceSheet === sheet.name);
    const indexed = new Map(sheetRows.map(row => [row.sourceRow, row]));
    const headerCells = indexed.get(headerRow)?.cells ?? [];
    const columns = new Map<Field, number[]>();
    sheet.headers.forEach(header => {
      const override = options.columnMappings[sheet.name]?.[String(header.index)];
      const field = override === "metadata" ? null : override ?? identifyHeader(cellText(headerCells[header.index]));
      if (field) columns.set(field, [...(columns.get(field) ?? []), header.index]);
    });
    const filePeriod = detectPeriod(`${inspection.fileName} ${sheet.name}`);
    const sheetDates = sheetRows.filter(row => row.sourceRow < headerRow).flatMap(row => row.cells).filter(cell => cell.type === "d" || /as of/i.test(cellText(cell))).map(parseReportDate).filter(date => date.date);
    const sheetDate = sheetDates.length === 1 ? sheetDates[0] : null;
    for (const raw of sheetRows) {
      if (raw.sourceRow <= headerRow || !raw.cells.some(nonEmpty)) continue;
      const get = (field: Field) => {
        const column = columns.get(field)?.[0];
        if (column == null) return undefined;
        return ["campaign", "goalType", "dateUpdated"].includes(field) ? resolveCell(raw, column, indexed, sheet.metadata) : raw.cells[column];
      };
      const campaignSource = cellText(get("campaign"));
      const goalLabel = cellText(get("goalType"));
      if (identifyHeader(campaignSource) === "campaign" && identifyHeader(goalLabel) === "goalType") continue;
      if (!campaignSource && !goalLabel && !NUMBER_FIELDS.some(field => nonEmpty(get(field) ?? { address: "", type: null, value: null, formatted: null, formula: null, numberFormat: null }))) continue;
      const normalizedCampaign = normalizeName(campaignSource);
      const goalType = normalizeName(goalLabel);
      const automaticMatch = matchImportCampaign(campaignSource, context.campaigns);
      const mappedId = options.campaignMappings[normalizedCampaign];
      const campaign = mappedId ? context.campaigns.find(item => item.id === mappedId) : automaticMatch?.campaign ?? null;
      const id = rowKey(raw.sourceSheet, raw.sourceRow);
      const key = campaign && goalType ? configKey(campaign.id, goalType) : null;
      let config = key ? context.configs.find(item => item.campaignId === campaign?.id && item.goalType === goalType) ?? options.configs[key] ?? configs[key] : null;
      if (!config && campaign && goalType) config = suggestConfig(campaign.id, goalType, goalLabel, NUMBER_FIELDS.filter(field => !["achievement", "rrAchievement"].includes(field)).map(get).filter((cell): cell is RawCell => Boolean(cell)));
      if (key && config) configs[key] = config;
      const source = Object.fromEntries(NUMBER_FIELDS.map(field => [field, null])) as Numbers;
      const availability: Candidate["availability"] = {};
      const issues: Candidate["issues"] = [];
      if (!mappedId && campaign && automaticMatch?.automaticVariation) issues.push({ code: "CAMPAIGN_AUTO_MAPPED", level: "WARNING", message: `Automatically mapped "${campaignSource}" to "${campaign.name}" using a unique name or saved alias variation. Confirm the campaign in the preview before importing.` });
      if (!columns.has("campaign") || !campaignSource) issues.push({ code: "CAMPAIGN_REQUIRED", level: "ERROR", message: "Campaign is required. Map the campaign column." });
      if (!columns.has("goalType") || !goalType) issues.push({ code: "KPI_REQUIRED", level: "ERROR", message: "KPI / goal type is required. Map the KPI column." });
      if (get("campaign")?.type === "e" || /^#/.test(campaignSource)) issues.push({ code: "INVALID_CAMPAIGN", level: "ERROR", message: "An Excel error cannot identify a campaign. Correct the source campaign." });
      if (get("goalType")?.type === "e" || /^#/.test(goalLabel)) issues.push({ code: "INVALID_KPI", level: "ERROR", message: "An Excel error cannot identify a KPI. Correct the source goal type." });
      if (campaignSource && !campaign) issues.push({ code: "CAMPAIGN_MAPPING_REQUIRED", level: "ERROR", message: "No unique authorized campaign match. Select a campaign mapping." });
      for (const [field, indices] of columns) if (indices.length > 1) issues.push({ code: "AMBIGUOUS_COLUMNS", level: "ERROR", field, message: `Multiple columns map to ${field}. Keep one mapping and preserve the others as metadata.` });
      for (const field of NUMBER_FIELDS) {
        const inputCell = get(field);
        const numeric = normalizeNumber(inputCell, ["achievement", "rrAchievement"].includes(field) || Boolean(config?.isPercentage));
        source[field] = numeric.value;
        availability[field] = numeric.status;
        if (inputCell?.formula && inputCell.value == null && !inputCell.formatted) issues.push({ code: "FORMULA_VALUE_UNAVAILABLE", field, level: "WARNING", message: "Formula has no evaluated value. Its source is preserved; only configured internal calculations can fill the value." });
        if (["FORMULA_ERROR", "INVALID"].includes(numeric.status)) issues.push({ code: numeric.status, field, level: numeric.status === "INVALID" ? "ERROR" : "WARNING", message: numeric.reason ?? "Unavailable numeric value." });
      }
      for (const field of ["seat", "target", "workingDays", "daysLapse"] as const) {
        const value = source[field];
        if (value != null && (value < 0 || (["workingDays", "daysLapse"].includes(field) && !Number.isInteger(value)))) issues.push({ code: "INVALID_RANGE", field, level: "ERROR", message: `${field} must be non-negative${["workingDays", "daysLapse"].includes(field) ? " and an integer" : ""}.` });
      }
      if (source.workingDays != null && source.daysLapse != null && source.daysLapse > source.workingDays) issues.push({ code: "INVALID_DAYS_LAPSED", level: "ERROR", message: "Days lapsed exceeds working days." });
      if (source.seat == null) issues.push({ code: "MISSING_SEAT", level: "WARNING", message: "Seat count is unavailable; NULL is retained." });
      if (source.target == null || source.target === 0) issues.push({ code: "MISSING_OR_ZERO_GOAL", level: "WARNING", message: "Goal is unavailable or zero. Achievement cannot be calculated from it." });
      if (config?.calculationMethod === "SUM" && (source.workingDays == null || source.daysLapse == null || source.daysLapse === 0)) issues.push({ code: "RUN_RATE_UNAVAILABLE", level: "WARNING", message: "Run-rate calculation requires valid working days and non-zero elapsed days." });
      const date = parseReportDate(get("dateUpdated"));
      const effectiveDate = date.date ? date : !date.text && sheetDate ? sheetDate : date;
      const reportDate = effectiveDate.date;
      const reportYear = reportDate ? Number(reportDate.slice(0, 4)) : filePeriod.year ?? options.fallbackYear;
      const reportMonth = reportDate ? Number(reportDate.slice(5, 7)) : filePeriod.month ?? options.fallbackMonth;
      if (!reportYear || !reportMonth || reportYear < 2000 || reportYear > 2100 || reportMonth < 1 || reportMonth > 12) issues.push({ code: "INVALID_REPORTING_PERIOD", level: "ERROR", message: "Choose an explicit reporting month and year." });
      if (date.invalid) issues.push({ code: "INVALID_REPORT_DATE", field: "dateUpdated", level: "ERROR", message: `Invalid report date: ${date.text}. Original value is preserved.` });
      if (!reportDate) issues.push({ code: "MISSING_REPORT_DATE", level: "WARNING", message: "Report date is unavailable. Updates to dated records require review." });
      if (config && !config.reviewed) issues.push({ code: "KPI_CONFIGURATION_REQUIRED", level: "ERROR", message: "Review and confirm the suggested campaign/KPI configuration before importing." });
      if (config && ["WEIGHTED_AVERAGE", "CUSTOM"].includes(config.calculationMethod)) issues.push({ code: "SOURCE_VALUE_REQUIRED", level: "WARNING", message: "Weights/custom formula are unavailable. Only valid source values are used." });
      const calculation = config ? calculate(source, config) : { values: source, calculated: {}, issues: [] };
      issues.push(...calculation.issues);
      const businessUnitId = campaign ? context.units.find(unit => unit.campaignId === campaign.id && unit.normalizedName === SUMMARY_UNIT)?.id ?? null : null;
      const logicalKey = campaign && goalType && reportYear && reportMonth ? JSON.stringify([campaign.id, goalType, reportYear, reportMonth]) : null;
      const existing = logicalKey ? existingLookup.get(logicalKey) ?? null : null;
      const values = { ...calculation.values };
      if (existing) for (const field of NUMBER_FIELDS) if (values[field] == null || (availability[field] === "PENDING" && existing[field] != null)) values[field] = existing[field];
      if (existing && config) for (const [field, value] of Object.entries(calculation.calculated)) {
        const retained = values[field as keyof Numbers];
        if (source[field as keyof Numbers] == null && retained != null && value != null && Math.abs(retained - value) > config.tolerance) issues.push({ code: "PRESERVED_VALUE_MISMATCH", field, level: "WARNING", message: `${field}: retained existing value ${retained} differs from calculation ${value}. The unavailable source field does not erase the existing value; both figures are traceable.` });
      }
      const changes: Candidate["changes"] = existing ? NUMBER_FIELDS.filter(field => existing[field] !== values[field]).map(field => ({ field, oldValue: existing[field], newValue: values[field] })) : [];
      if (existing && reportDate && new Date(existing.dateUpdated ?? 0).toISOString().slice(0, 10) !== reportDate) changes.push({ field: "dateUpdated", oldValue: existing.dateUpdated ? new Date(existing.dateUpdated).toISOString().slice(0, 10) : null, newValue: reportDate });
      if (existing && existing.reportStatus !== effectiveDate.reportStatus && effectiveDate.reportStatus !== "UNKNOWN") changes.push({ field: "reportStatus", oldValue: existing.reportStatus ?? null, newValue: effectiveDate.reportStatus });
      if (existing && config && existing.metricUnit !== config.unitType) changes.push({ field: "metricUnit", oldValue: existing.metricUnit ?? null, newValue: config.unitType });
      const pending = calculation.values.mtd == null;
      let status: Candidate["status"] = issues.some(issue => issue.level === "ERROR") ? "INVALID" : pending ? "PENDING" : existing ? changes.length ? "UPDATE" : "DUPLICATE" : issues.length ? "WARNING" : "NEW";
      let action: Candidate["action"] = status === "INVALID" ? "BLOCK" : status === "DUPLICATE" ? "SKIP" : existing ? "UPDATE" : pending ? "PENDING" : "INSERT";
      if (status !== "INVALID" && existing?.dateUpdated && reportDate && reportDate < new Date(existing.dateUpdated).toISOString().slice(0, 10)) {
        action = "HISTORY_ONLY";
        issues.push({ code: "OLDER_SNAPSHOT", level: "WARNING", message: "This report is older than the current report. Preserve it in history without replacing current values." });
      } else if (existing?.dateUpdated && !reportDate && changes.length) {
        status = "CONFLICT"; action = "BLOCK";
        issues.push({ code: "UNDATED_UPDATE", level: "ERROR", message: "An undated report cannot safely replace a dated current record." });
      } else if (existing?.reportStatus === "FINAL" && effectiveDate.reportStatus !== "FINAL" && reportDate === new Date(existing.dateUpdated ?? 0).toISOString().slice(0, 10) && changes.length) {
        status = "CONFLICT"; action = "BLOCK";
        issues.push({ code: "FINAL_REPORT_CONFLICT", level: "ERROR", message: "A non-final report cannot replace a final record for the same date." });
      }
      candidates.push({ rowKey: id, sourceSheet: raw.sourceSheet, sourceRow: raw.sourceRow, campaignSource, campaignId: campaign?.id ?? null, campaignName: campaign?.name ?? null, goalType, goalLabel, reportYear, reportMonth, reportDate, reportStatus: effectiveDate.reportStatus, sourceDateText: effectiveDate.text || null, source, calculated: calculation.calculated, values, availability, issues, status, action, changes, existingId: existing?.id ?? null, existingVersion: existing ? new Date(existing.updatedAt).toISOString() : null, config, businessUnitId, key: logicalKey, conflictRows: [], sourceHash: hash({ source, reportDate, reportStatus: effectiveDate.reportStatus, goalType, campaign: normalizedCampaign }) });
    }
  }
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) if (candidate.key) groups.set(candidate.key, [...(groups.get(candidate.key) ?? []), candidate]);
  for (const group of groups.values()) if (group.length > 1) {
    const fingerprints = new Set(group.map(row => row.sourceHash));
    const chosen = group[0].key ? options.conflictSelections[group[0].key] : null;
    // Keep the group visible after review so the skip decision can be changed.
    if (fingerprints.size > 1 || chosen) for (const row of group) row.conflictRows = group.filter(other => other !== row).map(other => other.rowKey);
    if (chosen === SKIP_CONFLICT) {
      for (const row of group) {
        row.action = "SKIP";
        row.issues.push({ code: "CONFLICT_SKIPPED", level: "WARNING", message: "This campaign/KPI/month was skipped during conflict review. Other valid records can be imported; original values and validation errors remain in history." });
      }
    } else if (chosen && group.some(row => row.rowKey === chosen)) {
      for (const row of group) if (row.rowKey !== chosen) {
        row.action = "SKIP";
        row.issues.push({ code: "CONFLICT_NOT_SELECTED", level: "WARNING", message: "A different source row was selected during conflict review. This row is retained in history." });
      }
    } else if (fingerprints.size > 1) for (const row of group) {
      row.status = "CONFLICT"; row.action = "BLOCK"; row.conflictRows = group.filter(other => other !== row).map(other => other.rowKey);
      row.issues.push({ code: "SOURCE_CONFLICT", level: "ERROR", message: `Competing values for the same campaign/KPI/month in ${group.map(other => `${other.sourceSheet} row ${other.sourceRow}`).join(", ")}. Select one row during conflict review and revalidate.` });
    } else for (const row of group.slice(1)) {
      if (row.status !== "INVALID") { row.status = "DUPLICATE"; row.action = "SKIP"; }
      row.issues.push({ code: "SOURCE_DUPLICATE", level: "WARNING", message: "Identical source record is already represented by an earlier row in this file." });
    }
  }
  return { candidates, configs };
}
export function summary(records: Candidate[]) {
  const result: Record<string, number> = { total: records.length, ready: 0, new: 0, updates: 0, duplicates: 0, pending: 0, warnings: 0, conflicts: 0, invalid: 0, historyOnly: 0 };
  for (const row of records) {
    if (row.action !== "BLOCK" && row.action !== "SKIP") result.ready++;
    if (!row.existingId && row.action !== "BLOCK" && row.action !== "SKIP") result.new++;
    if (row.action === "UPDATE") result.updates++;
    if (row.status === "DUPLICATE") result.duplicates++;
    if (row.status === "PENDING") result.pending++;
    if (row.issues.some(issue => issue.level === "WARNING")) result.warnings++;
    if (row.status === "CONFLICT") result.conflicts++;
    if (row.status === "INVALID") result.invalid++;
    if (row.action === "HISTORY_ONLY") result.historyOnly++;
  }
  return result;
}
