import type { Session } from "next-auth";

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
  return ["CEO", "SMT", "OM", "COLLECTOR", "AGENT"].includes(user.role ?? "");
}

export function canImportKpi(user: KpiSessionUser) {
  // OpsView has no granular permissions table yet. These are the existing roles
  // responsible for organization, operations, and collector imports.
  return ["CEO", "OM", "COLLECTOR"].includes(user.role ?? "");
}

export function hasCampaignAccess(user: KpiSessionUser, campaignId: string) {
  if (user.role === "CEO" || user.role === "SMT") return true;
  return getSessionCampaignIds(user).includes(campaignId);
}

export function scopedCampaignWhere(user: KpiSessionUser) {
  if (user.role === "CEO" || user.role === "SMT") return {};
  return { campaignId: { in: getSessionCampaignIds(user) } };
}
