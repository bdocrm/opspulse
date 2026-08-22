import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userCount = await prisma.user.count();

    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        password: true,
      },
    });
    const adminUser = await prisma.user.findUnique({
      where: { email: "admin@opsview.com" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        password: true,
      },
    });
    return NextResponse.json({
      status: "OK",
      database: {
        connected: true,
        totalUsers: userCount,
        users: allUsers,
        adminUser: adminUser,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Diagnostic error:", error);
    return NextResponse.json(
      {
        status: "ERROR",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
