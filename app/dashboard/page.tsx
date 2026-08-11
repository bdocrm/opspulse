"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bell,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Eye,
  Minus,
  RefreshCw,
  Target,
  TrendingUp,
} from "lucide-react";
import { CampaignSelector } from "@/components/campaign-selector";
import { CampaignBarChart } from "@/components/charts/campaign-bar-chart";
import { DailyLineChart } from "@/components/charts/daily-line-chart";
import { DistributionPieChart } from "@/components/charts/distribution-pie-chart";
import { LeaderboardChart } from "@/components/charts/leaderboard-chart";
import { ExportButton } from "@/components/export-button";
import { PageTitle } from "@/components/layout/page-title";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  buildCampaignInsights,
  buildExecutiveSummary,
  getExecutiveStatus,
  sortByUrgency,
  type CampaignInsight,
  type ExecutiveStatus,
  type ExecutiveTone,
} from "@/lib/executive-dashboard";
import { cn } from "@/lib/utils";

interface Campaign { id: string; campaignName: string }
interface Period { year: number; month: number }
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
interface DashboardData {
  kpis: {
    totalMTD: number | null;
    avgAchievement: number | null;
    avgRunRate: number | null;
    avgRRAchievement: number | null;
    dataStatus?: string;
    warnings?: string[];
  };
  campaignTable: CampaignRow[];
  dailyTrend: { date: string; value: number }[];
  distribution: { name: string; value: number }[];
  leaderboard: { name: string; value: number; goal: number | null; achievement: number | null }[];
  availablePeriods: Period[];
  lastUpdated: string | null;
  error?: string;
}
type SortMode = "critical" | "highest" | "lowest" | "increase" | "decline" | "alphabetical";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const numberFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const currencyFmt = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

async function fetcher(url: string) {
  const response = await fetch(url, { credentials: "include", cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`Dashboard request failed (${response.status})`);
  return response.json();
}
const formatPct = (value: number | null | undefined) => value == null ? "Not available" : `${pctFmt.format(value)}%`;
const formatCurrency = (value: number | null | undefined) => value == null ? "Not available" : currencyFmt.format(value);
const formatNumber = (value: number | null | undefined) => value == null ? "Not available" : numberFmt.format(value);
const signedPoints = (value: number | null) => value == null ? "No comparison data" : `${value > 0 ? "+" : ""}${pctFmt.format(value)} pts`;

function toneClasses(tone: ExecutiveTone) {
  if (tone === "success") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-400";
  if (tone === "warning") return "border-amber-500/25 bg-amber-500/10 text-amber-400";
  if (tone === "danger") return "border-rose-500/25 bg-rose-500/10 text-rose-400";
  return "border-border bg-muted/50 text-muted-foreground";
}
function barClass(tone: ExecutiveTone) {
  if (tone === "success") return "bg-emerald-500/80";
  if (tone === "warning") return "bg-amber-500/80";
  if (tone === "danger") return "bg-rose-500/80";
  return "bg-slate-500/60";
}
function StatusBadge({ status, tone }: { status: ExecutiveStatus; tone: ExecutiveTone }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "danger" ? AlertCircle : tone === "warning" ? AlertTriangle : Minus;
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold", toneClasses(tone))}><Icon className="h-3.5 w-3.5" />{status}</span>;
}
function Trend({ value, compact = false }: { value: number | null; compact?: boolean }) {
  const Icon = value == null || value === 0 ? Minus : value > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", value == null || value === 0 ? "text-muted-foreground" : value > 0 ? "text-emerald-400" : "text-rose-400")}>
      <Icon className="h-3.5 w-3.5" />{value == null ? (compact ? "—" : "No previous-period data") : `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`}
    </span>
  );
}
function relativeTime(value: string | null | undefined, now: number) {
  if (!value) return "No source timestamp available";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Timestamp unavailable";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return "Updated just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `Last updated ${new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}`;
}

