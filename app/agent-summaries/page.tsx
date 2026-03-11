"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { PageTitle } from "@/components/layout/page-title";
import { ExportButton } from "@/components/export-button";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { kpiColorClass } from "@/utils/kpi";
import { cn } from "@/lib/utils";
import { Users, Target, TrendingUp, Activity, Search, Download, Eye } from "lucide-react";
import { usePagination } from "@/hooks/use-pagination";
import { PaginationControls } from "@/components/pagination-controls";

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
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [totalAgentsCount, setTotalAgentsCount] = useState(0);
  const pagination = usePagination(1, 25, totalAgentsCount);

  const handleViewDetails = (agentId: string) => {
    router.push(`/agent-details/${agentId}?year=${year}&month=${month}`);
  };

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user) {
      router.push('/login');
      return;
    }
    if ((session.user as any).role !== 'CEO') {
      router.push('/collector');
      return;
    }
  }, [session, status, router]);

  const { data, error, isLoading, mutate } = useSWR(
    session?.user?.role === 'CEO' ? `/api/agents/summary?year=${year}&month=${month}${selectedAgent ? `&id=${selectedAgent}` : ''}` : null,
    (url: string) => fetch(url).then(res => res.json())
  );

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user || session.user.role !== 'CEO') {
      router.push('/login');
      return;
    }
  }, [session, status, router]);

  if (status === 'loading' || !session) {
    return <div>Loading...</div>;
  }

  if (session.user.role !== 'CEO') {
    return <div>Access denied</div>;
  }

  const agents: AgentSummary[] = data?.agents || [];
  const filteredAgents = agents.filter(agent =>
    agent.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    setTotalAgentsCount(filteredAgents.length);
    pagination.goToPage(1); // Reset to first page when search term changes
  }, [filteredAgents.length]);

  const paginatedAgents = filteredAgents.slice(
    pagination.startIndex,
    pagination.endIndex
  );

  const totalAgents = agents.length;
  const totalTransmittals = agents.reduce((sum, agent) => sum + agent.totalTransmittals, 0);
  const totalActivations = agents.reduce((sum, agent) => sum + agent.totalActivations, 0);
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
        subtitle="Comprehensive overview of agent performance and production metrics"
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
          <div className="flex gap-2">
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
        </div>
        <div className="flex gap-2">
          <ExportButton
            endpoint={`/api/agents/summary?year=${year}&month=${month}${selectedAgent ? `&id=${selectedAgent}` : ''}`}
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
          title="Total Transmittals"
          value={totalTransmittals}
          icon={Activity}
        />
        <KpiCard
          title="Total Activations"
          value={totalActivations}
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