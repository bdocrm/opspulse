import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewKpi, getKpiSessionUser } from "@/lib/kpi-access";
import { kpiRecordScope, serializeKpiRecord } from "@/lib/kpi-query";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = getKpiSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewKpi(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const employeeId = user.role === "AGENT" ? user.id as string : params.id;
  if (user.role === "AGENT" && params.id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const month = Number(request.nextUrl.searchParams.get("month"));
  const year = Number(request.nextUrl.searchParams.get("year"));
  const campaignId = request.nextUrl.searchParams.get("campaignId");
  const employee = await prisma.user.findFirst({
    where: { id: employeeId, role: "AGENT" },
    select: { id: true, name: true, seatNumber: true },
  });
  if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  const records = await prisma.collectorKpiRecord.findMany({
    where: { AND: [kpiRecordScope(user), { employeeId }, ...(campaignId ? [{ campaignId }] : [])] },
    include: { campaign: { select: { id: true, campaignName: true } } },
    orderBy: { periodDate: "desc" },
    take: 24,
  });
  const current = records.find((record) => record.month === month && record.year === year) ?? records[0] ?? null;
  return NextResponse.json({
    employee,
    current: current ? serializeKpiRecord(current) : null,
    history: records.slice().reverse().map(serializeKpiRecord),
  });
}
