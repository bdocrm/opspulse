import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sale = await prisma.dailySales.create({
      data: {
        userId: body.userId,
        campaignId: body.campaignId,
        date: new Date(body.date),
        transmittals: body.transmittals ?? 0,
        activations: body.activations ?? 0,
        approvals: body.approvals ?? 0,
        booked: body.booked ?? 0,
        qualityRate: body.qualityRate ?? null,
        conversionRate: body.conversionRate ?? null,
      },
    });
    return NextResponse.json({ sale }, { status: 201 });
  } catch (error) {
    console.error("Create sale error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
