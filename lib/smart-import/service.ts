import { createHash, randomUUID } from "crypto";
import { Prisma, type CampaignMetricConfig, type ProductionImport } from "@prisma/client";
import { databaseTable, prisma } from "../prisma";
import { cacheClear } from "../cache";
import { isExecutiveRole } from "../permissions";
import { hasProductionCampaignAccess, productionCampaignIds, type ProductionSessionUser } from "../production-access";
import { buildCandidates, defaultOptions, hash, summary, type Context, type ExistingRecord } from "./engine";
import { nonEmpty, normalizeName } from "./normalization";
import { inspectEncryption } from "./encryption";
import { parseFile, readUpload } from "./parser";
import { reconcile } from "./reconciliation";
import { sourceHasher } from "./discovery";
import { compressRawRow, unpackRawRow } from "./raw-storage";
import { validateOptions } from "./review";
import { compatibleLayout, mappingSignature, reuseLayout } from "./automatic-mappings";
import { importAccuracy } from "./accuracy";
import { configKey, NUMBER_FIELDS, SUMMARY_UNIT, type Candidate, type Config, type Inspection, type Preview, type RawRow, type ReviewOptions, type Reconciliation } from "./types";

export const ENGINE = "SMART_V1";
// Prisma model queries qualify their schema. Raw SQL must do the same because
// pooled PostgreSQL connections do not guarantee a stable search_path.
const batchTable = databaseTable("ProductionImport");
const rawRowTable = databaseTable("ProductionImportRawRow");
type Db = Prisma.TransactionClient;
export class ImportError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const completed = (status: string) => ["COMPLETED", "COMPLETED_WITH_WARNINGS", "PARTIALLY_IMPORTED"].includes(status);
const toConfig = (row: CampaignMetricConfig): Config => ({ ...row, unitType: row.unitType as Config["unitType"], calculationMethod: row.calculationMethod as Config["calculationMethod"], aggregationMethod: row.aggregationMethod as Config["aggregationMethod"], goalDirection: row.goalDirection as Config["goalDirection"], calculationRules: row.calculationRules as Config["calculationRules"], reviewed: true, version: row.updatedAt.toISOString() });

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
async function rawRows(id: string, db: Db = prisma, sheets?: string[]) {
  const rows = await db.productionImportRawRow.findMany({ where: { importId: id, ...(sheets ? { sourceSheet: { in: sheets } } : {}) }, select: { id: true, rawPayload: true }, orderBy: [{ sourceSheet: "asc" }, { sourceRow: "asc" }] });
  return rows.map(row => ({ ...unpackRawRow(row.rawPayload), id: row.id }));
}
async function storedReconciliation(id: string, inspection: Inspection, db: Db = prisma, records: Candidate[] = [], committed = 0, status = "NOT_COMMITTED") {
  if (!inspection.metadata?.largeWorkbook) return reconcile(inspection, await rawRows(id, db), records, committed, status);
  const report = reconcile(inspection, [], records, committed, status);
  const pending = new Set(records.map(row => JSON.stringify([row.sourceSheet, row.sourceRow])));
  let totalRows = 0, totalCells = 0;
  const sheets = [];
  for (const sheet of inspection.sheets) {
    let count = 0, cells = 0, after = 0, coordinates = true;
    const digest = sourceHasher();
    while (true) {
      const page = await db.productionImportRawRow.findMany({ where: { importId: id, sourceSheet: sheet.name, sourceRow: { gt: after } }, orderBy: { sourceRow: "asc" }, take: 1000, select: { sourceRow: true, rawPayload: true } });
      if (!page.length) break;
      for (const entry of page) {
        const row = unpackRawRow(entry.rawPayload);
        count++; coordinates &&= entry.sourceRow === count && row.sourceRow === count && row.sourceSheet === sheet.name && row.cells.length === sheet.columns && row.cells.every((cell, column) => {
          const match = cell.address.match(/^([A-Z]+)(\d+)$/); let col = 0;
          for (const character of match?.[1] ?? "") col = col * 26 + character.charCodeAt(0) - 64;
          return Number(match?.[2]) === count && col === column + 1;
        });
        cells += row.cells.filter(nonEmpty).length; digest.add(row); pending.delete(JSON.stringify([sheet.name, row.sourceRow]));
      }
      after = page[page.length - 1].sourceRow;
    }
    sheets.push({ name: sheet.name, passed: coordinates && count === sheet.rows && cells === sheet.nonEmptyCells && (!sheet.sourceDigest || digest.finish() === sheet.sourceDigest), sourceCells: sheet.nonEmptyCells, persistedCells: cells, sourceRows: sheet.rows, persistedRows: count, regions: sheet.regions?.length ?? 1 });
    totalRows += count; totalCells += cells;
  }
  const storedCount = await db.productionImportRawRow.count({ where: { importId: id } });
  return { ...report, passed: inspection.coveragePassed && sheets.every(sheet => sheet.passed) && totalRows === storedCount && pending.size === 0, rawStatus: sheets.every(sheet => sheet.passed) && totalRows === storedCount && pending.size === 0 ? "VERIFIED" : "FAILED", persistedRows: totalRows, persistedRawNonEmptyCells: totalCells, sheets };
}
function result(batch: ProductionImport) {
  const inspection = batch.inspection as unknown as Inspection;
  const source: Record<string, number> = inspection.metadata?.workbookImported ? { sourceRows: inspection.sheets.reduce((sum, sheet) => sum + sheet.rows, 0), sourceCells: inspection.nonEmptyCells, worksheets: inspection.sheets.length } : {};
  return { inserted: batch.recordsImported, updated: batch.recordsUpdated, duplicates: batch.recordsUnchanged, skipped: batch.recordsSkipped, pending: batch.pendingCount, warnings: batch.warningCount, conflicts: batch.conflictCount, invalid: batch.invalidCount, ...source };
}
async function previousImports(batch: ProductionImport, user: ProductionSessionUser) {
  const rows = await prisma.productionImport.findMany({ where: { engine: ENGINE, id: { not: batch.id }, fileHash: batch.fileHash, ...(user.role === "CEO" ? {} : { importedById: batch.importedById }), status: { in: ["COMPLETED", "COMPLETED_WITH_WARNINGS", "PARTIALLY_IMPORTED"] } }, select: { id: true, fileName: true, createdAt: true, importedBy: { select: { name: true } }, status: true }, orderBy: { createdAt: "desc" }, take: 5 });
  return rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
export async function getPreview(id: string, user: ProductionSessionUser, verifiedSource?: Reconciliation): Promise<Preview> {
  const batch = await accessibleBatch(id, user);
  const context = await loadContext(user);
  const rows = await prisma.productionImportRawRow.findMany({ where: { importId: id, normalizedPayload: { not: Prisma.DbNull } }, orderBy: [{ sourceSheet: "asc" }, { sourceRow: "asc" }] });
  const records = rows.map(row => row.normalizedPayload as unknown as Candidate);
  const reconciliation = verifiedSource ? { ...verifiedSource, businessStatus: batch.status } : await storedReconciliation(id, batch.inspection as unknown as Inspection, prisma, records, batch.recordsImported + batch.recordsUpdated, batch.status);
  const inspection = batch.inspection as unknown as Inspection;
  const stages = { access: String(inspection.metadata?.accessStatus ?? "NOT_ENCRYPTED"), extraction: String(inspection.metadata?.extractionStatus ?? (inspection.coveragePassed ? "EXTRACTION_COMPLETED" : "PENDING")), business: completed(batch.status) ? "IMPORT_COMPLETED" : batch.status === "READY" ? !records.length || records.some(row => row.action === "BLOCK") ? "READY_FOR_VALIDATION" : "READY_FOR_IMPORT" : "NOT_IMPORTED" };
  const eventRows = await prisma.productionImportIssue.findMany({ where: { importId: id, code: { in: ["UNLOCK_ATTEMPT", "INVALID_PASSWORD", "DECRYPTED", "EXTRACTING", "EXTRACTION_COMPLETED", "EXTRACTION_FAILED", "UNSUPPORTED_ENCRYPTION", "PROCESSING_TIMEOUT", "REQUEST_INTERRUPTED", "CORRUPTED_WORKBOOK"] } }, orderBy: { createdAt: "asc" }, take: 100 });
  const events = eventRows.map(event => ({ code: event.code, message: event.message, createdAt: event.createdAt.toISOString(), actorId: (event.rawData as { actorId?: string } | null)?.actorId ?? null }));
  return { accuracy: importAccuracy(inspection, reconciliation), events, stages, reconciliation, parentImportId: batch.parentImportId, id, status: batch.status, inspection: batch.inspection as unknown as Inspection, options: batch.reviewOptions as unknown as ReviewOptions, records, configs: Object.fromEntries(records.filter(row => row.config && row.campaignId).map(row => [configKey(row.campaignId!, row.goalType), row.config!])), campaigns: context.campaigns.map(row => ({ id: row.id, name: row.name })), summary: summary(records), previewHash: batch.previewHash ?? "", previousImports: await previousImports(batch, user), result: completed(batch.status) ? result(batch) : null, lastError: batch.lastError };
}
export async function stageFile(file: File, user: ProductionSessionUser, parentImportId?: string) {
  const upload = await readUpload(file);
  if (parentImportId) {
    const parent = await accessibleBatch(parentImportId, user);
    if (parent.status !== "PASSWORD_REQUIRED") throw new ImportError("Only an encrypted source can be resumed with a decrypted copy.", 409);
    if (upload.encrypted) throw new ImportError("The supplied copy is still encrypted. Decrypt it with your authorized password in Excel first.", 422);
  }
  const encryption = inspectEncryption(upload.buffer);
  const initial: Inspection = { fileName: upload.fileName, fileType: upload.extension, fileHash: hashFile(upload.buffer), fileSize: upload.buffer.length, sheets: [], nonEmptyCells: 0, capturedCells: 0, coveragePassed: false, warnings: encryption.reason ? [encryption.reason] : [], metadata: { encryptionKind: encryption.kind, accessStatus: upload.encrypted ? encryption.supported ? "PASSWORD_REQUIRED" : "UNSUPPORTED_ENCRYPTION" : "NOT_ENCRYPTED", extractionStatus: "PENDING" }, reportingPeriods: [], encryptionStatus: upload.encrypted ? "PASSWORD_REQUIRED" : "NONE" };
  // Retain the original before parsing; parser and business failures never erase it.
  const batch = await prisma.productionImport.create({ data: { fileName: upload.fileName, fileHash: initial.fileHash, fileType: upload.extension, originalFile: upload.buffer, engine: ENGINE, status: upload.encrypted ? encryption.supported ? "PASSWORD_REQUIRED" : "UNSUPPORTED_ENCRYPTION" : "ANALYZING", importedById: user.id!, parentImportId, inspection: json(initial), reviewOptions: json(defaultOptions(initial)), reportingPeriods: json([]) } });
  if (upload.encrypted) return getPreview(batch.id, user);
  try {
    await extractBatch(batch.id, upload.buffer, user);
  } catch {
    // Do not persist parser exception text: it can include confidential cell data.
    await prisma.productionImport.update({ where: { id: batch.id }, data: { status: "FAILED", lastError: "Workbook extraction or validation failed. Original source retained. Review supported limits and file integrity before retrying." } });
  }
  return getPreview(batch.id, user);
}
export async function extractBatch(id: string, buffer: Buffer, user: ProductionSessionUser, lease?: string) {
  const batch = await accessibleBatch(id, user);
  const original = batch.inspection as unknown as Inspection;
  const parsed = parseFile(buffer, batch.fileName, batch.fileType!);
  const large = parsed.rows.length > 10000;
  parsed.inspection.fileHash = batch.fileHash!;
  parsed.inspection.fileSize = batch.originalFile?.length ?? buffer.length;
  parsed.inspection.metadata = { ...parsed.inspection.metadata, ...(original.metadata ?? {}), largeWorkbook: large, accessStatus: lease ? "DECRYPTED" : "NOT_ENCRYPTED", extractionStatus: "EXTRACTION_COMPLETED", unlockLease: null };
  let options = defaultOptions(parsed.inspection);
  const [context, template, previous] = await Promise.all([
    loadContext(user),
    prisma.importMappingTemplate.findFirst({ where: { ownerId: user.id!, signature: mappingSignature(parsed.inspection) }, orderBy: { createdAt: "desc" } }),
    prisma.productionImport.findMany({ where: { importedById: user.id!, engine: ENGINE, status: { in: ["READY", "COMPLETED", "COMPLETED_WITH_WARNINGS", "PARTIALLY_IMPORTED"] }, id: { not: id } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, inspection: true, reviewOptions: true } }),
  ]);
  // Prefer the most recently reviewed matching upload, then a saved template.
  const learned = previous.find(batch => compatibleLayout(parsed.inspection, batch.inspection as unknown as Inspection, batch.reviewOptions as unknown as ReviewOptions));
  const templateOptions = template?.options as unknown as ReviewOptions | undefined;
  const safeTemplate = templateOptions?.selectedSheets.length && templateOptions.selectedSheets.every(name => {
    const sheet = parsed.inspection.sheets.find(sheet => sheet.name === name);
    return sheet?.headerRow != null && (!templateOptions.headerRows[name] || templateOptions.headerRows[name] === sheet.headerRow);
  });
  const saved = learned?.reviewOptions ?? (safeTemplate ? template?.options : undefined);
  if (saved) {
    const authorized = new Set(context.campaigns.map(campaign => campaign.id));
    options = validateOptions(reuseLayout(options, saved as unknown as ReviewOptions, parsed.inspection, authorized), parsed.inspection, authorized);
    parsed.inspection.metadata.automaticMapping = { source: learned ? "PREVIOUS_IMPORT" : "SAVED_TEMPLATE", id: learned?.id ?? template?.id };
  }
  const verifiedSource = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM ${batchTable} WHERE "id" = ${id} FOR UPDATE`;
    const current = await accessibleBatch(id, user, tx);
    const currentInspection = current.inspection as unknown as Inspection;
    if (lease ? current.status !== "DECRYPTING" || currentInspection.metadata?.unlockLease !== lease : current.status !== "ANALYZING") throw new ImportError("The extraction request is no longer active.", 409);
    for (let offset = 0; offset < parsed.rows.length; offset += 1000) {
      const data = parsed.rows.slice(offset, offset + 1000).map(row => ({ id: randomUUID(), sourceSheet: row.sourceSheet, sourceRow: row.sourceRow, rawPayload: large ? compressRawRow(row) : row }));
      if (large) {
        const payload = JSON.stringify(data);
        await tx.$executeRaw`INSERT INTO ${rawRowTable} ("id", "importId", "sourceSheet", "sourceRow", "rawPayload", "processingStatus", "createdAt") SELECT source.id, ${id}, source."sourceSheet", source."sourceRow", source."rawPayload", 'CAPTURED', now() FROM jsonb_to_recordset(${payload}::jsonb) AS source(id text, "sourceSheet" text, "sourceRow" integer, "rawPayload" jsonb)`;
      } else await tx.productionImportRawRow.createMany({ data: data.map(row => ({ ...row, importId: id, rawPayload: json(row.rawPayload) })) });
    }
    // Release the dense extraction matrix before checking stored chunks.
    parsed.rows.length = 0;
    const reconciliation = await storedReconciliation(id, parsed.inspection, tx);
    if (!reconciliation.passed) throw new ImportError("Persisted source preservation failed. Normalization is blocked.", 422);
    await tx.productionImport.update({ where: { id }, data: { status: "STAGED", inspection: json(parsed.inspection), reconciliation: json(reconciliation), reviewOptions: json(options), reportingPeriods: json(parsed.inspection.reportingPeriods), lastError: null } });
    return reconciliation;
  }, { timeout: 180000, maxWait: 10000 });
  return reviewBatch(id, options, user, verifiedSource);
}
const hashFile = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

export async function reviewBatch(id: string, input: unknown, user: ProductionSessionUser, verifiedSource?: Reconciliation) {
  await accessibleBatch(id, user);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM ${batchTable} WHERE "id" = ${id} FOR UPDATE`;
    const batch = await accessibleBatch(id, user, tx);
    if (!["STAGED", "READY", "FAILED"].includes(batch.status)) throw new ImportError("This import can no longer be edited.", 409);
    const context = await loadContext(user, tx);
    const inspection = batch.inspection as unknown as Inspection;
    const options = validateOptions(input, inspection, new Set(context.campaigns.map(row => row.id)));
    const sourceReport = verifiedSource ?? await storedReconciliation(id, inspection, tx);
    if (!sourceReport.passed) throw new ImportError("Stored source data failed coverage verification. Commit is blocked.", 422);
    const rows = await rawRows(id, tx, inspection.metadata?.largeWorkbook ? options.selectedSheets : undefined);
    const { candidates } = buildCandidates(rows, inspection, options, context);
    const stats = summary(candidates);
    await tx.productionImportRawRow.updateMany({ where: { importId: id }, data: { normalizedPayload: Prisma.DbNull, validationIssues: Prisma.DbNull, processingStatus: "CAPTURED" } });
    const rowIds = new Map(rows.map(row => [JSON.stringify([row.sourceSheet, row.sourceRow]), row.id]));
    for (let offset = 0; offset < candidates.length; offset += 250) {
      const payload = JSON.stringify(candidates.slice(offset, offset + 250).map(candidate => ({ id: rowIds.get(candidate.rowKey), payload: candidate, issues: candidate.issues, status: candidate.status })));
      await tx.$executeRaw`UPDATE ${rawRowTable} AS target SET "normalizedPayload" = source.payload, "validationIssues" = source.issues, "processingStatus" = source.status FROM jsonb_to_recordset(${payload}::jsonb) AS source(id text, payload jsonb, issues jsonb, status text) WHERE target.id = source.id AND target."importId" = ${id}`;
    }
    const candidateReport = reconcile(inspection, [], candidates);
    const reconciliation = { ...candidateReport, passed: sourceReport.passed && candidates.every(candidate => rows.some(row => row.sourceSheet === candidate.sourceSheet && row.sourceRow === candidate.sourceRow)), rawStatus: sourceReport.rawStatus, sheets: sourceReport.sheets, persistedRows: sourceReport.persistedRows, persistedRawNonEmptyCells: sourceReport.persistedRawNonEmptyCells };
    await tx.productionImport.update({ where: { id }, data: { status: "READY", reconciliation: json(reconciliation), reviewOptions: json(options), previewHash: hash({ candidates: [...candidates].sort((a, b) => a.rowKey.localeCompare(b.rowKey)), options }), recordsDetected: stats.total, warningCount: stats.warnings, errorCount: stats.invalid + stats.conflicts, pendingCount: stats.pending, conflictCount: stats.conflicts, invalidCount: stats.invalid, lastError: null, reportingPeriods: json([...new Map(candidates.filter(row => row.reportYear && row.reportMonth).map(row => [`${row.reportYear}-${row.reportMonth}`, { year: row.reportYear, month: row.reportMonth }])).values()]) } });
    return reconciliation;
  }, { timeout: 180000, maxWait: 10000 });
}

