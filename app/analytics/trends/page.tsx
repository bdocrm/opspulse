"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { PageTitle } from "@/components/layout/page-title";
import { KpiCard } from "@/components/kpi-card";
import { CampaignSelector } from "@/components/campaign-selector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DailyLineChart } from "@/components/charts/daily-line-chart";
import { DailyBarChart } from "@/components/charts/daily-bar-chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendingUp, Download } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface TrendData {
  date: string;
  transmittals: number;
  activations: number;
  approvals: number;
  booked: number;
}

type TrendMetric = 'all' | 'transmittals' | 'activations' | 'approvals' | 'booked';

const METRIC_OPTIONS: TrendMetric[] = ['all', 'transmittals', 'activations', 'approvals', 'booked'];
const SINGLE_METRICS = ['transmittals', 'activations', 'approvals', 'booked'] as const;
const METRIC_LABELS: Record<TrendMetric, string> = {
  all: 'All',
  transmittals: 'Transmittals',
  activations: 'Activations',
  approvals: 'Approvals',
  booked: 'Booked',
};
const METRIC_COLORS = {
  transmittals: '#2563eb',
  activations: '#16a34a',
  approvals: '#f59e0b',
  booked: '#dc2626',
};

function totalForMetric(trend: TrendData, metric: TrendMetric) {
  if (metric === 'all') {
    return SINGLE_METRICS.reduce((sum, key) => sum + (trend[key] || 0), 0);
  }

  return trend[metric] || 0;
}

function AllMetricsChart({ data }: { data: Array<TrendData & { label: string }> }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="label" className="text-xs" tick={{ fontSize: 11 }} />
        <YAxis className="text-xs" tick={{ fontSize: 11 }} />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
          }}
          formatter={(value: number, name: string) => [
            Number(value).toLocaleString(),
            METRIC_LABELS[name as TrendMetric] || name,
          ]}
        />
        {SINGLE_METRICS.map((key) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={METRIC_COLORS[key]}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function PerformanceTrendsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [metric, setMetric] = useState<TrendMetric>('all');
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
    session?.user ? `/api/analytics/trends?year=${year}&month=${month}${selectedCampaignId ? `&campaignId=${selectedCampaignId}` : ''}` : null,
    (url: string) => fetch(url, { credentials: 'include' }).then(res => res.json())
  );

  const { data: campaignsData } = useSWR(
    session?.user && (session.user as any).role === 'CEO' ? '/api/campaigns' : null,
    (url: string) => fetch(url).then(res => res.json())
  );

  const trends = data?.trends || [];
  const previousTrends = data?.previousTrends || [];
  const campaigns = Array.isArray(campaignsData) ? campaignsData : [];

  const metricTotal = trends.reduce((sum: number, t: TrendData) => sum + totalForMetric(t, metric), 0);
  const metricAvg = trends.length > 0 ? Math.round(metricTotal / trends.length) : 0;
  const metricPeak = trends.length > 0 ? Math.max(...trends.map((t: TrendData) => totalForMetric(t, metric))) : 0;

  // Calculate growth against the previous equivalent month for the selected metric.
  const sortedTrends = [...trends].sort((a: TrendData, b: TrendData) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const previousMetricTotal = previousTrends.reduce((sum: number, t: TrendData) => sum + totalForMetric(t, metric), 0);
  const growthRate = previousMetricTotal > 0 ? ((metricTotal - previousMetricTotal) / previousMetricTotal * 100).toFixed(1) : '0.0';

  const chartData = trends.map((t: TrendData) => ({
    ...t,
    date: new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    label: new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: totalForMetric(t, metric),
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
          {session?.user && (session.user as any).role === 'CEO' && (
            <CampaignSelector
              campaigns={campaigns}
              selectedCampaignId={selectedCampaignId}
              onCampaignChange={setSelectedCampaignId}
              includeAllOption
              className="min-w-[220px]"
            />
          )}
          <div className="flex gap-2">
            {METRIC_OPTIONS.map(m => (
              <Button 
                key={m}
                variant={metric === m ? 'default' : 'outline'}
                onClick={() => setMetric(m)}
                className={m === 'all' ? '' : 'capitalize'}
              >
                {METRIC_LABELS[m]}
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
          value={metricTotal}
        />
        <KpiCard
          title="Daily Average"
          value={metricAvg}
        />
        <KpiCard
          title="Peak Day"
          value={metricPeak}
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
          <CardTitle>{METRIC_LABELS[metric]} Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            metric === 'all' ? (
              <AllMetricsChart data={chartData} />
            ) : metric === 'transmittals' ? (
              <DailyBarChart data={chartData} label="Transmittals" />
            ) : (
              <DailyLineChart data={chartData} label={METRIC_LABELS[metric]} />
            )
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
