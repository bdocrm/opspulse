"use client";

import { useState, useEffect, useMemo, useRef, ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { PageTitle } from "@/components/layout/page-title";
import { CampaignSelector } from "@/components/campaign-selector";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
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
  ChevronDown,
  CheckCircle2,
  HelpCircle,
  Minus,
  RefreshCw,
  Target,
  Table2,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
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
  hasData: boolean;
  kpiMetric: string;
  goal: number | null;
  mtd: number | null;
  achievement: number | null;
  runRate: number | null;
  rrAchievement: number | null;
  workingDays: number;
  daysLapsed: number;
  dataStatus: string;
  warnings: string[];
}

interface DailyTrendRow {
  date: string;
  value: number;
}

interface SimpleValueRow {
  name: string;
  value: number;
}

interface LeaderboardRow extends SimpleValueRow {
  goal: number | null;
  achievement: number | null;
}

interface DashboardData {
  kpis: {
    totalMTD: number | null;
    avgAchievement: number | null;
    avgRunRate: number | null;
    avgRRAchievement: number | null;
    dataStatus?: string;
    warnings?: string[];
  };
  campaigns: { name: string; achievement: number | null }[];
  campaignTable: CampaignRow[];
  dailyTrend: DailyTrendRow[];
  distribution: SimpleValueRow[];
  leaderboard: LeaderboardRow[];
  availablePeriods: Period[];
  error?: string;
}

type StatusTone = "good" | "attention" | "critical" | "info";

interface ExecutiveRow {
  name: string;
  hasData?: boolean;
  value?: number | null;
  actual?: number;
  goal?: number | null;
  achievement?: number | null;
  contribution?: number | null;
  rank: number;
  status: string;
  statusTone: StatusTone;
  recommendation: string;
  [key: string]: string | number | boolean | null | undefined;
}

interface PriorityAction {
  campaign: string;
  issue: string;
  action: string;
  tone: StatusTone;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const fetcher = async (url: string) => {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok) {
    throw new Error(`Dashboard request failed (${response.status})`);
  }
  return response.json();
};

const numberFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const currencyFmt = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

function formatNumber(value: number | null | undefined) {
  return numberFmt.format(Number(value ?? 0));
}

function formatPct(value: number | null | undefined) {
  return `${pctFmt.format(Number(value ?? 0))}%`;
}

function formatCurrency(value: number | null | undefined) {
  return currencyFmt.format(Number(value ?? 0));
}

function formatSignedCurrency(value: number) {
  return `${value > 0 ? "+" : ""}${formatCurrency(value)}`;
}

function formatSignedPoints(value: number) {
  return `${value > 0 ? "+" : ""}${pctFmt.format(value)} pts`;
}

function getStatus(achievement: number | null | undefined): { label: string; tone: StatusTone } {
  if (achievement == null) return { label: "No data", tone: "info" };
  if (achievement >= 100) return { label: "Above target", tone: "good" };
  if (achievement >= 80) return { label: "Near target", tone: "attention" };
  return { label: "Needs attention", tone: "critical" };
}

function statusBadgeClass(tone: StatusTone) {
  if (tone === "good") return "bg-green-500/10 text-green-600";
  if (tone === "attention") return "bg-yellow-500/10 text-yellow-600";
  if (tone === "critical") return "bg-red-500/10 text-red-600";
  return "bg-muted text-muted-foreground";
}

function statusBarClass(tone: StatusTone) {
  if (tone === "good") return "bg-green-500";
  if (tone === "attention") return "bg-yellow-500";
  if (tone === "critical") return "bg-red-500";
  return "bg-muted-foreground/40";
}

function statusAccentClass(tone: StatusTone) {
  if (tone === "good") return "border-t-green-500";
  if (tone === "attention") return "border-t-yellow-500";
  if (tone === "critical") return "border-t-red-500";
  return "border-t-muted-foreground/40";
}

