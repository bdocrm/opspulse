import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getAssignedCampaignIds } from "@/lib/user-campaigns";

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date(value);
  return new Date(year, month - 1, day);
}

function dayRange(value: string) {
  const start = parseDateOnly(value);
  start.setHours(0, 0, 0, 0);
  const end = parseDateOnly(value);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function toYmd(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = session.user as any;

    // Only COLLECTOR can submit production entries
    if (user.role !== "COLLECTOR") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { date, entries, campaignId: requestedCampaignId } = await req.json();

    if (!date || !entries || !Array.isArray(entries)) {
      return NextResponse.json({ error: "Invalid data format" }, { status: 400 });
    }

    const assignedCampaignIds = await getAssignedCampaignIds(user.id);
    const campaignId = requestedCampaignId || user.campaignId || assignedCampaignIds[0];
    if (!campaignId) {
      return NextResponse.json({ error: "No campaign assigned" }, { status: 400 });
    }
    if (user.role !== "CEO" && !assignedCampaignIds.includes(campaignId)) {
      return NextResponse.json({ error: "You are not assigned to this campaign" }, { status: 403 });
    }

    // Save each time entry with its agent details
    const savedEntries = await Promise.all(
      entries.map(async (entry) => {
        const { time, details } = entry; // details = { agentId: value, ... }

        const detailEntries = Object.entries(details) as Array<[string, any]>;
        const agentIds = detailEntries.map(([agentId]) => agentId);
        const validAgents = await prisma.user.findMany({
          where: { id: { in: agentIds }, role: "AGENT", campaignId },
          select: { id: true },
        });
        const validAgentIds = new Set(validAgents.map((agent) => agent.id));

        const productionEntry = await prisma.productionEntry.create({
          data: {
            campaignId,
            date: parseDateOnly(date),
            time,
            createdBy: user.id,
            details: {
              create: detailEntries
                .filter(([agentId]) => validAgentIds.has(agentId))
                .map(([agentId, values]) => ({
                  agentId,
                  campaignId,
                  transmittals: values.transmittals || 0,
                  activations: values.activations || 0,
                  approvals: values.approvals || 0,
                  booked: values.booked || 0,
                  qualityRate: values.qualityRate,
                  conversionRate: values.conversionRate,
                  volume: values.volume || 0,
                  transaction: values.transaction || 0,
                })),
            },
          },
          include: { details: true },
        });

        return productionEntry;
      })
    );

    return NextResponse.json({
      success: true,
      entries: savedEntries.map(entry => ({
        ...entry,
        details: entry.details.map(detail => ({
          ...detail,
          transmittals: Number(detail.transmittals),
          activations: Number(detail.activations),
          approvals: Number(detail.approvals),
          booked: Number(detail.booked),
          volume: Number(detail.volume),
          transaction: Number(detail.transaction),
        })),
      })),
      message: `${savedEntries.length} time entries saved successfully!`,
    });
  } catch (error: any) {
    console.error("Error saving production entries:", error);
    return NextResponse.json(
      { error: error.message || "Failed to save entries" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = session.user as any;

    // Get entries for this collector's campaign
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const requestedCampaignId = searchParams.get("campaignId");

    let startDate: Date;
    let endDate: Date;

    if (dateFrom && dateTo) {
      // Date range filter
      const startRange = dayRange(dateFrom);
      const endRange = dayRange(dateTo);
      startDate = startRange.start;
      endDate = endRange.end;
    } else if (date) {
      // Single date filter (backward compatibility)
      const range = dayRange(date);
      startDate = range.start;
      endDate = range.end;
    } else {
      return NextResponse.json({ error: "Date or date range required" }, { status: 400 });
    }

    const assignedCampaignIds = await getAssignedCampaignIds(user.id);
    const campaignIds = requestedCampaignId
      ? [requestedCampaignId]
      : user.campaignId
        ? [user.campaignId]
        : assignedCampaignIds;

    if (campaignIds.length === 0) {
      return NextResponse.json({
        entries: [],
        message: "No assigned campaign found for this collector.",
      });
    }

    if (user.role !== "CEO") {
      const unauthorized = campaignIds.find((campaignId) => !assignedCampaignIds.includes(campaignId));
      if (unauthorized) {
        return NextResponse.json({ error: "You are not assigned to this campaign" }, { status: 403 });
      }
    }

    const where = {
      campaignId: { in: campaignIds },
      date: {
        gte: startDate,
        lte: endDate,
      },
    };

    const [entries, availableEntryDates] = await Promise.all([
      prisma.productionEntry.findMany({
        where,
        include: { details: true },
        orderBy: [{ date: "asc" }, { time: "asc" }],
      }),
      prisma.productionEntry.findMany({
        where: {
          campaignId: { in: campaignIds },
          details: { some: {} },
        },
        select: { date: true },
        distinct: ["date"],
        orderBy: { date: "desc" },
        take: 24,
      }),
    ]);

    const availableDates = availableEntryDates.map((entry) => toYmd(entry.date));
    const latestDate = availableDates[0] ?? null;

    // Convert BigInt fields to numbers for JSON serialization
    const serializedEntries = entries.map(entry => ({
      ...entry,
      details: entry.details.map(detail => ({
        ...detail,
        transmittals: Number(detail.transmittals),
        activations: Number(detail.activations),
        approvals: Number(detail.approvals),
        booked: Number(detail.booked),
        volume: Number(detail.volume),
        transaction: Number(detail.transaction),
      })),
    }));

    return NextResponse.json({ entries: serializedEntries, availableDates, latestDate });
  } catch (error) {
    console.error("Error fetching entries:", error);
    return NextResponse.json(
      { error: "Failed to fetch entries" },
      { status: 500 }
    );
  }
}
