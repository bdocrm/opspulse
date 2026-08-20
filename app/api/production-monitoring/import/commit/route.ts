import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAdminProduction, canImportProduction, getProductionSessionUser, hasProductionCampaignAccess } from "@/lib/production-access";
import {
  parseBusinessUnitCommitMappings,
  parseCommitMappings,
  validateProductionWorkbookFile,
} from "@/lib/production-import";
import { productionDisplayName } from "@/lib/production-normalization";
import { parseProductionWorkbook } from "@/lib/production-workbook";
import { productionMonthImportAction, productionMonthKey, type ProductionMonthImportStrategy } from "@/lib/production-month-import";
import {
  buildCampaignMappingKey,
  campaignMappingLookup,
  loadCampaignMappings,
  saveCampaignMapping,
} from "@/lib/campaign-mapping";

export const runtime = "nodejs";

const sanitizedIssueData = (record: ReturnType<typeof parseProductionWorkbook>["records"][number]) => ({
  campaign: record.campaignSource,
  businessUnit: record.businessUnitSource,
  reportYear: record.reportYear,
  reportMonth: record.reportMonth,
  metricType: record.metricType,
  target: record.target,
});

type ParsedRecord = ReturnType<typeof parseProductionWorkbook>["records"][number];

function parseRequestedRowKeys(value: FormDataEntryValue | null) {
  if (value == null) return null;
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.slice(0, 10_000).filter((item): item is string => typeof item === "string" && item.length <= 500));
  } catch {
    return new Set<string>();
  }
}

function issueInput(importId: string, record: ParsedRecord, issue: { level: "WARNING" | "ERROR"; code: string; message: string }) {
  return {
    importId,
    sourceSheet: record.sourceSheet.slice(0, 255),
    sourceRow: record.sourceRow,
    level: issue.level,
    code: issue.code,
    message: issue.message,
    rawData: sanitizedIssueData(record) as Prisma.InputJsonObject,
  } satisfies Prisma.ProductionImportIssueCreateManyInput;
}

function validationField(code: string) {
  if (code.includes("CAMPAIGN")) return "campaign";
  if (code.includes("BUSINESS_UNIT") || code === "UNRESOLVED_MAPPING") return "businessUnit";
  if (code.includes("TARGET")) return "target";
  if (code.includes("PERIOD")) return "period";
  if (code.includes("WEEK")) return "week";
  if (code.includes("MTD")) return "mtd";
  if (code.includes("ACHIEVEMENT")) return "achievement";
  if (code.includes("RUN_RATE")) return "runRate";
  return "row";
}

