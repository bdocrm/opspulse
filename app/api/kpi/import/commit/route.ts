import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canImportKpi, getKpiSessionUser, hasCampaignAccess } from "@/lib/kpi-access";
import {
  calculateKpiAchievements,
  validateKpiValues,
  type KpiValueSet,
} from "@/lib/kpi-performance";

type CommitRow = KpiValueSet & {
  employeeName: string;
  matchedEmployeeId: string | null;
  tenure: string | null;
  month: number;
  year: number;
  sourceSheet: string;
  sourceRow: number;
  duplicateWithinFile?: boolean;
  skipRequested?: boolean;
  matchMethod?: string | null;
};

const valueFields: Array<keyof KpiValueSet> = [
  "actualQa", "actualAht", "actualAdherence", "actualCm", "actualCd",
  "goalQa", "goalAht", "goalAdherence", "goalCm", "goalCd",
];

function cleanRow(input: CommitRow): CommitRow {
  const row = { ...input };
  for (const field of valueFields) {
    const value = input[field];
    row[field] = value == null || value === ("" as unknown) ? null : Number(value);
  }
  return row;
}

export async function POST(request: NextRequest) {
  const user = getKpiSessionUser(await getServerSession(authOptions));
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canImportKpi(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null) as {
    campaignId?: string;
    fileName?: string;
    duplicateMode?: "SKIP" | "UPDATE";
    records?: CommitRow[];
  } | null;
  if (!body?.campaignId || !hasCampaignAccess(user, body.campaignId)) {
    return NextResponse.json({ error: "You do not have access to that campaign." }, { status: 403 });
  }
  if (!Array.isArray(body.records) || body.records.length === 0 || body.records.length > 10000) {
    return NextResponse.json({ error: "No preview records were supplied." }, { status: 400 });
  }
  const duplicateMode = body.duplicateMode === "UPDATE" ? "UPDATE" : "SKIP";
  const campaignId = body.campaignId;
  const rows = body.records.map(cleanRow);
  const agentIds = Array.from(new Set(rows.map((row) => row.matchedEmployeeId).filter(Boolean) as string[]));
  const agents = await prisma.user.findMany({
    where: {
      id: { in: agentIds },
      role: "AGENT",
      OR: [{ campaignId }, { campaignAssignments: { some: { campaignId } } }],
    },
    select: { id: true, name: true },
  });
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  try {
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.kpiImportBatch.create({
        data: {
          originalFileName: String(body.fileName || "KPI workbook.xlsx").slice(0, 255),
          campaignId,
          uploadedById: user.id as string,
          totalRows: rows.length,
          duplicateMode,
          status: "IMPORTING",
        },
      });
      let imported = 0;
      let updated = 0;
      let skipped = 0;
      let failed = 0;
      let duplicates = 0;
      let unmatched = 0;
      let warnings = 0;
      const issues: Prisma.KpiImportIssueCreateManyInput[] = [];
      const seen = new Set<string>();
      const periods: Date[] = [];

      for (const row of rows) {
        if (row.skipRequested) {
          skipped += 1;
          issues.push({
            batchId: batch.id,
            sourceSheet: row.sourceSheet || "Unknown",
            sourceRow: Number(row.sourceRow) || null,
            employeeName: row.employeeName || null,
            kind: "SKIPPED_BY_USER",
            message: "The row was explicitly skipped during import review.",
          });
          continue;
        }
        const validationErrors = validateKpiValues(row);
        if (!Number.isInteger(row.month) || row.month < 1 || row.month > 12) validationErrors.push("Invalid month.");
        if (!Number.isInteger(row.year) || row.year < 2000 || row.year > 2100) validationErrors.push("Invalid year.");
        if (!row.employeeName?.trim()) validationErrors.push("Employee name is required.");
        const agent = row.matchedEmployeeId ? agentById.get(row.matchedEmployeeId) : null;
        if (!agent) {
          unmatched += 1;
          skipped += 1;
          issues.push({
            batchId: batch.id,
            sourceSheet: row.sourceSheet || "Unknown",
            sourceRow: Number(row.sourceRow) || null,
            employeeName: row.employeeName || null,
            kind: "UNMATCHED_EMPLOYEE",
            message: "No authorized OpsView agent was confirmed for this row.",
          });
          continue;
        }
        const naturalKey = `${agent.id}:${row.year}:${row.month}`;
        if (seen.has(naturalKey) || row.duplicateWithinFile) {
          duplicates += 1;
          skipped += 1;
          issues.push({
            batchId: batch.id,
            sourceSheet: row.sourceSheet || "Unknown",
            sourceRow: Number(row.sourceRow) || null,
            employeeName: row.employeeName,
            kind: "DUPLICATE_IN_WORKBOOK",
            message: "The employee appears more than once for this reporting period.",
          });
          continue;
        }
        seen.add(naturalKey);
        if (validationErrors.length) {
          failed += 1;
          skipped += 1;
          issues.push(...validationErrors.map((message) => ({
            batchId: batch.id,
            sourceSheet: row.sourceSheet || "Unknown",
            sourceRow: Number(row.sourceRow) || null,
            employeeName: row.employeeName,
            kind: "VALIDATION_ERROR",
            message,
          })));
          continue;
        }
        const achievements = calculateKpiAchievements(row);
        const existing = await tx.collectorKpiRecord.findUnique({
          where: {
            employeeId_campaignId_year_month: {
              employeeId: agent.id,
              campaignId,
              year: row.year,
              month: row.month,
            },
          },
        });
        const recordData = {
          employeeNameSnapshot: agent.name,
          month: row.month,
          year: row.year,
          periodDate: new Date(Date.UTC(row.year, row.month - 1, 1)),
          tenure: row.tenure?.trim() || null,
          ...Object.fromEntries(valueFields.map((field) => [field, row[field]])),
          ...achievements,
          importBatchId: batch.id,
          sourceSheet: String(row.sourceSheet || "Unknown").slice(0, 255),
          sourceRow: Number(row.sourceRow) || 0,
        };
        periods.push(recordData.periodDate);
        const newValues = {
          tenure: recordData.tenure,
          ...Object.fromEntries(valueFields.map((field) => [field, row[field]])),
          ...achievements,
          month: row.month,
          year: row.year,
        } as Prisma.InputJsonObject;
        let affectedRecordId = existing?.id ?? null;
        if (existing) {
          duplicates += 1;
          if (duplicateMode === "UPDATE") {
            await tx.collectorKpiRecord.update({ where: { id: existing.id }, data: recordData });
            await tx.kpiImportEvent.create({ data: {
              batchId: batch.id,
              recordId: existing.id,
              employeeId: agent.id,
              employeeName: agent.name,
              action: "KPI_RECORD_UPDATED",
              oldValues: {
                tenure: existing.tenure,
                actualQa: existing.actualQa, actualAht: existing.actualAht,
                actualAdherence: existing.actualAdherence, actualCm: existing.actualCm, actualCd: existing.actualCd,
                goalQa: existing.goalQa, goalAht: existing.goalAht,
                goalAdherence: existing.goalAdherence, goalCm: existing.goalCm, goalCd: existing.goalCd,
                achievementQa: existing.achievementQa, achievementAht: existing.achievementAht,
                achievementAdherence: existing.achievementAdherence, achievementCm: existing.achievementCm,
                achievementCd: existing.achievementCd, overallScore: existing.overallScore,
                month: existing.month, year: existing.year,
              },
              newValues,
              reason: "Existing record updated after explicit import confirmation.",
              sourceSheet: recordData.sourceSheet,
              sourceRow: recordData.sourceRow,
            } });
            updated += 1;
          } else {
            await tx.kpiImportEvent.create({ data: {
              batchId: batch.id,
              recordId: existing.id,
              employeeId: agent.id,
              employeeName: agent.name,
              action: "KPI_RECORD_SKIPPED_EXISTING",
              reason: "Existing record preserved by the default skip policy.",
              sourceSheet: recordData.sourceSheet,
              sourceRow: recordData.sourceRow,
            } });
            skipped += 1;
          }
        } else {
          const created = await tx.collectorKpiRecord.create({
            data: { ...recordData, employeeId: agent.id, campaignId },
          });
          affectedRecordId = created.id;
          await tx.kpiImportEvent.create({ data: {
            batchId: batch.id,
            recordId: created.id,
            employeeId: agent.id,
            employeeName: agent.name,
            action: "KPI_RECORD_CREATED",
            newValues,
            sourceSheet: recordData.sourceSheet,
            sourceRow: recordData.sourceRow,
          } });
          imported += 1;
        }
        if (row.matchMethod === "MANUAL") {
          await tx.kpiImportEvent.create({ data: {
            batchId: batch.id,
            recordId: affectedRecordId,
            employeeId: agent.id,
            employeeName: agent.name,
            action: "EMPLOYEE_MAPPING_CONFIRMED",
            reason: `Excel employee "${row.employeeName}" manually matched to OpsView employee.`,
            sourceSheet: recordData.sourceSheet,
            sourceRow: recordData.sourceRow,
          } });
        }
      }
      if (issues.length) await tx.kpiImportIssue.createMany({ data: issues });
      warnings = issues.length;
      const completedWithWarnings = skipped > 0 || failed > 0 || unmatched > 0;
      await tx.kpiImportBatch.update({
        where: { id: batch.id },
        data: {
          periodStart: periods.length ? new Date(Math.min(...periods.map(Number))) : null,
          periodEnd: periods.length ? new Date(Math.max(...periods.map(Number))) : null,
          successfulRows: imported,
          updatedRows: updated,
          skippedRows: skipped,
          failedRows: failed,
          duplicateRows: duplicates,
          unmatchedRows: unmatched,
          warningRows: warnings,
          status: completedWithWarnings ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
          completedAt: new Date(),
        },
      });
      return { batchId: batch.id, imported, updated, skipped, failed, duplicates, unmatched, warnings };
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("KPI import commit error", error);
    let failedBatchId: string | undefined;
    try {
      const failedBatch = await prisma.kpiImportBatch.create({
        data: {
          originalFileName: String(body.fileName || "KPI workbook.xlsx").slice(0, 255),
          campaignId,
          uploadedById: user.id as string,
          totalRows: rows.length,
          failedRows: rows.length,
          duplicateMode,
          status: "FAILED",
          completedAt: new Date(),
          issues: {
            create: {
              sourceSheet: "Workbook",
              kind: "IMPORT_FAILED",
              message: "The transaction was rolled back; no KPI record changes were kept.",
            },
          },
        },
      });
      failedBatchId = failedBatch.id;
    } catch (auditError) {
      console.error("KPI failed-import audit error", auditError);
    }
    return NextResponse.json(
      { error: "The KPI import was rolled back because it could not be completed safely.", batchId: failedBatchId },
      { status: 500 }
    );
  }
}
