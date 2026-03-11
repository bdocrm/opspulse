import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as any).role;
    const userCampaignId = (session.user as any).campaignId;

    // Only COLLECTOR can access - only their campaign data
    if (userRole !== "COLLECTOR" || !userCampaignId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get data entries for this collector's campaign
    const entries = await prisma.productionEntry.findMany({
      where: {
        campaignId: userCampaignId,
      },
      include: {
        details: true,
      },
      orderBy: { date: "desc" },
      take: 50,
    });

    return NextResponse.json(entries);
  } catch (error) {
    console.error("Collector data entries API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const userRole = (session.user as any).role;
    const userCampaignId = (session.user as any).campaignId;

    // Only COLLECTOR can create entries - for their campaign
    if (userRole !== "COLLECTOR" || !userCampaignId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { date, time, details } = body;

    if (!date || !time || !details || !Array.isArray(details)) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Verify all agents in details belong to this collector's campaign
    const agentIds = details.map((d: any) => d.agentId);
    const agents = await prisma.user.findMany({
      where: {
        id: { in: agentIds },
        campaignId: userCampaignId,
      },
    });

    if (agents.length !== agentIds.length) {
      return NextResponse.json(
        { error: "Some agents do not belong to your campaign" },
        { status: 403 }
      );
    }

    // Create production entry for this collector's campaign
    const entry = await prisma.productionEntry.create({
      data: {
        campaignId: userCampaignId,
        date: new Date(date),
        time,
        createdBy: userId,
        details: {
          create: details.map((d: any) => ({
            agentId: d.agentId,
            campaignId: userCampaignId,
            transmittals: BigInt(d.transmittals || 0),
            activations: BigInt(d.activations || 0),
            approvals: BigInt(d.approvals || 0),
            booked: BigInt(d.booked || 0),
            qualityRate: d.qualityRate || null,
            conversionRate: d.conversionRate || null,
          })),
        },
      },
      include: {
        details: true,
      },
    });

    // Convert BigInt to Number for JSON response
    const response = {
      ...entry,
      details: entry.details.map((d) => ({
        ...d,
        transmittals: Number(d.transmittals),
        activations: Number(d.activations),
        approvals: Number(d.approvals),
        booked: Number(d.booked),
      })),
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Create data entry error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
