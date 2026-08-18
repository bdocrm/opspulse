import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAdminProduction, canImportProduction, getProductionSessionUser, productionCampaignScope } from "@/lib/production-access";
import {
  buildBusinessUnitMappings,
  buildCampaignMappings,
  validateProductionWorkbookFile,
} from "@/lib/production-import";
import { parseProductionWorkbook } from "@/lib/production-workbook";

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
    const campaignMappings = buildCampaignMappings(parsed.records, campaigns);
    const businessUnitMappings = buildBusinessUnitMappings(parsed.records, campaignMappings, businessUnits);
    const periods = parsed.reportingPeriods.map((period) => ({ reportYear: period.year, reportMonth: period.month }));
    const existing = periods.length ? await prisma.productionMonitoring.findMany({
      where: { OR: periods },
      select: { id: true, campaignId: true, businessUnitId: true, reportYear: true, reportMonth: true, metricType: true, sourceHash: true },
    }) : [];
    const existingByKey = new Map(existing.map((record) => [[record.campaignId, record.businessUnitId, record.reportYear, record.reportMonth, record.metricType].join(":"), record]));
    const records = parsed.records.map((record) => {
      const campaignMapping = campaignMappings.find((mapping) => mapping.normalizedSource === record.campaignNormalized);
      const businessMapping = businessUnitMappings.find((mapping) => mapping.key === `${record.campaignNormalized}:${record.businessUnitNormalized}`);
      const existingRecord = campaignMapping?.matchedCampaignId && businessMapping?.matchedBusinessUnitId
        ? existingByKey.get([campaignMapping.matchedCampaignId, businessMapping.matchedBusinessUnitId, record.reportYear, record.reportMonth, record.metricType].join(":"))
        : null;
      const hasError = record.issues.some((issue) => issue.level === "ERROR");
      const hasWarning = record.issues.some((issue) => issue.level === "WARNING");
      const mappingReview = campaignMapping?.requiresReview || businessMapping?.requiresReview;
      const status = hasError
        ? "ERROR"
        : mappingReview
          ? "CONFLICT"
          : existingRecord?.sourceHash === record.sourceHash
            ? "UNCHANGED"
            : existingRecord
              ? "UPDATED"
              : hasWarning
                ? "WARNING"
                : "NEW";
      return { ...record, existingRecordId: existingRecord?.id ?? null, status };
    });
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
      canCreateCampaigns: canAdminProduction(user),
      records,
      stats: {
        total: records.length,
        valid: records.filter((record) => !record.issues.some((issue) => issue.level === "ERROR")).length,
        new: count("NEW") + count("WARNING"),
        updated: count("UPDATED"),
        unchanged: count("UNCHANGED"),
        conflicts: count("CONFLICT"),
        warnings: records.filter((record) => record.issues.some((issue) => issue.level === "WARNING")).length,
        errors: count("ERROR"),
      },
    });
  } catch (error) {
    console.error("Production import preview error", error);
    return NextResponse.json({ error: "We couldn't analyze this workbook." }, { status: 500 });
  }
}
