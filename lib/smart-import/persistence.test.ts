import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { configKey, type Preview } from "./types";

// Opt in with a dedicated scratch schema. Never run fixture writes in the live
// application schema. The test runner uses the real PostgreSQL transactions.
const url = process.env.SMART_IMPORT_TEST_DATABASE_URL;
const schema = url ? new URL(url).searchParams.get("schema") : null;
const safe = Boolean(schema && /^opsview_smart_import_test_[a-z0-9_]+$/.test(schema));
if (url && !safe) throw new Error("Persistence tests require an isolated opsview_smart_import_test_* schema.");
const client = new PrismaClient({ datasources: { db: { url: url ?? process.env.DATABASE_URL } } });
vi.mock("../prisma", () => ({ get prisma() { return client; }, databaseTable: (name: string) => Prisma.raw(`"${schema}"."${name}"`) }));

describe.skipIf(!url)("smart import PostgreSQL persistence", () => {
  vi.setConfig({ testTimeout: 60000, hookTimeout: 30000 });
  let service: typeof import("./service");
  let campaignId: string;
  let user: { id: string; role: string };
  const headers = ["CAMPAIGN", "GOAL TYPE", "GOAL", "W1", "W2", "W3", "W4", "W5", "MTD", "DATE", "Custom source"];
  function upload(mtd: unknown = 15, date = "as of August 31, 2026 final", goal: unknown = 100, extraRows: unknown[][] = [], sourceCampaign = "BPI PL") {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, [sourceCampaign, "Booked Volume", goal, 1, 2, 3, 4, 5, mtd, date, "Keep me"], ...extraRows]), "August");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Unmapped data", true], ["Still preserved", "=untrusted text"]]), "Notes");
    return new File([new Uint8Array(XLSX.write(book, { type: "buffer", bookType: "xlsx" }))], "AUGUST PROD 2026.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  async function reviewed(file = upload()): Promise<Preview> {
    let preview = await service.stageFile(file, user);
    expect(preview.records.length, `Initial staging returned no rows: ${JSON.stringify(preview.inspection)}`).toBeGreaterThan(0);
    const options = { ...preview.options, configs: Object.fromEntries(Object.entries(preview.configs).map(([key, config]) => [key, { ...config, reviewed: true, unitType: "CURRENCY", calculationMethod: "SUM", aggregationMethod: "SUM", isPrimary: true }])) };
    await service.reviewBatch(preview.id, options, user);
    preview = await service.getPreview(preview.id, user);
    expect(preview.records.length, `Review returned no rows: ${JSON.stringify(preview.options)}`).toBeGreaterThan(0);
    return preview;
  }
  const commit = (preview: Preview) => service.commitBatch(preview.id, preview.previewHash, preview.records.filter(row => row.action !== "BLOCK" && row.action !== "SKIP").map(row => row.rowKey), user);
  beforeAll(async () => {
    service = await import("./service");
    const created = await client.user.create({ data: { email: "smart-import-test@example.invalid", name: "Import test", password: "unusable-test-password", role: "CEO" } });
    user = { id: created.id, role: "CEO" };
    const campaign = await client.campaign.create({ data: { campaignName: "BPI PL", normalizedName: "BPI PL", goalType: "sales", monthlyGoal: 100, kpiMetric: "volume" } });
    campaignId = campaign.id;
  });
  afterAll(async () => { await client.$disconnect(); });

  it("stages all raw rows without production writes, commits once, and skips duplicate files", async () => {
    const preview = await reviewed();
    expect(await client.productionMonitoring.count()).toBe(0);
    expect(await client.productionImportRawRow.count({ where: { importId: preview.id } })).toBe(4);
    const result = await commit(preview);
    expect(result.inserted).toBe(1);
    expect(await client.productionMonitoring.count()).toBe(1);
    expect(await client.campaignMetricConfig.findUnique({ where: { campaignId_goalType: { campaignId, goalType: "BOOKED VOLUME" } } })).toMatchObject({ unitType: "CURRENCY", isPrimary: true });
    expect(await commit(preview)).toEqual(result);
    const again = await reviewed();
    expect(again.previousImports.length).toBeGreaterThan(0);
    expect(again.records[0]).toMatchObject({ status: "DUPLICATE", action: "SKIP" });
    expect(await commit(again)).toMatchObject({ inserted: 0, updated: 0, duplicates: 1 });
    const original = await client.productionImport.findUnique({ where: { id: preview.id } });
    expect(original?.originalFile).not.toBeNull();
    const source = await client.productionImportRawRow.findMany({ where: { importId: preview.id } });
    expect(JSON.stringify(source)).toContain("Still preserved");
    expect(JSON.stringify(source)).toContain("Keep me");
  });
  it("stores exact field history and keeps blanks from destroying existing values", async () => {
    const preview = await reviewed(upload(25, "August 31, 2026 final", null));
    expect(preview.records[0].source.target).toBeNull();
    expect(preview.records[0].values.target).toBe(100);
    const result = await commit(preview);
    expect(result.updated).toBe(1);
    const current = await client.productionMonitoring.findFirstOrThrow();
    expect(current.mtd).toBe(25); expect(current.target).toBe(100);
    const history = await client.productionMonitoringAudit.findMany({ where: { productionMonitoringId: current.id, fieldChanged: "mtd" } });
    expect(history).toContainEqual(expect.objectContaining({ oldValue: "15", newValue: "25", reason: `SMART_IMPORT:${preview.id}` }));
  });
  it("preserves older reports only as historical snapshots", async () => {
    const preview = await reviewed(upload(5, "August 20, 2026"));
    expect(preview.records[0].action).toBe("HISTORY_ONLY");
    const result = await commit(preview);
    expect(result.updated).toBe(0);
    expect((await client.productionMonitoring.findFirstOrThrow()).mtd).toBe(25);
    const raw = await client.productionImportRawRow.findFirstOrThrow({ where: { importId: preview.id, sourceSheet: "August", sourceRow: 2 } });
    expect(raw.normalizedPayload).toMatchObject({ source: { mtd: 5 } });
  });
  it("blocks stale previews while retaining source and the failure reason", async () => {
    const preview = await reviewed(upload(30));
    const current = await client.productionMonitoring.findFirstOrThrow();
    await client.productionMonitoring.update({ where: { id: current.id }, data: { mtd: 26 } });
    await expect(commit(preview)).rejects.toThrow(/changed since/);
    expect((await client.productionMonitoring.findFirstOrThrow()).mtd).toBe(26);
    expect((await client.productionImport.findUniqueOrThrow({ where: { id: preview.id } })).lastError).toMatch(/changed since/);
    expect(await client.productionImportRawRow.count({ where: { importId: preview.id } })).toBe(4);
  });
  it("serializes duplicate submissions and prevents two production writes", async () => {
    const preview = await reviewed(upload(35));
    const [first, second] = await Promise.all([commit(preview), commit(preview)]);
    expect(second).toEqual(first);
    expect(await client.productionMonitoring.count()).toBe(1);
    const audits = await client.productionMonitoringAudit.findMany({ where: { reason: `SMART_IMPORT:${preview.id}`, fieldChanged: "mtd" } });
    expect(audits).toHaveLength(1);
  });
  it("rolls back earlier row writes when a later database constraint fails", async () => {
    const extra = ["BPI PL", "Transactions", 100, 1, 2, 3, 4, 5, 10, "August 31, 2026 final", "Second row"];
    let preview = await service.stageFile(upload(40, "August 31, 2026 final", 100, [extra]), user);
    const configs = { ...preview.configs };
    const key = configKey(campaignId, "TRANSACTIONS");
    configs[key] = { ...configs[key], reviewed: true, unitType: "COUNT", calculationMethod: "SUM", aggregationMethod: "SUM", isPrimary: false };
    await service.reviewBatch(preview.id, { ...preview.options, configs }, user);
    preview = await service.getPreview(preview.id, user);
    const before = await client.productionMonitoring.findFirstOrThrow();
    // The constraint exists only inside the isolated scratch schema.
    await client.$executeRawUnsafe(`ALTER TABLE "${schema}"."ProductionMonitoring" ADD CONSTRAINT test_reject_transactions CHECK ("metricType" <> 'TRANSACTIONS')`);
    try { await expect(commit(preview)).rejects.toThrow(); }
    finally { await client.$executeRawUnsafe(`ALTER TABLE "${schema}"."ProductionMonitoring" DROP CONSTRAINT test_reject_transactions`); }
    expect((await client.productionMonitoring.findFirstOrThrow()).mtd).toBe(before.mtd);
    expect(await client.productionMonitoring.count()).toBe(1);
    expect(await client.productionMonitoringAudit.count({ where: { reason: `SMART_IMPORT:${preview.id}` } })).toBe(0);
    expect(await client.campaignMetricConfig.count({ where: { goalType: "TRANSACTIONS" } })).toBe(0);
    expect((await client.productionImport.findUniqueOrThrow({ where: { id: preview.id } })).status).toBe("FAILED");
    expect(await client.productionImportRawRow.count({ where: { importId: preview.id } })).toBe(5);
  });
  it("enforces ownership, campaign scope, preview revision, and cancellation", async () => {
    const preview = await reviewed(upload(50));
    await expect(service.getPreview(preview.id, { id: "not-owner", role: "COLLECTOR", campaignIds: [campaignId] })).rejects.toThrow(/access/);
    await expect(service.commitBatch(preview.id, "tampered-preview", [preview.records[0].rowKey], user)).rejects.toThrow(/Preview changed/);
    await expect(service.commitBatch(preview.id, preview.previewHash, [preview.records[0].rowKey], { ...user, role: "COLLECTOR", campaignIds: [] })).rejects.toThrow(/accessible/);
    await service.cancelBatch(preview.id, user);
    await expect(commit(preview)).rejects.toThrow(/Preview changed/);
    expect((await client.productionMonitoring.findFirstOrThrow()).mtd).toBe(35);
  });
  it("remembers a reviewed campaign alias for future files", async () => {
    const file = upload(45, "August 31, 2026 final", 100, [], "BPI Personal Loan");
    let preview = await service.stageFile(file, user);
    expect(preview.records[0].campaignId).toBeNull();
    await service.reviewBatch(preview.id, { ...preview.options, campaignMappings: { "BPI PERSONAL LOAN": campaignId } }, user);
    preview = await service.getPreview(preview.id, user);
    expect(preview.records[0].campaignId).toBe(campaignId);
    expect(await commit(preview)).toMatchObject({ updated: 1 });
    expect(await client.campaignAlias.findUnique({ where: { normalizedAlias: "BPI PERSONAL LOAN" } })).toMatchObject({ campaignId });
    const again = await service.stageFile(file, user);
    expect(again.records[0]).toMatchObject({ campaignId, status: "DUPLICATE" });
  });
});
