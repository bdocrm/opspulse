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

    // Guard against duplicate campaign names. Names are used by collectors and
    // admins to identify "the same" campaign; allowing duplicates lets agents be
    // split across two campaign ids with the same name, which is exactly what
    // makes the Collector Dashboard and Goals Management lists diverge.
    const name = String(body.campaignName ?? '').trim();
    if (!name) {
      return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
    }
    const existing = await prisma.campaign.findFirst({
      where: { campaignName: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: `A campaign named "${name}" already exists.` },
        { status: 409 }
      );
    }

    const campaign = await prisma.campaign.create({
      data: {
        campaignName: name,
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
