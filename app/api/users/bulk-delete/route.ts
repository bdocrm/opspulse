import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Only allow CEO to delete users
    if (!session?.user || (session.user as any).role !== "CEO") {
      return NextResponse.json(
        { error: "Unauthorized: CEO access required" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { userIds } = body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json(
        { error: "No users selected for deletion" },
        { status: 400 }
      );
    }

    // Prevent deleting yourself
    const currentUserId = (session.user as any).id;
    if (userIds.includes(currentUserId)) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 400 }
      );
    }

    // Get user details before deletion (for response)
    const usersToDelete = await prisma.user.findMany({
      where: { id: { in: userIds } },
    });

    // Delete related data for all users
    await prisma.dailySales.deleteMany({
      where: { userId: { in: userIds } },
    });

    await prisma.agentTarget.deleteMany({
      where: { userId: { in: userIds } },
    });

    await prisma.productionDetail.deleteMany({
      where: { agentId: { in: userIds } },
    });

    await prisma.productionEntry.deleteMany({
      where: { createdBy: { in: userIds } },
    });

    // Try to delete attendance if table exists
    try {
      await prisma.attendance.deleteMany({
        where: { agentId: { in: userIds } },
      });
    } catch (e) {
      // Table might not exist, skip
    }

    // Finally delete the users
    const result = await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });

    return NextResponse.json({
      message: "Users deleted successfully",
      data: {
        deletedCount: result.count,
        deletedUsers: usersToDelete.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
        })),
      },
    });
  } catch (error) {
    console.error("Bulk delete users error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
