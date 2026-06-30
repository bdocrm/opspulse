"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PageTitle } from "@/components/layout/page-title";

interface Campaign {
  id: string;
  campaignName: string;
  monthlyGoal: number;
  kpiMetric: string;
}

interface OverallCampaignPerformance {
  totalGoal: number;
  totalActual: number;
  achievementRate: number;
  targetHit: boolean;
  campaignCount: number;
}

type CampaignPerformanceSummaryMap = Record<string, OverallCampaignPerformance>;

const achievementTextClass = (value: number) => {
  if (value >= 100) return "text-green-600";
  if (value >= 80) return "text-amber-600";
  return "text-red-600";
};

const actualTextClass = (value: number) => (value > 0 ? "text-green-600" : "text-red-600");

function OverallCampaignPerformanceCard({
  summary,
  loading,
}: {
  summary: OverallCampaignPerformance | null;
  loading: boolean;
}) {
  const totalGoal = summary?.totalGoal ?? 0;
  const totalActual = summary?.totalActual ?? 0;
  const achievementRate = summary?.achievementRate ?? 0;
  const targetHit = summary?.targetHit ?? false;

  return (
    <Card className="p-5 border-slate-200 bg-white shadow-sm">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Overall Campaign Performance</h2>
          <p className="text-sm text-slate-500">
            {loading ? "Calculating current performance..." : `${summary?.campaignCount ?? 0} campaign${summary?.campaignCount === 1 ? "" : "s"} included`}
          </p>
        </div>
        <span
          className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
            targetHit ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {targetHit ? "HIT" : "MISSED"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Total Goal", value: totalGoal.toLocaleString(), className: "text-blue-600" },
          { label: "Total Actual", value: totalActual.toLocaleString(), className: actualTextClass(totalActual) },
          { label: "Achievement Rate", value: `${achievementRate.toFixed(1)}%`, className: achievementTextClass(achievementRate) },
          { label: "Target Status", value: targetHit ? "HIT" : "MISSED", className: targetHit ? "text-green-600" : "text-red-600" },
        ].map(({ label, value, className }) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
            <p className={`mt-2 text-2xl font-bold ${loading ? "text-slate-400" : className}`}>
              {loading ? "..." : value}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function CampaignPerformanceIndexPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overallSummary, setOverallSummary] = useState<OverallCampaignPerformance | null>(null);
  const [campaignSummaries, setCampaignSummaries] = useState<CampaignPerformanceSummaryMap>({});
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        const res = await fetch("/api/campaigns");
        if (!res.ok) throw new Error("Failed to fetch campaigns");
        const data = await res.json();
        setCampaigns(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load campaigns");
      } finally {
        setLoading(false);
      }
    };

    fetchCampaigns();
  }, []);

  useEffect(() => {
    if (campaigns.length === 0) {
      setOverallSummary(null);
      setCampaignSummaries({});
      return;
    }

    let cancelled = false;
    const fetchOverallPerformance = async () => {
      setSummaryLoading(true);
      try {
        const results = await Promise.allSettled(
          campaigns.map((campaign) =>
            fetch(`/api/reports/campaign-performance?campaignId=${campaign.id}`).then((res) => {
              if (!res.ok) throw new Error(`Failed to fetch ${campaign.campaignName}`);
              return res.json();
            })
          )
        );

        const fulfilledResults = results.filter(
          (result): result is PromiseFulfilledResult<any> => result.status === "fulfilled"
        );
        const summariesByCampaign = fulfilledResults.reduce<CampaignPerformanceSummaryMap>((acc, result) => {
          acc[result.value.campaign.id] = {
            ...result.value.overallPerformance,
            campaignCount: 1,
          };
          return acc;
        }, {});
        const summaries = fulfilledResults.map((result) => result.value.overallPerformance);

        const totalGoal = summaries.reduce((sum, item) => sum + Number(item.totalGoal || 0), 0);
        const totalActual = summaries.reduce((sum, item) => sum + Number(item.totalActual || 0), 0);
        const achievementRate = totalGoal > 0 ? (totalActual / totalGoal) * 100 : 0;

        if (!cancelled) {
          setOverallSummary({
            totalGoal,
            totalActual,
            achievementRate,
            targetHit: totalGoal > 0 && totalActual >= totalGoal,
            campaignCount: summaries.length,
          });
          setCampaignSummaries(summariesByCampaign);
        }
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    };

    fetchOverallPerformance();

    return () => {
      cancelled = true;
    };
  }, [campaigns]);

  if (loading)
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-lg">Loading campaigns...</div>
      </div>
    );

  if (error)
    return (
      <div className="p-6 text-red-600">
        <p>Error: {error}</p>
      </div>
    );

  return (
    <div className="space-y-6 p-6">
      <PageTitle
        title="Agent Performance Analysis"
        subtitle="Select a campaign to view detailed agent performance metrics"
      />

      {campaigns.length > 0 && (
        <OverallCampaignPerformanceCard summary={overallSummary} loading={summaryLoading} />
      )}

      {campaigns.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-gray-600">No campaigns available</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns.map((campaign) => {
            const campaignSummary = campaignSummaries[campaign.id];
            const campaignGoal = campaignSummary?.totalGoal ?? campaign.monthlyGoal;
            const campaignActual = campaignSummary?.totalActual ?? 0;
            const campaignAchievement = campaignSummary?.achievementRate ?? 0;
            return (
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
                    <span className="font-semibold text-blue-600">
                      {campaignGoal.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>KPI Metric:</span>
                    <span className="font-semibold text-gray-800 capitalize">
                      {campaign.kpiMetric}
                    </span>
                  </div>
                </div>
                <div className="mt-4 space-y-2 border-t pt-4 text-sm text-gray-600">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overall Performance</p>
                  <div className="flex justify-between">
                    <span>Total Actual:</span>
                    <span className={`font-semibold ${summaryLoading ? "text-slate-400" : actualTextClass(campaignActual)}`}>
                      {summaryLoading ? "..." : campaignActual.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Achievement:</span>
                    <span className={`font-semibold ${summaryLoading ? "text-slate-400" : achievementTextClass(campaignAchievement)}`}>
                      {summaryLoading ? "..." : `${campaignAchievement.toFixed(1)}%`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Status:</span>
                    <span className={`font-bold ${campaignSummary?.targetHit ? "text-green-600" : "text-red-600"}`}>
                      {summaryLoading ? "..." : campaignSummary?.targetHit ? "HIT" : "MISSED"}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
