'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageTitle } from '@/components/layout/page-title';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw } from 'lucide-react';

interface DashboardData {
  campaignName: string;
  campaignId: string;
  goal: number;
  kpiMetric: string;
  goalType: string;
  agents: Array<{
    agentId: string;
    agentName: string;
    seatNumber: number | null;
    weekly: Record<string, number>;
    mtd: number;
    achievement: number;
    runRate: number;
    rrAchievement: number;
    workingDays: number;
    daysLapsed: number;
  }>;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function OmDashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [year, setYear] = useState<number>(new Date().getFullYear());

  // Check authorization
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated') {
      const user = session?.user as any;
      if (user?.role !== 'OM') {
        router.push('/dashboard');
      }
    }
  }, [status, session, router]);

  const campaignId = (session?.user as any)?.campaignId;

  const { data, mutate, isLoading } = useSWR(
    campaignId && month && year
      ? `/api/om-dashboard?campaignId=${campaignId}&month=${month}&year=${year}`
      : null,
    fetcher
  );

  const dashboardData: DashboardData | null = data || null;

  const handleMonthChange = (direction: 'prev' | 'next') => {
    let newMonth = month;
    let newYear = year;

    if (direction === 'prev') {
      newMonth--;
      if (newMonth < 1) {
        newMonth = 12;
        newYear--;
      }
    } else {
      newMonth++;
      if (newMonth > 12) {
        newMonth = 1;
        newYear++;
      }
    }

    setMonth(newMonth);
    setYear(newYear);
  };

  const monthName = new Date(year, month - 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const getWeekLabel = (weekNum: number) => `W${weekNum}`;

  const exportToCSV = () => {
    if (!dashboardData || !dashboardData.agents || dashboardData.agents.length === 0) return;

    const headers = [
      'Seat',
      'Agent',
      'Campaign',
      'Goal Type',
      'Goal',
      'W1',
      'W2',
      'W3',
      'W4',
      'W5',
      'MTD',
      'Achievement %',
      'Run Rate',
      'RR Achievement %',
      'Working Days',
      'Days Lapsed',
    ];

    const rows = dashboardData.agents.map((agent) => [
      agent.seatNumber || '-',
      agent.agentName,
      dashboardData.campaignName,
      dashboardData.goalType,
      dashboardData.goal.toLocaleString(),
      agent.weekly['W1'] || 0,
      agent.weekly['W2'] || 0,
      agent.weekly['W3'] || 0,
      agent.weekly['W4'] || 0,
      agent.weekly['W5'] || 0,
      agent.mtd.toLocaleString(),
      `${agent.achievement}%`,
      agent.runRate.toLocaleString(),
      `${agent.rrAchievement}%`,
      agent.workingDays,
      agent.daysLapsed,
    ]);

    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `om-dashboard-${dashboardData.campaignName}-${monthName}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (status === 'loading' || isLoading) {
    return <div className="p-6">Loading...</div>;
  }

  if (!dashboardData || !dashboardData.agents) {
    return (
      <div className="p-6">
        <PageTitle title="OM Dashboard" subtitle="Campaign performance metrics" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">No data available</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <PageTitle
            title={`${dashboardData.campaignName} - OM Dashboard`}
            subtitle={`${monthName} Performance Metrics`}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => mutate()} variant="outline" size="sm" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={exportToCSV} size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Month Navigation */}
      <Card>
        <CardContent className="pt-6 flex items-center justify-between">
          <div className="flex gap-4">
            <Button onClick={() => handleMonthChange('prev')} variant="outline" size="sm">
              ← Previous
            </Button>
            <div className="flex items-center gap-2 px-4">
              <span className="text-lg font-semibold">{monthName}</span>
            </div>
            <Button onClick={() => handleMonthChange('next')} variant="outline" size="sm">
              Next →
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Main Dashboard Table */}
      <Card className="overflow-hidden">
        <CardContent className="pt-0">
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-100">
                <TableRow>
                  <TableHead className="sticky left-0 bg-slate-100 z-20 font-bold">Seat</TableHead>
                  <TableHead className="sticky left-16 bg-slate-100 z-20 font-bold min-w-40">Agent</TableHead>
                  <TableHead className="font-bold">Campaign</TableHead>
                  <TableHead className="font-bold">Goal Type</TableHead>
                  <TableHead className="font-bold text-right">GOAL</TableHead>
                  <TableHead className="font-bold text-center">W1</TableHead>
                  <TableHead className="font-bold text-center">W2</TableHead>
                  <TableHead className="font-bold text-center">W3</TableHead>
                  <TableHead className="font-bold text-center">W4</TableHead>
                  <TableHead className="font-bold text-center">W5</TableHead>
                  <TableHead className="font-bold text-right">MTD</TableHead>
                  <TableHead className="font-bold text-center">Achievement %</TableHead>
                  <TableHead className="font-bold text-right">RR</TableHead>
                  <TableHead className="font-bold text-center">RR Ach %</TableHead>
                  <TableHead className="font-bold text-center">WDays</TableHead>
                  <TableHead className="font-bold text-center">Days Lapsed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboardData.agents.map((agent, idx) => (
                  <TableRow
                    key={agent.agentId}
                    className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50 hover:bg-slate-100'}
                  >
                    <TableCell className="sticky left-0 z-10 bg-inherit font-medium">
                      {agent.seatNumber || '-'}
                    </TableCell>
                    <TableCell className="sticky left-16 z-10 bg-inherit font-semibold min-w-40">
                      {agent.agentName}
                    </TableCell>
                    <TableCell>{dashboardData.campaignName}</TableCell>
                    <TableCell>{dashboardData.goalType}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {dashboardData.goal.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {(agent.weekly['W1'] || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {(agent.weekly['W2'] || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {(agent.weekly['W3'] || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {(agent.weekly['W4'] || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {(agent.weekly['W5'] || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {agent.mtd.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={`inline-block px-2 py-1 rounded font-semibold text-sm ${
                          agent.achievement >= 100
                            ? 'bg-green-100 text-green-800'
                            : agent.achievement >= 75
                            ? 'bg-blue-100 text-blue-800'
                            : agent.achievement >= 50
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {agent.achievement}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {agent.runRate.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={`inline-block px-2 py-1 rounded font-semibold text-sm ${
                          agent.rrAchievement >= 100
                            ? 'bg-green-100 text-green-800'
                            : agent.rrAchievement >= 75
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {agent.rrAchievement}%
                      </span>
                    </TableCell>
                    <TableCell className="text-center">{agent.workingDays}</TableCell>
                    <TableCell className="text-center">{agent.daysLapsed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card className="bg-blue-50">
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="font-semibold text-blue-900">W1-W5</p>
              <p className="text-blue-700">Weekly totals for KPI metric</p>
            </div>
            <div>
              <p className="font-semibold text-blue-900">MTD</p>
              <p className="text-blue-700">Month-to-date total</p>
            </div>
            <div>
              <p className="font-semibold text-blue-900">RR</p>
              <p className="text-blue-700">Projected month-end total</p>
            </div>
            <div>
              <p className="font-semibold text-blue-900">RR Ach %</p>
              <p className="text-blue-700">Projected achievement %</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
