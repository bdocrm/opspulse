import { Prisma, type CampaignMetricConfig, type ProductionImport } from "@prisma/client";
import { databaseTable, prisma } from "../prisma";
import { cacheClear } from "../cache";
import { isExecutiveRole } from "../permissions";
import { hasProductionCampaignAccess, productionCampaignIds, type ProductionSessionUser } from "../production-access";
import { buildCandidates, defaultOptions, hash, summary, type Context, type ExistingRecord } from "./engine";
import { nonEmpty, normalizeName } from "./normalization";
import { parseFile, readUpload } from "./parser";
import { validateOptions } from "./review";
import { configKey, NUMBER_FIELDS, SUMMARY_UNIT, type Candidate, type Config, type Inspection, type Preview, type RawRow, type ReviewOptions } from "./types";

export const ENGINE = "SMART_V1";
// Prisma model queries qualify their schema. Raw SQL must do the same because
// pooled PostgreSQL connections do not guarantee a stable search_path.
const batchTable = databaseTable("ProductionImport");
const rawRowTable = databaseTable("ProductionImportRawRow");
type Db = Prisma.TransactionClient;
export class ImportError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const completed = (status: string) => status === "COMPLETED" || status === "COMPLETED_WITH_WARNINGS";
const toConfig = (row: CampaignMetricConfig): Config => ({ ...row, unitType: row.unitType as Config["unitType"], calculationMethod: row.calculationMethod as Config["calculationMethod"], aggregationMethod: row.aggregationMethod as Config["aggregationMethod"], goalDirection: row.goalDirection as Config["goalDirection"], reviewed: true, version: row.updatedAt.toISOString() });

