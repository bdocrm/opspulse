import { normalizeProductionName } from "../production-normalization";

type Campaign = { id: string; name: string; aliases: string[] };
function variants(value: string) {
  const normalized = normalizeProductionName(value).replace(/\s+CAMPAIGN$/, "");
  const tokens = normalized.split(" ").filter(Boolean);
  return { compact: tokens.join(""), ordered: [...tokens].sort().join(" ") };
}

export function matchImportCampaign(source: string, campaigns: Campaign[]) {
  const normalized = normalizeProductionName(source);
  if (!normalized || /^#/.test(source.trim())) return null;
  const names = (campaign: Campaign) => [campaign.name, ...campaign.aliases];
  const exact = campaigns.filter(campaign => names(campaign).some(name => normalizeProductionName(name) === normalized));
  if (exact.length) return exact.length === 1 ? { campaign: exact[0], automaticVariation: false } : null;
  const sourceVariants = variants(source);
  const matches = campaigns.filter(campaign => names(campaign).some(name => {
    const candidate = variants(name);
    return candidate.compact === sourceVariants.compact || candidate.ordered === sourceVariants.ordered;
  }));
  return matches.length === 1 ? { campaign: matches[0], automaticVariation: true } : null;
}
