"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, ArrowDown, ArrowUp, Building2, FileClock, Gauge, Search, Target, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageTitle } from "@/components/layout/page-title";
import { ProductionImportDialog } from "@/components/production-monitoring/import-dialog";
import { ProductionStatusBadge } from "@/components/production-monitoring/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAchievement, formatProductionMetric } from "@/lib/production-metrics";
import type { ProductionRecordDto, ProductionStatus } from "@/types/production-monitoring";

const fetcher = async (url: string) => {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load production monitoring data.");
  return data;
};

type Options = {
  campaigns: Array<{ id: string; campaignName: string }>;
  businessUnits: Array<{ id: string; campaignId: string; businessUnitName: string }>;
  periods: Array<{ reportYear: number; reportMonth: number }>;
  metricTypes: Array<{ metricType: string; label: string; defaultUnit: string | null }>;
  canAdmin: boolean;
};
type DashboardData = {
  records: ProductionRecordDto[];
  summary: {
    campaigns: number; businessUnits: number; records: number;
    statusCounts: Record<ProductionStatus, number>;
    metricSummaries: Array<{ metricType: string; recordCount: number; target: number | null; mtd: number | null; averageAchievement: number | null }>;
  };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

const statusOptions = [
  ["ALL", "All statuses"], ["ON_TRACK", "On Track"], ["NEAR_TARGET", "Near Target"],
  ["AT_RISK", "At Risk"], ["BELOW_TARGET", "Below Target"], ["NO_DATA", "No Data"],
];

export default function ProductionMonitoringPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [campaignId, setCampaignId] = useState("ALL");
  const [businessUnitId, setBusinessUnitId] = useState("ALL");
  const [metricType, setMetricType] = useState("all");
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("campaign");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const { data: options, error: optionsError, isLoading: optionsLoading, mutate: mutateOptions } = useSWR<Options>("/api/production-monitoring/options", fetcher);
  useEffect(() => {
    const latest = options?.periods[0];
    if (latest) { setYear(latest.reportYear); setMonth(latest.reportMonth); }
  }, [options?.periods]);
  useEffect(() => { setPage(1); setBusinessUnitId("ALL"); }, [campaignId]);
  useEffect(() => setPage(1), [year, month, businessUnitId, metricType, status, search, sortBy, sortDirection]);
  const businessUnits = options?.businessUnits.filter((unit) => campaignId === "ALL" || unit.campaignId === campaignId) ?? [];
  const query = useMemo(() => {
    const params = new URLSearchParams({ month: String(month), year: String(year), page: String(page), limit: "25", sortBy, sortDirection });
    if (campaignId !== "ALL") params.set("campaignId", campaignId);
    if (businessUnitId !== "ALL") params.set("businessUnitId", businessUnitId);
    if (metricType !== "all") params.set("metricType", metricType);
    if (status !== "ALL") params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    return params.toString();
  }, [businessUnitId, campaignId, metricType, month, page, search, sortBy, sortDirection, status, year]);
  const { data, error, isLoading, mutate } = useSWR<DashboardData>(`/api/production-monitoring?${query}`, fetcher, { keepPreviousData: true });
  const refresh = () => { mutate(); mutateOptions(); };
  const selectPeriod = (value: string) => { const [nextYear, nextMonth] = value.split("-").map(Number); setYear(nextYear); setMonth(nextMonth); };
  const sort = (field: string) => { if (sortBy === field) setSortDirection((current) => current === "asc" ? "desc" : "asc"); else { setSortBy(field); setSortDirection("asc"); } };
  const SortIcon = ({ field }: { field: string }) => sortBy !== field ? null : sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  const selectedMetricSummary = data?.summary.metricSummaries.find((summary) => summary.metricType === metricType) ?? (data?.summary.metricSummaries.length === 1 ? data.summary.metricSummaries[0] : null);
  const summaryCards: Array<{ label: string; value: number; icon: LucideIcon }> = [
    { label: "Campaigns", value: data?.summary.campaigns ?? 0, icon: Building2 },
    { label: "Business Units", value: data?.summary.businessUnits ?? 0, icon: Gauge },
    { label: "On Track", value: data?.summary.statusCounts.ON_TRACK ?? 0, icon: Target },
    { label: "Near Target", value: data?.summary.statusCounts.NEAR_TARGET ?? 0, icon: TrendingUp },
    { label: "At Risk", value: data?.summary.statusCounts.AT_RISK ?? 0, icon: AlertTriangle },
    { label: "Below Target", value: data?.summary.statusCounts.BELOW_TARGET ?? 0, icon: AlertTriangle },
  ];

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
      <PageTitle className="mb-0" title="Production Monitoring" subtitle="Campaign and business-unit production performance across reporting periods." />
      {options?.canAdmin && <div className="flex flex-wrap gap-2"><Link href="/production-monitoring/admin"><Button variant="outline">Configuration</Button></Link><Link href="/production-monitoring/imports"><Button variant="outline" className="gap-2"><FileClock className="h-4 w-4" />Import history</Button></Link><ProductionImportDialog onImported={refresh} /></div>}
    </div>
    <Card><CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-6">
      <label className="text-xs font-medium text-muted-foreground">Reporting month<select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={`${year}-${month}`} onChange={(event) => selectPeriod(event.target.value)}>{options?.periods.length ? options.periods.map((period) => <option key={`${period.reportYear}-${period.reportMonth}`} value={`${period.reportYear}-${period.reportMonth}`}>{new Date(Date.UTC(period.reportYear, period.reportMonth - 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</option>) : <option value={`${year}-${month}`}>{new Date(Date.UTC(year, month - 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</option>}</select></label>
      <label className="text-xs font-medium text-muted-foreground">Campaign<select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="ALL">All campaigns</option>{options?.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.campaignName}</option>)}</select></label>
      <label className="text-xs font-medium text-muted-foreground">Business unit<select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={businessUnitId} onChange={(event) => setBusinessUnitId(event.target.value)}><option value="ALL">All business units</option>{businessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.businessUnitName}</option>)}</select></label>
      <label className="text-xs font-medium text-muted-foreground">Metric type<select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={metricType} onChange={(event) => setMetricType(event.target.value)}><option value="all">All metrics</option>{options?.metricTypes.map((metric) => <option key={metric.metricType} value={metric.metricType}>{metric.label}</option>)}</select></label>
      <label className="text-xs font-medium text-muted-foreground">Performance status<select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-xs font-medium text-muted-foreground">Search<div className="relative mt-1"><Search className="absolute left-3 top-3 h-4 w-4" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Campaign or unit" /></div></label>
    </CardContent></Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {isLoading && !data ? Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-28" />) : <>
        {summaryCards.map(({ label, value, icon: Icon }) => <Card key={label}><CardContent className="flex min-h-28 items-start justify-between pt-5"><div><p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div><Icon className="h-5 w-5 text-muted-foreground" /></CardContent></Card>)}
      </>}
    </div>
    {selectedMetricSummary && <Card><CardHeader><CardTitle className="text-base capitalize">{selectedMetricSummary.metricType} summary</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">{selectedMetricSummary.metricType === "percentage" ? "Average target" : "Total target"}</p><p className="mt-1 text-xl font-semibold">{formatProductionMetric(selectedMetricSummary.target, selectedMetricSummary.metricType)}</p></div><div><p className="text-xs text-muted-foreground">{selectedMetricSummary.metricType === "percentage" ? "Average MTD" : "Total MTD"}</p><p className="mt-1 text-xl font-semibold">{formatProductionMetric(selectedMetricSummary.mtd, selectedMetricSummary.metricType)}</p></div><div><p className="text-xs text-muted-foreground">Average achievement</p><p className="mt-1 text-xl font-semibold">{formatAchievement(selectedMetricSummary.averageAchievement)}</p></div></CardContent></Card>}
    <Card className="overflow-hidden"><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">Performance by business unit</CardTitle><span className="text-xs text-muted-foreground">{data?.pagination.total ?? 0} records</span></CardHeader><CardContent className="p-0">
      {optionsLoading || isLoading && !data ? <div className="space-y-2 p-5">{Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div> : optionsError || error ? <div className="p-10 text-center"><p className="font-medium text-red-700">{(optionsError || error)?.message}</p><Button className="mt-3" variant="outline" onClick={refresh}>Try again</Button></div> : !data?.records.length ? <div className="p-12 text-center"><p className="font-medium">No production data found for {new Date(Date.UTC(year, month - 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}.</p><p className="mt-1 text-sm text-muted-foreground">Change the filters{options?.canAdmin ? " or import a production workbook" : ""}.</p></div> : <div className="overflow-x-auto"><Table><TableHeader className="sticky top-0 bg-muted"><TableRow>
        {[['campaign','Campaign'], ['businessUnit','Business Unit']].map(([field, label]) => <TableHead key={field}><button className="flex items-center gap-1" onClick={() => sort(field)}>{label}<SortIcon field={field} /></button></TableHead>)}<TableHead>Metric</TableHead>{[["target","Target"],["week1","Week 1"],["week2","Week 2"],["week3","Week 3"],["week4","Week 4"],["week5","Week 5"],["mtd","MTD"],["achievement","Achievement"],["runRate","Run Rate"]].map(([field,label]) => <TableHead key={field}>{["target","mtd","achievement","runRate"].includes(field) ? <button className="flex items-center gap-1" onClick={() => sort(field)}>{label}<SortIcon field={field} /></button> : label}</TableHead>)}<TableHead>Status</TableHead><TableHead><button className="flex items-center gap-1" onClick={() => sort("dateUpdated")}>Last Updated<SortIcon field="dateUpdated" /></button></TableHead>
      </TableRow></TableHeader><TableBody>{data.records.map((record) => <TableRow key={record.id}><TableCell><Link className="font-medium text-primary hover:underline" href={`/production-monitoring/campaigns/${record.campaignId}?month=${month}&year=${year}`}>{record.campaignName}</Link></TableCell><TableCell><Link className="font-medium hover:text-primary hover:underline" href={`/production-monitoring/business-units/${record.businessUnitId}?metricType=${record.metricType}`}>{record.businessUnitName}</Link></TableCell><TableCell className="capitalize">{record.metricType}<p className="text-xs text-muted-foreground">{record.metricUnit}</p></TableCell>{[record.target, record.week1, record.week2, record.week3, record.week4, record.week5, record.mtd].map((value, index) => <TableCell key={index} className="tabular-nums">{formatProductionMetric(value, record.metricType, record.metricUnit)}</TableCell>)}<TableCell className="font-medium tabular-nums">{formatAchievement(record.achievement)}</TableCell><TableCell className="tabular-nums">{formatProductionMetric(record.runRate, record.metricType, record.metricUnit)}</TableCell><TableCell><ProductionStatusBadge status={record.status} /></TableCell><TableCell className="whitespace-nowrap text-sm">{record.dateUpdated ? new Date(record.dateUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—"}</TableCell></TableRow>)}</TableBody></Table></div>}
      {data && data.pagination.totalPages > 1 && <div className="flex items-center justify-between border-t p-4 text-sm"><span>Page {data.pagination.page} of {data.pagination.totalPages}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>}
    </CardContent></Card>
  </div>;
}
