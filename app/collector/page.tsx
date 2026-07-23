'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  monthlyTargetSupplementary?: number;
  mbLevel?: string | null;
  disbursedTxnTarget?: number | null;
  disbursedVolTarget?: number | null;
  grossTurnInsTxnTarget?: number | null;
  grossTurnInsVolTarget?: number | null;
  importedGoals?: Record<string, number>;
  goalSource?: 'bulk_import' | 'configured';
  importedOnly?: boolean;
}

interface Production {
  transmittals: number;
  activations: number;
  approvals: number;
  booked: number;
  volume?: number;
  ntb?: number;
  supplementary?: number;
  bauPayrollTxn?: number;
  bauPayrollVol?: number;
  bauDepositorTxn?: number;
  bauDepositorVol?: number;
  topupPayrollTxn?: number;
  topupPayrollVol?: number;
  topupDepositorTxn?: number;
  topupDepositorVol?: number;
  openMarketTxn?: number;
  openMarketVol?: number;
  c2gTxn?: number;
  c2gVol?: number;
  btTxn?: number;
  btVol?: number;
  balconTxn?: number;
  balconVol?: number;
  grandTotalTxn?: number;
  grandTotalVol?: number;
  importedGoal?: number;
  importedActual?: number;
  importedAchievement?: number;
}

interface MbPlPerformance {
  goal: number;
  actual: number;
  transactionGoal: number;
  transactionActual: number;
  volumeGoal: number;
  volumeActual: number;
  transactionAchievement: number;
  volumeAchievement: number;
  transactionScore: number;
  volumeScore: number;
  achievement: number;
}

interface CampaignBlock {
  id: string;
  campaignName: string;
  kpiMetric: string;
  goal: number | null;
  actual?: number | null;
  achievement?: number | null;
  campaignProduction?: number;
  achievementPercent?: number | null;
  goalStatus?: 'available' | 'missing';
  dataStatus?: 'complete' | 'zero-production' | 'no-production-records' | 'missing-goal' | 'no-imported-data';
  agentCount?: number;
  recordCount?: number;
  supplementaryGoal?: number;
  agents: Agent[];
  production: Record<string, Production>;
  bdoPerformance?: Record<string, { goal: number; actual: number; achievement: number }>;
  importedPerformance?: Record<string, { goal: number; actual: number; achievement: number }>;
  mbPlPerformance?: Record<string, MbPlPerformance>;
  mbPlTotals?: {
    transactionGoal: number;
    transactionActual: number;
    volumeGoal: number;
    volumeActual: number;
    achievement: number;
  };
  attendance: Record<string, { status: string; remarks: string | null }>;
  entriesCount: number;
  dataPeriod?: { source: 'selected_range' | 'latest_import'; year?: number; month?: number };
  agentDataPeriod?: { source: 'selected_range' | 'latest_import'; year?: number; month?: number };
}

function campaignDataPeriodLabel(period?: CampaignBlock['dataPeriod']): string | null {
  if (period?.source !== 'latest_import' || !period.month || !period.year) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(period.year, period.month - 1, 1)));
}

const CAMPAIGN_GROUP_PREFIX = '__campaign_group__:';
const ALL_CAMPAIGNS = '__all_campaigns__';
const EXPORT_HEADERS = ['Campaign', 'Rank', 'Seat', 'Agent Name', 'Status', 'Transmittals', 'Approvals', 'Booked', 'Booked Volume (₱)', 'Target', 'Progress %'] as const;
const BDO_EXPORT_HEADERS = ['Campaign', 'Rank', 'Seat', 'Agent Name', 'Status', 'Goal', 'Actual', 'Achievement %', 'Booked', 'Progress %'] as const;

function campaignOrganization(campaignName: string) {
  return campaignName.trim().split(/\s+/)[0]?.replace(/[^a-z0-9]/gi, '').toUpperCase() || 'OTHER';
}

function campaignGroupValue(organization: string) {
  return `${CAMPAIGN_GROUP_PREFIX}${organization}`;
}

function selectedOrganization(value: string | null) {
  return value?.startsWith(CAMPAIGN_GROUP_PREFIX) ? value.slice(CAMPAIGN_GROUP_PREFIX.length) : null;
}

