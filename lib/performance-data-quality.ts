type MetricRow = {
  campaignId: string; reportYear: number; reportMonth: number | null;
  metricType: string; actual: number | null; count: bigint | null; volume: bigint | null;
};

/** Imported score/template cells are not evidence of actual production. A
 * numeric production zero remains valid; null is never changed to zero. */
export function excludePlaceholderMetricPeriods<T extends MetricRow>(rows: T[]): T[] {
  const key = (row: T) => `${row.campaignId}|${row.reportYear}|${row.reportMonth}`;
  const measured = new Set(rows.filter(row => !/(?:_score$|^overall$)/.test(row.metricType) && (row.actual != null || row.count != null || row.volume != null)).map(key));
  return rows.filter(row => measured.has(key(row)));
}

export type PerformanceSourceQuality = {
  code: 'PARTIAL_PERIOD' | 'DEFAULT_GOAL' | 'UNATTRIBUTED_AMOUNT' | 'CAMPAIGN_MAPPING_REVIEW' | 'FRACTIONAL_COUNT' | 'PLACEHOLDER_ONLY' | 'TARGET_OVERRIDE' | 'SOURCE_SCOPE' | 'MAPPING_ALIAS' | 'INCOMPATIBLE_GOAL';
  message: string;
};
