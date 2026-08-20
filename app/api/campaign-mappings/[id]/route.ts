import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageCampaignMappings, getProductionSessionUser } from "@/lib/production-access";

async function admin() {
  const user = getProductionSessionUser(await getServerSession(authOptions));
  return user?.id && canManageCampaignMappings(user) ? user : null;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await admin();
  if (!user) return NextResponse.json({ error: "You do not have permission to manage campaign mappings." }, { status: 403 });
  const body = await request.json().catch(() => null) as { status?: "ACTIVE" | "DISABLED"; opsviewCampaignId?: string; notes?: string | null } | null;
  const existing = await prisma.campaignMapping.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Campaign mapping not found." }, { status: 404 });
  const destinationId = body?.opsviewCampaignId ?? existing.opsviewCampaignId;
  const destination = await prisma.campaign.findUnique({ where: { id: destinationId } });
  if (!destination) return NextResponse.json({ error: "The selected OpsView campaign no longer exists." }, { status: 400 });
  if (body?.status !== "DISABLED" && !destination.isActive) return NextResponse.json({ error: "The selected OpsView campaign is inactive." }, { status: 400 });
  const status = body?.status ?? existing.status;
  const action = status !== existing.status
    ? status === "ACTIVE" ? "ENABLED" : "DISABLED"
    : destinationId !== existing.opsviewCampaignId ? "REMAPPED" : "UPDATED";
  const mapping = await prisma.$transaction(async (tx) => {
    const updated = await tx.campaignMapping.update({
      where: { id: existing.id },
      data: { opsviewCampaignId: destinationId, status, notes: body?.notes, updatedById: user.id as string },
      include: { opsviewCampaign: true },
    });
    await tx.campaignMappingAudit.create({ data: {
      mappingId: updated.id,
      action,
      oldCampaignId: existing.opsviewCampaignId,
      newCampaignId: destinationId,
      changedById: user.id as string,
      details: { status, notes: body?.notes ?? existing.notes },
    } });
    return updated;
  });
  return NextResponse.json({ mapping, action });
}
