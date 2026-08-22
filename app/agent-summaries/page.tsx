"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { PageTitle } from "@/components/layout/page-title";
import { ExportButton } from "@/components/export-button";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Target, TrendingUp, Activity, Search, Eye } from "lucide-react";
import { usePagination } from "@/hooks/use-pagination";
import { PaginationControls } from "@/components/pagination-controls";
import { ReportPeriodSelector } from "@/components/report-period-selector";
import { DashboardSkeleton } from "@/components/skeletons";

interface AgentSummary {
  id: string;
  name: string;
  seatNumber: number | null;
  monthlyTarget: number | null;
  campaigns: CampaignSummary[];
  totalTransmittals: number;
  totalActivations: number;
  totalApprovals: number;
  totalBooked: number;
  totalVolume: number;
  totalTransaction: number;
  avgQualityRate: number;
  avgConversionRate: number;
  daysWorked: number;
}

interface CampaignSummary {
  id: string;
  name: string;
  kpiMetric: string;
  monthlyGoal: number;
  mtd: number;
  runRate: number;
  achievement: number;
  rrAchievement: number;
  avgQualityRate: number;
  avgConversionRate: number;
  totalTransmittals: number;
  totalActivations: number;
  totalApprovals: number;
  totalBooked: number;
}

export default function AgentSummariesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [allMonths, setAllMonths] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const summaryEndpoint = `/api/agents/summary?year=${year}&month=${month}&allMonths=${allMonths}${selectedCampaignId ? `&campaignId=${selectedCampaignId}` : ''}`;
  const exportEndpoint = `/api/export/agents?year=${year}&month=${month}&allMonths=${allMonths}${selectedCampaignId ? `&campaignId=${selectedCampaignId}` : ''}`;

  const handleViewDetails = (agentId: string) => {
    router.push(`/agent-details/${agentId}?year=${year}&month=${month}${allMonths ? '&allMonths=true' : ''}`);
  };

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user) {
      router.push('/login');
      return;
    }
    if (session.user.role !== 'CEO') {
      router.push('/collector');
      return;
    }
  }, [session, status, router]);

  const { data } = useSWR(
    session?.user?.role === 'CEO' ? summaryEndpoint : null,
    (url: string) => fetch(url).then(res => res.json())
  );

  const { data: campaignsData } = useSWR(
    session?.user?.role === 'CEO' ? '/api/campaigns' : null,
    (url: string) => fetch(url).then(res => res.json())
  );

  const agents = useMemo<AgentSummary[]>(() => data?.agents ?? [], [data?.agents]);
  const campaigns = Array.isArray(campaignsData)
    ? campaignsData
    : campaignsData?.campaigns ?? [];
  const filteredAgents = useMemo(
    () => agents.filter((agent) => agent.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [agents, searchTerm]
  );
  const pagination = usePagination(1, 25, filteredAgents.length);
  const { goToPage } = pagination;

  useEffect(() => {
    goToPage(1);
  }, [goToPage, searchTerm]);

  if (status === 'loading' || !session) {
    return <DashboardSkeleton label="Loading agent summaries" />;
  }

  if (session.user.role !== 'CEO') {
    return <div>Access denied</div>;
  }

  const paginatedAgents = filteredAgents.slice(
    pagination.startIndex,
    pagination.endIndex
  );

  const totalAgents = agents.length;
  const totalProduction = agents.reduce(
    (sum, agent) => sum + agent.campaigns.reduce((campaignSum, campaign) => campaignSum + campaign.mtd, 0),
    0
  );
  const totalActivations = agents.reduce((sum, agent) => sum + agent.totalActivations, 0);
  const totalVolume = agents.reduce((sum, agent) => sum + (agent.totalVolume || 0), 0);
  const avgAchievement = agents.length > 0
    ? agents.reduce((sum, agent) => {
        const overall = agent.campaigns.reduce((cSum, camp) => cSum + camp.achievement, 0) / agent.campaigns.length;
        return sum + (isNaN(overall) ? 0 : overall);
      }, 0) / agents.length
    : 0;

  return (
    <div className="space-y-6">
      <PageTitle
        title="Agent Production Summaries"
        subtitle={allMonths ? "Performance from all available bulk import files" : "Comprehensive overview of agent performance and production metrics"}
      />

      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid w-full grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,220px)_minmax(0,256px)] xl:w-auto">
          <ReportPeriodSelector
            year={year}
            month={month}
            allMonths={allMonths}
            className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            onChange={(nextYear, nextMonth, nextAllMonths) => {
              setYear(nextYear);
              setMonth(nextMonth);
              setAllMonths(nextAllMonths);
            }}
          />
          <CampaignSelector
            campaigns={campaigns}
            selectedCampaignId={selectedCampaignId}
            onCampaignChange={setSelectedCampaignId}
            includeAllOption
            className="w-full space-y-0"
            labelClassName="sr-only"
            triggerClassName="h-10 w-full"
          />
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search agents"
              placeholder="Search agents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-10 w-full pl-10"
            />
          </div>
        </div>
        <div className="flex gap-2 xl:shrink-0">
          <ExportButton
            endpoint={exportEndpoint}
            label="Export Report"
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Total Agents"
          value={totalAgents}
          icon={Users}
        />
        <KpiCard
          title="Total Production"
          value={Math.round(totalProduction).toLocaleString()}
          icon={Activity}
        />
        <KpiCard
          title={totalActivations > 0 ? "Total Activations" : "Imported Volume"}
          value={(totalActivations > 0 ? totalActivations : totalVolume).toLocaleString()}
          icon={Target}
        />
        <KpiCard
          title="Avg Achievement"
          value={`${avgAchievement.toFixed(1)}%`}
          icon={TrendingUp}
          pct={avgAchievement}
        />
      </div>

      {/* Agents Table */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Performance Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Seat</TableHead>
                <TableHead>Days Worked</TableHead>
                <TableHead>Transmittals</TableHead>
                <TableHead>Activations</TableHead>
                <TableHead>Approvals</TableHead>
                <TableHead>Booked</TableHead>
                <TableHead>Avg Quality</TableHead>
                <TableHead>Avg Conversion</TableHead>
                <TableHead>Campaigns</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedAgents.map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell className="font-medium">{agent.name}</TableCell>
                  <TableCell>{agent.seatNumber || '-'}</TableCell>
                  <TableCell>{agent.daysWorked}</TableCell>
                  <TableCell>{agent.totalTransmittals}</TableCell>
                  <TableCell>{agent.totalActivations}</TableCell>
                  <TableCell>{agent.totalApprovals}</TableCell>
                  <TableCell>{agent.totalBooked}</TableCell>
                  <TableCell>{agent.avgQualityRate.toFixed(1)}%</TableCell>
                  <TableCell>{agent.avgConversionRate.toFixed(1)}%</TableCell>
                  <TableCell>{agent.campaigns.length}</TableCell>
                  <TableCell>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleViewDetails(agent.id)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationControls pagination={pagination} />
        </CardContent>
      </Card>
    </div>
  );
}
