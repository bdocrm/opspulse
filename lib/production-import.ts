import type { Campaign, CampaignAlias, BusinessUnit, BusinessUnitAlias } from "@prisma/client";
import { normalizeProductionName, productionNameSimilarity } from "./production-normalization";
import type { ParsedProductionRecord } from "../types/production-monitoring";

export const MAX_PRODUCTION_WORKBOOK_SIZE = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "application/zip",
  "",
]);

export async function validateProductionWorkbookFile(file: File) {
  if (!/\.xlsx$/i.test(file.name)) return "Only .xlsx workbooks are supported.";
  if (file.size <= 0 || file.size > MAX_PRODUCTION_WORKBOOK_SIZE) return "The workbook must be between 1 byte and 10 MB.";
  if (!ALLOWED_MIME_TYPES.has(file.type)) return "The uploaded file does not have a supported Excel MIME type.";
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return "The uploaded file is not a valid .xlsx workbook.";
  return buffer;
}

type CampaignWithAliases = Campaign & { productionAliases: CampaignAlias[] };
type BusinessUnitWithAliases = BusinessUnit & { aliases: BusinessUnitAlias[] };

export type CampaignMappingPreview = {
  source: string;
  normalizedSource: string;
  matchedCampaignId: string | null;
  matchedCampaignName: string | null;
  suggestion: { id: string; name: string; confidence: number } | null;
  resolution: "EXACT" | "ALIAS" | "SUGGESTED" | "CREATE";
  requiresReview: boolean;
};

export type BusinessUnitMappingPreview = {
  key: string;
  campaignNormalized: string;
  source: string;
  normalizedSource: string;
  matchedBusinessUnitId: string | null;
  matchedBusinessUnitName: string | null;
  suggestion: { id: string; name: string; confidence: number } | null;
  resolution: "EXACT" | "ALIAS" | "SUGGESTED" | "CREATE";
  requiresReview: boolean;
};

function bestCampaignSuggestion(source: string, campaigns: CampaignWithAliases[]) {
  return campaigns
    .map((campaign) => ({
      id: campaign.id,
      name: campaign.campaignName,
      confidence: Math.round(productionNameSimilarity(source, campaign.campaignName) * 100),
    }))
    .filter((candidate) => candidate.confidence >= 65)
    .sort((left, right) => right.confidence - left.confidence)[0] ?? null;
}

export function buildCampaignMappings(records: ParsedProductionRecord[], campaigns: CampaignWithAliases[]) {
  const sources = Array.from(new Map(records
    .filter((record) => record.campaignNormalized)
    .map((record) => [record.campaignNormalized, record.campaignSource])).entries());
  return sources.map(([normalizedSource, source]): CampaignMappingPreview => {
    const exact = campaigns.find((campaign) =>
      (campaign.normalizedName || normalizeProductionName(campaign.campaignName)) === normalizedSource
    );
    if (exact) return {
      source, normalizedSource, matchedCampaignId: exact.id, matchedCampaignName: exact.campaignName,
      suggestion: null, resolution: "EXACT", requiresReview: false,
    };
    const alias = campaigns.find((campaign) => campaign.productionAliases.some((item) => item.normalizedAlias === normalizedSource));
    if (alias) return {
      source, normalizedSource, matchedCampaignId: alias.id, matchedCampaignName: alias.campaignName,
      suggestion: null, resolution: "ALIAS", requiresReview: false,
    };
    const suggestion = bestCampaignSuggestion(source, campaigns);
    return {
      source,
      normalizedSource,
      matchedCampaignId: suggestion?.id ?? null,
      matchedCampaignName: suggestion?.name ?? null,
      suggestion,
      resolution: suggestion ? "SUGGESTED" : "CREATE",
      requiresReview: Boolean(suggestion),
    };
  });
}

export function buildBusinessUnitMappings(
  records: ParsedProductionRecord[],
  campaignMappings: CampaignMappingPreview[],
  businessUnits: BusinessUnitWithAliases[]
) {
  const unique = new Map<string, ParsedProductionRecord>();
  for (const record of records) {
    const key = `${record.campaignNormalized}:${record.businessUnitNormalized}`;
    if (record.campaignNormalized && record.businessUnitNormalized && !unique.has(key)) unique.set(key, record);
  }
  return [...unique.entries()].map(([key, record]): BusinessUnitMappingPreview => {
    const campaign = campaignMappings.find((item) => item.normalizedSource === record.campaignNormalized);
    const candidates = businessUnits.filter((unit) => campaign?.matchedCampaignId && unit.campaignId === campaign.matchedCampaignId);
    const exact = candidates.find((unit) => unit.normalizedName === record.businessUnitNormalized);
    if (exact) return {
      key, campaignNormalized: record.campaignNormalized, source: record.businessUnitSource,
      normalizedSource: record.businessUnitNormalized, matchedBusinessUnitId: exact.id,
      matchedBusinessUnitName: exact.businessUnitName, suggestion: null, resolution: "EXACT", requiresReview: false,
    };
    const alias = candidates.find((unit) => unit.aliases.some((item) => item.normalizedAlias === record.businessUnitNormalized));
    if (alias) return {
      key, campaignNormalized: record.campaignNormalized, source: record.businessUnitSource,
      normalizedSource: record.businessUnitNormalized, matchedBusinessUnitId: alias.id,
      matchedBusinessUnitName: alias.businessUnitName, suggestion: null, resolution: "ALIAS", requiresReview: false,
    };
    const suggestion = candidates
      .map((unit) => ({ id: unit.id, name: unit.businessUnitName, confidence: Math.round(productionNameSimilarity(record.businessUnitSource, unit.businessUnitName) * 100) }))
      .filter((candidate) => candidate.confidence >= 65)
      .sort((left, right) => right.confidence - left.confidence)[0] ?? null;
    return {
      key,
      campaignNormalized: record.campaignNormalized,
      source: record.businessUnitSource,
      normalizedSource: record.businessUnitNormalized,
      matchedBusinessUnitId: suggestion?.id ?? null,
      matchedBusinessUnitName: suggestion?.name ?? null,
      suggestion,
      resolution: suggestion ? "SUGGESTED" : "CREATE",
      requiresReview: Boolean(suggestion),
    };
  });
}

export type CommitMapping = { source: string; targetId: string | null };
export type BusinessUnitCommitMapping = CommitMapping & { campaignSource: string };

export function parseCommitMappings(value: FormDataEntryValue | null): CommitMapping[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 10_000).map((item) => ({
      source: normalizeProductionName(item?.source),
      targetId: typeof item?.targetId === "string" && item.targetId ? item.targetId : null,
    })).filter((item) => item.source);
  } catch {
    return [];
  }
}

export function parseBusinessUnitCommitMappings(value: FormDataEntryValue | null): BusinessUnitCommitMapping[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 10_000).map((item) => ({
      campaignSource: normalizeProductionName(item?.campaignSource),
      source: normalizeProductionName(item?.source),
      targetId: typeof item?.targetId === "string" && item.targetId ? item.targetId : null,
    })).filter((item) => item.campaignSource && item.source);
  } catch {
    return [];
  }
}
