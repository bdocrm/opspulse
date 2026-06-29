'use client';

import { Dispatch, SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageTitle } from '@/components/layout/page-title';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast-provider';
import { AlertCircle, ArchiveRestore, ArrowUpDown, CheckCircle, ChevronDown, ChevronUp, Download, Eye, Loader2, Pencil, Search, Trash2 } from 'lucide-react';

interface Campaign {
  id: string;
  campaignName: string;
  kpiMetric: string;
  monthlyGoal: number;
  workingDays: number;
  daysLapsed: number;
  mtd: number;
  achievement: number;
  runRate: number;
  rrAchievement: number;
  updatedAt?: string;
  hasMonthlyConfig?: boolean;
  users: Array<{
    id: string;
    name: string;
    seatNumber: number;
    monthlyTarget: number | null;
  }>;
}

type AchievementStatus = 'all' | 'above' | 'below' | 'at-risk';
type SortKey = 'campaignName' | 'kpiMetric' | 'monthlyGoal' | 'mtd' | 'achievement' | 'runRate' | 'rrAchievement';
type SortDirection = 'asc' | 'desc';

interface SavedGoal {
  campaignId: string;
  campaignName: string;
  month: number;
  year: number;
  monthlyGoal: number;
  kpiMetric: string;
  workingDays: number;
  daysLapsed: number;
  updatedAt: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  restoredAt?: string | null;
  restoredBy?: string | null;
}

type GoalKey = {
  campaignId: string;
  month: number;
  year: number;
};

type ConfirmAction =
  | { type: 'restore'; items: GoalKey[] }
  | { type: 'permanent-delete'; items: GoalKey[] };

const KPI_METRICS = [
  { value: 'transmittals', label: 'Transmittals' },
  { value: 'approvals', label: 'Approvals' },
  { value: 'booked', label: 'Booked' },
  { value: 'activations', label: 'Activations' },
  { value: 'volume', label: 'Volume' },
  { value: 'transaction', label: 'Transaction' },
  { value: 'qualityRate', label: 'Quality Rate' },
  { value: 'conversionRate', label: 'Conversion Rate' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const metricLabel = (value: string) =>
  KPI_METRICS.find((m) => m.value === value)?.label || value;

const formatNumber = (value: number) =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });

const stripNumberFormatting = (value: string) => value.replace(/,/g, '');

const formatInputNumber = (value: string | number, fractionDigits?: number) => {
  const raw = stripNumberFormatting(String(value ?? ''));
  if (raw === '') return '';
  const n = Number(raw);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits ?? 2,
  });
};

const normalizeNumericInput = (value: string) => value.replace(/[^\d.]/g, '');

const formatPct = (value: number) => `${Number(value || 0).toFixed(1)}%`;

const statusForCampaign = (campaign: Campaign): AchievementStatus => {
  if (campaign.achievement >= 100) return 'above';
  if (campaign.rrAchievement < 90 || campaign.achievement < 75) return 'at-risk';
  return 'below';
};

const statusLabel = (status: AchievementStatus) => {
  if (status === 'above') return 'Above Goal';
  if (status === 'at-risk') return 'At Risk';
  if (status === 'below') return 'Below Goal';
  return 'All';
};

const statusClass = (status: AchievementStatus) => {
  if (status === 'above') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'at-risk') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
};

const dashboardExportRows = (rows: Campaign[]) =>
  rows.map((row) => ({
    Campaign: row.campaignName,
    'KPI Metric': metricLabel(row.kpiMetric),
    Goal: Number(row.monthlyGoal || 0),
    MTD: Number(row.mtd || 0),
    'Achievement %': Number(row.achievement || 0).toFixed(1),
    'Run Rate': Number(row.runRate || 0),
    'RR Achievement %': Number(row.rrAchievement || 0).toFixed(1),
    Status: statusLabel(statusForCampaign(row)),
    'Last Updated': row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '',
  }));

const goalKey = (item: GoalKey) => `${item.campaignId}:${item.year}:${item.month}`;

const savedGoalKey = (row: SavedGoal) =>
  goalKey({ campaignId: row.campaignId, month: row.month, year: row.year });

const parseGoalKey = (key: string): GoalKey => {
  const [campaignId, year, month] = key.split(':');
  return { campaignId, year: Number(year), month: Number(month) };
};

