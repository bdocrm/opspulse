import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Papa from "papaparse";

const BUSINESS_TIME_ZONE = "Asia/Manila";
const BUSINESS_TIME_ZONE_OFFSET = "+08:00";

function monthRange(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();

  return {
    start: new Date(`${year}-${mm}-01T00:00:00.000${BUSINESS_TIME_ZONE_OFFSET}`),
    end: new Date(`${year}-${mm}-${String(lastDay).padStart(2, "0")}T23:59:59.999${BUSINESS_TIME_ZONE_OFFSET}`),
  };
}

function toBusinessYmd(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const yyyy = parts.find((part) => part.type === "year")?.value ?? "0000";
  const mm = parts.find((part) => part.type === "month")?.value ?? "01";
  const dd = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${yyyy}-${mm}-${dd}`;
}

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));
    const campaignId = searchParams.get("campaignId");
    const agentId = searchParams.get("id");
    const { start: startDate, end: endDate } = monthRange(year, month);

    const details = await prisma.productionDetail.findMany({
      where: {
        ...(campaignId ? { campaignId } : {}),
        ...(agentId ? { agentId } : {}),
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
        agentId: true,
        campaignId: true,
        transmittals: true,
        activations: true,
        approvals: true,
        booked: true,
        volume: true,
        transaction: true,
        agent: { select: { name: true, seatNumber: true, monthlyTarget: true } },
        campaign: { select: { campaignName: true } },
        productionEntry: { select: { date: true, periodEnd: true } },
      },
    });

    const agentMap = new Map<string, {
      name: string;
      seat: number | null;
      target: number | null;
      campaigns: Set<string>;
      workedDates: Set<string>;
      transmittals: number;
      activations: number;
      approvals: number;
      booked: number;
      volume: number;
      transaction: number;
    }>();

    details.forEach((detail) => {
      const current = agentMap.get(detail.agentId) ?? {
        name: detail.agent.name,
        seat: detail.agent.seatNumber,
        target: detail.agent.monthlyTarget,
        campaigns: new Set<string>(),
        workedDates: new Set<string>(),
        transmittals: 0,
        activations: 0,
        approvals: 0,
        booked: 0,
        volume: 0,
        transaction: 0,
      };

      current.campaigns.add(detail.campaign.campaignName);
      current.workedDates.add(toBusinessYmd(detail.productionEntry.periodEnd ?? detail.productionEntry.date));
      current.transmittals += Number(detail.transmittals || 0);
      current.activations += Number(detail.activations || 0);
      current.approvals += Number(detail.approvals || 0);
      current.booked += Number(detail.booked || 0);
      current.volume += Number(detail.volume || 0);
      current.transaction += Number(detail.transaction || 0);
      agentMap.set(detail.agentId, current);
    });

    const rows = Array.from(agentMap.values())
      .map((agent) => ({
        Agent: agent.name,
        Seat: agent.seat ?? "",
        "Days Worked": agent.workedDates.size,
        "Monthly Target": agent.target ?? "",
        Transmittals: agent.transmittals,
        Activations: agent.activations,
        Approvals: agent.approvals,
        Booked: agent.booked,
        Volume: agent.volume,
        Transaction: agent.transaction,
        "Avg Quality %": percent(agent.approvals, agent.transmittals).toFixed(1),
        "Avg Conversion %": percent(agent.booked, agent.transmittals).toFixed(1),
        Campaigns: Array.from(agent.campaigns).join(", "),
      }))
      .sort((a, b) =>
        b.Booked - a.Booked
        || b.Approvals - a.Approvals
        || b.Transmittals - a.Transmittals
        || b.Volume - a.Volume
        || a.Agent.localeCompare(b.Agent)
      )
      .map((row, index) => ({ Rank: index + 1, ...row }));

    const csv = Papa.unparse(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="agents_export.csv"',
      },
    });
  } catch (error) {
    console.error("Export agents error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
