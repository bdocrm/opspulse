import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getBulkImportedCampaignIds } from "@/lib/bulk-import-reports";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = session.user as any;
    if (user.role !== "CEO" && user.role !== "OM") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? now.getFullYear().toString());
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "Invalid report period" }, { status: 400 });
    }

    const scopedCampaignIds =
      user.role === "CEO"
        ? undefined
        : Array.from(
            new Set(
              [
                user.campaignId,
                ...(Array.isArray(user.campaignIds) ? user.campaignIds : []),
              ].filter(Boolean) as string[]
            )
          );
    const importedCampaignIds = await getBulkImportedCampaignIds(scopedCampaignIds);

    if (importedCampaignIds.length === 0) {
      return NextResponse.json({ campaigns: [] });
    }

    const campaigns = await prisma.campaign.findMany({
      where: { id: { in: importedCampaignIds } },
      select: {
        id: true,
        campaignName: true,
        monthlyGoal: true,
        kpiMetric: true,
        monthlyGoals: {
          where: { year, month },
          select: { monthlyGoal: true, kpiMetric: true },
          take: 1,
        },
      },
      orderBy: { campaignName: "asc" },
    });

    return NextResponse.json({
      campaigns: campaigns.map(({ monthlyGoals, ...campaign }) => ({
        ...campaign,
        monthlyGoal: Number(monthlyGoals[0]?.monthlyGoal ?? campaign.monthlyGoal ?? 0),
        kpiMetric: monthlyGoals[0]?.kpiMetric ?? campaign.kpiMetric,
      })),
    });
  } catch (error) {
    console.error("Imported campaign report list error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