export default function GoalsManagement() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { addToast } = useToast();
  const user = session?.user as any;

  const now = new Date();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1); // 1-12, defaults to current month
  const [selectedYear] = useState<number>(now.getFullYear());
  const [savedGoals, setSavedGoals] = useState<SavedGoal[]>([]);
  const [deletedGoals, setDeletedGoals] = useState<SavedGoal[]>([]);
  // When editing a saved row from another month, remember which campaign to
  // re-select after the month-change effect reloads the campaign list.
  const [pendingCampaignId, setPendingCampaignId] = useState<string | null>(null);
  // Top of the editor — scrolled into view when "Edit" is pressed on a saved row.
  const editorRef = useRef<HTMLDivElement>(null);

  // Campaign-level fields
  const [monthlyGoal, setMonthlyGoal] = useState('');
  const [kpiMetric, setKpiMetric] = useState('');
  const [workingDays, setWorkingDays] = useState('22');
  const [daysLapsed, setDaysLapsed] = useState('0');

  const [agentTarget, setAgentTarget] = useState<Record<string, number>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [metricFilter, setMetricFilter] = useState('all');
  const [achievementStatus, setAchievementStatus] = useState<AchievementStatus>('all');
  const [goalMin, setGoalMin] = useState('');
  const [goalMax, setGoalMax] = useState('');
  const [achievementMin, setAchievementMin] = useState('');
  const [achievementMax, setAchievementMax] = useState('');
  const [rrMin, setRrMin] = useState('');
  const [rrMax, setRrMax] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('campaignName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [rowsPerPage, setRowsPerPage] = useState('25');
  const [currentPage, setCurrentPage] = useState(1);
  const [dashboardExpanded, setDashboardExpanded] = useState(true);
  const [selectCampaignExpanded, setSelectCampaignExpanded] = useState(true);
  const [campaignGoalExpanded, setCampaignGoalExpanded] = useState(true);
  const [agentTargetsExpanded, setAgentTargetsExpanded] = useState(false);
  const [savedGoalsExpanded, setSavedGoalsExpanded] = useState(false);
  const [trashExpanded, setTrashExpanded] = useState(false);
  const [agentTargetSearch, setAgentTargetSearch] = useState('');
  const [selectedDeletedGoalKeys, setSelectedDeletedGoalKeys] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [processingAction, setProcessingAction] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated' && !['CEO', 'OM'].includes(user?.role)) {
      router.push('/dashboard');
    }
  }, [status, user?.role, router]);

  useEffect(() => {
    const stored = window.localStorage.getItem('goals-management-expanded-sections');
    if (!stored) return;

    try {
      const parsed = JSON.parse(stored);
      if (typeof parsed.dashboard === 'boolean') setDashboardExpanded(parsed.dashboard);
      if (typeof parsed.selectCampaign === 'boolean') setSelectCampaignExpanded(parsed.selectCampaign);
      if (typeof parsed.campaignGoal === 'boolean') setCampaignGoalExpanded(parsed.campaignGoal);
      if (typeof parsed.agentTargets === 'boolean') setAgentTargetsExpanded(parsed.agentTargets);
      if (typeof parsed.savedGoals === 'boolean') setSavedGoalsExpanded(parsed.savedGoals);
      if (typeof parsed.trash === 'boolean') setTrashExpanded(parsed.trash);
    } catch {
      window.localStorage.removeItem('goals-management-expanded-sections');
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      'goals-management-expanded-sections',
      JSON.stringify({
        dashboard: dashboardExpanded,
        selectCampaign: selectCampaignExpanded,
        campaignGoal: campaignGoalExpanded,
        agentTargets: agentTargetsExpanded,
        savedGoals: savedGoalsExpanded,
        trash: trashExpanded,
      })
    );
  }, [
    dashboardExpanded,
    selectCampaignExpanded,
    campaignGoalExpanded,
    agentTargetsExpanded,
    savedGoalsExpanded,
    trashExpanded,
  ]);

  const loadCampaigns = async (month: number, year: number, keepId?: string) => {
    try {
      const res = await fetch(`/api/goals?month=${month}&year=${year}`);
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data);
        const toSelect = keepId ? data.find((c: Campaign) => c.id === keepId) : data[0];
        if (toSelect) {
          applySelectedCampaign(toSelect);
        } else {
          setSelectedCampaign(null);
        }
      }
    } catch {
      setError('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const loadSavedGoals = async () => {
    try {
      const [activeRes, trashRes] = await Promise.all([
        fetch('/api/goals/saved'),
        fetch('/api/goals/saved?trash=1'),
      ]);
      if (activeRes.ok) setSavedGoals(await activeRes.json());
      if (trashRes.ok) setDeletedGoals(await trashRes.json());
    } catch {
      /* non-critical: the saved list is informational */
    }
  };

  // Load the goal configuration for the selected campaign + month. Re-runs when
  // the month or year changes, preserving the currently selected campaign (or
  // re-selecting a campaign requested via the saved-goals "Edit" action).
  useEffect(() => {
    if (status === 'authenticated') {
      const keepId = pendingCampaignId ?? selectedCampaign?.id;
      loadCampaigns(selectedMonth, selectedYear, keepId).then(() => {
        if (pendingCampaignId) setPendingCampaignId(null);
      });
      loadSavedGoals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, selectedMonth, selectedYear]);

  // Load a saved goal record into the form for editing. If it belongs to a
  // different month, switch the month (the effect reloads + re-selects it).
  const handleEditSaved = (row: SavedGoal) => {
    if (row.month === selectedMonth && row.year === selectedYear) {
      const c = campaigns.find((c) => c.id === row.campaignId);
      if (c) applySelectedCampaign(c);
    } else {
      setPendingCampaignId(row.campaignId);
      setSelectedMonth(row.month);
    }
    // Bring the editor into view — the saved list sits below the form, so without
    // this the form updates off-screen and the click appears to do nothing.
    setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  function applySelectedCampaign(campaign: Campaign) {
    setSelectedCampaign(campaign);
    setMonthlyGoal(formatInputNumber(campaign.monthlyGoal, 2));
    setKpiMetric(campaign.kpiMetric || 'transmittals');
    setWorkingDays((campaign.workingDays ?? 22).toString());
    setDaysLapsed((campaign.daysLapsed ?? 0).toString());
    const targets: Record<string, number> = {};
    campaign.users.forEach((u) => { targets[u.id] = u.monthlyTarget || 0; });
    setAgentTarget(targets);
    setMessage('');
    setError('');
  }

  const handleCampaignChange = (campaign: Campaign) => applySelectedCampaign(campaign);

  const handleSaveCampaignGoal = async () => {
    if (!selectedCampaign || !monthlyGoal) {
      setError('Monthly goal is required');
      return;
    }
    if (!selectedMonth) {
      setError('Please select a month before saving.');
      return;
    }

    setSaving(true);
    setMessage('');
    setError('');

    try {
      const res = await fetch('/api/goals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: selectedCampaign.id,
          month: selectedMonth,
          year: selectedYear,
          monthlyGoal: Number(stripNumberFormatting(monthlyGoal)),
          kpiMetric,
          workingDays: Number(workingDays) || 22,
          daysLapsed: Number(daysLapsed) || 0,
        }),
      });

      if (res.ok) {
        // Reload the saved month's configuration, keeping this campaign selected.
        // (loadCampaigns → applySelectedCampaign resets message/error, so set the
        // success message AFTER the reload, not before, or it gets cleared.)
        await loadCampaigns(selectedMonth, selectedYear, selectedCampaign.id);
        await loadSavedGoals();
        setMessage(`Goals for ${MONTHS[selectedMonth - 1]} ${selectedYear} saved successfully`);
        addToast('success', `Goals for ${MONTHS[selectedMonth - 1]} ${selectedYear} saved successfully`);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update goal');
        addToast('error', data.error || 'Failed to update goal');
      }
    } catch {
      setError('Failed to save campaign settings');
      addToast('error', 'Failed to save campaign settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAgentTarget = async (userId: string) => {
    const target = agentTarget[userId];
    if (target === undefined || target === null) {
      setError('Target value is required');
      return;
    }
    if (!selectedCampaign) {
      setError('Select a campaign first');
      return;
    }

    setSaving(true);
    setMessage('');
    setError('');

    try {
      const res = await fetch('/api/goals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          campaignId: selectedCampaign.id,
          monthlyTarget: Number(target),
        }),
      });

      if (res.ok) {
        setMessage('Agent target updated successfully');
        addToast('success', 'Agent target updated successfully');
        if (selectedCampaign) {
          const updated = { ...selectedCampaign };
          const agent = updated.users.find((u) => u.id === userId);
          if (agent) agent.monthlyTarget = Number(target);
          setSelectedCampaign(updated);
        }
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update agent target');
        addToast('error', data.error || 'Failed to update agent target');
      }
    } catch {
      setError('Failed to save agent target');
      addToast('error', 'Failed to save agent target');
    } finally {
      setSaving(false);
    }
  };

  const refreshGoalData = async () => {
    await Promise.all([
      loadCampaigns(selectedMonth, selectedYear, selectedCampaign?.id),
      loadSavedGoals(),
    ]);
  };

  const toggleKey = (setState: Dispatch<SetStateAction<Set<string>>>, key: string) => {
    setState((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setAllKeys = (
    setState: Dispatch<SetStateAction<Set<string>>>,
    keys: string[],
    checked: boolean
  ) => {
    setState((current) => {
      const next = new Set(current);
      keys.forEach((key) => {
        if (checked) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  };

  const executeConfirmAction = async () => {
    if (!confirmAction) return;

    setProcessingAction(true);
    try {
      const method = confirmAction.type === 'restore' ? 'PATCH' : 'DELETE';
      const res = await fetch('/api/goals/saved', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: confirmAction.items,
          permanent: confirmAction.type === 'permanent-delete',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');

      const affected = Number(data.count || 0);
      if (confirmAction.type === 'restore') {
        addToast('success', `Restored ${affected} goal configuration(s)`);
        setSelectedDeletedGoalKeys(new Set());
      } else if (confirmAction.type === 'permanent-delete') {
        addToast('success', `Permanently deleted ${affected} goal configuration(s)`);
        setSelectedDeletedGoalKeys(new Set());
      }

      setConfirmAction(null);
      await refreshGoalData();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Action failed';
      addToast('error', message);
    } finally {
      setProcessingAction(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    campaignFilter,
    metricFilter,
    achievementStatus,
    goalMin,
    goalMax,
    achievementMin,
    achievementMax,
    rrMin,
    rrMax,
    rowsPerPage,
  ]);

  const sortedFilteredCampaigns = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    const minGoal = goalMin === '' ? null : Number(stripNumberFormatting(goalMin));
    const maxGoal = goalMax === '' ? null : Number(stripNumberFormatting(goalMax));
    const minAchievement = achievementMin === '' ? null : Number(stripNumberFormatting(achievementMin));
    const maxAchievement = achievementMax === '' ? null : Number(stripNumberFormatting(achievementMax));
    const minRunRate = rrMin === '' ? null : Number(stripNumberFormatting(rrMin));
    const maxRunRate = rrMax === '' ? null : Number(stripNumberFormatting(rrMax));

    return campaigns
      .filter((campaign) => {
        if (campaignFilter !== 'all' && campaign.id !== campaignFilter) return false;
        if (metricFilter !== 'all' && campaign.kpiMetric !== metricFilter) return false;
        if (achievementStatus !== 'all' && statusForCampaign(campaign) !== achievementStatus) return false;
        if (search && !`${campaign.campaignName} ${metricLabel(campaign.kpiMetric)}`.toLowerCase().includes(search)) return false;
        if (minGoal !== null && campaign.monthlyGoal < minGoal) return false;
        if (maxGoal !== null && campaign.monthlyGoal > maxGoal) return false;
        if (minAchievement !== null && campaign.achievement < minAchievement) return false;
        if (maxAchievement !== null && campaign.achievement > maxAchievement) return false;
        if (minRunRate !== null && campaign.rrAchievement < minRunRate) return false;
        if (maxRunRate !== null && campaign.rrAchievement > maxRunRate) return false;
        return true;
      })
      .sort((a, b) => {
        const aValue = sortKey === 'kpiMetric' ? metricLabel(a.kpiMetric) : a[sortKey];
        const bValue = sortKey === 'kpiMetric' ? metricLabel(b.kpiMetric) : b[sortKey];
        const result =
          typeof aValue === 'string' || typeof bValue === 'string'
            ? String(aValue).localeCompare(String(bValue))
            : Number(aValue) - Number(bValue);
        return sortDirection === 'asc' ? result : -result;
      });
  }, [
    campaigns,
    searchQuery,
    campaignFilter,
    metricFilter,
    achievementStatus,
    goalMin,
    goalMax,
    achievementMin,
    achievementMax,
    rrMin,
    rrMax,
    sortKey,
    sortDirection,
  ]);

  const summary = useMemo(() => {
    const totalCampaigns = sortedFilteredCampaigns.length;
    const totalGoal = sortedFilteredCampaigns.reduce((sum, c) => sum + (c.monthlyGoal || 0), 0);
    const totalMTD = sortedFilteredCampaigns.reduce((sum, c) => sum + (c.mtd || 0), 0);
    const avgAchievement =
      totalCampaigns > 0
        ? sortedFilteredCampaigns.reduce((sum, c) => sum + (c.achievement || 0), 0) / totalCampaigns
        : 0;
    const avgRunRate =
      totalCampaigns > 0
        ? sortedFilteredCampaigns.reduce((sum, c) => sum + (c.rrAchievement || 0), 0) / totalCampaigns
        : 0;
    const aboveGoal = sortedFilteredCampaigns.filter((c) => statusForCampaign(c) === 'above').length;
    const belowGoal = sortedFilteredCampaigns.filter((c) => statusForCampaign(c) === 'below').length;

    return { totalCampaigns, totalGoal, totalMTD, avgAchievement, avgRunRate, aboveGoal, belowGoal };
  }, [sortedFilteredCampaigns]);

  const totalPages =
    rowsPerPage === 'all'
      ? 1
      : Math.max(1, Math.ceil(sortedFilteredCampaigns.length / Number(rowsPerPage)));
  const paginatedCampaigns =
    rowsPerPage === 'all'
      ? sortedFilteredCampaigns
      : sortedFilteredCampaigns.slice((currentPage - 1) * Number(rowsPerPage), currentPage * Number(rowsPerPage));

  const deletedGoalKeys = deletedGoals.map(savedGoalKey);
  const allDeletedSelected =
    deletedGoalKeys.length > 0 && deletedGoalKeys.every((key) => selectedDeletedGoalKeys.has(key));

  const filteredCampaignAgents = useMemo(() => {
    if (!selectedCampaign) return [];
    const search = agentTargetSearch.trim().toLowerCase();
    if (!search) return selectedCampaign.users;
    return selectedCampaign.users.filter((agent) =>
      `${agent.name} ${agent.seatNumber ?? ''}`.toLowerCase().includes(search)
    );
  }, [agentTargetSearch, selectedCampaign]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const exportCampaignRows = (rows: Campaign[], format: 'csv' | 'xlsx') => {
    const exportRows = dashboardExportRows(rows);
    const suffix = `${MONTHS[selectedMonth - 1]}-${selectedYear}`.replace(/\s+/g, '-').toLowerCase();
    if (format === 'xlsx') {
      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Targets');
      XLSX.writeFile(workbook, `target-dashboard-${suffix}.xlsx`);
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `target-dashboard-${suffix}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const wDays = Number(workingDays) || 22;
  const dLapsed = Number(daysLapsed) || 0;
  const goal = Number(stripNumberFormatting(monthlyGoal)) || 0;
  const weekGoal = goal > 0 ? Math.round(goal / 4) : 0;

  // Preview KPI formulas with placeholder MTD
  const previewMTD = goal > 0 ? Math.round(goal * (dLapsed / Math.max(wDays, 1))) : 0;
  const previewRR = dLapsed > 0 ? Math.round((previewMTD / dLapsed) * wDays) : 0;
  const previewAch = goal > 0 ? ((previewMTD / goal) * 100).toFixed(1) : '0.0';
  const previewRRAch = goal > 0 ? ((previewRR / goal) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-6" ref={editorRef}>
      <PageTitle title="Goals Management" subtitle="Configure campaign goals and run rate parameters" />

      {error && (
        <div className="flex gap-3 bg-red-50 border border-red-200 rounded-lg p-4 items-start">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {message && (
        <div className="flex gap-3 bg-green-50 border border-green-200 rounded-lg p-4 items-start">
          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-700">{message}</p>
        </div>
      )}

      {/* Executive Target Dashboard */}
      <Card className="border-slate-200 bg-slate-50/80 p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">Executive Target Dashboard</h3>
            <p className="text-sm text-slate-500">
              All campaign targets and live performance for {MONTHS[selectedMonth - 1]} {selectedYear}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDashboardExpanded((expanded) => !expanded)}
              className="gap-2 border-blue-200 bg-white text-blue-700 shadow-sm hover:bg-blue-50"
              aria-expanded={dashboardExpanded}
              aria-controls="executive-target-dashboard-panel"
            >
              {dashboardExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              {dashboardExpanded ? 'Collapse Dashboard' : 'Expand Dashboard'}
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => exportCampaignRows(campaigns, 'xlsx')}>
              <Download className="h-4 w-4" />
              All XLSX
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => exportCampaignRows(campaigns, 'csv')}>
              <Download className="h-4 w-4" />
              All CSV
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => exportCampaignRows(sortedFilteredCampaigns, 'xlsx')}>
              <Download className="h-4 w-4" />
              Filtered XLSX
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => exportCampaignRows(sortedFilteredCampaigns, 'csv')}>
              <Download className="h-4 w-4" />
              Filtered CSV
            </Button>
          </div>
        </div>

        <div
          id="executive-target-dashboard-panel"
          className={`grid transition-all duration-300 ease-in-out ${
            dashboardExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
              {[
                ['Total Campaigns', summary.totalCampaigns.toLocaleString()],
                ['Total Goal', formatNumber(summary.totalGoal)],
                ['Total MTD', formatNumber(summary.totalMTD)],
                ['Avg Achievement', formatPct(summary.avgAchievement)],
                ['Avg RR Ach.', formatPct(summary.avgRunRate)],
                ['Above Goal', summary.aboveGoal.toLocaleString()],
                ['Below Goal', summary.belowGoal.toLocaleString()],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                  <p className="text-xs font-medium text-slate-500">{label}</p>
                  <p className="mt-1 text-xl font-bold text-slate-950">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search campaign or KPI..."
                  className="pl-8"
                />
              </div>
              <select
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">All Campaigns</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>{campaign.campaignName}</option>
                ))}
              </select>
              <select
                value={metricFilter}
                onChange={(e) => setMetricFilter(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">All KPI Metrics</option>
                {KPI_METRICS.map((metric) => (
                  <option key={metric.value} value={metric.value}>{metric.label}</option>
                ))}
              </select>
              <select
                value={achievementStatus}
                onChange={(e) => setAchievementStatus(e.target.value as AchievementStatus)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">All Statuses</option>
                <option value="above">Above Goal</option>
                <option value="below">Below Goal</option>
                <option value="at-risk">At Risk</option>
              </select>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Input inputMode="decimal" value={goalMin} onChange={(e) => setGoalMin(normalizeNumericInput(e.target.value))} onBlur={() => setGoalMin(formatInputNumber(goalMin))} placeholder="Goal min" />
              <Input inputMode="decimal" value={goalMax} onChange={(e) => setGoalMax(normalizeNumericInput(e.target.value))} onBlur={() => setGoalMax(formatInputNumber(goalMax))} placeholder="Goal max" />
              <Input inputMode="decimal" value={achievementMin} onChange={(e) => setAchievementMin(normalizeNumericInput(e.target.value))} onBlur={() => setAchievementMin(formatInputNumber(achievementMin))} placeholder="Achievement % min" />
              <Input inputMode="decimal" value={achievementMax} onChange={(e) => setAchievementMax(normalizeNumericInput(e.target.value))} onBlur={() => setAchievementMax(formatInputNumber(achievementMax))} placeholder="Achievement % max" />
              <Input inputMode="decimal" value={rrMin} onChange={(e) => setRrMin(normalizeNumericInput(e.target.value))} onBlur={() => setRrMin(formatInputNumber(rrMin))} placeholder="RR Achievement % min" />
              <Input inputMode="decimal" value={rrMax} onChange={(e) => setRrMax(normalizeNumericInput(e.target.value))} onBlur={() => setRrMax(formatInputNumber(rrMax))} placeholder="RR Achievement % max" />
            </div>

            <div className="mt-5 overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    {[
                  ['campaignName', 'Campaign'],
                  ['kpiMetric', 'KPI Metric'],
                  ['monthlyGoal', 'Goal'],
                  ['mtd', 'MTD'],
                  ['achievement', 'Achievement'],
                  ['runRate', 'Run Rate'],
                  ['rrAchievement', 'RR Achievement %'],
                ].map(([key, label]) => (
                  <th key={key} className="px-3 py-3 font-semibold">
                    <button className="inline-flex items-center gap-1" onClick={() => handleSort(key as SortKey)}>
                      {label}
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </th>
                ))}
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Last Updated</th>
                <th className="px-3 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-gray-500">No target records match the selected filters.</td>
                </tr>
              ) : (
                paginatedCampaigns.map((campaign) => {
                  const rowStatus = statusForCampaign(campaign);
                  return (
                    <tr key={campaign.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-3 font-medium text-gray-900">{campaign.campaignName}</td>
                      <td className="px-3 py-3">{metricLabel(campaign.kpiMetric)}</td>
                      <td className="px-3 py-3 text-right">{formatNumber(campaign.monthlyGoal)}</td>
                      <td className="px-3 py-3 text-right">{formatNumber(campaign.mtd)}</td>
                      <td className="px-3 py-3 text-right">{formatPct(campaign.achievement)}</td>
                      <td className="px-3 py-3 text-right">{formatNumber(campaign.runRate)}</td>
                      <td className="px-3 py-3 text-right">{formatPct(campaign.rrAchievement)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(rowStatus)}`}>
                          {statusLabel(rowStatus)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-500">
                        {campaign.updatedAt ? new Date(campaign.updatedAt).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1"
                            onClick={() => applySelectedCampaign(campaign)}
                          >
                            <Eye className="h-4 w-4" />
                            View
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            onClick={() => {
                              applySelectedCampaign(campaign);
                              setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-500">
                Showing {paginatedCampaigns.length} of {sortedFilteredCampaigns.length} filtered records
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={rowsPerPage}
                  onChange={(e) => setRowsPerPage(e.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="25">25 rows</option>
                  <option value="50">50 rows</option>
                  <option value="100">100 rows</option>
                  <option value="all">Show all</option>
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                >
                  Previous
                </Button>
                <span className="text-sm text-gray-500">Page {Math.min(currentPage, totalPages)} of {totalPages}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages || rowsPerPage === 'all'}
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Campaign Selection */}
      <Card className="p-6">
        <button
          type="button"
          onClick={() => setSelectCampaignExpanded((expanded) => !expanded)}
          className="flex w-full flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between"
          aria-expanded={selectCampaignExpanded}
          aria-controls="select-campaign-panel"
        >
          <h3 className="text-lg font-semibold">Select Campaign</h3>
          <span className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700">
            {selectCampaignExpanded ? (
              <>
                <ChevronUp className="h-5 w-5" />
                Collapse Campaigns
              </>
            ) : (
              <>
                <ChevronDown className="h-5 w-5" />
                Expand Campaigns
              </>
            )}
          </span>
        </button>
        <div
          id="select-campaign-panel"
          className={`grid transition-all duration-300 ease-in-out ${
            selectCampaignExpanded ? 'mt-4 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="min-h-0 overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {campaigns.map((campaign) => (
            <button
              key={campaign.id}
              onClick={() => handleCampaignChange(campaign)}
              className={`p-3 rounded-lg border-2 text-sm font-medium transition-all ${
                selectedCampaign?.id === campaign.id
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              }`}
            >
              {campaign.campaignName}
            </button>
          ))}
        </div>

        {/* Month selector — goals are configured per Campaign + Month */}
        <div className="mt-6 max-w-xs">
          <Label htmlFor="month">Month</Label>
          <select
            id="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m} {selectedYear}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">
            Each campaign keeps independent goals per month.
          </p>
        </div>
          </div>
        </div>
      </Card>

      {selectedCampaign && (
        <>
          {/* Campaign Goal & Run Rate Config */}
          <Card className="p-6">
            <button
              type="button"
              onClick={() => setCampaignGoalExpanded((expanded) => !expanded)}
              className="flex w-full flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between"
              aria-expanded={campaignGoalExpanded}
              aria-controls="campaign-goal-panel"
            >
              <h3 className="text-lg font-semibold">Campaign Goal &amp; Run Rate Settings</h3>
              <span className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700">
                {campaignGoalExpanded ? (
                  <>
                    <ChevronUp className="h-5 w-5" />
                    Collapse Settings
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-5 w-5" />
                    Expand Settings
                  </>
                )}
              </span>
            </button>
            <div
              id="campaign-goal-panel"
              className={`grid transition-all duration-300 ease-in-out ${
                campaignGoalExpanded ? 'mt-4 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="min-h-0 overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              {/* KPI Metric */}
              <div>
                <Label htmlFor="kpi">KPI Metric</Label>
                <select
                  id="kpi"
                  value={kpiMetric}
                  onChange={(e) => setKpiMetric(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {KPI_METRICS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              {/* Monthly Goal */}
              <div>
                <Label htmlFor="monthly-goal">Monthly Goal</Label>
                <Input
                  id="monthly-goal"
                  inputMode="decimal"
                  value={monthlyGoal}
                  onChange={(e) => setMonthlyGoal(normalizeNumericInput(e.target.value))}
                  onBlur={(e) => {
                    const n = Number(stripNumberFormatting(e.target.value));
                    if (e.target.value !== '' && !Number.isNaN(n)) setMonthlyGoal(formatInputNumber(n, 2));
                  }}
                  placeholder="e.g. 1,000.00"
                  className="mt-1"
                />
              </div>

              {/* Working Days */}
              <div>
                <Label htmlFor="working-days">
                  Working Days (WDays)
                  <span className="ml-1 text-xs text-gray-400 font-normal">— total working days this month</span>
                </Label>
                <Input
                  id="working-days"
                  type="number"
                  min={1}
                  max={31}
                  value={workingDays}
                  onChange={(e) => setWorkingDays(e.target.value)}
                  placeholder="22"
                  className="mt-1"
                />
              </div>

              {/* Days Lapsed */}
              <div>
                <Label htmlFor="days-lapsed">
                  Days Lapsed
                  <span className="ml-1 text-xs text-gray-400 font-normal">— working days elapsed so far</span>
                </Label>
                <Input
                  id="days-lapsed"
                  type="number"
                  min={0}
                  max={31}
                  value={daysLapsed}
                  onChange={(e) => setDaysLapsed(e.target.value)}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
            </div>

            {/* Weekly breakdown (read-only preview) */}
            <div className="mt-4">
              <Label>Weekly Goal Breakdown (Monthly Goal ÷ 4 weeks)</Label>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {['W1', 'W2', 'W3', 'W4'].map((week) => (
                  <div
                    key={week}
                    className="group relative bg-blue-50 border border-blue-200 rounded p-3 text-center cursor-help"
                  >
                    <div className="text-xs font-medium text-blue-600">{week}</div>
                    <div className="text-lg font-bold text-blue-900 mt-1">
                      {weekGoal.toLocaleString()}
                    </div>
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-[240px] -translate-x-1/2 whitespace-normal rounded-md bg-gray-900 px-3 py-2 text-xs font-normal text-white shadow-lg group-hover:block">
                      {`${week} = Monthly Goal ÷ 4 = ${goal.toLocaleString()} ÷ 4 = ${weekGoal.toLocaleString()}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Formula preview */}
            <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Formula Preview (on-pace estimate)</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm">
                <div className="group relative cursor-help">
                  <p className="text-xs text-gray-400">MTD (on pace)</p>
                  <p className="text-lg font-bold text-gray-800">{previewMTD.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">sum W1–W4</p>
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-[240px] -translate-x-1/2 whitespace-normal rounded-md bg-gray-900 px-3 py-2 text-xs font-normal text-white shadow-lg group-hover:block">
                    {`MTD (on pace) = Goal × (Days Lapsed ÷ WDays) = ${goal.toLocaleString()} × (${dLapsed} ÷ ${wDays}) = ${previewMTD.toLocaleString()}`}
                  </div>
                </div>
                <div className="group relative cursor-help">
                  <p className="text-xs text-gray-400">Achievement</p>
                  <p className="text-lg font-bold text-blue-700">{previewAch}%</p>
                  <p className="text-xs text-gray-400">MTD / Goal</p>
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-[240px] -translate-x-1/2 whitespace-normal rounded-md bg-gray-900 px-3 py-2 text-xs font-normal text-white shadow-lg group-hover:block">
                    {`Achievement = MTD ÷ Goal × 100 = ${previewMTD.toLocaleString()} ÷ ${goal.toLocaleString()} × 100 = ${previewAch}%`}
                  </div>
                </div>
                <div className="group relative cursor-help">
                  <p className="text-xs text-gray-400">Run Rate</p>
                  <p className="text-lg font-bold text-gray-800">{previewRR.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">MTD / Lapsed × WDays</p>
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-[240px] -translate-x-1/2 whitespace-normal rounded-md bg-gray-900 px-3 py-2 text-xs font-normal text-white shadow-lg group-hover:block">
                    {`Run Rate = MTD ÷ Days Lapsed × WDays = ${previewMTD.toLocaleString()} ÷ ${dLapsed} × ${wDays} = ${previewRR.toLocaleString()}`}
                  </div>
                </div>
                <div className="group relative cursor-help">
                  <p className="text-xs text-gray-400">RR Achievement</p>
                  <p className="text-lg font-bold text-blue-700">{previewRRAch}%</p>
                  <p className="text-xs text-gray-400">Run Rate / Goal</p>
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-[240px] -translate-x-1/2 whitespace-normal rounded-md bg-gray-900 px-3 py-2 text-xs font-normal text-white shadow-lg group-hover:block">
                    {`RR Achievement = Run Rate ÷ Goal × 100 = ${previewRR.toLocaleString()} ÷ ${goal.toLocaleString()} × 100 = ${previewRRAch}%`}
                  </div>
                </div>
              </div>
            </div>

            <Button
              onClick={handleSaveCampaignGoal}
              disabled={saving}
              className="mt-4 w-full bg-blue-600 hover:bg-blue-700"
            >
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : 'Save Campaign Settings'}
            </Button>
              </div>
            </div>
          </Card>

          {/* Agent Targets */}
          <Card className="p-6">
            <button
              type="button"
              onClick={() => setAgentTargetsExpanded((expanded) => !expanded)}
              className="flex w-full flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between"
              aria-expanded={agentTargetsExpanded}
              aria-controls="agent-targets-panel"
            >
              <h3 className="text-lg font-semibold">
                Agent Targets
                <span className="ml-2 text-sm font-normal text-gray-500">({selectedCampaign.users.length} agents)</span>
              </h3>
              <span className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700">
                {agentTargetsExpanded ? (
                  <>
                    <ChevronUp className="h-5 w-5" />
                    Collapse Agents
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-5 w-5" />
                    Expand Agents
                  </>
                )}
              </span>
            </button>

            <div
              id="agent-targets-panel"
              className={`grid transition-all duration-300 ease-in-out ${
                agentTargetsExpanded ? 'mt-4 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                {selectedCampaign.users.length === 0 ? (
                  <p className="text-sm text-gray-500">No agents assigned to this campaign</p>
                ) : (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                      <Input
                        value={agentTargetSearch}
                        onChange={(e) => setAgentTargetSearch(e.target.value)}
                        placeholder="Search agent by name or seat..."
                        className="pl-8"
                      />
                    </div>
                    {filteredCampaignAgents.length === 0 ? (
                      <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                        No agents match your search.
                      </p>
                    ) : (
                      filteredCampaignAgents.map((agent) => (
                        <div key={agent.id} className="flex flex-col gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200 sm:flex-row sm:items-end">
                          <div className="flex-1">
                            <Label className="text-xs text-gray-500">
                              {agent.seatNumber ? `Seat ${agent.seatNumber}` : 'No seat'}
                            </Label>
                            <div className="font-semibold text-gray-900">{agent.name}</div>
                          </div>
                          <div className="w-full sm:w-36">
                            <Label htmlFor={`agent-${agent.id}`} className="text-xs text-gray-500">Monthly Target</Label>
                            <Input
                              id={`agent-${agent.id}`}
                              inputMode="decimal"
                              value={formatInputNumber(agentTarget[agent.id] ?? 0)}
                              onChange={(e) => {
                                const rawValue = normalizeNumericInput(e.target.value);
                                setAgentTarget({ ...agentTarget, [agent.id]: rawValue === '' ? 0 : Number(rawValue) });
                              }}
                              className="mt-1"
                            />
                          </div>
                          <Button
                            onClick={() => handleSaveAgentTarget(agent.id)}
                            disabled={saving}
                            size="sm"
                            variant="outline"
                            className="h-10 w-full shrink-0 sm:w-auto"
                          >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Summary */}
          <Card className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
            <h3 className="font-semibold text-gray-900 mb-3">Summary</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-gray-500">Monthly Goal</div>
                <div className="text-2xl font-bold text-blue-600">{goal.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-gray-500">Total Agent Targets</div>
                <div className="text-2xl font-bold text-indigo-600">
                  {Object.values(agentTarget).reduce((s, v) => s + (v || 0), 0).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-gray-500">Working Days</div>
                <div className="text-2xl font-bold text-gray-800">{wDays}</div>
              </div>
              <div>
                <div className="text-gray-500">Days Lapsed</div>
                <div className="text-2xl font-bold text-gray-800">
                  {dLapsed}
                  <span className="text-sm font-normal text-gray-400 ml-1">/ {wDays}</span>
                </div>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Saved Campaign Goals — view all saved per-month configurations */}
      <Card className="p-6">
        <button
          type="button"
          onClick={() => setSavedGoalsExpanded((expanded) => !expanded)}
          className="flex w-full flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between"
          aria-expanded={savedGoalsExpanded}
          aria-controls="saved-campaign-goals-panel"
        >
          <h3 className="text-lg font-semibold">
            Saved Campaign Goals
            <span className="ml-2 text-sm font-normal text-gray-500">({savedGoals.length})</span>
          </h3>
          <span className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700">
            {savedGoalsExpanded ? (
              <>
                <ChevronUp className="h-5 w-5" />
                Collapse Saved Goals
              </>
            ) : (
              <>
                <ChevronDown className="h-5 w-5" />
                Expand Saved Goals
              </>
            )}
          </span>
        </button>
        <div
          id="saved-campaign-goals-panel"
          className={`grid transition-all duration-300 ease-in-out ${
            savedGoalsExpanded ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="min-h-0 overflow-hidden">
        <p className="text-sm text-gray-500 mb-4">
          All saved goal configurations by campaign and month. Click Edit to load one for changes.
        </p>
        {savedGoals.length === 0 ? (
          <p className="text-sm text-gray-500">No saved goal configurations yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4 font-medium">Campaign</th>
                  <th className="py-2 pr-4 font-medium">Month</th>
                  <th className="py-2 pr-4 font-medium">KPI Metric</th>
                  <th className="py-2 pr-4 font-medium text-right">Monthly Goal</th>
                  <th className="py-2 pr-4 font-medium text-center">WDays</th>
                  <th className="py-2 pr-4 font-medium text-center">Lapsed</th>
                  <th className="py-2 pr-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {savedGoals.map((row) => {
                  const isCurrent =
                    selectedCampaign?.id === row.campaignId &&
                    selectedMonth === row.month &&
                    selectedYear === row.year;
                  return (
                    <tr
                      key={`${row.campaignId}-${row.year}-${row.month}`}
                      className={`border-b ${isCurrent ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                    >
                      <td className="py-2 pr-4 font-medium text-gray-900">{row.campaignName}</td>
                      <td className="py-2 pr-4">{MONTHS[row.month - 1]} {row.year}</td>
                      <td className="py-2 pr-4 capitalize">{row.kpiMetric}</td>
                      <td className="py-2 pr-4 text-right">{row.monthlyGoal.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-center">{row.workingDays}</td>
                      <td className="py-2 pr-4 text-center">{row.daysLapsed}</td>
                      <td className="py-2 pr-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditSaved(row)}
                            disabled={isCurrent}
                          >
                            {isCurrent ? 'Editing' : 'Edit'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
          </div>
        </div>
      </Card>

      <Card className="p-6 border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setTrashExpanded((expanded) => !expanded)}
          className="flex w-full flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between"
          aria-expanded={trashExpanded}
          aria-controls="recently-deleted-goals-panel"
        >
          <h3 className="text-lg font-semibold text-red-600">
            Recently Deleted
            <span className="ml-2 text-sm font-normal text-red-600">({deletedGoals.length})</span>
          </h3>
          <span className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700">
            {trashExpanded ? (
              <>
                <ChevronUp className="h-5 w-5" />
                Collapse Trash
              </>
            ) : (
              <>
                <ChevronDown className="h-5 w-5" />
                Expand Trash
              </>
            )}
          </span>
        </button>
        <div
          id="recently-deleted-goals-panel"
          className={`grid transition-all duration-300 ease-in-out ${
            trashExpanded ? 'mt-4 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            {selectedDeletedGoalKeys.size > 0 && (
              <div className="mb-4 flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={processingAction}
                  onClick={() =>
                    setConfirmAction({
                      type: 'restore',
                      items: Array.from(selectedDeletedGoalKeys).map(parseGoalKey),
                    })
                  }
                >
                  <ArchiveRestore className="h-4 w-4" />
                  Restore Selected ({selectedDeletedGoalKeys.size})
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-2"
                  disabled={processingAction}
                  onClick={() =>
                    setConfirmAction({
                      type: 'permanent-delete',
                      items: Array.from(selectedDeletedGoalKeys).map(parseGoalKey),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  Permanently Delete Selected
                </Button>
              </div>
            )}
            {deletedGoals.length === 0 ? (
              <p className="text-sm text-gray-500">No deleted goal configurations.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="py-2 pr-4 font-medium">
                        <input
                          type="checkbox"
                          checked={allDeletedSelected}
                          onChange={(e) => setAllKeys(setSelectedDeletedGoalKeys, deletedGoalKeys, e.target.checked)}
                          className="h-4 w-4 cursor-pointer"
                        />
                      </th>
                      <th className="py-2 pr-4 font-medium">Campaign</th>
                      <th className="py-2 pr-4 font-medium">Month</th>
                      <th className="py-2 pr-4 font-medium">KPI Metric</th>
                      <th className="py-2 pr-4 font-medium text-right">Monthly Goal</th>
                      <th className="py-2 pr-4 font-medium">Deleted By</th>
                      <th className="py-2 pr-4 font-medium">Deleted Date & Time</th>
                      <th className="py-2 pr-4 font-medium">Restored By</th>
                      <th className="py-2 pr-4 font-medium">Restored Date & Time</th>
                      <th className="py-2 pr-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deletedGoals.map((row) => {
                      const rowKey = savedGoalKey(row);
                      return (
                        <tr key={rowKey} className="border-b hover:bg-gray-50">
                          <td className="py-2 pr-4">
                            <input
                              type="checkbox"
                              checked={selectedDeletedGoalKeys.has(rowKey)}
                              onChange={() => toggleKey(setSelectedDeletedGoalKeys, rowKey)}
                              className="h-4 w-4 cursor-pointer"
                            />
                          </td>
                          <td className="py-2 pr-4 font-medium text-gray-900">{row.campaignName}</td>
                          <td className="py-2 pr-4">{MONTHS[row.month - 1]} {row.year}</td>
                          <td className="py-2 pr-4 capitalize">{row.kpiMetric}</td>
                          <td className="py-2 pr-4 text-right">{row.monthlyGoal.toLocaleString()}</td>
                          <td className="py-2 pr-4">{row.deletedBy || '-'}</td>
                          <td className="py-2 pr-4">{row.deletedAt ? new Date(row.deletedAt).toLocaleString() : '-'}</td>
                          <td className="py-2 pr-4">{row.restoredBy || '-'}</td>
                          <td className="py-2 pr-4">{row.restoredAt ? new Date(row.restoredAt).toLocaleString() : '-'}</td>
                          <td className="py-2 pr-4 text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1"
                                disabled={processingAction}
                                onClick={() => setConfirmAction({ type: 'restore', items: [parseGoalKey(rowKey)] })}
                              >
                                <ArchiveRestore className="h-4 w-4" />
                                Restore
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="gap-1 text-red-600 hover:text-red-700"
                                disabled={processingAction}
                                onClick={() => setConfirmAction({ type: 'permanent-delete', items: [parseGoalKey(rowKey)] })}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete Forever
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={
          confirmAction?.type === 'restore'
            ? 'Restore Goal Configuration'
            : 'Permanently Delete Goal Configuration'
        }
        description={
          confirmAction?.type === 'restore'
            ? `Restore ${confirmAction.items.length} selected goal configuration(s)?`
            : `Permanently delete ${confirmAction?.items.length || 0} selected goal configuration(s)? This cannot be undone.`
        }
        actionLabel={
          confirmAction?.type === 'restore'
            ? 'Restore'
            : 'Delete Forever'
        }
        isDangerous={confirmAction?.type !== 'restore'}
        isLoading={processingAction}
        onConfirm={executeConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
