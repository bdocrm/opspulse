type SourceRecord = {
  campaignId?: string;
  year: number;
  month: number | null;
  monitoringType: string | null;
};

export const VERIFIED_PL_AGENT = 'PL_SOURCE_BOOKED_AGENT';
export const VERIFIED_PL_TOTAL = 'PL_SOURCE_TOTAL';

/** A reconciled source is an entire period snapshot, not an extra production
 * layer. Preserve legacy rows in storage while superseding them in reads. */
export function selectVerifiedSourceRecords<T extends SourceRecord>(rows: T[]): T[] {
  const key = (row: T) => JSON.stringify([row.campaignId ?? '', row.year, row.month]);
  const periods = new Set(rows.filter(row => row.monitoringType === VERIFIED_PL_AGENT || row.monitoringType === VERIFIED_PL_TOTAL).map(key));
  return rows.filter(row => !periods.has(key(row)) || row.monitoringType === VERIFIED_PL_AGENT || row.monitoringType === VERIFIED_PL_TOTAL);
}

export function verifiedSourceTotal<T extends SourceRecord & { actual: number | null }>(rows: T[]): number | null {
  const totals = rows.filter(row => row.monitoringType === VERIFIED_PL_TOTAL && row.actual != null);
  return totals.length ? totals.reduce((sum, row) => sum + Number(row.actual), 0) : null;
}

/** PL scorecards mirror the productivity workbook. Keep their stored history
 * but never add them to the same period's booked-volume source. */
export function excludeMirroredPlScorecards<T extends SourceRecord & { metric: string }>(rows: T[]): T[] {
  const key = (row: T) => JSON.stringify([row.campaignId ?? '', row.year, row.month]);
  const periods = new Set(rows.filter(row => row.monitoringType === 'PL_PRODUCTIVITY' && /^booked volume$/i.test(row.metric)).map(key));
  return rows.filter(row => row.monitoringType !== 'PL_SCORECARD' || !periods.has(key(row)));
}
