import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized: CEO or Collector access required" },
        { status: 403 }
      );
    }

    // Only allow CEO and Collector to change passwords
    const userRole = session.user.role;
    if (userRole !== "CEO" && userRole !== "COLLECTOR") {
      return NextResponse.json(
        { error: "Unauthorized: CEO or Collector access required" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { id } = params;
    const { password } = body;

    if (!password || password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Hash the new password
    const hashed = await bcrypt.hash(password, 12);

    // Update the user's password
    await prisma.user.update({
      where: { id },
      data: { password: hashed },
    });

    return NextResponse.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Update password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
