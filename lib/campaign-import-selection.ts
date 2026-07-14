import { resolveCampaignEvidence } from './campaign-import-mapping';
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
  const resolved = resolveCampaignEvidence([normalizeCampaignLabel(sheetName), sheetName], selectedCampaigns);
  return { campaign: resolved.campaign, source: resolved.source === 'evidence' ? 'sheet' as const : resolved.source };
}
