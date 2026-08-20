import type { Campaign, CampaignAlias, BusinessUnit, BusinessUnitAlias } from "@prisma/client";
import {
  buildCampaignMappingKey,
  campaignMappingLookup,
  type CampaignMappingWithCampaign,
} from "./campaign-mapping";
import { normalizeProductionName, productionNameSimilarity } from "./production-normalization";
import type { ParsedProductionRecord } from "../types/production-monitoring";
import { findKnownCampaignMapping, findKnownCampaignNameAlias } from "./known-campaign-mappings";
import { scopedCampaignDepartmentName } from "./campaign-department-policy";

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
  key: string;
  sourceAccount: string;
  normalizedSourceAccount: string;
  sourceCampaign: string;
  normalizedSourceCampaign: string;
  source: string;
  normalizedSource: string;
  matchedCampaignId: string | null;
  matchedCampaignName: string | null;
  suggestion: { id: string; name: string; confidence: number } | null;
  mappingId: string | null;
  mappingType: string | null;
  resolution: "EXPLICIT" | "KNOWN_ALIAS" | "EXACT" | "LEGACY_EXACT" | "ALIAS" | "SUGGESTED" | "NEW_DEPARTMENT" | "NEEDS_REVIEW" | "MAPPING_REQUIRED" | "INVALID";
  requiresReview: boolean;
  invalidReason: string | null;
  affectedRows: number;
  confidence: number | null;
  newDepartmentName: string | null;
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

