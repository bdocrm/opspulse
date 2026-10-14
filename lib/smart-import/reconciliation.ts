import { sourceDigest } from "./discovery";
import { nonEmpty } from "./normalization";
import type { Candidate, Inspection, RawRow, Reconciliation } from "./types";

export function reconcile(inspection: Inspection, rows: RawRow[], records: Candidate[] = [], committed = 0, businessStatus = "NOT_COMMITTED"): Reconciliation {
  const sheets = inspection.sheets.map(sheet => {
    // Strip database-only fields before comparing immutable canonical source.
    const persisted = rows.filter(row => row.sourceSheet === sheet.name).map(row => ({ sourceSheet: row.sourceSheet, sourceRow: row.sourceRow, cells: row.cells })).sort((a, b) => a.sourceRow - b.sourceRow);
    const cells = persisted.reduce((sum, row) => sum + row.cells.filter(nonEmpty).length, 0);
    const coordinates = persisted.every((row, index) => row.sourceRow === index + 1 && row.cells.length === sheet.columns && row.cells.every((cell, column) => {
      const match = cell.address.match(/^([A-Z]+)(\d+)$/);
      let sourceColumn = 0;
      for (const character of match?.[1] ?? "") sourceColumn = sourceColumn * 26 + character.charCodeAt(0) - 64;
      return Number(match?.[2]) === row.sourceRow && sourceColumn === column + 1;
    }));
    const passed = cells === sheet.nonEmptyCells && persisted.length === sheet.rows && coordinates && (!sheet.sourceDigest || sourceDigest(persisted) === sheet.sourceDigest);
    return { name: sheet.name, passed, sourceCells: sheet.nonEmptyCells, persistedCells: cells, sourceRows: sheet.rows, persistedRows: persisted.length, regions: sheet.regions?.length ?? 1 };
  });
  const knownSheets = new Set(inspection.sheets.map(sheet => sheet.name));
  const traceable = records.every(record => rows.some(row => row.sourceSheet === record.sourceSheet && row.sourceRow === record.sourceRow));
  const passed = inspection.coveragePassed && sheets.every(sheet => sheet.passed) && rows.every(row => knownSheets.has(row.sourceSheet)) && traceable;
  const metricsKnown = inspection.coveragePassed;
  const metric = (value: number) => metricsKnown ? value : null;
  return {
    discoveredSheets: metric(inspection.sheets.length), sourceColumns: metric(inspection.sheets.reduce((sum, sheet) => sum + sheet.columns, 0)), extractedNonEmptyCells: metric(inspection.capturedCells),
    passed, sourceNonEmptyCells: metric(inspection.nonEmptyCells), persistedRawNonEmptyCells: metric(sheets.reduce((sum, sheet) => sum + sheet.persistedCells, 0)),
    sourceRows: metric(sheets.reduce((sum, sheet) => sum + sheet.sourceRows, 0)), persistedRows: metric(rows.length), regions: metric(sheets.reduce((sum, sheet) => sum + sheet.regions, 0)),
    parsedRecords: metric(records.length), mappedRecords: metric(records.filter(record => record.campaignId && record.config).length),
    unmappedFields: metric(records.reduce((sum, record) => sum + Object.keys(record.extensions ?? {}).length, 0)), normalizedRecords: metric(records.filter(record => record.action !== "BLOCK").length),
    validationErrors: metric(records.reduce((sum, record) => sum + record.issues.filter(issue => issue.level === "ERROR").length, 0)), duplicateCandidates: metric(records.filter(record => record.status === "DUPLICATE" || record.conflictRows.length > 0).length),
    committedRecords: committed, rejectedRecords: metric(records.filter(record => record.action === "BLOCK").length),
    rawStatus: inspection.encryptionStatus === "PASSWORD_REQUIRED" ? "PASSWORD_REQUIRED" : passed ? "VERIFIED" : "FAILED", businessStatus, sheets,
  };
}
