import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const roleParam = searchParams.get("role");

    const where: any = roleParam ? { role: roleParam } : {};

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        seatNumber: true,
        campaignId: true,
        campaign: {
          select: {
            id: true,
            campaignName: true,
          },
        },
        createdAt: true,
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(users);
  } catch (error) {
    console.error("Users API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const hashed = await bcrypt.hash(body.password, 12);
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        password: hashed,
        role: body.role,
        seatNumber: body.seatNumber ?? null,
      },
    });
    return NextResponse.json(
      { user: { id: user.id, name: user.name, email: user.email, role: user.role } },
      { status: 201 }
    );
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    console.error("Create user error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
