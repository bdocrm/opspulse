import { describe, expect, it } from 'vitest';
import { excludePlaceholderMetricPeriods } from './performance-data-quality';

describe('production evidence', () => {
  const row = (month: number, metricType: string, actual: number | null) => ({ campaignId:'acq', reportYear:2026, reportMonth:month, metricType, actual, count:null, volume:null });
  it('excludes future score placeholders without losing a measured production zero', () => {
    const rows = [row(10,'supplementary_score',0),row(10,'overall',null),row(10,'supplementary',null),row(9,'ntb',0),row(9,'overall',null)];
    expect(excludePlaceholderMetricPeriods(rows)).toEqual(rows.slice(3));
  });
  it('retains score context for periods containing genuine measured production', () => {
    const rows = [row(6,'transactions',42),row(6,'transactions_score',0.8)];
    expect(excludePlaceholderMetricPeriods(rows)).toEqual(rows);
  });
});
