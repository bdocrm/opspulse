"use client";

import { useState, useEffect, useRef, ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { PageTitle } from "@/components/layout/page-title";
import { CampaignSelector } from "@/components/campaign-selector";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi-card";
import { ExportButton } from "@/components/export-button";
import { CampaignBarChart } from "@/components/charts/campaign-bar-chart";
import { DailyLineChart } from "@/components/charts/daily-line-chart";
import { DistributionPieChart } from "@/components/charts/distribution-pie-chart";
import { LeaderboardChart } from "@/components/charts/leaderboard-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { kpiColorClass } from "@/utils/kpi";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  LineChart,
  Target,
  Table2,
  TrendingUp,
} from "lucide-react";

interface Campaign {
  id: string;
  campaignName: string;
}

interface Period {
  year: number;
  month: number;
}

interface CampaignRow {
  id: string;
  campaignName: string;
  kpiMetric: string;
  goal: number;
  mtd: number;
  achievement: number;
  runRate: number;
  rrAchievement: number;
  workingDays: number;
  daysLapsed: number;
}

interface DailyTrendRow {
  date: string;
  value: number;
}

interface SimpleValueRow {
  name: string;
  value: number;
}

interface DashboardData {
  kpis: {
    totalMTD: number;
    avgAchievement: number;
    avgRunRate: number;
    avgRRAchievement: number;
  };
  campaigns: { name: string; achievement: number }[];
  campaignTable: CampaignRow[];
  dailyTrend: DailyTrendRow[];
  distribution: SimpleValueRow[];
  leaderboard: SimpleValueRow[];
  availablePeriods: Period[];
  error?: string;
}

type ChartView = "chart" | "table";
type StatusTone = "good" | "attention" | "critical" | "info";

interface ExecutiveRow {
  name: string;
  value?: number;
  actual?: number;
  goal?: number | null;
  achievement?: number | null;
  contribution?: number | null;
  rank: number;
  status: string;
  statusTone: StatusTone;
  recommendation: string;
  [key: string]: string | number | null | undefined;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => r.json());

const numberFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function formatNumber(value: number | null | undefined) {
  return numberFmt.format(Number(value ?? 0));
}

function formatPct(value: number | null | undefined) {
  return `${pctFmt.format(Number(value ?? 0))}%`;
}

function getStatus(achievement: number | null | undefined): { label: string; tone: StatusTone } {
  if (achievement == null) return { label: "Information", tone: "info" };
  if (achievement >= 100) return { label: "Good / Above target", tone: "good" };
  if (achievement >= 80) return { label: "Needs attention", tone: "attention" };
  return { label: "Critical / Below target", tone: "critical" };
}

