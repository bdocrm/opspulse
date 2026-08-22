"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowDownRight, ArrowUpRight, BarChart3, Search, Users } from "lucide-react";
import { PageTitle } from "@/components/layout/page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CountUp } from "@/components/motion/dashboard-motion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiStatusBadge } from "@/components/kpi/kpi-status-badge";
import { KpiImportDialog } from "@/components/kpi/kpi-import-dialog";
import type { KpiRecord, KpiStatus } from "@/types/kpi";

const fetcher = async (url: string) => {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load KPI data.");
  return data;
};

type Campaign = { id: string; campaignName: string };
type MetricSummary = { actual: number | null; goal: number | null };
type Summary = {
  totalCollectors: number;
  metrics: Record<"qa" | "aht" | "adherence" | "cm" | "cd", MetricSummary>;
  statusCounts: Record<KpiStatus, number>;
  insights: {
    topPerformers: Array<{ id: string; name: string; score: number }>;
    bottomPerformers: Array<{ id: string; name: string; score: number }>;
    mostImproved: { id: string; name: string; score: number; change: number } | null;
    largestDecline: { id: string; name: string; score: number; change: number } | null;
    qaBelowGoal: number; ahtAboveGoal: number; lowAdherence: number; cmAboveGoal: number; cdAboveGoal: number;
  };
};

const metricConfig = [
  { key: "qa", label: "Average QA", actual: "actualQa", goal: "goalQa", unit: "%", lower: false },
  { key: "aht", label: "Average AHT", actual: "actualAht", goal: "goalAht", unit: " sec", lower: true },
  { key: "adherence", label: "Average Adherence", actual: "actualAdherence", goal: "goalAdherence", unit: "%", lower: false },
  { key: "cm", label: "Average CM", actual: "actualCm", goal: "goalCm", unit: "%", lower: true },
  { key: "cd", label: "Average CD", actual: "actualCd", goal: "goalCd", unit: "%", lower: true },
] as const;

function display(value: number | null, unit: string, decimals = 2) {
  return value == null ? "—" : `${value.toFixed(decimals)}${unit}`;
}

