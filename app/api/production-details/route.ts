import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get("agentId");
    const campaignId = searchParams.get("campaignId");
    const date = searchParams.get("date");

    const where: any = {};
    if (agentId) where.agentId = agentId;
    if (campaignId) where.campaignId = campaignId;
    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
      where.createdAt = { gte: startDate, lt: endDate };
    }

    const details = await prisma.productionDetail.findMany({
      where,
      include: {
        agent: {
          select: { id: true, name: true, seatNumber: true },
        },
        campaign: {
          select: { id: true, campaignName: true },
        },
        productionEntry: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(details);
  } catch (error) {
    console.error("Production details GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as any).role;

    // Only COLLECTOR or AGENT can submit production details
    if (!["COLLECTOR", "AGENT"].includes(userRole)) {
      return NextResponse.json(
        { error: "Only collectors and agents can submit production details" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const {
      productionEntryId,
      agentId,
      campaignId,
      transmittals,
      activations,
      approvals,
      booked,
      qualityRate,
      conversionRate,
    } = body;

    // Validate required fields
    if (!productionEntryId || !agentId || !campaignId) {
      return NextResponse.json(
        { error: "productionEntryId, agentId, and campaignId are required" },
        { status: 400 }
      );
    }

    // Verify campaign exists
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 }
      );
    }

    // Verify agent exists and belongs to campaign
    const agent = await prisma.user.findUnique({
      where: { id: agentId },
    });

    if (!agent || agent.role !== "AGENT") {
      return NextResponse.json(
        { error: "Agent not found or user is not an AGENT" },
        { status: 404 }
      );
    }

    // If agent belongs to a campaign, verify it matches
    if (agent.campaignId && agent.campaignId !== campaignId) {
      return NextResponse.json(
        { error: "Agent is not assigned to this campaign" },
        { status: 400 }
      );
    }

    // Create production detail
    const detail = await prisma.productionDetail.create({
      data: {
        productionEntryId,
        agentId,
        campaignId,
        transmittals: BigInt(transmittals || 0),
        activations: BigInt(activations || 0),
        approvals: BigInt(approvals || 0),
        booked: BigInt(booked || 0),
        qualityRate: qualityRate ? parseFloat(qualityRate) : null,
        conversionRate: conversionRate ? parseFloat(conversionRate) : null,
      },
      include: {
        agent: {
          select: { id: true, name: true, seatNumber: true },
        },
        campaign: {
          select: { id: true, campaignName: true },
        },
      },
    });

    // Convert BigInt to string for JSON response
    return NextResponse.json(
      {
        ...detail,
        transmittals: detail.transmittals.toString(),
        activations: detail.activations.toString(),
        approvals: detail.approvals.toString(),
        booked: detail.booked.toString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Production details POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
