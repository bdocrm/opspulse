import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canImportKpi, getKpiSessionUser, hasCampaignAccess } from "@/lib/kpi-access";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const user = getKpiSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canImportKpi(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const batch = await prisma.kpiImportBatch.findUnique({
    where: { id: params.id },
    include: {
      campaign: { select: { id: true, campaignName: true } },
      uploadedBy: { select: { id: true, name: true } },
      issues: { orderBy: [{ sourceSheet: "asc" }, { sourceRow: "asc" }], take: 1000 },
      events: { orderBy: { createdAt: "asc" }, take: 2000 },
      records: {
        select: {
          id: true, employeeId: true, employeeNameSnapshot: true, month: true, year: true,
          sourceSheet: true, sourceRow: true, createdAt: true, updatedAt: true,
        },
        orderBy: [{ year: "desc" }, { month: "desc" }, { employeeNameSnapshot: "asc" }],
        take: 1000,
      },
    },
  });
  if (!batch) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  if (!hasCampaignAccess(user, batch.campaignId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ batch });
}
