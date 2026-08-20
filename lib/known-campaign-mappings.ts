import { buildCampaignMappingKey } from "./campaign-mapping";

export type KnownCampaignMappingRule = {
  sourceAccount: string;
  sourceCampaign: string;
  targetCampaign: string;
  allowCreate: boolean;
};

// Backend-owned system rules. Existing destinations are never created from
// these aliases; the three explicitly approved canonical departments may be
// created only through the permission-checked mapping transaction.
export const KNOWN_CAMPAIGN_MAPPINGS: readonly KnownCampaignMappingRule[] = [
  { sourceAccount: "BLUE 123", sourceCampaign: "SGM", targetCampaign: "BDO SGM", allowCreate: false },
  { sourceAccount: "BLUE 123", sourceCampaign: "ONLINE", targetCampaign: "BDO ONLINE", allowCreate: false },
  { sourceAccount: "XSELL", sourceCampaign: "NTH CARD", targetCampaign: "BDO NTH CARD", allowCreate: false },
  { sourceAccount: "XSELL", sourceCampaign: "VIRTUAL", targetCampaign: "BDO VC", allowCreate: false },
  { sourceAccount: "XSELL", sourceCampaign: "SUPPLE INVI", targetCampaign: "BDO SUPPLE", allowCreate: false },
  { sourceAccount: "GAOC", sourceCampaign: "GAOC", targetCampaign: "GAOC", allowCreate: true },
  { sourceAccount: "ACMOBILITY", sourceCampaign: "AC MOBILITY", targetCampaign: "AC MOBILITY", allowCreate: true },
  { sourceAccount: "RBSCXSLGFI", sourceCampaign: "BANKARD", targetCampaign: "RBSC / BANKARD", allowCreate: true },
] as const;

// Single-value aliases used by imports that expose only a campaign label.
// Pair-specific rules above remain more authoritative.
export const KNOWN_CAMPAIGN_NAME_ALIASES: Readonly<Record<string, string>> = {
  ONLINE: "BDO ONLINE",
};

const KNOWN_CAMPAIGN_MAPPING_LOOKUP = new Map(
  KNOWN_CAMPAIGN_MAPPINGS.map((rule) => [buildCampaignMappingKey(rule.sourceAccount, rule.sourceCampaign), rule]),
);

export function findKnownCampaignMapping(sourceAccount: unknown, sourceCampaign: unknown) {
  return KNOWN_CAMPAIGN_MAPPING_LOOKUP.get(buildCampaignMappingKey(sourceAccount, sourceCampaign)) ?? null;
}

export function findKnownCampaignNameAlias(sourceCampaign: unknown) {
  return KNOWN_CAMPAIGN_NAME_ALIASES[String(sourceCampaign ?? "").trim().toUpperCase()] ?? null;
}
