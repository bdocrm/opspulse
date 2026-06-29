'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CampaignSummaryCard } from '@/components/campaign-summary-card';
import {
  Plus, Trash2, Users, UserCheck, UserX, ClipboardList,
  TrendingUp, Target, ChevronRight,
  RefreshCw, CheckCircle2, AlertCircle, Download, Search,
  AlertTriangle, CalendarDays, Trophy
} from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  seatNumber: number | null;
  email: string;
  monthlyTarget?: number;
}

interface Production {
  transmittals: number;
  activations: number;
  approvals: number;
  booked: number;
}

interface CampaignBlock {
  id: string;
  campaignName: string;
  kpiMetric: string;
  goal: number;
  agents: Agent[];
  production: Record<string, Production>;
  attendance: Record<string, { status: string; remarks: string | null }>;
  entriesCount: number;
}

const ZERO_PROD: Production = { transmittals: 0, activations: 0, approvals: 0, booked: 0 };

function kpiValueFor(metric: string, prod: Production): number {
  switch (metric) {
    case 'transmittals': return prod.transmittals;
    case 'activations': return prod.activations;
    case 'approvals': return prod.approvals;
    default: return prod.booked;
  }
}

const getProgressColor = (progress: number) => {
  if (progress >= 100) return 'bg-green-500';
  if (progress >= 75) return 'bg-blue-500';
  if (progress >= 50) return 'bg-yellow-500';
  if (progress >= 25) return 'bg-orange-500';
  return 'bg-red-500';
};

const getRankBadge = (index: number) => {
  if (index === 0) return <span className="text-yellow-500 text-lg">🥇</span>;
  if (index === 1) return <span className="text-gray-400 text-lg">🥈</span>;
  if (index === 2) return <span className="text-amber-600 text-lg">🥉</span>;
  return <span className="text-muted-foreground text-sm">{index + 1}</span>;
};

interface TargetModalProps {
  agentName: string;
  currentTarget?: number;
  onClose: () => void;
  onSave: (target: number) => void;
  loading: boolean;
}