function KpiCard({ title, value, target, variance, trend, status, tone, progress, icon: Icon, loading }: {
  title: string; value: string; target: string; variance: string; trend: number | null;
  status: ExecutiveStatus; tone: ExecutiveTone; progress?: number | null; icon: typeof Target; loading: boolean;
}) {
  return (
    <Card className="group overflow-hidden transition-colors duration-200 hover:border-primary/30">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
            {loading ? <Skeleton className="mt-3 h-9 w-32" /> : <p className="mt-2 truncate text-3xl font-bold tracking-tight" title={value}>{value}</p>}
          </div>
          <span className="rounded-xl border border-border/70 bg-muted/30 p-2.5"><Icon className="h-5 w-5 text-muted-foreground" /></span>
        </div>
        {loading ? <><Skeleton className="mt-5 h-2 w-full" /><Skeleton className="mt-4 h-4 w-3/4" /></> : <>
          {progress != null && <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><div className={cn("h-full rounded-full transition-[width] duration-200", barClass(tone))} style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }} /></div>}
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 text-xs">
            <div><p className="text-muted-foreground">Target</p><p className="mt-1 truncate font-medium">{target}</p></div>
            <div><p className="text-muted-foreground">Variance</p><p className="mt-1 truncate font-medium">{variance}</p></div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><Trend value={trend} compact /><StatusBadge status={status} tone={tone} /></div>
        </>}
      </CardContent>
    </Card>
  );
}

function EmptyState({ kind, periodLabel, canConfigure, onSelectPeriod }: { kind: "production" | "target"; periodLabel: string; canConfigure: boolean; onSelectPeriod?: () => void }) {
  const target = kind === "target";
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 px-6 py-10 text-center">
      {target ? <Target className="h-7 w-7 text-muted-foreground" /> : <BarChart3 className="h-7 w-7 text-muted-foreground" />}
      <p className="mt-4 text-sm font-semibold uppercase tracking-wide">{target ? "Target not configured" : "No production data"}</p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{target ? "A valid target is required before achievement can be evaluated." : `No production records are available for ${periodLabel}.`}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {onSelectPeriod && <Button type="button" size="sm" variant="outline" onClick={onSelectPeriod}>Select latest period</Button>}
        {target && canConfigure && <Button asChild size="sm"><Link href="/campaigns/goals">Configure target</Link></Button>}
      </div>
    </div>
  );
}