export async function loadContext(user: ProductionSessionUser, db: Db = prisma): Promise<Context> {
  const campaignIds = productionCampaignIds(user);
  const campaigns = await db.campaign.findMany({ where: { isActive: true, ...(isExecutiveRole(user.role) ? {} : { id: { in: campaignIds } }) }, select: { id: true, campaignName: true, productionAliases: { select: { normalizedAlias: true } } }, orderBy: { campaignName: "asc" } });
  const ids = campaigns.map(campaign => campaign.id);
  const [units, configs, existing] = await Promise.all([
    db.businessUnit.findMany({ where: { campaignId: { in: ids }, normalizedName: SUMMARY_UNIT }, select: { id: true, campaignId: true, normalizedName: true } }),
    db.campaignMetricConfig.findMany({ where: { campaignId: { in: ids }, isActive: true } }),
    db.productionMonitoring.findMany({ where: { campaignId: { in: ids }, businessUnit: { normalizedName: SUMMARY_UNIT } } }),
  ]);
  return { campaigns: campaigns.map(campaign => ({ id: campaign.id, name: campaign.campaignName, aliases: campaign.productionAliases.map(alias => alias.normalizedAlias) })), units, configs: configs.map(toConfig), existing: existing as ExistingRecord[] };
}
export async function accessibleBatch(id: string, user: ProductionSessionUser, db: Db = prisma) {
  const batch = await db.productionImport.findFirst({ where: { id, engine: ENGINE } });
  if (!batch) throw new ImportError("Import batch not found.", 404);
  // Raw workbooks may include unassigned campaigns. Only the uploader and CEO
  // can see source data; campaign permissions are rechecked for production writes.
  if (batch.importedById !== user.id && user.role !== "CEO") throw new ImportError("You do not have access to this import batch.", 403);
  return batch;
}
async function rawRows(id: string, db: Db = prisma) {
  const rows = await db.productionImportRawRow.findMany({ where: { importId: id }, orderBy: [{ sourceSheet: "asc" }, { sourceRow: "asc" }] });
  return rows.map(row => ({ ...(row.rawPayload as unknown as RawRow), id: row.id }));
}
function result(batch: ProductionImport) { return { inserted: batch.recordsImported, updated: batch.recordsUpdated, duplicates: batch.recordsUnchanged, skipped: batch.recordsSkipped, pending: batch.pendingCount, warnings: batch.warningCount, conflicts: batch.conflictCount, invalid: batch.invalidCount }; }
async function previousImports(batch: ProductionImport, user: ProductionSessionUser) {
  const rows = await prisma.productionImport.findMany({ where: { engine: ENGINE, id: { not: batch.id }, fileHash: batch.fileHash, ...(user.role === "CEO" ? {} : { importedById: batch.importedById }), status: { in: ["COMPLETED", "COMPLETED_WITH_WARNINGS"] } }, select: { id: true, fileName: true, createdAt: true, importedBy: { select: { name: true } }, status: true }, orderBy: { createdAt: "desc" }, take: 5 });
  return rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
export async function getPreview(id: string, user: ProductionSessionUser): Promise<Preview> {
  const batch = await accessibleBatch(id, user);
  const context = await loadContext(user);
  const rows = await prisma.productionImportRawRow.findMany({ where: { importId: id, normalizedPayload: { not: Prisma.DbNull } }, orderBy: [{ sourceSheet: "asc" }, { sourceRow: "asc" }] });
  const records = rows.map(row => row.normalizedPayload as unknown as Candidate);
  return { id, status: batch.status, inspection: batch.inspection as unknown as Inspection, options: batch.reviewOptions as unknown as ReviewOptions, records, configs: Object.fromEntries(records.filter(row => row.config && row.campaignId).map(row => [configKey(row.campaignId!, row.goalType), row.config!])), campaigns: context.campaigns.map(row => ({ id: row.id, name: row.name })), summary: summary(records), previewHash: batch.previewHash ?? "", previousImports: await previousImports(batch, user), result: completed(batch.status) ? result(batch) : null, lastError: batch.lastError };
}
export async function stageFile(file: File, user: ProductionSessionUser) {
  const upload = await readUpload(file);
  const parsed = parseFile(upload.buffer, upload.fileName, upload.extension);
  if (!parsed.inspection.coveragePassed) throw new ImportError("Source data coverage verification failed.", 422);
  const options = defaultOptions(parsed.inspection);
  const batch = await prisma.$transaction(async tx => {
    const batch = await tx.productionImport.create({ data: { fileName: upload.fileName, fileHash: parsed.inspection.fileHash, fileType: upload.extension, originalFile: upload.buffer, engine: ENGINE, status: "STAGED", importedById: user.id!, inspection: json(parsed.inspection), reviewOptions: json(options), reportingPeriods: json(parsed.inspection.reportingPeriods) } });
    for (let offset = 0; offset < parsed.rows.length; offset += 250) await tx.productionImportRawRow.createMany({ data: parsed.rows.slice(offset, offset + 250).map(row => ({ importId: batch.id, sourceSheet: row.sourceSheet, sourceRow: row.sourceRow, rawPayload: json(row) })) });
    return batch;
  }, { timeout: 60000 });
  try { await reviewBatch(batch.id, options, user); }
  catch (error) {
    await prisma.productionImport.updateMany({ where: { id: batch.id, status: "STAGED" }, data: { status: "FAILED", lastError: error instanceof Error ? error.message : "Initial validation failed; source data is retained." } }).catch(() => {});
    throw error;
  }
  return getPreview(batch.id, user);
}

export async function reviewBatch(id: string, input: unknown, user: ProductionSessionUser) {
  await accessibleBatch(id, user);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM ${batchTable} WHERE "id" = ${id} FOR UPDATE`;
    const batch = await accessibleBatch(id, user, tx);
    if (!["STAGED", "READY", "FAILED"].includes(batch.status)) throw new ImportError("This import can no longer be edited.", 409);
    const context = await loadContext(user, tx);
    const inspection = batch.inspection as unknown as Inspection;
    const options = validateOptions(input, inspection, new Set(context.campaigns.map(row => row.id)));
    const rows = await rawRows(id, tx);
    const captured = rows.reduce((total, row) => total + row.cells.filter(nonEmpty).length, 0);
    if (captured !== inspection.nonEmptyCells) throw new ImportError("Stored source data failed coverage verification. Commit is blocked.", 422);
    const { candidates } = buildCandidates(rows, inspection, options, context);
    const stats = summary(candidates);
    await tx.productionImportRawRow.updateMany({ where: { importId: id }, data: { normalizedPayload: Prisma.DbNull, validationIssues: Prisma.DbNull, processingStatus: "CAPTURED" } });
    const rowIds = new Map(rows.map(row => [JSON.stringify([row.sourceSheet, row.sourceRow]), row.id]));
    for (let offset = 0; offset < candidates.length; offset += 250) {
      const payload = JSON.stringify(candidates.slice(offset, offset + 250).map(candidate => ({ id: rowIds.get(candidate.rowKey), payload: candidate, issues: candidate.issues, status: candidate.status })));
      await tx.$executeRaw`UPDATE ${rawRowTable} AS target SET "normalizedPayload" = source.payload, "validationIssues" = source.issues, "processingStatus" = source.status FROM jsonb_to_recordset(${payload}::jsonb) AS source(id text, payload jsonb, issues jsonb, status text) WHERE target.id = source.id AND target."importId" = ${id}`;
    }
    await tx.productionImport.update({ where: { id }, data: { status: "READY", reviewOptions: json(options), previewHash: hash({ candidates, options }), recordsDetected: stats.total, warningCount: stats.warnings, errorCount: stats.invalid + stats.conflicts, pendingCount: stats.pending, conflictCount: stats.conflicts, invalidCount: stats.invalid, lastError: null, reportingPeriods: json([...new Map(candidates.filter(row => row.reportYear && row.reportMonth).map(row => [`${row.reportYear}-${row.reportMonth}`, { year: row.reportYear, month: row.reportMonth }])).values()]) } });
  }, { timeout: 60000 });
}

function configData(config: Config) {
  return { campaignId: config.campaignId, goalType: config.goalType, label: config.label, unitType: config.unitType, calculationMethod: config.calculationMethod, aggregationMethod: config.aggregationMethod, goalDirection: config.goalDirection, decimalPrecision: config.decimalPrecision, tolerance: config.tolerance, isPercentage: config.isPercentage, isCurrency: config.isCurrency, isPrimary: config.isPrimary };
}
function recordData(row: Candidate, batch: ProductionImport, user: ProductionSessionUser) {
  return { ...row.values, metricUnit: row.config!.unitType, dateUpdated: row.reportDate ? new Date(`${row.reportDate}T00:00:00.000Z`) : null, reportStatus: row.reportStatus, sourceDateText: row.sourceDateText, sourceValues: json(row.source), calculatedValues: json(row.calculated), availability: json(row.availability), metricConfigSnapshot: json(row.config), sourceType: "SMART_IMPORT", sourceFile: batch.fileName, sourceSheet: row.sourceSheet, sourceRow: row.sourceRow, sourceHash: row.sourceHash, productionImportId: batch.id, importedById: user.id!, sourceCampaign: row.campaignSource };
}
export async function commitBatch(id: string, expectedHash: string, selectedRows: string[], user: ProductionSessionUser) {
  await accessibleBatch(id, user);
  if (!expectedHash || !Array.isArray(selectedRows) || selectedRows.some(row => typeof row !== "string") || selectedRows.length > 50000) throw new ImportError("Confirm a valid staged preview and row selection.");
  try {
    const committed = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM ${batchTable} WHERE "id" = ${id} FOR UPDATE`;
      const batch = await accessibleBatch(id, user, tx);
      if (completed(batch.status)) return batch; // Same batch is committed at most once.
      if (batch.status !== "READY" || batch.previewHash !== expectedHash) throw new ImportError("Preview changed. Revalidate and confirm the latest preview.", 409);
      const raw = await rawRows(id, tx);
      const inspection = batch.inspection as unknown as Inspection;
      if (raw.reduce((total, row) => total + row.cells.filter(nonEmpty).length, 0) !== inspection.nonEmptyCells) throw new ImportError("Source capture is incomplete. Import blocked.", 422);
      const persisted = await tx.productionImportRawRow.findMany({ where: { importId: id, normalizedPayload: { not: Prisma.DbNull } } });
      const all = persisted.map(row => row.normalizedPayload as unknown as Candidate);
      const selected = new Set(selectedRows);
      if (selected.size !== selectedRows.length || selectedRows.some(key => !all.some(row => row.rowKey === key))) throw new ImportError("Invalid or duplicate selected source row.");
      const rows = all.filter(row => selected.has(row.rowKey) || row.status === "DUPLICATE");
      if (!rows.length) throw new ImportError("Select at least one row to import.");
      if (rows.some(row => row.action === "BLOCK" || row.status === "INVALID")) throw new ImportError("Resolve or deselect conflicts/invalid rows before committing.", 422);
      // Ordered transaction locks cover two batches importing the same monthly key.
      const lockKeys = rows.flatMap(row => [row.key!, `CONFIG:${row.campaignId}`, `ALIAS:${normalizeName(row.campaignSource)}`]).filter(Boolean);
      for (const key of [...new Set(lockKeys)].sort()) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
      const context = await loadContext(user, tx);
      const existingLookup = new Map(context.existing.map(row => [JSON.stringify([row.campaignId, row.metricType, row.reportYear, row.reportMonth]), row]));
      for (const row of rows) {
        if (!row.campaignId || !hasProductionCampaignAccess(user, row.campaignId) || !context.campaigns.some(campaign => campaign.id === row.campaignId)) throw new ImportError("A selected campaign is no longer accessible.", 403);
        const existing = existingLookup.get(row.key!);
        if ((existing?.id ?? null) !== row.existingId || (existing ? new Date(existing.updatedAt).toISOString() : null) !== row.existingVersion) throw new ImportError("Production data changed since this preview. Revalidate to see current differences.", 409);
        const currentConfig = context.configs.find(config => config.campaignId === row.campaignId && config.goalType === row.goalType);
        if ((currentConfig?.version ?? null) !== row.config?.version) throw new ImportError("KPI configuration changed. Revalidate this preview.", 409);
      }
      await tx.productionImport.update({ where: { id }, data: { status: "IMPORTING", confirmedAt: new Date() } });
      const savedConfigs = new Set<string>();
      const rememberedAliases = new Set<string>();
      const usedUnits = new Map(context.units.map(unit => [unit.campaignId, unit.id]));
      let inserted = 0, updated = 0, duplicates = 0, historyOnly = 0;
      const auditRows: Prisma.ProductionMonitoringAuditCreateManyInput[] = [];
      const issueRows: Prisma.ProductionImportIssueCreateManyInput[] = [];
      for (const row of all) for (const issue of row.issues) issueRows.push({ importId: id, sourceSheet: row.sourceSheet, sourceRow: row.sourceRow, level: issue.level, code: issue.code, message: issue.message, rawData: json({ rowKey: row.rowKey, field: issue.field ?? null }) });
      for (const row of rows) {
        if (row.action === "SKIP") { duplicates += row.status === "DUPLICATE" ? 1 : 0; continue; }
        if (row.action === "HISTORY_ONLY") { historyOnly++; continue; }
        const sourceName = normalizeName(row.campaignSource);
        const options = batch.reviewOptions as unknown as ReviewOptions;
        if (options.campaignMappings[sourceName] === row.campaignId && !rememberedAliases.has(sourceName)) {
          const alias = await tx.campaignAlias.findUnique({ where: { normalizedAlias: sourceName } });
          if (alias && alias.campaignId !== row.campaignId) throw new ImportError("This campaign alias already maps elsewhere. Revalidate the mapping instead of overwriting it.", 409);
          if (!alias) await tx.campaignAlias.create({ data: { campaignId: row.campaignId!, alias: row.campaignSource, normalizedAlias: sourceName } });
          rememberedAliases.add(sourceName);
        }
        const config = row.config!;
        const metricKey = configKey(row.campaignId!, row.goalType);
        if (!savedConfigs.has(metricKey)) {
          if (!config.reviewed) throw new ImportError("KPI configuration requires review.", 422);
          if (config.isPrimary) await tx.campaignMetricConfig.updateMany({ where: { campaignId: row.campaignId!, goalType: { not: row.goalType }, isPrimary: true }, data: { isPrimary: false } });
          if (!context.configs.some(item => configKey(item.campaignId, item.goalType) === metricKey)) await tx.campaignMetricConfig.create({ data: configData(config) });
          savedConfigs.add(metricKey);
        }
        let unitId = usedUnits.get(row.campaignId!);
        if (!unitId) {
          const unit = await tx.businessUnit.upsert({ where: { campaignId_normalizedName: { campaignId: row.campaignId!, normalizedName: SUMMARY_UNIT } }, update: {}, create: { campaignId: row.campaignId!, businessUnitName: "Campaign Summary", normalizedName: SUMMARY_UNIT } });
          unitId = unit.id; usedUnits.set(row.campaignId!, unitId);
        }
        const data = recordData(row, batch, user);
        if (row.existingId) {
          const existing = existingLookup.get(row.key!)!;
          // Missing report dates/statuses must not clear a known current value.
          if (!row.reportDate) data.dateUpdated = existing.dateUpdated ? new Date(existing.dateUpdated) : null;
          if (row.reportStatus === "UNKNOWN") data.reportStatus = existing.reportStatus ?? "UNKNOWN";
          await tx.productionMonitoring.update({ where: { id: row.existingId }, data });
          for (const change of row.changes) auditRows.push({ productionMonitoringId: row.existingId, fieldChanged: change.field, oldValue: change.oldValue == null ? null : JSON.stringify(change.oldValue), newValue: change.newValue == null ? null : JSON.stringify(change.newValue), changedById: user.id!, reason: `SMART_IMPORT:${id}` });
          updated++;
        } else {
          const record = await tx.productionMonitoring.create({ data: { ...data, campaignId: row.campaignId!, businessUnitId: unitId, metricType: row.goalType, reportYear: row.reportYear!, reportMonth: row.reportMonth!, reportPeriod: new Date(Date.UTC(row.reportYear!, row.reportMonth! - 1, 1)) } });
          auditRows.push({ productionMonitoringId: record.id, fieldChanged: "record", oldValue: null, newValue: JSON.stringify(row.values), changedById: user.id!, reason: `SMART_IMPORT:${id}` });
          inserted++;
        }
      }
      for (let offset = 0; offset < auditRows.length; offset += 500) await tx.productionMonitoringAudit.createMany({ data: auditRows.slice(offset, offset + 500) });
      for (let offset = 0; offset < issueRows.length; offset += 500) await tx.productionImportIssue.createMany({ data: issueRows.slice(offset, offset + 500) });
      const stats = summary(all);
      const skipped = all.length - inserted - updated;
      return tx.productionImport.update({ where: { id }, data: { status: stats.warnings || stats.invalid || stats.conflicts || historyOnly || skipped > duplicates ? "COMPLETED_WITH_WARNINGS" : "COMPLETED", completedAt: new Date(), recordsImported: inserted, recordsUpdated: updated, recordsUnchanged: duplicates, recordsSkipped: skipped, lastError: null } });
    }, { timeout: 60000 });
    cacheClear();
    return { id, status: committed.status, ...result(committed) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database commit failed. No production changes were committed.";
    await prisma.productionImport.updateMany({ where: { id, engine: ENGINE, status: { in: ["READY", "FAILED"] } }, data: { lastError: message, ...(error instanceof ImportError ? {} : { status: "FAILED" }) } }).catch(() => {});
    throw error;
  }
}
export async function cancelBatch(id: string, user: ProductionSessionUser) {
  await accessibleBatch(id, user);
  const changed = await prisma.productionImport.updateMany({ where: { id, status: { in: ["READY", "STAGED", "FAILED"] } }, data: { status: "CANCELLED" } });
  if (!changed.count) throw new ImportError("A completed/importing batch cannot be cancelled.", 409);
}
