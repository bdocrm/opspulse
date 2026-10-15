import type { Prisma } from "@prisma/client";
import type { ProductionSessionUser } from "../production-access";
import { hasProductionCampaignAccess } from "../production-access";
import { normalizeName } from "./normalization";
import { unpackRawRow } from "./raw-storage";
import { aggregatePaTransactions, paHistoryTables, paTransactionTables, PA_TRANSACTION_FAMILY, PA_HISTORY_FAMILY, type PaTransactionTotal } from "./pa-transactions";
import type { Inspection } from "./types";

export type WorkbookDashboard = { family: string; sourceSheet: string; campaignId: string | null; automaticCampaigns?: boolean };
export async function detectWorkbookDashboard(id: string, inspection: Inspection, db: Prisma.TransactionClient): Promise<WorkbookDashboard | null> {
  const history = inspection.sheets.find(sheet => normalizeName(sheet.name) === "M MOM");
  if (history) {
    const first = await db.productionImportRawRow.findUnique({ where: { importId_sourceSheet_sourceRow: { importId: id, sourceSheet: history.name, sourceRow: 1 } }, select: { rawPayload: true } });
    if (first && paHistoryTables(unpackRawRow(first.rawPayload)).length) return { family: PA_HISTORY_FAMILY, sourceSheet: history.name, campaignId: null, automaticCampaigns: true };
  }
  const sheet = inspection.sheets.find(sheet => normalizeName(sheet.name) === "D DASHBOARD");
  if (!sheet) return null;
  const first = await db.productionImportRawRow.findUnique({ where: { importId_sourceSheet_sourceRow: { importId: id, sourceSheet: sheet.name, sourceRow: 1 } }, select: { rawPayload: true } });
  if (!first || !paTransactionTables(unpackRawRow(first.rawPayload)).length) return null;
  const saved = inspection.metadata?.dashboardProjection as { campaignId?: string } | undefined;
  return { family: PA_TRANSACTION_FAMILY, sourceSheet: sheet.name, campaignId: saved?.campaignId ?? null };
}