function ExecutiveKpiCard({
  title,
  value,
  goal,
  difference,
  status,
  tooltip,
  icon: Icon,
}: {
  title: string;
  value: string;
  goal: string;
  difference: string;
  status: { label: string; tone: StatusTone };
  tooltip: string;
  icon: LucideIcon;
}) {
  const TrendIcon = status.tone === "good"
    ? TrendingUp
    : status.tone === "critical"
      ? TrendingDown
      : Minus;

  return (
    <Card className={cn("overflow-hidden border-t-2", statusAccentClass(status.tone))}>
      <CardContent className="min-h-[172px] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
              <span className="group relative inline-flex">
                <button
                  type="button"
                  className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label={`${title}: ${tooltip}`}
                >
                  <HelpCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 top-6 z-20 hidden w-56 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-left text-xs font-normal normal-case tracking-normal text-popover-foreground shadow-lg group-hover:block group-focus-within:block"
                >
                  {tooltip}
                </span>
              </span>
            </div>
            <p className="mt-3 truncate text-3xl font-bold tracking-tight text-foreground" title={value}>{value}</p>
          </div>
          <div className="rounded-xl bg-muted p-2.5">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
        <div className="mt-5 flex items-end justify-between gap-3 border-t border-border/60 pt-3">
          <div className="min-w-0 text-xs text-muted-foreground">
            <p>Goal: <span className="font-medium text-foreground">{goal}</span></p>
            <p className="mt-1 truncate" title={difference}>Difference: <span className="font-medium text-foreground">{difference}</span></p>
          </div>
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", statusBadgeClass(status.tone))}>
            <TrendIcon className="h-3.5 w-3.5" />
            {status.label}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function CampaignPerformanceItem({ row }: { row: ExecutiveRow }) {
  const achievement = Number(row.achievement ?? 0);
  const barWidth = row.hasData === false ? 0 : Math.min(Math.max(achievement, 0), 100);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", statusBarClass(row.statusTone))} />
            <p className="truncate text-sm font-semibold text-foreground" title={row.name}>{row.name}</p>
          </div>
          <p className="mt-1 pl-[18px] text-xs text-muted-foreground">{row.status}</p>
        </div>
        <p className="shrink-0 text-sm font-bold tabular-nums text-foreground">
          {row.hasData === false || row.achievement == null ? "No data" : formatPct(row.achievement)}
        </p>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${row.name} achievement`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={row.hasData === false ? undefined : Math.round(achievement)}
      >
        <div
          className={cn("h-full rounded-full transition-[width]", statusBarClass(row.statusTone))}
          style={{ width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildStats(rows: ExecutiveRow[]) {
  const includedRows = rows.filter((row) => row.hasData !== false);
  const values = includedRows.map((row) => Number(row.actual ?? row.value ?? 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  const highest = includedRows.reduce<ExecutiveRow | null>((best, row) => {
    const value = Number(row.actual ?? row.value ?? 0);
    const bestValue = Number(best?.actual ?? best?.value ?? -Infinity);
    return !best || value > bestValue ? row : best;
  }, null);
  const lowest = includedRows.reduce<ExecutiveRow | null>((worst, row) => {
    const value = Number(row.actual ?? row.value ?? 0);
    const worstValue = Number(worst?.actual ?? worst?.value ?? Infinity);
    return !worst || value < worstValue ? row : worst;
  }, null);

  return { total, average: average(values), highest, lowest };
}

function NoData({ message = "No data available" }: { message?: string }) {
  return <p className="text-sm text-muted-foreground py-10 text-center">{message}</p>;
}

function ExecutiveSnapshot({ rows, overallStatus }: { rows: ExecutiveRow[]; overallStatus?: { label: string; tone: StatusTone } }) {
  const stats = buildStats(rows);
  const items = [
    { label: "Highest", value: stats.highest ? stats.highest.name : "No data", detail: stats.highest ? formatNumber(stats.highest.actual ?? stats.highest.value) : "" },
    { label: "Lowest", value: stats.lowest ? stats.lowest.name : "No data", detail: stats.lowest ? formatNumber(stats.lowest.actual ?? stats.lowest.value) : "" },
    { label: "Average", value: formatNumber(stats.average) },
    {
      label: "Overall",
      value: overallStatus?.label ?? "Information",
      tone: overallStatus?.tone ?? "info",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">{item.label}</p>
          {!("tone" in item) && (
            <p className="mt-1 truncate text-sm font-semibold text-foreground" title={item.value}>
              {item.value}
            </p>
          )}
          {"detail" in item && item.detail && (
            <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
          )}
          {"tone" in item && (
            <span className={cn("mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold", statusBadgeClass(item.tone ?? "info"))}>
              {item.value}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function TableToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-9 gap-1.5"
      aria-expanded={open}
      onClick={onClick}
    >
      <Table2 className="h-4 w-4" />
      {open ? "Hide Table" : "View Table"}
      <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
    </Button>
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
              <TableCell className="text-right">
                {row.hasData === false ? "No data" : formatNumber(row.actual ?? row.value)}
              </TableCell>
              <TableCell className="text-right">
                {row.achievement == null ? "N/A" : (
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold", statusBadgeClass(row.statusTone))}>
                    {formatPct(row.achievement)}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {row.hasData === false || row.contribution == null ? "N/A" : formatPct(row.contribution)}
              </TableCell>
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
  tableOpen,
  onTableToggle,
  children,
  valueLabel,
  tableTitle,
  tableDescription,
  overallStatus,
  noDataMessage = "No data available",
}: {
  title: string;
  insight: string;
  explanation: string;
  rows: ExecutiveRow[];
  tableOpen: boolean;
  onTableToggle: () => void;
  children: ReactNode;
  valueLabel?: string;
  tableTitle?: string;
  tableDescription?: string;
  overallStatus?: { label: string; tone: StatusTone };
  noDataMessage?: string;
}) {
  return (
    <Card>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{insight}</p>
          </div>
          <TableToggle open={tableOpen} onClick={onTableToggle} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <ExecutiveSnapshot rows={rows} overallStatus={overallStatus} />
        {rows.length > 0 ? (
          <>
            {children}
            {tableOpen && (
              <section className="space-y-3" aria-label={tableTitle || `${title} table`}>
                {tableTitle && (
                  <div>
                    <p className="text-sm font-semibold text-foreground">{tableTitle}</p>
                    {tableDescription && <p className="mt-1 text-xs text-muted-foreground">{tableDescription}</p>}
                  </div>
                )}
                <ChartTable rows={rows} valueLabel={valueLabel} noDataMessage={noDataMessage} />
              </section>
            )}
          </>
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
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({
    daily: false,
    distribution: false,
    leaderboard: false,
  });
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);
  const [showCampaignDetails, setShowCampaignDetails] = useState(false);
  const [showDetailedAnalytics, setShowDetailedAnalytics] = useState(false);

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

  const apiUrl = `/api/dashboard?year=${year}&month=${month}${selectedCampaignId ? `&campaignId=${selectedCampaignId}` : ""}&dataVersion=3`;
  const { data, isLoading, mutate } = useSWR<DashboardData>(apiUrl, fetcher, {
    refreshInterval: 30000,
    revalidateOnMount: true,
    revalidateOnFocus: true,
    dedupingInterval: 5000,
    keepPreviousData: true,
  });

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

  const { campaignTotal, campaignRows } = useMemo(() => {
    const total = campaignTable.reduce((sum, campaign) => sum + Number(campaign.mtd || 0), 0);
    const rows: ExecutiveRow[] = [...campaignTable]
      .sort((a, b) => {
        if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
        return a.hasData
          ? Number(b.achievement ?? -Infinity) - Number(a.achievement ?? -Infinity)
          : a.campaignName.localeCompare(b.campaignName);
      })
      .map((campaign, index) => {
        const statusInfo = campaign.hasData
          ? getStatus(campaign.achievement)
          : { label: "No production data", tone: "info" as const };
        return {
          name: campaign.campaignName,
          hasData: campaign.hasData,
          achievement: campaign.hasData ? campaign.achievement : null,
          value: campaign.achievement,
          actual: campaign.hasData ? campaign.mtd ?? undefined : undefined,
          goal: campaign.goal,
          contribution: total > 0 ? (Number(campaign.mtd || 0) / total) * 100 : 0,
          rank: index + 1,
          status: statusInfo.label,
          statusTone: statusInfo.tone,
          recommendation: !campaign.hasData
            ? "Import or verify production data for the selected period."
            : statusInfo.tone === "good"
            ? "Maintain momentum and protect current output."
            : "Review blockers and focus management attention here.",
        };
      });

    return { campaignTotal: total, campaignRows: rows };
  }, [campaignTable]);

  const distributionRows = useMemo<ExecutiveRow[]>(() => distribution
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
    .map((row, index) => ({ ...row, rank: index + 1 })),
  [campaignTable, campaignTotal, distribution]);

  const dailyRows = useMemo<ExecutiveRow[]>(() => {
    const total = dailyTrend.reduce((sum, day) => sum + day.value, 0);
    return [...dailyTrend]
      .sort((a, b) => b.value - a.value)
      .map((day, index) => ({
        name: day.date,
        date: day.date,
        value: day.value,
        actual: day.value,
        goal: null,
        achievement: null,
        contribution: total > 0 ? (day.value / total) * 100 : 0,
        rank: index + 1,
        status: "Information / Trend",
        statusTone: "info",
        recommendation: index === 0
          ? "Use this high-output day as a reference point."
          : "Compare staffing and activity against the strongest day.",
      }));
  }, [dailyTrend]);

  const leaderboardRows = useMemo<ExecutiveRow[]>(() => {
    const topLeaderboard = [...leaderboard]
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    const total = topLeaderboard.reduce((sum, item) => sum + item.value, 0);

    return topLeaderboard.map((agent, index) => {
      const agentGoal = Number(agent.goal ?? 0);
      const agentAchievement = agent.achievement == null && agentGoal > 0
        ? (agent.value / agentGoal) * 100
        : agent.achievement;
      const statusInfo = agentAchievement == null
        ? { label: index < 3 ? "Good / Top performer" : "Information", tone: index < 3 ? "good" as const : "info" as const }
        : getStatus(agentAchievement);
      return {
        name: agent.name,
        displayName: `#${index + 1} ${agent.name}`,
        value: agent.value,
        actual: agent.value,
        goal: agentGoal > 0 ? agentGoal : null,
        achievement: agentAchievement,
        contribution: total > 0 ? (agent.value / total) * 100 : 0,
        rank: index + 1,
        status: statusInfo.label,
        statusTone: statusInfo.tone,
        recommendation: agentAchievement == null
          ? index < 3
            ? "Maintain performance and share effective practices."
            : "Review activity level and support consistent output."
          : statusInfo.tone === "good"
            ? "Maintain performance and share effective practices."
            : "Review the agent target, activity level, and production blockers.",
      };
    });
  }, [leaderboard]);

  const performanceCampaignRows = campaignRows.filter((row) => row.hasData !== false);
  const campaignsWithoutData = campaignRows.length - performanceCampaignRows.length;
  const bestCampaign = performanceCampaignRows[0];
  const lowestCampaign = [...performanceCampaignRows].sort((a, b) => Number(a.achievement ?? 0) - Number(b.achievement ?? 0))[0];
  const weakestCampaign = performanceCampaignRows.find((row) => row.statusTone === "critical") ?? performanceCampaignRows.find((row) => row.statusTone === "attention");
  const overallStatusInfo = performanceCampaignRows.length > 0
    ? getStatus(kpis.avgAchievement)
    : { label: "No production data", tone: "info" as const };
  const overallStatus = performanceCampaignRows.length === 0
    ? "without production data"
    : kpis.avgAchievement == null ? "with a missing goal" : kpis.avgAchievement >= 100 ? "above target" : kpis.avgAchievement >= 80 ? "near target" : "below target";

  const ceoSummary = performanceCampaignRows.length > 0
    ? [
        `Total MTD is ${overallStatus} at ${formatPct(kpis.avgAchievement)} achievement.`,
        `${bestCampaign?.name ?? "The leading campaign"} leads, while ${lowestCampaign?.name ?? "the lowest campaign"} is furthest from target.`,
        weakestCampaign
          ? `${weakestCampaign.name} is the immediate priority${campaignsWithoutData > 0 ? `, with ${campaignsWithoutData} campaign${campaignsWithoutData === 1 ? "" : "s"} also missing production data` : ""}.`
          : campaignsWithoutData > 0
            ? `${campaignsWithoutData} campaign${campaignsWithoutData === 1 ? " has" : "s have"} no production data and should be verified.`
            : "No campaign currently requires urgent intervention.",
      ]
    : ["No production data is available for the selected period."];

  const underTargetActions: PriorityAction[] = [...performanceCampaignRows]
    .filter((row) => Number(row.achievement ?? 0) < 100)
    .sort((a, b) => Number(a.achievement ?? 0) - Number(b.achievement ?? 0))
    .map((row) => ({
      campaign: row.name,
      issue: `${row.status} · ${formatPct(row.achievement)}`,
      action: row.recommendation,
      tone: row.statusTone,
    }));
  const noDataActions: PriorityAction[] = campaignRows
    .filter((row) => row.hasData === false)
    .map((row) => ({
      campaign: row.name,
      issue: "No production data",
      action: row.recommendation,
      tone: "info",
    }));
  const priorityActions: PriorityAction[] = [...underTargetActions, ...noDataActions];
  if (priorityActions.length === 0 && bestCampaign) {
    priorityActions.push({
      campaign: bestCampaign.name,
      issue: "Performance is on or above target",
      action: "Maintain momentum and protect current output.",
      tone: "good",
    });
  }

  const topCampaigns = performanceCampaignRows.slice(0, 5);
  const topCampaignNames = new Set(topCampaigns.map((row) => row.name));
  const bottomCampaigns = performanceCampaignRows
    .slice(-5)
    .reverse()
    .filter((row) => !topCampaignNames.has(row.name));
  const campaignPreviewRows = performanceCampaignRows.length > 0
    ? Array.from(
        new Map([...topCampaigns, ...bottomCampaigns].map((row) => [row.name, row])).values()
      )
    : campaignRows.slice(0, 10);
  const visibleCampaignRows = showAllCampaigns ? campaignRows : campaignPreviewRows;
  const campaignsBelowTarget = performanceCampaignRows.filter((row) => Number(row.achievement ?? 0) < 100).length;

  const goalValues = campaignTable
    .filter((campaign) => campaign.hasData)
    .map((campaign) => campaign.goal)
    .filter((goal): goal is number => goal != null);
  const totalGoal = goalValues.length > 0
    ? goalValues.reduce((sum, goal) => sum + goal, 0)
    : null;
  const totalMtdStatus = performanceCampaignRows.length > 0
    ? getStatus(kpis.avgAchievement)
    : { label: "No data", tone: "info" as const };
  const runRateStatus = performanceCampaignRows.length > 0
    ? getStatus(kpis.avgRRAchievement)
    : { label: "No data", tone: "info" as const };
  const loadingStatus = { label: "Loading", tone: "info" as const };
  const totalMtdDifference = kpis.totalMTD != null && totalGoal != null
    ? formatSignedCurrency(kpis.totalMTD - totalGoal)
    : "Not available";
  const runRateDifference = kpis.avgRunRate != null && totalGoal != null
    ? formatSignedCurrency(kpis.avgRunRate - totalGoal)
    : "Not available";
  const achievementDifference = kpis.avgAchievement != null
    ? formatSignedPoints(kpis.avgAchievement - 100)
    : "Not available";
  const runRateAchievementDifference = kpis.avgRRAchievement != null
    ? formatSignedPoints(kpis.avgRRAchievement - 100)
    : "Not available";
  const visiblePriorityActions = showAllRecommendations
    ? priorityActions
    : priorityActions.slice(0, 3);

  const toggleTable = (key: string) => {
    setExpandedTables((current) => ({ ...current, [key]: !current[key] }));
  };

  if (status === "loading") return <div className="p-6 text-slate-500">Loading...</div>;

  return (
    <>
      <div className="mb-8 grid gap-4 xl:grid-cols-[minmax(260px,1fr)_auto] xl:items-center">
        <PageTitle title="Executive Dashboard" subtitle="Company performance and leadership priorities at a glance" className="mb-0" />
        <div
          className={cn(
            "grid w-full items-center gap-2 rounded-2xl border border-border/70 bg-card p-2 shadow-sm xl:w-auto",
            campaigns.length > 0
              ? "sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_140px_100px_auto_auto]"
              : "sm:grid-cols-2 xl:grid-cols-[140px_100px_auto_auto]"
          )}
        >
          {campaigns.length > 0 && (
            <CampaignSelector
              campaigns={campaigns}
              selectedCampaignId={selectedCampaignId}
              onCampaignChange={setSelectedCampaignId}
              placeholder="Select campaign"
              className="min-w-0"
              labelClassName="sr-only"
              triggerClassName="h-10"
              includeAllOption
            />
          )}
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-full sm:w-[140px]">
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
            <SelectTrigger className="w-full sm:w-[100px]">
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
            className="h-10 whitespace-nowrap"
          />
          <Button type="button" variant="outline" size="sm" className="h-10 gap-2 whitespace-nowrap" onClick={() => mutate()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <section className="mb-6" aria-labelledby="executive-kpis">
        <h2 id="executive-kpis" className="sr-only">Executive KPI summary</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ExecutiveKpiCard
            title="Total MTD"
            value={isLoading ? "Loading..." : kpis.totalMTD == null ? "No data" : formatCurrency(kpis.totalMTD)}
            goal={isLoading ? "Loading..." : totalGoal == null ? "Goal missing" : formatCurrency(totalGoal)}
            difference={isLoading ? "Loading..." : totalMtdDifference}
            status={isLoading ? loadingStatus : totalMtdStatus}
            tooltip="Total month-to-date production for the selected campaign and period."
            icon={Target}
          />
          <ExecutiveKpiCard
            title="Achievement %"
            value={isLoading ? "Loading..." : kpis.avgAchievement == null ? "Goal missing" : formatPct(kpis.avgAchievement)}
            goal="100.0%"
            difference={isLoading ? "Loading..." : achievementDifference}
            status={isLoading ? loadingStatus : totalMtdStatus}
            tooltip="Current achievement against the configured monthly goal."
            icon={TrendingUp}
          />
          <ExecutiveKpiCard
            title="Run Rate"
            value={isLoading ? "Loading..." : kpis.avgRunRate == null ? "No data" : formatCurrency(kpis.avgRunRate)}
            goal={isLoading ? "Loading..." : totalGoal == null ? "Goal missing" : formatCurrency(totalGoal)}
            difference={isLoading ? "Loading..." : runRateDifference}
            status={isLoading ? loadingStatus : runRateStatus}
            tooltip="Projected end-of-period production using the existing run-rate calculation."
            icon={Activity}
          />
          <ExecutiveKpiCard
            title="Run Rate Achievement"
            value={isLoading ? "Loading..." : kpis.avgRRAchievement == null ? "Goal missing" : formatPct(kpis.avgRRAchievement)}
            goal="100.0%"
            difference={isLoading ? "Loading..." : runRateAchievementDifference}
            status={isLoading ? loadingStatus : runRateStatus}
            tooltip="Projected run rate expressed as a percentage of the configured goal."
            icon={BarChart3}
          />
        </div>
      </section>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leadership Brief</p>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Executive Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 text-sm leading-6 text-muted-foreground">
              {ceoSummary.map((sentence) => <span key={sentence} className="block">{sentence}</span>)}
            </div>
            <div className="mt-5 border-t border-border/60 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overall status</p>
              <span className={cn("mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", statusBadgeClass(overallStatusInfo.tone))}>
                {overallStatusInfo.label}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              Priority Actions
            </CardTitle>
            <p className="text-sm text-muted-foreground">The three highest-priority campaign decisions for this period.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {visiblePriorityActions.length > 0 ? visiblePriorityActions.map((item) => (
              <div key={`${item.campaign}-${item.issue}`} className="rounded-xl border border-border/60 bg-muted/20 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{item.campaign}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", statusBadgeClass(item.tone))}>
                    {item.issue}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{item.action}</p>
              </div>
            )) : (
              <NoData message="No campaign recommendations are available." />
            )}
            {priorityActions.length > 3 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full gap-1.5"
                aria-expanded={showAllRecommendations}
                onClick={() => setShowAllRecommendations((current) => !current)}
              >
                {showAllRecommendations ? "Show Top 3" : "View All Recommendations"}
                <ChevronDown className={cn("h-4 w-4 transition-transform", showAllRecommendations && "rotate-180")} />
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">Campaign Performance</CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              {showAllCampaigns ? "Showing every campaign." : "Showing the top five and bottom five campaigns by achievement."}
            </p>
          </div>
          {campaignRows.length > campaignPreviewRows.length && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              aria-expanded={showAllCampaigns}
              onClick={() => setShowAllCampaigns((current) => !current)}
            >
              {showAllCampaigns ? "Show Top & Bottom" : "View All Campaigns"}
              <ChevronDown className={cn("h-4 w-4 transition-transform", showAllCampaigns && "rotate-180")} />
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <NoData message="Loading campaign performance..." />
          ) : visibleCampaignRows.length === 0 ? (
            <NoData />
          ) : showAllCampaigns || performanceCampaignRows.length === 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {visibleCampaignRows.map((row) => <CampaignPerformanceItem key={row.name} row={row} />)}
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              <section aria-labelledby="top-campaigns">
                <div className="mb-3 flex items-center justify-between">
                  <h3 id="top-campaigns" className="text-sm font-semibold text-foreground">Top campaigns</h3>
                  <span className="text-xs text-muted-foreground">Up to 5</span>
                </div>
                <div className="space-y-3">
                  {topCampaigns.map((row) => <CampaignPerformanceItem key={row.name} row={row} />)}
                </div>
              </section>
              {bottomCampaigns.length > 0 && (
                <section aria-labelledby="bottom-campaigns">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 id="bottom-campaigns" className="text-sm font-semibold text-foreground">Bottom campaigns</h3>
                    <span className="text-xs text-muted-foreground">Up to 5</span>
                  </div>
                  <div className="space-y-3">
                    {bottomCampaigns.map((row) => <CampaignPerformanceItem key={row.name} row={row} />)}
                  </div>
                </section>
              )}
            </div>
          )}

          {visibleCampaignRows.length > 0 && (
            <div className="border-t border-border/60 pt-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                aria-expanded={showCampaignDetails}
                onClick={() => setShowCampaignDetails((current) => !current)}
              >
                <BarChart3 className="h-4 w-4" />
                {showCampaignDetails ? "Hide Campaign Chart & Data" : "View Campaign Chart & Data"}
                <ChevronDown className={cn("h-4 w-4 transition-transform", showCampaignDetails && "rotate-180")} />
              </Button>
              {showCampaignDetails && (
                <div className="mt-5 space-y-5">
                  <CampaignBarChart data={visibleCampaignRows.map((row) => ({ ...row, achievement: Number(row.achievement ?? 0) }))} />
                  <ChartTable rows={visibleCampaignRows} valueLabel="Actual" />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <section className="mb-6" aria-labelledby="executive-highlights">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="executive-highlights" className="text-base font-semibold text-foreground">Executive Highlights</h2>
          <span className="text-xs text-muted-foreground">Selected period</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Best Campaign",
              value: bestCampaign?.name ?? "No data",
              detail: bestCampaign?.achievement == null ? "No achievement data" : formatPct(bestCampaign.achievement),
              tone: bestCampaign?.statusTone ?? ("info" as StatusTone),
            },
            {
              label: "Lowest Campaign",
              value: lowestCampaign?.name ?? "No data",
              detail: lowestCampaign?.achievement == null ? "No achievement data" : formatPct(lowestCampaign.achievement),
              tone: lowestCampaign?.statusTone ?? ("info" as StatusTone),
            },
            {
              label: "Campaigns Below Target",
              value: String(campaignsBelowTarget),
              detail: "Below 100% achievement",
              tone: campaignsBelowTarget > 0 ? "critical" as StatusTone : "good" as StatusTone,
            },
            {
              label: "Campaigns With No Data",
              value: String(campaignsWithoutData),
              detail: "Selected period",
              tone: campaignsWithoutData > 0 ? "info" as StatusTone : "good" as StatusTone,
            },
          ].map((item) => (
            <Card key={item.label}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 rounded-full", statusBarClass(item.tone))} />
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</p>
                </div>
                <p className="mt-3 truncate text-lg font-bold text-foreground" title={item.value}>{item.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="mb-6 rounded-xl border border-border/70 bg-card">
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-between rounded-xl px-5 py-4 text-left"
          aria-expanded={showDetailedAnalytics}
          onClick={() => setShowDetailedAnalytics((current) => !current)}
        >
          <span>
            <span className="block font-semibold text-foreground">Detailed Analytics</span>
            <span className="mt-1 block text-xs font-normal text-muted-foreground">Daily trends, agent performance, distribution, goals, and the complete campaign table.</span>
          </span>
          <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform", showDetailedAnalytics && "rotate-180")} />
        </Button>
      </div>

      {showDetailedAnalytics && (
        <div className="mb-8 space-y-8">

        <ExecutiveChartCard
          title="Daily Trend"
          insight={dailyRows.length > 0 ? `Highest Day: ${dailyRows[0].name} | Lowest Day: ${dailyRows[dailyRows.length - 1]?.name ?? "N/A"} | Overall Status: Information / Trend` : "No data available"}
          explanation={dailyRows.length > 0 ? `This chart shows how production moves across the selected period. The strongest day is ${dailyRows[0].name}, which can help compare staffing, volume, and activity patterns.` : "No data available"}
          rows={dailyRows}
          tableOpen={expandedTables.daily}
          onTableToggle={() => toggleTable("daily")}
          valueLabel="Value"
          overallStatus={{ label: "Information / Trend", tone: "info" }}
        >
          <DailyLineChart data={[...dailyRows].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((row) => ({ ...row, date: String(row.date), value: Number(row.value ?? 0) }))} label="Sales" />
        </ExecutiveChartCard>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <ExecutiveChartCard
            title="Agent Leaderboard"
            insight={leaderboardRows.length > 0 ? `Top Agent: #1 ${leaderboardRows[0].name} with ${formatNumber(leaderboardRows[0].value)}` : "No agent data available."}
            explanation={leaderboardRows.length > 0 ? `This chart shows only the Top ${leaderboardRows.length} agents in the selected period, ranked from highest production to lowest. ${leaderboardRows[0].name} is currently leading.` : "No agent data available."}
            rows={leaderboardRows}
            tableOpen={expandedTables.leaderboard}
            onTableToggle={() => toggleTable("leaderboard")}
            valueLabel="Actual"
            overallStatus={{ label: "Top performers", tone: "good" }}
            noDataMessage="No agent data available."
          >
            <LeaderboardChart data={leaderboardRows.map((row) => ({ ...row, value: Number(row.value ?? 0) }))} />
          </ExecutiveChartCard>

          <ExecutiveChartCard
            title="Distribution"
            insight={distributionRows.length > 0 ? `Top Contributor: ${distributionRows[0].name} | Share: ${formatPct(distributionRows[0].contribution)} | Main Concern: ${weakestCampaign ? `${weakestCampaign.name} needs attention` : "No immediate concern"}` : "No data available"}
            explanation={distributionRows.length > 0 ? `This chart shows which campaign contributes the most this period. ${distributionRows[0].name} has the largest share, while ${distributionRows[distributionRows.length - 1]?.name ?? "the smallest contributor"} contributes the least.` : "No data available"}
            rows={distributionRows}
            tableOpen={expandedTables.distribution}
            onTableToggle={() => toggleTable("distribution")}
            valueLabel="Actual"
            overallStatus={overallStatusInfo}
          >
            <DistributionPieChart data={distributionRows.map((row) => ({ ...row, value: Number(row.value ?? 0) }))} />
          </ExecutiveChartCard>
        </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Complete Campaign Data</CardTitle>
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
                      <TableCell className="text-right">{c.goal == null ? "Goal missing" : c.goal.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{c.hasData && c.mtd != null ? c.mtd.toLocaleString() : "No data"}</TableCell>
                      <TableCell className="text-right">
                        {c.hasData && c.achievement != null ? (
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", kpiColorClass(c.achievement))}>
                            {c.achievement.toFixed(1)}%
                          </span>
                        ) : c.hasData ? "Goal missing" : "N/A"}
                      </TableCell>
                      <TableCell className="text-right">{c.hasData && c.runRate != null ? c.runRate.toLocaleString() : "N/A"}</TableCell>
                      <TableCell className="text-right">
                        {c.hasData && c.rrAchievement != null ? (
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", kpiColorClass(c.rrAchievement))}>
                            {c.rrAchievement.toFixed(1)}%
                          </span>
                        ) : c.hasData ? "Goal missing" : "N/A"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
        </div>
      )}
    </>
  );
}
