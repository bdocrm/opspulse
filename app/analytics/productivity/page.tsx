"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { PageTitle } from "@/components/layout/page-title";
import { KpiCard } from "@/components/kpi-card";
import { CampaignSelector } from "@/components/campaign-selector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LeaderboardChart } from "@/components/charts/leaderboard-chart";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Activity, Search, Download } from "lucide-react";

interface ProductivityMetric {
  agentId: string;
  agentName: string;
  campaignId: string;
  campaignName: string;
  seatNumber: number | null;
  tasksCompleted: number | null;
  avgTaskTime: number | null;
  efficiencyScore: number | null;
  qualityScore: number | null;
  daysWorked: number | null;
  overtimeHours: number | null;
  dataSource: string;
}

export default function ProductivityAnalyticsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<'efficiency' | 'quality' | 'tasks'>('efficiency');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user) {
      router.push('/login');
      return;
    }
    if ((session.user as any).role === 'AGENT' || (session.user as any).role === 'COLLECTOR') {
      router.push('/collector');
      return;
    }
  }, [session, status, router]);

  const { data, isLoading } = useSWR(
    session?.user ? `/api/analytics/productivity?year=${year}&month=${month}${selectedCampaignId ? `&campaignId=${selectedCampaignId}` : ''}` : null,
    (url: string) => fetch(url).then(res => res.json())
  );

  const { data: campaignsData } = useSWR(
    session?.user && (session.user as any).role === 'CEO' ? '/api/campaigns' : null,
    (url: string) => fetch(url).then(res => res.json())
  );

  const metrics: ProductivityMetric[] = data?.metrics || [];
  const campaigns = Array.isArray(campaignsData) ? campaignsData : [];
  const summary = data?.summary || {
    avgEfficiency: null,
    avgQuality: null,
    avgTasksPerAgent: null,
    topPerformer: null,
    totalAgents: 0,
  };

  const filteredMetrics = metrics
    .filter(m => m.agentName.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'efficiency') return (b.efficiencyScore ?? -Infinity) - (a.efficiencyScore ?? -Infinity);
      if (sortBy === 'quality') return (b.qualityScore ?? -Infinity) - (a.qualityScore ?? -Infinity);
      return (b.tasksCompleted ?? -Infinity) - (a.tasksCompleted ?? -Infinity);
    });

  const topPerformers = [...metrics]
    .map(metric => {
      const availableScores = [metric.efficiencyScore, metric.qualityScore]
        .filter((score): score is number => score != null);
      return {
        metric,
        score: availableScores.length > 0
          ? availableScores.reduce((sum, score) => sum + score, 0) / availableScores.length
          : null,
      };
    })
    .filter((entry): entry is { metric: ProductivityMetric; score: number } => entry.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ metric, score }) => ({ name: metric.agentName, value: Math.round(score) }));

  return (
    <div className="space-y-6">
      <PageTitle
        title="Productivity Analytics"
        subtitle="Analyze agent efficiency and productivity metrics"
      />

      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-end">
          <input
            type="month"
            aria-label="Reporting month"
            value={`${year}-${String(month).padStart(2, '0')}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split('-');
              setYear(parseInt(y));
              setMonth(parseInt(m));
            }}
            className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-[170px]"
          />
          {session?.user && (session.user as any).role === 'CEO' && (
            <CampaignSelector
              campaigns={campaigns}
              selectedCampaignId={selectedCampaignId}
              onCampaignChange={setSelectedCampaignId}
              includeAllOption
              className="w-full sm:w-[220px]"
            />
          )}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              aria-label="Search agents"
              placeholder="Search agents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Avg Efficiency"
          value={summary.avgEfficiency == null ? "N/A" : `${summary.avgEfficiency.toFixed(1)}%`}
          pct={summary.avgEfficiency ?? undefined}
        />
        <KpiCard
          title="Avg Quality"
          value={summary.avgQuality == null ? "N/A" : `${summary.avgQuality.toFixed(1)}%`}
          pct={summary.avgQuality ?? undefined}
        />
        <KpiCard
          title="Avg Tasks/Agent"
          value={summary.avgTasksPerAgent == null ? "N/A" : Math.round(summary.avgTasksPerAgent)}
        />
        <KpiCard
          title="Total Agents"
          value={summary.totalAgents ?? metrics.length}
        />
      </div>

      {/* Top Performers Chart */}
      {topPerformers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top 10 Performers</CardTitle>
          </CardHeader>
          <CardContent>
            <LeaderboardChart data={topPerformers} />
          </CardContent>
        </Card>
      )}

      {/* Sorting Options */}
      <div className="flex gap-2">
        {(['efficiency', 'quality', 'tasks'] as const).map(sort => (
          <Button
            key={sort}
            variant={sortBy === sort ? 'default' : 'outline'}
            onClick={() => setSortBy(sort)}
            className="capitalize"
          >
            Sort by {sort}
          </Button>
        ))}
      </div>

      {/* Detailed Table */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Productivity Metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Seat</TableHead>
                  <TableHead>Tasks</TableHead>
                  <TableHead>Efficiency %</TableHead>
                  <TableHead>Quality %</TableHead>
                  <TableHead>Avg Task Time</TableHead>
                  <TableHead>Days Worked</TableHead>
                  <TableHead>Overtime Hrs</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                      Loading productivity data...
                    </TableCell>
                  </TableRow>
                ) : filteredMetrics.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                      No productivity data is available for the selected period.
                    </TableCell>
                  </TableRow>
                ) : filteredMetrics.map((metric) => (
                  <TableRow key={`${metric.campaignId}-${metric.agentId}`}>
                    <TableCell className="font-medium">{metric.agentName}</TableCell>
                    <TableCell>{metric.campaignName}</TableCell>
                    <TableCell>{metric.seatNumber || '-'}</TableCell>
                    <TableCell>{metric.tasksCompleted == null ? 'N/A' : metric.tasksCompleted.toLocaleString()}</TableCell>
                    <TableCell>
                      {metric.efficiencyScore == null ? 'N/A' : (
                        <span className={metric.efficiencyScore >= 80 ? 'text-green-600 font-semibold' : 'text-orange-600'}>
                          {metric.efficiencyScore.toFixed(1)}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {metric.qualityScore == null ? 'N/A' : (
                        <span className={metric.qualityScore >= 85 ? 'text-green-600 font-semibold' : 'text-orange-600'}>
                          {metric.qualityScore.toFixed(1)}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{metric.avgTaskTime == null ? 'N/A' : `${metric.avgTaskTime.toFixed(2)} min`}</TableCell>
                    <TableCell>{metric.daysWorked == null ? 'N/A' : metric.daysWorked}</TableCell>
                    <TableCell>{metric.overtimeHours == null ? 'N/A' : metric.overtimeHours.toFixed(1)}</TableCell>
                    <TableCell>{metric.dataSource}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
