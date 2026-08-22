export interface CampaignOption {
  id: string;
  campaignName: string;
}

export interface CampaignGoalOption extends CampaignOption {
  monthlyGoal: number;
  kpiMetric: string;
}
