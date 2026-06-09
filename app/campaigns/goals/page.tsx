'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageTitle } from '@/components/layout/page-title';
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

interface Campaign {
  id: string;
  campaignName: string;
  kpiMetric: string;
  monthlyGoal: number;
  workingDays: number;
  daysLapsed: number;
  users: Array<{
    id: string;
    name: string;
    seatNumber: number;
    monthlyTarget: number | null;
  }>;
}

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

export default function GoalsManagement() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const user = session?.user as any;

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  // Campaign-level fields
  const [monthlyGoal, setMonthlyGoal] = useState('');
  const [kpiMetric, setKpiMetric] = useState('');
  const [workingDays, setWorkingDays] = useState('22');
  const [daysLapsed, setDaysLapsed] = useState('0');

  const [agentTarget, setAgentTarget] = useState<Record<string, number>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated' && !['CEO', 'OM'].includes(user?.role)) {
      router.push('/dashboard');
    }
  }, [status, user?.role, router]);

  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        const res = await fetch('/api/goals');
        if (res.ok) {
          const data = await res.json();
          setCampaigns(data);
          if (data.length > 0) {
            applySelectedCampaign(data[0]);
          }
        }
      } catch {
        setError('Failed to load campaigns');
      } finally {
        setLoading(false);
      }
    };

    if (status === 'authenticated') fetchCampaigns();
  }, [status]);

  function applySelectedCampaign(campaign: Campaign) {
    setSelectedCampaign(campaign);
    setMonthlyGoal(campaign.monthlyGoal.toString());
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

    setSaving(true);
    setMessage('');
    setError('');

    try {
      const res = await fetch('/api/goals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: selectedCampaign.id,
          monthlyGoal: Number(monthlyGoal),
          kpiMetric,
          workingDays: Number(workingDays) || 22,
          daysLapsed: Number(daysLapsed) || 0,
        }),
      });

      if (res.ok) {
        setMessage('Campaign settings saved successfully');
        const fsRes = await fetch('/api/goals');
        if (fsRes.ok) {
          const data = await fsRes.json();
          setCampaigns(data);
          const updated = data.find((c: Campaign) => c.id === selectedCampaign.id);
          if (updated) setSelectedCampaign(updated);
        }
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update goal');
      }
    } catch {
      setError('Failed to save campaign settings');
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

    setSaving(true);
    setMessage('');
    setError('');

    try {
      const res = await fetch('/api/goals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, monthlyTarget: Number(target) }),
      });

      if (res.ok) {
        setMessage('Agent target updated successfully');
        if (selectedCampaign) {
          const updated = { ...selectedCampaign };
          const agent = updated.users.find((u) => u.id === userId);
          if (agent) agent.monthlyTarget = Number(target);
          setSelectedCampaign(updated);
        }
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update agent target');
      }
    } catch {
      setError('Failed to save agent target');
    } finally {
      setSaving(false);
    }
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
  const goal = Number(monthlyGoal) || 0;
  const weekGoal = goal > 0 ? Math.round(goal / 4) : 0;

  // Preview KPI formulas with placeholder MTD
  const previewMTD = goal > 0 ? Math.round(goal * (dLapsed / Math.max(wDays, 1))) : 0;
  const previewRR = dLapsed > 0 ? Math.round((previewMTD / dLapsed) * wDays) : 0;
  const previewAch = goal > 0 ? ((previewMTD / goal) * 100).toFixed(1) : '0.0';
  const previewRRAch = goal > 0 ? ((previewRR / goal) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-6">
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

      {/* Campaign Selection */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Select Campaign</h3>
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
      </Card>

      {selectedCampaign && (
        <>
          {/* Campaign Goal & Run Rate Config */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Campaign Goal &amp; Run Rate Settings</h3>
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
                  type="number"
                  min={0}
                  value={monthlyGoal}
                  onChange={(e) => setMonthlyGoal(e.target.value)}
                  placeholder="e.g. 220"
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
                  <div key={week} className="bg-blue-50 border border-blue-200 rounded p-3 text-center">
                    <div className="text-xs font-medium text-blue-600">{week}</div>
                    <div className="text-lg font-bold text-blue-900 mt-1">
                      {weekGoal.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Formula preview */}
            <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Formula Preview (on-pace estimate)</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm">
                <div>
                  <p className="text-xs text-gray-400">MTD (on pace)</p>
                  <p className="text-lg font-bold text-gray-800">{previewMTD.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">sum W1–W4</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Achievement</p>
                  <p className="text-lg font-bold text-blue-700">{previewAch}%</p>
                  <p className="text-xs text-gray-400">MTD / Goal</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Run Rate</p>
                  <p className="text-lg font-bold text-gray-800">{previewRR.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">MTD / Lapsed × WDays</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">RR Achievement</p>
                  <p className="text-lg font-bold text-blue-700">{previewRRAch}%</p>
                  <p className="text-xs text-gray-400">Run Rate / Goal</p>
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
          </Card>

          {/* Agent Targets */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">
              Agent Targets
              <span className="ml-2 text-sm font-normal text-gray-500">({selectedCampaign.users.length} agents)</span>
            </h3>
            {selectedCampaign.users.length === 0 ? (
              <p className="text-sm text-gray-500">No agents assigned to this campaign</p>
            ) : (
              <div className="space-y-3">
                {selectedCampaign.users.map((agent) => (
                  <div key={agent.id} className="flex items-end gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex-1">
                      <Label className="text-xs text-gray-500">
                        {agent.seatNumber ? `Seat ${agent.seatNumber}` : 'No seat'}
                      </Label>
                      <div className="font-semibold text-gray-900">{agent.name}</div>
                    </div>
                    <div className="w-36">
                      <Label htmlFor={`agent-${agent.id}`} className="text-xs text-gray-500">Monthly Target</Label>
                      <Input
                        id={`agent-${agent.id}`}
                        type="number"
                        min={0}
                        value={agentTarget[agent.id] ?? 0}
                        onChange={(e) => setAgentTarget({ ...agentTarget, [agent.id]: Number(e.target.value) })}
                        className="mt-1"
                      />
                    </div>
                    <Button
                      onClick={() => handleSaveAgentTarget(agent.id)}
                      disabled={saving}
                      size="sm"
                      variant="outline"
                      className="h-10 shrink-0"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
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
    </div>
  );
}