function safeWorksheetName(name: string, used: Set<string>) {
  const base = name.replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Campaign';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const marker = ` (${suffix++})`;
    candidate = `${base.slice(0, 31 - marker.length)}${marker}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

const ZERO_PROD: Production = {
  transmittals: 0, activations: 0, approvals: 0, booked: 0, volume: 0, ntb: 0, supplementary: 0,
  bauPayrollTxn: 0, bauPayrollVol: 0, bauDepositorTxn: 0, bauDepositorVol: 0,
  topupPayrollTxn: 0, topupPayrollVol: 0, topupDepositorTxn: 0, topupDepositorVol: 0,
  openMarketTxn: 0, openMarketVol: 0,
  c2gTxn: 0, c2gVol: 0, btTxn: 0, btVol: 0, balconTxn: 0, balconVol: 0, grandTotalTxn: 0, grandTotalVol: 0,
};

// ACQ campaigns (name contains "ACQ") report NTB + Supplementary instead of booked volume.
const isAcqCampaign = (name?: string | null) => /\bacq\b/i.test(name || '');

// BDO campaigns use the Goal / Actual / Achievement triplet imported from the
// BDO workbook, with Goal tied back to CEO Goals Management.
const isBdoCampaign = (name?: string | null) => /^bdo\b/i.test((name || '').trim());

// MB PL reports a BAU / Top Up transaction + volume breakdown.
const isMbPlCampaign = (name?: string | null) => /\bmb pl\b/i.test(name || '');

// MB PA reports TOTAL (C2G / BT / BalCon PA) + GRAND TOTAL transaction + volume.
const isMbPaCampaign = (name?: string | null) => /\bmb\s*pa\b/i.test(name || '');

// MB PL "Goal per Agent" — standard Disbursed + Monthly Gross Turn Ins targets by level.
const MB_PL_LEVELS = ['PAYROLL SU2', 'PAYROLL HYBRID-ROOKIE', 'DEPO HYBRID', 'PAYROLL HYBRID'];
const MB_PL_LEVEL_GOALS: Record<string, { disbursedTxn: number; disbursedVol: number; gtiTxn: number; gtiVol: number }> = {
  'PAYROLL SU2': { disbursedTxn: 10, disbursedVol: 750000, gtiTxn: 55, gtiVol: 4091103 },
  'PAYROLL HYBRID-ROOKIE': { disbursedTxn: 24, disbursedVol: 1800000, gtiTxn: 82, gtiVol: 6136655.55 },
  'DEPO HYBRID': { disbursedTxn: 18, disbursedVol: 2100000, gtiTxn: 60, gtiVol: 7056669 },
  'PAYROLL HYBRID': { disbursedTxn: 30, disbursedVol: 2250000, gtiTxn: 81, gtiVol: 6136656 },
};

function kpiValueFor(metric: string, prod: Production): number {
  switch (metric) {
    case 'actual': return prod.importedActual || 0;
    case 'transmittals': return prod.transmittals;
    case 'activations': return prod.activations;
    case 'approvals': return prod.approvals;
    case 'volume': return prod.volume || 0;
    default: return prod.booked;
  }
}

function kpiLabel(metric: string): string {
  switch (metric) {
    case 'actual': return 'Transactions';
    case 'transmittals': return 'Transmittals';
    case 'activations': return 'Activations';
    case 'approvals': return 'Approvals';
    case 'volume': return 'Volume';
    case 'achievements': return 'Achievements';
    default: return 'Booked';
  }
}

function formatKpiValue(metric: string, value: number): string {
  const formatted = Number(value).toLocaleString();
  return metric === 'volume' ? `₱${formatted}` : formatted;
}

function mbPaTransactionTotal(prod: Production) {
  const categoryTotal = Number(prod.c2gTxn || 0) + Number(prod.btTxn || 0) + Number(prod.balconTxn || 0);
  return categoryTotal || Number(prod.grandTotalTxn || 0);
}

function mbPaVolumeTotal(prod: Production) {
  const categoryTotal = Number(prod.c2gVol || 0) + Number(prod.btVol || 0) + Number(prod.balconVol || 0);
  return categoryTotal || Number(prod.grandTotalVol || 0);
}

/**
 * Keeps every performance report and export in the same highest-to-lowest
 * order. Each campaign uses the KPI represented by its own report.
 */
function compareCampaignAgents(campaign: CampaignBlock, a: Agent, b: Agent) {
  const aProd = campaign.production[a.id] || ZERO_PROD;
  const bProd = campaign.production[b.id] || ZERO_PROD;
  let primaryDifference = 0;
  let secondaryDifference = 0;

  if (isAcqCampaign(campaign.campaignName)) {
    primaryDifference = Number(bProd.ntb || 0) - Number(aProd.ntb || 0);
    secondaryDifference = Number(bProd.supplementary || 0) - Number(aProd.supplementary || 0);
  } else if (isMbPaCampaign(campaign.campaignName)) {
    primaryDifference = mbPaTransactionTotal(bProd) - mbPaTransactionTotal(aProd);
    secondaryDifference = mbPaVolumeTotal(bProd) - mbPaVolumeTotal(aProd);
  } else if (isMbPlCampaign(campaign.campaignName) && campaign.mbPlPerformance) {
    const aPerformance = campaign.mbPlPerformance[a.id];
    const bPerformance = campaign.mbPlPerformance[b.id];
    primaryDifference = Number(bPerformance?.achievement || 0) - Number(aPerformance?.achievement || 0);
    secondaryDifference = Number(bPerformance?.transactionActual || 0) - Number(aPerformance?.transactionActual || 0);
  } else if (campaign.importedPerformance) {
    primaryDifference = Number(campaign.importedPerformance[b.id]?.actual || 0) - Number(campaign.importedPerformance[a.id]?.actual || 0);
    secondaryDifference = Number(campaign.importedPerformance[b.id]?.achievement || 0) - Number(campaign.importedPerformance[a.id]?.achievement || 0);
  } else {
    primaryDifference = kpiValueFor(campaign.kpiMetric, bProd) - kpiValueFor(campaign.kpiMetric, aProd);
  }

  return primaryDifference || secondaryDifference || a.name.localeCompare(b.name);
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

interface TargetPayload {
  target: number;
  targetSupplementary: number;
  mbLevel?: string;
  disbursedTxnTarget?: number;
  disbursedVolTarget?: number;
  grossTurnInsTxnTarget?: number;
  grossTurnInsVolTarget?: number;
}

interface TargetModalProps {
  agentName: string;
  currentTarget?: number;
  currentTargetSupplementary?: number;
  isAcq?: boolean;
  isMbPl?: boolean;
  currentMbLevel?: string | null;
  currentDisbursedTxn?: number | null;
  currentDisbursedVol?: number | null;
  currentGtiTxn?: number | null;
  currentGtiVol?: number | null;
  onClose: () => void;
  onSave: (payload: TargetPayload, setForAll?: boolean) => void;
  loading: boolean;
  agentCount?: number;
}

function TargetModal({
  agentName, currentTarget, currentTargetSupplementary, isAcq, isMbPl,
  currentMbLevel, currentDisbursedTxn, currentDisbursedVol, currentGtiTxn, currentGtiVol,
  onClose, onSave, loading, agentCount,
}: TargetModalProps) {
  const [target, setTarget] = useState(currentTarget?.toString() || '');
  const [targetSupp, setTargetSupp] = useState(currentTargetSupplementary?.toString() || '');
  const [setForAll, setSetForAll] = useState(false);
  // MB PL state
  const [mbLevel, setMbLevel] = useState(currentMbLevel || '');
  const [disbursedTxn, setDisbursedTxn] = useState(currentDisbursedTxn != null ? String(currentDisbursedTxn) : '');
  const [disbursedVol, setDisbursedVol] = useState(currentDisbursedVol != null ? String(currentDisbursedVol) : '');
  const [gtiTxn, setGtiTxn] = useState(currentGtiTxn != null ? String(currentGtiTxn) : '');
  const [gtiVol, setGtiVol] = useState(currentGtiVol != null ? String(currentGtiVol) : '');

  // Auto-fill the four goals from the selected level (still overridable).
  const applyLevel = (level: string) => {
    setMbLevel(level);
    const g = MB_PL_LEVEL_GOALS[level];
    if (g) {
      setDisbursedTxn(String(g.disbursedTxn));
      setDisbursedVol(String(g.disbursedVol));
      setGtiTxn(String(g.gtiTxn));
      setGtiVol(String(g.gtiVol));
    }
  };

  const handleSave = () => {
    if (isMbPl) {
      onSave({
        target: 0, targetSupplementary: 0,
        mbLevel,
        disbursedTxnTarget: parseFloat(disbursedTxn) || 0,
        disbursedVolTarget: parseFloat(disbursedVol) || 0,
        grossTurnInsTxnTarget: parseFloat(gtiTxn) || 0,
        grossTurnInsVolTarget: parseFloat(gtiVol) || 0,
      }, setForAll);
    } else {
      onSave({ target: parseFloat(target) || 0, targetSupplementary: parseFloat(targetSupp) || 0 }, setForAll);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {setForAll ? 'Set Target for All Agents' : `Set Target for ${agentName}`}
          </CardTitle>
          <CardDescription>
            {setForAll
              ? `Apply to all ${agentCount} agents in this campaign`
              : isMbPl ? 'Monthly goal per agent — Disbursed & Gross Turn Ins'
              : isAcq ? 'Monthly NTB & Supplementary targets for this agent' : 'Monthly target/goal for this agent'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isMbPl ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="mb-level">Level</Label>
                <select
                  id="mb-level"
                  value={mbLevel}
                  onChange={(e) => applyLevel(e.target.value)}
                  disabled={loading}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select level…</option>
                  {MB_PL_LEVELS.map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">Selecting a level auto-fills the goals below (you can override).</p>
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-700">Disbursed</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="disb-txn" className="text-xs">Transactions</Label>
                    <Input id="disb-txn" type="number" placeholder="0" value={disbursedTxn} onChange={(e) => setDisbursedTxn(e.target.value)} disabled={loading} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="disb-vol" className="text-xs">Volume</Label>
                    <Input id="disb-vol" type="number" placeholder="0" value={disbursedVol} onChange={(e) => setDisbursedVol(e.target.value)} disabled={loading} />
                  </div>
                </div>
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-700">Monthly Gross Turn Ins</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="gti-txn" className="text-xs">Transactions</Label>
                    <Input id="gti-txn" type="number" placeholder="0" value={gtiTxn} onChange={(e) => setGtiTxn(e.target.value)} disabled={loading} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="gti-vol" className="text-xs">Volume</Label>
                    <Input id="gti-vol" type="number" placeholder="0" value={gtiVol} onChange={(e) => setGtiVol(e.target.value)} disabled={loading} />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="target">{isAcq ? 'Target NTB' : 'Monthly Target'}</Label>
                <Input
                  id="target"
                  type="number"
                  placeholder="0"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  disabled={loading}
                />
              </div>
              {isAcq && (
                <div className="space-y-2">
                  <Label htmlFor="target-supp">Target Supplementary</Label>
                  <Input
                    id="target-supp"
                    type="number"
                    placeholder="0"
                    value={targetSupp}
                    onChange={(e) => setTargetSupp(e.target.value)}
                    disabled={loading}
                  />
                </div>
              )}
            </>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={loading || (isMbPl ? !mbLevel && !disbursedTxn && !gtiTxn : !target)}
              className="flex-1"
            >
              {loading ? 'Saving...' : setForAll ? 'Set for All' : 'Save Target'}
            </Button>
          </div>
          {agentCount && agentCount > 1 && !setForAll && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSetForAll(true)}
              className="w-full text-xs"
              disabled={loading}
            >
              Apply to all {agentCount} agents instead
            </Button>
          )}
          {setForAll && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSetForAll(false)}
              className="w-full text-xs"
              disabled={loading}
            >
              Back to {agentName} only
            </Button>
          )}
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
  const [targetModal, setTargetModal] = useState<{
    agentId: string; agentName: string; currentTarget?: number; currentTargetSupplementary?: number;
    isAcq?: boolean; isMbPl?: boolean;
    currentMbLevel?: string | null; currentDisbursedTxn?: number | null; currentDisbursedVol?: number | null;
    currentGtiTxn?: number | null; currentGtiVol?: number | null;
    campaignId: string; agentCount: number;
  } | null>(null);
  const [savingTarget, setSavingTarget] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [agentSearch, setAgentSearch] = useState('');
  const [sortBy, setSortBy] = useState<'seat' | 'booked' | 'name'>('booked');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(ALL_CAMPAIGNS);
  const [deletingCampaignData, setDeletingCampaignData] = useState(false);
  const [deletingAllAgents, setDeletingAllAgents] = useState(false);

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

  const campaignGroups = useMemo(() => {
    const groups = new Map<string, CampaignBlock[]>();
    for (const campaign of allCampaigns) {
      const organization = campaignOrganization(campaign.campaignName);
      groups.set(organization, [...(groups.get(organization) || []), campaign]);
    }
    const priority = (organization: string) => organization === 'BDO' ? 0 : organization === 'BPI' ? 1 : 2;
    return [...groups.entries()]
      .map(([organization, groupedCampaigns]) => ({ organization, campaigns: groupedCampaigns }))
      .sort((a, b) => priority(a.organization) - priority(b.organization) || a.organization.localeCompare(b.organization));
  }, [allCampaigns]);

  // Filter campaigns based on selected campaign
  const campaigns: CampaignBlock[] = useMemo(
    () => {
      const organization = selectedOrganization(selectedCampaignId);
      if (organization) return allCampaigns.filter((campaign) => campaignOrganization(campaign.campaignName) === organization);
      return selectedCampaignId === ALL_CAMPAIGNS
        ? allCampaigns
        : allCampaigns.filter((campaign) => campaign.id === selectedCampaignId);
    },
    [allCampaigns, selectedCampaignId]
  );

  // Default the Add-Agent campaign selector to the first assigned campaign.
  useEffect(() => {
    if (allCampaigns.length > 0 && !allCampaigns.some((c) => c.id === addAgentCampaignId)) {
      setAddAgentCampaignId(allCampaigns[0].id);
    }
  }, [allCampaigns, addAgentCampaignId]);

  // Keep "All Campaigns" as the stable default. If an assignment is removed
  // while the page is open, reset the stale selection without hiding others.
  useEffect(() => {
    const organization = selectedOrganization(selectedCampaignId);
    const validGroup = organization && campaignGroups.some((group) => group.organization === organization);
    const validCampaign = allCampaigns.some((campaign) => campaign.id === selectedCampaignId);
    if (selectedCampaignId !== ALL_CAMPAIGNS && !validGroup && !validCampaign) {
      setSelectedCampaignId(ALL_CAMPAIGNS);
    }
  }, [allCampaigns, campaignGroups, selectedCampaignId]);

  // Global KPI roll-up across every assigned campaign.
  const kpis = useMemo(() => {
    let totalAgents = 0, presentCount = 0, absentCount = 0;
    let totalTransmittals = 0, totalActivations = 0, totalApprovals = 0, totalBooked = 0, totalVolume = 0;
    let totalNtb = 0, totalSupplementary = 0;
    let totalGoal = 0, totalSuppGoal = 0, kpiValue = 0, totalTarget = 0, entriesCount = 0;

    for (const c of campaigns) {
      totalAgents += c.agents.length;
      totalGoal += c.goal ?? 0;
      totalSuppGoal += c.supplementaryGoal || 0;
      entriesCount += c.entriesCount || 0;
      let campaignKpi = 0;
      for (const a of c.agents) {
        const p = c.production[a.id] || ZERO_PROD;
        totalTransmittals += p.transmittals;
        totalActivations += p.activations;
        totalApprovals += p.approvals;
        totalBooked += p.booked;
        totalVolume += p.volume || 0;
        totalNtb += p.ntb || 0;
        totalSupplementary += p.supplementary || 0;
        totalTarget += a.monthlyTarget || 0;
        campaignKpi += kpiValueFor(c.kpiMetric, p);
        const record = c.attendance[a.id];
        if (record?.status === 'ABSENT') absentCount++;
        else presentCount++;
      }
      kpiValue += c.actual ?? campaignKpi;
    }

    // When every assigned campaign is ACQ, the global roll-up switches to NTB.
    const allAcq = campaigns.length > 0 && campaigns.every((c) => isAcqCampaign(c.campaignName));
    const campaignKpis = new Set(campaigns.map((campaign) => campaign.kpiMetric || 'booked'));
    const mixedKpis = !allAcq && campaignKpis.size > 1;
    const primaryKpi = allAcq ? 'ntb' : (campaigns[0]?.kpiMetric || 'booked');

    let goal = totalGoal;
    if (goal === 0 && totalTarget > 0) goal = totalTarget;
    const actual = allAcq ? totalNtb : kpiValue;
    const targetProgress = goal > 0 ? ((actual / goal) * 100).toFixed(1) : '0';
    const remainingGoal = Math.max(0, goal - actual);

    // Supplementary goal roll-up (ACQ only)
    const suppProgress = totalSuppGoal > 0 ? ((totalSupplementary / totalSuppGoal) * 100).toFixed(1) : '0';
    const remainingSupp = Math.max(0, totalSuppGoal - totalSupplementary);

    return {
      totalAgents, presentCount, absentCount,
      totalTransmittals, totalActivations, totalApprovals, totalBooked, totalVolume,
      totalNtb, totalSupplementary, allAcq,
      totalSuppGoal, suppProgress, remainingSupp,
      goal, kpiValue, targetProgress, remainingGoal, totalTarget, entriesCount,
      mixedKpis, primaryKpi,
    };
  }, [campaigns]);

  const campaignAchievementSummary = useMemo(() => {
    const rows = campaigns.map((campaign) => {
      const production = campaign.campaignProduction
        ?? campaign.actual
        ?? campaign.agents.reduce(
          (sum, agent) => sum + kpiValueFor(campaign.kpiMetric, campaign.production[agent.id] || ZERO_PROD),
          0
        );
      const achievement = campaign.achievementPercent
        ?? campaign.achievement
        ?? (campaign.goal != null && campaign.goal > 0 ? (production / campaign.goal) * 100 : null);
      return { campaign, production, achievement };
    });
    const valid = rows
      .filter((row) => row.achievement != null)
      .sort((a, b) => Number(a.achievement) - Number(b.achievement));
    const totalProduction = rows.reduce((sum, row) => sum + row.production, 0);
    const totalGoal = rows.reduce((sum, row) => sum + Number(row.campaign.goal ?? 0), 0);
    return {
      highest: valid.at(-1) ?? null,
      lowest: valid[0] ?? null,
      average: valid.length
        ? valid.reduce((sum, row) => sum + Number(row.achievement), 0) / valid.length
        : null,
      overall: totalGoal > 0 ? (totalProduction / totalGoal) * 100 : null,
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

  const handleSaveTarget = async (payload: TargetPayload, setForAll?: boolean) => {
    if (!targetModal) return;
    setSavingTarget(true);
    try {
      // Send the field set matching the campaign type.
      const body = targetModal.isMbPl
        ? {
            mbLevel: payload.mbLevel,
            disbursedTxnTarget: payload.disbursedTxnTarget,
            disbursedVolTarget: payload.disbursedVolTarget,
            grossTurnInsTxnTarget: payload.grossTurnInsTxnTarget,
            grossTurnInsVolTarget: payload.grossTurnInsVolTarget,
          }
        : targetModal.isAcq
        ? { target: payload.target, targetSupplementary: payload.targetSupplementary }
        : { target: payload.target };
      if (setForAll) {
        const res = await fetch(`/api/collectors/campaigns/${targetModal.campaignId}/agents/targets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Failed to save targets');
        setMessage(`✅ Target updated for all ${targetModal.agentCount} agents!`);
      } else {
        const res = await fetch(`/api/collectors/agents/${targetModal.agentId}/targets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Failed to save target');
        setMessage(`✅ Target updated for ${targetModal.agentName}!`);
      }
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

  const handleDeleteCampaignData = async () => {
    const selectedCampaign = allCampaigns.find(c => c.id === selectedCampaignId);
    if (!selectedCampaign) return;

    const confirmMessage = `Are you sure you want to delete all production data for "${selectedCampaign.campaignName}"? This action cannot be undone.`;
    if (!confirm(confirmMessage)) return;

    setDeletingCampaignData(true);
    try {
      const res = await fetch(`/api/collectors/campaigns/${selectedCampaignId}/data`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete campaign data');
      setMessage(`✅ All data deleted for ${selectedCampaign.campaignName}`);
      mutateDashboard();
    } catch (error) {
      setMessage(`Error: ${(error as Error).message}`);
    } finally {
      setDeletingCampaignData(false);
    }
  };

  const handleDeleteAllAgents = async (campaignId = selectedCampaignId) => {
    const selectedCampaign = allCampaigns.find(c => c.id === campaignId);
    if (!selectedCampaign) return;

    const agentCount = selectedCampaign.agents.filter((agent) => !agent.importedOnly).length;
    if (agentCount === 0) {
      setMessage('Imported dashboard agents are managed through Bulk Import history.');
      return;
    }
    const confirmMessage = `Are you sure you want to delete all ${agentCount} agents in "${selectedCampaign.campaignName}"? This action cannot be undone.`;
    if (!confirm(confirmMessage)) return;

    setDeletingAllAgents(true);
    try {
      const res = await fetch(`/api/collectors/campaigns/${campaignId}/agents`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete agents');
      setMessage(`✅ All agents deleted from ${selectedCampaign.campaignName}`);
      mutateDashboard();
    } catch (error) {
      setMessage(`Error: ${(error as Error).message}`);
    } finally {
      setDeletingAllAgents(false);
    }
  };

  const campaignExportRows = (campaign: CampaignBlock): Record<string, string | number>[] => {
    const sorted = [...campaign.agents].sort((a, b) => compareCampaignAgents(campaign, a, b));
    return sorted.map((agent, index): Record<string, string | number> => {
      const prod = campaign.production[agent.id] || ZERO_PROD;
      const record = campaign.attendance[agent.id];
      const target = agent.monthlyTarget || 0;
      if (campaign.importedPerformance?.[agent.id] || isBdoCampaign(campaign.campaignName)) {
        const performance = campaign.importedPerformance?.[agent.id]
          || campaign.bdoPerformance?.[agent.id]
          || { goal: 0, actual: 0, achievement: 0 };
        return {
          Campaign: campaign.campaignName,
          Rank: index + 1,
          Seat: agent.seatNumber ?? '',
          'Agent Name': agent.name,
          Status: agent.importedOnly ? 'Imported' : record?.status || 'PRESENT',
          Goal: performance.goal,
          Actual: performance.actual,
          'Achievement %': performance.achievement.toFixed(1),
          Booked: prod.booked,
          'Progress %': performance.achievement.toFixed(1),
        };
      }
      if (isMbPlCampaign(campaign.campaignName) && campaign.mbPlPerformance?.[agent.id]) {
        const performance = campaign.mbPlPerformance[agent.id];
        return {
          Campaign: campaign.campaignName,
          Rank: index + 1,
          Seat: agent.seatNumber ?? '',
          'Agent Name': agent.name,
          'Transaction Goal': performance.transactionGoal,
          'Transaction Actual': performance.transactionActual,
          'Volume Goal (₱)': performance.volumeGoal,
          'Volume Actual (₱)': performance.volumeActual,
          'Transaction %': performance.transactionAchievement.toFixed(1),
          'Volume %': performance.volumeAchievement.toFixed(1),
          'Achievement %': performance.achievement.toFixed(1),
        };
      }
      if (isMbPaCampaign(campaign.campaignName)) {
        const actual = mbPaVolumeTotal(prod);
        return {
          Campaign: campaign.campaignName,
          Rank: index + 1,
          Seat: agent.seatNumber ?? '',
          'Agent Name': agent.name,
          'Billing Goal (₱)': target,
          'Actual Billings (₱)': actual,
          'Grand Total Transactions': mbPaTransactionTotal(prod),
          'Progress %': target > 0 ? ((actual / target) * 100).toFixed(1) : '0',
        };
      }
      if (isAcqCampaign(campaign.campaignName)) {
        const ntbGoal = target;
        const supplementaryGoal = agent.monthlyTargetSupplementary || 0;
        return {
          Campaign: campaign.campaignName,
          Rank: index + 1,
          Seat: agent.seatNumber ?? '',
          'Agent Name': agent.name,
          'NTB Goal': ntbGoal,
          'NTB Actual': Number(prod.ntb || 0),
          'Supplementary Goal': supplementaryGoal,
          'Supplementary Actual': Number(prod.supplementary || 0),
          'NTB Progress %': ntbGoal > 0 ? ((Number(prod.ntb || 0) / ntbGoal) * 100).toFixed(1) : '0',
          'Supplementary Progress %': supplementaryGoal > 0
            ? ((Number(prod.supplementary || 0) / supplementaryGoal) * 100).toFixed(1)
            : '0',
        };
      }
      const actual = kpiValueFor(campaign.kpiMetric, prod);
      return {
        Campaign: campaign.campaignName,
        Rank: index + 1,
        Seat: agent.seatNumber ?? '',
        'Agent Name': agent.name,
        Status: record?.status || 'PRESENT',
        Transmittals: prod.transmittals,
        Approvals: prod.approvals,
        Booked: prod.booked,
        'Booked Volume (₱)': Number(prod.volume || 0),
        Target: target,
        'Progress %': target > 0 ? ((actual / target) * 100).toFixed(1) : '0',
      };
    });
  };

  const handleExport = () => {
    const organization = selectedOrganization(selectedCampaignId);
    if (organization) {
      const groupedCampaigns = allCampaigns.filter((campaign) => campaignOrganization(campaign.campaignName) === organization);
      if (!groupedCampaigns.length) return;
      const workbook = XLSX.utils.book_new();
      const usedSheetNames = new Set<string>();
      for (const campaign of groupedCampaigns) {
        const rows = campaignExportRows(campaign);
        const headers = rows.length > 0 ? Object.keys(rows[0]) : [...EXPORT_HEADERS];
        const worksheet = XLSX.utils.json_to_sheet(rows, { header: [...headers] });
        worksheet['!cols'] = [
          { wch: 24 }, { wch: 8 }, { wch: 8 }, { wch: 28 }, { wch: 14 },
          { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 14 }, { wch: 12 },
        ].slice(0, headers.length);
        worksheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${Math.max(campaign.agents.length + 1, 1)}` };
        XLSX.utils.book_append_sheet(workbook, worksheet, safeWorksheetName(campaign.campaignName, usedSheetNames));
      }
      XLSX.writeFile(workbook, `ALL_${organization}_CAMPAIGNS_${today}.xlsx`, { compression: true });
      return;
    }

    // Preserve the existing single-campaign CSV export.
    const rows = campaigns.flatMap(campaignExportRows);
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

  // Campaign Achievement must include every authorized campaign, including
  // zero-production and missing-goal states. The leaderboard still requires
  // at least one collector row.
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
      {allCampaigns.length > 0 && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-muted-foreground">Select Campaign:</label>
                <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                  <SelectTrigger className="w-72">
                    <SelectValue placeholder="Choose a campaign..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_CAMPAIGNS} className="font-semibold">
                      ALL CAMPAIGNS
                    </SelectItem>
                    <div className="my-1 border-t" aria-hidden="true" />
                    <SelectGroup>
                      {campaignGroups.map((group) => (
                        <SelectItem key={campaignGroupValue(group.organization)} value={campaignGroupValue(group.organization)} className="font-semibold">
                          ALL {group.organization} CAMPAIGNS
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <div className="my-1 border-t" aria-hidden="true" />
                    {campaignGroups.map((group) => (
                      <SelectGroup key={group.organization}>
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group.organization}</div>
                        {group.campaigns.map((campaign) => (
                          <SelectItem key={campaign.id} value={campaign.id}>{campaign.campaignName}</SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteCampaignData}
                disabled={
                  deletingCampaignData ||
                  selectedCampaignId === ALL_CAMPAIGNS ||
                  Boolean(selectedOrganization(selectedCampaignId))
                }
                title={
                  selectedCampaignId === ALL_CAMPAIGNS || selectedOrganization(selectedCampaignId)
                    ? 'Select one campaign to delete its data.'
                    : undefined
                }
              >
                {deletingCampaignData ? 'Deleting...' : 'Delete All Data'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Date Filter */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Date:</span>
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
              <p className="text-xs text-muted-foreground uppercase tracking-wide">
                {kpis.mixedKpis ? 'Campaign KPI Goals' : `Total Goal (${kpis.allAcq ? 'NTB' : kpiLabel(kpis.primaryKpi)})`}
              </p>
              <p className="text-3xl font-bold text-indigo-500">
                {kpis.mixedKpis ? '—' : (kpis.allAcq ? kpis.goal.toLocaleString() : formatKpiValue(kpis.primaryKpi, kpis.goal))}
              </p>
              {kpis.mixedKpis ? (
                <p className="text-xs text-muted-foreground">Mixed KPIs are shown per campaign below.</p>
              ) : (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    Progress: {kpis.allAcq ? kpis.totalNtb.toLocaleString() : formatKpiValue(kpis.primaryKpi, kpis.kpiValue)}
                  </span>
                  <span className="font-semibold text-indigo-500">{kpis.targetProgress}%</span>
                </div>
              )}
              {!kpis.mixedKpis && kpis.remainingGoal > 0 && (
                <p className="text-xs text-orange-500 font-semibold">
                  To Go: {kpis.allAcq ? kpis.remainingGoal.toLocaleString() : formatKpiValue(kpis.primaryKpi, kpis.remainingGoal)}
                </p>
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
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  {kpis.allAcq ? 'Total Supplementary' : kpis.mixedKpis ? 'Imported Volume' : `Current ${kpiLabel(kpis.primaryKpi)}`}
                </p>
                <p className="text-3xl font-bold mt-1 text-purple-500">
                  {kpis.allAcq
                    ? (kpis.totalSupplementary?.toLocaleString() || '0')
                    : kpis.mixedKpis
                      ? formatKpiValue('volume', kpis.totalVolume)
                      : formatKpiValue(kpis.primaryKpi, kpis.kpiValue)}
                </p>
                {kpis.allAcq ? (
                  <>
                    <div className="flex items-center justify-between text-xs mt-1 pr-1">
                      <span className="text-muted-foreground">Goal: {kpis.totalSuppGoal.toLocaleString()}</span>
                      <span className="font-semibold text-purple-500">{kpis.suppProgress}%</span>
                    </div>
                    {kpis.remainingSupp > 0 && (
                      <p className="text-xs text-orange-500 font-semibold mt-1">To Go: {kpis.remainingSupp.toLocaleString()}</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">from imported data</p>
                )}
              </div>
              <TrendingUp className="w-8 h-8 text-purple-500 opacity-80 shrink-0" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/20">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Records in Range</p>
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
                  <p className="text-sm text-muted-foreground">
                    {selectedOrganization(selectedCampaignId) ? 'Download grouped Excel workbook' : 'Download CSV'}
                  </p>
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
      {campaigns.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-500" />
            Campaign Achievement
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {[
              {
                label: 'Highest Campaign',
                value: campaignAchievementSummary.highest
                  ? `${campaignAchievementSummary.highest.campaign.campaignName} · ${Number(campaignAchievementSummary.highest.achievement).toFixed(1)}%`
                  : 'Goal unavailable',
              },
              {
                label: 'Lowest Campaign',
                value: campaignAchievementSummary.lowest
                  ? `${campaignAchievementSummary.lowest.campaign.campaignName} · ${Number(campaignAchievementSummary.lowest.achievement).toFixed(1)}%`
                  : 'Goal unavailable',
              },
              {
                label: 'Average',
                value: campaignAchievementSummary.average == null
                  ? 'Goal unavailable'
                  : `${campaignAchievementSummary.average.toFixed(1)}%`,
              },
              {
                label: 'Overall',
                value: campaignAchievementSummary.overall == null
                  ? 'Goal unavailable'
                  : `${campaignAchievementSummary.overall.toFixed(1)}%`,
              },
            ].map((item) => (
              <Card key={item.label}>
                <CardContent className="py-3">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="font-semibold text-sm mt-1 truncate" title={item.value}>{item.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map((campaign) => {
              const campaignAgents = campaign.agents;
              const campaignGoal = campaign.goal ?? 0;
              const campaignKpi = campaign.kpiMetric;
              const presentCount = campaignAgents.filter(a => {
                const record = campaign.attendance[a.id];
                return !record || record.status === 'PRESENT';
              }).length;
              const agentKpiValue = campaignAgents.reduce((sum, agent) => {
                const prod = campaign.production[agent.id] || ZERO_PROD;
                return sum + kpiValueFor(campaignKpi, prod);
              }, 0);
              const totalKpiValue = campaign.campaignProduction ?? campaign.actual ?? agentKpiValue;
              const metricLabel = kpiLabel(campaignKpi);
              const goalProgress = campaignGoal > 0 ? ((totalKpiValue / campaignGoal) * 100).toFixed(1) : '0';
              const acq = isAcqCampaign(campaign.campaignName);
              const mbpl = isMbPlCampaign(campaign.campaignName) && Boolean(campaign.mbPlTotals);

              // Find the top performer using this campaign's configured KPI.
              const topPerformer = campaignAgents.length > 0
                ? campaignAgents.reduce((max, agent) => {
                    if (mbpl) {
                      return (campaign.mbPlPerformance?.[agent.id]?.achievement || 0)
                        > (campaign.mbPlPerformance?.[max.id]?.achievement || 0) ? agent : max;
                    }
                    const currentProd = campaign.production[agent.id] || ZERO_PROD;
                    const maxProd = campaign.production[max.id] || ZERO_PROD;
                    const currentValue = acq ? (currentProd.ntb || 0) : kpiValueFor(campaignKpi, currentProd);
                    const maxValue = acq ? (maxProd.ntb || 0) : kpiValueFor(campaignKpi, maxProd);
                    return currentValue > maxValue ? agent : max;
                  })
                : null;
              const topKpiValue = topPerformer
                ? (mbpl
                  ? (campaign.mbPlPerformance?.[topPerformer.id]?.achievement || 0)
                  : acq ? ((campaign.production[topPerformer.id] || ZERO_PROD).ntb || 0) : kpiValueFor(campaignKpi, campaign.production[topPerformer.id] || ZERO_PROD))
                : 0;

              // ACQ campaigns report NTB + Supplementary instead of booked volume.
              const totalNtb = campaignAgents.reduce((sum, agent) => sum + ((campaign.production[agent.id] || ZERO_PROD).ntb || 0), 0);
              const totalSupplementary = campaignAgents.reduce((sum, agent) => sum + ((campaign.production[agent.id] || ZERO_PROD).supplementary || 0), 0);
              const ntbGoal = campaignGoal; // legacy monthly goal doubles as the NTB goal
              const ntbProgress = ntbGoal > 0 ? ((totalNtb / ntbGoal) * 100).toFixed(1) : '0';
              const achievementPercent = campaign.achievementPercent
                ?? campaign.achievement
                ?? (campaignGoal > 0 ? Number(acq ? ntbProgress : goalProgress) : null);
              const displayedProgress = achievementPercent == null
                ? null
                : achievementPercent.toFixed(1);
              const statusLabel =
                campaign.goalStatus === 'missing' || campaign.dataStatus === 'missing-goal'
                  ? 'Goal unavailable'
                  : campaign.dataStatus === 'no-imported-data'
                    ? 'No data'
                    : campaign.dataStatus === 'no-production-records'
                      ? 'No production'
                    : `${displayedProgress ?? '0.0'}%`;
              const fallbackPeriodLabel = campaignDataPeriodLabel(campaign.dataPeriod);

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
                          {acq ? 'NTB Goal' : mbpl ? 'Bulk Import Achievement' : `${metricLabel} Goal`}
                        </p>
                      </div>

                      {/* Goal and Progress */}
                      <div className="space-y-2">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs text-muted-foreground uppercase tracking-wide">{acq ? 'NTB Goal' : 'Goal'}</span>
                          <span className="text-xl font-bold text-blue-600">
                            {campaign.goalStatus === 'missing'
                              ? 'Goal unavailable'
                              : acq
                                ? Number(ntbGoal).toLocaleString()
                                : formatKpiValue(campaignKpi, campaignGoal)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                Number(displayedProgress ?? 0) >= 100 ? 'bg-green-500' :
                                Number(displayedProgress ?? 0) >= 75 ? 'bg-blue-500' :
                                Number(displayedProgress ?? 0) >= 50 ? 'bg-yellow-500' :
                                'bg-red-500'
                              }`}
                              style={{ width: `${Math.min(Number(displayedProgress ?? 0), 100)}%` }}
                            />
                          </div>
                          <span className="text-sm font-semibold text-foreground min-w-12 text-right whitespace-nowrap">
                            {statusLabel}
                          </span>
                        </div>
                      </div>

                      {/* Stats Grid */}
                      {acq ? (
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                          <div className="text-center">
                            <p className="text-2xl font-bold text-blue-600">{Number(totalNtb).toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground mt-1">Total NTB</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-purple-600">{Number(totalSupplementary).toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground mt-1">Total Supplementary</p>
                          </div>
                        </div>
                      ) : mbpl ? (
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                          <div className="text-center">
                            <p className="text-2xl font-bold text-purple-600">{campaign.mbPlTotals!.transactionActual.toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground mt-1">Actual Transactions</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-green-600">₱{campaign.mbPlTotals!.volumeActual.toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground mt-1">Actual Volume</p>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                          <div className="text-center">
                            <p className="text-2xl font-bold text-foreground">{campaignAgents.length}</p>
                            <p className="text-xs text-muted-foreground mt-1">Agents</p>
                          </div>
                          <div className="text-center">
                            <p className="text-2xl font-bold text-purple-600">{formatKpiValue(campaignKpi, totalKpiValue)}</p>
                            <p className="text-xs text-muted-foreground mt-1">{metricLabel}</p>
                          </div>
                        </div>
                      )}

                      {/* Top KPI Performer */}
                      {(campaign.recordCount ?? campaign.entriesCount) > 0 && topPerformer && topKpiValue > 0 && (
                        <div className="pt-2 border-t bg-yellow-50/50 rounded-lg p-2 mx-[-0.75rem] px-3">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">🥇 Top {metricLabel}</p>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-sm font-medium text-foreground truncate">{topPerformer.name}</span>
                            <span className="text-sm font-bold text-yellow-600">
                              {mbpl ? `${topKpiValue.toFixed(1)}%` : formatKpiValue(campaignKpi, topKpiValue)}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Entries */}
                      <div className="pt-2 border-t">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{fallbackPeriodLabel ? `Latest Import (${fallbackPeriodLabel})` : 'Records in Range'}</span>
                          <span className="text-sm font-semibold text-orange-500">{campaign.recordCount ?? campaign.entriesCount}</span>
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
            <p className="text-sm text-muted-foreground">Ranked by each campaign&apos;s KPI, grouped by campaign</p>
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
              <option value="booked">Sort by KPI</option>
              <option value="seat">Sort by Seat</option>
              <option value="name">Sort by Name</option>
            </select>
          </div>
        </div>

        {nonEmptyCampaigns.length > 0 ? (
          <div className="space-y-4">
            {nonEmptyCampaigns.map((block) => {
              const prodFor = (agentId: string) => block.production[agentId] || ZERO_PROD;
              const acq = isAcqCampaign(block.campaignName);
              const bdo = isBdoCampaign(block.campaignName);
              const mbpl = isMbPlCampaign(block.campaignName);
              const mbpa = isMbPaCampaign(block.campaignName);
              const hasImportedMbPlPerformance = mbpl && Boolean(block.mbPlPerformance && Object.keys(block.mbPlPerformance).length);
              const hasImportedDashboardPerformance = Boolean(
                block.importedPerformance && Object.keys(block.importedPerformance).length
              );
              const q = agentSearch.trim().toLowerCase();
              let filtered = block.agents.filter((a) => a.name.toLowerCase().includes(q));
              filtered = [...filtered].sort((a, b) => {
                if (sortBy === 'booked') {
                  return compareCampaignAgents(block, a, b);
                }
                if (sortBy === 'name') return a.name.localeCompare(b.name);
                return (a.seatNumber || 0) - (b.seatNumber || 0);
              });

              return (
                <CampaignSummaryCard
                  key={block.id}
                  id={block.id}
                  campaignName={block.campaignName}
                  kpiMetric={block.kpiMetric}
                  goal={block.goal ?? 0}
                  actual={block.actual}
                  achievement={block.achievement}
                  goalStatus={block.goalStatus}
                  dataStatus={block.dataStatus}
                  supplementaryGoal={block.supplementaryGoal || 0}
                  agents={block.agents}
                  production={block.production}
                  bdoPerformance={block.bdoPerformance}
                  importedPerformance={block.importedPerformance}
                  mbPlPerformance={block.mbPlPerformance}
                  mbPlTotals={block.mbPlTotals}
                  attendance={block.attendance}
                  entriesCount={block.recordCount ?? block.entriesCount}
                  dataPeriod={block.dataPeriod}
                  agentDataPeriod={block.agentDataPeriod}
                  onDeleteAllAgents={block.agents.some((agent) => !agent.importedOnly) ? () => handleDeleteAllAgents(block.id) : undefined}
                  isDeletingAgents={deletingAllAgents}
                >
                  {/* Collector Table */}
                  {filtered.length > 0 ? (
                    <div className="max-h-[420px] overflow-auto">
                      <Table>
                        <TableHeader className="sticky top-0 bg-card z-10">
                          {hasImportedMbPlPerformance ? (
                            <>
                              <TableRow>
                                <TableHead rowSpan={2} className="w-12 align-bottom">Rank</TableHead>
                                <TableHead rowSpan={2} className="w-12 align-bottom">Seat</TableHead>
                                <TableHead rowSpan={2} className="align-bottom">Collector</TableHead>
                                <TableHead colSpan={2} className="text-center border-l">Target</TableHead>
                                <TableHead colSpan={2} className="text-center border-l">Actual</TableHead>
                                <TableHead colSpan={2} className="text-center border-l">%</TableHead>
                                <TableHead colSpan={2} className="text-center border-l">Score</TableHead>
                                <TableHead rowSpan={2} className="text-center border-l align-bottom">Achievement</TableHead>
                                <TableHead rowSpan={2} className="w-32 align-bottom">Progress</TableHead>
                                <TableHead rowSpan={2} className="text-right w-20 align-bottom">Actions</TableHead>
                              </TableRow>
                              <TableRow>
                                {['Trans', 'Vol', 'Trans', 'Vol', 'Trans', 'Vol', 'Trans', 'Vol'].map((label, metricIndex) => (
                                  <TableHead key={`${label}-${metricIndex}`} className={`text-center text-xs ${metricIndex % 2 === 0 ? 'border-l' : ''}`}>
                                    {label}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </>
                          ) : mbpl ? (
                            <>
                              <TableRow>
                                <TableHead rowSpan={2} className="w-12 align-bottom">Rank</TableHead>
                                <TableHead rowSpan={2} className="w-12 align-bottom">Seat</TableHead>
                                <TableHead rowSpan={2} className="align-bottom">Collector</TableHead>
                                <TableHead colSpan={4} className="text-center border-l">BAU</TableHead>
                                <TableHead colSpan={6} className="text-center border-l">TOP UP</TableHead>
                                <TableHead rowSpan={2} className="w-32 border-l align-bottom">Progress</TableHead>
                                <TableHead rowSpan={2} className="text-right w-20 align-bottom">Actions</TableHead>
                              </TableRow>
                              <TableRow>
                                <TableHead className="text-center text-xs border-l">Payroll Txn</TableHead>
                                <TableHead className="text-center text-xs">Payroll Vol</TableHead>
                                <TableHead className="text-center text-xs">Depositor Txn</TableHead>
                                <TableHead className="text-center text-xs">Depositor Vol</TableHead>
                                <TableHead className="text-center text-xs border-l">Payroll Txn</TableHead>
                                <TableHead className="text-center text-xs">Payroll Vol</TableHead>
                                <TableHead className="text-center text-xs">Depositor Txn</TableHead>
                                <TableHead className="text-center text-xs">Depositor Vol</TableHead>
                                <TableHead className="text-center text-xs">Open Mkt Txn</TableHead>
                                <TableHead className="text-center text-xs">Open Mkt Vol</TableHead>
                              </TableRow>
                            </>
                          ) : mbpa ? (
                            <>
                              <TableRow>
                                <TableHead rowSpan={2} className="w-12 align-bottom">Rank</TableHead>
                                <TableHead rowSpan={2} className="w-12 align-bottom">Seat</TableHead>
                                <TableHead rowSpan={2} className="align-bottom">Collector</TableHead>
                                <TableHead colSpan={6} className="text-center border-l">TOTAL</TableHead>
                                <TableHead colSpan={2} className="text-center border-l">GRAND TOTAL</TableHead>
                                <TableHead rowSpan={2} className="text-right border-l align-bottom">Agent Goal</TableHead>
                                <TableHead rowSpan={2} className="w-32 border-l align-bottom">Progress</TableHead>
                                <TableHead rowSpan={2} className="text-right w-20 align-bottom">Actions</TableHead>
                              </TableRow>
                              <TableRow>
                                <TableHead className="text-center text-xs border-l">C2G Txn</TableHead>
                                <TableHead className="text-center text-xs">C2G Vol</TableHead>
                                <TableHead className="text-center text-xs">BT Txn</TableHead>
                                <TableHead className="text-center text-xs">BT Vol</TableHead>
                                <TableHead className="text-center text-xs">BalCon PA Txn</TableHead>
                                <TableHead className="text-center text-xs">BalCon PA Vol</TableHead>
                                <TableHead className="text-center text-xs border-l">Txn</TableHead>
                                <TableHead className="text-center text-xs">Vol</TableHead>
                              </TableRow>
                            </>
                          ) : (
                            <TableRow>
                              <TableHead className="w-12">Rank</TableHead>
                              <TableHead className="w-12">Seat</TableHead>
                              <TableHead>Collector</TableHead>
                              {acq ? (
                                <>
                                  <TableHead className="text-center">NTB Actual</TableHead>
                                  <TableHead className="text-center">NTB Goal</TableHead>
                                  <TableHead className="text-center">Supplementary Actual</TableHead>
                                  <TableHead className="text-center">Supplementary Goal</TableHead>
                                </>
                              ) : bdo || hasImportedDashboardPerformance ? (
                                <>
                                  <TableHead className="text-center w-20">Attendance</TableHead>
                                  <TableHead className="text-right">Goal</TableHead>
                                  <TableHead className="text-right">Actual</TableHead>
                                  <TableHead className="text-center">Achievement</TableHead>
                                </>
                              ) : (
                                <>
                                  <TableHead className="text-center w-20">Attendance</TableHead>
                                  <TableHead className="text-right">Agent Goal</TableHead>
                                  <TableHead className="text-center">Transmitted</TableHead>
                                  <TableHead className="text-center">Approved</TableHead>
                                  <TableHead className="text-center">Activated</TableHead>
                                  <TableHead className="text-center">Booked</TableHead>
                                  <TableHead className="text-right">Booked Volume (₱)</TableHead>
                                </>
                              )}
                              <TableHead className="w-32">Progress</TableHead>
                              <TableHead className="text-right w-20">Actions</TableHead>
                            </TableRow>
                          )}
                        </TableHeader>
                        <TableBody>
                          {filtered.map((agent, index) => {
                            const prod = prodFor(agent.id);
                            const record = block.attendance[agent.id];
                            const isPresent = !record || record.status === 'PRESENT';
                            const value = kpiValueFor(block.kpiMetric, prod);
                            const importedMetrics = block.importedPerformance?.[agent.id]
                              || block.bdoPerformance?.[agent.id]
                              || { goal: 0, actual: 0, achievement: 0 };
                            const mbPlMetrics = block.mbPlPerformance?.[agent.id] || {
                              goal: 0, actual: 0, transactionGoal: 0, transactionActual: 0,
                              volumeGoal: 0, volumeActual: 0, transactionAchievement: 0,
                              volumeAchievement: 0, transactionScore: 0, volumeScore: 0, achievement: 0,
                            };
                            // ACQ tracks its paired metrics; other campaigns track their configured KPI.
                            const acqTarget = (agent.monthlyTarget || 0) + (agent.monthlyTargetSupplementary || 0);
                            const acqActual = (prod.ntb || 0) + (prod.supplementary || 0);
                            const mbpaCategoryBilling = Number(prod.c2gVol || 0) + Number(prod.btVol || 0) + Number(prod.balconVol || 0);
                            const mbpaBilling = mbpaCategoryBilling || Number(prod.grandTotalVol || 0);
                            const hasTarget = acq ? acqTarget > 0 : !!agent.monthlyTarget;
                            const progressNum = acq
                              ? (acqTarget > 0 ? (acqActual / acqTarget) * 100 : 0)
                              : (agent.monthlyTarget ? ((mbpa ? mbpaBilling : value) / agent.monthlyTarget) * 100 : 0);
                            // Separate NTB / Supplementary progress bars for ACQ.
                            const ntbProgress = (agent.monthlyTarget || 0) > 0 ? ((prod.ntb || 0) / (agent.monthlyTarget as number)) * 100 : 0;
                            const suppProgress = (agent.monthlyTargetSupplementary || 0) > 0 ? ((prod.supplementary || 0) / (agent.monthlyTargetSupplementary as number)) * 100 : 0;
                            // MB PL: total turn-ins (all BAU + Top Up txn/vol) vs the Gross Turn Ins goals.
                            const mbTotalTxn = (prod.bauPayrollTxn || 0) + (prod.bauDepositorTxn || 0) + (prod.topupPayrollTxn || 0) + (prod.topupDepositorTxn || 0) + (prod.openMarketTxn || 0);
                            const mbTotalVol = (prod.bauPayrollVol || 0) + (prod.bauDepositorVol || 0) + (prod.topupPayrollVol || 0) + (prod.topupDepositorVol || 0) + (prod.openMarketVol || 0);
                            const mbTxnTarget = agent.grossTurnInsTxnTarget || 0;
                            const mbVolTarget = agent.grossTurnInsVolTarget || 0;
                            const mbTxnProgress = mbTxnTarget > 0 ? (mbTotalTxn / mbTxnTarget) * 100 : 0;
                            const mbVolProgress = mbVolTarget > 0 ? (mbTotalVol / mbVolTarget) * 100 : 0;
                            const mbHasTarget = mbTxnTarget > 0 || mbVolTarget > 0 || (agent.disbursedTxnTarget || 0) > 0 || (agent.disbursedVolTarget || 0) > 0;

                            return (
                              <TableRow key={agent.id} className={!isPresent ? 'opacity-50 bg-muted/30' : ''}>
                                <TableCell className="text-center">
                                  {sortBy === 'booked' && block.entriesCount > 0 ? getRankBadge(index) : <span className="text-muted-foreground text-sm">-</span>}
                                </TableCell>
                                <TableCell className="font-semibold text-muted-foreground">{agent.seatNumber}</TableCell>
                                <TableCell className="font-medium">{agent.name}</TableCell>
                                {hasImportedMbPlPerformance ? (
                                  <>
                                    <TableCell className="text-center border-l font-semibold text-blue-600">{mbPlMetrics.transactionGoal.toLocaleString()}</TableCell>
                                    <TableCell className="text-right text-blue-600">₱{mbPlMetrics.volumeGoal.toLocaleString()}</TableCell>
                                    <TableCell className="text-center border-l font-semibold text-purple-600">{mbPlMetrics.transactionActual.toLocaleString()}</TableCell>
                                    <TableCell className="text-right text-purple-600">₱{mbPlMetrics.volumeActual.toLocaleString()}</TableCell>
                                    <TableCell className="text-center border-l">{mbPlMetrics.transactionAchievement.toFixed(1)}%</TableCell>
                                    <TableCell className="text-center">{mbPlMetrics.volumeAchievement.toFixed(1)}%</TableCell>
                                    <TableCell className="text-center border-l">{mbPlMetrics.transactionScore.toFixed(1)}%</TableCell>
                                    <TableCell className="text-center">{mbPlMetrics.volumeScore.toFixed(1)}%</TableCell>
                                    <TableCell className="text-center border-l font-semibold text-emerald-600">{mbPlMetrics.achievement.toFixed(1)}%</TableCell>
                                  </>
                                ) : mbpl ? (
                                  <>
                                    <TableCell className="text-center border-l">{Number(prod.bauPayrollTxn || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center text-purple-600">₱{Number(prod.bauPayrollVol || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center">{Number(prod.bauDepositorTxn || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center text-purple-600">₱{Number(prod.bauDepositorVol || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center border-l">{Number(prod.topupPayrollTxn || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center text-purple-600">₱{Number(prod.topupPayrollVol || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center">{Number(prod.topupDepositorTxn || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center text-purple-600">₱{Number(prod.topupDepositorVol || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center">{Number(prod.openMarketTxn || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center text-purple-600">₱{Number(prod.openMarketVol || 0).toLocaleString()}</TableCell>
                                  </>
                                ) : mbpa ? (
                                  <>
                                    <TableCell className="text-center border-l">{Number(prod.c2gTxn || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center text-purple-600">₱{Number(prod.c2gVol || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center">{Number(prod.btTxn || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center text-purple-600">₱{Number(prod.btVol || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center">{Number(prod.balconTxn || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center text-purple-600">₱{Number(prod.balconVol || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center border-l font-semibold">{Number((prod.c2gTxn || 0) + (prod.btTxn || 0) + (prod.balconTxn || 0)).toLocaleString()}</TableCell>
                                    <TableCell className="text-center text-purple-600 font-semibold">₱{Number((prod.c2gVol || 0) + (prod.btVol || 0) + (prod.balconVol || 0)).toLocaleString()}</TableCell>
                                    <TableCell className="text-right border-l font-semibold text-blue-600">₱{Number(agent.monthlyTarget || 0).toLocaleString()}</TableCell>
                                  </>
                                ) : acq ? (
                                  <>
                                    <TableCell className="text-center font-semibold text-blue-600">{Number(prod.ntb || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center font-semibold text-blue-600">{Number(agent.monthlyTarget || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center font-semibold text-purple-600">{Number(prod.supplementary || 0).toLocaleString()}</TableCell>
                                    <TableCell className="text-center font-semibold text-purple-600">{Number(agent.monthlyTargetSupplementary || 0).toLocaleString()}</TableCell>
                                  </>
                                ) : bdo || hasImportedDashboardPerformance ? (
                                  <>
                                    <TableCell className="text-center">
                                      {agent.importedOnly ? (
                                        <span className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600">Imported</span>
                                      ) : (
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
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right font-semibold text-blue-600">{formatKpiValue(block.kpiMetric, importedMetrics.goal)}</TableCell>
                                    <TableCell className="text-right font-semibold text-purple-600">{formatKpiValue(block.kpiMetric, importedMetrics.actual)}</TableCell>
                                    <TableCell className="text-center font-semibold text-emerald-600">{importedMetrics.achievement.toFixed(1)}%</TableCell>
                                  </>
                                ) : (
                                  <>
                                    <TableCell className="text-center">
                                      {agent.importedOnly ? (
                                        <span className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600">Imported</span>
                                      ) : (
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
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right font-semibold text-blue-600">{formatKpiValue(block.kpiMetric, Number(agent.monthlyTarget || 0))}</TableCell>
                                    <TableCell className="text-center">{prod.transmittals}</TableCell>
                                    <TableCell className="text-center">{prod.approvals}</TableCell>
                                    <TableCell className="text-center">{prod.activations}</TableCell>
                                    <TableCell className="text-center font-semibold text-primary">{prod.booked}</TableCell>
                                    <TableCell className="text-right font-semibold text-purple-600">₱{Number(prod.volume || 0).toLocaleString()}</TableCell>
                                  </>
                                )}
                                <TableCell>
                                  {hasImportedMbPlPerformance ? (
                                    mbPlMetrics.transactionGoal > 0 || mbPlMetrics.volumeGoal > 0 ? (
                                      <div className="flex items-center gap-2">
                                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                          <div
                                            className={`h-full transition-all ${getProgressColor(mbPlMetrics.achievement)}`}
                                            style={{ width: `${Math.min(mbPlMetrics.achievement, 100)}%` }}
                                          />
                                        </div>
                                        <span className={`text-xs w-10 text-right ${
                                          mbPlMetrics.achievement >= 100 ? 'text-green-500 font-bold' :
                                          mbPlMetrics.achievement >= 75 ? 'text-blue-500' :
                                          mbPlMetrics.achievement >= 50 ? 'text-yellow-500' :
                                          'text-muted-foreground'
                                        }`}>
                                          {mbPlMetrics.achievement.toFixed(0)}%
                                        </span>
                                      </div>
                                    ) : (
                                      <span className="text-muted-foreground text-xs">No imported goal</span>
                                    )
                                  ) : mbpl ? (
                                    mbHasTarget ? (
                                      <div className="space-y-1.5">
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] font-semibold text-blue-600 w-7 shrink-0">TXN</span>
                                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                            <div className={`h-full transition-all ${getProgressColor(mbTxnProgress)}`} style={{ width: `${Math.min(mbTxnProgress, 100)}%` }} />
                                          </div>
                                          <span className="text-xs w-9 text-right text-muted-foreground">{mbTxnProgress.toFixed(0)}%</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] font-semibold text-purple-600 w-7 shrink-0">VOL</span>
                                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                            <div className={`h-full transition-all ${getProgressColor(mbVolProgress)}`} style={{ width: `${Math.min(mbVolProgress, 100)}%` }} />
                                          </div>
                                          <span className="text-xs w-9 text-right text-muted-foreground">{mbVolProgress.toFixed(0)}%</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <span className="text-muted-foreground text-xs">No target</span>
                                    )
                                  ) : acq ? (
                                    hasTarget ? (
                                      <div className="space-y-1.5">
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] font-semibold text-blue-600 w-7 shrink-0">NTB</span>
                                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                            <div className={`h-full transition-all ${getProgressColor(ntbProgress)}`} style={{ width: `${Math.min(ntbProgress, 100)}%` }} />
                                          </div>
                                          <span className="text-xs w-9 text-right text-muted-foreground">{ntbProgress.toFixed(0)}%</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] font-semibold text-purple-600 w-7 shrink-0">SUP</span>
                                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                            <div className={`h-full transition-all ${getProgressColor(suppProgress)}`} style={{ width: `${Math.min(suppProgress, 100)}%` }} />
                                          </div>
                                          <span className="text-xs w-9 text-right text-muted-foreground">{suppProgress.toFixed(0)}%</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <span className="text-muted-foreground text-xs">No target</span>
                                    )
                                  ) : bdo || hasImportedDashboardPerformance ? (
                                    importedMetrics.goal > 0 ? (
                                      <div className="flex items-center gap-2">
                                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                          <div
                                            className={`h-full transition-all ${getProgressColor(importedMetrics.achievement)}`}
                                            style={{ width: `${Math.min(importedMetrics.achievement, 100)}%` }}
                                          />
                                        </div>
                                        <span className={`text-xs w-10 text-right ${
                                          importedMetrics.achievement >= 100 ? 'text-green-500 font-bold' :
                                          importedMetrics.achievement >= 75 ? 'text-blue-500' :
                                          importedMetrics.achievement >= 50 ? 'text-yellow-500' :
                                          'text-muted-foreground'
                                        }`}>
                                          {importedMetrics.achievement.toFixed(0)}%
                                        </span>
                                      </div>
                                    ) : (
                                      <span className="text-muted-foreground text-xs">No imported goal</span>
                                    )
                                  ) : agent.monthlyTarget ? (
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
                                  {agent.importedOnly || agent.goalSource === 'bulk_import' || hasImportedMbPlPerformance ? (
                                    <span className="text-xs text-muted-foreground">Bulk Import</span>
                                  ) : <div className="flex gap-1 justify-end">
                                    <Button
                                      variant="ghost" size="icon" className="h-7 w-7"
                                      onClick={() => setTargetModal({ agentId: agent.id, agentName: agent.name, currentTarget: agent.monthlyTarget, currentTargetSupplementary: agent.monthlyTargetSupplementary, isAcq: acq, isMbPl: mbpl, currentMbLevel: agent.mbLevel, currentDisbursedTxn: agent.disbursedTxnTarget, currentDisbursedVol: agent.disbursedVolTarget, currentGtiTxn: agent.grossTurnInsTxnTarget, currentGtiVol: agent.grossTurnInsVolTarget, campaignId: block.id, agentCount: block.agents.length })}
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
                                  </div>}
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
          currentTargetSupplementary={targetModal.currentTargetSupplementary}
          isAcq={targetModal.isAcq}
          isMbPl={targetModal.isMbPl}
          currentMbLevel={targetModal.currentMbLevel}
          currentDisbursedTxn={targetModal.currentDisbursedTxn}
          currentDisbursedVol={targetModal.currentDisbursedVol}
          currentGtiTxn={targetModal.currentGtiTxn}
          currentGtiVol={targetModal.currentGtiVol}
          onClose={() => setTargetModal(null)}
          onSave={handleSaveTarget}
          loading={savingTarget}
          agentCount={targetModal.agentCount}
        />
      )}
    </div>
  );
}
