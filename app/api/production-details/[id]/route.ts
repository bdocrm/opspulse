import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const detail = await prisma.productionDetail.findUnique({
      where: { id: params.id },
      include: {
        agent: {
          select: { id: true, name: true, seatNumber: true },
        },
        campaign: {
          select: { id: true, campaignName: true },
        },
        productionEntry: true,
      },
    });

    if (!detail) {
      return NextResponse.json(
        { error: "Production detail not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(detail);
  } catch (error) {
    console.error("Get production detail error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as any).role;

    // Only COLLECTOR or AGENT can update
    if (!["COLLECTOR", "AGENT"].includes(userRole)) {
      return NextResponse.json(
        { error: "Only collectors and agents can update production details" },
        { status: 403 }
      );
    }

    const body = await req.json();

    const updateData: any = {};
    if (body.transmittals !== undefined) updateData.transmittals = BigInt(body.transmittals);
    if (body.activations !== undefined) updateData.activations = BigInt(body.activations);
    if (body.approvals !== undefined) updateData.approvals = BigInt(body.approvals);
    if (body.booked !== undefined) updateData.booked = BigInt(body.booked);
    if (body.qualityRate !== undefined)
      updateData.qualityRate = body.qualityRate ? parseFloat(body.qualityRate) : null;
    if (body.conversionRate !== undefined)
      updateData.conversionRate = body.conversionRate ? parseFloat(body.conversionRate) : null;

    const updated = await prisma.productionDetail.update({
      where: { id: params.id },
      data: updateData,
      include: {
        agent: {
          select: { id: true, name: true, seatNumber: true },
        },
        campaign: {
          select: { id: true, campaignName: true },
        },
      },
    });

    return NextResponse.json({
      ...updated,
      transmittals: updated.transmittals.toString(),
      activations: updated.activations.toString(),
      approvals: updated.approvals.toString(),
      booked: updated.booked.toString(),
    });
  } catch (error) {
    console.error("Update production detail error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as any).role;

    // Only COLLECTOR can delete
    if (userRole !== "COLLECTOR") {
      return NextResponse.json(
        { error: "Only collectors can delete production details" },
        { status: 403 }
      );
    }

    await prisma.productionDetail.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ message: "Production detail deleted successfully" });
  } catch (error) {
    console.error("Delete production detail error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
