export const CAMPAIGN_IMPORT_ALIASES: Record<string, string[]> = {
  'BPI PL': ['PERSONAL LOANS', 'BPI PERSONAL LOANS', 'PL', 'BPI PL'],
  'BPI PA Outbound': ['PA SIP LOANS OUTBOUND', 'PA OUTBOUND', 'BPI PA OUTBOUND'],
  'BPI PA Inbound': ['PA SIP LOANS INBOUND', 'PA INBOUND', 'BPI PA INBOUND'],
  'BPI Fulfillment': ['FULFILLMENT', 'BPI FULFILLMENT', 'BPI FF'],
  'BDO CIE': ['CASH INSTALLMENT', 'CI AGENTS MONITORING', 'CI HOH MONITORING', 'BDO CIE'],
  'BDO NTH CARD': ['NTH CARD', 'BDO NTH CARD'],
  'BDO SUPPLE': ['SUPPLE INVI', 'SUPPLEMENTARY', 'BDO SUPPLE'],
  'BDO VC': ['VIRTUAL CARD', 'VIRTUAL', 'BDO VC'],
  'BDO SGM': ['SGM', 'BDO SGM'],
};

const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

export function canonicalCampaignName(value: string): string | null {
  const candidate = normalize(value);
  if (!candidate) return null;
  const paddedCandidate = ` ${candidate} `;
  const matches = Object.entries(CAMPAIGN_IMPORT_ALIASES).flatMap(([canonical, aliases]) =>
    aliases.flatMap((alias) => {
      const normalizedAlias = normalize(alias);
      const paddedAlias = ` ${normalizedAlias} `;
      return candidate === normalizedAlias || paddedCandidate.includes(paddedAlias) || paddedAlias.includes(paddedCandidate)
        ? [{ canonical, length: normalizedAlias.length }]
        : [];
    })
  );
  return matches.sort((a, b) => b.length - a.length)[0]?.canonical || null;
}
