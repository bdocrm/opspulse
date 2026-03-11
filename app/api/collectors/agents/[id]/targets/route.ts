import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = params.id;
    const user = (session.user as any);

    // Verify user is COLLECTOR for this agent's campaign
    const agent = await prisma.user.findUnique({
      where: { id: userId },
      include: { campaign: true },
    });

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    if (user.role === "COLLECTOR" && agent.campaignId !== user.campaignId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get current target and historical targets
    const targets = await prisma.agentTarget.findMany({
      where: { userId },
      orderBy: { startDate: "desc" },
    });

    const currentTarget = targets.find((t) => t.endDate === null);
    const previousTargets = targets.filter((t) => t.endDate !== null);

    return NextResponse.json({
      currentTarget,
      previousTargets,
      allTargets: targets,
    });
  } catch (error) {
    console.error("Error fetching targets:", error);
    return NextResponse.json(
      { error: "Failed to fetch targets" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = (session.user as any);

    // Only COLLECTOR or CEO can set targets
    if (user.role !== "COLLECTOR" && user.role !== "CEO") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const userId = params.id;
    const { target, startDate } = await req.json();

    if (!target || target <= 0) {
      return NextResponse.json({ error: "Invalid target" }, { status: 400 });
    }

    const agent = await prisma.user.findUnique({
      where: { id: userId },
      include: { campaign: true },
    });

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Verify COLLECTOR is for the right campaign
    if (user.role === "COLLECTOR" && agent.campaignId !== user.campaignId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // End the previous target
    await prisma.agentTarget.updateMany({
      where: { userId, endDate: null },
      data: { endDate: new Date(startDate || new Date()) },
    });

    // Create new target
    const newTarget = await prisma.agentTarget.create({
      data: {
        userId,
        target,
        startDate: new Date(startDate || new Date()),
      },
    });

    // Update user's current monthlyTarget
    await prisma.user.update({
      where: { id: userId },
      data: { monthlyTarget: target },
    });

    return NextResponse.json({
      success: true,
      target: newTarget,
    });
  } catch (error) {
    console.error("Error setting target:", error);
    return NextResponse.json(
      { error: "Failed to set target" },
      { status: 500 }
    );
  }
}
