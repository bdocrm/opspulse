'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { SortableDateHeader, type DateSortDirection } from '@/components/sortable-date-header';
import { AlertCircle, ArrowUpDown, CheckCircle, ChevronDown, ChevronUp, Download, Eye, Loader2, Pencil, Search, X } from 'lucide-react';
import { formatNumberWithCommas } from '@/lib/number-format';
import { MONTH_NAMES } from '@/lib/months';
import {
  BPI_KPI_METRICS,
  BPI_KPI_VALUES,
  KPI_METRICS,
  dashboardExportRows,
  formatInputNumber,
  formatNumber,
  formatNumericTextValue,
  formatPct,
  isAcqCampaign,
  metricLabel,
  normalizeNumericInput,
  statusClass,
  statusForCampaign,
  statusLabel,
  stripNumberFormatting,
  usesBpiThreeKpis,
  type AchievementStatus,
  type Campaign,
  type ConfirmAction,
  type SavedGoal,
  type SortDirection,
  type SortKey,
} from './goal-utils';

export default function GoalsManagement() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { addToast } = useToast();
  const user = session?.user;

  const now = new Date();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1); // 1-12, defaults to current month
  const [selectedYear] = useState<number>(now.getFullYear());
  const [savedGoals, setSavedGoals] = useState<SavedGoal[]>([]);
  // When editing a saved row from another month, remember which campaign to
  // re-select after the month-change effect reloads the campaign list. Kept in a
  // ref (not state) so the data-loading effect can read it WITHOUT taking it as
  // a dependency — otherwise the effect, which itself selects a campaign, would
  // re-trigger on its own writes and loop ("Maximum update depth exceeded").
  const pendingCampaignIdRef = useRef<string | null>(null);
  // Mirror of the currently selected campaign id, for the same reason: the
  // effect needs "which campaign was selected" to preserve it across a month
  // reload, but must not depend on the selectedCampaign state it sets.
  const selectedCampaignIdRef = useRef<string | null>(null);
  // Top of the editor — scrolled into view when "Edit" is pressed on a saved row.
  const editorRef = useRef<HTMLDivElement>(null);

  // Campaign-level fields
  const [monthlyGoal, setMonthlyGoal] = useState('');
  const [supplementaryGoal, setSupplementaryGoal] = useState('');
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
  const [dashboardDateSort, setDashboardDateSort] = useState<DateSortDirection>('desc');
  const [rowsPerPage, setRowsPerPage] = useState('5');
  const [currentPage, setCurrentPage] = useState(1);
  const [dashboardExpanded, setDashboardExpanded] = useState(true);
  const [selectCampaignExpanded, setSelectCampaignExpanded] = useState(true);
  const [campaignGoalExpanded, setCampaignGoalExpanded] = useState(true);
  const [agentTargetsExpanded, setAgentTargetsExpanded] = useState(false);
  const [savedGoalsExpanded, setSavedGoalsExpanded] = useState(false);
  const [agentTargetSearch, setAgentTargetSearch] = useState('');
  const [agentRowsPerPage, setAgentRowsPerPage] = useState('5');
  const [agentTargetPage, setAgentTargetPage] = useState(1);
  const [detailsCampaign, setDetailsCampaign] = useState<Campaign | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [processingAction, setProcessingAction] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated' && (!user || !['CEO', 'OM'].includes(user.role))) {
      router.push('/dashboard');
    }
  }, [status, user, router]);

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
      })
    );
  }, [
    dashboardExpanded,
    selectCampaignExpanded,
    campaignGoalExpanded,
    agentTargetsExpanded,
    savedGoalsExpanded,
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
          selectedCampaignIdRef.current = null;
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
      const response = await fetch('/api/goals/saved');
      if (response.ok) setSavedGoals(await response.json());
    } catch {
      /* non-critical: the saved list is informational */
    }
  };

  // Load the goal configuration for the selected campaign + month. Re-runs when
  // the month or year changes, preserving the currently selected campaign (or
  // re-selecting a campaign requested via the saved-goals "Edit" action).
  useEffect(() => {
    if (status === 'authenticated') {
      const keepId = pendingCampaignIdRef.current ?? selectedCampaignIdRef.current ?? undefined;
      loadCampaigns(selectedMonth, selectedYear, keepId).then(() => {
        pendingCampaignIdRef.current = null;
      });
      loadSavedGoals();
    }
    // loadCampaigns/loadSavedGoals are stable for our purposes; the campaign to
    // keep selected is read from refs so it is intentionally NOT a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, selectedMonth, selectedYear]);

  // Load a saved goal record into the form for editing. If it belongs to a
  // different month, switch the month (the effect reloads + re-selects it).
  const handleEditSaved = (row: SavedGoal) => {
    if (row.month === selectedMonth && row.year === selectedYear) {
      const c = campaigns.find((c) => c.id === row.campaignId);
      if (c) applySelectedCampaign(c);
    } else {
      pendingCampaignIdRef.current = row.campaignId;
      setSelectedMonth(row.month);
    }
    // Bring the editor into view — the saved list sits below the form, so without
    // this the form updates off-screen and the click appears to do nothing.
    setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  function applySelectedCampaign(campaign: Campaign) {
    setSelectedCampaign(campaign);
    selectedCampaignIdRef.current = campaign.id;
    setMonthlyGoal(formatInputNumber(campaign.monthlyGoal, 2));
    setSupplementaryGoal(formatInputNumber(campaign.supplementaryGoal ?? 0, 2));
    const savedMetric = campaign.kpiMetric || 'transmittals';
    setKpiMetric(usesBpiThreeKpis(campaign.campaignName) && !BPI_KPI_VALUES.has(savedMetric) ? 'transmittals' : savedMetric);
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
          supplementaryGoal: Number(stripNumberFormatting(supplementaryGoal)) || 0,
          kpiMetric,
          workingDays: Number(stripNumberFormatting(workingDays)) || 22,
          daysLapsed: Number(stripNumberFormatting(daysLapsed)) || 0,
        }),
      });

      if (res.ok) {
        // Reload the saved month's configuration, keeping this campaign selected.
        // (loadCampaigns → applySelectedCampaign resets message/error, so set the
        // success message AFTER the reload, not before, or it gets cleared.)
        await loadCampaigns(selectedMonth, selectedYear, selectedCampaign.id);
        await loadSavedGoals();
        setMessage(`Goals for ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear} saved successfully`);
        addToast('success', `Goals for ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear} saved successfully`);
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
      if (confirmAction.type === 'soft-delete') {
        addToast('success', `Deleted ${affected} goal configuration(s)`);
      } else if (confirmAction.type === 'restore') {
        addToast('success', `Restored ${affected} goal configuration(s)`);
      } else if (confirmAction.type === 'permanent-delete') {
        addToast('success', `Permanently deleted ${affected} goal configuration(s)`);
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
    dashboardDateSort,
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
        const aValue =
          sortKey === 'kpiMetric'
            ? metricLabel(a.kpiMetric)
            : sortKey === 'updatedAt'
              ? new Date(a.updatedAt ?? 0).getTime()
              : a[sortKey];
        const bValue =
          sortKey === 'kpiMetric'
            ? metricLabel(b.kpiMetric)
            : sortKey === 'updatedAt'
              ? new Date(b.updatedAt ?? 0).getTime()
              : b[sortKey];
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
    const totalMTD = sortedFilteredCampaigns.reduce((sum, c) => sum + (c.bookedVolume || 0), 0);
    const avgAchievement =
      totalCampaigns > 0
        ? sortedFilteredCampaigns.reduce((sum, c) => sum + (c.achievement || 0), 0) / totalCampaigns
        : 0;
    const avgRunRate =
      totalCampaigns > 0
        ? sortedFilteredCampaigns.reduce((sum, c) => sum + (c.rrAchievement || 0), 0) / totalCampaigns
        : 0;
    const aboveGoal = sortedFilteredCampaigns.filter((c) => statusForCampaign(c) === 'above').length;
    const belowGoal = sortedFilteredCampaigns.filter((c) =>
      ['needs-attention', 'at-risk'].includes(statusForCampaign(c))
    ).length;

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

  const filteredCampaignAgents = useMemo(() => {
    if (!selectedCampaign) return [];
    const search = agentTargetSearch.trim().toLowerCase();
    if (!search) return selectedCampaign.users;
    return selectedCampaign.users.filter((agent) =>
      `${agent.name} ${agent.seatNumber ?? ''}`.toLowerCase().includes(search)
    );
  }, [agentTargetSearch, selectedCampaign]);

  useEffect(() => {
    setAgentTargetPage(1);
  }, [agentTargetSearch, selectedCampaign?.id, agentRowsPerPage]);

  const agentTargetTotalPages =
    agentRowsPerPage === 'all'
      ? 1
      : Math.max(1, Math.ceil(filteredCampaignAgents.length / Number(agentRowsPerPage)));

  useEffect(() => {
    setAgentTargetPage((page) => Math.min(page, agentTargetTotalPages));
  }, [agentTargetTotalPages]);

  const paginatedCampaignAgents =
    agentRowsPerPage === 'all'
      ? filteredCampaignAgents
      : filteredCampaignAgents.slice(
          (agentTargetPage - 1) * Number(agentRowsPerPage),
          agentTargetPage * Number(agentRowsPerPage)
        );
  const agentTargetStart = filteredCampaignAgents.length === 0
    ? 0
    : agentRowsPerPage === 'all'
      ? 1
      : (agentTargetPage - 1) * Number(agentRowsPerPage) + 1;
  const agentTargetEnd =
    agentRowsPerPage === 'all'
      ? filteredCampaignAgents.length
      : Math.min(agentTargetPage * Number(agentRowsPerPage), filteredCampaignAgents.length);

  const handleSort = (key: SortKey) => {
    const nextDirection =
      sortKey === key
        ? sortDirection === 'asc' ? 'desc' : 'asc'
        : key === 'updatedAt'
          ? dashboardDateSort
          : 'asc';
    setSortKey(key);
    setSortDirection(nextDirection);
    if (key === 'updatedAt') setDashboardDateSort(nextDirection);
  };

  const handleDashboardToggle = () => {
    setDashboardExpanded((expanded) => {
      const nextExpanded = !expanded;
      if (nextExpanded) {
        setRowsPerPage('5');
        setCurrentPage(1);
      }
      return nextExpanded;
    });
  };

  const handleAgentTargetsToggle = () => {
    setAgentTargetsExpanded((expanded) => {
      const nextExpanded = !expanded;
      if (nextExpanded) {
        setAgentRowsPerPage('5');
        setAgentTargetPage(1);
      }
      return nextExpanded;
    });
  };

  const exportCampaignRows = (rows: Campaign[], format: 'csv' | 'xlsx') => {
    const exportRows = dashboardExportRows(rows);
    const suffix = `${MONTH_NAMES[selectedMonth - 1]}-${selectedYear}`.replace(/\s+/g, '-').toLowerCase();
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

  const wDays = Number(stripNumberFormatting(workingDays)) || 22;
  const dLapsed = Number(stripNumberFormatting(daysLapsed)) || 0;
  const goal = Number(stripNumberFormatting(monthlyGoal)) || 0;
  const weekGoal = goal > 0 ? Math.round(goal / 4) : 0;

  // Preview KPI formulas with placeholder MTD
  const previewMTD = goal > 0 ? Math.round(goal * (dLapsed / Math.max(wDays, 1))) : 0;
  const previewRR = dLapsed > 0 ? Math.round((previewMTD / dLapsed) * wDays) : 0;
  const previewAch = goal > 0 ? ((previewMTD / goal) * 100).toFixed(1) : '0.0';
  const previewRRAch = goal > 0 ? ((previewRR / goal) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-6" ref={editorRef}>
      <PageTitle title="Goals Management" subtitle="Monitor campaign goals, KPI performance, and run rate in one place." />

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/40">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}
      {message && (
        <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900/60 dark:bg-green-950/40">
          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-700 dark:text-green-300">{message}</p>
        </div>
      )}

      {/* Executive Target Dashboard */}
      <Card className="border-blue-200 bg-blue-50/40 p-6 text-card-foreground shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-foreground">Executive Target Dashboard</h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              All campaign targets and live performance for {MONTH_NAMES[selectedMonth - 1]} {selectedYear}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDashboardToggle}
              className="gap-2 border-blue-200 bg-background text-blue-700 shadow-sm hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950/50"
              aria-expanded={dashboardExpanded}
              aria-controls="executive-target-dashboard-panel"
            >
              {dashboardExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              {dashboardExpanded ? 'Collapse Dashboard' : 'Expand Dashboard'}
            </Button>
            <div className="relative">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 border-border bg-background text-foreground shadow-sm"
                onClick={() => setExportOpen((open) => !open)}
                aria-expanded={exportOpen}
              >
                <Download className="h-4 w-4" />
                Export
                <ChevronDown className="h-4 w-4" />
              </Button>
              {exportOpen && (
                <div className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-lg border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg">
                  {[
                    ['Export XLSX', () => exportCampaignRows(campaigns, 'xlsx')],
                    ['Export CSV', () => exportCampaignRows(campaigns, 'csv')],
                    ['Export Filtered XLSX', () => exportCampaignRows(sortedFilteredCampaigns, 'xlsx')],
                    ['Export Filtered CSV', () => exportCampaignRows(sortedFilteredCampaigns, 'csv')],
                  ].map(([label, action]) => (
                    <button
                      key={label as string}
                      type="button"
                      className="block w-full px-4 py-2 text-left text-popover-foreground hover:bg-muted"
                      onClick={() => {
                        (action as () => void)();
                        setExportOpen(false);
                      }}
                    >
                      {label as string}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          id="executive-target-dashboard-panel"
          className={`grid transition-all duration-300 ease-in-out ${
            dashboardExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-7">
              {[
                { label: 'Total Campaigns', value: summary.totalCampaigns.toLocaleString(), note: `${campaigns.length.toLocaleString()} total`, accent: 'bg-blue-500', progress: summary.totalCampaigns > 0 ? 100 : 0 },
                { label: 'Total Goal', value: formatNumber(summary.totalGoal), note: 'Target volume', accent: 'bg-indigo-500', progress: summary.totalGoal > 0 ? 100 : 0 },
                { label: 'Total MTD', value: formatNumber(summary.totalMTD), note: 'Current actual', accent: 'bg-cyan-500', progress: summary.totalGoal > 0 ? Math.min(100, (summary.totalMTD / summary.totalGoal) * 100) : 0 },
                { label: 'Overall Achievement %', value: formatPct(summary.avgAchievement), note: summary.avgAchievement >= 100 ? 'Above target' : 'Needs lift', accent: summary.avgAchievement >= 100 ? 'bg-green-500' : 'bg-orange-500', progress: Math.min(100, summary.avgAchievement) },
                { label: 'Average Run Rate %', value: formatPct(summary.avgRunRate), note: summary.avgRunRate >= 100 ? 'On pace' : 'Below pace', accent: summary.avgRunRate >= 100 ? 'bg-green-500' : 'bg-amber-500', progress: Math.min(100, summary.avgRunRate) },
                { label: 'Above Goal', value: summary.aboveGoal.toLocaleString(), note: 'Performing well', accent: 'bg-emerald-500', progress: summary.totalCampaigns > 0 ? (summary.aboveGoal / summary.totalCampaigns) * 100 : 0 },
                { label: 'Below Goal', value: summary.belowGoal.toLocaleString(), note: 'Needs attention', accent: 'bg-red-500', progress: summary.totalCampaigns > 0 ? (summary.belowGoal / summary.totalCampaigns) * 100 : 0 },
              ].map((card) => (
                <div key={card.label} className="flex min-h-[126px] flex-col justify-between rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{card.label}</p>
                    <p className="mt-2 text-2xl font-bold text-foreground">{card.value}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{card.note}</p>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full ${card.accent}`} style={{ width: `${Math.max(4, Math.min(100, card.progress))}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Smart Filters</p>
                  <p className="text-xs text-muted-foreground">Narrow the dashboard without leaving the executive view.</p>
                </div>
                <p className="text-xs font-medium text-muted-foreground">{sortedFilteredCampaigns.length.toLocaleString()} results</p>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
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
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="all">All Campaigns</option>
                  {campaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>{campaign.campaignName}</option>
                  ))}
                </select>
                <select
                  value={metricFilter}
                  onChange={(e) => setMetricFilter(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="all">All KPI Metrics</option>
                  {KPI_METRICS.map((metric) => (
                    <option key={metric.value} value={metric.value}>{metric.label}</option>
                  ))}
                </select>
                <select
                  value={achievementStatus}
                  onChange={(e) => setAchievementStatus(e.target.value as AchievementStatus)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="all">All Statuses</option>
                  <option value="above">Above Goal</option>
                  <option value="on-track">On Track</option>
                  <option value="needs-attention">Needs Attention</option>
                  <option value="at-risk">At Risk</option>
                </select>
                <select
                  value={dashboardDateSort}
                  onChange={(e) => {
                    const value = e.target.value as DateSortDirection;
                    setDashboardDateSort(value);
                    setSortKey('updatedAt');
                    setSortDirection(value);
                  }}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="desc">Date: Recent to Old</option>
                  <option value="asc">Date: Old to Recent</option>
                </select>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <Input inputMode="decimal" value={goalMin} onChange={(e) => setGoalMin(formatNumericTextValue(e.target.value))} onBlur={() => setGoalMin(formatInputNumber(goalMin))} placeholder="Goal min" />
                <Input inputMode="decimal" value={goalMax} onChange={(e) => setGoalMax(formatNumericTextValue(e.target.value))} onBlur={() => setGoalMax(formatInputNumber(goalMax))} placeholder="Goal max" />
                <Input inputMode="decimal" value={achievementMin} onChange={(e) => setAchievementMin(formatNumericTextValue(e.target.value))} onBlur={() => setAchievementMin(formatInputNumber(achievementMin))} placeholder="Achievement % min" />
                <Input inputMode="decimal" value={achievementMax} onChange={(e) => setAchievementMax(formatNumericTextValue(e.target.value))} onBlur={() => setAchievementMax(formatInputNumber(achievementMax))} placeholder="Achievement % max" />
                <Input inputMode="decimal" value={rrMin} onChange={(e) => setRrMin(formatNumericTextValue(e.target.value))} onBlur={() => setRrMin(formatInputNumber(rrMin))} placeholder="RR Achievement % min" />
                <Input inputMode="decimal" value={rrMax} onChange={(e) => setRrMax(formatNumericTextValue(e.target.value))} onBlur={() => setRrMax(formatInputNumber(rrMax))} placeholder="RR Achievement % max" />
              </div>
            </div>

            <div className="mt-5 max-h-[620px] overflow-auto rounded-xl border border-border bg-card text-card-foreground shadow-sm">
              <table className="w-full min-w-[1050px] text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground shadow-sm">
                  <tr>
                    {[
                  ['campaignName', 'Campaign'],
                  ['kpiMetric', 'KPI Metric'],
                  ['monthlyGoal', 'Goal'],
                  ['bookedVolume', 'Booked Volume'],
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
                <th className="px-3 py-3 font-semibold">
                  <SortableDateHeader
                    label="Last Updated"
                    direction={sortKey === 'updatedAt' ? sortDirection : dashboardDateSort}
                    active={sortKey === 'updatedAt'}
                    onToggle={() => handleSort('updatedAt')}
                  />
                </th>
                <th className="px-3 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">No target records match the selected filters.</td>
                </tr>
              ) : (
                paginatedCampaigns.map((campaign, index) => {
                  const rowStatus = statusForCampaign(campaign);
                  return (
                    <tr key={campaign.id} className={`border-t border-border transition hover:bg-blue-50/60 dark:hover:bg-blue-950/30 ${index % 2 === 0 ? 'bg-card' : 'bg-muted/35'}`}>
                      <td className="px-4 py-4 font-semibold text-foreground">{campaign.campaignName}</td>
                      <td className="px-4 py-4">{metricLabel(campaign.kpiMetric)}</td>
                      <td className="px-4 py-4 text-right font-medium">{formatNumber(campaign.monthlyGoal)}</td>
                      <td className="px-4 py-4 text-right">{formatNumber(campaign.mtd)}</td>
                      <td className="px-4 py-4 text-right font-medium">{formatPct(campaign.achievement)}</td>
                      <td className="px-4 py-4 text-right">{formatNumber(campaign.runRate)}</td>
                      <td className="px-4 py-4 text-right">{formatPct(campaign.rrAchievement)}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(rowStatus)}`}>
                          {statusLabel(rowStatus)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {campaign.updatedAt ? new Date(campaign.updatedAt).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            className="bg-blue-600 text-white hover:bg-blue-700"
                            onClick={() => setDetailsCampaign(campaign)}
                          >
                            <Eye className="h-4 w-4" />
                            View Details
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 w-9 p-0"
                            onClick={() => {
                              applySelectedCampaign(campaign);
                              setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                            }}
                            aria-label={`Edit ${campaign.campaignName}`}
                          >
                            <Pencil className="h-4 w-4" />
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
              <p className="text-sm text-muted-foreground">
                Showing {paginatedCampaigns.length} of {sortedFilteredCampaigns.length} filtered records
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={rowsPerPage}
                  onChange={(e) => setRowsPerPage(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="5">5 rows</option>
                  <option value="10">10 rows</option>
                  <option value="15">15 rows</option>
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
                <span className="text-sm text-muted-foreground">Page {Math.min(currentPage, totalPages)} of {totalPages}</span>
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
      <Card className="border-cyan-200 bg-cyan-50/30 p-6 shadow-sm dark:border-cyan-900/60 dark:bg-cyan-950/20">
        <button
          type="button"
          onClick={() => setSelectCampaignExpanded((expanded) => !expanded)}
          className="flex w-full flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between"
          aria-expanded={selectCampaignExpanded}
          aria-controls="select-campaign-panel"
        >
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-bold text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300">Campaign Setup</span>
              <h3 className="text-lg font-semibold text-foreground">Select Campaign</h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Pick the campaign you want to configure.</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-background px-3 py-1.5 text-sm font-medium text-cyan-700 shadow-sm dark:border-cyan-900 dark:text-cyan-300">
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
                  ? 'border-cyan-500 bg-background text-cyan-800 shadow-sm ring-2 ring-cyan-100 dark:text-cyan-300 dark:ring-cyan-950'
                  : 'border-cyan-100 bg-background text-foreground hover:border-cyan-300 hover:text-cyan-800 dark:border-cyan-900 dark:hover:text-cyan-300'
              }`}
            >
              {campaign.campaignName}
            </button>
          ))}
        </div>
          </div>
        </div>
      </Card>

      {selectedCampaign && (
        <>
          {/* Campaign Goal & Run Rate Config */}
          <Card className="border-amber-200 bg-amber-50/30 p-6 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20">
            <button
              type="button"
              onClick={() => setCampaignGoalExpanded((expanded) => !expanded)}
              className="flex w-full flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between"
              aria-expanded={campaignGoalExpanded}
              aria-controls="campaign-goal-panel"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">Goal Configuration</span>
                  <h3 className="text-lg font-semibold text-foreground">Campaign Goal &amp; Run Rate Settings</h3>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Choose the month, then set the campaign goal, KPI metric, working days, and run-rate inputs.</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-background px-3 py-1.5 text-sm font-medium text-amber-700 shadow-sm dark:border-amber-900 dark:text-amber-300">
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
            <div className="mb-4 rounded-xl border border-amber-200 bg-background/80 p-4 dark:border-amber-900/60">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">Monthly Setup</span>
                <h4 className="font-semibold text-foreground">Month</h4>
              </div>
              <div className="max-w-xs">
                <Label htmlFor="goal-month">Goal Month</Label>
                <select
                  id="goal-month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={i + 1}>{m} {selectedYear}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Saving creates or updates the goal for {selectedCampaign.campaignName} in {MONTH_NAMES[selectedMonth - 1]} {selectedYear}.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              {/* KPI Metric */}
              <div>
                <Label htmlFor="kpi">KPI Metric</Label>
                <select
                  id="kpi"
                  value={kpiMetric}
                  onChange={(e) => setKpiMetric(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {(usesBpiThreeKpis(selectedCampaign?.campaignName) ? BPI_KPI_METRICS : KPI_METRICS).map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                {usesBpiThreeKpis(selectedCampaign?.campaignName) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    BPI campaigns use Transmittals, Approvals, or Booked. BPI PA OUTBOUND is excluded.
                  </p>
                )}
              </div>

              {/* Monthly Goal (NTB for ACQ campaigns) */}
              <div>
                <Label htmlFor="monthly-goal">
                  {isAcqCampaign(selectedCampaign?.campaignName) ? 'Monthly Goal (NTB)' : 'Monthly Goal'}
                </Label>
                <Input
                  id="monthly-goal"
                  inputMode="decimal"
                  value={monthlyGoal}
                  onChange={(e) => setMonthlyGoal(formatNumericTextValue(e.target.value))}
                  onBlur={(e) => {
                    const n = Number(stripNumberFormatting(e.target.value));
                    if (e.target.value !== '' && !Number.isNaN(n)) setMonthlyGoal(formatInputNumber(n, 2));
                  }}
                  placeholder="e.g. 1,000.00"
                  className="mt-1"
                />
              </div>

              {/* Monthly Goal (Supplementary) — ACQ campaigns only */}
              {isAcqCampaign(selectedCampaign?.campaignName) && (
                <div>
                  <Label htmlFor="supplementary-goal">Monthly Goal (Supplementary)</Label>
                  <Input
                    id="supplementary-goal"
                    inputMode="decimal"
                    value={supplementaryGoal}
                    onChange={(e) => setSupplementaryGoal(formatNumericTextValue(e.target.value))}
                    onBlur={(e) => {
                      const n = Number(stripNumberFormatting(e.target.value));
                      if (e.target.value !== '' && !Number.isNaN(n)) setSupplementaryGoal(formatInputNumber(n, 2));
                    }}
                    placeholder="e.g. 291.00"
                    className="mt-1"
                  />
                </div>
              )}

              {/* Working Days */}
              <div>
                <Label htmlFor="working-days">
                  Working Days (WDays)
                  <span className="ml-1 text-xs font-normal text-muted-foreground">— total working days this month</span>
                </Label>
                <Input
                  id="working-days"
                  inputMode="numeric"
                  value={workingDays}
                  onChange={(e) => setWorkingDays(formatNumericTextValue(e.target.value))}
                  placeholder="22"
                  className="mt-1"
                />
              </div>

              {/* Days Lapsed */}
              <div>
                <Label htmlFor="days-lapsed">
                  Days Lapsed
                  <span className="ml-1 text-xs font-normal text-muted-foreground">— working days elapsed so far</span>
                </Label>
                <Input
                  id="days-lapsed"
                  inputMode="numeric"
                  value={daysLapsed}
                  onChange={(e) => setDaysLapsed(formatNumericTextValue(e.target.value))}
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
                    className="group relative cursor-help rounded border border-blue-200 bg-blue-50 p-3 text-center dark:border-blue-900/60 dark:bg-blue-950/40"
                  >
                    <div className="text-xs font-medium text-blue-600 dark:text-blue-400">{week}</div>
                    <div className="mt-1 text-lg font-bold text-blue-900 dark:text-blue-200">
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
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Formula Preview (on-pace estimate)</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm">
                <div className="group relative cursor-help">
                  <p className="text-xs text-muted-foreground">MTD (on pace)</p>
                  <p className="text-lg font-bold text-foreground">{previewMTD.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">sum W1–W4</p>
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-[240px] -translate-x-1/2 whitespace-normal rounded-md bg-gray-900 px-3 py-2 text-xs font-normal text-white shadow-lg group-hover:block">
                    {`MTD (on pace) = Goal × (Days Lapsed ÷ WDays) = ${goal.toLocaleString()} × (${dLapsed} ÷ ${wDays}) = ${previewMTD.toLocaleString()}`}
                  </div>
                </div>
                <div className="group relative cursor-help">
                  <p className="text-xs text-muted-foreground">Achievement</p>
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{previewAch}%</p>
                  <p className="text-xs text-muted-foreground">MTD / Goal</p>
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-[240px] -translate-x-1/2 whitespace-normal rounded-md bg-gray-900 px-3 py-2 text-xs font-normal text-white shadow-lg group-hover:block">
                    {`Achievement = MTD ÷ Goal × 100 = ${previewMTD.toLocaleString()} ÷ ${goal.toLocaleString()} × 100 = ${previewAch}%`}
                  </div>
                </div>
                <div className="group relative cursor-help">
                  <p className="text-xs text-muted-foreground">Run Rate</p>
                  <p className="text-lg font-bold text-foreground">{previewRR.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">MTD / Lapsed × WDays</p>
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-[240px] -translate-x-1/2 whitespace-normal rounded-md bg-gray-900 px-3 py-2 text-xs font-normal text-white shadow-lg group-hover:block">
                    {`Run Rate = MTD ÷ Days Lapsed × WDays = ${previewMTD.toLocaleString()} ÷ ${dLapsed} × ${wDays} = ${previewRR.toLocaleString()}`}
                  </div>
                </div>
                <div className="group relative cursor-help">
                  <p className="text-xs text-muted-foreground">RR Achievement</p>
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{previewRRAch}%</p>
                  <p className="text-xs text-muted-foreground">Run Rate / Goal</p>
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
          <Card className="border-indigo-200 bg-indigo-50/30 p-6 shadow-sm dark:border-indigo-900/60 dark:bg-indigo-950/20">
            <button
              type="button"
              onClick={handleAgentTargetsToggle}
              className="flex w-full flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between"
              aria-expanded={agentTargetsExpanded}
              aria-controls="agent-targets-panel"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">Agent Assignment</span>
                  <h3 className="text-lg font-semibold text-foreground">
                    Agent Targets
                    <span className="ml-2 text-sm font-normal text-muted-foreground">({selectedCampaign.users.length} agents)</span>
                  </h3>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Review and update individual monthly targets for agents in this campaign.</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-md border border-indigo-200 bg-background px-3 py-1.5 text-sm font-medium text-indigo-700 shadow-sm dark:border-indigo-900 dark:text-indigo-300">
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
                  <p className="text-sm text-muted-foreground">No agents assigned to this campaign</p>
                ) : (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={agentTargetSearch}
                        onChange={(e) => setAgentTargetSearch(e.target.value)}
                        placeholder="Search agent by name or seat..."
                        className="pl-8"
                      />
                    </div>
                    {filteredCampaignAgents.length === 0 ? (
                      <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                        No agents match your search.
                      </p>
                    ) : (
                      <>
                      {paginatedCampaignAgents.map((agent, index) => (
                        <div key={agent.id} className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-end">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                            {agentTargetStart + index}
                          </div>
                          <div className="flex-1">
                            <Label className="text-xs text-muted-foreground">
                              {agent.seatNumber ? `Seat ${agent.seatNumber}` : 'No seat'}
                            </Label>
                            <div className="font-semibold text-foreground">{agent.name}</div>
                          </div>
                          <div className="w-full sm:w-36">
                            <Label htmlFor={`agent-${agent.id}`} className="text-xs text-muted-foreground">Monthly Target</Label>
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
                      ))}
                      <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/80 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-muted-foreground">
                          Showing {agentTargetStart}-{agentTargetEnd} of {filteredCampaignAgents.length} agents
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={agentRowsPerPage}
                            onChange={(e) => setAgentRowsPerPage(e.target.value)}
                            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                          >
                            <option value="5">5 rows</option>
                            <option value="10">10 rows</option>
                            <option value="15">15 rows</option>
                            <option value="25">25 rows</option>
                            <option value="50">50 rows</option>
                            <option value="100">100 rows</option>
                            <option value="all">Show all</option>
                          </select>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={agentTargetPage <= 1}
                            onClick={() => setAgentTargetPage((page) => Math.max(1, page - 1))}
                          >
                            Previous
                          </Button>
                          <span className="text-sm text-muted-foreground">
                            Page {agentTargetPage} of {agentTargetTotalPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={agentTargetPage >= agentTargetTotalPages || agentRowsPerPage === 'all'}
                            onClick={() => setAgentTargetPage((page) => Math.min(agentTargetTotalPages, page + 1))}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Summary */}
          <Card className="border-border bg-card p-6 text-card-foreground shadow-sm">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">Current Edit Summary</span>
              <h3 className="font-semibold text-foreground">{selectedCampaign.campaignName}</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 dark:border-blue-900/60 dark:bg-blue-950/30">
                <div className="text-muted-foreground">Monthly Goal</div>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{goal.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/30">
                <div className="text-muted-foreground">Total Agent Targets</div>
                <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                  {Object.values(agentTarget).reduce((s, v) => s + (v || 0), 0).toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
                <div className="text-muted-foreground">Working Days</div>
                <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{wDays}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <div className="text-muted-foreground">Days Lapsed</div>
                <div className="text-2xl font-bold text-foreground">
                  {dLapsed}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">/ {wDays}</span>
                </div>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Saved Campaign Goals — view all saved per-month configurations */}
      <Card className="border-emerald-200 bg-emerald-50/30 p-6 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20">
        <button
          type="button"
          onClick={() => setSavedGoalsExpanded((expanded) => !expanded)}
          className="flex w-full flex-col gap-2 text-left sm:flex-row sm:items-center sm:justify-between"
          aria-expanded={savedGoalsExpanded}
          aria-controls="saved-campaign-goals-panel"
        >
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">Saved Records</span>
              <h3 className="text-lg font-semibold text-foreground">
                Saved Campaign Goals
                <span className="ml-2 text-sm font-normal text-muted-foreground">({savedGoals.length})</span>
              </h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Saved monthly configurations. Edit one to reload it into the current form.</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-background px-3 py-1.5 text-sm font-medium text-emerald-700 shadow-sm dark:border-emerald-900 dark:text-emerald-300">
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
        <p className="mb-4 text-sm text-muted-foreground">
          All saved goal configurations by campaign and month. Click Edit to load one for changes.
        </p>
        {savedGoals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved goal configurations yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
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
                      className={`border-b border-border ${isCurrent ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-muted/40'}`}
                    >
                      <td className="py-2 pr-4 font-medium text-foreground">{row.campaignName}</td>
                      <td className="py-2 pr-4">{MONTH_NAMES[row.month - 1]} {row.year}</td>
                      <td className="py-2 pr-4 capitalize">{row.kpiMetric}</td>
                      <td className="py-2 pr-4 text-right">{formatNumberWithCommas(row.monthlyGoal, 2)}</td>
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
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setConfirmAction({
                                type: 'soft-delete',
                                items: [{ campaignId: row.campaignId, month: row.month, year: row.year }],
                              });
                            }}
                            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                          >
                            Delete
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

      {detailsCampaign && (() => {
        const drawerStatus = statusForCampaign(detailsCampaign);
        const achievementProgress = Math.max(0, Math.min(100, detailsCampaign.achievement || 0));
        const rrProgress = Math.max(0, Math.min(100, detailsCampaign.rrAchievement || 0));
        const campaignHistory = savedGoals
          .filter((row) => row.campaignId === detailsCampaign.id)
          .slice(0, 5);

        return (
          <div
            className="fixed inset-0 z-50 flex justify-end bg-slate-950/35"
            role="dialog"
            aria-modal="true"
            aria-label={`${detailsCampaign.campaignName} details`}
            onClick={() => setDetailsCampaign(null)}
          >
            <aside
              className="h-full w-full max-w-xl overflow-y-auto bg-background text-foreground shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="sticky top-0 z-10 border-b border-border bg-background/95 p-5 backdrop-blur">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">Campaign Details</p>
                    <h3 className="mt-1 text-xl font-bold text-foreground">{detailsCampaign.campaignName}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{metricLabel(detailsCampaign.kpiMetric)}</p>
                  </div>
                  <button
                    type="button"
                    className="rounded-md border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setDetailsCampaign(null)}
                    aria-label="Close campaign details"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current Status</p>
                    <span className={`mt-2 inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${statusClass(drawerStatus)}`}>
                      {statusLabel(drawerStatus)}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Last Updated</p>
                    <p className="text-sm font-semibold text-foreground">
                      {detailsCampaign.updatedAt ? new Date(detailsCampaign.updatedAt).toLocaleString() : 'No update recorded'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['Goal', formatNumber(detailsCampaign.monthlyGoal)],
                    ['Current MTD', formatNumber(detailsCampaign.mtd)],
                    ['Run Rate', formatNumber(detailsCampaign.runRate)],
                    ['Achievement', formatPct(detailsCampaign.achievement)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">Trend</p>
                    <p className="text-sm text-muted-foreground">RR Achievement {formatPct(detailsCampaign.rrAchievement)}</p>
                  </div>
                  <div className="mt-4 space-y-3">
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                        <span>Achievement</span>
                        <span>{formatPct(detailsCampaign.achievement)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div className="h-full rounded-full bg-blue-600" style={{ width: `${achievementProgress}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                        <span>Run Rate Pace</span>
                        <span>{formatPct(detailsCampaign.rrAchievement)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${rrProgress}%` }} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
                  <p className="text-sm font-semibold text-foreground">Assigned Users</p>
                  <p className="mt-1 text-xs text-muted-foreground">{detailsCampaign.users.length.toLocaleString()} users assigned</p>
                  <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
                    {detailsCampaign.users.length === 0 ? (
                      <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">No assigned users.</p>
                    ) : (
                      detailsCampaign.users.slice(0, 12).map((agent) => (
                        <div key={agent.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                          <span className="font-medium text-foreground">{agent.name}</span>
                          <span className="text-muted-foreground">{agent.monthlyTarget !== null ? formatNumber(agent.monthlyTarget) : 'No target'}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
                  <p className="text-sm font-semibold text-foreground">History</p>
                  <div className="mt-3 space-y-2">
                    {campaignHistory.length === 0 ? (
                      <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">No saved history for this campaign yet.</p>
                    ) : (
                      campaignHistory.map((row) => (
                        <div key={`${row.campaignId}-${row.year}-${row.month}`} className="rounded-lg bg-muted/40 p-3 text-sm">
                          <div className="flex justify-between gap-3">
                            <span className="font-semibold text-foreground">{MONTH_NAMES[row.month - 1]} {row.year}</span>
                            <span className="text-muted-foreground">{formatNumber(row.monthlyGoal)}</span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {metricLabel(row.kpiMetric)} - Updated {new Date(row.updatedAt).toLocaleString()}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
                  <p className="text-sm font-semibold text-foreground">Recent Updates</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {detailsCampaign.updatedAt
                      ? `Latest campaign data was updated on ${new Date(detailsCampaign.updatedAt).toLocaleString()}.`
                      : 'No recent update timestamp is available for this campaign.'}
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="flex-1 bg-blue-600 text-white hover:bg-blue-700"
                    onClick={() => {
                      applySelectedCampaign(detailsCampaign);
                      setDetailsCampaign(null);
                      setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                    }}
                  >
                    Edit Campaign
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setDetailsCampaign(null)}>
                    Close
                  </Button>
                </div>
              </div>
            </aside>
          </div>
        );
      })()}

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={
          confirmAction?.type === 'soft-delete'
            ? 'Delete Goal Configuration'
            : confirmAction?.type === 'restore'
            ? 'Restore Goal Configuration'
            : 'Permanently Delete Goal Configuration'
        }
        description={
          confirmAction?.type === 'soft-delete'
            ? `Delete ${confirmAction.items.length} selected goal configuration(s)? You can restore deleted records from the trash section.`
            : confirmAction?.type === 'restore'
            ? `Restore ${confirmAction.items.length} selected goal configuration(s)?`
            : `Permanently delete ${confirmAction?.items.length || 0} selected goal configuration(s)? This cannot be undone.`
        }
        actionLabel={
          confirmAction?.type === 'soft-delete'
            ? 'Delete'
            : confirmAction?.type === 'restore'
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