function MetricCard({ label, metric, unit, lower }: { label: string; metric?: MetricSummary; unit: string; lower: boolean }) {
  if (!metric) return <Skeleton className="h-32" />;
  const difference = metric.actual != null && metric.goal != null ? metric.actual - metric.goal : null;
  const onTarget = difference != null ? (lower ? difference <= 0 : difference >= 0) : null;
  return (
    <Card className="motion-stagger-item motion-hover-lift">
      <CardContent className="pt-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-bold tabular-nums">
          {metric.actual == null ? "—" : <CountUp value={metric.actual} decimals={2} suffix={unit} />}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Goal {lower ? "≤" : ""} {display(metric.goal, unit)}</p>
        <div className={`mt-3 flex items-center gap-1 text-xs font-medium ${onTarget == null ? "text-muted-foreground" : onTarget ? "text-green-700" : "text-red-700"}`}>
          {onTarget == null ? null : onTarget ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {difference == null ? "No comparison" : `${difference > 0 ? "+" : ""}${difference.toFixed(2)}${unit} · ${onTarget ? "Within target" : "Needs attention"}`}
        </div>
      </CardContent>
    </Card>
  );
}

export default function KpiMonitoringPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [campaignId, setCampaignId] = useState("");
  const [search, setSearch] = useState("");
  const [tenure, setTenure] = useState("ALL");
  const [kpiStatus, setKpiStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const userRole = (session?.user as { role?: string } | undefined)?.role;
  const canImport = ["CEO", "OM", "COLLECTOR"].includes(userRole || "");

  useEffect(() => { if (sessionStatus === "unauthenticated") router.replace("/login"); }, [router, sessionStatus]);
  const { data: campaignData } = useSWR<{ campaigns: Campaign[] }>(sessionStatus === "authenticated" ? "/api/kpi/campaigns" : null, fetcher);
  const campaigns = campaignData?.campaigns ?? [];
  useEffect(() => {
    if (!campaignId && campaigns.length) setCampaignId(campaigns[0].id);
  }, [campaignId, campaigns]);
  useEffect(() => setPage(1), [month, year, campaignId, search, tenure, kpiStatus]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ month: String(month), year: String(year), page: String(page), pageSize: "25" });
    if (campaignId) params.set("campaignId", campaignId);
    if (search) params.set("search", search);
    if (tenure !== "ALL") params.set("tenure", tenure);
    if (kpiStatus !== "ALL") params.set("status", kpiStatus);
    return params.toString();
  }, [campaignId, kpiStatus, month, page, search, tenure, year]);
  const enabled = sessionStatus === "authenticated" && (campaignId || userRole === "AGENT");
  const { data, error, isLoading, mutate } = useSWR<{ records: KpiRecord[]; pagination: { page: number; total: number; totalPages: number } }>(enabled ? `/api/kpi?${query}` : null, fetcher);
  const summaryQuery = new URLSearchParams({ month: String(month), year: String(year), ...(campaignId ? { campaignId } : {}) }).toString();
  const { data: summary, isLoading: summaryLoading, mutate: mutateSummary } = useSWR<Summary>(enabled ? `/api/kpi/summary?${summaryQuery}` : null, fetcher);
  const records = data?.records ?? [];
  const tenures = Array.from(new Set(records.map((record) => record.tenure).filter(Boolean) as string[])).sort();
  const refresh = () => { mutate(); mutateSummary(); };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <PageTitle title="Collector KPI Performance" subtitle="Monitor collector productivity, quality, attendance, and collection performance." />
        <div className="flex gap-2">
          {canImport && <Link href="/performance/kpi/imports"><Button variant="outline">Import history</Button></Link>}
          {canImport && <KpiImportDialog campaigns={campaigns} defaultCampaignId={campaignId} onImported={refresh} />}
        </div>
      </div>

      <Card><CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-6">
        <label className="text-xs font-medium text-muted-foreground">Month<select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={month} onChange={(event) => setMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Date(2020, index).toLocaleString("en-US", { month: "long" })}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">Year<Input className="mt-1" type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} /></label>
        <label className="text-xs font-medium text-muted-foreground">Campaign<select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={campaignId} onChange={(event) => setCampaignId(event.target.value)} disabled={userRole === "AGENT"}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.campaignName}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">Tenure<select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={tenure} onChange={(event) => setTenure(event.target.value)}><option value="ALL">All tenures</option>{tenures.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">KPI status<select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={kpiStatus} onChange={(event) => setKpiStatus(event.target.value)}><option value="ALL">All statuses</option><option value="EXCEEDS_TARGET">Exceeds target</option><option value="MEETS_TARGET">Meets target</option><option value="NEAR_TARGET">Near target</option><option value="BELOW_TARGET">Below target</option><option value="NO_DATA">No data</option></select></label>
        <label className="text-xs font-medium text-muted-foreground">Search employee<div className="relative mt-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name" /></div></label>
      </CardContent></Card>

      <div className="motion-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metricConfig.map((config) => summaryLoading ? <Skeleton key={config.key} className="h-32" /> : <MetricCard key={config.key} label={config.label} metric={summary?.metrics[config.key]} unit={config.unit} lower={config.lower} />)}
      </div>

      {summary && <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Team overview</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">{[["Collectors", summary.totalCollectors], ["Exceeds", summary.statusCounts.EXCEEDS_TARGET], ["Meeting", summary.statusCounts.MEETS_TARGET], ["Near target", summary.statusCounts.NEAR_TARGET], ["At risk", summary.statusCounts.BELOW_TARGET]].map(([label, count]) => <button key={label} className="rounded-lg border p-3 text-left transition hover:bg-accent" onClick={() => label === "At risk" && setKpiStatus("BELOW_TARGET")}><p className="text-xl font-bold">{count}</p><p className="text-xs text-muted-foreground">{label}</p></button>)}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Performance insights</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{[["QA below goal", summary.insights.qaBelowGoal], ["AHT above goal", summary.insights.ahtAboveGoal], ["Low adherence", summary.insights.lowAdherence], ["CM above goal", summary.insights.cmAboveGoal], ["CD above goal", summary.insights.cdAboveGoal]].map(([label, count]) => <button key={label} className="flex w-full justify-between rounded-md px-2 py-1.5 hover:bg-accent" onClick={() => setKpiStatus("BELOW_TARGET")}><span>{label}</span><strong>{count}</strong></button>)}</CardContent></Card>
      </div>}

      {summary && (summary.insights.topPerformers.length > 0 || summary.insights.bottomPerformers.length > 0) && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader><CardTitle className="text-sm">Top performers</CardTitle></CardHeader><CardContent className="space-y-1">{summary.insights.topPerformers.slice(0, 3).map((person) => <Link key={person.id} href={`/performance/kpi/collectors/${person.id}?month=${month}&year=${year}&campaignId=${campaignId}`} className="flex justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"><span className="truncate">{person.name}</span><strong>{(person.score * 100).toFixed(1)}%</strong></Link>)}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Bottom performers</CardTitle></CardHeader><CardContent className="space-y-1">{summary.insights.bottomPerformers.slice(0, 3).map((person) => <Link key={person.id} href={`/performance/kpi/collectors/${person.id}?month=${month}&year=${year}&campaignId=${campaignId}`} className="flex justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"><span className="truncate">{person.name}</span><strong>{(person.score * 100).toFixed(1)}%</strong></Link>)}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Most improved</CardTitle></CardHeader><CardContent>{summary.insights.mostImproved ? <Link href={`/performance/kpi/collectors/${summary.insights.mostImproved.id}?month=${month}&year=${year}&campaignId=${campaignId}`} className="block rounded-md p-2 hover:bg-accent"><p className="font-medium">{summary.insights.mostImproved.name}</p><p className="mt-1 text-sm text-green-700">+{(summary.insights.mostImproved.change * 100).toFixed(1)} points</p></Link> : <p className="text-sm text-muted-foreground">Previous-month data required.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Largest decline</CardTitle></CardHeader><CardContent>{summary.insights.largestDecline ? <Link href={`/performance/kpi/collectors/${summary.insights.largestDecline.id}?month=${month}&year=${year}&campaignId=${campaignId}`} className="block rounded-md p-2 hover:bg-accent"><p className="font-medium">{summary.insights.largestDecline.name}</p><p className="mt-1 text-sm text-red-700">{(summary.insights.largestDecline.change * 100).toFixed(1)} points</p></Link> : <p className="text-sm text-muted-foreground">Previous-month data required.</p>}</CardContent></Card>
      </div>}

      <Card className="overflow-hidden"><CardHeader className="flex-row items-center justify-between"><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4" /> Collector performance</CardTitle><span className="text-xs text-muted-foreground">{data?.pagination.total ?? 0} records</span></CardHeader><CardContent className="p-0">
        {isLoading ? <div className="space-y-2 p-5">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div> : error ? <div className="p-8 text-center text-sm text-red-600">{error.message}</div> : records.length === 0 ? <div className="p-12 text-center"><p className="font-medium">No KPI data available for this period.</p><p className="mt-1 text-sm text-muted-foreground">Import a KPI workbook or select another reporting period.</p></div> : <div className="overflow-x-auto"><Table><TableHeader className="sticky top-0 bg-muted"><TableRow><TableHead>Collector</TableHead><TableHead>Campaign</TableHead><TableHead>Tenure</TableHead>{metricConfig.map((metric) => <TableHead key={metric.key}>{metric.key.toUpperCase()}</TableHead>)}<TableHead>Overall KPI</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{records.map((record) => <TableRow key={record.id}><TableCell><p className="font-medium">{record.employeeNameSnapshot}</p><p className="text-xs text-muted-foreground">Seat {record.employee?.seatNumber ?? "—"}</p></TableCell><TableCell>{record.campaign.campaignName}</TableCell><TableCell>{record.tenure || "—"}</TableCell>{metricConfig.map((metric) => { const actual = record[metric.actual]; const goal = record[metric.goal]; return <TableCell key={metric.key}><div className="flex items-center gap-1.5"><span className="tabular-nums" title={`Goal: ${goal ?? "No goal"}`}>{display(actual as number | null, metric.unit)}</span><KpiStatusBadge status={record.metricStatuses[metric.key]} compact /></div></TableCell>; })}<TableCell className="font-semibold tabular-nums">{record.overallScore == null ? "—" : `${(record.overallScore * 100).toFixed(1)}%`}</TableCell><TableCell><KpiStatusBadge status={record.status} /></TableCell><TableCell><Link href={`/performance/kpi/collectors/${record.employeeId}?month=${month}&year=${year}&campaignId=${record.campaignId}`}><Button variant="outline" size="sm">View</Button></Link></TableCell></TableRow>)}</TableBody></Table></div>}
        {data && data.pagination.totalPages > 1 && <div className="flex items-center justify-between border-t p-4 text-sm"><span>Page {data.pagination.page} of {data.pagination.totalPages}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>}
      </CardContent></Card>
    </div>
  );
}
