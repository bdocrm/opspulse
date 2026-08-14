"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { ArrowLeft, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiStatusBadge } from "@/components/kpi/kpi-status-badge";
import { KpiTrendChart } from "@/components/charts/kpi-trend-chart";
import type { KpiRecord } from "@/types/kpi";

const fetcher = async (url: string) => {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load collector KPI details.");
  return data;
};

const metrics = [
  { key: "qa", label: "QA", actual: "actualQa", goal: "goalQa", achievement: "achievementQa", unit: "%" },
  { key: "aht", label: "AHT", actual: "actualAht", goal: "goalAht", achievement: "achievementAht", unit: " sec" },
  { key: "adherence", label: "Adherence", actual: "actualAdherence", goal: "goalAdherence", achievement: "achievementAdherence", unit: "%" },
  { key: "cm", label: "CM", actual: "actualCm", goal: "goalCm", achievement: "achievementCm", unit: "%" },
  { key: "cd", label: "CD", actual: "actualCd", goal: "goalCd", achievement: "achievementCd", unit: "%" },
] as const;

function periodLabel(record: Pick<KpiRecord, "month" | "year">) {
  return new Date(Date.UTC(record.year, record.month - 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export default function CollectorKpiDetailPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const [range, setRange] = useState(6);
  const query = new URLSearchParams({
    month: search.get("month") || String(new Date().getMonth() + 1),
    year: search.get("year") || String(new Date().getFullYear()),
    ...(search.get("campaignId") ? { campaignId: search.get("campaignId") as string } : {}),
  });
  const { data, error, isLoading } = useSWR<{
    employee: { id: string; name: string; seatNumber: number | null };
    current: KpiRecord | null;
    history: KpiRecord[];
  }>(`/api/kpi/collectors/${id}?${query}`, fetcher);
  if (isLoading) return <div className="space-y-4">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className={index ? "h-40" : "h-20"} />)}</div>;
  if (error || !data) return <Card><CardContent className="p-8 text-center text-red-600">{error?.message || "Collector not found."}</CardContent></Card>;
  const current = data.current;
  const history = data.history.slice(-range);
  const currentIndex = current ? data.history.findIndex((record) => record.id === current.id) : -1;
  const previous = currentIndex > 0 ? data.history[currentIndex - 1] : null;
  return (
    <div className="space-y-6">
      <Link href="/performance/kpi"><Button variant="ghost" className="gap-2 pl-0"><ArrowLeft className="h-4 w-4" /> Back to KPI monitoring</Button></Link>
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div><p className="text-sm text-muted-foreground">Collectors / Employee / KPI Performance</p><h1 className="mt-1 text-2xl font-bold">{data.employee.name}</h1><p className="mt-1 text-sm text-muted-foreground">{current?.tenure || "Tenure not provided"} · Seat {data.employee.seatNumber ?? "—"}</p></div>
        {current && <div className="text-left md:text-right"><p className="text-xs uppercase text-muted-foreground">Current reporting period</p><p className="font-semibold">{new Date(Date.UTC(current.year, current.month - 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</p><div className="mt-1"><KpiStatusBadge status={current.status} /></div></div>}
      </div>
      {!current ? <Card><CardContent className="p-12 text-center"><p className="font-medium">No KPI history is available for this collector.</p></CardContent></Card> : <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{metrics.map((metric) => {
          const actual = current[metric.actual] as number | null;
          const goal = current[metric.goal] as number | null;
          const achievement = current[metric.achievement] as number | null;
          const previousActual = previous ? previous[metric.actual] as number | null : null;
          const change = actual != null && previousActual != null ? actual - previousActual : null;
          return <Card key={metric.key}><CardHeader className="pb-2"><CardTitle className="flex items-center justify-between text-base">{metric.label}<KpiStatusBadge status={current.metricStatuses[metric.key]} compact /></CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{actual == null ? "—" : `${actual.toFixed(2)}${metric.unit}`}</p><div className="mt-3 space-y-1 text-xs text-muted-foreground"><p>Goal: <span className="font-medium text-foreground">{goal == null ? "—" : `${goal.toFixed(2)}${metric.unit}`}</span></p><p>Achievement: <span className="font-medium text-foreground">{achievement == null ? "—" : `${(achievement * 100).toFixed(1)}%`}</span></p><p>Previous month: <span className="font-medium text-foreground">{previousActual == null ? "—" : `${previousActual.toFixed(2)}${metric.unit}`}</span></p>{change != null && <p className={`flex items-center gap-1 ${change > 0 ? "text-blue-700" : "text-slate-600"}`}>{change > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}{change > 0 ? "+" : ""}{change.toFixed(2)}{metric.unit} month over month</p>}</div></CardContent></Card>;
        })}</div>
        <Card><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">Historical KPI trends</CardTitle><div className="flex gap-1">{[3, 6, 12].map((months) => <Button key={months} size="sm" variant={range === months ? "default" : "outline"} onClick={() => setRange(months)}>{months} months</Button>)}</div></CardHeader></Card>
        <div className="grid gap-4 lg:grid-cols-2">{metrics.map((metric) => <Card key={metric.key}><CardHeader><CardTitle className="text-sm">{metric.label} trend</CardTitle></CardHeader><CardContent><KpiTrendChart unit={metric.unit} data={history.map((record) => ({ period: periodLabel(record), actual: record[metric.actual] as number | null, goal: record[metric.goal] as number | null }))} /></CardContent></Card>)}</div>
      </>}
    </div>
  );
}
