"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductionStatusBadge } from "@/components/production-monitoring/status-badge";
import { formatAchievement, formatProductionMetric } from "@/lib/production-metrics";
import type { ProductionRecordDto } from "@/types/production-monitoring";

const fetcher = async (url: string) => { const response = await fetch(url); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load campaign production data."); return data; };

export default function ProductionCampaignPage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const month = Number(searchParams.get("month")) || new Date().getMonth() + 1;
  const year = Number(searchParams.get("year")) || new Date().getFullYear();
  const query = new URLSearchParams({ month: String(month), year: String(year), campaignId: params.id, limit: "100" });
  const { data, error, isLoading } = useSWR<{ records: ProductionRecordDto[]; summary: { metricSummaries: Array<{ metricType: string; target: number | null; mtd: number | null; averageAchievement: number | null }> } }>(`/api/production-monitoring?${query}`, fetcher);
  const campaignName = data?.records[0]?.campaignName ?? "Campaign";
  const period = new Date(Date.UTC(year, month - 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return <div className="space-y-6">
    <Link href={`/production-monitoring?month=${month}&year=${year}`}><Button variant="ghost" className="gap-2 pl-0"><ArrowLeft className="h-4 w-4" />Production Monitoring</Button></Link>
    <div><h1 className="text-2xl font-bold">{campaignName}</h1><p className="text-sm text-muted-foreground">{period} production performance by business unit</p></div>
    {isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-56" />)}</div> : error ? <Card><CardContent className="p-10 text-center text-red-700">{error.message}</CardContent></Card> : !data?.records.length ? <Card><CardContent className="p-12 text-center"><p className="font-medium">No Business Units found for this campaign and reporting month.</p><p className="mt-1 text-sm text-muted-foreground">Choose another period from the main dashboard.</p></CardContent></Card> : <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.summary.metricSummaries.map((metric) => <Card key={metric.metricType}><CardHeader><CardTitle className="text-base capitalize">{metric.metricType} performance</CardTitle></CardHeader><CardContent className="grid grid-cols-3 gap-3 text-sm"><div><p className="text-xs text-muted-foreground">Target</p><p className="mt-1 font-semibold">{formatProductionMetric(metric.target, metric.metricType)}</p></div><div><p className="text-xs text-muted-foreground">MTD</p><p className="mt-1 font-semibold">{formatProductionMetric(metric.mtd, metric.metricType)}</p></div><div><p className="text-xs text-muted-foreground">Achievement</p><p className="mt-1 font-semibold">{formatAchievement(metric.averageAchievement)}</p></div></CardContent></Card>)}</div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.records.map((record) => <Link key={record.id} href={`/production-monitoring/business-units/${record.businessUnitId}?metricType=${record.metricType}`} className="group"><Card className="h-full transition hover:border-primary/50 hover:shadow-md"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-primary" />{record.businessUnitName}</CardTitle><p className="text-xs capitalize text-muted-foreground">{record.metricType} · {record.metricUnit || "No unit"}</p></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-muted-foreground">Target</p><p className="font-semibold">{formatProductionMetric(record.target, record.metricType, record.metricUnit)}</p></div><div><p className="text-xs text-muted-foreground">MTD</p><p className="font-semibold">{formatProductionMetric(record.mtd, record.metricType, record.metricUnit)}</p></div><div><p className="text-xs text-muted-foreground">Achievement</p><p className="font-semibold">{formatAchievement(record.achievement)}</p></div><div><p className="text-xs text-muted-foreground">Run Rate</p><p className="font-semibold">{formatProductionMetric(record.runRate, record.metricType, record.metricUnit)}</p></div></div><ProductionStatusBadge status={record.status} /></CardContent></Card></Link>)}</div>
    </>}
  </div>;
}
