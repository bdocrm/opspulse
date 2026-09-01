'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageTitle } from '@/components/layout/page-title';
import { PageSkeleton } from '@/components/skeletons';
import type { CampaignGoalOption } from '@/types/campaign';

type Campaign = CampaignGoalOption;

interface AgentPerformance {
  id: string;
  name: string;
  level: string;
  seatNumber: number | null;
  daysWorked: number;
  transmittals: number;
  activations: number;
  approvals: number;
  booked: number;
  qualityRate: number;
  conversionRate: number;
  bookingRate: number;
  score: number | null;
  ranking: number | null;
  goal: number;
  actual: number;
  achievement: number;
  status: "hit" | "near" | "missed";
}

interface AvailablePeriod {
  year: number;
  month: number;
}

interface CampaignPerformanceData {
  campaign: any;
  overallPerformance: any;
  topPerformers: AgentPerformance[];
  needingAttention: AgentPerformance[];
  critical: AgentPerformance[];
  breakdown: any;
  allAgents: AgentPerformance[];
  recommendations: string[];
}

interface OverallCampaignPerformance {
  totalGoal: number;
  totalActual: number;
  achievementRate: number;
  targetHit: boolean;
  targetStatus?: "hit" | "near" | "missed";
  campaignCount: number;
  kpiMetric?: string;
  reportBasis?: "Monthly" | "YTD" | "All Months" | "Latest YTD";
  aggregationMode?: "single-metric" | "mixed-metrics";
  targetHitCount?: number;
}

type CampaignPerformanceSummaryMap = Record<string, OverallCampaignPerformance>;