export async function POST(request: NextRequest) {
  const user = getProductionSessionUser(await getServerSession(authOptions));
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canImportProduction(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
  const importStrategy: ProductionMonthImportStrategy = form.get("importStrategy") === "update_existing" ? "update_existing" : "fill_missing";
  const requestedRowKeys = parseRequestedRowKeys(form.get("validRowKeys"));
  const isRequested = (record: ParsedRecord) => requestedRowKeys == null || requestedRowKeys.has(record.rowKey);
  const requestedBaseValidRecords = parsed.records.filter((record) =>
    isRequested(record) && !record.issues.some((issue) => issue.level === "ERROR")
  );
  const requestedCampaignSources = new Set(requestedBaseValidRecords
    .filter((record) => record.campaignNormalized && record.businessUnitNormalized)
    .map((record) => buildCampaignMappingKey(record.campaignSource, record.businessUnitSource)));
  const requestedBusinessSources = new Set(requestedBaseValidRecords
    .filter((record) => record.campaignNormalized && record.businessUnitNormalized)
    .map((record) => buildCampaignMappingKey(record.campaignSource, record.businessUnitSource)));
  if (!canAdminProduction(user)) {
    if (campaignMappings.some((mapping) => requestedCampaignSources.has(mapping.key) && mapping.targetId && !hasProductionCampaignAccess(user, mapping.targetId))) {
      return NextResponse.json({ error: "One or more detected campaigns are outside your assigned campaign access." }, { status: 403 });
    }
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
      const sourcePairs = requestedBaseValidRecords.map((record) => ({ sourceAccount: record.campaignSource, sourceCampaign: record.businessUnitSource }));
      const savedMappings = await loadCampaignMappings(tx, sourcePairs);
      const savedLookup = campaignMappingLookup(savedMappings);
      const submittedLookup = new Map(campaignMappings.filter((mapping) => requestedCampaignSources.has(mapping.key)).map((mapping) => [mapping.key, mapping]));
      const targetCampaignIds = Array.from(new Set([
        ...campaignMappings.map((mapping) => mapping.targetId),
        ...savedMappings.filter((mapping) => mapping.status === "ACTIVE").map((mapping) => mapping.opsviewCampaignId),
      ].filter(Boolean) as string[]));
      const validCampaigns = await tx.campaign.findMany({ where: { id: { in: targetCampaignIds }, isActive: true } });
      const validCampaignById = new Map(validCampaigns.map((campaign) => [campaign.id, campaign]));
      const campaignIdBySource = new Map<string, string>();
      const mappingIdBySource = new Map<string, string>();

      for (const record of requestedBaseValidRecords) {
        const key = buildCampaignMappingKey(record.campaignSource, record.businessUnitSource);
        if (campaignIdBySource.has(key)) continue;
        const submitted = submittedLookup.get(key);
        const saved = savedLookup.get(key);
        const targetId = submitted?.targetId || (saved?.status === "ACTIVE" ? saved.opsviewCampaignId : null);
        const campaign = targetId ? validCampaignById.get(targetId) : null;
        if (!campaign) continue;
        if (!canAdminProduction(user) && !hasProductionCampaignAccess(user, campaign.id)) continue;
        campaignIdBySource.set(key, campaign.id);
        if (submitted?.remember !== false && (!saved || saved.status !== "ACTIVE" || saved.opsviewCampaignId !== campaign.id)) {
          const savedResult = await saveCampaignMapping(tx, {
            sourceAccount: record.campaignSource,
            sourceCampaign: record.businessUnitSource,
            opsviewCampaignId: campaign.id,
            mappingType: submitted ? "MANUAL" : "AUTO",
          }, user.id as string, batch.id);
          mappingIdBySource.set(key, savedResult.mapping.id);
        } else if (saved?.status === "ACTIVE") {
          mappingIdBySource.set(key, saved.id);
        }
      }

      const usedBusinessMappings = businessMappings.filter((mapping) => requestedBusinessSources.has(mapping.key));
      const targetBusinessIds = usedBusinessMappings.map((mapping) => mapping.targetId).filter(Boolean) as string[];
      const validBusinessUnits = await tx.businessUnit.findMany({ where: { id: { in: targetBusinessIds } } });
      const validBusinessById = new Map(validBusinessUnits.map((unit) => [unit.id, unit]));
      const businessIdBySource = new Map<string, string>();
      for (const mapping of usedBusinessMappings) {
        const campaignId = campaignIdBySource.get(mapping.key);
        if (!campaignId) continue;
        let businessUnit = mapping.targetId ? validBusinessById.get(mapping.targetId) : null;
        if (businessUnit && businessUnit.campaignId !== campaignId) businessUnit = null;
        if (!businessUnit && !mapping.targetId) {
          const sourceRecord = parsed.records.find((record) => buildCampaignMappingKey(record.campaignSource, record.businessUnitSource) === mapping.key);
          if (!sourceRecord) continue;
          businessUnit = await tx.businessUnit.upsert({
            where: { campaignId_normalizedName: { campaignId, normalizedName: mapping.source } },
            update: { isActive: true },
            create: { campaignId, businessUnitName: productionDisplayName(sourceRecord.businessUnitSource), normalizedName: mapping.source },
          });
        }
        if (!businessUnit) continue;
        businessIdBySource.set(mapping.key, businessUnit.id);
        if (mapping.source !== businessUnit.normalizedName) {
          const sourceLabel = parsed.records.find((record) => buildCampaignMappingKey(record.campaignSource, record.businessUnitSource) === mapping.key)?.businessUnitSource || mapping.source;
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
      const validationErrors: Array<{ row: number; sheet: string; campaign: string; businessUnit: string; field: string; message: string }> = [];
      const mappingUseCounts = new Map<string, number>();

      const resolvedRecords = parsed.records.map((record) => {
        const recordIssues = [...record.issues];
        const mappingKey = buildCampaignMappingKey(record.campaignSource, record.businessUnitSource);
        const campaignId = campaignIdBySource.get(mappingKey);
        const campaignMappingId = mappingIdBySource.get(mappingKey);
        const businessUnitId = businessIdBySource.get(mappingKey);
        if (!recordIssues.some((issue) => issue.level === "ERROR")) {
          if (!campaignId) {
            recordIssues.push({ level: "ERROR", code: "CAMPAIGN_MAPPING_REQUIRED", message: `Mapping required for campaign "${record.businessUnitSource}" under account "${record.campaignSource}".` });
          } else if (!businessUnitId) {
            recordIssues.push({ level: "ERROR", code: "BUSINESS_UNIT_MAPPING_REQUIRED", message: "Business Unit mapping is required." });
          }
        }
        return { record, recordIssues, campaignId, campaignMappingId, businessUnitId };
      });

      const importableRecords = resolvedRecords.filter(({ record, recordIssues, campaignId, businessUnitId }) =>
        isRequested(record) &&
        Boolean(campaignId && businessUnitId && record.reportYear && record.reportMonth) &&
        !recordIssues.some((issue) => issue.level === "ERROR")
      );
      const existingPeriods = Array.from(new Map(importableRecords.map(({ record }) => [
        `${record.reportYear}:${record.reportMonth}`,
        { reportYear: record.reportYear as number, reportMonth: record.reportMonth as number },
      ])).values());
      const existingRecords = importableRecords.length
        ? await tx.productionMonitoring.findMany({ where: {
          campaignId: { in: Array.from(new Set(importableRecords.map(({ campaignId }) => campaignId as string))) },
          OR: existingPeriods,
        } })
        : [];
      const existingByKey = new Map(existingRecords.map((record) => [
        [record.campaignId, record.businessUnitId, record.reportYear, record.reportMonth, record.metricType].join(":"),
        record,
      ]));
      const existingMonthKeys = new Set(existingRecords.map((record) => productionMonthKey(record.campaignId, record.reportYear, record.reportMonth)));
      const importedMonthKeys = new Set<string>();
      const updatedMonthKeys = new Set<string>();
      const skippedMonthKeys = new Set<string>();
      if (importStrategy === "fill_missing") {
        for (const { record, campaignId } of resolvedRecords) {
          if (campaignId && record.reportYear && record.reportMonth) {
            const monthKey = productionMonthKey(campaignId, record.reportYear, record.reportMonth);
            if (existingMonthKeys.has(monthKey)) skippedMonthKeys.add(monthKey);
          }
        }
      }

      for (const { record, recordIssues, campaignId, campaignMappingId, businessUnitId } of resolvedRecords) {
        const recordErrors = recordIssues.filter((issue) => issue.level === "ERROR");
        const recordWarnings = recordIssues.filter((issue) => issue.level === "WARNING");
        warningCount += recordWarnings.length;
        errorCount += recordErrors.length;
        issues.push(...recordIssues.map((issue) => issueInput(batch.id, record, issue)));
        validationErrors.push(...recordErrors.map((issue) => ({
          row: record.sourceRow,
          sheet: record.sourceSheet,
          campaign: record.campaignSource,
          businessUnit: record.businessUnitSource,
          field: validationField(issue.code),
          message: issue.message,
        })));
        if (recordErrors.length || !record.reportYear || !record.reportMonth || !isRequested(record)) {
          skipped += 1;
          continue;
        }
        if (!campaignId || !businessUnitId) {
          skipped += 1;
          continue;
        }
        if (campaignMappingId) mappingUseCounts.set(campaignMappingId, (mappingUseCounts.get(campaignMappingId) ?? 0) + 1);
        const monthKey = productionMonthKey(campaignId, record.reportYear, record.reportMonth);
        if (productionMonthImportAction(existingMonthKeys.has(monthKey), importStrategy) === "SKIP") {
          skipped += 1;
          skippedMonthKeys.add(monthKey);
          continue;
        }
        const key = {
          campaignId,
          businessUnitId,
          reportYear: record.reportYear,
          reportMonth: record.reportMonth,
          metricType: record.metricType,
        };
        const existing = existingByKey.get([campaignId, businessUnitId, record.reportYear, record.reportMonth, record.metricType].join(":"));
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
          sourceAccount: record.campaignSource,
          sourceCampaign: record.businessUnitSource,
          campaignMappingId: campaignMappingId ?? null,
          productionImportId: batch.id,
          importedById: user.id as string,
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
          updatedMonthKeys.add(monthKey);
        } else {
          await tx.productionMonitoring.create({ data });
          imported += 1;
          importedMonthKeys.add(monthKey);
        }
      }
      for (const [mappingId, count] of mappingUseCounts) {
        await tx.campaignMapping.update({
          where: { id: mappingId },
          data: { usageCount: { increment: count }, lastUsedAt: new Date() },
        });
        await tx.campaignMappingAudit.create({
          data: {
            mappingId,
            action: "USED_DURING_IMPORT",
            importId: batch.id,
            changedById: user.id as string,
            details: { affectedRows: count },
          },
        });
      }
      if (issues.length) await tx.productionImportIssue.createMany({ data: issues });
      const processed = imported + updated + unchanged;
      const invalidRows = resolvedRecords.filter(({ recordIssues }) => recordIssues.some((issue) => issue.level === "ERROR")).length;
      const status = skipped
        ? (processed ? "COMPLETED_WITH_SKIPPED_ROWS" : "FAILED_VALIDATION")
        : warningCount ? "COMPLETED_WITH_WARNINGS" : "COMPLETED";
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
      return {
        success: true,
        importId: batch.id,
        imported,
        updated,
        unchanged,
        skipped,
        invalidRows,
        warnings: warningCount,
        errors: errorCount,
        validationErrors,
        importStrategy,
        months: {
          imported: importedMonthKeys.size,
          updated: updatedMonthKeys.size,
          skipped: skippedMonthKeys.size,
        },
        status,
        summary: {
          detected: parsed.records.length,
          submitted: importableRecords.length,
          inserted: imported,
          updated,
          unchanged,
          skipped,
          failed: 0,
        },
      };
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
