import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canImportKpi, getKpiSessionUser, hasCampaignAccess } from "@/lib/kpi-access";
import {
  employeeNameKeys,
  employeeNameSimilarity,
} from "@/lib/kpi-performance";
import { parseKpiWorkbook } from "@/lib/kpi-workbook";

export const runtime = "nodejs";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const user = getKpiSessionUser(await getServerSession(authOptions));
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canImportKpi(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const formData = await request.formData();
    const file = formData.get("file");
    const campaignId = String(formData.get("campaignId") ?? "");
    const fallbackYear = Number(formData.get("reportYear"));
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose an Excel workbook." }, { status: 400 });
    if (!campaignId || !hasCampaignAccess(user, campaignId)) {
      return NextResponse.json({ error: "You do not have access to that campaign." }, { status: 403 });
    }
    if (!/\.xlsx$/i.test(file.name)) {
      return NextResponse.json({ error: "Only .xlsx workbooks are supported." }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "The workbook must be between 1 byte and 10 MB." }, { status: 400 });
    }
    if (!Number.isInteger(fallbackYear) || fallbackYear < 2000 || fallbackYear > 2100) {
      return NextResponse.json({ error: "Choose a valid reporting year." }, { status: 400 });
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, campaignName: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

    let parsed;
    try {
      parsed = parseKpiWorkbook(Buffer.from(await file.arrayBuffer()), file.name, fallbackYear);
    } catch (error) {
      console.error("KPI workbook read error", error);
      return NextResponse.json(
        { error: "We couldn't read this workbook. Confirm that it is a valid .xlsx file." },
        { status: 422 }
      );
    }

    const agents = await prisma.user.findMany({
      where: {
        role: "AGENT",
        OR: [
          { campaignId },
          { campaignAssignments: { some: { campaignId } } },
        ],
      },
      select: { id: true, name: true, seatNumber: true },
      orderBy: { name: "asc" },
    });
    const existing = await prisma.collectorKpiRecord.findMany({
      where: {
        campaignId,
        OR: parsed.records.map((record) => ({ month: record.month, year: record.year })),
      },
      select: { id: true, employeeId: true, month: true, year: true },
    });
    const existingByKey = new Map(
      existing.map((record) => [`${record.employeeId}:${record.year}:${record.month}`, record.id])
    );

    const records = parsed.records.map((record) => {
      const sourceKeys = employeeNameKeys(record.employeeName);
      const codeMatch = record.employeeCode
        ? agents.find((agent) => agent.id.toUpperCase() === record.employeeCode?.toUpperCase())
        : undefined;
      const exactMatch = codeMatch ?? agents.find((agent) =>
        employeeNameKeys(agent.name).some((key) => sourceKeys.includes(key))
      );
      const suggestions = agents
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          confidence: Math.round(employeeNameSimilarity(record.employeeName, agent.name) * 100),
        }))
        .filter((candidate) => candidate.confidence >= 50)
        .sort((left, right) => right.confidence - left.confidence)
        .slice(0, 3);
      const matchedEmployeeId = exactMatch?.id ?? null;
      const matchedEmployeeName = exactMatch?.name ?? null;
      const existingRecordId = matchedEmployeeId
        ? existingByKey.get(`${matchedEmployeeId}:${record.year}:${record.month}`) ?? null
        : null;
      const duplicateWithinFile = record.errors.some((message) => message.includes("Duplicate employee"));
      const status = duplicateWithinFile
        ? "DUPLICATE"
        : record.errors.length
          ? "INVALID"
          : !matchedEmployeeId
            ? "UNMATCHED"
            : existingRecordId
              ? "DUPLICATE"
              : record.warnings.length
                ? "WARNING"
                : "VALID";
      return {
        ...record,
        matchedEmployeeId,
        matchedEmployeeName,
        matchConfidence: exactMatch ? 100 : null,
        matchMethod: codeMatch ? "EMPLOYEE_ID" : exactMatch ? "EXACT_NAME" : null,
        suggestions,
        existingRecordId,
        duplicateWithinFile,
        status,
      };
    });
    const count = (status: string) => records.filter((record) => record.status === status).length;
    return NextResponse.json({
      fileName: file.name,
      campaign,
      worksheets: parsed.worksheets,
      agents,
      records,
      stats: {
        total: records.length,
        valid: count("VALID") + count("WARNING"),
        warnings: count("WARNING"),
        invalid: count("INVALID"),
        duplicates: count("DUPLICATE"),
        unmatched: count("UNMATCHED"),
      },
    });
  } catch (error) {
    console.error("KPI preview error", error);
    return NextResponse.json({ error: "We couldn't analyze this workbook." }, { status: 500 });
  }
}
