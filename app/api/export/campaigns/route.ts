export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Papa from "papaparse";

const BUSINESS_TIME_ZONE_OFFSET = "+08:00";

type MetricKey = "transmittals" | "activations" | "approvals" | "booked" | "volume" | "transaction";
type MetricTotals = Record<MetricKey, number>;

function monthRange(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();

  return {
    start: new Date(`${year}-${mm}-01T00:00:00.000${BUSINESS_TIME_ZONE_OFFSET}`),
    end: new Date(`${year}-${mm}-${String(lastDay).padStart(2, "0")}T23:59:59.999${BUSINESS_TIME_ZONE_OFFSET}`),
  };
}

function normalizeMetric(metric: string | null | undefined): MetricKey {
  const normalized = (metric ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (["activation", "activations", "activated", "act"].includes(normalized)) return "activations";
  if (["approval", "approvals", "approved", "appr"].includes(normalized)) return "approvals";
  if (["book", "booked", "booking", "bookings"].includes(normalized)) return "booked";
  if (["volume", "vol"].includes(normalized)) return "volume";
  if (["transaction", "transactions", "txn", "txns"].includes(normalized)) return "transaction";
  return "transmittals";
}

function resolveEffectiveMetric(metric: MetricKey, goal: number, totals: MetricTotals, agentGoals: number[]) {
  const configuredActual = totals[metric];
  const averageAgentGoal =
    agentGoals.length > 0 ? agentGoals.reduce((sum, value) => sum + value, 0) / agentGoals.length : 0;
  const looksLikeMoneyGoal = goal >= 1_000_000 || averageAgentGoal >= 1_000_000;
  const hasMeaningfulVolume = totals.volume > configuredActual && totals.volume > 0;

  return metric !== "volume" && looksLikeMoneyGoal && hasMeaningfulVolume ? "volume" : metric;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const campaignId = searchParams.get("campaignId");
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));
    const { start: startDate, end: endDate } = monthRange(year, month);

    const [campaign, monthlyConfig] = campaignId
      ? await Promise.all([
          prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { campaignName: true, monthlyGoal: true, kpiMetric: true },
          }),
          prisma.campaignGoal.findFirst({
            where: { campaignId, month, year },
            select: { monthlyGoal: true, kpiMetric: true },
          }),
        ])
      : [null, null];

    const details = await prisma.productionDetail.findMany({
      where: {
        ...(campaignId ? { campaignId } : {}),
        productionEntry: {
          OR: [
            { date: { gte: startDate, lte: endDate } },
            {
              periodStart: { lte: endDate },
              periodEnd: { gte: startDate },
            },
          ],
        },
      },
      select: {
        transmittals: true,
        activations: true,
        approvals: true,
        booked: true,
        volume: true,
        transaction: true,
        agent: { select: { name: true, monthlyTarget: true } },
        campaign: { select: { campaignName: true, monthlyGoal: true, kpiMetric: true } },
        productionEntry: { select: { date: true, periodStart: true, periodEnd: true } },
      },
      orderBy: { productionEntry: { date: "asc" } },
    });

    const totals = details.reduce(
      (sum, d) => ({
        transmittals: sum.transmittals + Number(d.transmittals || 0),
        activations: sum.activations + Number(d.activations || 0),
        approvals: sum.approvals + Number(d.approvals || 0),
        booked: sum.booked + Number(d.booked || 0),
        volume: sum.volume + Number(d.volume || 0),
        transaction: sum.transaction + Number(d.transaction || 0),
      }),
      { transmittals: 0, activations: 0, approvals: 0, booked: 0, volume: 0, transaction: 0 }
    );
    const goal = Number(monthlyConfig?.monthlyGoal ?? campaign?.monthlyGoal ?? details[0]?.campaign.monthlyGoal ?? 0);
    const configuredMetric = normalizeMetric(monthlyConfig?.kpiMetric ?? campaign?.kpiMetric ?? details[0]?.campaign.kpiMetric);
    const agentGoals = details.map((d) => Number(d.agent.monthlyTarget || 0)).filter((target) => target > 0);
    const effectiveMetric = resolveEffectiveMetric(configuredMetric, goal, totals, agentGoals);

    const rows = [
      {
        Section: "KPI",
        Campaign: campaign?.campaignName ?? details[0]?.campaign.campaignName ?? "",
        "Date Range": `${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`,
        "Monthly Goal": goal,
        "KPI Metric": effectiveMetric,
        MTD: totals[effectiveMetric],
        Transmittals: totals.transmittals,
        Activations: totals.activations,
        Approvals: totals.approvals,
        Booked: totals.booked,
        Volume: totals.volume,
        Transaction: totals.transaction,
      },
      ...details.map((d) => ({
        Section: "Agent Breakdown",
        Date: (d.productionEntry.periodEnd ?? d.productionEntry.date).toISOString().slice(0, 10),
        Agent: d.agent.name,
        Campaign: d.campaign.campaignName,
        Goal: d.agent.monthlyTarget ?? "",
        Transmittals: Number(d.transmittals),
        Activations: Number(d.activations),
        Approvals: Number(d.approvals),
        Booked: Number(d.booked),
        Volume: Number(d.volume),
        Transaction: Number(d.transaction),
      })),
    ];

    if (details.length === 0) {
      rows.push({
        Section: "Message",
        Campaign: campaignId ?? "",
        "Date Range": `${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`,
        MTD: "No production data found for the selected campaign and period.",
      } as any);
    }

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
