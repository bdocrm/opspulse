import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  // Only allow in development environment
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "This endpoint is only available in development" },
      { status: 403 }
    );
  }

  // Require authentication and admin role
  const session = await getServerSession();
  if (!session || session.user?.role !== "CEO") {
    return NextResponse.json(
      { error: "Unauthorized: CEO access required" },
      { status: 401 }
    );
  }

  try {
    // Delete existing data to start fresh
    await prisma.dailySales.deleteMany();
    await prisma.user.deleteMany();
    await prisma.campaign.deleteMany();

    // Create test campaigns
    const campaigns = await prisma.campaign.createMany({
      data: [
        {
          campaignName: "BPI PA OUTBOUND",
          goalType: "sales",
          monthlyGoal: 500,
          kpiMetric: "transmittals",
        },
        {
          campaignName: "BPI PA INBOUND",
          goalType: "sales",
          monthlyGoal: 450,
          kpiMetric: "transmittals",
        },
        {
          campaignName: "BPI PL",
          goalType: "sales",
          monthlyGoal: 400,
          kpiMetric: "activations",
        },
      ],
    });

    return NextResponse.json({
      message: "Test data created successfully",
      campaigns,
    });
  } catch (error) {
    console.error("Seed test data error:", error);
    return NextResponse.json(
      {
        error: "Failed to create test data",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
