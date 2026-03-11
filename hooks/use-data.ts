"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useDashboardData(period: string, month?: string, year?: string) {
  const params = new URLSearchParams({ period });
  if (month) params.set("month", month);
  if (year) params.set("year", year);
  return useSWR(`/api/dashboard?${params.toString()}`, fetcher);
}

export function useCampaigns() {
  return useSWR("/api/campaigns", fetcher);
}

export function useCampaignDetail(id: string, period: string) {
  return useSWR(`/api/campaigns/${id}?period=${period}`, fetcher);
}

export function useAgents(period: string, campaignId?: string) {
  const params = new URLSearchParams({ period });
  if (campaignId) params.set("campaignId", campaignId);
  return useSWR(`/api/agents?${params.toString()}`, fetcher);
}

export function useUsers() {
  return useSWR("/api/users", fetcher);
}