function CampaignQuickView({ campaign, open, onOpenChange }: { campaign: CampaignInsight | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!campaign) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{campaign.campaignName}</DialogTitle><DialogDescription>Campaign performance quick view for the selected reporting period.</DialogDescription></DialogHeader>
        <div className="mt-2 flex flex-wrap items-center gap-3"><StatusBadge status={campaign.status} tone={campaign.tone} /><Trend value={campaign.trend} /></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[['Actual', formatNumber(campaign.mtd)], ['Target', formatNumber(campaign.goal)], ['Achievement', formatPct(campaign.achievement)], ['Run rate', formatNumber(campaign.runRate)], ['Forecast', formatPct(campaign.forecast)], ['Trend', signedPoints(campaign.trend)]].map(([label, value]) => <div key={label} className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}
        </div>
        <div className="rounded-xl border border-border/70 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Primary issue</p><p className="mt-2 text-sm">{campaign.reason}</p><p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recommended action</p><p className="mt-2 text-sm">{campaign.recommendation}</p></div>
        <Button asChild className="w-full sm:w-auto"><Link href="/reports/campaigns">Open campaign reports <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
      </DialogContent>
    </Dialog>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const { data: session, status: sessionStatus } = useSession();
  const currentDate = useMemo(() => new Date(), []);
  const [year, setYear] = useState(currentDate.getFullYear());
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("critical");
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);
  const [showDetailedAnalytics, setShowDetailedAnalytics] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignInsight | null>(null);
  const [clock, setClock] = useState(Date.now());
  const didAutoJump = useRef(false);

  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session?.user) router.push("/login");
    else if ((session.user as { role?: string }).role === "AGENT") router.push("/collector");
  }, [router, session, sessionStatus]);

  const { data: campaignsData } = useSWR<Campaign[]>("/api/campaigns", fetcher);
  const campaigns = Array.isArray(campaignsData) ? campaignsData : [];
  const apiUrl = `/api/dashboard?year=${year}&month=${month}${selectedCampaignId ? `&campaignId=${selectedCampaignId}` : ""}&dataVersion=4`;
  const { data, error, isLoading, isValidating, mutate } = useSWR<DashboardData>(apiUrl, fetcher, { refreshInterval: 30_000, revalidateOnFocus: true, dedupingInterval: 5_000 });
  const previousPeriod = month === 0 ? { year: year - 1, month: 0 } : month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const previousUrl = `/api/dashboard?year=${previousPeriod.year}&month=${previousPeriod.month}${selectedCampaignId ? `&campaignId=${selectedCampaignId}` : ""}&dataVersion=4`;
  const { data: previousData } = useSWR<DashboardData>(previousUrl, fetcher, { revalidateOnFocus: false, refreshInterval: 0, dedupingInterval: 30_000 });

  const rows = data?.campaignTable ?? [];
  const insights = useMemo(() => buildCampaignInsights(rows, previousData?.campaignTable ?? []), [rows, previousData?.campaignTable]);
  const productionRows = insights.filter((item) => item.hasData);
  const measurable = insights.filter((item) => item.achievement != null);
  const overallMetric = {
    hasData: productionRows.length > 0,
    goal: productionRows.some((item) => item.goal != null && item.goal > 0) ? 1 : null,
    achievement: data?.kpis.avgAchievement ?? null,
  };
  const overall = getExecutiveStatus(overallMetric);
  const summary = useMemo(() => buildExecutiveSummary(insights, data?.kpis.avgAchievement ?? null), [insights, data?.kpis.avgAchievement]);
  const urgent = sortByUrgency(insights).filter((item) => !["Excellent", "On Track"].includes(item.status));
  const priorities = urgent.length > 0 ? urgent : sortByUrgency(insights).slice(-1);
  const topPerformers = [...measurable].sort((a, b) => Number(b.achievement) - Number(a.achievement)).slice(0, 5);
  const needsAttention = sortByUrgency(insights).filter((item) => !["Excellent", "On Track"].includes(item.status)).slice(0, 5);
  const health = insights.reduce<Record<ExecutiveStatus, number>>((counts, item) => ({ ...counts, [item.status]: (counts[item.status] ?? 0) + 1 }), { Excellent: 0, "On Track": 0, Watch: 0, "At Risk": 0, Critical: 0, "Target Missing": 0, "No Data": 0 });
  const totalGoal = rows.filter((item) => item.goal != null && item.goal > 0).reduce((sum, item) => sum + Number(item.goal), 0) || null;
  const previousKpis = previousData?.kpis;
  const periodLabel = month === 0 ? `${year}` : `${MONTH_NAMES[month - 1]} ${year}`;
  const compareLabel = previousPeriod.month === 0 ? `${previousPeriod.year}` : `${MONTH_NAMES[previousPeriod.month - 1]} ${previousPeriod.year}`;
  const availablePeriods = data?.availablePeriods ?? [];
  const yearOptions = [...new Set([currentDate.getFullYear(), year, ...availablePeriods.map((item) => item.year)])].sort((a, b) => b - a);
  const canConfigure = ["CEO", "OM"].includes((session?.user as { role?: string } | undefined)?.role ?? "");

  const sortedCampaigns = useMemo(() => {
    const result = [...insights];
    if (sortMode === "critical") return sortByUrgency(result);
    if (sortMode === "highest") return result.sort((a, b) => Number(b.achievement ?? -Infinity) - Number(a.achievement ?? -Infinity));
    if (sortMode === "lowest") return result.sort((a, b) => Number(a.achievement ?? Infinity) - Number(b.achievement ?? Infinity));
    if (sortMode === "increase") return result.sort((a, b) => Number(b.trend ?? -Infinity) - Number(a.trend ?? -Infinity));
    if (sortMode === "decline") return result.sort((a, b) => Number(a.trend ?? Infinity) - Number(b.trend ?? Infinity));
    return result.sort((a, b) => a.campaignName.localeCompare(b.campaignName));
  }, [insights, sortMode]);
  const visibleCampaigns = showAllCampaigns ? sortedCampaigns : sortedCampaigns.slice(0, 10);
  const maxWorkingDays = Math.max(0, ...rows.map((row) => row.workingDays));
  const dailyGoal = totalGoal != null && maxWorkingDays > 0 ? totalGoal / maxWorkingDays : null;
  const trendData = (data?.dailyTrend ?? []).map((item) => ({ ...item, goal: dailyGoal }));
  const alerts = priorities.slice(0, 4);

  useEffect(() => {
    if (didAutoJump.current || !data || availablePeriods.length === 0) return;
    didAutoJump.current = true;
    if (!availablePeriods.some((period) => period.year === year && period.month === month)) {
      setYear(availablePeriods[0].year);
      setMonth(availablePeriods[0].month);
    }
  }, [availablePeriods, data, month, year]);

  const selectLatestPeriod = () => {
    const latest = availablePeriods[0];
    if (latest) { setYear(latest.year); setMonth(latest.month); }
  };
  const refresh = async () => {
    try { await mutate(); addToast("success", "Dashboard data refreshed."); }
    catch { addToast("error", "Unable to refresh dashboard data. Please try again."); }
  };

  if (sessionStatus === "loading") return <div className="space-y-4 p-2"><Skeleton className="h-10 w-72" /><Skeleton className="h-48 w-full" /></div>;
  if (error && !data) return <div className="flex min-h-[55vh] items-center justify-center"><Card className="w-full max-w-lg"><CardContent className="flex flex-col items-center p-8 text-center"><AlertCircle className="h-9 w-9 text-rose-400" /><h1 className="mt-4 text-lg font-semibold">Unable to load dashboard data</h1><p className="mt-2 text-sm text-muted-foreground">Please try refreshing the page. Technical details have been withheld.</p><Button className="mt-5" onClick={() => mutate()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></CardContent></Card></div>;

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <header className="grid gap-4 xl:grid-cols-[minmax(260px,1fr)_minmax(620px,auto)] xl:items-start">
        <div><PageTitle title="Executive Dashboard" subtitle="Company performance and leadership priorities at a glance" className="mb-0" /><div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="rounded-full border bg-muted/30 px-2.5 py-1">{selectedCampaignId ? campaigns.find((item) => item.id === selectedCampaignId)?.campaignName : "All Campaigns"}</span><span className="rounded-full border bg-muted/30 px-2.5 py-1">{periodLabel}</span><span className="rounded-full border bg-muted/30 px-2.5 py-1">Compare: {compareLabel}</span></div></div>
        <div className="rounded-2xl border border-border/70 bg-card p-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(190px,1fr)_140px_100px_auto_auto]">
            <CampaignSelector campaigns={campaigns} selectedCampaignId={selectedCampaignId} onCampaignChange={setSelectedCampaignId} includeAllOption labelClassName="sr-only" triggerClassName="h-10" className="min-w-0" />
            <Select value={String(month)} onValueChange={(value) => setMonth(Number(value))}><SelectTrigger aria-label="Reporting month"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">All Months</SelectItem>{MONTH_NAMES.map((name, index) => <SelectItem value={String(index + 1)} key={name}>{name}</SelectItem>)}</SelectContent></Select>
            <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}><SelectTrigger aria-label="Reporting year"><SelectValue /></SelectTrigger><SelectContent>{yearOptions.map((item) => <SelectItem value={String(item)} key={item}>{item}</SelectItem>)}</SelectContent></Select>
            <ExportButton endpoint={`/api/export/dashboard?year=${year}&month=${month}${selectedCampaignId ? `&campaignId=${selectedCampaignId}` : ""}`} className="h-10" />
            <Button variant="outline" onClick={refresh} disabled={isValidating} className="h-10"><RefreshCw className={cn("mr-2 h-4 w-4", isValidating && "animate-spin motion-reduce:animate-none")} />{isValidating ? "Refreshing" : "Refresh"}</Button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{relativeTime(data?.lastUpdated, clock)}</span>{data?.lastUpdated && <span className="hidden sm:inline">Source timestamp</span>}</div>
        </div>
      </header>

      <Card className="overflow-hidden border-primary/20">
        <CardContent className="grid gap-6 p-5 lg:grid-cols-[1.1fr_1fr_0.9fr] lg:p-6">
          <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Overall performance</p>{isLoading ? <><Skeleton className="mt-4 h-12 w-44" /><Skeleton className="mt-4 h-6 w-28" /></> : <><div className="mt-3 flex flex-wrap items-end gap-3"><p className="text-5xl font-bold tracking-tight">{formatPct(data?.kpis.avgAchievement)}</p><StatusBadge status={overall.status} tone={overall.tone} /></div><p className="mt-4 text-sm text-muted-foreground">Projected month-end achievement: <span className="font-semibold text-foreground">{formatPct(data?.kpis.avgRRAchievement)}</span></p></>}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><div className="rounded-xl border bg-muted/20 p-3"><p className="text-2xl font-bold text-emerald-400">{health.Excellent + health["On Track"]}</p><p className="mt-1 text-xs text-muted-foreground">On track</p></div><div className="rounded-xl border bg-muted/20 p-3"><p className="text-2xl font-bold text-amber-400">{health.Watch + health["At Risk"]}</p><p className="mt-1 text-xs text-muted-foreground">Watch / at risk</p></div><div className="rounded-xl border bg-muted/20 p-3"><p className="text-2xl font-bold text-rose-400">{health.Critical}</p><p className="mt-1 text-xs text-muted-foreground">Critical</p></div><div className="col-span-2 rounded-xl border bg-muted/20 p-3 sm:col-span-3"><p className="text-xs text-muted-foreground">Data coverage</p><p className="mt-1 text-sm font-semibold">{measurable.length} of {insights.length} campaigns measurable</p></div></div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4"><div className="flex items-center gap-2"><Bell className="h-4 w-4 text-amber-400" /><p className="text-xs font-semibold uppercase tracking-wide">Primary concern</p></div><p className="mt-3 text-sm leading-6 text-muted-foreground">{priorities[0] ? `${priorities[0].campaignName}: ${priorities[0].reason}` : "No campaign issues are currently identified."}</p>{priorities[0] && <button className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedCampaign(priorities[0])}>Review campaign <ArrowRight className="h-3.5 w-3.5" /></button>}</div>
        </CardContent>
      </Card>

      <section aria-labelledby="kpi-heading"><h2 id="kpi-heading" className="sr-only">Key performance indicators</h2><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Total MTD" value={rows.length === 0 ? "No production data" : formatCurrency(data?.kpis.totalMTD)} target={totalGoal == null ? "Target not configured" : formatCurrency(totalGoal)} variance={data?.kpis.totalMTD != null && totalGoal != null ? formatCurrency(data.kpis.totalMTD - totalGoal) : "Not available"} trend={data?.kpis.totalMTD != null && previousKpis?.totalMTD != null && previousKpis.totalMTD !== 0 ? ((data.kpis.totalMTD - previousKpis.totalMTD) / Math.abs(previousKpis.totalMTD)) * 100 : null} status={overall.status} tone={overall.tone} progress={data?.kpis.avgAchievement} icon={Target} loading={isLoading} />
        <KpiCard title="Achievement" value={data?.kpis.avgAchievement == null ? "Target not configured" : formatPct(data.kpis.avgAchievement)} target="100.0%" variance={data?.kpis.avgAchievement == null ? "Not available" : signedPoints(data.kpis.avgAchievement - 100)} trend={data?.kpis.avgAchievement != null && previousKpis?.avgAchievement != null ? data.kpis.avgAchievement - previousKpis.avgAchievement : null} status={overall.status} tone={overall.tone} progress={data?.kpis.avgAchievement} icon={TrendingUp} loading={isLoading} />
        <KpiCard title="Run Rate" value={data?.kpis.avgRunRate == null ? "No production data" : formatCurrency(data.kpis.avgRunRate)} target={totalGoal == null ? "Target not configured" : formatCurrency(totalGoal)} variance={data?.kpis.avgRunRate != null && totalGoal != null ? formatCurrency(data.kpis.avgRunRate - totalGoal) : "Not available"} trend={data?.kpis.avgRunRate != null && previousKpis?.avgRunRate != null && previousKpis.avgRunRate !== 0 ? ((data.kpis.avgRunRate - previousKpis.avgRunRate) / Math.abs(previousKpis.avgRunRate)) * 100 : null} status={getExecutiveStatus({ hasData: measurable.length > 0, goal: totalGoal, achievement: data?.kpis.avgRRAchievement ?? null }).status} tone={getExecutiveStatus({ hasData: measurable.length > 0, goal: totalGoal, achievement: data?.kpis.avgRRAchievement ?? null }).tone} progress={data?.kpis.avgRRAchievement} icon={Activity} loading={isLoading} />
        <KpiCard title="Run Rate Achievement" value={data?.kpis.avgRRAchievement == null ? "Target not configured" : formatPct(data.kpis.avgRRAchievement)} target="100.0%" variance={data?.kpis.avgRRAchievement == null ? "Not available" : signedPoints(data.kpis.avgRRAchievement - 100)} trend={data?.kpis.avgRRAchievement != null && previousKpis?.avgRRAchievement != null ? data.kpis.avgRRAchievement - previousKpis.avgRRAchievement : null} status={getExecutiveStatus({ hasData: measurable.length > 0, goal: totalGoal, achievement: data?.kpis.avgRRAchievement ?? null }).status} tone={getExecutiveStatus({ hasData: measurable.length > 0, goal: totalGoal, achievement: data?.kpis.avgRRAchievement ?? null }).tone} progress={data?.kpis.avgRRAchievement} icon={BarChart3} loading={isLoading} />
      </div></section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.8fr)]">
        <Card><CardHeader className="pb-2"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Performance Trend</CardTitle><p className="mt-1 text-sm text-muted-foreground">Daily production for {periodLabel}{dailyGoal != null ? " with the daily target reference" : ""}.</p></div><span className="rounded-full border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground">MTD</span></div></CardHeader><CardContent>{isLoading ? <Skeleton className="h-[300px] w-full" /> : trendData.length === 0 ? <EmptyState kind="production" periodLabel={periodLabel} canConfigure={canConfigure} onSelectPeriod={availablePeriods.length ? selectLatestPeriod : undefined} /> : <DailyLineChart data={trendData} label="Production" />}</CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-400" />Priority Actions</CardTitle><p className="text-sm text-muted-foreground">Sorted automatically by operational urgency.</p></CardHeader><CardContent className="space-y-3">{priorities.slice(0, 4).map((item) => <button type="button" key={item.id} onClick={() => setSelectedCampaign(item)} className="w-full rounded-xl border border-border/70 bg-muted/10 p-3.5 text-left transition-colors hover:border-primary/30 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-semibold">{item.campaignName}</p><StatusBadge status={item.status} tone={item.tone} /></div><div className="mt-2 flex items-center justify-between gap-2"><span className="text-sm font-semibold">{formatPct(item.achievement)}</span><Trend value={item.trend} compact /></div><p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.reason}</p><span className="mt-3 inline-flex items-center text-xs font-semibold text-primary">View campaign <ArrowRight className="ml-1 h-3.5 w-3.5" /></span></button>)}{priorities.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No priority actions are available.</p>}</CardContent></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
        <Card><CardHeader><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Executive summary</p><div className="flex items-center gap-2"><CardTitle className="text-base">Leadership Brief</CardTitle><StatusBadge status={overall.status} tone={overall.tone} /></div></CardHeader><CardContent><p className="text-sm leading-6 text-muted-foreground">{summary.summary}</p><div className="mt-5 grid gap-5 sm:grid-cols-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">Key wins</p>{summary.wins.length ? <ul className="mt-3 space-y-2">{summary.wins.map((item) => <li key={item} className="flex gap-2 text-sm text-muted-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{item}</li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No measurable wins for this period.</p>}</div><div><p className="text-xs font-semibold uppercase tracking-wide text-rose-400">Key risks</p>{summary.risks.length ? <ul className="mt-3 space-y-2">{summary.risks.map((item) => <li key={item} className="flex gap-2 text-sm text-muted-foreground"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />{item}</li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No material campaign risks identified.</p>}</div></div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Forecast & Alerts</CardTitle></CardHeader><CardContent><div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Projected month-end achievement</p><p className="mt-2 text-3xl font-bold">{formatPct(data?.kpis.avgRRAchievement)}</p><p className="mt-2 text-xs text-muted-foreground">Based on the existing OpsView run-rate calculation.</p></div><div className="mt-4 space-y-2">{alerts.slice(0, 3).map((item) => <button key={item.id} onClick={() => setSelectedCampaign(item)} className="flex w-full items-start gap-2 rounded-lg p-2 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Bell className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" /><span><span className="font-medium">{item.campaignName}</span><span className="block text-xs text-muted-foreground">{item.status === "No Data" ? "Production data missing" : item.status === "Target Missing" ? "Target missing" : `${formatPct(item.achievement)} achievement`}</span></span></button>)}</div></CardContent></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Top Performers</CardTitle><p className="text-sm text-muted-foreground">Ranked by achievement against configured target.</p></CardHeader><CardContent>{topPerformers.length ? <div className="space-y-2">{topPerformers.map((item, index) => <button key={item.id} onClick={() => setSelectedCampaign(item)} className="grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-transparent p-3 text-left hover:border-border hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-bold">{index + 1}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{item.campaignName}</span><Trend value={item.trend} compact /></span><span className="text-right"><span className="block text-sm font-bold">{formatPct(item.achievement)}</span><span className="mt-1 block"><StatusBadge status={item.status} tone={item.tone} /></span></span></button>)}</div> : <EmptyState kind="target" periodLabel={periodLabel} canConfigure={canConfigure} />}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Needs Attention</CardTitle><p className="text-sm text-muted-foreground">Below target, declining, projected shortfalls, or missing required data.</p></CardHeader><CardContent>{needsAttention.length ? <div className="space-y-2">{needsAttention.map((item) => <button key={item.id} onClick={() => setSelectedCampaign(item)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-transparent p-3 text-left hover:border-border hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0"><span className="block truncate text-sm font-semibold">{item.campaignName}</span><span className="mt-1 block text-xs text-muted-foreground">{item.status === "Target Missing" || item.status === "No Data" ? item.reason : `${item.achievement == null ? "Achievement unavailable" : `${(100 - item.achievement).toFixed(1)} points below target`}`}</span></span><span className="shrink-0 text-right"><StatusBadge status={item.status} tone={item.tone} /><span className="mt-1 block"><Trend value={item.trend} compact /></span></span></button>)}</div> : <div className="py-12 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" /><p className="mt-3 text-sm font-semibold">No campaigns need attention</p><p className="mt-1 text-sm text-muted-foreground">All measurable campaigns are on track.</p></div>}</CardContent></Card>
      </div>

      <Card><CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle className="text-base">All Campaign Performance</CardTitle><p className="mt-1 text-sm text-muted-foreground">A compact, decision-oriented view of every selected campaign.</p></div><div className="flex flex-wrap gap-2"><Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}><SelectTrigger className="w-[190px]" aria-label="Sort campaigns"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="critical">Critical First</SelectItem><SelectItem value="highest">Highest Achievement</SelectItem><SelectItem value="lowest">Lowest Achievement</SelectItem><SelectItem value="increase">Biggest Increase</SelectItem><SelectItem value="decline">Biggest Decline</SelectItem><SelectItem value="alphabetical">Alphabetical</SelectItem></SelectContent></Select></div></CardHeader><CardContent>
        {isLoading ? <div className="space-y-3">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}</div> : insights.length === 0 ? <EmptyState kind="production" periodLabel={periodLabel} canConfigure={canConfigure} onSelectPeriod={availablePeriods.length ? selectLatestPeriod : undefined} /> : <><div className="hidden overflow-x-auto md:block"><Table><TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Target</TableHead><TableHead className="min-w-[160px]">Achievement</TableHead><TableHead className="text-right">Run Rate</TableHead><TableHead>Trend</TableHead><TableHead className="text-right">Forecast</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">View</span></TableHead></TableRow></TableHeader><TableBody>{visibleCampaigns.map((item) => <TableRow key={item.id} tabIndex={0} className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => setSelectedCampaign(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedCampaign(item); }}><TableCell className="font-medium">{item.campaignName}</TableCell><TableCell className="text-right tabular-nums">{formatNumber(item.mtd)}</TableCell><TableCell className="text-right tabular-nums">{formatNumber(item.goal)}</TableCell><TableCell><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", barClass(item.tone))} style={{ width: `${Math.min(Math.max(item.achievement ?? 0, 0), 100)}%` }} /></div><span className="text-xs font-semibold tabular-nums">{formatPct(item.achievement)}</span></div></TableCell><TableCell className="text-right tabular-nums">{formatNumber(item.runRate)}</TableCell><TableCell><Trend value={item.trend} compact /></TableCell><TableCell className="text-right tabular-nums">{formatPct(item.forecast)}</TableCell><TableCell><StatusBadge status={item.status} tone={item.tone} /></TableCell><TableCell><Eye className="h-4 w-4 text-muted-foreground" /></TableCell></TableRow>)}</TableBody></Table></div><div className="space-y-3 md:hidden">{visibleCampaigns.map((item) => <button key={item.id} onClick={() => setSelectedCampaign(item)} className="w-full rounded-xl border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex items-start justify-between gap-2"><p className="font-semibold">{item.campaignName}</p><StatusBadge status={item.status} tone={item.tone} /></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-muted-foreground">Achievement</p><p className="mt-1 font-semibold">{formatPct(item.achievement)}</p></div><div><p className="text-xs text-muted-foreground">Trend</p><p className="mt-1"><Trend value={item.trend} compact /></p></div><div><p className="text-xs text-muted-foreground">Actual / Target</p><p className="mt-1 font-semibold">{formatNumber(item.mtd)} / {formatNumber(item.goal)}</p></div><div><p className="text-xs text-muted-foreground">Forecast</p><p className="mt-1 font-semibold">{formatPct(item.forecast)}</p></div></div></button>)}</div>{sortedCampaigns.length > 10 && <Button variant="ghost" className="mt-4 w-full" onClick={() => setShowAllCampaigns((value) => !value)}>{showAllCampaigns ? "Show first 10" : `View all ${sortedCampaigns.length} campaigns`}<ChevronDown className={cn("ml-2 h-4 w-4 transition-transform", showAllCampaigns && "rotate-180")} /></Button>}</>}
      </CardContent></Card>

      <Card><Button type="button" variant="ghost" className="h-auto w-full justify-between rounded-xl px-5 py-4 text-left" onClick={() => setShowDetailedAnalytics((value) => !value)} aria-expanded={showDetailedAnalytics}><span><span className="block font-semibold">Detailed Analytics</span><span className="mt-1 block text-xs font-normal text-muted-foreground">Existing campaign chart, agent leaderboard, and distribution views.</span></span><ChevronDown className={cn("h-5 w-5 transition-transform", showDetailedAnalytics && "rotate-180")} /></Button>{showDetailedAnalytics && <CardContent className="grid gap-6 border-t pt-6 lg:grid-cols-2"><div className="lg:col-span-2"><h3 className="mb-3 text-sm font-semibold">Campaign Achievement</h3>{measurable.length ? <CampaignBarChart data={[...measurable].sort((a, b) => Number(b.achievement) - Number(a.achievement)).map((item, index) => ({ name: item.campaignName, achievement: Number(item.achievement), actual: item.mtd ?? undefined, goal: item.goal, rank: index + 1, status: item.status, recommendation: item.recommendation, hasData: item.hasData }))} /> : <p className="py-16 text-center text-sm text-muted-foreground">No campaign achievement data available.</p>}</div><div><h3 className="mb-3 text-sm font-semibold">Agent Leaderboard</h3>{data?.leaderboard?.length ? <LeaderboardChart data={data.leaderboard.map((item, index) => ({ ...item, rank: index + 1, status: item.achievement != null ? getExecutiveStatus({ hasData: true, goal: item.goal, achievement: item.achievement }).status : "No Data", recommendation: "Review agent activity and target attainment." }))} /> : <p className="py-16 text-center text-sm text-muted-foreground">No agent data available.</p>}</div><div><h3 className="mb-3 text-sm font-semibold">Campaign Distribution</h3>{data?.distribution?.length ? <DistributionPieChart data={data.distribution} /> : <p className="py-16 text-center text-sm text-muted-foreground">No distribution data available.</p>}</div></CardContent>}</Card>

      <CampaignQuickView campaign={selectedCampaign} open={Boolean(selectedCampaign)} onOpenChange={(open) => { if (!open) setSelectedCampaign(null); }} />
    </div>
  );
}
