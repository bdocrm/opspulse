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
  users: Array<{
    id: string;
    name: string;
    seatNumber: number;
    monthlyTarget: number | null;
  }>;
}

export default function GoalsManagement() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const user = session?.user as any;

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [monthlyGoal, setMonthlyGoal] = useState('');
  const [kpiMetric, setKpiMetric] = useState('');
  const [agentTarget, setAgentTarget] = useState<Record<string, number>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Redirect if not authorized
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated' && !['CEO', 'OM'].includes(user?.role)) {
      router.push('/dashboard');
    }
  }, [status, user?.role, router]);

  // Fetch campaigns
  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        const res = await fetch('/api/goals');
        if (res.ok) {
          const data = await res.json();
          setCampaigns(data);
          if (data.length > 0) {
            setSelectedCampaign(data[0]);
            setMonthlyGoal(data[0].monthlyGoal.toString());
            setKpiMetric(data[0].kpiMetric || '');
            // Initialize agent targets
            const targets: Record<string, number> = {};
            data[0].users.forEach((u: any) => {
              targets[u.id] = u.monthlyTarget || 0;
            });
            setAgentTarget(targets);
          }
        }
      } catch (err) {
        console.error('Failed to fetch campaigns:', err);
        setError('Failed to load campaigns');
      } finally {
        setLoading(false);
      }
    };

    if (status === 'authenticated') {
      fetchCampaigns();
    }
  }, [status]);

  const handleCampaignChange = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setMonthlyGoal(campaign.monthlyGoal.toString());
    setKpiMetric(campaign.kpiMetric || '');
    const targets: Record<string, number> = {};
    campaign.users.forEach((u: any) => {
      targets[u.id] = u.monthlyTarget || 0;
    });
    setAgentTarget(targets);
    setMessage('');
    setError('');
  };

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
          kpiMetric: kpiMetric || selectedCampaign.kpiMetric,
        }),
      });

      if (res.ok) {
        setMessage('Campaign goal updated successfully');
        // Refresh data
        const fsRes = await fetch('/api/goals');
        if (fsRes.ok) {
          const data = await fsRes.json();
          const updated = data.find((c: Campaign) => c.id === selectedCampaign.id);
          if (updated) {
            setSelectedCampaign(updated);
          }
        }
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update goal');
      }
    } catch (err) {
      console.error('Error saving goal:', err);
      setError('Failed to save campaign goal');
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
        body: JSON.stringify({
          userId,
          monthlyTarget: Number(target),
        }),
      });

      if (res.ok) {
        setMessage('Agent target updated successfully');
        // Update local agent data
        if (selectedCampaign) {
          const updated = { ...selectedCampaign };
          const agent = updated.users.find((u) => u.id === userId);
          if (agent) {
            agent.monthlyTarget = Number(target);
          }
          setSelectedCampaign(updated);
        }
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update agent target');
      }
    } catch (err) {
      console.error('Error saving agent target:', err);
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

  return (
    <div className="space-y-6">
      <PageTitle title="Goals Management" subtitle="Set campaign and agent targets" />

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
          {/* Campaign Goal Section */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Campaign Goal</h3>
            <div className="space-y-4">
              <div>
                <Label htmlFor="kpi">KPI Metric</Label>
                <Input
                  id="kpi"
                  value={kpiMetric}
                  onChange={(e) => setKpiMetric(e.target.value)}
                  placeholder="e.g., Units, Revenue, Orders"
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="monthly-goal">Monthly Goal</Label>
                <Input
                  id="monthly-goal"
                  type="number"
                  value={monthlyGoal}
                  onChange={(e) => setMonthlyGoal(e.target.value)}
                  placeholder="Enter monthly goal"
                  className="mt-1"
                />
              </div>

              <div>
                <Label>Weekly Breakdown (Suggested)</Label>
                <div className="mt-2 grid grid-cols-5 gap-2">
                  {['W1', 'W2', 'W3', 'W4', 'W5'].map((week, idx) => {
                    const weekGoal = Math.round(
                      Number(monthlyGoal || 0) / 5
                    );
                    return (
                      <div
                        key={week}
                        className="bg-blue-50 border border-blue-200 rounded p-3 text-center"
                      >
                        <div className="text-xs font-medium text-blue-600">{week}</div>
                        <div className="text-lg font-bold text-blue-900 mt-1">
                          {weekGoal.toLocaleString()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Button
                onClick={handleSaveCampaignGoal}
                disabled={saving}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Campaign Goal'
                )}
              </Button>
            </div>
          </Card>

          {/* Agent Targets Section */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">
              Agent Targets ({selectedCampaign.users.length} agents)
            </h3>
            {selectedCampaign.users.length === 0 ? (
              <p className="text-sm text-gray-500">No agents assigned to this campaign</p>
            ) : (
              <div className="space-y-3">
                {selectedCampaign.users.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-end gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <div className="flex-1">
                      <Label className="text-xs text-gray-600">
                        Seat {agent.seatNumber}
                      </Label>
                      <div className="font-semibold text-gray-900">{agent.name}</div>
                    </div>

                    <div className="flex-1">
                      <Label htmlFor={`agent-${agent.id}`} className="text-xs text-gray-600">
                        Monthly Target
                      </Label>
                      <Input
                        id={`agent-${agent.id}`}
                        type="number"
                        value={agentTarget[agent.id] || 0}
                        onChange={(e) =>
                          setAgentTarget({
                            ...agentTarget,
                            [agent.id]: Number(e.target.value),
                          })
                        }
                        placeholder="0"
                        className="mt-1"
                      />
                    </div>

                    <Button
                      onClick={() => handleSaveAgentTarget(agent.id)}
                      disabled={saving}
                      size="sm"
                      variant="outline"
                      className="h-10"
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Save'
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Summary Card */}
          <Card className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
            <h3 className="font-semibold text-gray-900 mb-3">Summary</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-gray-600">Campaign Monthly Goal</div>
                <div className="text-2xl font-bold text-blue-600">
                  {Number(monthlyGoal || 0).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-gray-600">Total Agent Targets</div>
                <div className="text-2xl font-bold text-indigo-600">
                  {Object.values(agentTarget)
                    .reduce((sum, val) => sum + (val || 0), 0)
                    .toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-gray-600">Assigned Agents</div>
                <div className="text-2xl font-bold text-gray-900">
                  {selectedCampaign.users.length}
                </div>
              </div>
              <div>
                <div className="text-gray-600">Balance (Campaign - Agents)</div>
                <div
                  className={`text-2xl font-bold ${
                    Number(monthlyGoal || 0) >=
                    Object.values(agentTarget).reduce((sum, val) => sum + (val || 0), 0)
                      ? 'text-green-600'
                      : 'text-orange-600'
                  }`}
                >
                  {(
                    Number(monthlyGoal || 0) -
                    Object.values(agentTarget).reduce((sum, val) => sum + (val || 0), 0)
                  ).toLocaleString()}
                </div>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
