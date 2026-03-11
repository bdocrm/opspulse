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
import { Target, TrendingUp, Activity, BarChart3 } from "lucide-react";

export default function CampaignsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [period, setPeriod] = useState<FilterPeriod>("monthly");
  const [selectedId, setSelectedId] = useState<string>("");

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
  const { data: detail, isLoading } = useCampaignDetail(selectedId, period);

  const campaigns: any[] = campaignsData?.campaigns ?? [];
  const kpis = detail?.kpis ?? { mtd: 0, achievement: 0, runRate: 0, rrAchievement: 0, goal: 0 };
  const weeklyData = detail?.weeklyData ?? [];
  const dailyTrend = detail?.dailyTrend ?? [];
  const agentBreakdown = detail?.agentBreakdown ?? [];

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <PageTitle title="Campaign Monitoring" subtitle="Track campaign performance in real-time" />
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="w-[200px]">
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
          <PeriodFilter value={period} onChange={setPeriod} />
          <ExportButton endpoint={`/api/export/campaigns?campaignId=${selectedId}&period=${period}`} />
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
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard title="Monthly Goal" value={kpis.goal.toLocaleString()} icon={Target} />
            <KpiCard title="MTD" value={kpis.mtd.toLocaleString()} pct={kpis.achievement} icon={TrendingUp} />
            <KpiCard title="Run Rate" value={kpis.runRate.toLocaleString()} pct={kpis.rrAchievement} icon={Activity} />
            <KpiCard title="RR Achievement" value={`${kpis.rrAchievement.toFixed(1)}%`} pct={kpis.rrAchievement} icon={BarChart3} />
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
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Agent Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead className="text-right">MTD</TableHead>
                      <TableHead className="text-right">Achievement</TableHead>
                      <TableHead className="text-right">Run Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                      </TableRow>
                    ) : agentBreakdown.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No data</TableCell>
                      </TableRow>
                    ) : (
                      agentBreakdown.map((a: any) => (
                        <TableRow key={a.userId}>
                          <TableCell className="font-medium">{a.name}</TableCell>
                          <TableCell className="text-right">{a.mtd.toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", kpiColorClass(a.achievement))}>
                              {a.achievement.toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right">{a.runRate.toLocaleString()}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
