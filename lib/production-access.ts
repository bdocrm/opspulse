import type { Session } from "next-auth";
import { canViewPerformance, canImport, isExecutiveRole, isSystemAdmin } from "@/lib/permissions";

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
  return canViewPerformance(user.role);
}

export function canAdminProduction(user: ProductionSessionUser) {
  // OpsView uses CEO as its administrator role.
  return isSystemAdmin(user.role);
}

export function canImportProduction(user: ProductionSessionUser) {
  // Collectors already own the existing Bulk Data Import workflow. They may
  // import Production Monitoring rows only into campaigns assigned to them;
  // creating a brand-new campaign remains a CEO-only action.
  return canImport(user.role);
}

export function canViewCampaignMappings(user: ProductionSessionUser) {
  return canImportProduction(user) || canAdminProduction(user);
}

export function canCreateCampaignMappings(user: ProductionSessionUser) {
  return canImportProduction(user);
}

export function canManageCampaignMappings(user: ProductionSessionUser) {
  return canAdminProduction(user);
}

export function productionCampaignIds(user: ProductionSessionUser) {
  return Array.from(new Set([
    user.campaignId,
    ...(Array.isArray(user.campaignIds) ? user.campaignIds : []),
  ].filter(Boolean) as string[]));
}

export function productionCampaignScope(user: ProductionSessionUser) {
  if (isExecutiveRole(user.role)) return {};
  return { campaignId: { in: productionCampaignIds(user) } };
}

export function hasProductionCampaignAccess(user: ProductionSessionUser, campaignId: string) {
  return isExecutiveRole(user.role) || productionCampaignIds(user).includes(campaignId);
}
