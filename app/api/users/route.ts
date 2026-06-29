import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { setUserCampaigns } from "@/lib/user-campaigns";

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
        monthlyTarget: true,
        campaignId: true,
        campaign: {
          select: {
            id: true,
            campaignName: true,
          },
        },
        campaignAssignments: {
          select: {
            campaign: { select: { id: true, campaignName: true } },
          },
        },
        createdAt: true,
      },
      orderBy: { name: "asc" },
    });

    // Expose the full multi-campaign assignment alongside the legacy primary
    // campaign. `campaigns`/`campaignIds` always include the primary so the UI
    // can rely on a single source of truth.
    const shaped = users.map(({ campaignAssignments, ...u }) => {
      const map = new Map<string, { id: string; campaignName: string }>();
      if (u.campaign) map.set(u.campaign.id, u.campaign);
      for (const a of campaignAssignments) {
        if (a.campaign) map.set(a.campaign.id, a.campaign);
      }
      const campaigns = Array.from(map.values()).sort((a, b) =>
        a.campaignName.localeCompare(b.campaignName)
      );
      return { ...u, campaigns, campaignIds: campaigns.map((c) => c.id) };
    });

    return NextResponse.json(shaped);
  } catch (error) {
    const err = error as any;
    console.error("Users API error:", {
      message: err?.message,
      code: err?.code,
      stack: err?.stack,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { 
        error: "Internal server error",
        details: process.env.NODE_ENV === "development" ? err?.message : undefined,
      }, 
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const hashed = await bcrypt.hash(body.password, 12);

    // Resolve the requested campaign assignment. Accept the new `campaignIds`
    // array; fall back to the legacy single `campaignId` for compatibility.
    const campaignIds: string[] = Array.isArray(body.campaignIds)
      ? body.campaignIds.filter(Boolean)
      : body.campaignId
      ? [body.campaignId]
      : [];

    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        password: hashed,
        role: body.role,
        seatNumber: body.seatNumber ?? null,
        monthlyTarget: body.monthlyTarget ?? null,
        // Primary campaign mirrors the first selection; the full set is written
        // to the join table below so the two never diverge.
        campaignId: campaignIds[0] ?? null,
      },
    });

    if (campaignIds.length > 0) {
      await setUserCampaigns(user.id, campaignIds);
    }

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
