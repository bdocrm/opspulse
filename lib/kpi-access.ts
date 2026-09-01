import type { Session } from "next-auth";
import { canViewPerformance, canImport, isExecutiveRole } from "@/lib/permissions";

export type KpiSessionUser = {
  id?: string;
  role?: string;
  campaignId?: string | null;
  campaignIds?: string[];
};

export function getKpiSessionUser(session: Session | null): KpiSessionUser | null {
  return session?.user ? (session.user as KpiSessionUser) : null;
}

export function getSessionCampaignIds(user: KpiSessionUser) {
  return Array.from(
    new Set(
      [user.campaignId, ...(Array.isArray(user.campaignIds) ? user.campaignIds : [])].filter(
        Boolean
      ) as string[]
    )
  );
}

export function canViewKpi(user: KpiSessionUser) {
  return canViewPerformance(user.role);
}

export function canImportKpi(user: KpiSessionUser) {
  // Validated against the centralized permission map in lib/permissions.ts.
  return canImport(user.role);
}

export function hasCampaignAccess(user: KpiSessionUser, campaignId: string) {
  if (isExecutiveRole(user.role)) return true;
  return getSessionCampaignIds(user).includes(campaignId);
}

export function scopedCampaignWhere(user: KpiSessionUser) {
  if (isExecutiveRole(user.role)) return {};
  return { campaignId: { in: getSessionCampaignIds(user) } };
}
