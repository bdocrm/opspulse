"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { PageTitle } from "@/components/layout/page-title";
import { PeriodFilter } from "@/components/layout/period-filter";
import { ExportButton } from "@/components/export-button";
import { CampaignBarChart } from "@/components/charts/campaign-bar-chart";
import { DailyLineChart } from "@/components/charts/daily-line-chart";
import { KpiCard } from "@/components/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListSkeleton, TableSkeleton } from "@/components/skeletons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCampaigns, useCampaignDetail } from "@/hooks/use-data";
import { kpiColorClass } from "@/utils/kpi";
import { cn } from "@/lib/utils";
import type { FilterPeriod } from "@/utils/kpi";
import { Target, TrendingUp, Activity, BarChart3, ChevronDown, ChevronRight, ClipboardList } from "lucide-react";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function CampaignsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const now = new Date();
  const [period, setPeriod] = useState<FilterPeriod>("monthly");
  const [selectedId, setSelectedId] = useState<string>("");
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  const toggleEntry = (id: string) =>
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user) {
      router.push('/login');
      return;
    }
    // Restrict AGENT from accessing campaigns
    if ((session.user as any).role === 'AGENT') {
      router.push('/collector');
      return;
    }
  }, [session, status, router]);
  const { data: campaignsData } = useCampaigns();
  const { data: detail, isLoading } = useCampaignDetail(selectedId, period, month, year);

  const campaigns: any[] = Array.isArray(campaignsData)
    ? campaignsData
    : campaignsData?.campaigns ?? [];
  const kpis = detail?.kpis ?? { mtd: 0, achievement: 0, runRate: 0, rrAchievement: 0, goal: 0 };
  const weeklyData = detail?.weeklyData ?? [];
  const dailyTrend = detail?.dailyTrend ?? [];
  const agentBreakdown = detail?.agentBreakdown ?? [];
  const productionEntries: any[] = detail?.productionEntries ?? [];
  const hasProductionData = Boolean(detail?.hasProductionData);
  const yearOptions = Array.from(new Set([now.getFullYear(), now.getFullYear() - 1, year])).sort((a, b) => b - a);

  return (
    <>
      <div className="mb-6 grid gap-4 xl:grid-cols-[minmax(280px,1fr)_auto] xl:items-start">
        <PageTitle title="Campaign Monitoring" subtitle="Track campaign performance in real-time" className="mb-0" />
        <div className="grid w-full gap-2 sm:grid-cols-[minmax(180px,1fr)_140px_140px_100px_auto] xl:w-auto xl:min-w-[720px]">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select Campaign" />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.campaignName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <PeriodFilter value={period} onChange={setPeriod} className="w-full sm:w-[140px]" />
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((name, i) => (
                <SelectItem key={name} value={String(i + 1)}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-full sm:w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ExportButton
            endpoint={`/api/export/campaigns?campaignId=${selectedId}&period=${period}&month=${month}&year=${year}`}
            className="h-10 whitespace-nowrap"
          />
        </div>
      </div>

      {!selectedId ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Select a campaign to view details
          </CardContent>
        </Card>
      ) : (
        <>
          {!isLoading && !hasProductionData && (
            <Card className="mb-6">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No production data found for the selected campaign and period.
              </CardContent>
            </Card>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard title="Monthly Goal" value={kpis.goal.toLocaleString()} icon={Target} />
            <KpiCard
              title="MTD"
              value={kpis.mtd.toLocaleString()}
              pct={kpis.achievement}
              icon={TrendingUp}
            />
            <KpiCard
              title={`Run Rate${kpis.daysLapsed > 0 ? ` (Day ${kpis.daysLapsed}/${kpis.workingDays})` : ''}`}
              value={kpis.runRate.toLocaleString()}
              pct={kpis.rrAchievement}
              icon={Activity}
            />
            <KpiCard
              title="RR Achievement"
              value={`${(kpis.rrAchievement ?? 0).toFixed(1)}%`}
              pct={kpis.rrAchievement}
              icon={BarChart3}
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Weekly Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <CampaignBarChart
                  data={weeklyData.map((w: any) => ({
                    name: w.week,
                    achievement: w.value,
                  }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Daily Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <DailyLineChart data={dailyTrend} label="Value" />
              </CardContent>
            </Card>
          </div>

          {/* Agent Breakdown */}
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Agent Breakdown</CardTitle>
                {kpis.workingDays > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Day {kpis.daysLapsed ?? 0} of {kpis.workingDays} working days
                    &nbsp;·&nbsp; RR = MTD / {kpis.daysLapsed ?? 0}; RR Ach = MTD / agent goal
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead className="text-right">Goal</TableHead>
                      <TableHead className="text-right">MTD</TableHead>
                      <TableHead className="text-right">Achievement</TableHead>
                      <TableHead className="text-right">Run Rate</TableHead>
                      <TableHead className="text-right">RR Achievement</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6">
                          <TableSkeleton rows={5} columns={6} label="Loading campaign agents" />
                        </TableCell>
                      </TableRow>
                    ) : agentBreakdown.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No data for this period</TableCell>
                      </TableRow>
                    ) : (
                      agentBreakdown.map((a: any) => (
                        <TableRow key={a.userId}>
                          <TableCell className="font-medium">{a.name}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{(a.goal ?? 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right font-semibold">{a.mtd.toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", kpiColorClass(a.achievement))}>
                              {(a.achievement ?? 0).toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right">{(a.runRate ?? 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", kpiColorClass(a.rrAchievement ?? 0))}>
                              {(a.rrAchievement ?? 0).toFixed(1)}%
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

          {/* Production Entries */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">
                  Production Entries
                  {productionEntries.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ({productionEntries.length} {productionEntries.length === 1 ? "entry" : "entries"})
                    </span>
                  )}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <ListSkeleton items={4} label="Loading production entries" />
              ) : productionEntries.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground text-sm">No production entries for this period</p>
              ) : (
                <div className="space-y-2">
                  {productionEntries.map((entry: any) => {
                    const isOpen = expandedEntries.has(entry.id);
                    const totals = entry.details.reduce(
                      (acc: any, d: any) => ({
                        transmittals: acc.transmittals + d.transmittals,
                        approvals: acc.approvals + d.approvals,
                        booked: acc.booked + d.booked,
                        volume: acc.volume + d.volume,
                        transaction: acc.transaction + d.transaction,
                      }),
                      { transmittals: 0, approvals: 0, booked: 0, volume: 0, transaction: 0 }
                    );

                    return (
                      <div key={entry.id} className="border rounded-lg overflow-hidden">
                        {/* Entry header row — clickable to expand */}
                        <button
                          onClick={() => toggleEntry(entry.id)}
                          className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition text-left"
                        >
                          {isOpen
                            ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                            : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                          }
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-semibold text-slate-800">
                              {new Date(entry.date).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })}
                            </span>
                            <span className="ml-2 text-xs text-slate-500">{entry.time}</span>
                            <span className="ml-3 text-xs text-slate-400">
                              {entry.details.length} agent{entry.details.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                          {/* Totals summary */}
                          <div className="hidden sm:flex items-center gap-4 text-xs text-slate-600 shrink-0">
                            {totals.transmittals > 0 && (
                              <span><span className="text-slate-400">Trans</span> {totals.transmittals.toLocaleString()}</span>
                            )}
                            {totals.approvals > 0 && (
                              <span><span className="text-slate-400">App</span> {totals.approvals.toLocaleString()}</span>
                            )}
                            {totals.booked > 0 && (
                              <span><span className="text-slate-400">Booked</span> {totals.booked.toLocaleString()}</span>
                            )}
                            {totals.volume > 0 && (
                              <span><span className="text-slate-400">Vol</span> {totals.volume.toLocaleString()}</span>
                            )}
                          </div>
                        </button>

                        {/* Expanded detail table */}
                        {isOpen && (
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-white">
                                  <TableHead className="text-xs">Agent</TableHead>
                                  <TableHead className="text-right text-xs">Transmittals</TableHead>
                                  <TableHead className="text-right text-xs">Approvals</TableHead>
                                  <TableHead className="text-right text-xs">Booked</TableHead>
                                  <TableHead className="text-right text-xs">Volume</TableHead>
                                  <TableHead className="text-right text-xs">Transaction</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {entry.details.map((d: any, i: number) => (
                                  <TableRow key={d.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                                    <TableCell className="text-sm font-medium">{d.agentName}</TableCell>
                                    <TableCell className="text-right text-sm">
                                      {d.transmittals > 0 ? d.transmittals.toLocaleString() : <span className="text-slate-300">—</span>}
                                    </TableCell>
                                    <TableCell className="text-right text-sm">
                                      {d.approvals > 0 ? d.approvals.toLocaleString() : <span className="text-slate-300">—</span>}
                                    </TableCell>
                                    <TableCell className="text-right text-sm">
                                      {d.booked > 0 ? d.booked.toLocaleString() : <span className="text-slate-300">—</span>}
                                    </TableCell>
                                    <TableCell className="text-right text-sm">
                                      {d.volume > 0 ? d.volume.toLocaleString() : <span className="text-slate-300">—</span>}
                                    </TableCell>
                                    <TableCell className="text-right text-sm">
                                      {d.transaction > 0 ? d.transaction.toLocaleString() : <span className="text-slate-300">—</span>}
                                    </TableCell>
                                  </TableRow>
                                ))}
                                {/* Totals row */}
                                <TableRow className="bg-slate-100 font-semibold border-t-2">
                                  <TableCell className="text-xs text-slate-500">Total</TableCell>
                                  <TableCell className="text-right text-sm">{totals.transmittals > 0 ? totals.transmittals.toLocaleString() : <span className="text-slate-300">—</span>}</TableCell>
                                  <TableCell className="text-right text-sm">{totals.approvals > 0 ? totals.approvals.toLocaleString() : <span className="text-slate-300">—</span>}</TableCell>
                                  <TableCell className="text-right text-sm">{totals.booked > 0 ? totals.booked.toLocaleString() : <span className="text-slate-300">—</span>}</TableCell>
                                  <TableCell className="text-right text-sm">{totals.volume > 0 ? totals.volume.toLocaleString() : <span className="text-slate-300">—</span>}</TableCell>
                                  <TableCell className="text-right text-sm">{totals.transaction > 0 ? totals.transaction.toLocaleString() : <span className="text-slate-300">—</span>}</TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
