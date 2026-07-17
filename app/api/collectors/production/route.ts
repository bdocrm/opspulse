import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getAssignedCampaignIds } from "@/lib/user-campaigns";

const BUSINESS_TIME_ZONE = "Asia/Manila";
const BUSINESS_TIME_ZONE_OFFSET = "+08:00";

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date(value);
  return new Date(`${value}T00:00:00.000${BUSINESS_TIME_ZONE_OFFSET}`);
}

function dayRange(value: string) {
  return {
    start: new Date(`${value}T00:00:00.000${BUSINESS_TIME_ZONE_OFFSET}`),
    end: new Date(`${value}T23:59:59.999${BUSINESS_TIME_ZONE_OFFSET}`),
  };
}

function monthRange(from: string, to: string) {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const lastDay = new Date(Date.UTC(toYear, toMonth, 0)).getUTCDate();
  return {
    start: new Date(
      `${fromYear}-${String(fromMonth).padStart(2, "0")}-01T00:00:00.000${BUSINESS_TIME_ZONE_OFFSET}`
    ),
    end: new Date(
      `${toYear}-${String(toMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}T23:59:59.999${BUSINESS_TIME_ZONE_OFFSET}`
    ),
  };
}

function toYmd(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}

function monthKey(value: Date) {
  return toYmd(value).slice(0, 7);
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
    let requestedFrom: string;
    let requestedTo: string;

    if (dateFrom && dateTo) {
      // Date range filter
      const startRange = dayRange(dateFrom);
      const endRange = dayRange(dateTo);
      startDate = startRange.start;
      endDate = endRange.end;
      requestedFrom = dateFrom;
      requestedTo = dateTo;
    } else if (date) {
      // Single date filter (backward compatibility)
      const range = dayRange(date);
      startDate = range.start;
      endDate = range.end;
      requestedFrom = date;
      requestedTo = date;
    } else {
      return NextResponse.json({ error: "Date or date range required" }, { status: 400 });
    }
    const importedMonthRange = monthRange(requestedFrom, requestedTo);

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
      OR: [
        { date: { gte: startDate, lte: endDate } },
        {
          importFileName: { not: null },
          reportPeriodType: "monthly",
          date: { gte: importedMonthRange.start, lte: importedMonthRange.end },
        },
      ],
    };

    const [rawEntries, availableEntryDates, latestDashboardImport] = await Promise.all([
      prisma.productionEntry.findMany({
        where: {
          ...where,
          details: { some: {} },
        },
        select: {
          id: true,
          campaignId: true,
          date: true,
          time: true,
          createdAt: true,
          importFileName: true,
          reportPeriodType: true,
          details: {
            select: {
              id: true,
              agentId: true,
              transmittals: true,
              activations: true,
              approvals: true,
              booked: true,
              volume: true,
              transaction: true,
              qualityRate: true,
              conversionRate: true,
            },
          },
        },
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
      prisma.dashboardImportRecord.findFirst({
        where: {
          campaignId: { in: campaignIds },
          month: { not: null },
          recordKind: { in: ["agent_monitoring", "ytd"] },
          OR: [{ actual: { not: null } }, { target: { not: null } }],
        },
        select: { year: true, month: true },
        orderBy: [{ year: "desc" }, { month: "desc" }],
      }).catch(() => null),
    ]);

    const monthlyImportKeys = new Set(
      rawEntries
        .filter((entry) => entry.importFileName && entry.reportPeriodType === "monthly")
        .map((entry) => `${entry.campaignId}|${monthKey(entry.date)}`)
    );
    const entries = rawEntries.filter((entry) => {
      const isMonthlyImport = Boolean(entry.importFileName) && entry.reportPeriodType === "monthly";
      const key = `${entry.campaignId}|${monthKey(entry.date)}`;
      return isMonthlyImport || !monthlyImportKeys.has(key);
    });

    const dashboardLatestDate = latestDashboardImport?.month
      ? `${latestDashboardImport.year}-${String(latestDashboardImport.month).padStart(2, "0")}-01`
      : null;
    const availableDates = [
      ...new Set([
        ...availableEntryDates.map((entry) => toYmd(entry.date)),
        ...(dashboardLatestDate ? [dashboardLatestDate] : []),
      ]),
    ].sort((a, b) => b.localeCompare(a));
    const latestDate = availableDates[0] ?? null;

    const agentTotals: Record<
      string,
      {
        agentId: string;
        transmittals: number;
        activations: number;
        approvals: number;
        booked: number;
        volume: number;
        transaction: number;
      }
    > = {};
    const summaryTotals = {
      transmittals: 0,
      activations: 0,
      approvals: 0,
      booked: 0,
      volume: 0,
      transaction: 0,
    };

    // Convert BigInt fields to numbers for JSON serialization and build a single
    // per-agent index so the UI can populate cards without extra queries.
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
      })).map((detail) => {
        const current = agentTotals[detail.agentId] ?? {
          agentId: detail.agentId,
          transmittals: 0,
          activations: 0,
          approvals: 0,
          booked: 0,
          volume: 0,
          transaction: 0,
        };

        current.transmittals += detail.transmittals;
        current.activations += detail.activations;
        current.approvals += detail.approvals;
        current.booked += detail.booked;
        current.volume += detail.volume;
        current.transaction += detail.transaction;
        agentTotals[detail.agentId] = current;

        summaryTotals.transmittals += detail.transmittals;
        summaryTotals.activations += detail.activations;
        summaryTotals.approvals += detail.approvals;
        summaryTotals.booked += detail.booked;
        summaryTotals.volume += detail.volume;
        summaryTotals.transaction += detail.transaction;

        return detail;
      }),
    }));

    return NextResponse.json({
      entries: serializedEntries,
      agentTotals,
      summaryTotals,
      detailCount: serializedEntries.reduce((sum, entry) => sum + entry.details.length, 0),
      availableDates,
      latestDate,
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error) {
    console.error("Error fetching entries:", error);
    return NextResponse.json(
      { error: "Failed to fetch entries" },
      { status: 500 }
    );
  }
}
