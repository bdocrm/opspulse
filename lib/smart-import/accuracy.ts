import type { Inspection, Reconciliation } from "./types";

export type ImportAccuracy = {
  status: "VERIFIED" | "PENDING" | "FAILED" | "NO_DATA";
  percent: number | null;
  sourceCells: number | null;
  storedCells: number | null;
  sourceRows: number | null;
  storedRows: number | null;
  verifiedSheets: number;
  totalSheets: number | null;
};

export function importAccuracy(inspection: Inspection, report?: Reconciliation): ImportAccuracy {
  const known = inspection.coveragePassed && Boolean(report);
  const verifiedSheets = known ? inspection.sheets.filter(sheet => sheet.sourceDigest && report?.sheets.some(saved => saved.name === sheet.name && saved.passed && saved.sourceCells === sheet.nonEmptyCells && saved.persistedCells === sheet.nonEmptyCells && saved.sourceRows === sheet.rows && saved.persistedRows === sheet.rows)).length : 0;
  const counts = {
    sourceCells: known ? report!.sourceNonEmptyCells : null,
    storedCells: known ? report!.persistedRawNonEmptyCells : null,
    sourceRows: known ? report!.sourceRows : null,
    storedRows: known ? report!.persistedRows : null,
    verifiedSheets,
    totalSheets: known ? inspection.sheets.length : null,
  };
  if (report?.rawStatus === "FAILED") return { ...counts, status: "FAILED", percent: null };
  if (!known) return { ...counts, status: "PENDING", percent: null };
  if (inspection.nonEmptyCells === 0) return { ...counts, status: "NO_DATA", percent: null };
  const sourceRows = inspection.sheets.reduce((sum, sheet) => sum + sheet.rows, 0);
  const exact = report!.passed && report!.rawStatus === "VERIFIED" && inspection.capturedCells === inspection.nonEmptyCells
    && counts.sourceCells === inspection.nonEmptyCells && counts.storedCells === inspection.nonEmptyCells
    && counts.sourceRows === sourceRows && counts.storedRows === sourceRows
    && report!.sheets.length === inspection.sheets.length && verifiedSheets === inspection.sheets.length;
  // A sheet checksum proves exact contents; counts alone cannot establish an
  // approximate percentage when values differ. Do not invent a partial score.
  return { ...counts, status: exact ? "VERIFIED" : report!.passed ? "PENDING" : "FAILED", percent: exact ? 100 : null };
}
