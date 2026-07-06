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
    const { target, targetSupplementary, startDate, mbLevel, disbursedTxnTarget, disbursedVolTarget, grossTurnInsTxnTarget, grossTurnInsVolTarget } = await req.json();

    // MB PL uses a level + 4-part goal instead of a single numeric target.
    const hasMbPl =
      mbLevel !== undefined || disbursedTxnTarget !== undefined || disbursedVolTarget !== undefined ||
      grossTurnInsTxnTarget !== undefined || grossTurnInsVolTarget !== undefined;

    if (!hasMbPl && (!target || target <= 0)) {
      return NextResponse.json({ error: "Invalid target" }, { status: 400 });
    }
    const suppTarget =
      targetSupplementary !== undefined && targetSupplementary !== null
        ? Number(targetSupplementary) || 0
        : undefined;
    const num = (v: any) => (v !== undefined && v !== null ? Number(v) || 0 : undefined);

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

    // Track numeric target history only when a single target value is provided.
    let newTarget = null;
    if (target && target > 0) {
      await prisma.agentTarget.updateMany({
        where: { userId, endDate: null },
        data: { endDate: new Date(startDate || new Date()) },
      });
      newTarget = await prisma.agentTarget.create({
        data: { userId, target, startDate: new Date(startDate || new Date()) },
      });
    }

    // Update user's current targets (monthly + ACQ supplementary + MB PL goals).
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(target && target > 0 && { monthlyTarget: target }),
        ...(suppTarget !== undefined && { monthlyTargetSupplementary: suppTarget }),
        ...(mbLevel !== undefined && { mbLevel: mbLevel || null }),
        ...(num(disbursedTxnTarget) !== undefined && { disbursedTxnTarget: num(disbursedTxnTarget) }),
        ...(num(disbursedVolTarget) !== undefined && { disbursedVolTarget: num(disbursedVolTarget) }),
        ...(num(grossTurnInsTxnTarget) !== undefined && { grossTurnInsTxnTarget: num(grossTurnInsTxnTarget) }),
        ...(num(grossTurnInsVolTarget) !== undefined && { grossTurnInsVolTarget: num(grossTurnInsVolTarget) }),
      },
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
