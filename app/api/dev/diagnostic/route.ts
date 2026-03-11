import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function GET() {
  try {
    console.log("🔍 Running diagnostic...");

    // Test 1: Database connection
    console.log("📌 Test 1: Database connection");
    const userCount = await prisma.user.count();
    console.log(`✅ Database connected. Users in DB: ${userCount}`);

    // Test 2: List all users
    console.log("📌 Test 2: All users in database");
    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        password: true,
      },
    });
    console.log("Users:", allUsers);

    // Test 3: Try to find admin user
    console.log("📌 Test 3: Looking for admin@opspulse.com");
    const adminUser = await prisma.user.findUnique({
      where: { email: "admin@opspulse.com" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        password: true,
      },
    });
    console.log("Admin user found:", adminUser);

    // Test 4: Try password comparison
    if (adminUser && adminUser.password) {
      console.log("📌 Test 4: Password comparison");
      const isValid = await bcrypt.compare("password123", adminUser.password);
      console.log(`Password "password123" valid: ${isValid}`);

      const isValid2 = await bcrypt.compare("wrong", adminUser.password);
      console.log(`Password "wrong" valid: ${isValid2}`);
    }

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
