import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

/**
 * CLEANUP ENDPOINT - CEO ONLY
 * Deletes all user data except CEO accounts, and all associated data
 * Keeps campaigns intact for reassignment
 * 
 * Usage: POST /api/dev/cleanup-database
 */

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Only allow CEO
    if (!session?.user || (session.user as any).role !== "CEO") {
      return NextResponse.json(
        { error: "Unauthorized: CEO access required" },
        { status: 403 }
      );
    }

    // Get the confirmation code from request
    const body = await req.json();
    if (body.confirmCode !== "CLEANUP_CONFIRMED_2026") {
      return NextResponse.json(
        { error: "Invalid confirmation code. Include { confirmCode: 'CLEANUP_CONFIRMED_2026' }" },
        { status: 400 }
      );
    }

    // Get all non-CEO users
    const nonCeoUsers = await prisma.user.findMany({
      where: { role: { not: "CEO" } },
      select: { id: true, name: true, email: true, role: true },
    });

    // Delete all data associated with non-CEO users
    const deleteOperations = await Promise.all([
      // Delete daily sales
      prisma.dailySales.deleteMany({
        where: { userId: { in: nonCeoUsers.map((u) => u.id) } },
      }),
      // Delete production details
      prisma.productionDetail.deleteMany({
        where: { agentId: { in: nonCeoUsers.map((u) => u.id) } },
      }),
      // Delete production entries
      prisma.productionEntry.deleteMany({
        where: { createdBy: { in: nonCeoUsers.map((u) => u.id) } },
      }),
      // Delete agent targets
      prisma.agentTarget.deleteMany({
        where: { userId: { in: nonCeoUsers.map((u) => u.id) } },
      }),
    ]);

    // Try to delete attendance if table exists
    let attendanceCount = 0;
    try {
      const attendanceDelete = await prisma.attendance.deleteMany({
        where: { agentId: { in: nonCeoUsers.map((u) => u.id) } },
      });
      attendanceCount = attendanceDelete.count || 0;
    } catch (e) {
      // Table might not exist, skip
    }

    // Delete all non-CEO users
    await prisma.user.deleteMany({
      where: { role: { not: "CEO" } },
    });

    // Get CEO count for info
    const ceoCount = await prisma.user.count({
      where: { role: "CEO" },
    });

    // Get campaign count
    const campaignCount = await prisma.campaign.count();

    return NextResponse.json({
      message: "Database cleanup completed successfully",
      data: {
        deletedUsers: nonCeoUsers.length,
        userDetail: nonCeoUsers,
        deletedDailySalesRecords: deleteOperations[0].count || 0,
        deletedProductionDetails: deleteOperations[1].count || 0,
        deletedProductionEntries: deleteOperations[2].count || 0,
        deletedTargets: deleteOperations[3].count || 0,
        deletedAttendanceRecords: attendanceCount || 0,
        retainedCeos: ceoCount,
        retainedCampaigns: campaignCount,
      },
    });
  } catch (error) {
    console.error("Database cleanup error:", error);
    return NextResponse.json(
      {
        error: "Cleanup failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