function configData(config: Config) {
  return { campaignId: config.campaignId, goalType: config.goalType, label: config.label, unitType: config.unitType, calculationMethod: config.calculationMethod, calculationRules: config.calculationRules == null ? Prisma.DbNull : json(config.calculationRules), aggregationMethod: config.aggregationMethod, goalDirection: config.goalDirection, decimalPrecision: config.decimalPrecision, tolerance: config.tolerance, isPercentage: config.isPercentage, isCurrency: config.isCurrency, isPrimary: config.isPrimary };
}
function recordData(row: Candidate, batch: ProductionImport, user: ProductionSessionUser, raw: RawRow | undefined, existing?: ExistingRecord) {
  const prior = existing?.sourceProvenance as Record<string, unknown> | null;
  const sourceProvenance = Object.fromEntries(NUMBER_FIELDS.map(field => {
    const retained = row.source[field] == null && existing?.[field] != null;
    if (retained) return [field, prior?.[field] ?? { batchId: existing.productionImportId ?? null, file: existing.sourceFile ?? null, sheet: existing.sourceSheet ?? null, row: existing.sourceRow ?? null, address: null, origin: "RETAINED_LEGACY", value: existing[field] }];
    const cell = raw?.cells.find(cell => cell.address === row.sourceFields?.[field]);
    return [field, { batchId: batch.id, file: batch.fileName, sheet: row.sourceSheet, row: row.sourceRow, regionId: row.sourceRegionId ?? null, address: cell?.address ?? null, originalValue: cell?.value ?? null, formula: cell?.formula ?? null, normalizedValue: row.source[field], calculatedValue: row.calculated[field] ?? null, origin: row.source[field] != null ? "SOURCE" : row.calculated[field] != null ? "CONFIGURED_CALCULATION" : "UNAVAILABLE", transformation: row.config?.isPercentage || ["achievement", "rrAchievement"].includes(field) ? "numeric/percentage normalization; native Excel fractions retained" : "numeric normalization", method: row.calculationStatus ?? null }];
  }));
  return { ...row.values, sourceProvenance: json(sourceProvenance), metricUnit: row.config!.unitType, dateUpdated: row.reportDate ? new Date(`${row.reportDate}T00:00:00.000Z`) : null, reportStatus: row.reportStatus, sourceDateText: row.sourceDateText, sourceValues: json(row.source), calculatedValues: json(row.calculated), availability: json(row.availability), metricConfigSnapshot: json(row.config), sourceType: "SMART_IMPORT", sourceFile: batch.fileName, sourceSheet: row.sourceSheet, sourceRow: row.sourceRow, sourceHash: row.sourceHash, productionImportId: batch.id, importedById: user.id!, sourceCampaign: row.campaignSource };
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
      const inspection = batch.inspection as unknown as Inspection;
      const sourceReport = await storedReconciliation(id, inspection, tx);
      if (!sourceReport.passed) throw new ImportError("Source capture is incomplete. Import blocked.", 422);
      const raw = await rawRows(id, tx, inspection.metadata?.largeWorkbook ? (batch.reviewOptions as unknown as ReviewOptions).selectedSheets : undefined);
      const persisted = await tx.productionImportRawRow.findMany({ where: { importId: id, normalizedPayload: { not: Prisma.DbNull } } });
      const all = persisted.map(row => row.normalizedPayload as unknown as Candidate);
      if (hash({ candidates: [...all].sort((a, b) => a.rowKey.localeCompare(b.rowKey)), options: batch.reviewOptions }) !== expectedHash) throw new ImportError("Stored preview integrity check failed. Revalidate before committing.", 409);
      const selected = new Set(selectedRows);
      if (selected.size !== selectedRows.length || selectedRows.some(key => !all.some(row => row.rowKey === key))) throw new ImportError("Invalid or duplicate selected source row.");
      const rows = all.filter(row => selected.has(row.rowKey) || row.status === "DUPLICATE");
      // A file replay cannot replace a newer correction. Previously committed
      // source fingerprints remain idempotent even if current production changed.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`FILE:${batch.fileHash}`}, 0))::text`;
      const previous = await tx.productionImportRawRow.findMany({ where: { import: { engine: ENGINE, fileHash: batch.fileHash, id: { not: id } }, processingStatus: { in: ["COMMITTED", "HISTORY_ONLY", "DUPLICATE"] } }, select: { normalizedPayload: true } });
      const priorFingerprints = new Set(previous.map(row => { const candidate = row.normalizedPayload as unknown as Candidate; return candidate?.sourceFingerprint ? `${candidate.sourceFingerprint}:${candidate.key}` : null; }).filter(Boolean));
      for (const row of rows) if (row.sourceFingerprint && priorFingerprints.has(`${row.sourceFingerprint}:${row.key}`)) { row.action = "SKIP"; row.status = "DUPLICATE"; }
      if (!rows.length) throw new ImportError("Select at least one row to import.");
      if (rows.some(row => row.action === "BLOCK" || row.status === "INVALID")) throw new ImportError("Resolve or deselect conflicts/invalid rows before committing.", 422);
      // Ordered transaction locks cover two batches importing the same monthly key.
      const lockKeys = rows.flatMap(row => [row.key!, `CONFIG:${row.campaignId}`, `ALIAS:${normalizeName(row.campaignSource)}`]).filter(Boolean);
      for (const key of [...new Set(lockKeys)].sort()) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
      const context = await loadContext(user, tx);
      const existingLookup = new Map(context.existing.map(row => [JSON.stringify([row.campaignId, row.metricType, row.reportYear, row.reportMonth]), row]));
      for (const row of rows) {
        if (row.action === "SKIP") continue;
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
        const data = recordData(row, batch, user, raw.find(raw => raw.sourceSheet === row.sourceSheet && raw.sourceRow === row.sourceRow), existingLookup.get(row.key!));
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
      for (const row of all) await tx.productionImportRawRow.update({ where: { importId_sourceSheet_sourceRow: { importId: id, sourceSheet: row.sourceSheet, sourceRow: row.sourceRow } }, data: { normalizedPayload: json(row), processingStatus: !selected.has(row.rowKey) && row.status !== "DUPLICATE" ? "NOT_SELECTED" : row.action === "SKIP" ? row.status === "DUPLICATE" ? "DUPLICATE" : "SKIPPED" : row.action === "HISTORY_ONLY" ? "HISTORY_ONLY" : "COMMITTED" } });
      const stats = summary(all);
      const partial = all.some(row => !rows.some(selected => selected.rowKey === row.rowKey) || (row.action === "SKIP" && row.status !== "DUPLICATE"));
      const reconciliation = { ...reconcile(inspection, raw, all, inserted + updated, partial ? "PARTIALLY_IMPORTED" : "COMPLETED"), passed: sourceReport.passed, rawStatus: sourceReport.rawStatus, sheets: sourceReport.sheets, persistedRows: sourceReport.persistedRows, persistedRawNonEmptyCells: sourceReport.persistedRawNonEmptyCells };
      if (!reconciliation.passed) throw new ImportError("Final reconciliation failed. Business writes rolled back.", 422);
      const skipped = all.length - inserted - updated;
      return tx.productionImport.update({ where: { id }, data: { reconciliation: json(reconciliation), status: partial ? "PARTIALLY_IMPORTED" : stats.warnings || stats.invalid || stats.conflicts || historyOnly || skipped > duplicates ? "COMPLETED_WITH_WARNINGS" : "COMPLETED", completedAt: new Date(), recordsImported: inserted, recordsUpdated: updated, recordsUnchanged: duplicates, recordsSkipped: skipped, lastError: null } });
    }, { timeout: 60000 });
    cacheClear();
    return { id, status: committed.status, ...result(committed) };
  } catch (error) {
    const message = error instanceof ImportError ? error.message : "Database commit failed. No production changes were committed.";
    await prisma.productionImport.updateMany({ where: { id, engine: ENGINE, status: { in: ["READY", "FAILED"] } }, data: { lastError: message, ...(error instanceof ImportError ? {} : { status: "FAILED" }) } }).catch(() => {});
    throw error;
  }
}
export async function cancelBatch(id: string, user: ProductionSessionUser) {
  await accessibleBatch(id, user);
  const changed = await prisma.productionImport.updateMany({ where: { id, status: { in: ["READY", "STAGED", "FAILED", "PASSWORD_REQUIRED", "INVALID_PASSWORD", "UNSUPPORTED_ENCRYPTION", "DECRYPTING", "EXTRACTION_FAILED"] } }, data: { status: "CANCELLED" } });
  if (!changed.count) throw new ImportError("A completed/importing batch cannot be cancelled.", 409);
}

