import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Papa from "papaparse";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const campaignId = searchParams.get("campaignId");

    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const where: any = { date: { gte: startDate, lte: endDate } };
    if (campaignId) where.campaignId = campaignId;

    const sales = await prisma.dailySales.findMany({
      where,
      include: {
        user: { select: { name: true } },
        campaign: { select: { campaignName: true } },
      },
      orderBy: { date: "asc" },
    });

    const rows = sales.map((s) => ({
      Date: s.date.toISOString().slice(0, 10),
      Agent: s.user.name,
      Campaign: s.campaign.campaignName,
      Transmittals: Number(s.transmittals),
      Activations: Number(s.activations),
      Approvals: Number(s.approvals),
      Booked: Number(s.booked),
      "Quality Rate": s.qualityRate ?? "",
      "Conversion Rate": s.conversionRate ?? "",
    }));

    const csv = Papa.unparse(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="campaigns_export.csv"',
      },
    });
  } catch (error) {
    console.error("Export campaigns error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
