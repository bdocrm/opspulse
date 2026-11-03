import { describe, expect, it } from 'vitest';
import { selectVerifiedSourceRecords, verifiedSourceTotal, excludeMirroredPlScorecards } from './verified-source-records';

describe('verified period snapshots', () => {
  const row = (campaignId: string, month: number, monitoringType: string, actual = 1) => ({ campaignId, year: 2026, month, monitoringType, actual });
  it('supersedes the full period without altering other campaigns or months', () => {
    const legacy = row('pl', 4, 'PL_PRODUCTIVITY');
    const source = row('pl', 4, 'PL_SOURCE_BOOKED_AGENT', 20);
    const total = row('pl', 4, 'PL_SOURCE_TOTAL', 25);
    const otherMonth = row('pl', 3, 'PL_PRODUCTIVITY');
    const otherCampaign = row('pa', 4, 'PA_SOURCE_BOOKED');
    const rows = [legacy, source, total, otherMonth, otherCampaign];
    expect(selectVerifiedSourceRecords(rows)).toEqual([source, total, otherMonth, otherCampaign]);
    expect(rows).toHaveLength(5);
  });
  it('counts campaign controls once and retains zero as a valid source total', () => {
    expect(verifiedSourceTotal([row('pl', 4, 'PL_SOURCE_BOOKED_AGENT', 20), row('pl', 4, 'PL_SOURCE_TOTAL', 25), row('pl', 5, 'PL_SOURCE_TOTAL', 0)])).toBe(25);
    expect(verifiedSourceTotal([row('pl', 4, 'PL_SOURCE_TOTAL', 0)])).toBe(0);
    expect(verifiedSourceTotal([row('pl', 4, 'PL_SOURCE_BOOKED_AGENT', 20)])).toBeNull();
  });
  it('keeps scorecard-only periods while excluding a mirrored PL scorecard', () => {
    const rows=[{...row('pl',1,'PL_PRODUCTIVITY',100),metric:'Booked Volume'}, {...row('pl',1,'PL_SCORECARD',100),metric:'Scorecard Performance'}, {...row('pl',2,'PL_SCORECARD',200),metric:'Scorecard Performance'}];
    expect(excludeMirroredPlScorecards(rows)).toEqual([rows[0],rows[2]]);
  });
});