function TargetModal({ agentName, currentTarget, onClose, onSave, loading }: TargetModalProps) {
  const [target, setTarget] = useState(currentTarget?.toString() || '');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set Target for {agentName}</CardTitle>
          <CardDescription>Monthly target/goal for this agent</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="target">Monthly Target</Label>
            <Input
              id="target"
              type="number"
              placeholder="0"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
              Cancel
            </Button>
            <Button onClick={() => onSave(parseFloat(target) || 0)} disabled={loading || !target} className="flex-1">
              {loading ? 'Saving...' : 'Save Target'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


export default function CollectorDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Authorization — only collectors.
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated' && (session?.user as any)?.role !== 'COLLECTOR') {
      router.push('/dashboard');
    }
  }, [status, session, router]);

  const [agentName, setAgentName] = useState('');
  const [addAgentCampaignId, setAddAgentCampaignId] = useState('');
  const [nextSeat, setNextSeat] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [createdAgent, setCreatedAgent] = useState<{ name: string; email: string; seatNumber: number; campaignName: string } | null>(null);
  const [targetModal, setTargetModal] = useState<{ agentId: string; agentName: string; currentTarget?: number } | null>(null);
  const [savingTarget, setSavingTarget] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [agentSearch, setAgentSearch] = useState('');
  const [sortBy, setSortBy] = useState<'seat' | 'booked' | 'name'>('booked');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  // Date range filter
  const today = new Date().toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [datePreset, setDatePreset] = useState<'today' | 'week' | 'month' | 'custom'>('today');

  const handleDatePreset = (preset: 'today' | 'week' | 'month' | 'custom') => {
    setDatePreset(preset);
    const now = new Date();
    if (preset === 'today') {
      setDateFrom(today);
      setDateTo(today);
    } else if (preset === 'week') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 6);
      setDateFrom(weekAgo.toISOString().split('T')[0]);
      setDateTo(today);
    } else if (preset === 'month') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      setDateFrom(monthStart.toISOString().split('T')[0]);
      setDateTo(today);
    }
  };

  const fetcher = (url: string) => fetch(url).then((r) => r.json());

  // Single aggregate request: all assigned campaigns + production + attendance,
  // grouped by campaign. Avoids per-campaign round-trips (no N+1, no duplicate
  // requests) and returns only campaigns assigned to this collector.
  const { data: dashboardData, isLoading: loadingDashboard, mutate: mutateDashboard } = useSWR(
    session?.user && dateFrom && dateTo
      ? `/api/collectors/dashboard?dateFrom=${dateFrom}&dateTo=${dateTo}&attendanceDate=${dateTo}`
      : null,
    fetcher,
    { refreshInterval: 30000 }
  );

  const allCampaigns: CampaignBlock[] = useMemo(
    () => (Array.isArray(dashboardData?.campaigns) ? dashboardData.campaigns : []),
    [dashboardData]
  );

  // Filter campaigns based on selected campaign
  const campaigns: CampaignBlock[] = useMemo(
    () => selectedCampaignId ? allCampaigns.filter(c => c.id === selectedCampaignId) : allCampaigns,
    [allCampaigns, selectedCampaignId]
  );

  // Default the Add-Agent campaign selector to the first assigned campaign.
  useEffect(() => {
    if (allCampaigns.length > 0 && !allCampaigns.some((c) => c.id === addAgentCampaignId)) {
      setAddAgentCampaignId(allCampaigns[0].id);
    }
  }, [allCampaigns, addAgentCampaignId]);

  // Default the selected campaign to the first one
  useEffect(() => {
    if (allCampaigns.length > 0 && !selectedCampaignId) {
      setSelectedCampaignId(allCampaigns[0].id);
    }
  }, [allCampaigns, selectedCampaignId]);

  // Global KPI roll-up across every assigned campaign.
  const kpis = useMemo(() => {
    let totalAgents = 0, presentCount = 0, absentCount = 0;
    let totalTransmittals = 0, totalActivations = 0, totalApprovals = 0, totalBooked = 0;
    let totalGoal = 0, kpiValue = 0, totalTarget = 0, entriesCount = 0;

    for (const c of campaigns) {
      totalAgents += c.agents.length;
      totalGoal += c.goal || 0;
      entriesCount += c.entriesCount || 0;
      let campaignKpi = 0;
      for (const a of c.agents) {
        const p = c.production[a.id] || ZERO_PROD;
        totalTransmittals += p.transmittals;
        totalActivations += p.activations;
        totalApprovals += p.approvals;
        totalBooked += p.booked;
        totalTarget += a.monthlyTarget || 0;
        campaignKpi += kpiValueFor(c.kpiMetric, p);
        const record = c.attendance[a.id];
        if (record?.status === 'ABSENT') absentCount++;
        else presentCount++;
      }
      kpiValue += campaignKpi;
    }

    let goal = totalGoal;
    if (goal === 0 && totalTarget > 0) goal = totalTarget;
    const targetProgress = goal > 0 ? ((kpiValue / goal) * 100).toFixed(1) : '0';
    const remainingGoal = Math.max(0, goal - kpiValue);

    return {
      totalAgents, presentCount, absentCount,
      totalTransmittals, totalActivations, totalApprovals, totalBooked,
      goal, kpiValue, targetProgress, remainingGoal, totalTarget, entriesCount,
    };
  }, [campaigns]);

  // Next seat is per selected campaign (seats are unique within a campaign).
  useEffect(() => {
    const block = allCampaigns.find((c) => c.id === addAgentCampaignId);
    if (block && block.agents.length > 0) {
      setNextSeat(Math.max(...block.agents.map((a) => a.seatNumber || 0)) + 1);
    } else {
      setNextSeat(1);
    }
  }, [allCampaigns, addAgentCampaignId]);

  // Low performers across selected campaigns (below 25% of overall present average).
  const lowPerformers = useMemo(() => {
    if (kpis.totalAgents === 0) return [];
    const avgBooked = kpis.totalBooked / Math.max(kpis.presentCount, 1);
    const result: Agent[] = [];
    for (const c of campaigns) {
      for (const a of c.agents) {
        const prod = c.production[a.id] || ZERO_PROD;
        const record = c.attendance[a.id];
        const isPresent = !record || record.status !== 'ABSENT';
        if (isPresent && prod.booked < avgBooked * 0.25) result.push(a);
      }
    }
    return result;
  }, [campaigns, kpis]);

  const handleAddAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentName.trim() || !addAgentCampaignId) {
      setMessage('Please enter an agent name and select a campaign');
      return;
    }
    const block = campaigns.find((c) => c.id === addAgentCampaignId);

    setLoading(true);
    setMessage('');
    setCreatedAgent(null);

    try {
      const res = await fetch('/api/collectors/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentName,
          campaignId: addAgentCampaignId,
          seatNumber: nextSeat,
          role: 'AGENT',
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        setMessage(`Error: ${error.message || 'Failed to add agent'}`);
        return;
      }

      const created = await res.json();
      setCreatedAgent({
        name: created.name,
        email: created.email,
        seatNumber: created.seatNumber,
        campaignName: block?.campaignName || '',
      });
      setMessage(`✅ Agent "${created.name}" (Seat ${created.seatNumber}) added successfully to ${block?.campaignName}!`);
      setAgentName('');
      setShowAddAgent(false);
      mutateDashboard();
    } catch (error) {
      setMessage(`Error: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAgent = async (agentId: string) => {
    if (!confirm('Are you sure you want to remove this agent?')) return;
    try {
      const res = await fetch(`/api/collectors/agents/${agentId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete agent');
      mutateDashboard();
      setMessage('✅ Agent removed successfully!');
    } catch (error) {
      setMessage(`Error: ${(error as Error).message}`);
    }
  };

  const handleSaveTarget = async (target: number) => {
    if (!targetModal) return;
    setSavingTarget(true);
    try {
      const res = await fetch(`/api/collectors/agents/${targetModal.agentId}/targets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      if (!res.ok) throw new Error('Failed to save target');
      setMessage(`✅ Target updated for ${targetModal.agentName}!`);
      setTargetModal(null);
      mutateDashboard();
    } catch (error) {
      setMessage(`Error: ${(error as Error).message}`);
    } finally {
      setSavingTarget(false);
    }
  };

  const handleToggleAttendance = async (agentId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'ABSENT' ? 'PRESENT' : 'ABSENT';
    try {
      await fetch('/api/collectors/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, date: today, status: newStatus }),
      });
      mutateDashboard();
    } catch (error) {
      console.error('Failed to toggle attendance', error);
    }
  };

  // Export every assigned campaign's agents to a single CSV (Campaign column
  // disambiguates the grouped data).
  const handleExport = () => {
    const rows: Record<string, string | number>[] = [];
    for (const c of campaigns) {
      const sorted = [...c.agents].sort(
        (a, b) => (c.production[b.id]?.booked || 0) - (c.production[a.id]?.booked || 0)
      );
      sorted.forEach((agent, index) => {
        const prod = c.production[agent.id] || ZERO_PROD;
        const record = c.attendance[agent.id];
        const attendance = record?.status || 'PRESENT';
        const target = agent.monthlyTarget || 0;
        const progress = target > 0 ? ((prod.booked / target) * 100).toFixed(1) : '0';
        rows.push({
          Campaign: c.campaignName,
          Rank: index + 1,
          Seat: agent.seatNumber ?? '',
          'Agent Name': agent.name,
          Status: attendance,
          Transmittals: prod.transmittals,
          Approvals: prod.approvals,
          Booked: prod.booked,
          Target: target,
          'Progress %': progress,
        });
      });
    }

    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => `"${row[h]}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `production-report-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Only campaigns that actually have collectors appear in the leaderboard.
  const nonEmptyCampaigns = campaigns.filter((c) => c.agents.length > 0);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const campaignLabel =
    allCampaigns.length === 0
      ? 'No campaigns assigned'
      : allCampaigns.length === 1
      ? allCampaigns[0].campaignName
      : `${allCampaigns.length} campaigns`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Collector Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Campaign{allCampaigns.length > 1 ? 's' : ''}:{' '}
            <span className="font-semibold text-foreground">{campaignLabel}</span>
          </p>
        </div>
      </div>

      {/* Campaign Selector */}
      {allCampaigns.length > 1 && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-muted-foreground">Select Campaign:</label>
              <Select value={selectedCampaignId || ''} onValueChange={setSelectedCampaignId}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Choose a campaign..." />
                </SelectTrigger>
                <SelectContent>
                  {allCampaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.campaignName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Date Range Filter */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Date Range:</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant={datePreset === 'today' ? 'default' : 'outline'} onClick={() => handleDatePreset('today')}>Today</Button>
              <Button size="sm" variant={datePreset === 'week' ? 'default' : 'outline'} onClick={() => handleDatePreset('week')}>Last 7 Days</Button>
              <Button size="sm" variant={datePreset === 'month' ? 'default' : 'outline'} onClick={() => handleDatePreset('month')}>MTD</Button>
              <div className="flex items-center gap-2 ml-2">
                <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setDatePreset('custom'); }} className="w-36 h-8" />
                <span className="text-muted-foreground">to</span>
                <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setDatePreset('custom'); }} className="w-36 h-8" />
              </div>
            </div>
            <div className="ml-auto text-sm text-muted-foreground">
              {dateFrom === dateTo ? (
                <span>{new Date(dateFrom).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              ) : (
                <span>{new Date(dateFrom).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(dateTo).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Message Display */}
      {message && (
        <div
          className={`p-4 rounded-lg text-sm flex items-start gap-3 border ${
            message.startsWith('Error') || message.startsWith('❌')
              ? 'bg-red-50 text-red-900 border-red-200'
              : 'bg-green-50 text-green-900 border-green-200'
          }`}
        >
          {message.startsWith('Error') || message.startsWith('❌') ? (
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p className="font-semibold">{message.startsWith('Error') ? 'Error' : 'Success'}</p>
            <p className="text-sm mt-1">{message.replace('Error: ', '').replace('✅ ', '')}</p>
          </div>
        </div>
      )}

      {/* Created Agent Credentials Card */}
      {createdAgent && (
        <Card className="border-green-200 bg-gradient-to-r from-green-50 to-emerald-50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-green-900">
              <UserCheck className="w-5 h-5 text-green-600" />
              Agent Account Created
            </CardTitle>
            <CardDescription className="text-green-700">New agent has been successfully registered</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 bg-white/80 rounded border border-green-200">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Agent Name</p>
                <p className="font-semibold text-green-900 mt-1">{createdAgent.name}</p>
              </div>
              <div className="p-3 bg-white/80 rounded border border-green-200">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Seat Number</p>
                <p className="font-semibold text-green-900 mt-1">Seat {createdAgent.seatNumber}</p>
              </div>
              <div className="p-3 bg-white/80 rounded border border-green-200 md:col-span-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">System Email</p>
                <p className="font-mono text-sm text-green-900 mt-1 break-all">{createdAgent.email}</p>
              </div>
            </div>
            <div className="p-3 bg-blue-50 rounded border border-blue-200">
              <p className="text-xs text-blue-700 font-semibold">💡 Info:</p>
              <p className="text-xs text-blue-700 mt-1">
                This agent is automatically assigned to <span className="font-semibold">{createdAgent.campaignName}</span>.
                They will access the system through the data entry interface.
              </p>
            </div>
            <Button onClick={() => setCreatedAgent(null)} variant="outline" className="w-full border-green-200">Close</Button>
          </CardContent>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-indigo-500/10 to-indigo-600/5 border-indigo-500/20">
          <CardContent className="pt-4">
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Goal</p>
              <p className="text-3xl font-bold text-indigo-500">{kpis.goal.toLocaleString()}</p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Progress: {kpis.kpiValue.toLocaleString()}</span>
                <span className="font-semibold text-indigo-500">{kpis.targetProgress}%</span>
              </div>
              {kpis.remainingGoal > 0 && (
                <p className="text-xs text-orange-500 font-semibold">To Go: {kpis.remainingGoal.toLocaleString()}</p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Agents</p>
                <p className="text-3xl font-bold mt-1">{kpis.totalAgents}</p>
              </div>
              <Users className="w-8 h-8 text-blue-500 opacity-80" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Booked Today</p>
                <p className="text-3xl font-bold mt-1 text-purple-500">{kpis.totalBooked}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-purple-500 opacity-80" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/20">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Entries Today</p>
                <p className="text-3xl font-bold mt-1 text-orange-500">{kpis.entriesCount}</p>
              </div>
              <ClipboardList className="w-8 h-8 text-orange-500 opacity-80" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/collector/data-entry">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer group h-full">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10"><ClipboardList className="w-6 h-6 text-primary" /></div>
                  <div>
                    <p className="font-semibold">Data Entry</p>
                    <p className="text-sm text-muted-foreground">Enter production metrics</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Card className="hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => setShowAddAgent(!showAddAgent)}>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10"><Plus className="w-6 h-6 text-blue-500" /></div>
                <div>
                  <p className="font-semibold">Add Agent</p>
                  <p className="text-sm text-muted-foreground">Register new member</p>
                </div>
              </div>
              <ChevronRight className={`w-5 h-5 text-muted-foreground transition-transform ${showAddAgent ? 'rotate-90' : ''}`} />
            </div>
          </CardContent>
        </Card>

        <Card className="hover:border-green-500/50 transition-colors cursor-pointer group" onClick={handleExport}>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10"><Download className="w-6 h-6 text-green-500" /></div>
                <div>
                  <p className="font-semibold">Export Report</p>
                  <p className="text-sm text-muted-foreground">Download CSV</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-green-500 transition-colors" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Low Performer Alerts */}
      {lowPerformers.length > 0 && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />
              <div>
                <p className="font-semibold text-yellow-500">Attention Required</p>
                <p className="text-sm text-muted-foreground">
                  {lowPerformers.length} agent{lowPerformers.length > 1 ? 's' : ''} performing below 25% of team average:
                  <span className="font-medium text-foreground ml-1">
                    {lowPerformers.slice(0, 3).map((a) => a.name).join(', ')}
                    {lowPerformers.length > 3 && ` +${lowPerformers.length - 3} more`}
                  </span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add Agent Form (Collapsible) */}
      {showAddAgent && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2"><Plus className="w-5 h-5 text-blue-600" />Add New Agent</CardTitle>
            <CardDescription>Register a new agent for one of your campaigns</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddAgent} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="addCampaign">Campaign *</Label>
                  <Select value={addAgentCampaignId} onValueChange={setAddAgentCampaignId}>
                    <SelectTrigger id="addCampaign" className="border-blue-200">
                      <SelectValue placeholder="Select campaign" />
                    </SelectTrigger>
                    <SelectContent>
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.campaignName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agentName">Agent Name *</Label>
                  <Input
                    id="agentName"
                    placeholder="e.g., John Smith"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    disabled={loading}
                    className="border-blue-200 focus:border-blue-500"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="seatNumber">Seat Number (Auto)</Label>
                  <Input id="seatNumber" type="number" value={nextSeat} disabled className="bg-muted text-muted-foreground" />
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-900">
                  <span className="font-semibold">ℹ️ Auto-Generated:</span> A unique system email and credentials will be created for this agent upon submission.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={loading || campaigns.length === 0} className="bg-blue-600 hover:bg-blue-700">
                  <Plus className="h-4 w-4 mr-2" />
                  {loading ? 'Adding Agent...' : 'Add Agent'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowAddAgent(false)} disabled={loading}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Per-Campaign Summary Cards */}
      {nonEmptyCampaigns.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-500" />
            Campaign Overview
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {nonEmptyCampaigns.map((campaign) => {
              const campaignAgents = campaign.agents;
              const campaignGoal = campaign.goal;
              const campaignKpi = campaign.kpiMetric;
              const presentCount = campaignAgents.filter(a => {
                const record = campaign.attendance[a.id];
                return !record || record.status === 'PRESENT';
              }).length;
              const totalKpiValue = campaignAgents.reduce((sum, agent) => {
                const prod = campaign.production[agent.id] || ZERO_PROD;
                return sum + kpiValueFor(campaignKpi, prod);
              }, 0);
              const goalProgress = campaignGoal > 0 ? ((totalKpiValue / campaignGoal) * 100).toFixed(1) : '0';

              return (
                <Card key={campaign.id} className="relative overflow-hidden hover:shadow-md transition-shadow">
                  {/* Background accent */}
                  <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-blue-500/5 to-blue-600/5 rounded-bl-full" />

                  <CardContent className="pt-6 relative">
                    <div className="space-y-4">
                      {/* Campaign Header */}
                      <div>
                        <h3 className="font-bold text-lg text-foreground">{campaign.campaignName}</h3>
                        <p className="text-xs text-muted-foreground capitalize mt-1">
                          {campaignKpi.replace(/([A-Z])/g, ' $1').trim()}
                        </p>
                      </div>

                      {/* Goal and Progress */}
                      <div className="space-y-2">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs text-muted-foreground uppercase tracking-wide">Campaign Goal</span>
                          <span className="text-xl font-bold text-blue-600">{campaignGoal.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                Number(goalProgress) >= 100 ? 'bg-green-500' :
                                Number(goalProgress) >= 75 ? 'bg-blue-500' :
                                Number(goalProgress) >= 50 ? 'bg-yellow-500' :
                                'bg-red-500'
                              }`}
                              style={{ width: `${Math.min(Number(goalProgress), 100)}%` }}
                            />
                          </div>
                          <span className="text-sm font-semibold text-foreground w-12 text-right">{goalProgress}%</span>
                        </div>
                      </div>

                      {/* Stats Grid */}
                      <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                        <div className="text-center">
                          <p className="text-2xl font-bold text-foreground">{campaignAgents.length}</p>
                          <p className="text-xs text-muted-foreground mt-1">Agents</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-primary">{totalKpiValue.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground mt-1 capitalize">{campaignKpi}</p>
                        </div>
                      </div>

                      {/* Entries */}
                      <div className="pt-2 border-t">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Entries Today</span>
                          <span className="text-sm font-semibold text-orange-500">{campaign.entriesCount}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Production Leaderboard — grouped by campaign */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-500" />
              Production Leaderboard
            </h2>
            <p className="text-sm text-muted-foreground">Ranked by booked sales, grouped by campaign</p>
          </div>
          <div className="flex items-center gap-2">
            {loadingDashboard && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search agents..." value={agentSearch} onChange={(e) => setAgentSearch(e.target.value)} className="pl-8 w-48" />
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'seat' | 'booked' | 'name')}
              className="h-9 px-3 rounded-md border bg-background text-sm"
            >
              <option value="booked">Sort by Booked</option>
              <option value="seat">Sort by Seat</option>
              <option value="name">Sort by Name</option>
            </select>
          </div>
        </div>

        {nonEmptyCampaigns.length > 0 ? (
          <div className="space-y-4">
            {nonEmptyCampaigns.map((block) => {
              const prodFor = (agentId: string) => block.production[agentId] || ZERO_PROD;
              const q = agentSearch.trim().toLowerCase();
              let filtered = block.agents.filter((a) => a.name.toLowerCase().includes(q));
              filtered = [...filtered].sort((a, b) => {
                if (sortBy === 'booked') return prodFor(b.id).booked - prodFor(a.id).booked;
                if (sortBy === 'name') return a.name.localeCompare(b.name);
                return (a.seatNumber || 0) - (b.seatNumber || 0);
              });

              return (
                <CampaignSummaryCard
                  key={block.id}
                  id={block.id}
                  campaignName={block.campaignName}
                  kpiMetric={block.kpiMetric}
                  goal={block.goal}
                  agents={block.agents}
                  production={block.production}
                  attendance={block.attendance}
                  entriesCount={block.entriesCount}
                >
                  {/* Collector Table */}
                  {filtered.length > 0 ? (
                    <div className="max-h-[420px] overflow-y-auto">
                      <Table>
                        <TableHeader className="sticky top-0 bg-card z-10">
                          <TableRow>
                            <TableHead className="w-12">Rank</TableHead>
                            <TableHead className="w-12">Seat</TableHead>
                            <TableHead>Collector</TableHead>
                            <TableHead className="text-center w-20">Attendance</TableHead>
                            <TableHead className="text-center">Trans</TableHead>
                            <TableHead className="text-center">Appr</TableHead>
                            <TableHead className="text-center">Booked</TableHead>
                            <TableHead className="w-32">Progress</TableHead>
                            <TableHead className="text-right w-20">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filtered.map((agent, index) => {
                            const prod = prodFor(agent.id);
                            const record = block.attendance[agent.id];
                            const isPresent = !record || record.status === 'PRESENT';
                            const value = kpiValueFor(block.kpiMetric, prod);
                            const progressNum = agent.monthlyTarget ? (value / agent.monthlyTarget) * 100 : 0;

                            return (
                              <TableRow key={agent.id} className={!isPresent ? 'opacity-50 bg-muted/30' : ''}>
                                <TableCell className="text-center">
                                  {sortBy === 'booked' ? getRankBadge(index) : <span className="text-muted-foreground text-sm">-</span>}
                                </TableCell>
                                <TableCell className="font-semibold text-muted-foreground">{agent.seatNumber}</TableCell>
                                <TableCell className="font-medium">{agent.name}</TableCell>
                                <TableCell className="text-center">
                                  <button
                                    onClick={() => handleToggleAttendance(agent.id, record?.status || 'PRESENT')}
                                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors cursor-pointer ${
                                      isPresent
                                        ? 'text-green-500 bg-green-500/10 hover:bg-green-500/20'
                                        : 'text-red-500 bg-red-500/10 hover:bg-red-500/20'
                                    }`}
                                    title="Click to toggle"
                                  >
                                    {isPresent ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
                                    <span>{isPresent ? 'P' : 'A'}</span>
                                  </button>
                                </TableCell>
                                <TableCell className="text-center">{prod.transmittals}</TableCell>
                                <TableCell className="text-center">{prod.approvals}</TableCell>
                                <TableCell className="text-center font-semibold text-primary">{prod.booked}</TableCell>
                                <TableCell>
                                  {agent.monthlyTarget ? (
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                        <div
                                          className={`h-full transition-all ${getProgressColor(progressNum)}`}
                                          style={{ width: `${Math.min(progressNum, 100)}%` }}
                                        />
                                      </div>
                                      <span className={`text-xs w-10 text-right ${
                                        progressNum >= 100 ? 'text-green-500 font-bold' :
                                        progressNum >= 75 ? 'text-blue-500' :
                                        progressNum >= 50 ? 'text-yellow-500' :
                                        'text-muted-foreground'
                                      }`}>
                                        {progressNum.toFixed(0)}%
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">No target</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex gap-1 justify-end">
                                    <Button
                                      variant="ghost" size="icon" className="h-7 w-7"
                                      onClick={() => setTargetModal({ agentId: agent.id, agentName: agent.name, currentTarget: agent.monthlyTarget })}
                                      title="Set Target"
                                    >
                                      <Target className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost" size="icon"
                                      className="h-7 w-7 text-destructive hover:text-destructive"
                                      onClick={() => handleDeleteAgent(agent.id)}
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
                  ) : (
                    <div className="text-center py-6 text-muted-foreground text-sm">
                      <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p>No collectors match &quot;{agentSearch}&quot;</p>
                    </div>
                  )}
                </CampaignSummaryCard>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="text-center py-10 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              {campaigns.length === 0 ? (
                <p>No campaigns are assigned to your account yet.</p>
              ) : (
                <>
                  <p>No agents added yet.</p>
                  <Button variant="link" onClick={() => setShowAddAgent(true)} className="mt-2">Add your first agent</Button>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Target Modal */}
      {targetModal && (
        <TargetModal
          agentName={targetModal.agentName}
          currentTarget={targetModal.currentTarget}
          onClose={() => setTargetModal(null)}
          onSave={handleSaveTarget}
          loading={savingTarget}
        />
      )}
    </div>
  );
}
