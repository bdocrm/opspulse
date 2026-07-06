"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { PageTitle } from "@/components/layout/page-title";
import { CampaignSelector } from "@/components/campaign-selector";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Target, TrendingUp, Activity, BarChart3 } from "lucide-react";

interface Campaign {
  id: string;
  campaignName: string;
}

interface Period {
  year: number;
  month: number;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const fetcher = (url: string) => fetch(url, { credentials: "include" }).then((r) => r.json());

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  // Selected reporting period — defaults to the current month, but auto-jumps to
  // the most recent month that actually has data on first load (see effect below).
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  // Ensures the auto-jump only runs once, so the CEO can freely browse months after.
  const didAutoJump = useRef(false);

  // Fetch campaigns for the selector
  const { data: campaignsData } = useSWR<Campaign[]>("/api/campaigns", fetcher);
  const campaigns: Campaign[] = Array.isArray(campaignsData) ? campaignsData : [];

  // Default view is "All Campaigns" (selectedCampaignId = null), which the API
  // treats as an aggregate across every campaign.

  // Auth guard
  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) { router.push("/login"); return; }
    if ((session.user as any).role === "AGENT") { router.push("/collector"); return; }
  }, [session, status, router]);

  // Build API URL — pass the selected month/year so the CEO can view any period
  const apiUrl = `/api/dashboard?year=${year}&month=${month}${selectedCampaignId ? `&campaignId=${selectedCampaignId}` : ""}`;
  const { data, isLoading } = useSWR(apiUrl, fetcher, { refreshInterval: 30000 });

  const availablePeriods: Period[] = data?.availablePeriods ?? [];

  // First-load convenience: if the current month has no data but earlier months
  // do, jump to the most recent month that has data so the dashboard isn't blank.
  useEffect(() => {
    if (didAutoJump.current) return;
    if (!data || availablePeriods.length === 0) return;
    didAutoJump.current = true;
    const currentHasData = availablePeriods.some((p) => p.year === year && p.month === month);
    if (!currentHasData) {
      const latest = availablePeriods[0]; // API returns newest first
      setYear(latest.year);
      setMonth(latest.month);
    }
  }, [data, availablePeriods, year, month]);

  // Year options: derived from periods that have data, plus the current year.
  const yearOptions = Array.from(
    new Set([now.getFullYear(), ...availablePeriods.map((p) => p.year)])
  ).sort((a, b) => b - a);

  const kpis = data?.kpis ?? {
    totalMTD: 0,
    avgAchievement: 0,
    avgRunRate: 0,
    avgRRAchievement: 0,
  };
  const campaignsList = data?.campaigns   ?? [];
  const dailyTrend    = data?.dailyTrend  ?? [];
  const distribution  = data?.distribution ?? [];
  const leaderboard   = data?.leaderboard  ?? [];

  if (status === "loading") return <div className="p-6 text-slate-500">Loading...</div>;

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
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

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Campaign Achievement</CardTitle>
          </CardHeader>
          <CardContent>
            {campaignsList.length > 0 ? (
              <CampaignBarChart data={campaignsList} />
            ) : (
              <p className="text-sm text-muted-foreground py-10 text-center">No data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Daily Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {dailyTrend.length > 0 ? (
              <DailyLineChart data={dailyTrend} label="Sales" />
            ) : (
              <p className="text-sm text-muted-foreground py-10 text-center">No data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {distribution.length > 0 ? (
              <DistributionPieChart data={distribution} />
            ) : (
              <p className="text-sm text-muted-foreground py-10 text-center">No data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Agent Leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            {leaderboard.length > 0 ? (
              <LeaderboardChart data={leaderboard} />
            ) : (
              <p className="text-sm text-muted-foreground py-10 text-center">No data</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Campaign Performance Table */}
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
                ) : (data?.campaignTable ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No data for this period
                    </TableCell>
                  </TableRow>
                ) : (
                  (data?.campaignTable ?? []).map((c: any) => (
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
