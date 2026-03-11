"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { PageTitle } from "@/components/layout/page-title";
import { PeriodFilter } from "@/components/layout/period-filter";
import { CampaignSelector } from "@/components/campaign-selector";
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
import { useDashboardData } from "@/hooks/use-data";
import { kpiColorClass } from "@/utils/kpi";
import { cn } from "@/lib/utils";
import type { FilterPeriod } from "@/utils/kpi";
import { Target, TrendingUp, Activity, BarChart3 } from "lucide-react";

interface Campaign {
  id: string;
  campaignName: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [period, setPeriod] = useState<FilterPeriod>("monthly");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  // Fetch campaigns
  const { data: campaignsData } = useSWR("/api/campaigns", fetcher);
  const campaigns: Campaign[] = Array.isArray(campaignsData) ? campaignsData : [];

  // Set default campaign if none selected and campaigns available
  useEffect(() => {
    if (campaigns.length > 0 && !selectedCampaignId) {
      setSelectedCampaignId(campaigns[0].id);
    }
  }, [campaigns, selectedCampaignId]);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user) {
      router.push('/login');
      return;
    }
    // Restrict AGENT from accessing dashboard
    if ((session.user as any).role === 'AGENT') {
      router.push('/collector');
      return;
    }
  }, [session, status, router]);

  const { data, isLoading } = useDashboardData(period);

  const kpis = data?.kpis ?? {
    totalMTD: 0,
    avgAchievement: 0,
    avgRunRate: 0,
    avgRRAchievement: 0,
  };
  const campaignsList = data?.campaigns ?? [];
  const dailyTrend = data?.dailyTrend ?? [];
  const distribution = data?.distribution ?? [];
  const leaderboard = data?.leaderboard ?? [];

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <PageTitle title="Dashboard" subtitle="Operational Performance Overview" />
        <div className="flex items-center gap-2">
          {campaigns.length > 0 && (
            <CampaignSelector
              campaigns={campaigns}
              selectedCampaignId={selectedCampaignId}
              onCampaignChange={setSelectedCampaignId}
              placeholder="Select campaign"
              className="w-48"
            />
          )}
          <PeriodFilter value={period} onChange={setPeriod} />
          <ExportButton endpoint={`/api/export/dashboard?period=${period}${selectedCampaignId ? `&campaignId=${selectedCampaignId}` : ''}`} />
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
                ) : campaigns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No campaigns found
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
