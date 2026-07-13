export const CAMPAIGN_IMPORT_ALIASES: Record<string, string[]> = {
  'BPI PL': ['PERSONAL LOANS', 'BPI PERSONAL LOANS', 'PL', 'BPI PL'],
  'BPI PA Outbound': ['PA SIP LOANS OUTBOUND', 'PA OUTBOUND', 'BPI PA OUTBOUND'],
  'BPI PA Inbound': ['PA SIP LOANS INBOUND', 'PA INBOUND', 'BPI PA INBOUND'],
  'BPI Fulfillment': ['FULFILLMENT', 'BPI FULFILLMENT', 'BPI FF'],
};

const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

export function canonicalCampaignName(value: string): string | null {
  const candidate = normalize(value);
  if (!candidate) return null;
  for (const [canonical, aliases] of Object.entries(CAMPAIGN_IMPORT_ALIASES)) {
    if (aliases.some((alias) => {
      const normalizedAlias = normalize(alias);
      return candidate === normalizedAlias || candidate.includes(normalizedAlias) || normalizedAlias.includes(candidate);
    })) return canonical;
  }
  return null;
}

