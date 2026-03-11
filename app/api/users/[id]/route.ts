import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        seatNumber: true,
        campaignId: true,
        monthlyTarget: true,
        campaign: {
          select: {
            id: true,
            campaignName: true,
          },
        },
        createdAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error("Get user error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { id } = params;

    const updateData: any = {};

    // Allow updating name, email, role, seatNumber, campaignId, monthlyTarget
    if (body.name) updateData.name = body.name;
    if (body.email) updateData.email = body.email;
    if (body.role) updateData.role = body.role;
    if (body.seatNumber !== undefined) updateData.seatNumber = body.seatNumber || null;
    if (body.campaignId !== undefined) updateData.campaignId = body.campaignId || null;
    if (body.monthlyTarget !== undefined) updateData.monthlyTarget = body.monthlyTarget || null;

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      include: {
        campaign: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    console.error("Users PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { getServerSession } = await import("next-auth/next");
    const { authOptions } = await import("@/lib/auth");
    
    const session = await getServerSession(authOptions);

    // Only allow CEO to delete users
    if (!session?.user || (session.user as any).role !== "CEO") {
      return NextResponse.json(
        { error: "Unauthorized: CEO access required" },
        { status: 403 }
      );
    }

    const { id } = params;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Prevent deleting yourself
    if (user.id === (session.user as any).id) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 400 }
      );
    }

    // Delete related data
    await prisma.dailySales.deleteMany({
      where: { userId: id },
    });

    await prisma.agentTarget.deleteMany({
      where: { userId: id },
    });

    await prisma.productionDetail.deleteMany({
      where: { agentId: id },
    });

    await prisma.productionEntry.deleteMany({
      where: { createdBy: id },
    });

    // Skip attendance delete if table doesn't exist
    try {
      await prisma.attendance.deleteMany({
        where: { agentId: id },
      });
    } catch (e) {
      // Table might not exist yet, skip
    }

    // Finally delete the user
    await prisma.user.delete({
      where: { id },
    });

    return NextResponse.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete user error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