function PeriodSelector({
  periods,
  year,
  month,
  allMonths,
  onChange,
}: {
  periods: AvailablePeriod[];
  year: number;
  month: number;
  allMonths: boolean;
  onChange: (year: number, month: number, allMonths: boolean) => void;
}) {
  const value = allMonths ? "all" : `${year}-${String(month).padStart(2, "0")}`;

  return (
    <select
      value={value}
      onChange={(event) => {
        if (event.target.value === "all") {
          onChange(year, month, true);
          return;
        }
        const [nextYear, nextMonth] = event.target.value.split("-").map(Number);
        onChange(nextYear, nextMonth, false);
      }}
      className="h-10 min-w-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
    >
      <option value="all">All Months</option>
      {periods.map((period) => {
        const periodValue = `${period.year}-${String(period.month).padStart(2, "0")}`;
        const label = new Intl.DateTimeFormat("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(Date.UTC(period.year, period.month - 1, 1)));
        return <option key={periodValue} value={periodValue}>{label}</option>;
      })}
    </select>
  );
}

const achievementTextClass = (value: number) => {
  if (value >= 100) return "text-green-600 dark:text-green-400";
  if (value >= 80) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
};

const actualTextClass = (value: number) => (
  value > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
);

const statusLabel = (status?: "hit" | "near" | "missed") => {
  if (status === "hit") return "HIT";
  if (status === "near") return "NEAR TARGET";
  return "MISSED";
};

const statusTextClass = (status?: "hit" | "near" | "missed") => {
  if (status === "hit") return "text-green-600 dark:text-green-400";
  if (status === "near") return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
};

const statusBadgeClass = (status?: "hit" | "near" | "missed") => {
  if (status === "hit") return "bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300";
  if (status === "near") return "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
  return "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300";
};

function OverallCampaignPerformanceCard({
  summary,
  loading,
}: {
  summary: OverallCampaignPerformance | null;
  loading: boolean;
}) {
  const totalGoal = summary?.totalGoal ?? 0;
  const totalActual = summary?.totalActual ?? 0;
  const achievementRate = summary?.achievementRate ?? 0;
  const targetHit = summary?.targetHit ?? false;
  const targetStatus = summary?.targetStatus ?? (targetHit ? "hit" : "missed");
  const mixedMetrics = summary?.aggregationMode === "mixed-metrics";

  return (
    <Card className="border-border bg-card p-5 text-card-foreground shadow-sm">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Overall Campaign Performance</h2>
          <p className="text-sm text-muted-foreground">
            {loading ? "Calculating current performance..." : `${summary?.campaignCount ?? 0} campaign${summary?.campaignCount === 1 ? "" : "s"} included`}
          </p>
        </div>
        <span
          className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass(targetStatus)}`}
        >
          {mixedMetrics ? "MIXED KPIs" : statusLabel(targetStatus)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          mixedMetrics
            ? { label: "Campaigns", value: String(summary?.campaignCount ?? 0), className: "text-blue-600 dark:text-blue-400" }
            : { label: "Total Goal", value: totalGoal.toLocaleString(), className: "text-blue-600 dark:text-blue-400" },
          mixedMetrics
            ? { label: "Targets Hit", value: `${summary?.targetHitCount ?? 0} of ${summary?.campaignCount ?? 0}`, className: "text-green-600 dark:text-green-400" }
            : { label: "Total Actual", value: totalActual.toLocaleString(), className: actualTextClass(totalActual) },
          { label: mixedMetrics ? "Average Achievement" : "Achievement Rate", value: `${achievementRate.toFixed(1)}%`, className: achievementTextClass(achievementRate) },
          { label: mixedMetrics ? "Portfolio Status" : "Target Status", value: statusLabel(targetStatus), className: statusTextClass(targetStatus) },
        ].map(({ label, value, className }) => (
          <div key={label} className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={`mt-2 text-2xl font-bold ${loading ? "text-muted-foreground" : className}`}>
              {loading ? "..." : value}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CampaignSelectorView({
  campaigns,
  availablePeriods,
  year,
  month,
  allMonths,
  selectedCampaignId,
  campaignSearch,
  onPeriodChange,
  onCampaignChange,
  onCampaignSearchChange,
}: {
  campaigns: Campaign[];
  availablePeriods: AvailablePeriod[];
  year: number;
  month: number;
  allMonths: boolean;
  selectedCampaignId: string;
  campaignSearch: string;
  onPeriodChange: (year: number, month: number, allMonths: boolean) => void;
  onCampaignChange: (campaignId: string) => void;
  onCampaignSearchChange: (value: string) => void;
}) {
  const [overallSummary, setOverallSummary] = useState<OverallCampaignPerformance | null>(null);
  const [campaignSummaries, setCampaignSummaries] = useState<CampaignPerformanceSummaryMap>({});
  const [summaryLoading, setSummaryLoading] = useState(false);
  const visibleCampaigns = useMemo(
    () =>
      campaigns
        .filter((campaign) => !selectedCampaignId || campaign.id === selectedCampaignId)
        .filter((campaign) => campaign.campaignName.toLowerCase().includes(campaignSearch.toLowerCase())),
    [campaigns, selectedCampaignId, campaignSearch]
  );

  useEffect(() => {
    if (visibleCampaigns.length === 0) {
      setOverallSummary(null);
      setCampaignSummaries({});
      return;
    }

    let cancelled = false;
    const fetchOverallPerformance = async () => {
      setSummaryLoading(true);
      try {
        const results = await Promise.allSettled(
          visibleCampaigns.map((campaign) =>
            fetch(`/api/reports/campaign-performance?campaignId=${campaign.id}&year=${year}&month=${month}&allMonths=${allMonths}`).then((res) => {
              if (!res.ok) throw new Error(`Failed to fetch ${campaign.campaignName}`);
              return res.json() as Promise<CampaignPerformanceData>;
            })
          )
        );

        const fulfilledResults = results.filter(
          (result): result is PromiseFulfilledResult<CampaignPerformanceData> => result.status === "fulfilled"
        );
        const summariesByCampaign = fulfilledResults.reduce<CampaignPerformanceSummaryMap>((acc, result) => {
          acc[result.value.campaign.id] = {
            ...result.value.overallPerformance,
            campaignCount: 1,
            kpiMetric: result.value.campaign.kpiMetric,
            reportBasis: result.value.campaign.reportBasis,
          };
          return acc;
        }, {});
        const summaries = fulfilledResults.map((result) => result.value.overallPerformance);

        const metricKeys = new Set(
          fulfilledResults.map((result) => String(result.value.campaign.kpiMetric || "").toLowerCase())
        );
        const mixedMetrics = metricKeys.size > 1;
        const totalGoal = mixedMetrics
          ? 0
          : summaries.reduce((sum, item) => sum + Number(item.totalGoal || 0), 0);
        const totalActual = mixedMetrics
          ? 0
          : summaries.reduce((sum, item) => sum + Number(item.totalActual || 0), 0);
        const achievementRate = mixedMetrics
          ? summaries.reduce((sum, item) => sum + Number(item.achievementRate || 0), 0) / summaries.length
          : totalGoal > 0 ? (totalActual / totalGoal) * 100 : 0;
        const targetHitCount = summaries.filter((item) => Boolean(item.targetHit)).length;

        if (!cancelled) {
          setOverallSummary({
            totalGoal,
            totalActual,
            achievementRate,
            targetHit: achievementRate >= 100,
            targetStatus: achievementRate >= 100 ? "hit" : achievementRate >= 85 ? "near" : "missed",
            campaignCount: summaries.length,
            aggregationMode: mixedMetrics ? "mixed-metrics" : "single-metric",
            targetHitCount,
          });
          setCampaignSummaries(summariesByCampaign);
        }
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    };

    fetchOverallPerformance();

    return () => {
      cancelled = true;
    };
  }, [visibleCampaigns, year, month, allMonths]);

  return (
    <div className="space-y-6 p-6">
      <PageTitle
        title="Agent Performance Analysis"
        subtitle={allMonths
          ? "Showing performance from all available bulk import files"
          : "Select a campaign to view detailed agent performance metrics"}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <PeriodSelector
          periods={availablePeriods}
          year={year}
          month={month}
          allMonths={allMonths}
          onChange={onPeriodChange}
        />
        <select
          value={selectedCampaignId}
          onChange={(e) => onCampaignChange(e.target.value)}
          className="h-10 min-w-[220px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="">All Campaigns</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.campaignName}
            </option>
          ))}
        </select>
        <input
          value={campaignSearch}
          onChange={(e) => onCampaignSearchChange(e.target.value)}
          placeholder="Search campaigns..."
          className="h-10 min-w-[220px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {visibleCampaigns.length > 0 && (
        <OverallCampaignPerformanceCard summary={overallSummary} loading={summaryLoading} />
      )}

      {campaigns.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-muted-foreground">
            No bulk-imported campaign reports are available.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleCampaigns.map((campaign) => {
            const campaignSummary = campaignSummaries[campaign.id];
            const campaignGoal = campaignSummary?.totalGoal ?? campaign.monthlyGoal;
            const campaignActual = campaignSummary?.totalActual ?? 0;
            const campaignAchievement = campaignSummary?.achievementRate ?? 0;
            const campaignStatus = campaignSummary?.targetStatus ?? (campaignSummary?.targetHit ? "hit" : "missed");
            const campaignMetric = campaignSummary?.kpiMetric ?? campaign.kpiMetric;
            return (
            <Link
              key={campaign.id}
              href={`/reports/campaign-performance?campaignId=${campaign.id}&year=${year}&month=${month}${allMonths ? "&allMonths=true" : ""}`}
            >
              <Card className="h-full cursor-pointer border-border bg-card p-6 text-card-foreground transition-all hover:border-blue-400 hover:shadow-lg">
                <h3 className="mb-3 text-lg font-bold text-foreground">
                  {campaign.campaignName}
                </h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex justify-between">
                    <span>{campaignSummary?.reportBasis === "YTD" || campaignSummary?.reportBasis === "Latest YTD" ? "YTD Goal:" : allMonths ? "All Months Goal:" : "Monthly Goal:"}</span>
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      {campaignGoal.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>KPI Metric:</span>
                    <span className="font-semibold capitalize text-foreground">
                      {campaignMetric}
                    </span>
                  </div>
                </div>
                <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm text-muted-foreground">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overall Performance</p>
                  <div className="flex justify-between">
                    <span>Total Actual:</span>
                    <span className={`font-semibold ${summaryLoading ? "text-muted-foreground" : actualTextClass(campaignActual)}`}>
                      {summaryLoading ? "..." : campaignActual.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Achievement:</span>
                    <span className={`font-semibold ${summaryLoading ? "text-muted-foreground" : achievementTextClass(campaignAchievement)}`}>
                      {summaryLoading ? "..." : `${campaignAchievement.toFixed(1)}%`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Status:</span>
                    <span className={`font-bold ${statusTextClass(campaignStatus)}`}>
                      {summaryLoading ? "..." : statusLabel(campaignStatus)}
                    </span>
                  </div>
                </div>
                <div className="mt-4 border-t border-border pt-4">
                  <span className="text-sm font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                    View Performance Report →
                  </span>
                </div>
              </Card>
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CampaignDetailView({
  data,
  availablePeriods,
  year,
  month,
  allMonths,
  agentSearch,
  onPeriodChange,
  onAgentSearchChange,
}: {
  data: CampaignPerformanceData;
  availablePeriods: AvailablePeriod[];
  year: number;
  month: number;
  allMonths: boolean;
  agentSearch: string;
  onPeriodChange: (year: number, month: number, allMonths: boolean) => void;
  onAgentSearchChange: (value: string) => void;
}) {
  const {
    campaign,
    overallPerformance,
    topPerformers,
    needingAttention,
    critical,
    breakdown,
    allAgents,
    recommendations,
  } = data;
  const targetStatus = overallPerformance.targetStatus ?? (overallPerformance.targetHit ? "hit" : "missed");
  const filteredAgents = allAgents.filter((agent) => {
    const query = agentSearch.trim().toLowerCase();
    if (!query) return true;

    return (
      agent.name.toLowerCase().includes(query) ||
      String(agent.seatNumber ?? "").includes(query)
    );
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-start">
        <PageTitle
          title={`Campaign Performance: ${campaign.name}`}
          subtitle={`${campaign.kpiMetric.charAt(0).toUpperCase() + campaign.kpiMetric.slice(1)} Analysis${allMonths ? " · All imported months" : ""}`}
        />
        <Link href={`/reports/campaign-performance?year=${year}&month=${month}${allMonths ? "&allMonths=true" : ""}`}>
          <Button variant="outline">← Back to Campaigns</Button>
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <PeriodSelector
          periods={availablePeriods}
          year={year}
          month={month}
          allMonths={allMonths}
          onChange={onPeriodChange}
        />
        <input
          value={agentSearch}
          onChange={(e) => onAgentSearchChange(e.target.value)}
          placeholder="Search agents or seat..."
          className="h-10 min-w-[240px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Overall Performance Summary */}
      <Card className="border-indigo-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-6 dark:border-indigo-900/60 dark:from-blue-950/30 dark:to-indigo-950/20">
        <h2 className="mb-6 text-2xl font-bold text-foreground">
          📊 Overall Campaign Performance
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border/60 bg-background/80 p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">
              {campaign.reportBasis === "YTD" || campaign.reportBasis === "Latest YTD"
                ? "YTD Goal"
                : campaign.reportBasis === "All Months" ? "All Months Goal" : "Total Goal"}
            </p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {overallPerformance.totalGoal.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/80 p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">Total Actual</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {overallPerformance.totalActual.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/80 p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">Achievement Rate</p>
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {overallPerformance.achievementRate}%
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/80 p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">Target Status</p>
            <p className={`text-2xl font-bold ${statusTextClass(targetStatus)}`}>
              {statusLabel(targetStatus)}
            </p>
          </div>
        </div>
      </Card>

      {/* Top Performers */}
      <Card className="border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-6 dark:border-green-900/60 dark:from-green-950/30 dark:to-emerald-950/20">
        <h2 className="mb-4 text-2xl font-bold text-foreground">
          🏆 Top 5 Performers
        </h2>
        <div className="space-y-3">
          {topPerformers.map((agent, idx) => (
            <div
              key={agent.id}
              className="flex items-start justify-between rounded-lg border border-border/60 bg-background/80 p-4 shadow-sm"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="bg-yellow-400 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center">
                    #{idx + 1}
                  </span>
                  <span className="font-semibold text-foreground">
                    {agent.name}
                  </span>
                  <span
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      agent.level === "CORE"
                        ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                        : "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300"
                    }`}
                  >
                    {agent.level}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Goal: {agent.goal.toLocaleString()} | Actual:{" "}
                  {agent.actual.toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                  {agent.achievement}%
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* CORE vs ROOKIE Breakdown */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 p-6 dark:border-blue-900/60 dark:from-blue-950/30 dark:to-cyan-950/20">
          <h2 className="mb-4 text-xl font-bold text-foreground">🔹 CORE Agents</h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Agents:</span>
              <span className="font-bold">{breakdown.core.total}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Met Goal:</span>
              <span className="font-bold text-green-600 dark:text-green-400">{breakdown.core.met}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Missed Goal:</span>
              <span className="font-bold text-red-600 dark:text-red-400">
                {breakdown.core.missed}
              </span>
            </div>
            <div className="mt-4 rounded-lg border border-border/60 border-l-4 border-l-blue-500 bg-background/80 p-3">
              <p className="text-sm text-muted-foreground">Avg Achievement</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {breakdown.core.averageAchievement}%
              </p>
            </div>
          </div>
        </Card>

        <Card className="border-green-200 bg-gradient-to-br from-green-50 to-teal-50 p-6 dark:border-green-900/60 dark:from-green-950/30 dark:to-teal-950/20">
          <h2 className="mb-4 text-xl font-bold text-foreground">
            🟢 ROOKIE Agents
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Agents:</span>
              <span className="font-bold">{breakdown.rookie.total}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Met Goal:</span>
              <span className="font-bold text-green-600 dark:text-green-400">
                {breakdown.rookie.met}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Missed Goal:</span>
              <span className="font-bold text-red-600 dark:text-red-400">
                {breakdown.rookie.missed}
              </span>
            </div>
            <div className="mt-4 rounded-lg border border-border/60 border-l-4 border-l-green-500 bg-background/80 p-3">
              <p className="text-sm text-muted-foreground">Avg Achievement</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {breakdown.rookie.averageAchievement}%
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Agents Needing Attention */}
      <Card className="border-yellow-200 bg-gradient-to-r from-yellow-50 to-orange-50 p-6 dark:border-yellow-900/60 dark:from-yellow-950/30 dark:to-orange-950/20">
        <h2 className="mb-4 text-xl font-bold text-foreground">
          ⚠️ Agents Needing Attention ({needingAttention.length})
        </h2>
        {critical.length > 0 && (
          <div className="mb-6 rounded border-l-4 border-red-500 bg-red-50 p-4 dark:bg-red-950/40">
            <p className="mb-2 font-semibold text-red-700 dark:text-red-300">
              🚨 CRITICAL: {critical.length} agents below 70%
            </p>
            <ul className="space-y-1 text-sm text-red-600 dark:text-red-400">
              {critical.map((agent) => (
                <li key={agent.id}>
                  • {agent.name} ({agent.achievement}%) - Immediate coaching
                  needed
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="space-y-2">
          {needingAttention.map((agent) => (
            <div
              key={agent.id}
              className={`p-4 rounded-lg ${
                agent.achievement < 70
                  ? "border-l-4 border-red-500 bg-red-50 dark:bg-red-950/40"
                  : "border-l-4 border-yellow-500 bg-background/80"
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-foreground">{agent.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {agent.level} | Goal: {agent.goal.toLocaleString()} | Actual:{" "}
                    {agent.actual.toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-xl font-bold ${
                      agent.achievement < 70
                        ? "text-red-600 dark:text-red-400"
                        : "text-yellow-600 dark:text-yellow-400"
                    }`}
                  >
                    {agent.achievement}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {agent.achievement < 70 ? "🔴 Critical" : "🟡 Near Miss"}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Individual Agent Scorecard */}
      <Card className="p-6">
        <h2 className="mb-4 text-xl font-bold text-foreground">
          📋 Individual Agent Scorecard
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Showing {filteredAgents.length} of {allAgents.length} agents
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b-2 border-border bg-muted/60">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-right">Seat Number</th>
                <th className="px-4 py-2 text-right">Days Worked</th>
                <th className="px-4 py-2 text-right">Transmittals</th>
                <th className="px-4 py-2 text-right">Activations</th>
                <th className="px-4 py-2 text-right">Approvals</th>
                <th className="px-4 py-2 text-right">Booked</th>
                <th className="px-4 py-2 text-right">Quality %</th>
                <th className="px-4 py-2 text-right">Conversion %</th>
                <th className="px-4 py-2 text-right">Booking %</th>
                <th className="px-4 py-2 text-right">Score</th>
                <th className="px-4 py-2 text-right">Rank</th>
                <th className="px-4 py-2 text-left">Level</th>
                <th className="px-4 py-2 text-right">Goal</th>
                <th className="px-4 py-2 text-right">Actual</th>
                <th className="px-4 py-2 text-right">Achievement %</th>
                <th className="px-4 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredAgents.map((agent) => (
                <tr key={agent.id} className="border-b border-border hover:bg-muted/40">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {agent.name}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.seatNumber ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.daysWorked.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.transmittals.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.activations.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.approvals.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.booked.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.qualityRate.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.conversionRate.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.bookingRate.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.score == null ? 'N/A' : agent.score.toFixed(1)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.ranking == null ? 'N/A' : agent.ranking.toFixed(1)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        agent.level === "CORE"
                          ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                          : "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300"
                      }`}
                    >
                      {agent.level}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.goal.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.actual.toLocaleString()}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-bold ${
                      agent.achievement >= 100
                        ? "text-green-600 dark:text-green-400"
                        : agent.achievement >= 85
                          ? "text-yellow-600 dark:text-yellow-400"
                          : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {agent.achievement}%
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-semibold ${statusTextClass(agent.status)}`}>
                      {statusLabel(agent.status)}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredAgents.length === 0 && (
                <tr>
                  <td colSpan={17} className="px-4 py-8 text-center text-muted-foreground">
                    No agents match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Team Leader Action Points */}
      <Card className="border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 p-6 dark:border-purple-900/60 dark:from-purple-950/30 dark:to-pink-950/20">
        <h2 className="mb-4 text-2xl font-bold text-foreground">
          💡 Team Leader Action Points
        </h2>
        <div className="space-y-3">
          {recommendations.map((rec, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-border/60 border-l-4 border-l-purple-500 bg-background/80 p-4 shadow-sm"
            >
              <p className="text-foreground">{rec}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Export Button */}
      <div className="flex justify-end gap-4">
        <Button
          onClick={() => window.print()}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          🖨️ Print Report
        </Button>
      </div>
    </div>
  );
}

function CampaignPerformancePageContent() {
  const searchParams = useSearchParams();
  const campaignId = searchParams.get("campaignId");
  const now = new Date();
  const initialYear = parseInt(searchParams.get("year") ?? now.getFullYear().toString());
  const initialMonth = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));
  const initialAllMonths = searchParams.get("allMonths") === "true";
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [availablePeriods, setAvailablePeriods] = useState<AvailablePeriod[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [data, setData] = useState<CampaignPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [allMonths, setAllMonths] = useState(initialAllMonths);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [agentSearch, setAgentSearch] = useState("");
  const [didAutoSelectPeriod, setDidAutoSelectPeriod] = useState(false);

  useEffect(() => {
    const fetchCampaigns = async () => {
      setCampaignsLoading(true);
      setCampaigns([]);
      setError(null);
      try {
        const res = await fetch(
          `/api/reports/campaign-performance/campaigns?year=${year}&month=${month}&allMonths=${allMonths}`
        );
        if (!res.ok) throw new Error(`Failed to fetch campaigns: ${res.status}`);
        const result = await res.json();
        const importedCampaigns = Array.isArray(result) ? result : result.campaigns || [];
        setCampaigns(importedCampaigns);
        setSelectedCampaignId((current) =>
          current && importedCampaigns.some((campaign: Campaign) => campaign.id === current)
            ? current
            : ""
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load campaigns");
      } finally {
        setCampaignsLoading(false);
      }
    };

    fetchCampaigns();
  }, [year, month, allMonths]);

  useEffect(() => {
    if (didAutoSelectPeriod) return;

    const fetchAvailablePeriods = async () => {
      try {
        const res = await fetch("/api/reports/campaign-performance/periods");
        if (!res.ok) return;
        const result = await res.json();
        const periods: AvailablePeriod[] = result.periods || [];
        setAvailablePeriods(periods);
        if (periods.length === 0) return;

        const selectedHasData = periods.some((period) => period.year === year && period.month === month);
        if (!allMonths && !selectedHasData) {
          setYear(periods[0].year);
          setMonth(periods[0].month);
        }
      } finally {
        setDidAutoSelectPeriod(true);
      }
    };

    fetchAvailablePeriods();
  }, [allMonths, didAutoSelectPeriod, year, month]);

  useEffect(() => {
    if (!campaignId) {
      setLoading(false);
      return;
    }

    const fetchPerformance = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/reports/campaign-performance?campaignId=${campaignId}&year=${year}&month=${month}&allMonths=${allMonths}`
        );
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    fetchPerformance();
  }, [campaignId, year, month, allMonths]);

  if (loading)
    return <PageSkeleton label="Loading campaign performance" />;

  if (error)
    return (
      <div className="p-6 min-h-screen">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900/60 dark:bg-red-950/40">
          <p className="mb-2 font-semibold text-red-700 dark:text-red-300">Error Loading Data:</p>
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <p className="mt-4 text-xs text-red-500 dark:text-red-400">Check the browser console for more details.</p>
        </div>
      </div>
    );

  // Show campaign selector if no campaignId
  if (!campaignId) {
    if (campaignsLoading) {
      return <PageSkeleton label="Loading imported campaign reports" />;
    }

    return (
      <CampaignSelectorView
        campaigns={campaigns}
        availablePeriods={availablePeriods}
        year={year}
        month={month}
        allMonths={allMonths}
        selectedCampaignId={selectedCampaignId}
        campaignSearch={campaignSearch}
        onPeriodChange={(nextYear, nextMonth, nextAllMonths) => {
          setYear(nextYear);
          setMonth(nextMonth);
          setAllMonths(nextAllMonths);
        }}
        onCampaignChange={setSelectedCampaignId}
        onCampaignSearchChange={setCampaignSearch}
      />
    );
  }

  // Show detail view if campaignId provided
  if (!data) {
    return (
      <div className="p-6">
        <p>No data available</p>
      </div>
    );
  }

  return (
    <CampaignDetailView
      data={data}
      availablePeriods={availablePeriods}
      year={year}
      month={month}
      allMonths={allMonths}
      agentSearch={agentSearch}
      onPeriodChange={(nextYear, nextMonth, nextAllMonths) => {
        setYear(nextYear);
        setMonth(nextMonth);
        setAllMonths(nextAllMonths);
      }}
      onAgentSearchChange={setAgentSearch}
    />
  );
}

export default function CampaignPerformancePage() {
  return (
    <Suspense
      fallback={
        <PageSkeleton label="Loading campaign performance" />
      }
    >
      <CampaignPerformancePageContent />
    </Suspense>
  );
}
