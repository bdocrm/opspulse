import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewKpi, getKpiSessionUser } from "@/lib/kpi-access";
import { kpiRecordScope, serializeKpiRecord } from "@/lib/kpi-query";

export async function GET(request: NextRequest) {
  const user = getKpiSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewKpi(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const requestedEmployeeId = request.nextUrl.searchParams.get("employeeId");
  const employeeId = user.role === "AGENT" ? user.id : requestedEmployeeId;
  if (!employeeId) return NextResponse.json({ error: "Employee is required." }, { status: 400 });
  const months = Math.min(24, Math.max(3, Number(request.nextUrl.searchParams.get("months")) || 12));
  const campaignId = request.nextUrl.searchParams.get("campaignId");
  const records = await prisma.collectorKpiRecord.findMany({
    where: {
      AND: [kpiRecordScope(user), { employeeId }, ...(campaignId ? [{ campaignId }] : [])],
    },
    include: { campaign: { select: { id: true, campaignName: true } } },
    orderBy: { periodDate: "desc" },
    take: months,
  });
  return NextResponse.json({ records: records.reverse().map(serializeKpiRecord) });
}
