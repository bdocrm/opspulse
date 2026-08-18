export const BDO_CCC_CAMPAIGN_PATTERN = /^BDO\s+CCC$/i;

export type BdoCccAchievementRecord = {
  achievementQa: number | null;
  achievementAht: number | null;
  achievementAdherence: number | null;
  achievementCm: number | null;
  achievementCd: number | null;
};

/**
 * BDO CCC uses the highest ACVT percentage in the imported Excel row as its
 * transmittals value. Stored KPI achievements are ratios, so convert them to
 * the percentage displayed in the workbook before returning the maximum.
 */
export function highestBdoCccAchievementPercent(
  record: BdoCccAchievementRecord
): number | null {
  const values = [
    record.achievementQa,
    record.achievementAht,
    record.achievementAdherence,
    record.achievementCm,
    record.achievementCd,
  ].filter((value): value is number => value != null && Number.isFinite(value));

  return values.length > 0 ? Math.max(...values) * 100 : null;
}
