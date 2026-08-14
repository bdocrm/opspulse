import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewKpi, getKpiSessionUser, getSessionCampaignIds } from "@/lib/kpi-access";

export async function GET() {
  const user = getKpiSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewKpi(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const scopedIds = getSessionCampaignIds(user);
  const campaigns = await prisma.campaign.findMany({
    where:
      user.role === "CEO" || user.role === "SMT"
        ? undefined
        : { id: { in: scopedIds } },
    select: { id: true, campaignName: true },
    orderBy: { campaignName: "asc" },
  });
  return NextResponse.json({ campaigns });
}
