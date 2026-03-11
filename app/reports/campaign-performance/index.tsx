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

export default function CampaignPerformanceIndexPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

      {campaigns.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-gray-600">No campaigns available</p>
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
