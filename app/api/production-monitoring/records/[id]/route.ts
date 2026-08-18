import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAdminProduction, getProductionSessionUser } from "@/lib/production-access";
import { calculateProductionAchievement } from "@/lib/production-metrics";

const NUMERIC_FIELDS = ["target", "week1", "week2", "week3", "week4", "week5", "mtd", "achievement", "runRate"] as const;
const INTEGER_FIELDS = ["workingDays", "daysLapse"] as const;

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = getProductionSessionUser(await getServerSession(authOptions));
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAdminProduction(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!body || !reason) return NextResponse.json({ error: "A reason is required for manual changes." }, { status: 400 });
  const existing = await prisma.productionMonitoring.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Production record not found." }, { status: 404 });
  const data: Prisma.ProductionMonitoringUpdateInput = {};
  const changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];
  const setChange = (field: string, oldValue: unknown, newValue: unknown) => {
    if (oldValue === newValue || (oldValue == null && newValue == null)) return;
    (data as Record<string, unknown>)[field] = newValue;
    changes.push({ field, oldValue, newValue });
  };
  for (const field of NUMERIC_FIELDS) {
    if (!(field in body)) continue;
    const raw = body[field];
    const value = raw == null || raw === "" ? null : Number(raw);
    if (value != null && !Number.isFinite(value)) return NextResponse.json({ error: `${field} must be numeric or blank.` }, { status: 400 });
    setChange(field, existing[field], value);
  }
  for (const field of INTEGER_FIELDS) {
    if (!(field in body)) continue;
    const raw = body[field];
    const value = raw == null || raw === "" ? null : Number(raw);
    if (value != null && (!Number.isInteger(value) || value < 0)) return NextResponse.json({ error: `${field} must be a non-negative whole number or blank.` }, { status: 400 });
    setChange(field, existing[field], value);
  }
  if (typeof body.metricType === "string") {
    const metricType = body.metricType.trim().toLowerCase();
    const configured = await prisma.productionMetricTypeConfig.findUnique({ where: { metricType } });
    if (!configured?.isActive) return NextResponse.json({ error: "Choose an active metric type." }, { status: 400 });
    setChange("metricType", existing.metricType, metricType);
  }
  if ("metricUnit" in body) {
    const metricUnit = typeof body.metricUnit === "string" && body.metricUnit.trim() ? body.metricUnit.trim().slice(0, 50) : null;
    setChange("metricUnit", existing.metricUnit, metricUnit);
  }
  if (!changes.length) return NextResponse.json({ error: "No production values changed." }, { status: 400 });
  const nextTarget = "target" in data ? data.target as number | null : existing.target;
  const nextMtd = "mtd" in data ? data.mtd as number | null : existing.mtd;
  const nextMetricType = "metricType" in data ? data.metricType as string : existing.metricType;
  if (!("achievement" in body) && changes.some((change) => ["target", "mtd", "metricType"].includes(change.field))) {
    const calculated = calculateProductionAchievement({ target: nextTarget, mtd: nextMtd, metricType: nextMetricType as "percentage" | "volume" | "count" | "currency" | "ratio" | "custom" });
    setChange("achievement", existing.achievement, calculated);
  }
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.productionMonitoring.update({ where: { id: existing.id }, data: { ...data, sourceType: "MANUAL" } });
      await tx.productionMonitoringAudit.createMany({
        data: changes.map((change) => ({
          productionMonitoringId: existing.id,
          fieldChanged: change.field,
          oldValue: change.oldValue == null ? null : String(change.oldValue),
          newValue: change.newValue == null ? null : String(change.newValue),
          changedById: user.id as string,
          reason,
        })),
      });
      return record;
    });
    return NextResponse.json({ record: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "That metric type would duplicate an existing record for this business unit and month." }, { status: 409 });
    }
    console.error("Production record update error", error);
    return NextResponse.json({ error: "The production record could not be updated." }, { status: 500 });
  }
}
