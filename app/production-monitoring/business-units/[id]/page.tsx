"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, CalendarDays, Edit3, Loader2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/toast-provider";
import { formatAchievement, formatProductionMetric, getProductionStatus } from "@/lib/production-metrics";
import { ProductionStatusBadge } from "@/components/production-monitoring/status-badge";

const fetcher = async (url: string) => { const response = await fetch(url); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load business-unit production data."); return data; };
type TrendRecord = { id: string; reportYear: number; reportMonth: number; metricType: string; metricUnit: string | null; target: number | null; week1: number | null; week2: number | null; week3: number | null; week4: number | null; week5: number | null; mtd: number | null; achievement: number | null; runRate: number | null; workingDays: number | null; daysLapse: number | null; dateUpdated: string | null };
type TrendData = { campaign?: { id: string; campaignName: string }; businessUnit?: { id: string; businessUnitName: string }; records: TrendRecord[] };
type Options = { canAdmin: boolean; metricTypes: Array<{ metricType: string; label: string }> };

function EditRecordDialog({ record, metricTypes, onSaved }: { record: TrendRecord; metricTypes: Options["metricTypes"]; onSaved: () => void }) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ metricType: record.metricType, metricUnit: record.metricUnit || "", target: record.target?.toString() || "", mtd: record.mtd?.toString() || "", achievement: record.achievement?.toString() || "", reason: "" });
  const save = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/production-monitoring/records/${record.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Update failed.");
      addToast("success", "Production record updated and audited."); setOpen(false); onSaved();
    } catch (error) { addToast("error", error instanceof Error ? error.message : "Update failed."); } finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline" className="gap-2"><Edit3 className="h-4 w-4" />Correct record</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Correct production record</DialogTitle><DialogDescription>Changes are written to the audit log with your reason.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Metric type<select className="mt-2 h-10 w-full rounded-md border bg-background px-3" value={form.metricType} onChange={(event) => setForm({ ...form, metricType: event.target.value })}>{metricTypes.map((metric) => <option key={metric.metricType} value={metric.metricType}>{metric.label}</option>)}</select></label><label className="text-sm font-medium">Metric unit<Input className="mt-2" value={form.metricUnit} onChange={(event) => setForm({ ...form, metricUnit: event.target.value })} /></label>{[["target", "Target"], ["mtd", "MTD"], ["achievement", "Achievement (decimal)"]].map(([field, label]) => <label key={field} className="text-sm font-medium">{label}<Input className="mt-2" type="number" step="any" value={form[field as keyof typeof form]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} /></label>)}</div><label className="text-sm font-medium">Reason for change<Input className="mt-2" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Required for audit history" /></label><div className="flex justify-end"><Button disabled={busy || !form.reason.trim()} onClick={save}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save audited change</Button></div></DialogContent></Dialog>;
}