// A workbook can be imported exactly as supplied without assigning its cells
// to campaign metrics. All source sheets remain queryable through the same
// access checks; derived dashboards are never counted again as production.
export async function importSourceWorkbook(id: string, expectedHash: string, user: ProductionSessionUser) {
  await accessibleBatch(id, user);
  if (!expectedHash) throw new ImportError("Inspect the workbook before importing.", 409);
  const saved = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM ${batchTable} WHERE "id" = ${id} FOR UPDATE`;
    const batch = await accessibleBatch(id, user, tx);
    const inspection = batch.inspection as unknown as Inspection;
    if (completed(batch.status) && inspection.metadata?.workbookImported) return batch;
    if (!["READY", "STAGED", "FAILED"].includes(batch.status) || batch.previewHash !== expectedHash) throw new ImportError("Workbook changed. Reload the current preview before importing.", 409);
    const report = await storedReconciliation(id, inspection, tx);
    if (!report.passed || !batch.originalFile) throw new ImportError("Source capture is incomplete. Workbook import blocked.", 422);
    const importedAt = new Date();
    await tx.productionImportIssue.create({ data: { importId: id, level: "INFO", code: "SOURCE_WORKBOOK_IMPORTED", message: "All worksheets imported with their original source labels and values.", rawData: json({ actorId: user.id, importedAt: importedAt.toISOString() }) } });
    return tx.productionImport.update({ where: { id }, data: {
      status: "COMPLETED", confirmedAt: importedAt, completedAt: importedAt, lastError: null,
      inspection: json({ ...inspection, metadata: { ...inspection.metadata, workbookImported: { actorId: user.id, importedAt: importedAt.toISOString() } } }),
      reconciliation: json({ ...report, businessStatus: "SOURCE_WORKBOOK_IMPORTED", committedRecords: 0 }),
    } });
  }, { timeout: 180000, maxWait: 10000 });
  return { id, status: saved.status, ...result(saved) };
}
