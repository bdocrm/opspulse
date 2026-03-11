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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { usePagination } from '@/hooks/use-pagination';
import { PaginationControls } from '@/components/pagination-controls';
import { 
  Plus, Trash2, Users, UserCheck, UserX, ClipboardList, 
  TrendingUp, Calendar, Target, BarChart3, ChevronRight,
  RefreshCw, CheckCircle2, AlertCircle, Download, Search,
  Award, Clock, Percent, AlertTriangle, CalendarDays, Trophy
} from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  seatNumber: number | null;
  email: string;
  monthlyTarget?: number;
}

interface Campaign {
  id: string;
  campaignName: string;
}

interface TargetModalProps {
  agentId: string;
  agentName: string;
  currentTarget?: number;
  onClose: () => void;
  onSave: (target: number) => void;
  loading: boolean;
}

function TargetModal({ agentId, agentName, currentTarget, onClose, onSave, loading }: TargetModalProps) {
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
            <Button
              variant="outline"
              onClick={onClose}
              disabled={loading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={() => onSave(parseFloat(target) || 0)}
              disabled={loading || !target}
              className="flex-1"
            >
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

  // Check authorization - redirect non-collectors
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated" && (session?.user as any)?.role !== "COLLECTOR") {
      router.push("/dashboard");
    }
  }, [status, session, router]);

  const collectorCampaignId = (session?.user as any)?.campaignId;
  const collectorCampaignName = (session?.user as any)?.campaignName;

  const [agentName, setAgentName] = useState('');
  const [nextSeat, setNextSeat] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [targetModal, setTargetModal] = useState<{ agentId: string; agentName: string; currentTarget?: number } | null>(null);
  const [savingTarget, setSavingTarget] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [viewMode, setViewMode] = useState<'daily' | 'weekly' | 'mtd'>('daily');
  const [agentSearch, setAgentSearch] = useState('');
  const [sortBy, setSortBy] = useState<'seat' | 'booked' | 'name'>('booked');
  const [totalAgentsCount, setTotalAgentsCount] = useState(0);
  const pagination = usePagination(1, 25, totalAgentsCount);
  
  // Date range filter
  const today = new Date().toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [datePreset, setDatePreset] = useState<'today' | 'week' | 'month' | 'custom'>('today');
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  // Date preset handler
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

  // Check if user is COLLECTOR for their campaign
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated') {
      const user = session?.user as any;
      if (user?.role !== 'COLLECTOR') {
        router.push('/dashboard');
      }
    }
  }, [status, session, router]);

  const campaignId = (session?.user as any)?.campaignId;
  const campaignName = (session?.user as any)?.campaignName;

  const fetcher = (url: string) => fetch(url).then(r => r.json());

  // Fetch campaign data (goal and kpiMetric)
  const { data: campaignData } = useSWR(
    campaignId ? `/api/campaigns/${campaignId}` : null,
    fetcher
  );

  // Fetch campaign agents
  const { data: agentsData, mutate: mutateAgents, isLoading: loadingAgents } = useSWR(
    campaignId ? `/api/campaigns/${campaignId}/agents` : null,
    fetcher
  );

  // Fetch production data for date range
  const { data: productionData, isLoading: loadingProduction, mutate: mutateProduction } = useSWR(
    session?.user && dateFrom && dateTo ? `/api/collectors/production?dateFrom=${dateFrom}&dateTo=${dateTo}` : null,
    fetcher,
    { refreshInterval: 30000 }
  );

  // Fetch attendance for selected date (use dateTo for today's view)
  const { data: attendanceData, isLoading: loadingAttendance, mutate: mutateAttendance } = useSWR(
    session?.user && dateTo ? `/api/collectors/attendance?date=${dateTo}` : null,
    fetcher,
    { refreshInterval: 30000 }
  );

  const agents = Array.isArray(agentsData) ? agentsData : (agentsData?.data || []);
  const savedEntries = productionData?.entries || [];

  // Calculate KPIs
  const kpis = useMemo(() => {
    const totalAgents = agents.length;
    
    // Attendance count
    const attendanceMap = attendanceData?.attendance || {};
    let presentCount = 0;
    let absentCount = 0;
    agents.forEach((agent: any) => {
      const record = attendanceMap[agent.id];
      if (record?.status === 'ABSENT') {
        absentCount++;
      } else {
        presentCount++;
      }
    });

    // Production totals from saved entries
    let totalTransmittals = 0;
    let totalActivations = 0;
    let totalApprovals = 0;
    let totalBooked = 0;
    savedEntries.forEach((entry: any) => {
      entry.details?.forEach((detail: any) => {
        totalTransmittals += detail.transmittals || 0;
        totalActivations += detail.activations || 0;
        totalApprovals += detail.approvals || 0;
        totalBooked += detail.booked || 0;
      });
    });

    // Calculate target progress using campaign's KPI metric
    const totalTarget = agents.reduce((sum: number, a: any) => sum + (a.monthlyTarget || 0), 0);
    const kpiMetric = campaignData?.campaign?.kpiMetric || 'booked';
    const kpiValue = kpiMetric === 'booked' ? totalBooked :
                     kpiMetric === 'transmittals' ? totalTransmittals :
                     kpiMetric === 'activations' ? totalActivations :
                     kpiMetric === 'approvals' ? totalApprovals : totalBooked;
    
    // Use campaign's monthly goal if set, otherwise use sum of agents' targets
    let campaignGoal = campaignData?.kpis?.goal || 0;
    if (campaignGoal === 0 && totalTarget > 0) {
      campaignGoal = totalTarget;
    }
    
    const targetProgress = campaignGoal > 0 ? ((kpiValue / campaignGoal) * 100).toFixed(1) : '0';
    const remainingGoal = Math.max(0, campaignGoal - kpiValue);

    return {
      totalAgents,
      presentCount,
      absentCount,
      totalTransmittals,
      totalActivations,
      totalApprovals,
      totalBooked,
      entriesCount: savedEntries.length,
      totalTarget,
      targetProgress,
      campaignGoal,
      remainingGoal,
      kpiMetric,
      kpiValue,
    };
  }, [agents, attendanceData, savedEntries, campaignData]);

  // Per-agent production summary
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
  useEffect(() => {
    if (agents && agents.length > 0) {
      const maxSeat = Math.max(...agents.map((a: Agent) => a.seatNumber || 0));
      setNextSeat(maxSeat + 1);
    } else {
      setNextSeat(1);
    }
  }, [agents]);

  const handleAddAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentName.trim() || !campaignId) {
      setMessage('Please enter agent name');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const res = await fetch('/api/collectors/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentName,
          campaignId,
          seatNumber: nextSeat,
          role: 'AGENT',
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        setMessage(`Error: ${error.message || 'Failed to add agent'}`);
        return;
      }

      setMessage('✅ Agent added successfully!');
      setAgentName('');
      mutateAgents();
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
      mutateAgents();
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
      mutateAgents();
    } catch (error) {
      setMessage(`Error: ${(error as Error).message}`);
    } finally {
      setSavingTarget(false);
    }
  };

  // Toggle attendance status
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

  // Export to Excel/CSV
  const handleExport = () => {
    const attendanceMap = attendanceData?.attendance || {};
    const rows = agents.map((agent: Agent, index: number) => {
      const prod = agentProduction[agent.id] || { transmittals: 0, activations: 0, approvals: 0, booked: 0 };
      const attendance = attendanceMap[agent.id]?.status || 'PRESENT';
      const target = agent.monthlyTarget || 0;
      const progress = target > 0 ? ((prod.booked / target) * 100).toFixed(1) : '0';
      return {
        'Rank': index + 1,
        'Seat': agent.seatNumber,
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

    // Convert to CSV
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map((row: Record<string, string | number>) => headers.map(h => `"${row[h]}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `production-report-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Filtered and sorted agents
  const sortedAgents = useMemo(() => {
    const attendanceMap = attendanceData?.attendance || {};
    
    let filtered = agents.filter((agent: Agent) => 
      agent.name.toLowerCase().includes(agentSearch.toLowerCase())
    );

    // Sort by booked (descending) for leaderboard
    filtered = filtered.sort((a: Agent, b: Agent) => {
      if (sortBy === 'booked') {
        const aProd = agentProduction[a.id]?.booked || 0;
        const bProd = agentProduction[b.id]?.booked || 0;
        return bProd - aProd;
      } else if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      } else {
        return (a.seatNumber || 0) - (b.seatNumber || 0);
      }
    });

    return filtered;
  }, [agents, agentSearch, sortBy, agentProduction, attendanceData]);

  // Update pagination total when filtered agents change
  useEffect(() => {
    setTotalAgentsCount(sortedAgents.length);
    pagination.goToPage(1);
  }, [sortedAgents.length, pagination]);

  // Get paginated agents
  const paginatedAgents = sortedAgents.slice(
    pagination.startIndex,
    pagination.endIndex
  );

  // Get rank badge
  const getRankBadge = (index: number) => {
    if (index === 0) return <span className="text-yellow-500 text-lg">🥇</span>;
    if (index === 1) return <span className="text-gray-400 text-lg">🥈</span>;
    if (index === 2) return <span className="text-amber-600 text-lg">🥉</span>;
    return <span className="text-muted-foreground text-sm">{index + 1}</span>;
  };

  // Get progress color based on percentage
  const getProgressColor = (progress: number) => {
    if (progress >= 100) return 'bg-green-500';
    if (progress >= 75) return 'bg-blue-500';
    if (progress >= 50) return 'bg-yellow-500';
    if (progress >= 25) return 'bg-orange-500';
    return 'bg-red-500';
  };

  // Find low performers (below 25% of average)
  const lowPerformers = useMemo(() => {
    if (agents.length === 0) return [];
    const avgBooked = kpis.totalBooked / Math.max(kpis.presentCount, 1);
    return agents.filter((agent: Agent) => {
      const prod = agentProduction[agent.id]?.booked || 0;
      const attendanceMap = attendanceData?.attendance || {};
      const isPresent = attendanceMap[agent.id]?.status !== 'ABSENT';
      return isPresent && prod < avgBooked * 0.25;
    });
  }, [agents, kpis, agentProduction, attendanceData]);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Collector Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Campaign: <span className="font-semibold text-foreground">{campaignName}</span>
          </p>
        </div>
      </div>

      {/* Date Range Filter */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Date Range:</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={datePreset === 'today' ? 'default' : 'outline'}
                onClick={() => handleDatePreset('today')}
              >
                Today
              </Button>
              <Button
                size="sm"
                variant={datePreset === 'week' ? 'default' : 'outline'}
                onClick={() => handleDatePreset('week')}
              >
                Last 7 Days
              </Button>
              <Button
                size="sm"
                variant={datePreset === 'month' ? 'default' : 'outline'}
                onClick={() => handleDatePreset('month')}
              >
                MTD
              </Button>
              <div className="flex items-center gap-2 ml-2">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setDatePreset('custom'); }}
                  className="w-36 h-8"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setDatePreset('custom'); }}
                  className="w-36 h-8"
                />
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
          className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
            message.startsWith('Error') || message.startsWith('❌') 
              ? 'bg-red-900/20 text-red-400 border border-red-800' 
              : 'bg-green-900/20 text-green-400 border border-green-800'
          }`}
        >
          {message.startsWith('Error') || message.startsWith('❌') ? (
            <AlertCircle className="w-4 h-4" />
          ) : (
            <CheckCircle2 className="w-4 h-4" />
          )}
          {message}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="bg-gradient-to-br from-indigo-500/10 to-indigo-600/5 border-indigo-500/20">
          <CardContent className="pt-4">
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Campaign Goal ({kpis.kpiMetric})</p>
              <p className="text-3xl font-bold text-indigo-500">{kpis.campaignGoal.toLocaleString()}</p>
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

        <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Present Today</p>
                <p className="text-3xl font-bold mt-1 text-green-500">{kpis.presentCount}</p>
                {kpis.absentCount > 0 && (
                  <p className="text-xs text-red-400">{kpis.absentCount} absent</p>
                )}
              </div>
              <UserCheck className="w-8 h-8 text-green-500 opacity-80" />
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
                  <div className="p-2 rounded-lg bg-primary/10">
                    <ClipboardList className="w-6 h-6 text-primary" />
                  </div>
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

        <Card 
          className="hover:border-primary/50 transition-colors cursor-pointer group"
          onClick={() => setShowAddAgent(!showAddAgent)}
        >
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Plus className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <p className="font-semibold">Add Agent</p>
                  <p className="text-sm text-muted-foreground">Register new member</p>
                </div>
              </div>
              <ChevronRight className={`w-5 h-5 text-muted-foreground transition-transform ${showAddAgent ? 'rotate-90' : ''}`} />
            </div>
          </CardContent>
        </Card>

        <Card 
          className="hover:border-green-500/50 transition-colors cursor-pointer group"
          onClick={handleExport}
        >
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <Download className="w-6 h-6 text-green-500" />
                </div>
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
                    {lowPerformers.slice(0, 3).map((a: Agent) => a.name).join(', ')}
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
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Add New Agent</CardTitle>
            <CardDescription>Register a new agent for your campaign</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddAgent} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="agentName">Agent Name</Label>
                  <Input
                    id="agentName"
                    placeholder="Enter agent name"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="seatNumber">Seat Number (Auto)</Label>
                  <Input
                    id="seatNumber"
                    type="number"
                    value={nextSeat}
                    disabled
                    className="bg-muted"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={loading}>
                  <Plus className="h-4 w-4 mr-2" />
                  {loading ? 'Adding...' : 'Add Agent'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowAddAgent(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Today's Production Summary */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                Production Leaderboard
              </CardTitle>
              <CardDescription>Live ranking by today's booked sales</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {(loadingProduction || loadingAttendance) && (
                <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
              )}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search agents..."
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                  className="pl-8 w-48"
                />
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
        </CardHeader>
        <CardContent>
          {/* Production Totals */}
          <div className="grid grid-cols-4 gap-3 mb-4 p-3 bg-muted/50 rounded-lg">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Transmittals</p>
              <p className="text-xl font-bold">{kpis.totalTransmittals}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Activations</p>
              <p className="text-xl font-bold">{kpis.totalActivations}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Approvals</p>
              <p className="text-xl font-bold">{kpis.totalApprovals}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Booked</p>
              <p className="text-xl font-bold text-primary">{kpis.totalBooked}</p>
            </div>
          </div>

          {/* MTD Target Progress */}
          {kpis.totalTarget > 0 && (
            <div className="mb-4 p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Team Target Progress
                </span>
                <span className="text-sm">
                  <span className="font-bold text-primary">{kpis.totalBooked}</span>
                  <span className="text-muted-foreground"> / {kpis.totalTarget}</span>
                  <span className="ml-2 text-xs">({kpis.targetProgress}%)</span>
                </span>
              </div>
              <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${getProgressColor(Number(kpis.targetProgress))}`}
                  style={{ width: `${Math.min(Number(kpis.targetProgress), 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Agent List with Production */}
          {sortedAgents.length > 0 ? (
            <div className="max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-12">Rank</TableHead>
                    <TableHead className="w-12">Seat</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-center w-20">Attendance</TableHead>
                    <TableHead className="text-center">Trans</TableHead>
                    <TableHead className="text-center">Act</TableHead>
                    <TableHead className="text-center">Appr</TableHead>
                    <TableHead className="text-center">Booked</TableHead>
                    <TableHead className="w-32">Progress</TableHead>
                    <TableHead className="text-right w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedAgents.map((agent: Agent, index: number) => {
                    const prod = agentProduction[agent.id] || { transmittals: 0, activations: 0, approvals: 0, booked: 0 };
                    const attendanceRecord = attendanceData?.attendance?.[agent.id];
                    const isPresent = !attendanceRecord || attendanceRecord.status === 'PRESENT';
                    
                    // Use campaign's KPI metric for progress
                    const kpiValue = kpis.kpiMetric === 'booked' ? prod.booked :
                                     kpis.kpiMetric === 'transmittals' ? prod.transmittals :
                                     kpis.kpiMetric === 'activations' ? prod.activations :
                                     kpis.kpiMetric === 'approvals' ? prod.approvals : prod.booked;
                    
                    const progressNum = agent.monthlyTarget ? (kpiValue / agent.monthlyTarget) * 100 : 0;
                    const progressStr = progressNum.toFixed(0);
                    
                    return (
                      <TableRow key={agent.id} className={!isPresent ? 'opacity-50 bg-muted/30' : ''}>
                        <TableCell className="text-center">
                          {sortBy === 'booked' ? getRankBadge(index) : <span className="text-muted-foreground text-sm">-</span>}
                        </TableCell>
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
                            title="Click to toggle"
                          >
                            {isPresent ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
                            <span>{isPresent ? 'P' : 'A'}</span>
                          </button>
                        </TableCell>
                        <TableCell className="text-center">{prod.transmittals}</TableCell>
                        <TableCell className="text-center">{prod.activations}</TableCell>
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
                                {progressStr}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">No target</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setTargetModal({
                                agentId: agent.id,
                                agentName: agent.name,
                                currentTarget: agent.monthlyTarget,
                              })}
                              title="Set Target"
                            >
                              <Target className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
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
              <div className="mt-4 flex justify-center">
                <PaginationControls pagination={pagination} />
              </div>
            </div>
          ) : agents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No agents added yet.</p>
              <Button variant="link" onClick={() => setShowAddAgent(true)} className="mt-2">
                Add your first agent
              </Button>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No agents match "{agentSearch}"</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Target Modal */}
      {targetModal && (
        <TargetModal
          agentId={targetModal.agentId}
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