export default function BusinessUnitDetailPage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const metricType = searchParams.get("metricType") || "";
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const query = new URLSearchParams({ businessUnitId: params.id, ...(metricType ? { metricType } : {}) });
  const { data, error, isLoading, mutate } = useSWR<TrendData>(`/api/production-monitoring/trends?${query}`, fetcher);
  const { data: options } = useSWR<Options>("/api/production-monitoring/options", fetcher);
  const records = useMemo(() => data?.records ?? [], [data?.records]);
  const selected = records[selectedIndex >= 0 ? selectedIndex : Math.max(0, records.length - 1)];
  const percentMetric = selected?.metricType === "percentage";
  const trendRows = useMemo(() => records.map((record) => ({
    period: new Date(Date.UTC(record.reportYear, record.reportMonth - 1)).toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
    target: percentMetric && record.target != null ? record.target * 100 : record.target,
    mtd: percentMetric && record.mtd != null ? record.mtd * 100 : record.mtd,
    achievement: record.achievement == null ? null : record.achievement * 100,
  })), [percentMetric, records]);
  const weeklyRows = selected ? [selected.week1, selected.week2, selected.week3, selected.week4, selected.week5].map((value, index) => ({ week: `Week ${index + 1}`, value: percentMetric && value != null ? value * 100 : value })) : [];
  return <div className="space-y-6">
    <Link href="/production-monitoring"><Button variant="ghost" className="gap-2 pl-0"><ArrowLeft className="h-4 w-4" />Production Monitoring</Button></Link>
    {isLoading ? <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-40" /><Skeleton className="h-80" /></div> : error ? <Card><CardContent className="p-10 text-center text-red-700">{error.message}</CardContent></Card> : !selected ? <Card><CardContent className="p-12 text-center"><p className="font-medium">No production history found for this Business Unit.</p><p className="mt-1 text-sm text-muted-foreground">Import data or choose another business unit.</p></CardContent></Card> : <>
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start"><div><p className="text-sm font-medium text-primary">{data?.campaign?.campaignName}</p><h1 className="text-2xl font-bold">{data?.businessUnit?.businessUnitName}</h1><p className="text-sm capitalize text-muted-foreground">{selected.metricType} · {selected.metricUnit || "No unit"}</p></div><div className="flex flex-wrap gap-2"><select aria-label="Reporting month" className="h-10 rounded-md border bg-background px-3 text-sm" value={records.indexOf(selected)} onChange={(event) => setSelectedIndex(Number(event.target.value))}>{records.map((record, index) => <option key={record.id} value={index}>{new Date(Date.UTC(record.reportYear, record.reportMonth - 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</option>)}</select>{options?.canAdmin && <EditRecordDialog record={selected} metricTypes={options.metricTypes} onSaved={() => mutate()} />}</div></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[["Target", formatProductionMetric(selected.target, selected.metricType, selected.metricUnit)], ["MTD", formatProductionMetric(selected.mtd, selected.metricType, selected.metricUnit)], ["Achievement", formatAchievement(selected.achievement)], ["Run Rate", formatProductionMetric(selected.runRate, selected.metricType, selected.metricUnit)], ["Working Days", selected.workingDays ?? "—"], ["Days Lapse", selected.daysLapse ?? "—"]].map(([label, value]) => <Card key={label as string}><CardContent className="min-h-28 pt-5"><p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-2 text-xl font-bold">{value}</p></CardContent></Card>)}</div>
      <div className="flex flex-wrap items-center gap-3"><ProductionStatusBadge status={getProductionStatus(selected.achievement)} />{selected.dateUpdated && <span className="flex items-center gap-1 text-sm text-muted-foreground"><CalendarDays className="h-4 w-4" />Updated {new Date(selected.dateUpdated).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>}</div>
      <div className="grid gap-4 xl:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Weekly progress</CardTitle></CardHeader><CardContent><div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={weeklyRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="week" /><YAxis /><Tooltip formatter={(value: number) => percentMetric ? `${value.toFixed(2)}%` : value.toLocaleString()} /><Bar dataKey="value" name={selected.metricUnit || "Production"} fill="#2563eb" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Monthly performance</CardTitle></CardHeader><CardContent><div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={trendRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" /><YAxis /><Tooltip /><Legend /><Line type="monotone" dataKey="target" name={`Target${percentMetric ? " (%)" : ""}`} stroke="#64748b" strokeDasharray="5 5" /><Line type="monotone" dataKey="mtd" name={`MTD${percentMetric ? " (%)" : ""}`} stroke="#2563eb" strokeWidth={2} /></LineChart></ResponsiveContainer></div></CardContent></Card></div>
      <Card><CardHeader><CardTitle className="text-base">Achievement trend</CardTitle></CardHeader><CardContent><div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={trendRows}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" /><YAxis unit="%" /><Tooltip formatter={(value: number) => `${value.toFixed(2)}%`} /><Line type="monotone" dataKey="achievement" name="Achievement" stroke="#059669" strokeWidth={3} /></LineChart></ResponsiveContainer></div></CardContent></Card>
    </>}
  </div>;
}