export function buildCampaignMappings(
  records: ParsedProductionRecord[],
  campaigns: CampaignWithAliases[],
  savedMappings: CampaignMappingWithCampaign[] = [],
) {
  const savedLookup = campaignMappingLookup(savedMappings);
  const affectedCounts = new Map<string, number>();
  for (const record of records) {
    const key = buildCampaignMappingKey(record.campaignSource, record.businessUnitSource);
    affectedCounts.set(key, (affectedCounts.get(key) ?? 0) + 1);
  }
  const sources = Array.from(new Map(records
    .filter((record) => record.campaignNormalized && record.businessUnitNormalized)
    .map((record) => [buildCampaignMappingKey(record.campaignSource, record.businessUnitSource), record])).values());
  return sources.map((record): CampaignMappingPreview => {
    const key = buildCampaignMappingKey(record.campaignSource, record.businessUnitSource);
    const common = {
      key,
      sourceAccount: record.campaignSource,
      normalizedSourceAccount: record.campaignNormalized,
      sourceCampaign: record.businessUnitSource,
      normalizedSourceCampaign: record.businessUnitNormalized,
      // Kept for existing consumers while they migrate to the explicit fields.
      source: record.businessUnitSource,
      normalizedSource: record.businessUnitNormalized,
      affectedRows: affectedCounts.get(key) ?? 0,
      confidence: null,
      newDepartmentName: null,
    };
    const saved = savedLookup.get(key);
    if (saved?.status === "ACTIVE" && !saved.opsviewCampaign.isActive) return {
      ...common, matchedCampaignId: null, matchedCampaignName: saved.opsviewCampaign.campaignName,
      suggestion: null, mappingId: saved.id, mappingType: saved.mappingType, resolution: "INVALID",
      requiresReview: true, invalidReason: "The saved campaign mapping points to an inactive campaign.",
    };
    if (saved?.status === "ACTIVE") return {
      ...common, matchedCampaignId: saved.opsviewCampaignId, matchedCampaignName: saved.opsviewCampaign.campaignName,
      suggestion: null, mappingId: saved.id, mappingType: saved.mappingType, resolution: "EXPLICIT",
      requiresReview: false, invalidReason: null,
    };
    const knownRule = findKnownCampaignMapping(record.campaignSource, record.businessUnitSource);
    if (knownRule) {
      const targetNormalized = normalizeProductionName(knownRule.targetCampaign);
      const target = campaigns.find((campaign) =>
        (campaign.normalizedName || normalizeProductionName(campaign.campaignName)) === targetNormalized
      );
      if (target) return {
        ...common, matchedCampaignId: target.id, matchedCampaignName: target.campaignName,
        suggestion: null, mappingId: null, mappingType: "SYSTEM_RULE", resolution: "KNOWN_ALIAS",
        requiresReview: false, invalidReason: null, confidence: 100,
      };
      if (knownRule.allowCreate) return {
        ...common, matchedCampaignId: null, matchedCampaignName: null,
        suggestion: null, mappingId: null, mappingType: "SYSTEM_RULE", resolution: "NEW_DEPARTMENT",
        requiresReview: true, invalidReason: null, confidence: 100, newDepartmentName: knownRule.targetCampaign,
      };
      return {
        ...common, matchedCampaignId: null, matchedCampaignName: null,
        suggestion: null, mappingId: null, mappingType: "SYSTEM_RULE", resolution: "NEEDS_REVIEW",
        requiresReview: true,
        invalidReason: `The configured OpsView campaign "${knownRule.targetCampaign}" is unavailable or outside your access.`,
        confidence: 100,
      };
    }
    const knownNameAlias = findKnownCampaignNameAlias(record.businessUnitSource);
    if (knownNameAlias) {
      const targetNormalized = normalizeProductionName(knownNameAlias);
      const target = campaigns.find((campaign) =>
        (campaign.normalizedName || normalizeProductionName(campaign.campaignName)) === targetNormalized
      );
      if (target) return {
        ...common, matchedCampaignId: target.id, matchedCampaignName: target.campaignName,
        suggestion: null, mappingId: null, mappingType: "SYSTEM_RULE", resolution: "KNOWN_ALIAS",
        requiresReview: false, invalidReason: null, confidence: 100,
      };
      return {
        ...common, matchedCampaignId: null, matchedCampaignName: null,
        suggestion: null, mappingId: null, mappingType: "SYSTEM_RULE", resolution: "NEEDS_REVIEW",
        requiresReview: true, invalidReason: `The configured OpsView campaign "${knownNameAlias}" is unavailable or outside your access.`, confidence: 100,
      };
    }
    const exact = campaigns.find((campaign) =>
      (campaign.normalizedName || normalizeProductionName(campaign.campaignName)) === record.businessUnitNormalized
    );
    if (exact) return {
      ...common, matchedCampaignId: exact.id, matchedCampaignName: exact.campaignName,
      suggestion: null, mappingId: null, mappingType: "AUTO", resolution: "EXACT", requiresReview: false, invalidReason: null, confidence: 100,
    };
    const scopedDepartmentName = scopedCampaignDepartmentName(record.campaignSource, record.businessUnitSource);
    const scopedDepartmentNormalized = normalizeProductionName(scopedDepartmentName);
    const scopedExact = scopedDepartmentName ? campaigns.find((campaign) =>
      (campaign.normalizedName || normalizeProductionName(campaign.campaignName)) === scopedDepartmentNormalized
    ) : null;
    if (scopedExact) return {
      ...common, matchedCampaignId: scopedExact.id, matchedCampaignName: scopedExact.campaignName,
      suggestion: null, mappingId: null, mappingType: "AUTO", resolution: "EXACT", requiresReview: false, invalidReason: null, confidence: 100,
    };
    // The account-name match proves that the source campaign belongs to a
    // known parent, but it must never collapse a distinct child into that
    // parent. Prepare a canonical scoped department instead.
    const parentExact = campaigns.find((campaign) =>
      (campaign.normalizedName || normalizeProductionName(campaign.campaignName)) === record.campaignNormalized
    );
    if (parentExact && scopedDepartmentName) return {
      ...common, matchedCampaignId: null, matchedCampaignName: null,
      suggestion: null, mappingId: null, mappingType: "AUTO", resolution: "NEW_DEPARTMENT",
      requiresReview: true, invalidReason: null, confidence: 100, newDepartmentName: scopedDepartmentName,
    };
    if (parentExact && record.campaignNormalized === record.businessUnitNormalized) return {
      ...common, matchedCampaignId: parentExact.id, matchedCampaignName: parentExact.campaignName,
      suggestion: null, mappingId: null, mappingType: "AUTO", resolution: "EXACT", requiresReview: false, invalidReason: null, confidence: 100,
    };
    // Legacy aliases are intentionally suggestions only. They are globally
    // unique and therefore cannot safely distinguish identical source labels
    // used by different accounts; confirmation creates the scoped mapping.
    const alias = campaigns.find((campaign) => campaign.productionAliases.some((item) =>
      item.normalizedAlias === record.businessUnitNormalized || item.normalizedAlias === record.campaignNormalized
    ));
    if (alias) return {
      ...common, matchedCampaignId: null, matchedCampaignName: null,
      suggestion: { id: alias.id, name: alias.campaignName, confidence: 100 },
      mappingId: null, mappingType: null, resolution: "SUGGESTED", requiresReview: true, invalidReason: null, confidence: 100,
    };
    const suggestion = bestCampaignSuggestion(record.businessUnitSource, campaigns);
    return {
      ...common,
      matchedCampaignId: null,
      matchedCampaignName: null,
      suggestion,
      mappingId: null,
      mappingType: null,
      resolution: suggestion ? "SUGGESTED" : "NEEDS_REVIEW",
      requiresReview: true,
      invalidReason: null,
      confidence: suggestion?.confidence ?? null,
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
    const key = buildCampaignMappingKey(record.campaignSource, record.businessUnitSource);
    if (record.campaignNormalized && record.businessUnitNormalized && !unique.has(key)) unique.set(key, record);
  }
  return [...unique.entries()].map(([key, record]): BusinessUnitMappingPreview => {
    const campaign = campaignMappings.find((item) => item.key === key);
    const candidates = businessUnits.filter((unit) => campaign?.matchedCampaignId && unit.campaignId === campaign.matchedCampaignId);
    const exact = candidates.find((unit) => unit.normalizedName === record.businessUnitNormalized);
    if (exact) return {
      key, campaignNormalized: key, source: record.businessUnitSource,
      normalizedSource: record.businessUnitNormalized, matchedBusinessUnitId: exact.id,
      matchedBusinessUnitName: exact.businessUnitName, suggestion: null, resolution: "EXACT", requiresReview: false,
    };
    const alias = candidates.find((unit) => unit.aliases.some((item) => item.normalizedAlias === record.businessUnitNormalized));
    if (alias) return {
      key, campaignNormalized: key, source: record.businessUnitSource,
      normalizedSource: record.businessUnitNormalized, matchedBusinessUnitId: alias.id,
      matchedBusinessUnitName: alias.businessUnitName, suggestion: null, resolution: "ALIAS", requiresReview: false,
    };
    const suggestion = candidates
      .map((unit) => ({ id: unit.id, name: unit.businessUnitName, confidence: Math.round(productionNameSimilarity(record.businessUnitSource, unit.businessUnitName) * 100) }))
      .filter((candidate) => candidate.confidence >= 65)
      .sort((left, right) => right.confidence - left.confidence)[0] ?? null;
    return {
      key,
      campaignNormalized: key,
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

export type CommitMapping = { key: string; source: string; sourceAccount: string; sourceCampaign: string; targetId: string | null; remember: boolean };
export type BusinessUnitCommitMapping = CommitMapping & { campaignSource: string };

export function parseCommitMappings(value: FormDataEntryValue | null): CommitMapping[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 10_000).map((item) => ({
      sourceAccount: normalizeProductionName(item?.sourceAccount ?? item?.account ?? item?.campaignSource ?? item?.source),
      sourceCampaign: normalizeProductionName(item?.sourceCampaign ?? item?.campaign ?? item?.source),
      source: normalizeProductionName(item?.sourceCampaign ?? item?.campaign ?? item?.source),
      key: buildCampaignMappingKey(item?.sourceAccount ?? item?.account ?? item?.campaignSource ?? item?.source, item?.sourceCampaign ?? item?.campaign ?? item?.source),
      targetId: typeof item?.targetId === "string" && item.targetId ? item.targetId : null,
      remember: item?.remember !== false,
    })).filter((item) => item.sourceAccount && item.sourceCampaign);
  } catch {
    return [];
  }
}

export function parseBusinessUnitCommitMappings(value: FormDataEntryValue | null): BusinessUnitCommitMapping[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 10_000).map((item) => ({
      campaignSource: String(item?.campaignSource ?? ""),
      sourceAccount: normalizeProductionName(item?.sourceAccount ?? item?.campaignSource),
      sourceCampaign: normalizeProductionName(item?.sourceCampaign ?? item?.source),
      source: normalizeProductionName(item?.sourceCampaign ?? item?.source),
      key: buildCampaignMappingKey(item?.sourceAccount ?? item?.campaignSource, item?.sourceCampaign ?? item?.source),
      targetId: typeof item?.targetId === "string" && item.targetId ? item.targetId : null,
      remember: false,
    })).filter((item) => item.sourceAccount && item.sourceCampaign);
  } catch {
    return [];
  }
}