function statusBadgeClass(tone: StatusTone) {
  if (tone === "good") return "bg-green-500/10 text-green-600";
  if (tone === "attention") return "bg-yellow-500/10 text-yellow-600";
  if (tone === "critical") return "bg-red-500/10 text-red-600";
  return "bg-blue-500/10 text-blue-600";
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildStats(rows: ExecutiveRow[]) {
  const values = rows.map((row) => Number(row.actual ?? row.value ?? 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  const highest = rows.reduce<ExecutiveRow | null>((best, row) => {
    const value = Number(row.actual ?? row.value ?? 0);
    const bestValue = Number(best?.actual ?? best?.value ?? -Infinity);
    return !best || value > bestValue ? row : best;
  }, null);
  const lowest = rows.reduce<ExecutiveRow | null>((worst, row) => {
    const value = Number(row.actual ?? row.value ?? 0);
    const worstValue = Number(worst?.actual ?? worst?.value ?? Infinity);
    return !worst || value < worstValue ? row : worst;
  }, null);

  return { total, average: average(values), highest, lowest };
}

function insightText(rows: ExecutiveRow[], emptyText = "No data available") {
  if (rows.length === 0) return emptyText;
  const best = [...rows].sort((a, b) => Number(b.achievement ?? b.actual ?? b.value ?? 0) - Number(a.achievement ?? a.actual ?? a.value ?? 0))[0];
  const lowest = [...rows].sort((a, b) => Number(a.achievement ?? a.actual ?? a.value ?? 0) - Number(b.achievement ?? b.actual ?? b.value ?? 0))[0];
  const concern = rows.find((row) => row.statusTone === "critical") ?? rows.find((row) => row.statusTone === "attention");
  return [
    `Best: ${best.name}`,
    `Lowest: ${lowest.name}`,
    `Main Concern: ${concern ? `${concern.name} needs attention` : "No immediate concern"}`,
  ].join(" | ");
}

function NoData({ message = "No data available" }: { message?: string }) {
  return <p className="text-sm text-muted-foreground py-10 text-center">{message}</p>;
}

function ColorLegend() {
  const items = [
    { label: "Green = Good / Above target", className: "bg-green-500" },
    { label: "Yellow = Needs attention", className: "bg-yellow-500" },
    { label: "Red = Critical / Below target", className: "bg-red-500" },
    { label: "Blue = Information / Trend", className: "bg-blue-500" },
  ];

  return (
    <div className="flex flex-wrap gap-3 rounded-md border bg-card px-4 py-3 text-xs text-muted-foreground">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", item.className)} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function StatStrip({ rows, contributionLabel = "Top Contribution" }: { rows: ExecutiveRow[]; contributionLabel?: string }) {
  const stats = buildStats(rows);
  const topContribution = rows.find((row) => row.contribution != null);
  const topAchievement = [...rows].sort((a, b) => Number(b.achievement ?? 0) - Number(a.achievement ?? 0))[0];
  const items = [
    { label: "Highest", value: stats.highest ? `${stats.highest.name}: ${formatNumber(stats.highest.actual ?? stats.highest.value)}` : "No data" },
    { label: "Lowest", value: stats.lowest ? `${stats.lowest.name}: ${formatNumber(stats.lowest.actual ?? stats.lowest.value)}` : "No data" },
    { label: "Average", value: formatNumber(stats.average) },
    { label: "Total", value: formatNumber(stats.total) },
    {
      label: contributionLabel,
      value: topContribution
        ? `${topContribution.name}: ${formatPct(topContribution.contribution)}`
        : topAchievement?.achievement != null
          ? `${topAchievement.name}: ${formatPct(topAchievement.achievement)}`
          : "N/A",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border bg-muted/30 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{item.label}</p>
          <p className="mt-1 truncate text-sm font-semibold text-foreground" title={item.value}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function ViewToggle({ value, onChange }: { value: ChartView; onChange: (value: ChartView) => void }) {
  return (
    <div className="inline-flex rounded-md border bg-muted/30 p-1">
      <Button
        type="button"
        size="sm"
        variant={value === "chart" ? "default" : "ghost"}
        className="h-8 gap-1.5 px-2.5"
        onClick={() => onChange("chart")}
      >
        <LineChart className="h-4 w-4" />
        Chart View
      </Button>
      <Button
        type="button"
        size="sm"
        variant={value === "table" ? "default" : "ghost"}
        className="h-8 gap-1.5 px-2.5"
        onClick={() => onChange("table")}
      >
        <Table2 className="h-4 w-4" />
        Table View
      </Button>
    </div>
  );
}

function ChartTable({
  rows,
  valueLabel = "Actual",
  noDataMessage,
}: {
  rows: ExecutiveRow[];
  valueLabel?: string;
  noDataMessage?: string;
}) {
  if (rows.length === 0) return <NoData message={noDataMessage} />;

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rank</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Goal</TableHead>
            <TableHead className="text-right">{valueLabel}</TableHead>
            <TableHead className="text-right">Achievement</TableHead>
            <TableHead className="text-right">Contribution</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Recommendation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.name}-${row.rank}`}>
              <TableCell>{row.rank}</TableCell>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell className="text-right">{row.goal == null ? "N/A" : formatNumber(row.goal)}</TableCell>
              <TableCell className="text-right">{formatNumber(row.actual ?? row.value)}</TableCell>
              <TableCell className="text-right">{row.achievement == null ? "N/A" : formatPct(row.achievement)}</TableCell>
              <TableCell className="text-right">{row.contribution == null ? "N/A" : formatPct(row.contribution)}</TableCell>
              <TableCell>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", statusBadgeClass(row.statusTone))}>
                  {row.status}
                </span>
              </TableCell>
              <TableCell className="min-w-[180px] text-sm text-muted-foreground">{row.recommendation}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ExecutiveChartCard({
  title,
  insight,
  explanation,
  rows,
  view,
  onViewChange,
  children,
  valueLabel,
  contributionLabel,
  noDataMessage = "No data available",
}: {
  title: string;
  insight: string;
  explanation: string;
  rows: ExecutiveRow[];
  view: ChartView;
  onViewChange: (value: ChartView) => void;
  children: ReactNode;
  valueLabel?: string;
  contributionLabel?: string;
  noDataMessage?: string;
}) {
  return (
    <Card>
      <CardHeader className="space-y-3 pb-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="mt-2 rounded-md bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-700">
              Key Insight: {insight}
            </p>
          </div>
          <ViewToggle value={view} onChange={onViewChange} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <StatStrip rows={rows} contributionLabel={contributionLabel} />
        {rows.length > 0 ? (
          view === "chart" ? children : <ChartTable rows={rows} valueLabel={valueLabel} noDataMessage={noDataMessage} />
        ) : (
          <NoData message={noDataMessage} />
        )}
        <p className="text-sm leading-6 text-muted-foreground">{rows.length > 0 ? explanation : noDataMessage}</p>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [chartViews, setChartViews] = useState<Record<string, ChartView>>({
    campaign: "chart",
    daily: "chart",
    distribution: "chart",
    leaderboard: "chart",
  });

  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const didAutoJump = useRef(false);

  const { data: campaignsData } = useSWR<Campaign[]>("/api/campaigns", fetcher);
  const campaigns: Campaign[] = Array.isArray(campaignsData) ? campaignsData : [];

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) { router.push("/login"); return; }
    if ((session.user as any).role === "AGENT") { router.push("/collector"); return; }
  }, [session, status, router]);

  const apiUrl = `/api/dashboard?year=${year}&month=${month}${selectedCampaignId ? `&campaignId=${selectedCampaignId}` : ""}`;
  const { data, isLoading } = useSWR<DashboardData>(apiUrl, fetcher, { refreshInterval: 30000 });

  const hasUsableData = data && !data.error;
  const availablePeriods: Period[] = hasUsableData ? data.availablePeriods ?? [] : [];

  useEffect(() => {
    if (didAutoJump.current) return;
    if (!hasUsableData || availablePeriods.length === 0) return;
    didAutoJump.current = true;
    const currentHasData = availablePeriods.some((p) => p.year === year && p.month === month);
    if (!currentHasData) {
      const latest = availablePeriods[0];
      setYear(latest.year);
      setMonth(latest.month);
    }
  }, [hasUsableData, availablePeriods, year, month]);

  const yearOptions = Array.from(
    new Set([now.getFullYear(), ...availablePeriods.map((p) => p.year)])
  ).sort((a, b) => b - a);

  const kpis = data?.kpis ?? {
    totalMTD: 0,
    avgAchievement: 0,
    avgRunRate: 0,
    avgRRAchievement: 0,
  };
  const campaignTable = hasUsableData ? data.campaignTable ?? [] : [];
  const dailyTrend = hasUsableData ? data.dailyTrend ?? [] : [];
  const distribution = hasUsableData ? data.distribution ?? [] : [];
  const leaderboard = hasUsableData ? data.leaderboard ?? [] : [];

  const campaignRows: ExecutiveRow[] = [...campaignTable]
    .sort((a, b) => b.achievement - a.achievement)
    .map((campaign, index) => {
      const statusInfo = getStatus(campaign.achievement);
      return {
        name: campaign.campaignName,
        achievement: campaign.achievement,
        value: campaign.achievement,
        actual: campaign.mtd,
        goal: campaign.goal,
        rank: index + 1,
        status: statusInfo.label,
        statusTone: statusInfo.tone,
        recommendation: statusInfo.tone === "good"
          ? "Maintain momentum and protect current output."
          : "Review blockers and focus management attention here.",
      };
    });

  const campaignTotal = campaignTable.reduce((sum, campaign) => sum + campaign.mtd, 0);
  const distributionRows: ExecutiveRow[] = distribution
    .map((item) => {
      const match = campaignTable.find((campaign) => campaign.campaignName === item.name);
      const statusInfo = getStatus(match?.achievement);
      return {
        name: item.name,
        value: item.value,
        actual: item.value,
        goal: match?.goal ?? null,
        achievement: match?.achievement ?? null,
        contribution: campaignTotal > 0 ? (item.value / campaignTotal) * 100 : 0,
        rank: 0,
        status: statusInfo.label,
        statusTone: statusInfo.tone,
        recommendation: statusInfo.tone === "critical"
          ? "Confirm the campaign plan and address low contribution."
          : "Keep tracking contribution against the monthly goal.",
      };
    })
    .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0))
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const dailyTotal = dailyTrend.reduce((sum, day) => sum + day.value, 0);
  const dailyRows: ExecutiveRow[] = [...dailyTrend]
    .sort((a, b) => b.value - a.value)
    .map((day, index) => ({
      name: day.date,
      date: day.date,
      value: day.value,
      actual: day.value,
      goal: null,
      achievement: null,
      contribution: dailyTotal > 0 ? (day.value / dailyTotal) * 100 : 0,
      rank: index + 1,
      status: "Information / Trend",
      statusTone: "info",
      recommendation: index === 0
        ? "Use this high-output day as a reference point."
        : "Compare staffing and activity against the strongest day.",
    }));

  const topLeaderboard = [...leaderboard]
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  const leaderboardTotal = topLeaderboard.reduce((sum, item) => sum + item.value, 0);
  const leaderboardRows: ExecutiveRow[] = topLeaderboard.map((agent, index) => ({
    name: agent.name,
    displayName: `#${index + 1} ${agent.name}`,
    value: agent.value,
    actual: agent.value,
    goal: null,
    achievement: null,
    contribution: leaderboardTotal > 0 ? (agent.value / leaderboardTotal) * 100 : 0,
    rank: index + 1,
    status: index < 3 ? "Good / Top performer" : "Information",
    statusTone: index < 3 ? "good" : "info",
    recommendation: index < 3
      ? "Maintain performance and share effective practices."
      : "Review activity level and support consistent output.",
  }));

  const bestCampaign = campaignRows[0];
  const lowestCampaign = [...campaignRows].sort((a, b) => Number(a.achievement ?? 0) - Number(b.achievement ?? 0))[0];
  const weakestCampaign = campaignRows.find((row) => row.statusTone === "critical") ?? campaignRows.find((row) => row.statusTone === "attention");
  const overallStatus = kpis.avgAchievement >= 100 ? "above target" : kpis.avgAchievement >= 80 ? "near target" : "below target";

  const ceoSummary = campaignRows.length > 0
    ? `Total MTD is ${overallStatus} at ${formatPct(kpis.avgAchievement)}. ${bestCampaign?.name ?? "The leading campaign"} is currently the strongest campaign. ${weakestCampaign ? `${weakestCampaign.name} needs attention.` : "No campaign is in the critical range right now."}`
    : "No data available";

  const recommendedActions = campaignRows.length > 0
    ? [
        weakestCampaign ? `Monitor ${weakestCampaign.name} because it is ${weakestCampaign.status.toLowerCase()}.` : null,
        bestCampaign ? `Maintain ${bestCampaign.name} performance because it is the top campaign.` : null,
        lowestCampaign ? `Review ${lowestCampaign.name} for possible coaching, staffing, or volume issues.` : null,
        leaderboardRows.length > 0 ? "Review agents outside the top performers for low achievement patterns." : null,
      ].filter(Boolean) as string[]
    : ["No data available"];

  const setChartView = (key: string, value: ChartView) => {
    setChartViews((current) => ({ ...current, [key]: value }));
  };

  if (status === "loading") return <div className="p-6 text-slate-500">Loading...</div>;

  return (
    <>
      <div className="flex flex-col gap-4 mb-6 sm:flex-row sm:items-center sm:justify-between">
        <PageTitle title="Dashboard" subtitle="Operational Performance Overview" />
        <div className="flex flex-wrap items-end justify-end gap-3">
          {campaigns.length > 0 && (
            <CampaignSelector
              campaigns={campaigns}
              selectedCampaignId={selectedCampaignId}
              onCampaignChange={setSelectedCampaignId}
              placeholder="Select campaign"
              className="w-[220px]"
              includeAllOption
            />
          )}
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">All Months</SelectItem>
              {MONTH_NAMES.map((name, i) => (
                <SelectItem key={i} value={String(i + 1)}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ExportButton
            endpoint={`/api/export/dashboard?year=${year}&month=${month}${selectedCampaignId ? `&campaignId=${selectedCampaignId}` : ""}`}
            className="h-10"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total MTD"
          value={kpis.totalMTD.toLocaleString()}
          icon={Target}
          pct={kpis.avgAchievement}
          subtitle="Month-to-date"
        />
        <KpiCard
          title="Achievement %"
          value={`${kpis.avgAchievement.toFixed(1)}%`}
          icon={TrendingUp}
          pct={kpis.avgAchievement}
        />
        <KpiCard
          title="Run Rate"
          value={kpis.avgRunRate.toLocaleString()}
          icon={Activity}
          pct={kpis.avgRRAchievement}
          subtitle="Projected"
        />
        <KpiCard
          title="RR Achievement %"
          value={`${kpis.avgRRAchievement.toFixed(1)}%`}
          icon={BarChart3}
          pct={kpis.avgRRAchievement}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 mb-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              AI/CEO Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted-foreground">{ceoSummary}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              Recommended Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {recommendedActions.map((action) => (
                <li key={action} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6">
        <ColorLegend />
      </div>

      <div className="grid grid-cols-1 gap-4 mb-6 lg:grid-cols-2">
        <ExecutiveChartCard
          title="Campaign Achievement"
          insight={`${insightText(campaignRows)} | Overall Status: ${overallStatus}`}
          explanation={campaignRows.length > 0 ? `This chart shows which campaign is closest to or above target this period. ${bestCampaign?.name ?? "The top campaign"} is currently strongest, while ${lowestCampaign?.name ?? "the lowest campaign"} is the lowest performer.` : "No data available"}
          rows={campaignRows}
          view={chartViews.campaign}
          onViewChange={(value) => setChartView("campaign", value)}
          valueLabel="Actual"
          contributionLabel="Best Achievement"
        >
          <CampaignBarChart data={campaignRows.map((row) => ({ ...row, achievement: Number(row.achievement ?? 0) }))} />
        </ExecutiveChartCard>

        <ExecutiveChartCard
          title="Daily Trend"
          insight={dailyRows.length > 0 ? `Highest Day: ${dailyRows[0].name} | Total: ${formatNumber(dailyTotal)} | Overall Status: Information / Trend` : "No data available"}
          explanation={dailyRows.length > 0 ? `This chart shows how production moves across the selected period. The strongest day is ${dailyRows[0].name}, which can help compare staffing, volume, and activity patterns.` : "No data available"}
          rows={dailyRows}
          view={chartViews.daily}
          onViewChange={(value) => setChartView("daily", value)}
          valueLabel="Value"
        >
          <DailyLineChart data={[...dailyRows].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((row) => ({ ...row, date: String(row.date), value: Number(row.value ?? 0) }))} label="Sales" />
        </ExecutiveChartCard>

        <ExecutiveChartCard
          title="Distribution"
          insight={distributionRows.length > 0 ? `Top Contributor: ${distributionRows[0].name} | Share: ${formatPct(distributionRows[0].contribution)} | Main Concern: ${weakestCampaign ? `${weakestCampaign.name} needs attention` : "No immediate concern"}` : "No data available"}
          explanation={distributionRows.length > 0 ? `This chart shows which campaign contributes the most this period. ${distributionRows[0].name} has the largest share, while ${distributionRows[distributionRows.length - 1]?.name ?? "the smallest contributor"} contributes the least.` : "No data available"}
          rows={distributionRows}
          view={chartViews.distribution}
          onViewChange={(value) => setChartView("distribution", value)}
          valueLabel="Actual"
        >
          <DistributionPieChart data={distributionRows.map((row) => ({ ...row, value: Number(row.value ?? 0) }))} />
        </ExecutiveChartCard>

        <ExecutiveChartCard
          title="Agent Leaderboard"
          insight={leaderboardRows.length > 0 ? `Top Agent: #1 ${leaderboardRows[0].name} with ${formatNumber(leaderboardRows[0].value)}` : "No agent data available."}
          explanation={leaderboardRows.length > 0 ? `This chart shows only the Top ${leaderboardRows.length} agents in the selected period, ranked from highest production to lowest. ${leaderboardRows[0].name} is currently leading.` : "No agent data available."}
          rows={leaderboardRows}
          view={chartViews.leaderboard}
          onViewChange={(value) => setChartView("leaderboard", value)}
          valueLabel="Actual"
          noDataMessage="No agent data available."
        >
          <LeaderboardChart data={leaderboardRows.map((row) => ({ ...row, value: Number(row.value ?? 0) }))} />
        </ExecutiveChartCard>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Campaign Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>KPI Metric</TableHead>
                  <TableHead className="text-right">Goal</TableHead>
                  <TableHead className="text-right">MTD</TableHead>
                  <TableHead className="text-right">Achievement</TableHead>
                  <TableHead className="text-right">Run Rate</TableHead>
                  <TableHead className="text-right">RR Ach.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : campaignTable.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No data available
                    </TableCell>
                  </TableRow>
                ) : (
                  campaignTable.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.campaignName}</TableCell>
                      <TableCell>{c.kpiMetric}</TableCell>
                      <TableCell className="text-right">{c.goal.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{c.mtd.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", kpiColorClass(c.achievement))}>
                          {c.achievement.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{c.runRate.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", kpiColorClass(c.rrAchievement))}>
                          {c.rrAchievement.toFixed(1)}%
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
