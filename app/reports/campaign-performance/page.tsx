'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageTitle } from '@/components/layout/page-title';

interface Campaign {
  id: string;
  campaignName: string;
  monthlyGoal: number;
  kpiMetric: string;
}

interface AgentPerformance {
  id: string;
  name: string;
  level: string;
  goal: number;
  actual: number;
  achievement: number;
  status: "hit" | "near" | "missed";
}

interface CampaignPerformanceData {
  campaign: any;
  overallPerformance: any;
  topPerformers: AgentPerformance[];
  needingAttention: AgentPerformance[];
  critical: AgentPerformance[];
  breakdown: any;
  allAgents: AgentPerformance[];
  recommendations: string[];
}

function CampaignSelectorView({ campaigns }: { campaigns: Campaign[] }) {
  const [isSeeding, setIsSeeding] = useState(false);

  const createTestData = async () => {
    setIsSeeding(true);
    try {
      const res = await fetch("/api/dev/seed-test-data", { method: "POST" });
      if (res.ok) {
        location.reload();
      } else {
        alert("Failed to create test data");
      }
    } catch (err) {
      alert("Error creating test data: " + String(err));
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageTitle
        title="Agent Performance Analysis"
        subtitle="Select a campaign to view detailed agent performance metrics"
      />

      {campaigns.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-gray-600 mb-4">No campaigns available</p>
          <Button
            onClick={createTestData}
            disabled={isSeeding}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isSeeding ? "Creating..." : "Create Test Data"}
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns.map((campaign) => (
            <Link
              key={campaign.id}
              href={`/reports/campaign-performance?campaignId=${campaign.id}`}
            >
              <Card className="p-6 cursor-pointer hover:shadow-lg hover:border-blue-400 transition-all h-full">
                <h3 className="text-lg font-bold text-gray-800 mb-3">
                  {campaign.campaignName}
                </h3>
                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span>Monthly Goal:</span>
                    <span className="font-semibold text-gray-800">
                      {campaign.monthlyGoal.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>KPI Metric:</span>
                    <span className="font-semibold text-gray-800 capitalize">
                      {campaign.kpiMetric}
                    </span>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t">
                  <span className="text-blue-600 font-semibold text-sm hover:text-blue-800">
                    View Performance Report →
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignDetailView({
  data,
  campaign: campaignData,
}: {
  data: CampaignPerformanceData;
  campaign: Campaign;
}) {
  const {
    campaign,
    overallPerformance,
    topPerformers,
    needingAttention,
    critical,
    breakdown,
    allAgents,
    recommendations,
  } = data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-start">
        <PageTitle
          title={`Campaign Performance: ${campaign.name}`}
          subtitle={`${campaign.kpiMetric.charAt(0).toUpperCase() + campaign.kpiMetric.slice(1)} Analysis`}
        />
        <Link href="/reports/campaign-performance">
          <Button variant="outline">← Back to Campaigns</Button>
        </Link>
      </div>

      {/* Overall Performance Summary */}
      <Card className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-indigo-200">
        <h2 className="text-2xl font-bold mb-6 text-gray-800">
          📊 Overall Campaign Performance
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <p className="text-sm text-gray-600">Total Goal</p>
            <p className="text-2xl font-bold text-blue-600">
              {overallPerformance.totalGoal.toLocaleString()}
            </p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <p className="text-sm text-gray-600">Total Actual</p>
            <p className="text-2xl font-bold text-green-600">
              {overallPerformance.totalActual.toLocaleString()}
            </p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <p className="text-sm text-gray-600">Achievement Rate</p>
            <p className="text-2xl font-bold text-purple-600">
              {overallPerformance.achievementRate}%
            </p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <p className="text-sm text-gray-600">Target Status</p>
            <p
              className={`text-2xl font-bold ${
                overallPerformance.targetHit
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              {overallPerformance.targetHit ? "✅ HIT" : "❌ MISSED"}
            </p>
          </div>
        </div>
      </Card>

      {/* Top Performers */}
      <Card className="p-6 bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
        <h2 className="text-2xl font-bold mb-4 text-gray-800">
          🏆 Top 5 Performers
        </h2>
        <div className="space-y-3">
          {topPerformers.map((agent, idx) => (
            <div
              key={agent.id}
              className="bg-white p-4 rounded-lg shadow-sm flex justify-between items-start"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="bg-yellow-400 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center">
                    #{idx + 1}
                  </span>
                  <span className="font-semibold text-gray-800">
                    {agent.name}
                  </span>
                  <span
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      agent.level === "CORE"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-green-100 text-green-800"
                    }`}
                  >
                    {agent.level}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  Goal: {agent.goal.toLocaleString()} | Actual:{" "}
                  {agent.actual.toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-green-600">
                  {agent.achievement}%
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* CORE vs ROOKIE Breakdown */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="p-6 bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-200">
          <h2 className="text-xl font-bold mb-4 text-gray-800">🔹 CORE Agents</h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-700">Total Agents:</span>
              <span className="font-bold">{breakdown.core.total}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-700">Met Goal:</span>
              <span className="font-bold text-green-600">{breakdown.core.met}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-700">Missed Goal:</span>
              <span className="font-bold text-red-600">
                {breakdown.core.missed}
              </span>
            </div>
            <div className="bg-white p-3 rounded-lg mt-4 border-l-4 border-blue-500">
              <p className="text-sm text-gray-600">Avg Achievement</p>
              <p className="text-2xl font-bold text-blue-600">
                {breakdown.core.averageAchievement}%
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-green-50 to-teal-50 border-green-200">
          <h2 className="text-xl font-bold mb-4 text-gray-800">
            🟢 ROOKIE Agents
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-700">Total Agents:</span>
              <span className="font-bold">{breakdown.rookie.total}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-700">Met Goal:</span>
              <span className="font-bold text-green-600">
                {breakdown.rookie.met}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-700">Missed Goal:</span>
              <span className="font-bold text-red-600">
                {breakdown.rookie.missed}
              </span>
            </div>
            <div className="bg-white p-3 rounded-lg mt-4 border-l-4 border-green-500">
              <p className="text-sm text-gray-600">Avg Achievement</p>
              <p className="text-2xl font-bold text-green-600">
                {breakdown.rookie.averageAchievement}%
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Agents Needing Attention */}
      <Card className="p-6 bg-gradient-to-r from-yellow-50 to-orange-50 border-yellow-200">
        <h2 className="text-xl font-bold mb-4 text-gray-800">
          ⚠️ Agents Needing Attention ({needingAttention.length})
        </h2>
        {critical.length > 0 && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded">
            <p className="font-semibold text-red-700 mb-2">
              🚨 CRITICAL: {critical.length} agents below 70%
            </p>
            <ul className="text-sm text-red-600 space-y-1">
              {critical.map((agent) => (
                <li key={agent.id}>
                  • {agent.name} ({agent.achievement}%) - Immediate coaching
                  needed
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="space-y-2">
          {needingAttention.map((agent) => (
            <div
              key={agent.id}
              className={`p-4 rounded-lg ${
                agent.achievement < 70
                  ? "bg-red-50 border-l-4 border-red-500"
                  : "bg-white border-l-4 border-yellow-500"
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-gray-800">{agent.name}</p>
                  <p className="text-sm text-gray-600">
                    {agent.level} | Goal: {agent.goal.toLocaleString()} | Actual:{" "}
                    {agent.actual.toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-xl font-bold ${
                      agent.achievement < 70
                        ? "text-red-600"
                        : "text-yellow-600"
                    }`}
                  >
                    {agent.achievement}%
                  </p>
                  <p className="text-xs text-gray-500">
                    {agent.achievement < 70 ? "🔴 Critical" : "🟡 Near Miss"}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Individual Agent Scorecard */}
      <Card className="p-6">
        <h2 className="text-xl font-bold mb-4 text-gray-800">
          📋 Individual Agent Scorecard
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b-2 border-gray-300">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Level</th>
                <th className="px-4 py-2 text-right">Goal</th>
                <th className="px-4 py-2 text-right">Actual</th>
                <th className="px-4 py-2 text-right">Achievement %</th>
                <th className="px-4 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {allAgents.map((agent) => (
                <tr key={agent.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {agent.name}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        agent.level === "CORE"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-green-100 text-green-800"
                      }`}
                    >
                      {agent.level}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.goal.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {agent.actual.toLocaleString()}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-bold ${
                      agent.achievement >= 100
                        ? "text-green-600"
                        : agent.achievement >= 70
                          ? "text-yellow-600"
                          : "text-red-600"
                    }`}
                  >
                    {agent.achievement}%
                  </td>
                  <td className="px-4 py-3 text-center">
                    {agent.status === "hit" && "✅ Hit"}
                    {agent.status === "near" && "⚠️ Near"}
                    {agent.status === "missed" && "❌ Missed"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Team Leader Action Points */}
      <Card className="p-6 bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
        <h2 className="text-2xl font-bold mb-4 text-gray-800">
          💡 Team Leader Action Points
        </h2>
        <div className="space-y-3">
          {recommendations.map((rec, idx) => (
            <div
              key={idx}
              className="bg-white p-4 rounded-lg shadow-sm border-l-4 border-purple-500"
            >
              <p className="text-gray-800">{rec}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Export Button */}
      <div className="flex justify-end gap-4">
        <Button
          onClick={() => window.print()}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          🖨️ Print Report
        </Button>
      </div>
    </div>
  );
}

function CampaignPerformancePageContent() {
  const searchParams = useSearchParams();
  const campaignId = searchParams.get("campaignId");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [data, setData] = useState<CampaignPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        const res = await fetch("/api/campaigns");
        if (!res.ok) throw new Error(`Failed to fetch campaigns: ${res.status}`);
        const result = await res.json();
        setCampaigns(Array.isArray(result) ? result : result.campaigns || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load campaigns");
      }
    };

    fetchCampaigns();
  }, []);

  useEffect(() => {
    if (!campaignId) {
      setLoading(false);
      return;
    }

    const fetchPerformance = async () => {
      try {
        const res = await fetch(
          `/api/reports/campaign-performance?campaignId=${campaignId}`
        );
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    fetchPerformance();
  }, [campaignId]);

  if (loading)
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );

  if (error)
    return (
      <div className="p-6 min-h-screen">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-700 font-semibold mb-2">Error Loading Data:</p>
          <p className="text-red-600 text-sm">{error}</p>
          <p className="text-red-500 text-xs mt-4">Check the browser console for more details.</p>
        </div>
      </div>
    );

  // Show campaign selector if no campaignId
  if (!campaignId) {
    return <CampaignSelectorView campaigns={campaigns} />;
  }

  // Show detail view if campaignId provided
  if (!data) {
    return (
      <div className="p-6">
        <p>No data available</p>
      </div>
    );
  }

  const selectedCampaign = campaigns.find((c) => c.id === campaignId);

  return (
    <CampaignDetailView
      data={data}
      campaign={selectedCampaign || { id: campaignId, campaignName: "Unknown", monthlyGoal: 0, kpiMetric: "" }}
    />
  );
}

export default function CampaignPerformancePage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center min-h-screen">
          <div className="text-lg">Loading...</div>
        </div>
      }
    >
      <CampaignPerformancePageContent />
    </Suspense>
  );
}
