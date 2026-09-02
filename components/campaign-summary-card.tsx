'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, Search, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compareMonthlyProductionRank } from '@/lib/agent-goal-allocation';

export interface Agent {
  id: string;
  name: string;
  seatNumber: number | null;
  monthlyTarget?: number;
}

export interface Production {
  transmittals: number;
  firstCardTransmittals?: number;
  bundleCardTransmittals?: number;
  firstCardFinalTotal?: number;
  bundleCardFinalTotal?: number;
  firstCardWholeYearTotal?: number;
  bundleCardWholeYearTotal?: number;
  activations: number;
  approvals: number;
  booked: number;
  volume?: number;
  ntb?: number;
  supplementary?: number;
  c2gTxn?: number;
  c2gVol?: number;
  btTxn?: number;
  btVol?: number;
  balconTxn?: number;
  balconVol?: number;
  grandTotalTxn?: number;
  grandTotalVol?: number;
}

export interface CampaignSummaryProps {
  id: string;
  campaignName: string;
  kpiMetric: string;
  goal: number;
  actual?: number | null;
  achievement?: number | null;
  goalStatus?: 'available' | 'missing';
  dataStatus?: 'complete' | 'zero-production' | 'no-production-records' | 'missing-goal' | 'no-imported-data';
  supplementaryGoal?: number;
  agents: Agent[];
  production: Record<string, Production>;
  bdoPerformance?: Record<string, { goal: number; actual: number; achievement: number }>;
  importedPerformance?: Record<string, { goal: number; actual: number; achievement: number }>;
  mbPlPerformance?: Record<string, {
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
  }>;
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
  onCollectorSearch?: (query: string) => void;
  onDeleteAllAgents?: () => void;
  isDeletingAgents?: boolean;
  children?: React.ReactNode;
}

const ZERO_PROD: Production = { transmittals: 0, activations: 0, approvals: 0, booked: 0, volume: 0, ntb: 0, supplementary: 0 };

// ACQ campaigns (name contains "ACQ") report NTB + Supplementary instead of booked volume.
const isAcqCampaign = (name?: string | null) => /\bacq\b/i.test(name || '');
const isBdoCampaign = (name?: string | null) => /^bdo\b/i.test((name || '').trim());
const isBdoSgmCampaign = (name?: string | null) => /^bdo\s+sgm$/i.test((name || '').trim());
const isMbPlCampaign = (name?: string | null) => /\bmb\s*pl\b/i.test(name || '');
const isMbPaCampaign = (name?: string | null) => /\bmb\s*pa\b/i.test(name || '');

function mbPaTransactionTotal(prod: Production) {
  const categoryTotal = Number(prod.c2gTxn || 0) + Number(prod.btTxn || 0) + Number(prod.balconTxn || 0);
  return categoryTotal || Number(prod.grandTotalTxn || 0);
}

function mbPaBillingTotal(prod: Production) {
  const categoryTotal = Number(prod.c2gVol || 0) + Number(prod.btVol || 0) + Number(prod.balconVol || 0);
  return categoryTotal || Number(prod.grandTotalVol || 0);
}

function kpiValueFor(metric: string, prod: Production): number {
  switch (metric) {
    case 'transmittals': return prod.transmittals;
    case 'activations': return prod.activations;
    case 'approvals': return prod.approvals;
    case 'volume': return prod.volume || 0;
    default: return prod.booked;
  }
}

function kpiLabel(metric: string): string {
  switch (metric) {
    case 'percentage': return 'Rate';
    case 'count': return 'Count';
    case 'currency': return 'Amount';
    case 'custom': return 'Actual';
    case 'transmittals': return 'Transmittals';
    case 'activations': return 'Activations';
    case 'approvals': return 'Approvals';
    case 'volume': return 'Volume';
    case 'achievements': return 'Achievements';
    default: return 'Booked';
  }
}

function formatKpiValue(metric: string, value: number): string {
  if (metric === 'percentage') return new Intl.NumberFormat('en-PH', { style: 'percent', maximumFractionDigits: 2 }).format(Number(value));
  if (metric === 'currency') return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(value));
  const formatted = Number(value).toLocaleString();
  return metric === 'volume' ? `₱${formatted}` : formatted;
}

