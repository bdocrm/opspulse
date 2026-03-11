import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

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

    const { date, entries } = await req.json();

    if (!date || !entries || !Array.isArray(entries)) {
      return NextResponse.json({ error: "Invalid data format" }, { status: 400 });
    }

    const campaignId = user.campaignId;
    if (!campaignId) {
      return NextResponse.json({ error: "No campaign assigned" }, { status: 400 });
    }

    // Save each time entry with its agent details
    const savedEntries = await Promise.all(
      entries.map(async (entry) => {
        const { time, details } = entry; // details = { agentId: value, ... }

        const productionEntry = await prisma.productionEntry.create({
          data: {
            campaignId,
            date: new Date(date),
            time,
            createdBy: user.id,
            details: {
              create: Object.entries(details).map(([agentId, values]: any) => ({
                agentId,
                campaignId,
                transmittals: values.transmittals || 0,
                activations: values.activations || 0,
                approvals: values.approvals || 0,
                booked: values.booked || 0,
                qualityRate: values.qualityRate,
                conversionRate: values.conversionRate,
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

    let startDate: Date;
    let endDate: Date;

    if (dateFrom && dateTo) {
      // Date range filter
      startDate = new Date(dateFrom);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
    } else if (date) {
      // Single date filter (backward compatibility)
      startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
    } else {
      return NextResponse.json({ error: "Date or date range required" }, { status: 400 });
    }

    const entries = await prisma.productionEntry.findMany({
      where: {
        campaignId: user.campaignId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: { details: true },
      orderBy: [{ date: "asc" }, { time: "asc" }],
    });

    // Convert BigInt fields to numbers for JSON serialization
    const serializedEntries = entries.map(entry => ({
      ...entry,
      details: entry.details.map(detail => ({
        ...detail,
        transmittals: Number(detail.transmittals),
        activations: Number(detail.activations),
        approvals: Number(detail.approvals),
        booked: Number(detail.booked),
      })),
    }));

    return NextResponse.json({ entries: serializedEntries });
  } catch (error) {
    console.error("Error fetching entries:", error);
    return NextResponse.json(
      { error: "Failed to fetch entries" },
      { status: 500 }
    );
  }
}
