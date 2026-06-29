import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAssignedCampaignIds } from "@/lib/user-campaigns";

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

    // Resolve the collector's assigned campaigns (join table + legacy primary).
    const assignedIds = await getAssignedCampaignIds(user.id);
    if (assignedIds.length === 0) {
      return NextResponse.json({ campaigns: [] });
    }

    // Pull everything in a few batched queries scoped to the assigned set.
    const [campaigns, agents, details, entries] = await Promise.all([
      prisma.campaign.findMany({
        where: { id: { in: assignedIds } },
        select: {
          id: true,
          campaignName: true,
          kpiMetric: true,
          monthlyGoal: true,
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
        },
      }),
      prisma.productionEntry.findMany({
        where: { campaignId: { in: assignedIds }, date: { gte: startDate, lte: endDate } },
        select: { id: true, campaignId: true },
      }),
    ]);

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

    const prodByCampaign = new Map<
      string,
      Record<string, { transmittals: number; activations: number; approvals: number; booked: number; volume: number }>
    >();
    for (const d of details) {
      const byAgent = prodByCampaign.get(d.campaignId) ?? {};
      const cur =
        byAgent[d.agentId] ?? { transmittals: 0, activations: 0, approvals: 0, booked: 0, volume: 0 };
      cur.transmittals += Number(d.transmittals);
      cur.activations += Number(d.activations);
      cur.approvals += Number(d.approvals);
      cur.booked += Number(d.booked);
      cur.volume += Number(d.volume);
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

    const result = campaigns.map((c) => ({
      id: c.id,
      campaignName: c.campaignName,
      kpiMetric: c.kpiMetric || "booked",
      goal: c.monthlyGoal || 0,
      agents: (agentsByCampaign.get(c.id) ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        seatNumber: a.seatNumber,
        monthlyTarget: a.monthlyTarget,
      })),
      production: prodByCampaign.get(c.id) ?? {},
      attendance: attByCampaign.get(c.id) ?? {},
      entriesCount: entryCountByCampaign.get(c.id) ?? 0,
    }));

    return NextResponse.json({ campaigns: result });
  } catch (error: any) {
    console.error("Collector dashboard API error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load dashboard" },
      { status: 500 }
    );
  }
}
