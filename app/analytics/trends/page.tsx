"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { PageTitle } from "@/components/layout/page-title";
import { KpiCard } from "@/components/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DailyLineChart } from "@/components/charts/daily-line-chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendingUp, Download } from "lucide-react";

interface TrendData {
  date: string;
  transmittals: number;
  activations: number;
  approvals: number;
  booked: number;
}

export default function PerformanceTrendsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [metric, setMetric] = useState<'transmittals' | 'activations' | 'approvals' | 'booked'>('transmittals');

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
    session?.user ? `/api/analytics/trends?year=${year}&month=${month}` : null,
    (url: string) => fetch(url).then(res => res.json())
  );

  const trends = data?.trends || [];
  const stats = data?.stats || { totalMetric: 0, avgDaily: 0, peakDay: 0, growthRate: 0 };

  // Calculate growth trend
  const sortedTrends = [...trends].sort((a: TrendData, b: TrendData) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const firstHalf = sortedTrends.slice(0, Math.floor(sortedTrends.length / 2));
  const secondHalf = sortedTrends.slice(Math.floor(sortedTrends.length / 2));
  const firstHalfAvg = firstHalf.length > 0 ? firstHalf.reduce((sum, d: TrendData) => sum + (d[metric] || 0), 0) / firstHalf.length : 0;
  const secondHalfAvg = secondHalf.length > 0 ? secondHalf.reduce((sum, d: TrendData) => sum + (d[metric] || 0), 0) / secondHalf.length : 0;
  const growthRate = firstHalfAvg > 0 ? ((secondHalfAvg - firstHalfAvg) / firstHalfAvg * 100).toFixed(1) : 0;

  const chartData = trends.map((t: TrendData) => ({
    date: new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: t[metric] || 0,
  }));

  return (
    <div className="space-y-6">
      <PageTitle
        title="Performance Trends"
        subtitle="Track metrics performance over time"
      />

      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex gap-4">
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
          <div className="flex gap-2">
            {(['transmittals', 'activations', 'approvals', 'booked'] as const).map(m => (
              <Button 
                key={m}
                variant={metric === m ? 'default' : 'outline'}
                onClick={() => setMetric(m)}
                className="capitalize"
              >
                {m}
              </Button>
            ))}
          </div>
        </div>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Total"
          value={stats.totalMetric || 0}
        />
        <KpiCard
          title="Daily Average"
          value={Math.round(stats.avgDaily || 0)}
        />
        <KpiCard
          title="Peak Day"
          value={stats.peakDay || 0}
        />
        <KpiCard
          title={`Growth Rate`}
          value={`${growthRate}%`}
          pct={Number(growthRate) >= 0 ? 50 : 25}
        />
      </div>

      {/* Charts */}
      <Card>
        <CardHeader>
          <CardTitle>{metric.charAt(0).toUpperCase() + metric.slice(1)} Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <DailyLineChart data={chartData} />
          ) : (
            <div className="h-96 flex items-center justify-center text-muted-foreground">
              No data available for this period
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detailed breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {sortedTrends.map((trend: TrendData, idx: number) => (
              <div key={idx} className="flex justify-between items-center p-2 border-b hover:bg-muted/50 rounded transition-colors">
                <span className="text-sm font-medium">{new Date(trend.date).toLocaleDateString()}</span>
                <div className="flex gap-6 text-sm">
                  <span>Transmittals: <span className="font-semibold">{trend.transmittals}</span></span>
                  <span>Activations: <span className="font-semibold">{trend.activations}</span></span>
                  <span>Approvals: <span className="font-semibold">{trend.approvals}</span></span>
                  <span>Booked: <span className="font-semibold">{trend.booked}</span></span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}