export async function projectWorkbookDashboard(id: string, inspection: Inspection, fileName: string, user: ProductionSessionUser, requestedCampaign: string | undefined, db: Prisma.TransactionClient) {
  const dashboard = await detectWorkbookDashboard(id, inspection, db);
  if (!dashboard) return null;
  if (dashboard.automaticCampaigns) return projectPaHistory(id, inspection, fileName, user, dashboard, db, false);
  const campaignId = requestedCampaign ?? dashboard.campaignId;
  if (!campaignId) throw new Error("Choose the campaign for this dashboard workbook before importing.");
  if (!hasProductionCampaignAccess(user, campaignId)) throw new Error("Campaign is outside your authorized scope.");
  const campaign = await db.campaign.findUnique({ where: { id: campaignId }, select: { campaignName: true, isActive: true } });
  if (!campaign?.isActive || !/^BPI PA (?:OUTBOUND|INBOUND)$/.test(normalizeName(campaign.campaignName))) throw new Error("Choose an active BPI PA campaign for this workbook.");
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`WORKBOOK_DASHBOARD:${campaignId}`}, 0))::text`;
  const header = await db.productionImportRawRow.findUniqueOrThrow({ where: { importId_sourceSheet_sourceRow: { importId: id, sourceSheet: dashboard.sourceSheet, sourceRow: 1 } }, select: { rawPayload: true } });
  const tables = paTransactionTables(unpackRawRow(header.rawPayload));
  const totals = new Map<string, PaTransactionTotal>();
  let after = 1;
  while (true) {
    const page = await db.productionImportRawRow.findMany({ where: { importId: id, sourceSheet: dashboard.sourceSheet, sourceRow: { gt: after } }, orderBy: { sourceRow: "asc" }, take: 1000, select: { sourceRow: true, rawPayload: true } });
    if (!page.length) break;
    const parsed = aggregatePaTransactions(page.map(row => unpackRawRow(row.rawPayload)), tables, totals);
    if (parsed.errors.length) throw new Error(`Transaction data needs correction: ${parsed.errors[0]}`);
    after = page[page.length - 1].sourceRow;
  }
  const primary = [...totals.values()].filter(total => total.metric === "TRANSMITTAL VOLUME");
  if (!primary.length) throw new Error("No dated transmittal amounts were found in this workbook.");
  const periods = [...new Set(primary.map(total => `${total.year}-${total.month}`))];
  const existing = await db.dashboardImportRecord.findMany({ where: { campaignId, worksheetSource: dashboard.sourceSheet, recordKind: "agent_monitoring", metric: "PA Performance", OR: primary.map(total => ({ year: total.year, month: total.month, entityName: total.name })) }, select: { id: true } });
  if (existing.length) throw new Error("Dashboard records already exist for these source agents and periods. Review the existing import before replacing it.");
  const batch = await db.dashboardImportBatch.create({ data: { campaignId, fileName, importMode: "SMART_WORKBOOK", duplicateMode: "skip", reportPeriodType: "monthly", reportDate: new Date(Date.UTC(primary[0].year, primary[0].month - 1, 1)), workbookYear: primary[0].year, totalWorksheets: inspection.sheets.length, supportedSheets: 1, selectedCampaignIds: JSON.stringify([campaignId]), detectedWorksheets: JSON.stringify([dashboard.sourceSheet]), insertedCount: primary.length, importedById: user.id!, status: "COMPLETED", completedAt: new Date() } });
  await db.dashboardImportRecord.createMany({ data: primary.map(total => ({ batchId: batch.id, campaignId, worksheetSource: dashboard.sourceSheet, sourceRow: total.sourceRows[0], recordKind: "agent_monitoring", monitoringType: "PA_TRANSACTION_AGENT", entityName: total.name, category: campaign.campaignName, product: "TRANSMITTAL VOLUME", metric: "PA Performance", month: total.month, year: total.year, reportPeriodType: "monthly", reportDate: new Date(Date.UTC(total.year, total.month - 1, 1)), actual: total.cents / 100, sourceFile: fileName, importedById: user.id!, remark: JSON.stringify({ smartImportId: id, sourceMetric: total.metric, sourceRows: total.sourceRows, lines: total.lines, transactions: total.count, weeklyVolumes: total.weeks.map(cents => cents / 100) }) })) });
  return { ...dashboard, campaignId, dashboardBatchId: batch.id, records: primary.length, periods, actual: primary.reduce((sum, total) => sum + total.cents, 0) / 100, transactions: primary.reduce((sum, total) => sum + total.count, 0) };
}

export async function projectPaHistory(id: string, inspection: Inspection, fileName: string, user: ProductionSessionUser, dashboard: WorkbookDashboard, db: Prisma.TransactionClient, dryRun = false) {
  const allCampaigns = await db.campaign.findMany({ where: { isActive: true, campaignName: { in: ["BPI PA OUTBOUND", "BPI PA INBOUND"] } }, select: { id: true, campaignName: true } });
  const campaigns = allCampaigns.filter(campaign => hasProductionCampaignAccess(user, campaign.id));
  if (!campaigns.length) throw new Error("BPI PA campaigns are outside your authorized scope.");
  const campaignIds = campaigns.map(campaign => campaign.id);
  const references = await db.dashboardImportRecord.findMany({ where: { campaignId: { in: allCampaigns.map(c => c.id) }, recordKind: "agent_monitoring" }, select: { entityName: true, campaignId: true, year: true, month: true } });
  const exact = new Map<string, Set<string>>(), historical = new Map<string, Set<string>>();
  for (const ref of references) {
    const name = normalizeName(ref.entityName);
    const periodKey = JSON.stringify([name, ref.year, ref.month]);
    const period = exact.get(periodKey) ?? new Set<string>(); period.add(ref.campaignId); exact.set(periodKey, period);
    const all = historical.get(name) ?? new Set<string>(); all.add(ref.campaignId); historical.set(name, all);
  }
  const accounts = await db.user.findMany({ where: { role: "AGENT", campaignId: { in: allCampaigns.map(c => c.id) } }, select: { name: true, campaignId: true } });
  for (const account of accounts) { const name = normalizeName(account.name); const all = historical.get(name) ?? new Set<string>(); all.add(account.campaignId!); historical.set(name, all); }
  const header = await db.productionImportRawRow.findUniqueOrThrow({ where: { importId_sourceSheet_sourceRow: { importId: id, sourceSheet: dashboard.sourceSheet, sourceRow: 1 } }, select: { rawPayload: true } });
  const tables = paHistoryTables(unpackRawRow(header.rawPayload));
  const totals = new Map<string, PaTransactionTotal>();
  let after = 1;
  while (true) {
    const page = await db.productionImportRawRow.findMany({ where: { importId: id, sourceSheet: dashboard.sourceSheet, sourceRow: { gt: after } }, orderBy: { sourceRow: "asc" }, take: 2000, select: { sourceRow: true, rawPayload: true } });
    if (!page.length) break;
    const parsed = aggregatePaTransactions(page.map(row => unpackRawRow(row.rawPayload)), tables, totals);
    if (parsed.errors.length) throw new Error(`Transaction data needs correction: ${parsed.errors[0]}`);
    after = page[page.length - 1].sourceRow;
  }
  const pending: { name: string; year: number; month: number; actual: number; transactions: number; reason: string }[] = [];
  const mapped = new Map<string, PaTransactionTotal[]>();
  for (const total of totals.values()) {
    const name = normalizeName(total.name);
    const bindings = exact.get(JSON.stringify([name, total.year, total.month])) ?? historical.get(name) ?? new Set<string>();
    if (bindings.size !== 1 || !campaignIds.includes([...bindings][0])) { pending.push({ name: total.name, year: total.year, month: total.month, actual: total.cents / 100, transactions: total.count, reason: bindings.size > 1 ? "Ambiguous agent campaign" : bindings.size ? "Campaign outside authorized scope" : "No confirmed agent campaign" }); continue; }
    const campaignId = [...bindings][0]; const rows = mapped.get(campaignId) ?? []; rows.push(total); mapped.set(campaignId, rows);
  }
  if (dryRun) return { state: pending.length ? "PARTIAL" : "COMPLETED", pending, periods: [...new Set([...totals.values()].map(row => `${row.year}-${String(row.month).padStart(2, "0")}`))].sort(), campaigns: [...mapped].map(([campaignId, rows]) => ({ campaignId, records: rows.length, transactions: rows.reduce((sum, row) => sum + row.count, 0), actual: rows.reduce((sum, row) => sum + row.cents, 0) / 100 })), records: [...mapped.values()].reduce((sum, rows) => sum + rows.length, 0), dashboardBatchId: undefined };
  const batches: string[] = [];
  let records = 0;
  for (const [campaignId, rows] of mapped) {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`WORKBOOK_DASHBOARD:${campaignId}`}, 0))::text`;
    const existing = await db.dashboardImportRecord.count({ where: { campaignId, worksheetSource: dashboard.sourceSheet, monitoringType: "PA_SOURCE_BOOKED", OR: rows.map(row => ({ entityName: row.name, year: row.year, month: row.month })) } });
    if (existing) throw new Error("Source dashboard data already exists for these agents and months. Review that import before replacing it.");
    const batch = await db.dashboardImportBatch.create({ data: { campaignId, fileName, importMode: "SMART_WORKBOOK", duplicateMode: "skip", reportPeriodType: "monthly", reportDate: new Date(Date.UTC(rows[0].year, rows[0].month - 1, 1)), workbookYear: rows[0].year, totalWorksheets: inspection.sheets.length, supportedSheets: 1, selectedCampaignIds: JSON.stringify(campaignIds), detectedWorksheets: JSON.stringify([dashboard.sourceSheet]), insertedCount: rows.length, unmappedCount: pending.length, importedById: user.id!, status: pending.length ? "PARTIAL" : "COMPLETED", completedAt: new Date() } });
    await db.dashboardImportRecord.createMany({ data: rows.map(row => ({ batchId: batch.id, campaignId, worksheetSource: dashboard.sourceSheet, sourceRow: row.sourceRows[0], recordKind: "agent_monitoring", monitoringType: "PA_SOURCE_BOOKED", entityName: row.name, category: campaigns.find(c => c.id === campaignId)!.campaignName, product: "BOOKED VOLUME", metric: "Booked Volume", month: row.month, year: row.year, reportPeriodType: "monthly", reportDate: new Date(Date.UTC(row.year, row.month - 1, 1)), actual: row.cents / 100, sourceFile: fileName, importedById: user.id!, remark: JSON.stringify({ smartImportId: id, sourceMetric: "BOOKED VOLUME", sourceRows: row.sourceRows, sourceProducts: row.lines, transactions: row.count, weeklyVolumes: row.weeks.map(cents => cents / 100) }) })) });
    batches.push(batch.id); records += rows.length;
  }
  const periods = [...new Set([...totals.values()].map(row => `${row.year}-${String(row.month).padStart(2, "0")}`))].sort();
  return { ...dashboard, dashboardBatchId: batches[0] ?? "PENDING_ASSIGNMENT", dashboardBatchIds: batches, campaignIds, records, periods, state: pending.length ? "PARTIAL" : "COMPLETED", pending, transactions: [...totals.values()].reduce((sum, row) => sum + row.count, 0), actual: [...totals.values()].reduce((sum, row) => sum + row.cents, 0) / 100 };
}
