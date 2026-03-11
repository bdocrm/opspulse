'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Trash2, Plus, Search, Clock, Users, ChevronLeft, ChevronRight, CheckCircle2, RefreshCw, Grid3X3, List, UserCheck, UserX } from 'lucide-react';

interface AgentDetail {
  agentId: string;
  transmittals: number;
  activations: number;
  approvals: number;
  booked: number;
  qualityRate: number;
  conversionRate: number;
}

interface SavedEntry {
  id: string;
  time: string;
  createdAt: string;
  details: Array<{
    agentId: string;
    transmittals: number;
    activations: number;
    approvals: number;
    booked: number;
    qualityRate: number | null;
    conversionRate: number | null;
  }>;
}

const AGENTS_PER_PAGE = 12;

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function DataEntryPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState('09:00');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [agentData, setAgentData] = useState<Record<string, AgentDetail>>({});
  const [agentSearch, setAgentSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});

  // Fetch agents for this campaign
  const { data: agentsData } = useSWR(
    session?.user ? `/api/campaigns/${(session.user as any).campaignId}/agents` : null,
    fetcher
  );

  // Fetch saved production data for selected date
  const { data: savedData, mutate: mutateSaved, isLoading: loadingSaved } = useSWR(
    session?.user && date ? `/api/collectors/production?date=${date}` : null,
    fetcher,
    { refreshInterval: 0 }
  );

  // Fetch attendance for selected date
  const { data: attendanceData, mutate: mutateAttendance } = useSWR(
    session?.user && date ? `/api/collectors/attendance?date=${date}` : null,
    fetcher,
    { refreshInterval: 0 }
  );

  const agents = Array.isArray(agentsData) ? agentsData : (agentsData?.data || []);
  const savedEntries: SavedEntry[] = savedData?.entries || [];

  // Initialize agent data when agents load
  useEffect(() => {
    if (agents.length > 0) {
      const initialData: Record<string, AgentDetail> = {};
      agents.forEach((agent: any) => {
        if (!agentData[agent.id]) {
          initialData[agent.id] = {
            agentId: agent.id,
            transmittals: 0,
            activations: 0,
            approvals: 0,
            booked: 0,
            qualityRate: 0,
            conversionRate: 0,
          };
        }
      });
      if (Object.keys(initialData).length > 0) {
        setAgentData(prev => ({ ...initialData, ...prev }));
      }
    }
  }, [agents]);

  // Load attendance from API when data arrives
  useEffect(() => {
    if (attendanceData?.attendance && agents.length > 0) {
      const loadedAttendance: Record<string, boolean> = {};
      agents.forEach((agent: any) => {
        const record = attendanceData.attendance[agent.id];
        // If record exists, check status; otherwise default to true (present)
        loadedAttendance[agent.id] = record ? record.status === 'PRESENT' : true;
      });
      setAttendance(loadedAttendance);
    } else if (agents.length > 0 && !attendanceData) {
      // No attendance data yet, default all to present
      const defaultAttendance: Record<string, boolean> = {};
      agents.forEach((agent: any) => {
        defaultAttendance[agent.id] = true;
      });
      setAttendance(defaultAttendance);
    }
  }, [attendanceData, agents]);

  // Toggle agent attendance and save to DB
  const toggleAttendance = async (agentId: string) => {
    const newStatus = !attendance[agentId];
    setAttendance(prev => ({ ...prev, [agentId]: newStatus }));
    
    // Save to database
    try {
      await fetch('/api/collectors/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          attendance: {
            [agentId]: { status: newStatus ? 'PRESENT' : 'ABSENT' }
          }
        }),
      });
    } catch (error) {
      console.error('Failed to save attendance:', error);
    }
  };

  // Count present/absent
  const attendanceCount = useMemo(() => {
    const present = Object.values(attendance).filter(v => v).length;
    return { present, absent: agents.length - present };
  }, [attendance, agents.length]);

  // Calculate totals from SAVED entries (from database)
  const savedTotals = useMemo(() => {
    const totals = { transmittals: 0, activations: 0, approvals: 0, booked: 0 };
    savedEntries.forEach((entry) => {
      entry.details.forEach((detail) => {
        totals.transmittals += detail.transmittals || 0;
        totals.activations += detail.activations || 0;
        totals.approvals += detail.approvals || 0;
        totals.booked += detail.booked || 0;
      });
    });
    return totals;
  }, [savedEntries]);

  // Calculate totals from current form
  const pendingTotals = useMemo(() => {
    const totals = { transmittals: 0, activations: 0, approvals: 0, booked: 0 };
    Object.values(agentData).forEach((detail) => {
      totals.transmittals += detail.transmittals || 0;
      totals.activations += detail.activations || 0;
      totals.approvals += detail.approvals || 0;
      totals.booked += detail.booked || 0;
    });
    return totals;
  }, [agentData]);

  // Combined daily totals (saved + pending)
  const dailyTotals = useMemo(() => ({
    transmittals: savedTotals.transmittals + pendingTotals.transmittals,
    activations: savedTotals.activations + pendingTotals.activations,
    approvals: savedTotals.approvals + pendingTotals.approvals,
    booked: savedTotals.booked + pendingTotals.booked,
  }), [savedTotals, pendingTotals]);

  // Calculate per-agent saved totals from all entries
  const agentSavedTotals = useMemo(() => {
    const totals: Record<string, { transmittals: number; activations: number; approvals: number; booked: number }> = {};
    savedEntries.forEach((entry) => {
      entry.details.forEach((detail) => {
        if (!totals[detail.agentId]) {
          totals[detail.agentId] = { transmittals: 0, activations: 0, approvals: 0, booked: 0 };
        }
        totals[detail.agentId].transmittals += detail.transmittals || 0;
        totals[detail.agentId].activations += detail.activations || 0;
        totals[detail.agentId].approvals += detail.approvals || 0;
        totals[detail.agentId].booked += detail.booked || 0;
      });
    });
    return totals;
  }, [savedEntries]);

  // Filter agents based on search
  const filteredAgents = useMemo(() => {
    if (!agentSearch.trim()) return agents;
    const searchLower = agentSearch.toLowerCase();
    return agents.filter((agent: any) => 
      agent.name?.toLowerCase().includes(searchLower) ||
      agent.seatNumber?.toString().includes(searchLower)
    );
  }, [agents, agentSearch]);

  // Paginate agents
  const totalPages = Math.ceil(filteredAgents.length / AGENTS_PER_PAGE);
  const paginatedAgents = useMemo(() => {
    const start = (currentPage - 1) * AGENTS_PER_PAGE;
    return filteredAgents.slice(start, start + AGENTS_PER_PAGE);
  }, [filteredAgents, currentPage]);

  // Reset page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [agentSearch]);

  // Update agent detail
  const updateAgentDetail = (agentId: string, metric: string, value: number) => {
    setAgentData(prev => ({
      ...prev,
      [agentId]: {
        ...prev[agentId],
        [metric]: value,
      },
    }));
  };

  // Check if form has data
  const hasData = useMemo(() => {
    return Object.values(agentData).some(
      d => d.transmittals > 0 || d.activations > 0 || d.approvals > 0 || d.booked > 0
    );
  }, [agentData]);

  // Reset form
  const resetForm = () => {
    const resetData: Record<string, AgentDetail> = {};
    agents.forEach((agent: any) => {
      resetData[agent.id] = {
        agentId: agent.id,
        transmittals: 0,
        activations: 0,
        approvals: 0,
        booked: 0,
        qualityRate: 0,
        conversionRate: 0,
      };
    });
    setAgentData(resetData);
  };

  // Format time for display
  const formatTime = (timeStr: string) => {
    if (!timeStr) return 'No Time';
    try {
      const [hours, minutes] = timeStr.split(':');
      const h = parseInt(hours);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${minutes} ${ampm}`;
    } catch {
      return timeStr;
    }
  };

  // Submit entry
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!hasData) {
      setMessage({ type: 'error', text: 'Please enter at least one metric value' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const payload = {
        date,
        entries: [{
          time,
          details: agentData,
        }],
      };

      const response = await fetch('/api/collectors/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to submit entry');
      }

      setMessage({ type: 'success', text: `Entry saved for ${formatTime(time)}!` });
      resetForm();
      mutateSaved();
    } catch (error: any) {
      setMessage({ type: 'error', text: `Error: ${error.message}` });
    } finally {
      setLoading(false);
    }
  };

  // Handle auth redirect in useEffect
  const userRole = (session?.user as any)?.role;
  const isAuthorized = session?.user && userRole === 'COLLECTOR';

  useEffect(() => {
    if (session === null) {
      router.push('/login');
    } else if (session?.user && userRole !== 'COLLECTOR') {
      router.push('/dashboard');
    }
  }, [session, userRole, router]);

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="flex-1 space-y-4 p-4 md:p-6 pt-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Production Entry</h1>
          <p className="text-sm text-muted-foreground">Enter metrics for each agent</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 border rounded-lg p-1">
            <Button
              type="button"
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2"
              onClick={() => setViewMode('grid')}
            >
              <Grid3X3 className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2"
              onClick={() => setViewMode('table')}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="w-4 h-4" />
              <span>{agents.length} Agents</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-green-500">
                <UserCheck className="w-4 h-4" />
                {attendanceCount.present}
              </span>
              <span className="text-muted-foreground">/</span>
              <span className="flex items-center gap-1 text-red-500">
                <UserX className="w-4 h-4" />
                {attendanceCount.absent}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-green-900/20 text-green-400 border border-green-800'
              : 'bg-red-900/20 text-red-400 border border-red-800'
          }`}
        >
          {message.type === 'success' && <CheckCircle2 className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      {/* Daily Summary - Always visible at top */}
      <Card className="p-4 bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Daily Summary</h3>
            {loadingSaved && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex items-center gap-3 text-xs">
            {savedEntries.length > 0 && (
              <span className="flex items-center gap-1 text-green-500 bg-green-500/10 px-2 py-1 rounded">
                <CheckCircle2 className="w-3 h-3" />
                {savedEntries.length} saved
              </span>
            )}
            {hasData && (
              <span className="text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded">pending</span>
            )}
          </div>
        </div>
        
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-3 bg-background/80 rounded-lg">
            <p className="text-xs text-muted-foreground mb-1">Transmittals</p>
            <p className="text-2xl font-bold text-primary">{dailyTotals.transmittals}</p>
          </div>
          <div className="text-center p-3 bg-background/80 rounded-lg">
            <p className="text-xs text-muted-foreground mb-1">Activations</p>
            <p className="text-2xl font-bold text-primary">{dailyTotals.activations}</p>
          </div>
          <div className="text-center p-3 bg-background/80 rounded-lg">
            <p className="text-xs text-muted-foreground mb-1">Approvals</p>
            <p className="text-2xl font-bold text-primary">{dailyTotals.approvals}</p>
          </div>
          <div className="text-center p-3 bg-background/80 rounded-lg">
            <p className="text-xs text-muted-foreground mb-1">Booked</p>
            <p className="text-2xl font-bold text-primary">{dailyTotals.booked}</p>
          </div>
        </div>
      </Card>

      {/* Saved Entries Accordion */}
      {savedEntries.length > 0 && (
        <Card className="p-3">
          <details className="group">
            <summary className="flex items-center justify-between cursor-pointer list-none">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                View Saved Entries ({savedEntries.length})
              </div>
              <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90" />
            </summary>
            <div className="mt-3 space-y-2">
              {savedEntries.map((entry) => {
                const entryTotal = entry.details.reduce(
                  (acc, d) => ({
                    transmittals: acc.transmittals + (d.transmittals || 0),
                    activations: acc.activations + (d.activations || 0),
                    approvals: acc.approvals + (d.approvals || 0),
                    booked: acc.booked + (d.booked || 0),
                  }),
                  { transmittals: 0, activations: 0, approvals: 0, booked: 0 }
                );
                return (
                  <div key={entry.id} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{formatTime(entry.time)}</span>
                      <span className="text-xs text-muted-foreground">({entry.details.length} agents)</span>
                    </div>
                    <div className="flex gap-3 text-xs">
                      <span>T:{entryTotal.transmittals}</span>
                      <span>A:{entryTotal.activations}</span>
                      <span>Ap:{entryTotal.approvals}</span>
                      <span className="font-semibold text-primary">B:{entryTotal.booked}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        </Card>
      )}

      {/* Entry Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Date & Time Row */}
        <Card className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="date" className="text-sm font-medium">Date</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-40"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="time" className="text-sm font-medium">Booking Time</Label>
              <Input
                id="time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-32"
                required
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search agents..."
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Pending Entry Stats */}
        {hasData && (
          <div className="flex items-center justify-between p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm">
            <span className="text-yellow-500 font-medium">Pending Entry: {formatTime(time)}</span>
            <div className="flex gap-4 text-xs">
              <span>T:{pendingTotals.transmittals}</span>
              <span>A:{pendingTotals.activations}</span>
              <span>Ap:{pendingTotals.approvals}</span>
              <span className="font-bold">B:{pendingTotals.booked}</span>
            </div>
          </div>
        )}

        {/* Agent Grid */}
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {paginatedAgents.map((agent: any) => {
              const saved = agentSavedTotals[agent.id] || { transmittals: 0, activations: 0, approvals: 0, booked: 0 };
              const pending = agentData[agent.id] || { transmittals: 0, activations: 0, approvals: 0, booked: 0, qualityRate: 0, conversionRate: 0 };
              const total = {
                transmittals: saved.transmittals + (pending.transmittals || 0),
                activations: saved.activations + (pending.activations || 0),
                approvals: saved.approvals + (pending.approvals || 0),
                booked: saved.booked + (pending.booked || 0),
              };
              const convRate = total.transmittals > 0 ? ((total.booked / total.transmittals) * 100).toFixed(1) : '0.0';
              const isPresent = attendance[agent.id] !== false;
              
              return (
              <Card key={agent.id} className={`p-4 transition-colors flex flex-col ${isPresent ? 'hover:border-primary/50' : 'opacity-50 bg-muted/30'}`}>
                {/* Agent Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant={isPresent ? 'default' : 'outline'}
                      size="icon"
                      className={`h-8 w-8 shrink-0 ${isPresent ? 'bg-green-500 hover:bg-green-600' : 'border-red-300 text-red-500 hover:bg-red-50'}`}
                      onClick={() => toggleAttendance(agent.id)}
                      title={isPresent ? 'Mark as Absent' : 'Mark as Present'}
                    >
                      {isPresent ? <UserCheck className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                    </Button>
                    <div>
                      <p className="font-semibold text-base">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {agent.seatNumber && `Seat ${agent.seatNumber} • `}
                        <span className={isPresent ? 'text-green-500' : 'text-red-500'}>
                          {isPresent ? 'Present' : 'Absent'}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="text-right bg-primary/10 px-2 py-1 rounded">
                    <p className="text-[10px] text-muted-foreground uppercase">Total Booked</p>
                    <p className="text-xl font-bold text-primary">{total.booked}</p>
                  </div>
                </div>

                {/* Total Stats Summary - Always Visible */}
                <div className="grid grid-cols-5 gap-2 mb-3 p-2 bg-muted/50 rounded-lg text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground">TRANS</p>
                    <p className="text-sm font-bold">{total.transmittals}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">ACT</p>
                    <p className="text-sm font-bold">{total.activations}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">APPR</p>
                    <p className="text-sm font-bold">{total.approvals}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">BOOK</p>
                    <p className="text-sm font-bold text-primary">{total.booked}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">C%</p>
                    <p className="text-sm font-bold text-blue-500">{convRate}%</p>
                  </div>
                </div>

                {/* New Entry Section */}
                <div className="flex-1">
                  {isPresent ? (
                    <>
                      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                        <Plus className="w-3 h-3" /> New Entry
                      </p>
                      <div className="grid grid-cols-4 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Trans</Label>
                          <Input
                            type="number"
                            min="0"
                            value={agentData[agent.id]?.transmittals || 0}
                            onChange={(e) => updateAgentDetail(agent.id, 'transmittals', parseInt(e.target.value) || 0)}
                            className="h-9 text-center text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Act</Label>
                          <Input
                            type="number"
                            min="0"
                            value={agentData[agent.id]?.activations || 0}
                            onChange={(e) => updateAgentDetail(agent.id, 'activations', parseInt(e.target.value) || 0)}
                            className="h-9 text-center text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Appr</Label>
                          <Input
                            type="number"
                            min="0"
                            value={agentData[agent.id]?.approvals || 0}
                            onChange={(e) => updateAgentDetail(agent.id, 'approvals', parseInt(e.target.value) || 0)}
                            className="h-9 text-center text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Booked</Label>
                          <Input
                            type="number"
                            min="0"
                            value={agentData[agent.id]?.booked || 0}
                            onChange={(e) => updateAgentDetail(agent.id, 'booked', parseInt(e.target.value) || 0)}
                            className="h-9 text-center text-sm font-semibold"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Quality %</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.1"
                            value={agentData[agent.id]?.qualityRate || 0}
                            onChange={(e) => updateAgentDetail(agent.id, 'qualityRate', parseFloat(e.target.value) || 0)}
                            className="h-8 text-center text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Conv %</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.1"
                            value={agentData[agent.id]?.conversionRate || 0}
                            onChange={(e) => updateAgentDetail(agent.id, 'conversionRate', parseFloat(e.target.value) || 0)}
                            className="h-8 text-center text-xs"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-center h-full py-6">
                      <p className="text-sm text-muted-foreground text-center">
                        <UserX className="w-8 h-8 mx-auto mb-2 text-red-400" />
                        Agent is marked absent
                      </p>
                    </div>
                  )}
                </div>
              </Card>
              );
            })}
          </div>
        ) : (
          /* Table View */
          <Card className="overflow-hidden">
            <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted z-10">
                  <tr className="border-b">
                    <th className="text-center py-3 px-2 font-medium w-12">Status</th>
                    <th className="text-left py-3 px-3 font-medium">Agent</th>
                    <th className="text-center py-3 px-1 font-medium w-16 text-[10px] text-green-500">Saved</th>
                    <th className="text-center py-3 px-2 font-medium w-20">Trans</th>
                    <th className="text-center py-3 px-2 font-medium w-20">Act</th>
                    <th className="text-center py-3 px-2 font-medium w-20">Appr</th>
                    <th className="text-center py-3 px-2 font-medium w-20">Book</th>
                    <th className="text-center py-3 px-2 font-medium w-16">Q%</th>
                    <th className="text-center py-3 px-2 font-medium w-16">C%</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedAgents.map((agent: any, idx: number) => {
                    const saved = agentSavedTotals[agent.id] || { transmittals: 0, activations: 0, approvals: 0, booked: 0 };
                    const hasSaved = saved.booked > 0 || saved.transmittals > 0 || saved.activations > 0 || saved.approvals > 0;
                    const isPresent = attendance[agent.id] !== false;
                    return (
                    <tr key={agent.id} className={`border-b hover:bg-muted/30 ${idx % 2 === 0 ? '' : 'bg-muted/10'} ${!isPresent ? 'opacity-50' : ''}`}>
                      <td className="py-1 px-2 text-center">
                        <Button
                          type="button"
                          variant={isPresent ? 'default' : 'outline'}
                          size="icon"
                          className={`h-7 w-7 ${isPresent ? 'bg-green-500 hover:bg-green-600' : 'border-red-300 text-red-500 hover:bg-red-50'}`}
                          onClick={() => toggleAttendance(agent.id)}
                          title={isPresent ? 'Mark as Absent' : 'Mark as Present'}
                        >
                          {isPresent ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
                        </Button>
                      </td>
                      <td className="py-2 px-3">
                        <div className="font-medium">{agent.name}</div>
                        {agent.seatNumber && (
                          <div className="text-xs text-muted-foreground">Seat {agent.seatNumber}</div>
                        )}
                      </td>
                      <td className="py-1 px-1 text-center">
                        {hasSaved ? (
                          <div className="text-[10px] text-green-500 leading-tight">
                            <div>{saved.transmittals}/{saved.activations}/{saved.approvals}/{saved.booked}</div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </td>
                      <td className="py-1 px-1">
                        <Input
                          type="number"
                          min="0"
                          disabled={!isPresent}
                          value={agentData[agent.id]?.transmittals || 0}
                          onChange={(e) => updateAgentDetail(agent.id, 'transmittals', parseInt(e.target.value) || 0)}
                          className="w-full h-8 text-center"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <Input
                          type="number"
                          min="0"
                          disabled={!isPresent}
                          value={agentData[agent.id]?.activations || 0}
                          onChange={(e) => updateAgentDetail(agent.id, 'activations', parseInt(e.target.value) || 0)}
                          className="w-full h-8 text-center"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <Input
                          type="number"
                          min="0"
                          disabled={!isPresent}
                          value={agentData[agent.id]?.approvals || 0}
                          onChange={(e) => updateAgentDetail(agent.id, 'approvals', parseInt(e.target.value) || 0)}
                          className="w-full h-8 text-center"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <Input
                          type="number"
                          min="0"
                          disabled={!isPresent}
                          value={agentData[agent.id]?.booked || 0}
                          onChange={(e) => updateAgentDetail(agent.id, 'booked', parseInt(e.target.value) || 0)}
                          className="w-full h-8 text-center font-semibold"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <Input
                          type="number"
                          min="0"
                          step="0.1"
                          disabled={!isPresent}
                          value={agentData[agent.id]?.qualityRate || 0}
                          onChange={(e) => updateAgentDetail(agent.id, 'qualityRate', parseFloat(e.target.value) || 0)}
                          className="w-full h-8 text-center text-xs"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <Input
                          type="number"
                          min="0"
                          step="0.1"
                          disabled={!isPresent}
                          value={agentData[agent.id]?.conversionRate || 0}
                          onChange={(e) => updateAgentDetail(agent.id, 'conversionRate', parseFloat(e.target.value) || 0)}
                          className="w-full h-8 text-center text-xs"
                        />
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let page;
                if (totalPages <= 5) {
                  page = i + 1;
                } else if (currentPage <= 3) {
                  page = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  page = totalPages - 4 + i;
                } else {
                  page = currentPage - 2 + i;
                }
                return (
                  <Button
                    key={page}
                    type="button"
                    variant={currentPage === page ? 'default' : 'outline'}
                    size="sm"
                    className="w-8 h-8 p-0"
                    onClick={() => setCurrentPage(page)}
                  >
                    {page}
                  </Button>
                );
              })}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <Button 
            type="button"
            variant="outline"
            onClick={resetForm}
            disabled={!hasData || loading}
            className="flex-1"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear Form
          </Button>
          <Button 
            type="submit" 
            disabled={loading || !hasData} 
            className="flex-1"
            size="lg"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Save Entry ({formatTime(time)})
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
