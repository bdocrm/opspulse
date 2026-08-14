import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewKpi, getKpiSessionUser } from "@/lib/kpi-access";
import { kpiRecordScope, serializeKpiRecord, statusWhere } from "@/lib/kpi-query";

export async function GET(request: NextRequest) {
  const user = getKpiSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewKpi(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const params = request.nextUrl.searchParams;
  const month = Number(params.get("month"));
  const year = Number(params.get("year"));
  const campaignId = params.get("campaignId");
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize")) || 25));
  const search = params.get("search")?.trim();
  const tenure = params.get("tenure");
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
    return NextResponse.json({ error: "Choose a valid reporting period." }, { status: 400 });
  }
  const and: Prisma.CollectorKpiRecordWhereInput[] = [
    kpiRecordScope(user),
    statusWhere(params.get("status")),
  ];
  if (campaignId) and.push({ campaignId });
  if (tenure && tenure !== "ALL") and.push({ tenure: { equals: tenure, mode: "insensitive" } });
  if (search) and.push({ employeeNameSnapshot: { contains: search, mode: "insensitive" } });
  const where: Prisma.CollectorKpiRecordWhereInput = { month, year, AND: and };
  const [total, records] = await prisma.$transaction([
    prisma.collectorKpiRecord.count({ where }),
    prisma.collectorKpiRecord.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, seatNumber: true } },
        campaign: { select: { id: true, campaignName: true } },
      },
      orderBy: [{ overallScore: "desc" }, { employeeNameSnapshot: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return NextResponse.json({
    records: records.map(serializeKpiRecord),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
}
