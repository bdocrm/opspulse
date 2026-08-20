import { PrismaClient } from "@prisma/client";
import { buildCampaignMappingKey } from "../lib/campaign-mapping";
import { scopedCampaignDepartmentName } from "../lib/campaign-department-policy";
import { createApprovedDepartmentMapping } from "../lib/department-resolution";
import { normalizeProductionName } from "../lib/production-normalization";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  const rows = await prisma.productionMonitoring.findMany({
    where: { sourceAccount: { not: null }, sourceCampaign: { not: null } },
    select: {
      id: true,
      campaignId: true,
      sourceAccount: true,
      sourceCampaign: true,
      importedById: true,
      reportYear: true,
      reportMonth: true,
      metricType: true,
      campaign: { select: { campaignName: true, normalizedName: true } },
    },
    orderBy: [{ sourceAccount: "asc" }, { sourceCampaign: "asc" }, { reportYear: "asc" }, { reportMonth: "asc" }],
  });

  const candidates = rows.filter((row) =>
    row.sourceAccount &&
    row.sourceCampaign &&
    row.importedById &&
    normalizeProductionName(row.campaign.normalizedName || row.campaign.campaignName) === normalizeProductionName(row.sourceAccount) &&
    normalizeProductionName(row.sourceAccount) !== normalizeProductionName(row.sourceCampaign) &&
    scopedCampaignDepartmentName(row.sourceAccount, row.sourceCampaign)
  );
  const groups = [...new Map(candidates.map((row) => [
    buildCampaignMappingKey(row.sourceAccount, row.sourceCampaign),
    candidates.filter((candidate) => buildCampaignMappingKey(candidate.sourceAccount, candidate.sourceCampaign) === buildCampaignMappingKey(row.sourceAccount, row.sourceCampaign)),
  ])).values()];

  const plan = groups.map((group) => ({
    sourceAccount: group[0].sourceAccount,
    sourceCampaign: group[0].sourceCampaign,
    currentCampaign: group[0].campaign.campaignName,
    canonicalCampaign: scopedCampaignDepartmentName(group[0].sourceAccount, group[0].sourceCampaign),
    records: group.length,
    periods: [...new Set(group.map((row) => `${row.reportYear}-${String(row.reportMonth).padStart(2, "0")}`))],
  }));

  if (!apply) {
    console.log(JSON.stringify({ mode: "DRY_RUN", candidates: plan.length, records: candidates.length, plan }, null, 2));
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const repaired = [];
    for (const group of groups) {
      const first = group[0];
      const sourceAccount = first.sourceAccount as string;
      const sourceCampaign = first.sourceCampaign as string;
      const canonicalDepartment = scopedCampaignDepartmentName(sourceAccount, sourceCampaign);
      if (!canonicalDepartment || !first.importedById) throw new Error("Backfill candidate lost its source identity.");

      const saved = await createApprovedDepartmentMapping(tx, {
        sourceAccount,
        sourceCampaign,
        canonicalDepartment,
        notes: "Repaired from preserved ProductionMonitoring source fields after legacy account-level collapse.",
      }, first.importedById);
      const campaignId = saved.mapping.opsviewCampaignId;
      const businessUnit = await tx.businessUnit.upsert({
        where: {
          campaignId_normalizedName: {
            campaignId,
            normalizedName: normalizeProductionName(sourceCampaign),
          },
        },
        update: { isActive: true },
        create: {
          campaignId,
          businessUnitName: sourceCampaign,
          normalizedName: normalizeProductionName(sourceCampaign),
          isActive: true,
        },
      });

      for (const row of group) {
        const conflict = await tx.productionMonitoring.findFirst({
          where: {
            id: { not: row.id },
            campaignId,
            businessUnitId: businessUnit.id,
            reportYear: row.reportYear,
            reportMonth: row.reportMonth,
            metricType: row.metricType,
          },
          select: { id: true },
        });
        if (conflict) throw new Error(`Backfill conflict for ${canonicalDepartment} ${row.reportYear}-${row.reportMonth} ${row.metricType}.`);
      }

      await tx.productionMonitoringAudit.createMany({
        data: group.map((row) => ({
          productionMonitoringId: row.id,
          fieldChanged: "campaignId",
          oldValue: row.campaignId,
          newValue: campaignId,
          changedById: first.importedById as string,
          reason: "Repaired collapsed campaign association using preserved sourceAccount and sourceCampaign values.",
        })),
      });
      await tx.productionMonitoring.updateMany({
        where: { id: { in: group.map((row) => row.id) } },
        data: {
          campaignId,
          businessUnitId: businessUnit.id,
          campaignMappingId: saved.mapping.id,
        },
      });
      await tx.campaignMapping.update({
        where: { id: saved.mapping.id },
        data: { usageCount: { increment: group.length }, lastUsedAt: new Date() },
      });
      await tx.campaignMappingAudit.create({
        data: {
          mappingId: saved.mapping.id,
          action: "BACKFILL_APPLIED",
          oldCampaignId: first.campaignId,
          newCampaignId: campaignId,
          changedById: first.importedById,
          details: { repairedRecords: group.length, sourceAccount, sourceCampaign },
        },
      });
      repaired.push({ sourceAccount, sourceCampaign, canonicalDepartment, campaignId, records: group.length });
    }
    return repaired;
  }, { timeout: 120_000 });

  console.log(JSON.stringify({ mode: "APPLY", repairedCampaigns: result.length, repairedRecords: result.reduce((sum, item) => sum + item.records, 0), result }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

