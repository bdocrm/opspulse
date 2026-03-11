"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { PageTitle } from "@/components/layout/page-title";
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
import { LeaderboardChart } from "@/components/charts/leaderboard-chart";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Activity, Search, Download } from "lucide-react";

interface ProductivityMetric {
  agentId: string;
  agentName: string;
  seatNumber: number | null;
  tasksCompleted: number;
  avgTaskTime: number;
  efficiencyScore: number;
  qualityScore: number;
  daysWorked: number;
  overtimeHours: number;
}

export default function ProductivityAnalyticsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<'efficiency' | 'quality' | 'tasks'>('efficiency');

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
    session?.user ? `/api/analytics/productivity?year=${year}&month=${month}` : null,
    (url: string) => fetch(url).then(res => res.json())
  );

  const metrics: ProductivityMetric[] = data?.metrics || [];
  const summary = data?.summary || {
    avgEfficiency: 0,
    avgQuality: 0,
    avgTasksPerAgent: 0,
    topPerformer: null,
  };

  const filteredMetrics = metrics
    .filter(m => m.agentName.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'efficiency') return b.efficiencyScore - a.efficiencyScore;
      if (sortBy === 'quality') return b.qualityScore - a.qualityScore;
      return b.tasksCompleted - a.tasksCompleted;
    });

  const topPerformers = metrics
    .sort((a, b) => (b.efficiencyScore + b.qualityScore) / 2 - (a.efficiencyScore + a.qualityScore) / 2)
    .slice(0, 10)
    .map(m => ({ name: m.agentName, value: Math.round((m.efficiencyScore + m.qualityScore) / 2) }));

  return (
    <div className="space-y-6">
      <PageTitle
        title="Productivity Analytics"
        subtitle="Analyze agent efficiency and productivity metrics"
      />

      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-4">
          <input
            type="month"
            value={`${year}-${String(month).padStart(2, '0')}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split('-');
              setYear(parseInt(y));
              setMonth(parseInt(m));
            }}
            className="px-3 py-2 border rounded-md"
          />
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Search agents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 w-64"
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
          value={`${summary.avgEfficiency.toFixed(1)}%`}
          pct={summary.avgEfficiency}
        />
        <KpiCard
          title="Avg Quality"
          value={`${summary.avgQuality.toFixed(1)}%`}
          pct={summary.avgQuality}
        />
        <KpiCard
          title="Avg Tasks/Agent"
          value={Math.round(summary.avgTasksPerAgent)}
        />
        <KpiCard
          title="Total Agents"
          value={metrics.length}
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
                  <TableHead>Seat</TableHead>
                  <TableHead>Tasks</TableHead>
                  <TableHead>Efficiency %</TableHead>
                  <TableHead>Quality %</TableHead>
                  <TableHead>Avg Task Time</TableHead>
                  <TableHead>Days Worked</TableHead>
                  <TableHead>Overtime Hrs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMetrics.map((metric) => (
                  <TableRow key={metric.agentId}>
                    <TableCell className="font-medium">{metric.agentName}</TableCell>
                    <TableCell>{metric.seatNumber || '-'}</TableCell>
                    <TableCell>{metric.tasksCompleted}</TableCell>
                    <TableCell>
                      <span className={metric.efficiencyScore >= 80 ? 'text-green-600 font-semibold' : 'text-orange-600'}>
                        {metric.efficiencyScore.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={metric.qualityScore >= 85 ? 'text-green-600 font-semibold' : 'text-orange-600'}>
                        {metric.qualityScore.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell>{metric.avgTaskTime.toFixed(2)} min</TableCell>
                    <TableCell>{metric.daysWorked}</TableCell>
                    <TableCell>{metric.overtimeHours.toFixed(1)}</TableCell>
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