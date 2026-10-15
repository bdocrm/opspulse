import { hash } from "./engine";
import { normalizeName } from "./normalization";
import type { Inspection, ReviewOptions } from "./types";

// Counts, source values, reporting periods and table lengths do not identify a layout.
export const mappingSignature = (inspection: Inspection) => hash(inspection.sheets.map(sheet => ({ name: sheet.name, columns: sheet.columns, headers: sheet.headers, regions: sheet.regions?.map(region => ({ id: region.id, headers: region.headers.map(header => ({ index: header.index, header: header.header })) })) })).map(sheet => ({ ...sheet, headers: sheet.headers.map(header => ({ index: header.index, header: header.header })) })));

export function reuseLayout(current: ReviewOptions, saved: ReviewOptions, inspection: Inspection, authorizedCampaigns: Set<string>): ReviewOptions {
  return {
    ...current,
    selectedSheets: saved.selectedSheets.filter(name => inspection.sheets.some(sheet => sheet.name === name)),
    headerRows: saved.headerRows,
    columnMappings: saved.columnMappings,
    regionMappings: saved.regionMappings,
    campaignMappings: Object.fromEntries(Object.entries(saved.campaignMappings).filter(([, id]) => authorizedCampaigns.has(id))),
    // Each upload has its own period, conflicts and KPI approvals.
    conflictSelections: {}, configs: {},
  };
}

export function compatibleLayout(current: Inspection, previous: Inspection, saved: ReviewOptions) {
  if (mappingSignature(current) !== mappingSignature(previous)) return false;
  return saved.selectedSheets.length > 0 && saved.selectedSheets.every(name => {
    const sheet = current.sheets.find(sheet => sheet.name === name);
    const old = previous.sheets.find(sheet => sheet.name === name);
    if (!sheet || !old || sheet.headerRow == null) return false;
    const row = saved.headerRows[name];
    if (!row) return true;
    const labels = (sheet.metadata.importHeaderRows as Record<string, string[]> | undefined)?.[row];
    const oldLabels = (old.metadata.importHeaderRows as Record<string, string[]> | undefined)?.[row];
    return Boolean(labels && oldLabels && hash(labels.map(normalizeName)) === hash(oldLabels.map(normalizeName)));
  });
}
