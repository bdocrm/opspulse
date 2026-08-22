import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST() {
  try {
    const passwordHash = await bcrypt.hash("password123", 12);

    try {
      await prisma.user.deleteMany();
    } catch (delErr) {
      console.error("⚠️  Delete error (continuing):", delErr);
    }

    // Create test users - one at a time
    let admin;
    try {
      admin = await prisma.user.create({
        data: {
          name: "Admin User",
          email: "admin@opsview.com",
          password: passwordHash,
          role: "CEO",
        },
      });
    } catch (adminErr) {
      console.error("❌ Failed to create admin:", adminErr);
      throw new Error(`Admin creation failed: ${String(adminErr)}`);
    }

    let manager;
    try {
      manager = await prisma.user.create({
        data: {
          name: "Sarah Manager",
          email: "manager@opsview.com",
          password: passwordHash,
          role: "OM",
        },
      });
    } catch (managerErr) {
      console.error("❌ Failed to create manager:", managerErr);
      throw new Error(`Manager creation failed: ${String(managerErr)}`);
    }

    // Verify users exist
    let count = 0;
    try {
      count = await prisma.user.count();
    } catch (countErr) {
      console.error("⚠️  Count error:", countErr);
    }

    return NextResponse.json({
      success: true,
      message: "Test users created successfully",
      count,
      users: [
        { email: admin?.email || "admin@opsview.com", role: admin?.role || "CEO", password: "password123" },
        { email: manager?.email || "manager@opsview.com", role: manager?.role || "OM", password: "password123" },
      ],
    });
  } catch (error) {
    console.error("❌ Seed users error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to create test users",
        details: message,
      },
      { status: 500 }
    );
  }
}
