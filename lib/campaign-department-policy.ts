import { normalizeProductionName, productionDisplayName } from "./production-normalization";

/**
 * Builds a stable canonical name for a genuine subcampaign that is scoped by
 * an existing account/department. This is intentionally data-driven: new
 * source campaign values do not require a hard-coded list.
 */
export function scopedCampaignDepartmentName(sourceAccount: unknown, sourceCampaign: unknown) {
  const account = productionDisplayName(sourceAccount);
  const campaign = productionDisplayName(sourceCampaign);
  const normalizedAccount = normalizeProductionName(account);
  const normalizedCampaign = normalizeProductionName(campaign);
  if (!normalizedAccount || !normalizedCampaign || normalizedAccount === normalizedCampaign) return null;
  return productionDisplayName(`${account} ${campaign}`);
}

