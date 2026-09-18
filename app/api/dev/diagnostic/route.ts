import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  // Only allow in development environment
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "This endpoint is only available in development" },
      { status: 403 }
    );
  }

  // Require authentication and admin role
  const { getServerSession } = await import("next-auth/next");
  const { authOptions } = await import("@/lib/auth");
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "CEO") {
    return NextResponse.json(
      { error: "Unauthorized: CEO access required" },
      { status: 403 }
    );
  }

  try {
    const userCount = await prisma.user.count();

    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });
    const adminUser = await prisma.user.findUnique({
      where: { email: "admin@opsview.com" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
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
