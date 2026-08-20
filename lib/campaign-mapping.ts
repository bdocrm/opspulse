import type { Campaign, CampaignMapping, Prisma } from "@prisma/client";
import { normalizeProductionName, productionDisplayName } from "./production-normalization";

export const CAMPAIGN_MAPPING_SOURCE_SYSTEM = "PRODUCTION_MONITORING";

export type SourceCampaignPair = {
  sourceAccount: string;
  sourceCampaign: string;
};

export type CampaignMappingWithCampaign = CampaignMapping & { opsviewCampaign: Campaign };

export function normalizeCampaignMappingSource(value: unknown) {
  return normalizeProductionName(value);
}

export function buildCampaignMappingKey(sourceAccount: unknown, sourceCampaign: unknown) {
  return `${normalizeCampaignMappingSource(sourceAccount)}::${normalizeCampaignMappingSource(sourceCampaign)}`;
}

export function uniqueCampaignMappingPairs<T extends SourceCampaignPair>(items: T[]) {
  return [...new Map(items
    .map((item) => [buildCampaignMappingKey(item.sourceAccount, item.sourceCampaign), item] as const)
    .filter(([key]) => key !== "::")).values()];
}

export async function loadCampaignMappings(
  db: Pick<Prisma.TransactionClient, "campaignMapping">,
  pairs: SourceCampaignPair[],
) {
  const unique = uniqueCampaignMappingPairs(pairs);
  if (!unique.length) return [];
  return db.campaignMapping.findMany({
    where: {
      sourceSystem: CAMPAIGN_MAPPING_SOURCE_SYSTEM,
      OR: unique.map((pair) => ({
        normalizedSourceAccount: normalizeCampaignMappingSource(pair.sourceAccount),
        normalizedSourceCampaign: normalizeCampaignMappingSource(pair.sourceCampaign),
      })),
    },
    include: { opsviewCampaign: true },
  });
}

export function campaignMappingLookup(mappings: CampaignMappingWithCampaign[]) {
  return new Map(mappings.map((mapping) => [
    buildCampaignMappingKey(mapping.normalizedSourceAccount, mapping.normalizedSourceCampaign),
    mapping,
  ]));
}

export function validateSavedCampaignMapping(mapping: CampaignMappingWithCampaign | undefined) {
  if (!mapping || mapping.status !== "ACTIVE") return { status: "mapping_required" as const };
  if (!mapping.opsviewCampaign?.isActive) {
    return { status: "invalid_mapping" as const, mappingId: mapping.id, reason: "The saved campaign mapping points to an inactive campaign." };
  }
  return {
    status: "mapped" as const,
    campaignId: mapping.opsviewCampaignId,
    campaignName: mapping.opsviewCampaign.campaignName,
    mappingId: mapping.id,
    mappingType: mapping.mappingType,
  };
}

type SaveMappingInput = SourceCampaignPair & {
  opsviewCampaignId: string;
  mappingType?: "MANUAL" | "AUTO" | "ADMIN_DEFINED" | "SYSTEM_RULE";
  notes?: string | null;
};

export async function saveCampaignMapping(
  tx: Prisma.TransactionClient,
  input: SaveMappingInput,
  userId: string,
  importId?: string | null,
) {
  const sourceAccount = productionDisplayName(input.sourceAccount);
  const sourceCampaign = productionDisplayName(input.sourceCampaign);
  const normalizedSourceAccount = normalizeCampaignMappingSource(sourceAccount);
  const normalizedSourceCampaign = normalizeCampaignMappingSource(sourceCampaign);
  if (!normalizedSourceAccount) throw new Error("ACCOUNT_VALUE_MISSING");
  if (!normalizedSourceCampaign) throw new Error("CAMPAIGN_VALUE_MISSING");

  const destination = await tx.campaign.findUnique({ where: { id: input.opsviewCampaignId } });
  if (!destination) throw new Error("CAMPAIGN_NOT_FOUND");
  if (!destination.isActive) throw new Error("CAMPAIGN_INACTIVE");

  const key = {
    sourceSystem_normalizedSourceAccount_normalizedSourceCampaign: {
      sourceSystem: CAMPAIGN_MAPPING_SOURCE_SYSTEM,
      normalizedSourceAccount,
      normalizedSourceCampaign,
    },
  };
  const existing = await tx.campaignMapping.findUnique({ where: key });
  const action = !existing
    ? "CREATED"
    : existing.status !== "ACTIVE"
      ? "ENABLED"
      : existing.opsviewCampaignId !== destination.id
        ? "REMAPPED"
        : "UPDATED";
  const mapping = await tx.campaignMapping.upsert({
    where: key,
    create: {
      sourceAccount,
      normalizedSourceAccount,
      sourceCampaign,
      normalizedSourceCampaign,
      sourceSystem: CAMPAIGN_MAPPING_SOURCE_SYSTEM,
      opsviewCampaignId: destination.id,
      status: "ACTIVE",
      mappingType: input.mappingType ?? "MANUAL",
      notes: input.notes ?? null,
      createdById: userId,
      updatedById: userId,
    },
    update: {
      sourceAccount,
      sourceCampaign,
      opsviewCampaignId: destination.id,
      status: "ACTIVE",
      mappingType: input.mappingType ?? existing?.mappingType ?? "MANUAL",
      notes: input.notes === undefined ? existing?.notes : input.notes,
      updatedById: userId,
    },
    include: { opsviewCampaign: true },
  });
  await tx.campaignMappingAudit.create({
    data: {
      mappingId: mapping.id,
      action,
      oldCampaignId: existing?.opsviewCampaignId ?? null,
      newCampaignId: destination.id,
      importId: importId ?? null,
      changedById: userId,
      details: { sourceAccount, sourceCampaign },
    },
  });
  return { mapping, action };
}
