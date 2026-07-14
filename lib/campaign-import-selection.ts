import { canonicalCampaignName } from './campaign-import-mapping';
import { normalizeMetricHeader } from './metric-import-mapping';

export interface ImportCampaignOption {
  id: string;
  campaignName: string;
}

function normalizeCampaignLabel(value: string) {
  return normalizeMetricHeader(String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))
    .replace(/\b(raw|mtd|sheet|worksheet|data|report|production)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapWorksheetCampaign(sheetName: string, selectedCampaigns: ImportCampaignOption[]) {
  const normalizedSheet = normalizeCampaignLabel(sheetName);
  const canonical = canonicalCampaignName(sheetName);
  const match = selectedCampaigns
    .map((campaign) => ({ campaign, normalized: normalizeCampaignLabel(campaign.campaignName) }))
    .filter(({ campaign, normalized }) => {
      const campaignCanonical = canonicalCampaignName(campaign.campaignName);
      return normalized && (
        normalizedSheet.includes(normalized) || normalized.includes(normalizedSheet) ||
        Boolean(canonical && campaignCanonical === canonical)
      );
    })
    .sort((a, b) => b.normalized.length - a.normalized.length)[0]?.campaign;
  if (match) return { campaign: match, source: 'sheet' as const };
  return {
    campaign: selectedCampaigns[0],
    source: selectedCampaigns.length === 1 ? 'selected' as const : 'unresolved' as const,
  };
}
