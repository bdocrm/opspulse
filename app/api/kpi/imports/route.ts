import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canImportKpi, getKpiSessionUser, getSessionCampaignIds } from "@/lib/kpi-access";

export async function GET(request: NextRequest) {
  const user = getKpiSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canImportKpi(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get("pageSize")) || 25));
  const campaignId = request.nextUrl.searchParams.get("campaignId");
  const scopedIds = getSessionCampaignIds(user);
  const where = {
    AND: [
      ...(user.role === "CEO" ? [] : [{ campaignId: { in: scopedIds } }]),
      ...(campaignId ? [{ campaignId }] : []),
    ],
  };
  const [total, batches] = await prisma.$transaction([
    prisma.kpiImportBatch.count({ where }),
    prisma.kpiImportBatch.findMany({
      where,
      include: {
        campaign: { select: { campaignName: true } },
        uploadedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return NextResponse.json({
    batches,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
}
