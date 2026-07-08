import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAssignedCampaignIds } from "@/lib/user-campaigns";
import { ensureCampaignGoalTable } from "@/lib/campaign-goals";

function monthYearFromYmd(value: string) {
  const [yearRaw, monthRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);

  if (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12
  ) {
    return { month, year };
  }

  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

/**
 * Aggregate Collector Dashboard data, grouped by the logged-in collector's
 * assigned campaigns.
 *
 * Returns one block per assigned campaign (alphabetical) with its agents,
 * per-agent production for the date range, and attendance for `attendanceDate`.
 * Doing it in a handful of `in: [...]` queries (instead of one round-trip per
 * campaign) avoids N+1 and keeps the dashboard fast even with many campaigns.
 *
 * Only campaigns the collector is actually assigned to are returned, so the UI
 * can render the full response without further filtering.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = session.user as any;

    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const attendanceDate = searchParams.get("attendanceDate") || dateTo;

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: "Date range required" }, { status: 400 });
    }

    const startDate = new Date(dateFrom);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(dateTo);
    endDate.setHours(23, 59, 59, 999);
    const { month: goalMonth, year: goalYear } = monthYearFromYmd(dateTo);

    // Resolve the collector's assigned campaigns (join table + legacy primary).
    const assignedIds = await getAssignedCampaignIds(user.id);
    if (assignedIds.length === 0) {
      return NextResponse.json({ campaigns: [] });
    }

    await ensureCampaignGoalTable();

    // Pull everything in a few batched queries scoped to the assigned set.
    const [campaigns, agents, details, entries, monthlyGoalRows] = await Promise.all([
      prisma.campaign.findMany({
        where: { id: { in: assignedIds } },
        select: {
          id: true,
          campaignName: true,
          kpiMetric: true,
          monthlyGoal: true,
          supplementaryGoal: true,
        },
        orderBy: { campaignName: "asc" }, // alphabetical grouping
      }),
      prisma.user.findMany({
        where: { campaignId: { in: assignedIds }, role: "AGENT" },
        select: {
          id: true,
          name: true,
          email: true,
          seatNumber: true,
          monthlyTarget: true,
          monthlyTargetSupplementary: true,
          mbLevel: true,
          disbursedTxnTarget: true,
          disbursedVolTarget: true,
          grossTurnInsTxnTarget: true,
          grossTurnInsVolTarget: true,
          campaignId: true,
        },
        orderBy: [{ seatNumber: "asc" }, { name: "asc" }],
      }),
      prisma.productionDetail.findMany({
        where: {
          campaignId: { in: assignedIds },
          productionEntry: { date: { gte: startDate, lte: endDate } },
        },
        select: {
          agentId: true,
          campaignId: true,
          transmittals: true,
          activations: true,
          approvals: true,
          booked: true,
          volume: true,
          ntb: true,
          supplementary: true,
          bauPayrollTxn: true,
          bauPayrollVol: true,
          bauDepositorTxn: true,
          bauDepositorVol: true,
          topupPayrollTxn: true,
          topupPayrollVol: true,
          topupDepositorTxn: true,
          topupDepositorVol: true,
          openMarketTxn: true,
          openMarketVol: true,
          c2gTxn: true,
          c2gVol: true,
          btTxn: true,
          btVol: true,
          balconTxn: true,
          balconVol: true,
          grandTotalTxn: true,
          grandTotalVol: true,
        },
      }),
      prisma.productionEntry.findMany({
        where: { campaignId: { in: assignedIds }, date: { gte: startDate, lte: endDate } },
        select: { id: true, campaignId: true },
      }),
      prisma.$queryRaw<any[]>`
        SELECT "campaignId", "monthlyGoal", "supplementaryGoal", "kpiMetric"
        FROM "CampaignGoal"
        WHERE "campaignId" = ANY(${assignedIds}::text[])
          AND "month" = ${goalMonth}
          AND "year" = ${goalYear}
          AND "deletedAt" IS NULL
      `,
    ]);
    const monthlyGoalsByCampaignId = new Map(
      monthlyGoalRows.map((row) => [row.campaignId, row])
    );

    // Attendance is optional (table may not exist on older DBs).
    let attendanceRows: any[] = [];
    if (attendanceDate) {
      const attStart = new Date(attendanceDate);
      attStart.setHours(0, 0, 0, 0);
      const attEnd = new Date(attendanceDate);
      attEnd.setHours(23, 59, 59, 999);
      try {
        attendanceRows = await prisma.attendance.findMany({
          where: {
            campaignId: { in: assignedIds },
            date: { gte: attStart, lte: attEnd },
          },
          select: { agentId: true, campaignId: true, status: true, remarks: true },
        });
      } catch {
        attendanceRows = [];
      }
    }

    // ── Index everything by campaign id (single pass each) ──────────────────
    const agentsByCampaign = new Map<string, typeof agents>();
    for (const a of agents) {
      const list = agentsByCampaign.get(a.campaignId!) ?? [];
      list.push(a);
      agentsByCampaign.set(a.campaignId!, list);
    }

    // Per-category MB PL fields aggregated alongside the standard metrics.
    const CATEGORY_KEYS = [
      'bauPayrollTxn', 'bauPayrollVol', 'bauDepositorTxn', 'bauDepositorVol',
      'topupPayrollTxn', 'topupPayrollVol', 'topupDepositorTxn', 'topupDepositorVol',
      'openMarketTxn', 'openMarketVol',
      'c2gTxn', 'c2gVol', 'btTxn', 'btVol', 'balconTxn', 'balconVol', 'grandTotalTxn', 'grandTotalVol',
    ] as const;

    const prodByCampaign = new Map<string, Record<string, Record<string, number>>>();
    for (const d of details) {
      const byAgent = prodByCampaign.get(d.campaignId) ?? {};
      const cur =
        byAgent[d.agentId] ?? {
          transmittals: 0, activations: 0, approvals: 0, booked: 0, volume: 0, ntb: 0, supplementary: 0,
          bauPayrollTxn: 0, bauPayrollVol: 0, bauDepositorTxn: 0, bauDepositorVol: 0,
          topupPayrollTxn: 0, topupPayrollVol: 0, topupDepositorTxn: 0, topupDepositorVol: 0,
          openMarketTxn: 0, openMarketVol: 0,
          c2gTxn: 0, c2gVol: 0, btTxn: 0, btVol: 0, balconTxn: 0, balconVol: 0, grandTotalTxn: 0, grandTotalVol: 0,
        };
      cur.transmittals += Number(d.transmittals);
      cur.activations += Number(d.activations);
      cur.approvals += Number(d.approvals);
      cur.booked += Number(d.booked);
      cur.volume += Number(d.volume);
      cur.ntb += Number(d.ntb);
      cur.supplementary += Number(d.supplementary);
      for (const k of CATEGORY_KEYS) cur[k] += Number((d as any)[k] ?? 0);
      byAgent[d.agentId] = cur;
      prodByCampaign.set(d.campaignId, byAgent);
    }

    const attByCampaign = new Map<
      string,
      Record<string, { status: string; remarks: string | null }>
    >();
    for (const r of attendanceRows) {
      const byAgent = attByCampaign.get(r.campaignId) ?? {};
      byAgent[r.agentId] = { status: r.status, remarks: r.remarks };
      attByCampaign.set(r.campaignId, byAgent);
    }

    const entryCountByCampaign = new Map<string, number>();
    for (const e of entries) {
      entryCountByCampaign.set(e.campaignId, (entryCountByCampaign.get(e.campaignId) ?? 0) + 1);
    }

    const result = campaigns.map((c) => {
      const savedGoal = monthlyGoalsByCampaignId.get(c.id);

      return {
        id: c.id,
        campaignName: c.campaignName,
        kpiMetric: savedGoal?.kpiMetric || c.kpiMetric || "booked",
        goal: Number(savedGoal?.monthlyGoal ?? c.monthlyGoal ?? 0),
        supplementaryGoal: Number(savedGoal?.supplementaryGoal ?? c.supplementaryGoal ?? 0),
        agents: (agentsByCampaign.get(c.id) ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          email: a.email,
          seatNumber: a.seatNumber,
          monthlyTarget: a.monthlyTarget,
          monthlyTargetSupplementary: a.monthlyTargetSupplementary,
          mbLevel: a.mbLevel,
          disbursedTxnTarget: a.disbursedTxnTarget,
          disbursedVolTarget: a.disbursedVolTarget,
          grossTurnInsTxnTarget: a.grossTurnInsTxnTarget,
          grossTurnInsVolTarget: a.grossTurnInsVolTarget,
        })),
        production: prodByCampaign.get(c.id) ?? {},
        attendance: attByCampaign.get(c.id) ?? {},
        entriesCount: entryCountByCampaign.get(c.id) ?? 0,
      };
    });

    return NextResponse.json({ campaigns: result });
  } catch (error: any) {
    console.error("Collector dashboard API error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load dashboard" },
      { status: 500 }
    );
  }
}
