import type { Session } from "next-auth";

export type ProductionSessionUser = {
  id?: string;
  role?: string;
  campaignId?: string | null;
  campaignIds?: string[];
};

export function getProductionSessionUser(session: Session | null) {
  return session?.user ? (session.user as ProductionSessionUser) : null;
}

export function canViewProduction(user: ProductionSessionUser) {
  return ["CEO", "SMT", "OM", "COLLECTOR", "AGENT"].includes(user.role ?? "");
}

export function canAdminProduction(user: ProductionSessionUser) {
  // OpsView currently uses CEO as its administrator role.
  return user.role === "CEO";
}

export function canImportProduction(user: ProductionSessionUser) {
  // Collectors already own the existing Bulk Data Import workflow. They may
  // import Production Monitoring rows only into campaigns assigned to them;
  // creating a brand-new campaign remains a CEO-only action.
  return user.role === "CEO" || user.role === "COLLECTOR";
}

export function productionCampaignIds(user: ProductionSessionUser) {
  return Array.from(new Set([
    user.campaignId,
    ...(Array.isArray(user.campaignIds) ? user.campaignIds : []),
  ].filter(Boolean) as string[]));
}

export function productionCampaignScope(user: ProductionSessionUser) {
  if (user.role === "CEO" || user.role === "SMT") return {};
  return { campaignId: { in: productionCampaignIds(user) } };
}

export function hasProductionCampaignAccess(user: ProductionSessionUser, campaignId: string) {
  return user.role === "CEO" || user.role === "SMT" || productionCampaignIds(user).includes(campaignId);
}
