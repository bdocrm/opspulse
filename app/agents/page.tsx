"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { PageTitle } from "@/components/layout/page-title";
import { PeriodFilter } from "@/components/layout/period-filter";
import { ExportButton } from "@/components/export-button";
import { LeaderboardChart } from "@/components/charts/leaderboard-chart";
import { DailyLineChart } from "@/components/charts/daily-line-chart";
import { KpiCard } from "@/components/kpi-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAgents } from "@/hooks/use-data";
import { kpiColorClass } from "@/utils/kpi";
import { cn } from "@/lib/utils";
import type { FilterPeriod } from "@/utils/kpi";
import { 
  Users, Trophy, TrendingUp, Activity, Plus, Trash2, Edit2, 
  Target, UserCheck, UserX, Search, X, Save, AlertCircle, 
  CheckCircle2, RefreshCw, Download
} from "lucide-react";

interface Agent {
  id: string;
  name: string;
  email: string;
  seatNumber: number | null;
  monthlyTarget?: number;
}

// Agent Edit Modal Component
function AgentModal({ 
  agent, 
  isNew, 
  onClose, 
  onSave, 
  loading,
  nextSeat
}: { 
  agent?: Agent; 
  isNew: boolean; 
  onClose: () => void; 
  onSave: (data: { name: string; seatNumber: number; monthlyTarget?: number }) => void;
  loading: boolean;
  nextSeat: number;
}) {
  const [name, setName] = useState(agent?.name || '');
  const [seatNumber, setSeatNumber] = useState(agent?.seatNumber?.toString() || nextSeat.toString());
  const [monthlyTarget, setMonthlyTarget] = useState(agent?.monthlyTarget?.toString() || '');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{isNew ? 'Add New Agent' : `Edit ${agent?.name}`}</CardTitle>
          <CardDescription>
            {isNew ? 'Register a new agent for your campaign' : 'Update agent details'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Agent Name *</Label>
            <Input
              id="name"
              placeholder="Enter agent name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="seat">Seat Number *</Label>
            <Input
              id="seat"
              type="number"
              min="1"
              value={seatNumber}
              onChange={(e) => setSeatNumber(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="target">Monthly Target (Optional)</Label>
            <Input
              id="target"
              type="number"
              min="0"
              placeholder="e.g. 50"
              value={monthlyTarget}
              onChange={(e) => setMonthlyTarget(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              onClick={() => onSave({ 
                name, 
                seatNumber: parseInt(seatNumber) || 1,
                monthlyTarget: monthlyTarget ? parseInt(monthlyTarget) : undefined
              })}
              disabled={loading || !name.trim()}
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              {isNew ? 'Add Agent' : 'Save Changes'}
            </Button>
            <Button variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Main Agents Page
export default function AgentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const user = session?.user as any;
  const isCollector = user?.role === 'COLLECTOR';

  // For MANAGER/ADMIN: Use existing analytics
  const [period, setPeriod] = useState<FilterPeriod>("monthly");
  const { data: analyticsData, isLoading: analyticsLoading } = useAgents(period);

  // For COLLECTOR: Manage agents
  const [agentSearch, setAgentSearch] = useState('');
  const [editModal, setEditModal] = useState<{ agent?: Agent; isNew: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const campaignId = user?.campaignId;
  const campaignName = user?.campaignName;

  const fetcher = (url: string) => fetch(url).then(r => r.json());

  // Fetch campaign agents for COLLECTOR
  const { data: agentsData, mutate: mutateAgents, isLoading: loadingAgents } = useSWR(
    isCollector && campaignId ? `/api/campaigns/${campaignId}/agents` : null,
    fetcher
  );

  // Fetch today's production for summary
  const { data: productionData, isLoading: loadingProduction } = useSWR(
    isCollector && campaignId ? `/api/collectors/production?date=${today}` : null,
    fetcher,
    { refreshInterval: 30000 }
  );

  // Fetch attendance
  const { data: attendanceData, mutate: mutateAttendance } = useSWR(
    isCollector && campaignId ? `/api/collectors/attendance?date=${today}` : null,
    fetcher,
    { refreshInterval: 30000 }
  );

  const agents: Agent[] = isCollector 
    ? (Array.isArray(agentsData) ? agentsData : (agentsData?.data || []))
    : [];
  
  const savedEntries = productionData?.entries || [];

  // Per-agent production
  const agentProduction = useMemo(() => {
    const production: Record<string, { transmittals: number; activations: number; approvals: number; booked: number }> = {};
    savedEntries.forEach((entry: any) => {
      entry.details?.forEach((detail: any) => {
        if (!production[detail.agentId]) {
          production[detail.agentId] = { transmittals: 0, activations: 0, approvals: 0, booked: 0 };
        }
        production[detail.agentId].transmittals += detail.transmittals || 0;
        production[detail.agentId].activations += detail.activations || 0;
        production[detail.agentId].approvals += detail.approvals || 0;
        production[detail.agentId].booked += detail.booked || 0;
      });
    });
    return production;
  }, [savedEntries]);

  // Calculate next seat number
  const nextSeat = useMemo(() => {
    if (agents.length === 0) return 1;
    return Math.max(...agents.map(a => a.seatNumber || 0)) + 1;
  }, [agents]);

  // Filtered agents
  const filteredAgents = useMemo(() => {
    return agents
      .filter(a => a.name.toLowerCase().includes(agentSearch.toLowerCase()))
      .sort((a, b) => {
        const aProd = agentProduction[a.id]?.booked || 0;
        const bProd = agentProduction[b.id]?.booked || 0;
        return bProd - aProd;
      });
  }, [agents, agentSearch, agentProduction]);

  // KPI calculations for COLLECTOR
  const kpis = useMemo(() => {
    const totalAgents = agents.length;
    const attendanceMap = attendanceData?.attendance || {};
    
    let presentCount = 0;
    agents.forEach((agent) => {
      if (attendanceMap[agent.id]?.status !== 'ABSENT') presentCount++;
    });

    let totalBooked = 0;
    let totalTarget = 0;
    agents.forEach((agent) => {
      totalBooked += agentProduction[agent.id]?.booked || 0;
      totalTarget += agent.monthlyTarget || 0;
    });

    const topAgent = filteredAgents[0];
    const topBooked = topAgent ? (agentProduction[topAgent.id]?.booked || 0) : 0;

    return { totalAgents, presentCount, totalBooked, totalTarget, topAgent, topBooked };
  }, [agents, attendanceData, agentProduction, filteredAgents]);

  // Handle add/edit agent
  const handleSaveAgent = async (data: { name: string; seatNumber: number; monthlyTarget?: number }) => {
    if (!campaignId) return;
    setLoading(true);

    try {
      if (editModal?.isNew) {
        // Add new agent
        const res = await fetch('/api/collectors/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name,
            campaignId,
            seatNumber: data.seatNumber,
            role: 'AGENT',
          }),
        });

        if (!res.ok) throw new Error('Failed to add agent');

        // If target provided, set it
        if (data.monthlyTarget) {
          const agentRes = await res.json();
          await fetch(`/api/collectors/agents/${agentRes.id}/targets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: data.monthlyTarget }),
          });
        }

        setMessage({ type: 'success', text: `Agent "${data.name}" added successfully!` });
      } else if (editModal?.agent) {
        // Update existing agent
        const res = await fetch(`/api/collectors/agents/${editModal.agent.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name,
            seatNumber: data.seatNumber,
          }),
        });

        if (!res.ok) throw new Error('Failed to update agent');

        // Update target
        if (data.monthlyTarget !== undefined) {
          await fetch(`/api/collectors/agents/${editModal.agent.id}/targets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: data.monthlyTarget }),
          });
        }

        setMessage({ type: 'success', text: `Agent "${data.name}" updated!` });
      }

      mutateAgents();
      setEditModal(null);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Operation failed' });
    } finally {
      setLoading(false);
    }
  };

  // Handle delete agent
  const handleDeleteAgent = async (agent: Agent) => {
    if (!confirm(`Are you sure you want to remove "${agent.name}"?`)) return;

    try {
      const res = await fetch(`/api/collectors/agents/${agent.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete agent');
      
      setMessage({ type: 'success', text: `Agent "${agent.name}" removed` });
      mutateAgents();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to delete' });
    }
  };

  // Toggle attendance
  const handleToggleAttendance = async (agentId: string) => {
    const attendanceMap = attendanceData?.attendance || {};
    const currentStatus = attendanceMap[agentId]?.status || 'PRESENT';
    const newStatus = currentStatus === 'ABSENT' ? 'PRESENT' : 'ABSENT';

    try {
      await fetch('/api/collectors/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, date: today, status: newStatus }),
      });
      mutateAttendance();
    } catch (error) {
      console.error('Failed to toggle attendance', error);
    }
  };

  // Export to CSV
  const handleExport = () => {
    const attendanceMap = attendanceData?.attendance || {};
    const rows = filteredAgents.map((agent, index) => {
      const prod = agentProduction[agent.id] || { transmittals: 0, activations: 0, approvals: 0, booked: 0 };
      const attendance = attendanceMap[agent.id]?.status || 'PRESENT';
      const target = agent.monthlyTarget || 0;
      const progress = target > 0 ? ((prod.booked / target) * 100).toFixed(1) : '0';
      return {
        'Rank': index + 1,
        'Seat': agent.seatNumber ?? '-',
        'Agent Name': agent.name,
        'Status': attendance,
        'Transmittals': prod.transmittals,
        'Activations': prod.activations,
        'Approvals': prod.approvals,
        'Booked': prod.booked,
        'Target': target,
        'Progress %': progress,
      };
    });

    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map((row: any) => headers.map(h => `"${row[h]}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `agents-report-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Get rank badge
  const getRankBadge = (index: number) => {
    if (index === 0) return <span className="text-yellow-500 text-lg">🥇</span>;
    if (index === 1) return <span className="text-gray-400 text-lg">🥈</span>;
    if (index === 2) return <span className="text-amber-600 text-lg">🥉</span>;
    return <span className="text-muted-foreground text-sm">{index + 1}</span>;
  };

  // Loading state
  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // COLLECTOR VIEW - Full Agent Management
  if (isCollector) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <PageTitle title="Agent Management" subtitle={`Campaign: ${campaignName}`} />
          <div className="flex items-center gap-2">
            <Button onClick={handleExport} variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button onClick={() => setEditModal({ isNew: true })} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Agent
            </Button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
            message.type === 'error' 
              ? 'bg-red-900/20 text-red-400 border border-red-800' 
              : 'bg-green-900/20 text-green-400 border border-green-800'
          }`}>
            {message.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            {message.text}
            <button onClick={() => setMessage(null)} className="ml-auto">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard title="Total Agents" value={kpis.totalAgents} icon={Users} />
          <KpiCard 
            title="Present Today" 
            value={kpis.presentCount} 
            subtitle={`${kpis.totalAgents - kpis.presentCount} absent`}
            icon={UserCheck} 
          />
          <KpiCard 
            title="Top Performer" 
            value={kpis.topAgent?.name || '-'} 
            subtitle={`${kpis.topBooked} booked`}
            icon={Trophy} 
          />
          <KpiCard 
            title="Total Booked" 
            value={kpis.totalBooked} 
            subtitle={kpis.totalTarget > 0 ? `Target: ${kpis.totalTarget}` : undefined}
            icon={TrendingUp} 
          />
        </div>

        {/* Agent Table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Agents ({filteredAgents.length})
              </CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search agents..."
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingAgents ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                {agents.length === 0 ? (
                  <>
                    <p>No agents added yet.</p>
                    <Button variant="link" onClick={() => setEditModal({ isNew: true })} className="mt-2">
                      Add your first agent
                    </Button>
                  </>
                ) : (
                  <p>No agents match "{agentSearch}"</p>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Rank</TableHead>
                      <TableHead className="w-12">Seat</TableHead>
                      <TableHead>Agent Name</TableHead>
                      <TableHead className="text-center w-24">Attendance</TableHead>
                      <TableHead className="text-center">Trans</TableHead>
                      <TableHead className="text-center">Act</TableHead>
                      <TableHead className="text-center">Appr</TableHead>
                      <TableHead className="text-center">Booked</TableHead>
                      <TableHead className="text-center">Target</TableHead>
                      <TableHead className="text-center w-20">Progress</TableHead>
                      <TableHead className="text-right w-24">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAgents.map((agent, index) => {
                      const prod = agentProduction[agent.id] || { transmittals: 0, activations: 0, approvals: 0, booked: 0 };
                      const attendanceMap = attendanceData?.attendance || {};
                      const isPresent = attendanceMap[agent.id]?.status !== 'ABSENT';
                      const progress = agent.monthlyTarget 
                        ? ((prod.booked / agent.monthlyTarget) * 100) 
                        : 0;
                      
                      return (
                        <TableRow key={agent.id} className={!isPresent ? 'opacity-50 bg-muted/30' : ''}>
                          <TableCell className="text-center">{getRankBadge(index)}</TableCell>
                          <TableCell className="font-semibold text-muted-foreground">{agent.seatNumber}</TableCell>
                          <TableCell className="font-medium">{agent.name}</TableCell>
                          <TableCell className="text-center">
                            <button
                              onClick={() => handleToggleAttendance(agent.id)}
                              className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors cursor-pointer ${
                                isPresent 
                                  ? 'text-green-500 bg-green-500/10 hover:bg-green-500/20' 
                                  : 'text-red-500 bg-red-500/10 hover:bg-red-500/20'
                              }`}
                            >
                              {isPresent ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
                              <span>{isPresent ? 'Present' : 'Absent'}</span>
                            </button>
                          </TableCell>
                          <TableCell className="text-center">{prod.transmittals}</TableCell>
                          <TableCell className="text-center">{prod.activations}</TableCell>
                          <TableCell className="text-center">{prod.approvals}</TableCell>
                          <TableCell className="text-center font-semibold text-primary">{prod.booked}</TableCell>
                          <TableCell className="text-center">{agent.monthlyTarget || '-'}</TableCell>
                          <TableCell className="text-center">
                            {agent.monthlyTarget ? (
                              <span className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-semibold",
                                kpiColorClass(progress)
                              )}>
                                {progress.toFixed(0)}%
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setEditModal({ agent, isNew: false })}
                                title="Edit Agent"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteAgent(agent)}
                                title="Remove Agent"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edit/Add Modal */}
        {editModal && (
          <AgentModal
            agent={editModal.agent}
            isNew={editModal.isNew}
            onClose={() => setEditModal(null)}
            onSave={handleSaveAgent}
            loading={loading}
            nextSeat={nextSeat}
          />
        )}
      </div>
    );
  }

  // MANAGER/ADMIN VIEW - Analytics (existing functionality)
  const analyticsAgents: any[] = analyticsData?.agents ?? [];
  const leaderboard = analyticsData?.leaderboard ?? [];
  const topAgent = analyticsData?.topAgent ?? { name: "-", mtd: 0, achievement: 0 };
  const totalAgents = analyticsData?.totalAgents ?? 0;
  const avgMTD = analyticsData?.avgMTD ?? 0;
  const avgAchievement = analyticsData?.avgAchievement ?? 0;

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <PageTitle title="Agent Performance" subtitle="Individual agent metrics & rankings" />
        <div className="flex items-center gap-2">
          <PeriodFilter value={period} onChange={setPeriod} />
          <ExportButton endpoint={`/api/export/agents?period=${period}`} />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard title="Total Agents" value={totalAgents} icon={Users} />
        <KpiCard title="Top Agent" value={topAgent.name} subtitle={`MTD: ${topAgent.mtd}`} icon={Trophy} />
        <KpiCard title="Avg MTD" value={avgMTD.toLocaleString()} icon={TrendingUp} pct={avgAchievement} />
        <KpiCard title="Avg Achievement" value={`${avgAchievement.toFixed(1)}%`} icon={Activity} pct={avgAchievement} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Agent Leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            {leaderboard.length > 0 ? (
              <LeaderboardChart data={leaderboard.slice(0, 10)} />
            ) : (
              <p className="text-sm text-muted-foreground py-10 text-center">No data</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Overall Daily Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsData?.dailyTrend?.length > 0 ? (
              <DailyLineChart data={analyticsData.dailyTrend} label="Total" />
            ) : (
              <p className="text-sm text-muted-foreground py-10 text-center">No data</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agent Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Agent Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Seat</TableHead>
                  <TableHead className="text-right">MTD</TableHead>
                  <TableHead className="text-right">Achievement</TableHead>
                  <TableHead className="text-right">Run Rate</TableHead>
                  <TableHead className="text-right">RR Ach.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analyticsLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                  </TableRow>
                ) : analyticsAgents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No agents found</TableCell>
                  </TableRow>
                ) : (
                  analyticsAgents.map((a: any, idx: number) => (
                    <TableRow key={a.userId}>
                      <TableCell>{idx + 1}</TableCell>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell>{a.seatNumber ?? "-"}</TableCell>
                      <TableCell className="text-right">{a.mtd.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", kpiColorClass(a.achievement))}>
                          {a.achievement.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{a.runRate.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", kpiColorClass(a.rrAchievement))}>
                          {a.rrAchievement.toFixed(1)}%
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
