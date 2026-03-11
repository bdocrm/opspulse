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

    // Only COLLECTOR can access this - and only their campaign
    if (userRole === "COLLECTOR" && !userCampaignId) {
      return NextResponse.json(
        { error: "Collector must have a campaign assigned" },
        { status: 403 }
      );
    }

    if (userRole !== "COLLECTOR") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get only agents assigned to this collector's campaign
    const agents = await prisma.user.findMany({
      where: {
        role: "AGENT",
        campaignId: userCampaignId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        seatNumber: true,
        monthlyTarget: true,
        campaign: {
          select: {
            id: true,
            campaignName: true,
          },
        },
      },
      orderBy: { seatNumber: "asc" },
    });

    return NextResponse.json(agents);
  } catch (error) {
    console.error("Collector agents API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as any).role;
    const userCampaignId = (session.user as any).campaignId;

    // Only COLLECTOR can create agents - for their campaign
    if (userRole !== "COLLECTOR" || !userCampaignId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { name, email, seatNumber } = body;

    if (!name || !email) {
      return NextResponse.json(
        { error: "Name and email required" },
        { status: 400 }
      );
    }

    const passwordHash = await require("bcryptjs").hash("password123", 12);

    const agent = await prisma.user.create({
      data: {
        name,
        email,
        password: passwordHash,
        role: "AGENT",
        seatNumber: seatNumber || null,
        // Automatically assign to collector's campaign
        campaignId: userCampaignId,
      },
    });

    return NextResponse.json(agent, { status: 201 });
  } catch (error: any) {
    console.error("Create agent error:", error);
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
