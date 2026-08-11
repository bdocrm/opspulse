export type ExecutiveStatus =
  | "Excellent"
  | "On Track"
  | "Watch"
  | "At Risk"
  | "Critical"
  | "Target Missing"
  | "No Data";

export type ExecutiveTone = "success" | "warning" | "danger" | "neutral";

export interface ExecutiveCampaignMetric {
  id: string;
  campaignName: string;
  hasData: boolean;
  goal: number | null;
  mtd: number | null;
  achievement: number | null;
  runRate: number | null;
  rrAchievement: number | null;
}

export interface CampaignInsight extends ExecutiveCampaignMetric {
  status: ExecutiveStatus;
  tone: ExecutiveTone;
  trend: number | null;
  forecast: number | null;
  reason: string;
  recommendation: string;
}

const STATUS_PRIORITY: Record<ExecutiveStatus, number> = {
  Critical: 0,
  "At Risk": 1,
  Watch: 2,
  "Target Missing": 3,
  "No Data": 4,
  "On Track": 5,
  Excellent: 6,
};

export function getExecutiveStatus(metric: Pick<ExecutiveCampaignMetric, "hasData" | "goal" | "achievement">): {
  status: ExecutiveStatus;
  tone: ExecutiveTone;
} {
  if (!metric.hasData) return { status: "No Data", tone: "neutral" };
  if (metric.goal == null || metric.goal <= 0 || metric.achievement == null) {
    return { status: "Target Missing", tone: "neutral" };
  }
  if (metric.achievement >= 110) return { status: "Excellent", tone: "success" };
  if (metric.achievement >= 100) return { status: "On Track", tone: "success" };
  if (metric.achievement >= 90) return { status: "Watch", tone: "warning" };
  if (metric.achievement >= 80) return { status: "At Risk", tone: "warning" };
  return { status: "Critical", tone: "danger" };
}

function reasonFor(metric: ExecutiveCampaignMetric, status: ExecutiveStatus, trend: number | null) {
  if (status === "No Data") return "No production records are available for the selected period.";
  if (status === "Target Missing") return "Production exists, but a valid target is not configured for this period.";
  if (status === "Critical") return trend != null && trend < 0
    ? "Achievement is significantly below target and has declined versus the previous period."
    : "Achievement is significantly below the configured target.";
  if (status === "At Risk") return metric.rrAchievement != null && metric.rrAchievement < 100
    ? "Current achievement is below target and the projected run rate remains short of goal."
    : "Current achievement is below the expected performance range.";
  if (status === "Watch") return trend != null && trend < 0
    ? "Performance is close to target but has declined versus the previous period."
    : "Performance is close to target and should be monitored.";
  return trend != null && trend < 0
    ? "Performance is above target, although momentum has softened."
    : "Performance is meeting or exceeding the configured target.";
}

function recommendationFor(status: ExecutiveStatus) {
  if (status === "No Data") return "Verify the production import and reporting-period selection.";
  if (status === "Target Missing") return "Configure the campaign target before evaluating performance.";
  if (status === "Critical") return "Review production volume, staffing allocation, and recent campaign activity.";
  if (status === "At Risk") return "Confirm near-term blockers and assign a recovery action for this period.";
  if (status === "Watch") return "Monitor daily output and address any emerging shortfall early.";
  return "Maintain momentum and share the practices driving current results.";
}

export function buildCampaignInsights(
  current: ExecutiveCampaignMetric[],
  previous: ExecutiveCampaignMetric[] = []
): CampaignInsight[] {
  const previousById = new Map(previous.map((campaign) => [campaign.id, campaign]));

  return current.map((campaign) => {
    const previousCampaign = previousById.get(campaign.id);
    const trend = campaign.achievement != null && previousCampaign?.achievement != null
      ? campaign.achievement - previousCampaign.achievement
      : null;
    const { status, tone } = getExecutiveStatus(campaign);

    return {
      ...campaign,
      status,
      tone,
      trend,
      forecast: campaign.rrAchievement,
      reason: reasonFor(campaign, status, trend),
      recommendation: recommendationFor(status),
    };
  });
}

export function sortByUrgency(insights: CampaignInsight[]) {
  return [...insights].sort((a, b) =>
    STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] ||
    Number(a.achievement ?? Number.POSITIVE_INFINITY) - Number(b.achievement ?? Number.POSITIVE_INFINITY)
  );
}

export function buildExecutiveSummary(insights: CampaignInsight[], overallAchievement: number | null) {
  const measurable = insights.filter((item) => item.achievement != null);
  const wins = measurable
    .filter((item) => item.status === "Excellent" || item.status === "On Track" || (item.trend ?? 0) > 0)
    .sort((a, b) => Number(b.achievement) - Number(a.achievement))
    .slice(0, 3)
    .map((item) => item.trend != null && item.trend > 0
      ? `${item.campaignName} improved ${item.trend.toFixed(1)} points versus the previous period.`
      : `${item.campaignName} is meeting or exceeding target at ${item.achievement!.toFixed(1)}%.`);
  const risks = sortByUrgency(insights)
    .filter((item) => ["Critical", "At Risk", "Watch", "Target Missing", "No Data"].includes(item.status))
    .slice(0, 3)
    .map((item) => `${item.campaignName}: ${item.reason}`);

  return {
    summary: overallAchievement == null
      ? "Overall achievement cannot be calculated until production and target data are both available."
      : `Overall achievement reached ${overallAchievement.toFixed(1)}% for the selected period.`,
    wins,
    risks,
  };
}
