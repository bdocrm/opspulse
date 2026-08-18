import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAdminProduction, getProductionSessionUser } from "@/lib/production-access";
import { normalizeProductionName, productionDisplayName } from "@/lib/production-normalization";

async function adminUser() {
  const user = getProductionSessionUser(await getServerSession(authOptions));
  return user && canAdminProduction(user) ? user : null;
}

export async function GET() {
  const user = await adminUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [campaigns, businessUnits, metricTypes] = await prisma.$transaction([
    prisma.campaign.findMany({ where: { isActive: true }, select: { id: true, campaignName: true, productionAliases: { select: { id: true, alias: true } } }, orderBy: { campaignName: "asc" } }),
    prisma.businessUnit.findMany({ where: { isActive: true }, select: { id: true, campaignId: true, businessUnitName: true, campaign: { select: { campaignName: true } }, aliases: { select: { id: true, alias: true } } }, orderBy: [{ campaign: { campaignName: "asc" } }, { businessUnitName: "asc" }] }),
    prisma.productionMetricTypeConfig.findMany({ orderBy: { label: "asc" } }),
  ]);
  return NextResponse.json({ campaigns, businessUnits, metricTypes });
}

export async function POST(request: NextRequest) {
  const user = await adminUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null) as { kind?: string; targetId?: string; alias?: string; metricType?: string; label?: string; defaultUnit?: string } | null;
  try {
    if (body?.kind === "campaignAlias") {
      const alias = productionDisplayName(body.alias);
      const normalizedAlias = normalizeProductionName(alias);
      if (!body.targetId || !normalizedAlias) return NextResponse.json({ error: "Campaign and alias are required." }, { status: 400 });
      const campaign = await prisma.campaign.findUnique({ where: { id: body.targetId } });
      if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
      const item = await prisma.campaignAlias.upsert({ where: { normalizedAlias }, update: { campaignId: campaign.id, alias }, create: { campaignId: campaign.id, alias, normalizedAlias } });
      return NextResponse.json({ item });
    }
    if (body?.kind === "businessUnitAlias") {
      const alias = productionDisplayName(body.alias);
      const normalizedAlias = normalizeProductionName(alias);
      if (!body.targetId || !normalizedAlias) return NextResponse.json({ error: "Business unit and alias are required." }, { status: 400 });
      const unit = await prisma.businessUnit.findUnique({ where: { id: body.targetId } });
      if (!unit) return NextResponse.json({ error: "Business unit not found." }, { status: 404 });
      const item = await prisma.businessUnitAlias.upsert({ where: { campaignId_normalizedAlias: { campaignId: unit.campaignId, normalizedAlias } }, update: { businessUnitId: unit.id, alias }, create: { businessUnitId: unit.id, campaignId: unit.campaignId, alias, normalizedAlias } });
      return NextResponse.json({ item });
    }
    if (body?.kind === "metricType") {
      const metricType = normalizeProductionName(body.metricType).toLowerCase().replaceAll(" ", "_");
      const label = String(body.label || "").replace(/\s+/g, " ").trim();
      const defaultUnit = String(body.defaultUnit || "").trim() || null;
      if (!metricType || !label) return NextResponse.json({ error: "Metric key and label are required." }, { status: 400 });
      const item = await prisma.productionMetricTypeConfig.upsert({ where: { metricType }, update: { label, defaultUnit, isActive: true }, create: { metricType, label, defaultUnit } });
      return NextResponse.json({ item });
    }
    return NextResponse.json({ error: "Unsupported configuration type." }, { status: 400 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "That alias or metric type already exists." }, { status: 409 });
    console.error("Production administration error", error);
    return NextResponse.json({ error: "Configuration could not be saved." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await adminUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const kind = request.nextUrl.searchParams.get("kind");
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Alias id is required." }, { status: 400 });
  if (kind === "campaignAlias") await prisma.campaignAlias.delete({ where: { id } });
  else if (kind === "businessUnitAlias") await prisma.businessUnitAlias.delete({ where: { id } });
  else return NextResponse.json({ error: "Unsupported configuration type." }, { status: 400 });
  return NextResponse.json({ success: true });
}
