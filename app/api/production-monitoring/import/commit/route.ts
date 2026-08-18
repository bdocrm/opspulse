import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAdminProduction, getProductionSessionUser } from "@/lib/production-access";
import {
  parseBusinessUnitCommitMappings,
  parseCommitMappings,
  validateProductionWorkbookFile,
} from "@/lib/production-import";
import { normalizeProductionName, productionDisplayName } from "@/lib/production-normalization";
import { parseProductionWorkbook } from "@/lib/production-workbook";

export const runtime = "nodejs";

const sanitizedIssueData = (record: ReturnType<typeof parseProductionWorkbook>["records"][number]) => ({
  campaign: record.campaignSource,
  businessUnit: record.businessUnitSource,
  reportYear: record.reportYear,
  reportMonth: record.reportMonth,
  metricType: record.metricType,
});

export async function POST(request: NextRequest) {
  const user = getProductionSessionUser(await getServerSession(authOptions));
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAdminProduction(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  const fallbackMonth = Number(form.get("reportMonth"));
  const fallbackYear = Number(form.get("reportYear"));
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an Excel workbook." }, { status: 400 });
  if (!Number.isInteger(fallbackMonth) || fallbackMonth < 1 || fallbackMonth > 12 || !Number.isInteger(fallbackYear) || fallbackYear < 2000 || fallbackYear > 2100) {
    return NextResponse.json({ error: "Choose a valid fallback reporting period." }, { status: 400 });
  }
  const validated = await validateProductionWorkbookFile(file);
  if (typeof validated === "string") return NextResponse.json({ error: validated }, { status: 400 });
  let parsed;
  try {
    parsed = parseProductionWorkbook(validated, file.name, { month: fallbackMonth, year: fallbackYear });
  } catch (error) {
    console.error("Production workbook commit read error", error);
    return NextResponse.json({ error: "We couldn't safely re-read this workbook." }, { status: 422 });
  }
  const campaignMappings = parseCommitMappings(form.get("campaignMappings"));
  const businessMappings = parseBusinessUnitCommitMappings(form.get("businessUnitMappings"));
  const campaignSources = new Set(parsed.records.filter((record) => record.campaignNormalized).map((record) => record.campaignNormalized));
  if ([...campaignSources].some((source) => !campaignMappings.some((mapping) => mapping.source === source))) {
    return NextResponse.json({ error: "Review every campaign mapping before importing." }, { status: 400 });
  }
  const businessSources = new Set(parsed.records.filter((record) => record.campaignNormalized && record.businessUnitNormalized).map((record) => `${record.campaignNormalized}:${record.businessUnitNormalized}`));
  if ([...businessSources].some((key) => {
    const [campaignSource, businessSource] = key.split(":");
    return !businessMappings.some((mapping) => mapping.campaignSource === campaignSource && mapping.source === businessSource);
  })) {
    return NextResponse.json({ error: "Review every business unit mapping before importing." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.productionImport.create({
        data: {
          fileName: file.name.slice(0, 255),
          reportingPeriods: parsed.reportingPeriods,
          recordsDetected: parsed.records.length,
          importedById: user.id as string,
          status: "IMPORTING",
        },
      });
      const targetCampaignIds = campaignMappings.map((mapping) => mapping.targetId).filter(Boolean) as string[];
      const validCampaigns = await tx.campaign.findMany({ where: { id: { in: targetCampaignIds } } });
      const validCampaignById = new Map(validCampaigns.map((campaign) => [campaign.id, campaign]));
      const campaignIdBySource = new Map<string, string>();

      for (const mapping of campaignMappings) {
        let campaign = mapping.targetId ? validCampaignById.get(mapping.targetId) : null;
        if (mapping.targetId && !campaign) throw new Error("A selected campaign mapping is no longer available.");
        if (!campaign) {
          const sourceRecord = parsed.records.find((record) => record.campaignNormalized === mapping.source);
          if (!sourceRecord) continue;
          campaign = await tx.campaign.upsert({
            where: { normalizedName: mapping.source },
            update: { isActive: true },
            create: {
              campaignName: productionDisplayName(sourceRecord.campaignSource),
              normalizedName: mapping.source,
              isActive: true,
              goalType: "production_monitoring",
              monthlyGoal: 0,
              kpiMetric: "production",
            },
          });
        }
        campaignIdBySource.set(mapping.source, campaign.id);
        const targetNormalized = campaign.normalizedName || normalizeProductionName(campaign.campaignName);
        if (mapping.source !== targetNormalized) {
          await tx.campaignAlias.upsert({
            where: { normalizedAlias: mapping.source },
            update: { campaignId: campaign.id, alias: parsed.records.find((record) => record.campaignNormalized === mapping.source)?.campaignSource || mapping.source },
            create: { campaignId: campaign.id, alias: parsed.records.find((record) => record.campaignNormalized === mapping.source)?.campaignSource || mapping.source, normalizedAlias: mapping.source },
          });
        }
      }

      const targetBusinessIds = businessMappings.map((mapping) => mapping.targetId).filter(Boolean) as string[];
      const validBusinessUnits = await tx.businessUnit.findMany({ where: { id: { in: targetBusinessIds } } });
      const validBusinessById = new Map(validBusinessUnits.map((unit) => [unit.id, unit]));
      const businessIdBySource = new Map<string, string>();
      for (const mapping of businessMappings) {
        const campaignId = campaignIdBySource.get(mapping.campaignSource);
        if (!campaignId) continue;
        let businessUnit = mapping.targetId ? validBusinessById.get(mapping.targetId) : null;
        if (mapping.targetId && (!businessUnit || businessUnit.campaignId !== campaignId)) {
          throw new Error("A selected business unit does not belong to the mapped campaign.");
        }
        if (!businessUnit) {
          const sourceRecord = parsed.records.find((record) => record.campaignNormalized === mapping.campaignSource && record.businessUnitNormalized === mapping.source);
          if (!sourceRecord) continue;
          businessUnit = await tx.businessUnit.upsert({
            where: { campaignId_normalizedName: { campaignId, normalizedName: mapping.source } },
            update: { isActive: true },
            create: { campaignId, businessUnitName: productionDisplayName(sourceRecord.businessUnitSource), normalizedName: mapping.source },
          });
        }
        businessIdBySource.set(`${mapping.campaignSource}:${mapping.source}`, businessUnit.id);
        if (mapping.source !== businessUnit.normalizedName) {
          const sourceLabel = parsed.records.find((record) => record.campaignNormalized === mapping.campaignSource && record.businessUnitNormalized === mapping.source)?.businessUnitSource || mapping.source;
          await tx.businessUnitAlias.upsert({
            where: { campaignId_normalizedAlias: { campaignId, normalizedAlias: mapping.source } },
            update: { businessUnitId: businessUnit.id, alias: sourceLabel },
            create: { businessUnitId: businessUnit.id, campaignId, alias: sourceLabel, normalizedAlias: mapping.source },
          });
        }
      }

      let imported = 0;
      let updated = 0;
      let unchanged = 0;
      let skipped = 0;
      let warningCount = 0;
      let errorCount = 0;
      const issues: Prisma.ProductionImportIssueCreateManyInput[] = [];

      for (const record of parsed.records) {
        const recordErrors = record.issues.filter((issue) => issue.level === "ERROR");
        const recordWarnings = record.issues.filter((issue) => issue.level === "WARNING");
        warningCount += recordWarnings.length;
        errorCount += recordErrors.length;
        issues.push(...record.issues.map((issue) => ({
          importId: batch.id,
          sourceSheet: record.sourceSheet.slice(0, 255),
          sourceRow: record.sourceRow,
          level: issue.level,
          code: issue.code,
          message: issue.message,
          rawData: sanitizedIssueData(record) as Prisma.InputJsonObject,
        })));
        if (recordErrors.length || !record.reportYear || !record.reportMonth) {
          skipped += 1;
          continue;
        }
        const campaignId = campaignIdBySource.get(record.campaignNormalized);
        const businessUnitId = businessIdBySource.get(`${record.campaignNormalized}:${record.businessUnitNormalized}`);
        if (!campaignId || !businessUnitId) {
          skipped += 1;
          errorCount += 1;
          issues.push({
            importId: batch.id,
            sourceSheet: record.sourceSheet,
            sourceRow: record.sourceRow,
            level: "ERROR",
            code: "UNRESOLVED_MAPPING",
            message: "Campaign or business unit mapping could not be resolved.",
            rawData: sanitizedIssueData(record) as Prisma.InputJsonObject,
          });
          continue;
        }
        const key = {
          campaignId,
          businessUnitId,
          reportYear: record.reportYear,
          reportMonth: record.reportMonth,
          metricType: record.metricType,
        };
        const existing = await tx.productionMonitoring.findUnique({
          where: { campaignId_businessUnitId_reportYear_reportMonth_metricType: key },
        });
        if (existing?.sourceHash === record.sourceHash) {
          unchanged += 1;
          continue;
        }
        const data = {
          ...key,
          reportPeriod: new Date(Date.UTC(record.reportYear, record.reportMonth - 1, 1)),
          metricUnit: record.metricUnit,
          target: record.target,
          week1: record.week1,
          week2: record.week2,
          week3: record.week3,
          week4: record.week4,
          week5: record.week5,
          mtd: record.mtd,
          achievement: record.achievement,
          runRate: record.runRate,
          workingDays: record.workingDays,
          daysLapse: record.daysLapse,
          dateUpdated: record.dateUpdated ? new Date(record.dateUpdated) : null,
          sourceType: "EXCEL",
          sourceFile: file.name.slice(0, 255),
          sourceSheet: record.sourceSheet.slice(0, 255),
          sourceRow: record.sourceRow,
          sourceHash: record.sourceHash,
        };
        if (existing) {
          await tx.productionMonitoring.update({ where: { id: existing.id }, data });
          await tx.productionMonitoringAudit.create({
            data: {
              productionMonitoringId: existing.id,
              fieldChanged: "imported_values",
              oldValue: existing.sourceHash,
              newValue: record.sourceHash,
              changedById: user.id as string,
              reason: `Updated by production workbook import ${batch.id}.`,
            },
          });
          updated += 1;
        } else {
          await tx.productionMonitoring.create({ data });
          imported += 1;
        }
      }
      if (issues.length) await tx.productionImportIssue.createMany({ data: issues });
      const status = errorCount ? (imported || updated || unchanged ? "COMPLETED_WITH_ERRORS" : "FAILED_VALIDATION") : warningCount ? "COMPLETED_WITH_WARNINGS" : "COMPLETED";
      await tx.productionImport.update({
        where: { id: batch.id },
        data: {
          recordsImported: imported,
          recordsUpdated: updated,
          recordsUnchanged: unchanged,
          recordsSkipped: skipped,
          warningCount,
          errorCount,
          status,
          completedAt: new Date(),
        },
      });
      return { importId: batch.id, imported, updated, unchanged, skipped, warnings: warningCount, errors: errorCount, status };
    }, { timeout: 30_000 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Production import commit error", error);
    let importId: string | null = null;
    try {
      const failed = await prisma.productionImport.create({
        data: {
          fileName: file.name.slice(0, 255),
          reportingPeriods: parsed.reportingPeriods,
          recordsDetected: parsed.records.length,
          errorCount: 1,
          status: "FAILED",
          importedById: user.id,
          completedAt: new Date(),
          issues: { create: { level: "ERROR", code: "TRANSACTION_ROLLBACK", message: "The import transaction was rolled back; no production records were changed." } },
        },
      });
      importId = failed.id;
    } catch (auditError) {
      console.error("Production failed-import audit error", auditError);
    }
    return NextResponse.json({ error: "The production import was rolled back because it could not be completed safely.", importId }, { status: 500 });
  }
}