export function CampaignSummaryCard({
  campaignName,
  kpiMetric,
  goal,
  actual,
  achievement: importedAchievement,
  goalStatus,
  dataStatus,
  supplementaryGoal = 0,
  agents,
  production,
  bdoPerformance,
  importedPerformance,
  mbPlPerformance,
  mbPlTotals,
  attendance,
  entriesCount,
  dataPeriod,
  agentDataPeriod,
  children,
  onCollectorSearch,
  onDeleteAllAgents,
  isDeletingAgents,
}: CampaignSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  const [collectorsExpanded, setCollectorsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Calculate metrics
  const activeCollectors = agents.filter(a => {
    const record = attendance[a.id];
    return !record || record.status === 'PRESENT';
  }).length;

  const agentProduction = agents.reduce((sum, agent) => {
    const prod = production[agent.id] || ZERO_PROD;
    return sum + kpiValueFor(kpiMetric, prod);
  }, 0);
  const totalProduction = actual ?? agentProduction;

  // ACQ campaigns track NTB + Supplementary instead of booked volume.
  const acq = isAcqCampaign(campaignName);
  const bdo = isBdoCampaign(campaignName);
  const bdoSgm = isBdoSgmCampaign(campaignName);
  const mbpl = isMbPlCampaign(campaignName);
  const mbpa = isMbPaCampaign(campaignName);
  const dashboardImported = Boolean(importedPerformance && Object.keys(importedPerformance).length);
  const totalNtb = agents.reduce((sum, agent) => sum + ((production[agent.id] || ZERO_PROD).ntb || 0), 0);
  const totalSupplementary = agents.reduce((sum, agent) => sum + ((production[agent.id] || ZERO_PROD).supplementary || 0), 0);
  const totalFirstCard = agents.reduce((sum, agent) => {
    const value = production[agent.id] || ZERO_PROD;
    return sum + Number(value.firstCardFinalTotal ?? value.firstCardTransmittals ?? 0);
  }, 0);
  const totalBundleCard = agents.reduce((sum, agent) => {
    const value = production[agent.id] || ZERO_PROD;
    return sum + Number(value.bundleCardFinalTotal ?? value.bundleCardTransmittals ?? 0);
  }, 0);
  const totalWholeYearFirstCard = agents.reduce((sum, agent) => {
    const value = production[agent.id] || ZERO_PROD;
    return sum + Number(value.firstCardWholeYearTotal ?? value.firstCardTransmittals ?? 0);
  }, 0);
  const totalWholeYearBundleCard = agents.reduce((sum, agent) => {
    const value = production[agent.id] || ZERO_PROD;
    return sum + Number(value.bundleCardWholeYearTotal ?? value.bundleCardTransmittals ?? 0);
  }, 0);

  // For ACQ the header %/achievement tracks NTB vs the NTB goal (legacy monthly goal).
  const achievement = mbpl && importedAchievement != null
    ? importedAchievement.toFixed(1)
    : acq
    ? (goal > 0 ? ((totalNtb / goal) * 100).toFixed(1) : '0')
    : (goal > 0 ? ((totalProduction / goal) * 100).toFixed(1) : '0');
  const remainingGoal = Math.max(0, goal - (acq ? totalNtb : totalProduction));
  const metricLabel = mbpl ? 'Goal & Actual' : mbpa ? 'Billings' : kpiLabel(kpiMetric);
  const displayMetric = mbpa ? 'volume' : kpiMetric;
  const hasRecordsInRange = entriesCount > 0 &&
    dataStatus !== 'no-imported-data' &&
    dataStatus !== 'no-production-records';
  const achievementLabel = goalStatus === 'missing' || dataStatus === 'missing-goal'
    ? 'Goal unavailable'
    : dataStatus === 'no-production-records'
      ? 'No production'
    : hasRecordsInRange
      ? `${achievement}%`
      : 'No data';
  const fallbackPeriodLabel = dataPeriod?.source === 'latest_import' && dataPeriod.month && dataPeriod.year
    ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(dataPeriod.year, dataPeriod.month - 1, 1)))
    : null;
  const agentFallbackPeriodLabel = agentDataPeriod?.source === 'latest_import' && agentDataPeriod.month && agentDataPeriod.year
    ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(agentDataPeriod.year, agentDataPeriod.month - 1, 1)))
    : null;

  // Performance distribution follows the campaign's configured KPI.
  const performanceDistribution = useMemo(() => {
    const distribution = { excellent: 0, good: 0, average: 0, needsImprovement: 0 };
    if (goal === 0 || entriesCount === 0) return distribution;
    agents.forEach(agent => {
      const prod = production[agent.id] || ZERO_PROD;
      const value = acq ? (prod.ntb || 0) : dashboardImported ? (importedPerformance?.[agent.id]?.actual || 0) : bdoSgm ? prod.transmittals : bdo ? (bdoPerformance?.[agent.id]?.actual || 0) : mbpl ? (mbPlPerformance?.[agent.id]?.actual || 0) : mbpa ? mbPaBillingTotal(prod) : kpiValueFor(kpiMetric, prod);
      // Calculate agent's share of total goal proportionally, or use their monthly target if set
      const agentGoal = dashboardImported ? (importedPerformance?.[agent.id]?.goal || 0) : bdo ? (bdoPerformance?.[agent.id]?.goal || 0) : mbpl ? (mbPlPerformance?.[agent.id]?.goal || 0) : agent.monthlyTarget || 0;
      if (agentGoal === 0) return;
      const progress = mbpl ? (mbPlPerformance?.[agent.id]?.achievement || 0) : (value / agentGoal) * 100;
      if (progress >= 100) distribution.excellent++;
      else if (progress >= 80) distribution.good++;
      else if (progress >= 50) distribution.average++;
      else distribution.needsImprovement++;
    });
    return distribution;
  }, [agents, production, goal, entriesCount, acq, bdo, bdoSgm, mbpl, mbpa, dashboardImported, importedPerformance, bdoPerformance, mbPlPerformance, kpiMetric]);

  // Imported monthly reports rank their top performer by actual production.
  const performerStats = useMemo(() => {
    if (entriesCount === 0) {
      return { topPerformer: undefined, bottomPerformer: undefined, reachedGoal: 0, belowTarget: 0, withProduction: 0, zeroProduction: 0 };
    }
    const performers = agents
      .filter(agent => !mbpl || Boolean(mbPlPerformance?.[agent.id]))
      .map(agent => {
        const prod = production[agent.id] || ZERO_PROD;
        const value = acq ? (prod.ntb || 0) : dashboardImported ? (importedPerformance?.[agent.id]?.actual || 0) : bdoSgm ? prod.transmittals : bdo ? (bdoPerformance?.[agent.id]?.actual || 0) : mbpl ? (mbPlPerformance?.[agent.id]?.actual || 0) : mbpa ? mbPaTransactionTotal(prod) : kpiValueFor(kpiMetric, prod);
        const secondary = acq ? (prod.supplementary || 0) : mbpa ? mbPaBillingTotal(prod) : 0;
        const agentGoal = dashboardImported ? (importedPerformance?.[agent.id]?.goal || 0) : bdo ? (bdoPerformance?.[agent.id]?.goal || 0) : mbpl ? (mbPlPerformance?.[agent.id]?.goal || 0) : agent.monthlyTarget || 0;
        const progressValue = mbpa ? mbPaBillingTotal(prod) : value;
        return {
          agent,
          value,
          secondary,
          target: agentGoal,
          progress: mbpl
            ? (mbPlPerformance?.[agent.id]?.achievement || 0)
            : agentGoal > 0 ? (progressValue / agentGoal) * 100 : 0,
        };
      })
      .sort((a, b) => dashboardImported
        ? compareMonthlyProductionRank(
          { achievement: a.progress, actual: a.value, secondary: a.secondary, name: a.agent.name },
          { achievement: b.progress, actual: b.value, secondary: b.secondary, name: b.agent.name },
        )
        : mbpl
          ? b.progress - a.progress
          : (b.value !== a.value ? b.value - a.value : b.secondary - a.secondary));

    return {
      topPerformer: performers[0],
      bottomPerformer: performers[performers.length - 1],
      reachedGoal: performers.filter(p => p.progress >= 100).length,
      belowTarget: performers.filter(p => p.progress < 100 && p.target > 0).length,
      withProduction: performers.filter(p => p.value > 0).length,
      zeroProduction: performers.filter(p => p.value === 0).length,
    };
  }, [agents, production, acq, bdo, bdoSgm, mbpl, mbpa, dashboardImported, importedPerformance, bdoPerformance, mbPlPerformance, kpiMetric, entriesCount]);

  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return agents;
    const q = searchQuery.toLowerCase();
    return agents.filter(a => a.name.toLowerCase().includes(q) || a.seatNumber?.toString().includes(q));
  }, [agents, searchQuery]);

  return (
    <Card className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow">
      {/* Header - Always Visible */}
      <CardHeader
        className="pb-4 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <ChevronDown
              className={cn(
                'w-5 h-5 text-muted-foreground transition-transform flex-shrink-0',
                expanded && 'rotate-180'
              )}
            />
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-lg text-foreground truncate">{campaignName}</h3>
              <p className="text-xs text-muted-foreground mt-1">{acq ? 'NTB & Supplementary' : mbpl ? 'Bulk Import: Transactions & Volume' : metricLabel}</p>
            </div>
          </div>
          <div className="text-right flex-shrink-0 ml-4">
            <p className="text-2xl font-bold text-primary">{achievementLabel}</p>
            <p className="text-xs text-muted-foreground">{activeCollectors} collectors</p>
          </div>
        </div>
      </CardHeader>

      {/* Expanded Content */}
      {expanded && (
        <CardContent className="pt-0 space-y-6">
          {fallbackPeriodLabel && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-blue-200">
              The selected dates have no records for this campaign. Showing its latest imported campaign summary from {fallbackPeriodLabel}
              {agentFallbackPeriodLabel && agentFallbackPeriodLabel !== fallbackPeriodLabel
                ? ` and collector monitoring data from ${agentFallbackPeriodLabel}`
                : ''}.
            </div>
          )}
          {!hasRecordsInRange && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200">
              No production records fall within the selected date range. Adjust the date filter to view this campaign&apos;s imported performance.
            </div>
          )}
          {hasRecordsInRange && (goalStatus === 'missing' || dataStatus === 'missing-goal') && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200">
              Production was imported for this period, but the workbook does not contain a valid campaign or agent goal.
            </div>
          )}
          {/* KPI Cards */}
          {bdoSgm ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-blue-200/60 bg-gradient-to-br from-blue-50 to-blue-100/50 p-3 dark:border-blue-800/50 dark:from-blue-950/60 dark:to-blue-900/20">
                <p className="text-xs text-muted-foreground mb-1">Final FC Total</p>
                <p className="text-xl font-bold text-blue-600">{totalFirstCard.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-sky-200/60 bg-gradient-to-br from-sky-50 to-sky-100/50 p-3 dark:border-sky-800/50 dark:from-sky-950/60 dark:to-sky-900/20">
                <p className="text-xs text-muted-foreground mb-1">Final BC Total</p>
                <p className="text-xl font-bold text-violet-600">{totalBundleCard.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-violet-200/60 bg-gradient-to-br from-violet-50 to-violet-100/50 p-3 dark:border-violet-800/50 dark:from-violet-950/60 dark:to-violet-900/20">
                <p className="text-xs text-muted-foreground mb-1">Whole-Year Total FC</p>
                <p className="text-xl font-bold text-sky-600">{totalWholeYearFirstCard.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-green-200/60 bg-gradient-to-br from-green-50 to-green-100/50 p-3 dark:border-green-800/50 dark:from-green-950/60 dark:to-green-900/20">
                <p className="text-xs text-muted-foreground mb-1">Whole-Year Total BC</p>
                <p className="text-xl font-bold text-purple-600">{totalWholeYearBundleCard.toLocaleString()}</p>
              </div>
            </div>
          ) : acq ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-blue-200/60 bg-gradient-to-br from-blue-50 to-blue-100/50 p-3 dark:border-blue-800/50 dark:from-blue-950/60 dark:to-blue-900/20">
                <p className="text-xs text-muted-foreground mb-1">Monthly Goal (NTB)</p>
                <p className="text-xl font-bold text-blue-600">{goalStatus === 'missing' ? 'Unavailable' : goal.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-indigo-200/60 bg-gradient-to-br from-indigo-50 to-indigo-100/50 p-3 dark:border-indigo-800/50 dark:from-indigo-950/60 dark:to-indigo-900/20">
                <p className="text-xs text-muted-foreground mb-1">Monthly Goal (Supplementary)</p>
                <p className="text-xl font-bold text-indigo-600">{Number(supplementaryGoal).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-purple-200/60 bg-gradient-to-br from-purple-50 to-purple-100/50 p-3 dark:border-purple-800/50 dark:from-purple-950/60 dark:to-purple-900/20">
                <p className="text-xs text-muted-foreground mb-1">Total NTB</p>
                <p className="text-xl font-bold text-purple-600">{Number(totalNtb).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-green-200/60 bg-gradient-to-br from-green-50 to-green-100/50 p-3 dark:border-green-800/50 dark:from-green-950/60 dark:to-green-900/20">
                <p className="text-xs text-muted-foreground mb-1">Total Supplementary</p>
                <p className="text-xl font-bold text-green-600">{Number(totalSupplementary).toLocaleString()}</p>
              </div>
            </div>
          ) : mbpl && mbPlTotals ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-blue-200/60 bg-gradient-to-br from-blue-50 to-blue-100/50 p-3 dark:border-blue-800/50 dark:from-blue-950/60 dark:to-blue-900/20">
                <p className="text-xs text-muted-foreground mb-1">Target Transactions</p>
                <p className="text-xl font-bold text-blue-600">{mbPlTotals.transactionGoal.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-purple-200/60 bg-gradient-to-br from-purple-50 to-purple-100/50 p-3 dark:border-purple-800/50 dark:from-purple-950/60 dark:to-purple-900/20">
                <p className="text-xs text-muted-foreground mb-1">Actual Transactions</p>
                <p className="text-xl font-bold text-purple-600">{mbPlTotals.transactionActual.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-blue-200/60 bg-gradient-to-br from-blue-50 to-blue-100/50 p-3 dark:border-blue-800/50 dark:from-blue-950/60 dark:to-blue-900/20">
                <p className="text-xs text-muted-foreground mb-1">Target Volume</p>
                <p className="text-xl font-bold text-blue-600">₱{mbPlTotals.volumeGoal.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-green-200/60 bg-gradient-to-br from-green-50 to-green-100/50 p-3 dark:border-green-800/50 dark:from-green-950/60 dark:to-green-900/20">
                <p className="text-xs text-muted-foreground mb-1">Actual Volume</p>
                <p className="text-xl font-bold text-green-600">₱{mbPlTotals.volumeActual.toLocaleString()}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-blue-200/60 bg-gradient-to-br from-blue-50 to-blue-100/50 p-3 dark:border-blue-800/50 dark:from-blue-950/60 dark:to-blue-900/20">
                <p className="text-xs text-muted-foreground mb-1">{mbpl ? 'Imported Goal' : `Goal (${metricLabel})`}</p>
                <p className="text-xl font-bold text-blue-600">{goalStatus === 'missing' ? 'Unavailable' : formatKpiValue(displayMetric, goal)}</p>
              </div>
              <div className="rounded-lg border border-purple-200/60 bg-gradient-to-br from-purple-50 to-purple-100/50 p-3 dark:border-purple-800/50 dark:from-purple-950/60 dark:to-purple-900/20">
                <p className="text-xs text-muted-foreground mb-1">{mbpl ? 'Imported Actual' : `Current ${metricLabel}`}</p>
                <p className="text-xl font-bold text-purple-600">{formatKpiValue(displayMetric, totalProduction)}</p>
              </div>
              <div className="rounded-lg border border-orange-200/60 bg-gradient-to-br from-orange-50 to-orange-100/50 p-3 dark:border-orange-800/50 dark:from-orange-950/60 dark:to-orange-900/20">
                <p className="text-xs text-muted-foreground mb-1">Remaining to Goal</p>
                <p className="text-xl font-bold text-orange-600">{formatKpiValue(displayMetric, remainingGoal)}</p>
              </div>
              <div className="rounded-lg border border-green-200/60 bg-gradient-to-br from-green-50 to-green-100/50 p-3 dark:border-green-800/50 dark:from-green-950/60 dark:to-green-900/20">
                <p className="text-xs text-muted-foreground mb-1">{fallbackPeriodLabel ? `Records (${fallbackPeriodLabel})` : 'Records in Range'}</p>
                <p className="text-xl font-bold text-green-600">{entriesCount}</p>
              </div>
            </div>
          )}

          {/* Collector Stats */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground">Collector Performance</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <div className="bg-muted/50 rounded p-2">
                <p className="text-xs text-muted-foreground">Excellent (100%+)</p>
                <p className="font-bold text-lg">{performanceDistribution.excellent}</p>
              </div>
              <div className="bg-muted/50 rounded p-2">
                <p className="text-xs text-muted-foreground">Good (80-99%)</p>
                <p className="font-bold text-lg">{performanceDistribution.good}</p>
              </div>
              <div className="bg-muted/50 rounded p-2">
                <p className="text-xs text-muted-foreground">Average (50-79%)</p>
                <p className="font-bold text-lg">{performanceDistribution.average}</p>
              </div>
              <div className="bg-muted/50 rounded p-2">
                <p className="text-xs text-muted-foreground">Needs Work (&lt;50%)</p>
                <p className="font-bold text-lg">{performanceDistribution.needsImprovement}</p>
              </div>
            </div>
          </div>

          {/* Top/Bottom Performers */}
          <div className="grid grid-cols-2 gap-3">
            {performerStats.topPerformer && (
              <div className="rounded-lg border border-green-200/50 bg-green-50/50 p-3 dark:border-green-800/50 dark:bg-green-950/30">
                <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-green-600" />
                  Top Performer
                </p>
                <p className="font-semibold text-sm truncate">{performerStats.topPerformer.agent.name}</p>
                <p className="text-xs text-muted-foreground">{performerStats.topPerformer.progress.toFixed(0)}% of target</p>
              </div>
            )}
            {performerStats.bottomPerformer && performerStats.bottomPerformer.agent.id && (
              <div className="rounded-lg border border-amber-200/50 bg-amber-50/50 p-3 dark:border-amber-800/50 dark:bg-amber-950/30">
                <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 text-amber-600" />
                  Lowest Performer
                </p>
                <p className="font-semibold text-sm truncate">{performerStats.bottomPerformer.agent.name}</p>
                <p className="text-xs text-muted-foreground">{performerStats.bottomPerformer.progress.toFixed(0)}% of target</p>
              </div>
            )}
          </div>

          {/* Collector Expandable Section */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => setCollectorsExpanded(!collectorsExpanded)}
                className="flex-1 flex items-center justify-between p-3 hover:bg-muted/50 rounded-lg transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <ChevronDown
                    className={cn(
                      'w-4 h-4 text-muted-foreground transition-transform',
                      collectorsExpanded && 'rotate-180'
                    )}
                  />
                  <span className="font-semibold text-sm">View Collector Details ({filteredAgents.length})</span>
                </div>
                <span className="text-xs text-muted-foreground">{agents.length} total</span>
              </button>
              {onDeleteAllAgents && agents.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={onDeleteAllAgents}
                  disabled={isDeletingAgents}
                  title="Delete all agents in this campaign"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  {isDeletingAgents ? 'Deleting...' : 'Delete All'}
                </Button>
              )}
            </div>

            {collectorsExpanded && (
              <div className="mt-3 space-y-3">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search collectors..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      onCollectorSearch?.(e.target.value);
                    }}
                    className="pl-8 h-8 text-sm"
                  />
                </div>

                {/* Collector Table via Children */}
                {children}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
