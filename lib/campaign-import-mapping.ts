export const CAMPAIGN_IMPORT_ALIASES: Record<string, string[]> = {
  'MB ACQ': ['MB ACQ', 'ACQUI', 'ACQUISITION'],
  'MB PL': ['MB PERSONAL LOANS', 'MB PL'],
  'MB PA': ['MB PA', 'MBPA'],
  'BPI PL': ['PERSONAL LOANS', 'BPI PERSONAL LOANS', 'PL', 'BPI PL'],
  'BPI PA OUTBOUND': ['PA SIP LOANS OUTBOUND', 'SIP LOANS OUTBOUND', 'PA OUTBOUND', 'BPI PA OUTBOUND'],
  'BPI PA INBOUND': ['PA SIP LOANS INBOUND', 'SIP LOANS INBOUND', 'PA INBOUND', 'BPI PA INBOUND'],
  'BPI BL': ['BUSINESS LOANS', 'BPI BUSINESS LOANS', 'BPI BL', 'BL'],
  'BDO CIE': ['CASH INSTALLMENT', 'CI AGENTS MONITORING', 'CI HOH MONITORING', 'BDO CIE'],
  'BDO NTH CARD': ['NTH CARD', 'BDO NTH CARD'],
  'BDO SUPPLE': ['SUPPLE INVI', 'SUPPLEMENTARY', 'BDO SUPPLE'],
  'BDO VC': ['VIRTUAL CARD', 'VIRTUAL', 'BDO VC'],
  'BDO SGM': ['SGM', 'BDO SGM'],
};

export const normalizeCampaignImportText = (value: string) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[\r\n\t]+/g, ' ')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export function canonicalCampaignName(value: string): string | null {
  const candidate = normalizeCampaignImportText(value);
  if (!candidate) return null;
  const paddedCandidate = ` ${candidate} `;
  const matches = Object.entries(CAMPAIGN_IMPORT_ALIASES).flatMap(([canonical, aliases]) =>
    aliases.flatMap((alias) => {
      const normalizedAlias = normalizeCampaignImportText(alias);
      const paddedAlias = ` ${normalizedAlias} `;
      return candidate === normalizedAlias || paddedCandidate.includes(paddedAlias) || paddedAlias.includes(paddedCandidate)
        ? [{ canonical, length: normalizedAlias.length }]
        : [];
    })
  );
  return matches.sort((a, b) => b.length - a.length)[0]?.canonical || null;
}

export interface CampaignImportCandidate {
  id: string;
  campaignName: string;
}

export function resolveCampaignEvidence(evidence: string[], selectedCampaigns: CampaignImportCandidate[]) {
  for (const rawEvidence of evidence) {
    const normalizedEvidence = normalizeCampaignImportText(rawEvidence);
    if (!normalizedEvidence) continue;
    // Short worksheet names such as ACQ, PL, and PA are common in MB annual
    // workbooks. Resolve them only when they identify exactly one of the
    // selected campaigns so "PL" never guesses between MB PL and BPI PL.
    const shortMbAlias = normalizedEvidence.match(/^(?:ACQUI|ACQUISITION|ACQ|PL|PA|MBPA)$/)?.[0];
    if (shortMbAlias) {
      const suffix = /ACQ|ACQUI|ACQUISITION/.test(shortMbAlias) ? 'ACQ' : shortMbAlias === 'MBPA' ? 'PA' : shortMbAlias;
      const suffixMatches = selectedCampaigns.filter((campaign) => {
        const normalizedCampaign = normalizeCampaignImportText(campaign.campaignName);
        return normalizedCampaign === suffix || normalizedCampaign.endsWith(` ${suffix}`);
      });
      if (suffixMatches.length === 1 && normalizeCampaignImportText(suffixMatches[0].campaignName).startsWith('MB ')) {
        return { campaign: suffixMatches[0], source: 'evidence' as const, evidence: rawEvidence };
      }
      if (suffixMatches.length > 1) continue;
    }
    const canonical = canonicalCampaignName(rawEvidence);
    const matches = selectedCampaigns.filter((campaign) => {
      const normalizedCampaign = normalizeCampaignImportText(campaign.campaignName);
      const campaignCanonical = canonicalCampaignName(campaign.campaignName);
      return Boolean(
        (canonical && campaignCanonical === canonical) ||
        normalizedEvidence === normalizedCampaign ||
        (normalizedCampaign.length >= 5 && normalizedEvidence.includes(normalizedCampaign))
      );
    });
    if (matches.length === 1) return { campaign: matches[0], source: 'evidence' as const, evidence: rawEvidence };
  }

  const genericPaEvidence = evidence.some((value) => /^(?:BPI\s+)?PA(?:\s+(?:AGENTS?|HOH)\s+MONITORING)?$/i.test(normalizeCampaignImportText(value)));
  if (genericPaEvidence) {
    const paCampaigns = selectedCampaigns.filter((campaign) => /^BPI PA(?:\s|$)/i.test(campaign.campaignName));
    if (paCampaigns.length === 1) return { campaign: paCampaigns[0], source: 'evidence' as const, evidence: 'PA' };
  }

  if (selectedCampaigns.length === 1) return { campaign: selectedCampaigns[0], source: 'selected' as const, evidence: '' };
  return { campaign: selectedCampaigns[0], source: 'unresolved' as const, evidence: '' };
}
