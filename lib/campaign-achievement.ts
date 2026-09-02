export type CampaignDataStatus =
  | "complete"
  | "zero-production"
  | "no-production-records"
  | "missing-goal"
  | "no-imported-data";

export interface CampaignAchievementInput {
  campaignId: string;
  campaignName: string;
  production: number;
  goal: number | null;
  agentCount: number;
  recordCount: number;
  hasCampaignConfiguration?: boolean;
}

export interface CampaignAchievement extends CampaignAchievementInput {
  achievementPercent: number | null;
  goalStatus: "available" | "missing";
  dataStatus: CampaignDataStatus;
}

export interface CampaignAchievementSummary {
  campaignCount: number;
  campaignsWithProduction: number;
  campaignsWithoutProduction: number;
  campaignsWithoutGoal: number;
  totalProduction: number;
  totalGoal: number;
  overallAchievementPercent: number | null;
  averageAchievementPercent: number | null;
  highestCampaign: CampaignAchievement | null;
  lowestCampaign: CampaignAchievement | null;
}

export interface CampaignGoalSources {
  configuredGoal?: number | null;
  monitoringGoal?: number | null;
  importedCampaignGoal?: number | null;
  fallbackGoal?: number | null;
}

/**
 * The month-specific goal saved by the CEO is authoritative. Imported team
 * and agent-derived targets are fallbacks for months without a configured
 * campaign goal.
 */
export function resolveCampaignGoal(sources: CampaignGoalSources): number | null {
  for (const value of [
    sources.configuredGoal,
    sources.monitoringGoal,
    sources.importedCampaignGoal,
    sources.fallbackGoal,
  ]) {
    const goal = Number(value || 0);
    if (Number.isFinite(goal) && goal > 0) return goal;
  }
  return null;
}

export function calculateCampaignAchievement(
  input: CampaignAchievementInput
): CampaignAchievement {
  const production = Number.isFinite(input.production) ? input.production : 0;
  const validGoal =
    input.goal != null && Number.isFinite(input.goal) && input.goal > 0
      ? input.goal
      : null;
  const hasRecords = input.recordCount > 0;

  let dataStatus: CampaignDataStatus;
  if (!hasRecords) {
    dataStatus =
      validGoal != null || input.hasCampaignConfiguration
        ? "no-production-records"
        : "no-imported-data";
  } else if (validGoal == null) {
    dataStatus = "missing-goal";
  } else if (production === 0) {
    dataStatus = "zero-production";
  } else {
    dataStatus = "complete";
  }

  return {
    ...input,
    production,
    goal: validGoal,
    achievementPercent:
      validGoal == null ? null : (production / validGoal) * 100,
    goalStatus: validGoal == null ? "missing" : "available",
    dataStatus,
  };
}

export function summarizeCampaignAchievements(
  campaigns: CampaignAchievement[]
): CampaignAchievementSummary {
  const withValidGoal = campaigns.filter(
    (campaign) => campaign.achievementPercent != null
  );
  const totalProduction = campaigns.reduce(
    (sum, campaign) => sum + campaign.production,
    0
  );
  const totalGoal = withValidGoal.reduce(
    (sum, campaign) => sum + Number(campaign.goal),
    0
  );
  const achievementTotal = withValidGoal.reduce(
    (sum, campaign) => sum + Number(campaign.achievementPercent),
    0
  );
  const byAchievement = [...withValidGoal].sort(
    (a, b) =>
      Number(a.achievementPercent) - Number(b.achievementPercent) ||
      a.campaignName.localeCompare(b.campaignName)
  );

  return {
    campaignCount: campaigns.length,
    campaignsWithProduction: campaigns.filter(
      (campaign) => campaign.recordCount > 0 && campaign.production > 0
    ).length,
    campaignsWithoutProduction: campaigns.filter(
      (campaign) => campaign.production === 0
    ).length,
    campaignsWithoutGoal: campaigns.filter(
      (campaign) => campaign.goalStatus === "missing"
    ).length,
    totalProduction,
    totalGoal,
    overallAchievementPercent:
      totalGoal > 0 ? (totalProduction / totalGoal) * 100 : null,
    averageAchievementPercent:
      withValidGoal.length > 0 ? achievementTotal / withValidGoal.length : null,
    highestCampaign: byAchievement.at(-1) ?? null,
    lowestCampaign: byAchievement[0] ?? null,
  };
}
