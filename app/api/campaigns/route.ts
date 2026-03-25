import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(campaigns);
  } catch (error) {
    const err = error as any;
    console.error("Campaigns API error:", {
      message: err?.message,
      code: err?.code,
      stack: err?.stack,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { 
        error: "Internal server error",
        details: process.env.NODE_ENV === "development" ? err?.message : undefined,
      }, 
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const campaign = await prisma.campaign.create({
      data: {
        campaignName: body.campaignName,
        goalType: body.goalType,
        monthlyGoal: body.monthlyGoal,
        kpiMetric: body.kpiMetric,
      },
    });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    const err = error as any;
    console.error("Create campaign error:", {
      message: err?.message,
      code: err?.code,
      stack: err?.stack,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
