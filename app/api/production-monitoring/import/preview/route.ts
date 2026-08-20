import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateCampaignMappings, canImportProduction, canManageCampaignMappings, getProductionSessionUser, hasProductionCampaignAccess, productionCampaignScope } from "@/lib/production-access";
import {
  buildBusinessUnitMappings,
  buildCampaignMappings,
  validateProductionWorkbookFile,
} from "@/lib/production-import";
import { parseProductionWorkbook } from "@/lib/production-workbook";
import { productionMonthKey } from "@/lib/production-month-import";
import { buildCampaignMappingKey, loadCampaignMappings } from "@/lib/campaign-mapping";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const user = getProductionSessionUser(await getServerSession(authOptions));
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canImportProduction(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const form = await request.formData();
    const file = form.get("file");
    const fallbackMonth = Number(form.get("reportMonth"));
    const fallbackYear = Number(form.get("reportYear"));
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose an Excel workbook." }, { status: 400 });
    if (!Number.isInteger(fallbackMonth) || fallbackMonth < 1 || fallbackMonth > 12 || !Number.isInteger(fallbackYear) || fallbackYear < 2000 || fallbackYear > 2100) {
      return NextResponse.json({ error: "Choose a valid fallback reporting month and year." }, { status: 400 });
    }
    const validated = await validateProductionWorkbookFile(file);
    if (typeof validated === "string") return NextResponse.json({ error: validated }, { status: 400 });
    let parsed;
    try {
      parsed = parseProductionWorkbook(validated, file.name, { month: fallbackMonth, year: fallbackYear });
    } catch (error) {
      console.error("Production workbook read error", error);
      return NextResponse.json({ error: "We couldn't read this workbook. Confirm that it is a valid, non-corrupted .xlsx file." }, { status: 422 });
    }
    if (!parsed.records.length) {
      return NextResponse.json({ error: "No recognizable production monitoring rows were found." }, { status: 422 });
    }
    const scope = productionCampaignScope(user);
    const [campaigns, businessUnits] = await Promise.all([
      prisma.campaign.findMany({
        where: { isActive: true, ...(scope.campaignId ? { id: scope.campaignId } : {}) },
        include: { productionAliases: true },
        orderBy: { campaignName: "asc" },
      }),
      prisma.businessUnit.findMany({
        where: { isActive: true, ...(scope.campaignId ? { campaignId: scope.campaignId } : {}) },
        include: { aliases: true },
        orderBy: { businessUnitName: "asc" },
      }),
    ]);
    const savedMappings = await loadCampaignMappings(prisma, parsed.records.map((record) => ({
      sourceAccount: record.campaignSource,
      sourceCampaign: record.businessUnitSource,
    })));
    const campaignMappings = buildCampaignMappings(
      parsed.records,
      campaigns,
      savedMappings.filter((mapping) => hasProductionCampaignAccess(user, mapping.opsviewCampaignId)),
    );
    const businessUnitMappings = buildBusinessUnitMappings(parsed.records, campaignMappings, businessUnits);
    const periods = parsed.reportingPeriods.map((period) => ({ reportYear: period.year, reportMonth: period.month }));
    const existing = periods.length ? await prisma.productionMonitoring.findMany({
      where: { campaignId: { in: campaigns.map((campaign) => campaign.id) }, OR: periods },
      select: { id: true, campaignId: true, businessUnitId: true, reportYear: true, reportMonth: true, metricType: true, sourceHash: true },
    }) : [];
    const existingByKey = new Map(existing.map((record) => [[record.campaignId, record.businessUnitId, record.reportYear, record.reportMonth, record.metricType].join(":"), record]));
    const existingMonthKeys = new Set(existing.map((record) => productionMonthKey(record.campaignId, record.reportYear, record.reportMonth)));
    const records = parsed.records.map((record) => {
      const mappingKey = buildCampaignMappingKey(record.campaignSource, record.businessUnitSource);
      const campaignMapping = campaignMappings.find((mapping) => mapping.key === mappingKey);
      const businessMapping = businessUnitMappings.find((mapping) => mapping.key === mappingKey);
      const existingRecord = campaignMapping?.matchedCampaignId && businessMapping?.matchedBusinessUnitId
        ? existingByKey.get([campaignMapping.matchedCampaignId, businessMapping.matchedBusinessUnitId, record.reportYear, record.reportMonth, record.metricType].join(":"))
        : null;
      const hasError = record.issues.some((issue) => issue.level === "ERROR");
      const hasWarning = record.issues.some((issue) => issue.level === "WARNING");
      const mappingInvalid = campaignMapping?.resolution === "INVALID";
      const mappingRequired = !campaignMapping?.matchedCampaignId;
      const mappingReview = businessMapping?.requiresReview;
      const status = hasError
        ? "ERROR"
        : mappingInvalid
          ? "MAPPING_INVALID"
        : mappingRequired
          ? "MAPPING_REQUIRED"
        : mappingReview
          ? "CONFLICT"
          : existingRecord?.sourceHash === record.sourceHash
            ? "UNCHANGED"
            : existingRecord
              ? "UPDATED"
              : hasWarning
                ? "WARNING"
                : campaignMapping?.resolution === "EXPLICIT" ? "AUTO_MAPPED" : "NEW";
      const monthStatus = campaignMapping?.matchedCampaignId && record.reportYear && record.reportMonth
        ? existingMonthKeys.has(productionMonthKey(campaignMapping.matchedCampaignId, record.reportYear, record.reportMonth)) ? "EXISTING" : "NEW"
        : "UNKNOWN";
      return {
        ...record,
        existingRecordId: existingRecord?.id ?? null,
        status,
        monthStatus,
        campaignMappingId: campaignMapping?.mappingId ?? null,
        mappedCampaignId: campaignMapping?.matchedCampaignId ?? null,
        mappedCampaignName: campaignMapping?.matchedCampaignName ?? null,
        mappingType: campaignMapping?.mappingType ?? null,
        mappingResolution: campaignMapping?.resolution ?? "MAPPING_REQUIRED",
      };
    });
    const monthSummary = [...new Map(records
      .filter((record) => record.reportYear && record.reportMonth && record.campaignNormalized)
      .map((record) => {
        const mappingKey = buildCampaignMappingKey(record.campaignSource, record.businessUnitSource);
        const key = `${mappingKey}:${record.reportYear}:${record.reportMonth}`;
        return [key, {
          key,
          mappingKey,
          campaignSource: record.campaignSource,
          sourceCampaign: record.businessUnitSource,
          campaignNormalized: mappingKey,
          reportYear: record.reportYear as number,
          reportMonth: record.reportMonth as number,
          status: record.monthStatus,
        }];
      })).values()];
    const count = (status: string) => records.filter((record) => record.status === status).length;
    return NextResponse.json({
      fileName: parsed.fileName,
      worksheets: parsed.worksheets,
      reportingPeriods: parsed.reportingPeriods,
      detectedWeeks: parsed.detectedWeeks,
      excludedFields: parsed.excludedFields,
      campaignMappings,
      businessUnitMappings,
      availableCampaigns: campaigns.map((campaign) => ({ id: campaign.id, name: campaign.campaignName })),
      availableBusinessUnits: businessUnits.map((unit) => ({ id: unit.id, campaignId: unit.campaignId, name: unit.businessUnitName })),
      canCreateCampaigns: false,
      canCreateMappings: canCreateCampaignMappings(user),
      canManageMappings: canManageCampaignMappings(user),
      existingMonthKeys: [...existingMonthKeys],
      monthSummary,
      records,
      stats: {
        total: records.length,
        valid: records.filter((record) => !record.issues.some((issue) => issue.level === "ERROR")).length,
        new: count("NEW") + count("WARNING"),
        updated: count("UPDATED"),
        unchanged: count("UNCHANGED"),
        conflicts: count("CONFLICT"),
        autoMapped: count("AUTO_MAPPED"),
        mappingRequired: count("MAPPING_REQUIRED"),
        mappingInvalid: count("MAPPING_INVALID"),
        warnings: records.filter((record) => record.issues.some((issue) => issue.level === "WARNING")).length,
        errors: count("ERROR"),
      },
    });
  } catch (error) {
    console.error("Production import preview error", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) {
      return NextResponse.json({ error: "Campaign mapping database setup is incomplete. Ask an administrator to apply the pending database migration." }, { status: 503 });
    }
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return NextResponse.json({ error: "OpsView could not connect to the database. Please try again shortly." }, { status: 503 });
    }
    return NextResponse.json({ error: "We couldn't analyze this workbook." }, { status: 500 });
  }
}
