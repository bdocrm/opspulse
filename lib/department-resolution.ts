import type { Prisma } from "@prisma/client";
import { saveCampaignMapping } from "./campaign-mapping";
import { findKnownCampaignMapping } from "./known-campaign-mappings";
import { normalizeProductionName, productionDisplayName } from "./production-normalization";
import { scopedCampaignDepartmentName } from "./campaign-department-policy";

export async function createApprovedDepartmentMapping(
  tx: Prisma.TransactionClient,
  input: { sourceAccount: string; sourceCampaign: string; canonicalDepartment: string; sourceFile?: string | null; notes?: string | null },
  userId: string,
) {
  const knownRule = findKnownCampaignMapping(input.sourceAccount, input.sourceCampaign);
  const dynamicDepartment = scopedCampaignDepartmentName(input.sourceAccount, input.sourceCampaign);
  const knownCreation = Boolean(knownRule?.allowCreate) && normalizeProductionName(knownRule?.targetCampaign) === normalizeProductionName(input.canonicalDepartment);
  const dynamicCreation = Boolean(dynamicDepartment) && normalizeProductionName(dynamicDepartment) === normalizeProductionName(input.canonicalDepartment);
  if (!knownCreation && !dynamicCreation) {
    throw new Error("DEPARTMENT_CREATION_REQUIRES_REVIEW");
  }
  if (dynamicCreation) {
    const parent = await tx.campaign.findUnique({ where: { normalizedName: normalizeProductionName(input.sourceAccount) } });
    if (!parent?.isActive) throw new Error("DEPARTMENT_CREATION_REQUIRES_REVIEW");
  }
  const campaignName = productionDisplayName(knownCreation ? knownRule?.targetCampaign : dynamicDepartment);
  const normalizedName = normalizeProductionName(campaignName);
  const existing = await tx.campaign.findUnique({ where: { normalizedName } });
  if (existing && !existing.isActive) throw new Error("CAMPAIGN_INACTIVE");
  const destination = existing ?? await tx.campaign.create({
    data: {
      campaignName,
      normalizedName,
      isActive: true,
      goalType: "production_monitoring",
      monthlyGoal: 0,
      kpiMetric: "production",
    },
  });
  const saved = await saveCampaignMapping(tx, {
    sourceAccount: input.sourceAccount,
    sourceCampaign: input.sourceCampaign,
    opsviewCampaignId: destination.id,
    mappingType: "SYSTEM_RULE",
    notes: input.notes,
  }, userId);
  if (dynamicCreation) {
    const parent = await tx.campaign.findUnique({ where: { normalizedName: normalizeProductionName(input.sourceAccount) } });
    if (parent) {
      const inheritedUsers = await tx.user.findMany({
        where: {
          role: { not: "AGENT" },
          OR: [{ campaignId: parent.id }, { campaignAssignments: { some: { campaignId: parent.id } } }],
        },
        select: { id: true },
      });
      if (inheritedUsers.length) {
        await tx.userCampaign.createMany({
          data: inheritedUsers.map((assignedUser) => ({ userId: assignedUser.id, campaignId: destination.id })),
          skipDuplicates: true,
        });
      }
    }
  }
  if (!existing) await tx.campaignMappingAudit.create({ data: {
    mappingId: saved.mapping.id,
    action: "DEPARTMENT_CREATED",
    newCampaignId: destination.id,
    changedById: userId,
    details: {
      department: destination.campaignName,
      originalExcelCampaign: `${saved.mapping.sourceAccount} / ${saved.mapping.sourceCampaign}`,
      importedFile: input.sourceFile?.slice(0, 255) ?? null,
      creationMethod: "AUTO_IMPORT",
    },
  } });
  return { ...saved, createdDepartment: !existing };
}
