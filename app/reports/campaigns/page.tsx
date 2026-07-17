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
import { CampaignBarChart } from "@/components/charts/campaign-bar-chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { kpiColorClass } from "@/utils/kpi";
import { cn } from "@/lib/utils";
import { BarChart3, Download, Search, TrendingUp, AlertTriangle } from "lucide-react";

interface CampaignReport {
  id: string;
  name: string;
  kpiMetric: string;
  monthlyGoal: number;
  mtd: number;
  achievement: number;
  runRate: number;
  rrAchievement: number;
  agentCount: number;
  avgQuality: number;
  avgConversion: number;
  status: 'on-track' | 'at-risk' | 'exceeding';
}

interface CampaignOption {
  id: string;
  campaignName: string;
}

const fetchFreshJson = async (url: string) => {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok) throw new Error(`Campaign report request failed (${response.status})`);
  return response.json();
};

export default function CampaignReportsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState("all");
  const [filterStatus, setFilterStatus] = useState<'all' | 'on-track' | 'at-risk' | 'exceeding'>('all');
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);

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
    session?.user ? `/api/reports/campaigns?year=${year}&month=${month}&dataVersion=2` : null,
    fetchFreshJson,
    {
      revalidateOnMount: true,
      revalidateOnFocus: true,
      dedupingInterval: 0,
    }
  );
  const { data: campaignOptions = [] } = useSWR<CampaignOption[]>(
    session?.user ? `/api/goals?month=${month}&year=${year}` : null,
    fetchFreshJson
  );

  const campaigns: CampaignReport[] = data?.campaigns || [];
  const summary = data?.summary || {
    totalCampaigns: 0,
    onTrack: 0,
    atRisk: 0,
    exceeding: 0,
    avgAchievement: 0,
  };

  // Duplicate-name monitoring: a campaign name is flagged when it appears on
  // more than one campaign row (case-insensitive, trimmed).
  const nameCounts = campaigns.reduce((acc, c) => {
    const key = c.name.trim().toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const isDuplicateName = (name: string) => (nameCounts[name.trim().toLowerCase()] || 0) > 1;
  const duplicateCount = campaigns.filter(c => isDuplicateName(c.name)).length;

  const filteredCampaigns = campaigns
    .filter(c => selectedCampaignId === 'all' || c.id === selectedCampaignId)
    .filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter(c => filterStatus === 'all' || c.status === filterStatus)
    .filter(c => !showDuplicatesOnly || isDuplicateName(c.name));

  const chartData = filteredCampaigns.map((c, index) => ({
    name: c.name,
    achievement: c.achievement,
    actual: c.mtd,
    goal: c.monthlyGoal,
    rank: index + 1,
    status: c.status.replace('-', ' ').toUpperCase(),
  }));

  const formatNumber = (value: number) =>
    Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

  const getStatusColor = (status: string) => {
    if (status === 'exceeding') return 'bg-green-100 text-green-800 border-green-300';
    if (status === 'on-track') return 'bg-blue-100 text-blue-800 border-blue-300';
    return 'bg-red-100 text-red-800 border-red-300';
  };

  return (
    <div className="space-y-6">
      <PageTitle
        title="Campaign Reports"
        subtitle="Comprehensive campaign performance analysis"
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
          <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="All Campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Campaigns</SelectItem>
              {campaignOptions.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.campaignName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Search campaigns..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 w-64"
            />
          </div>
        </div>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Export Report
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          title="Total Campaigns"
          value={summary.totalCampaigns}
        />
        <KpiCard
          title="On Track"
          value={summary.onTrack}
          pct={85}
        />
        <KpiCard
          title="At Risk"
          value={summary.atRisk}
          pct={50}
        />
        <KpiCard
          title="Exceeding"
          value={summary.exceeding}
          pct={100}
        />
        <KpiCard
          title="Avg Achievement"
          value={`${summary.avgAchievement.toFixed(1)}%`}
          pct={summary.avgAchievement}
        />
      </div>

      {/* Campaign Performance Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Campaign Achievement Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <CampaignBarChart data={chartData} />
          </CardContent>
        </Card>
      )}

      {/* Filter Buttons */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'on-track', 'at-risk', 'exceeding'] as const).map(status => (
          <Button
            key={status}
            variant={filterStatus === status ? 'default' : 'outline'}
            onClick={() => setFilterStatus(status)}
            className="capitalize"
          >
            {status === 'all' ? 'All Campaigns' : status.replace('-', ' ')}
          </Button>
        ))}
        <Button
          variant={showDuplicatesOnly ? 'default' : 'outline'}
          onClick={() => setShowDuplicatesOnly(v => !v)}
          className={cn("gap-2", showDuplicatesOnly ? "" : "border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700")}
          title="Show only campaigns with duplicate names"
        >
          <AlertTriangle className="h-4 w-4" />
          Duplicates ({duplicateCount})
        </Button>
      </div>

      {/* Detailed Reports Table */}
      <Card>
        <CardHeader>
          <CardTitle>Campaign Performance Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign Name</TableHead>
                  <TableHead>KPI Metric</TableHead>
                  <TableHead>Goal</TableHead>
                  <TableHead>MTD</TableHead>
                  <TableHead>Achievement %</TableHead>
                  <TableHead>Run Rate</TableHead>
                  <TableHead>Agents</TableHead>
                  <TableHead>Avg Quality</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCampaigns.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell className={cn("font-medium", isDuplicateName(campaign.name) && "text-red-600")}>
                      <span className="inline-flex items-center gap-1.5">
                        {campaign.name}
                        {isDuplicateName(campaign.name) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                            <AlertTriangle className="h-3 w-3" />
                            Duplicate
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="capitalize">{campaign.kpiMetric}</TableCell>
                    <TableCell>{formatNumber(campaign.monthlyGoal)}</TableCell>
                    <TableCell className="font-semibold">{formatNumber(campaign.mtd)}</TableCell>
                    <TableCell>
                      <span className={cn("font-semibold", kpiColorClass(campaign.achievement))}>
                        {campaign.achievement.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell>{formatNumber(campaign.runRate)}</TableCell>
                    <TableCell>{campaign.agentCount}</TableCell>
                    <TableCell>{campaign.avgQuality.toFixed(1)}%</TableCell>
                    <TableCell>
                      <span className={cn("px-2 py-1 rounded-full text-xs font-semibold border", getStatusColor(campaign.status))}>
                        {campaign.status.replace('-', ' ').toUpperCase()}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Insights Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Key Insights
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 bg-green-50 border border-green-200 rounded">
            <p className="font-semibold text-green-900">Strong Performers</p>
            <p className="text-sm text-green-700">{summary.exceeding} campaign(s) exceeding targets</p>
          </div>
          <div className="p-3 bg-orange-50 border border-orange-200 rounded">
            <p className="font-semibold text-orange-900">Need Attention</p>
            <p className="text-sm text-orange-700">{summary.atRisk} campaign(s) at risk of missing targets</p>
          </div>
          <div className="p-3 bg-blue-50 border border-blue-200 rounded">
            <p className="font-semibold text-blue-900">Overall Performance</p>
            <p className="text-sm text-blue-700">Overall achievement rate: {summary.avgAchievement.toFixed(1)}%</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
