import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewKpi, getKpiSessionUser } from "@/lib/kpi-access";
import { getKpiStatus } from "@/lib/kpi-performance";
import { kpiRecordScope } from "@/lib/kpi-query";

const average = (values: Array<number | null>) => {
  const available = values.filter((value): value is number => value != null && Number.isFinite(value));
  return available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
};

export async function GET(request: NextRequest) {
  const user = getKpiSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewKpi(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const params = request.nextUrl.searchParams;
  const month = Number(params.get("month"));
  const year = Number(params.get("year"));
  const campaignId = params.get("campaignId");
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
    return NextResponse.json({ error: "Choose a valid reporting period." }, { status: 400 });
  }
  const and: Prisma.CollectorKpiRecordWhereInput[] = [kpiRecordScope(user)];
  if (campaignId) and.push({ campaignId });
  const where = { month, year, AND: and };
  const select = {
      employeeId: true,
      employeeNameSnapshot: true,
      actualQa: true, actualAht: true, actualAdherence: true, actualCm: true, actualCd: true,
      goalQa: true, goalAht: true, goalAdherence: true, goalCm: true, goalCd: true,
      overallScore: true,
  } as const;
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  const [records, previousRecords] = await prisma.$transaction([
    prisma.collectorKpiRecord.findMany({ where, select }),
    prisma.collectorKpiRecord.findMany({ where: { month: previousMonth, year: previousYear, AND: and }, select }),
  ]);
  const statusCounts = { EXCEEDS_TARGET: 0, MEETS_TARGET: 0, NEAR_TARGET: 0, BELOW_TARGET: 0, NO_DATA: 0 };
  records.forEach((record) => { statusCounts[getKpiStatus(record.overallScore)] += 1; });
  const metric = (actual: keyof typeof records[number], goal: keyof typeof records[number]) => ({
    actual: average(records.map((record) => record[actual] as number | null)),
    goal: average(records.map((record) => record[goal] as number | null)),
  });
  const ranked = records.filter((record) => record.overallScore != null).sort(
    (left, right) => (right.overallScore as number) - (left.overallScore as number)
  );
  const previousByEmployee = new Map(previousRecords.map((record) => [record.employeeId, record.overallScore]));
  const changes = ranked.flatMap((record) => {
    const previousScore = previousByEmployee.get(record.employeeId);
    return previousScore == null || record.overallScore == null ? [] : [{
      id: record.employeeId,
      name: record.employeeNameSnapshot,
      score: record.overallScore,
      change: record.overallScore - previousScore,
    }];
  }).sort((left, right) => right.change - left.change);
  return NextResponse.json({
    totalCollectors: records.length,
    metrics: {
      qa: metric("actualQa", "goalQa"),
      aht: metric("actualAht", "goalAht"),
      adherence: metric("actualAdherence", "goalAdherence"),
      cm: metric("actualCm", "goalCm"),
      cd: metric("actualCd", "goalCd"),
    },
    statusCounts,
    insights: {
      topPerformers: ranked.slice(0, 5).map((record) => ({ id: record.employeeId, name: record.employeeNameSnapshot, score: record.overallScore })),
      bottomPerformers: ranked.slice(-5).reverse().map((record) => ({ id: record.employeeId, name: record.employeeNameSnapshot, score: record.overallScore })),
      mostImproved: changes.find((item) => item.change > 0) ?? null,
      largestDecline: changes.slice().sort((left, right) => left.change - right.change).find((item) => item.change < 0) ?? null,
      qaBelowGoal: records.filter((record) => record.actualQa != null && record.goalQa != null && record.actualQa < record.goalQa).length,
      ahtAboveGoal: records.filter((record) => record.actualAht != null && record.goalAht != null && record.actualAht > record.goalAht).length,
      lowAdherence: records.filter((record) => record.actualAdherence != null && record.goalAdherence != null && record.actualAdherence < record.goalAdherence).length,
      cmAboveGoal: records.filter((record) => record.actualCm != null && record.goalCm != null && record.actualCm > record.goalCm).length,
      cdAboveGoal: records.filter((record) => record.actualCd != null && record.goalCd != null && record.actualCd > record.goalCd).length,
    },
  });
}
