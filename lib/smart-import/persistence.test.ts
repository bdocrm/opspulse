import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { encryptedFixture } from "./fixtures";
import { compressRawRow, unpackRawRow } from "./raw-storage";
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
    const options = { ...preview.options, configs: Object.fromEntries(Object.entries(preview.configs).map(([key, config]) => [key, { ...config, reviewed: true, unitType: "CURRENCY", calculationMethod: "SUM", aggregationMethod: "SUM", isPrimary: config.goalType === "BOOKED VOLUME" }])) };
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
    const provenance = current.sourceProvenance as Record<string, { batchId: string; address: string }>;
    expect(provenance.mtd).toMatchObject({ batchId: preview.id, address: "I2" });
    expect(provenance.target.batchId).not.toBe(preview.id);
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
  it("retains inaccessible encrypted sources and links authorized decrypted uploads", async () => {
    const encrypted = new File([new Uint8Array(encryptedFixture())], "BPI PA DASHBOARD SEPTEMBER.xlsx");
    const blocked = await service.stageFile(encrypted, user);
    expect(blocked.status).toBe("PASSWORD_REQUIRED");
    expect(blocked.reconciliation?.rawStatus).toBe("PASSWORD_REQUIRED");
    expect(blocked.records).toHaveLength(0);
    expect((await client.productionImport.findUniqueOrThrow({ where: { id: blocked.id } })).originalFile).toEqual(Buffer.from(await encrypted.arrayBuffer()));
    await expect(service.reviewBatch(blocked.id, blocked.options, user)).rejects.toThrow(/no longer/);
    await expect(service.stageFile(upload(), { id: "not-owner", role: "COLLECTOR" }, blocked.id)).rejects.toThrow(/access/);
    const resumed = await service.stageFile(upload(47), user, blocked.id);
    expect(resumed.parentImportId).toBe(blocked.id);
    expect(resumed.reconciliation?.passed).toBe(true);
    expect((await client.productionImport.findUniqueOrThrow({ where: { id: blocked.id } })).status).toBe("PASSWORD_REQUIRED");
  });
  it("blocks stored source tampering even when cell counts still match", async () => {
    const preview = await reviewed(upload(48));
    const row = await client.productionImportRawRow.findFirstOrThrow({ where: { importId: preview.id, sourceSheet: "August", sourceRow: 2 } });
    const raw = row.rawPayload as { cells: { value: unknown }[] };
    raw.cells[10].value = "Changed supplemental note";
    await client.productionImportRawRow.update({ where: { id: row.id }, data: { rawPayload: raw as Prisma.InputJsonValue } });
    await expect(commit(preview)).rejects.toThrow(/Source capture/);
    expect((await service.getPreview(preview.id, user)).reconciliation?.passed).toBe(false);
  });
  it("reports explicit partial commits accurately and retains every unselected row", async () => {
    const extra = ["BPI PL", "Separate Count", 100, 1, 2, 3, 4, 5, 10, "August 31, 2026 final", "Not selected"];
    const preview = await reviewed(upload(49, "August 31, 2026 final", 100, [extra]));
    const selected = preview.records.find(row => row.goalType === "BOOKED VOLUME")!;
    const result = await service.commitBatch(preview.id, preview.previewHash, [selected.rowKey], user);
    expect(result.status).toBe("PARTIALLY_IMPORTED");
    expect(result.updated).toBe(1);
    expect(await client.productionMonitoring.count({ where: { metricType: "SEPARATE COUNT" } })).toBe(0);
    expect((await service.getPreview(preview.id, user)).reconciliation).toMatchObject({ passed: true, committedRecords: 1, parsedRecords: 2 });
  });
  it("does not replay an old identical file over a later correction", async () => {
    const file = upload(51);
    const first = await reviewed(file);
    await commit(first);
    const correction = await reviewed(upload(52));
    await commit(correction);
    const replay = await reviewed(file);
    expect(await commit(replay)).toMatchObject({ updated: 0, inserted: 0, duplicates: 1 });
    expect((await client.productionMonitoring.findFirstOrThrow({ where: { metricType: "BOOKED VOLUME" } })).mtd).toBe(52);
  });
  it("saves immutable mapping versions and enforces template ownership and layout", async () => {
    const { saveTemplate, applyTemplate } = await import("./templates");
    const preview = await reviewed(upload(53));
    const first = await saveTemplate(preview.id, "August layout", user);
    const second = await saveTemplate(preview.id, "August layout", user);
    expect([first.version, second.version]).toEqual([1, 2]);
    const next = await reviewed(upload(54));
    await applyTemplate(next.id, first.id, user);
    await expect(applyTemplate(next.id, first.id, { ...user, id: "other", role: "CEO" })).rejects.toThrow(/not found/);
    expect(await client.importMappingTemplate.count({ where: { ownerId: user.id } })).toBe(2);
  });

  it("automatically reuses this user's reviewed worksheet, header and column mappings", async () => {
    function customUpload(value: number) {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Report"], ["Portfolio", "Measure", "Result", "Reported on"], ["BPI PL", "Booked Volume", value, "August 31, 2026 final"]]), "Custom layout");
      return new File([new Uint8Array(XLSX.write(book, { type: "buffer", bookType: "xlsx" }))], "custom.xlsx");
    }
    const first = await service.stageFile(customUpload(61), user);
    expect(first.records).toHaveLength(0);
    await service.reviewBatch(first.id, { ...first.options, selectedSheets: ["Custom layout"], headerRows: { "Custom layout": 2 }, columnMappings: { "Custom layout": { "0": "campaign", "1": "goalType", "2": "mtd", "3": "dateUpdated" } } }, user);
    const next = await service.stageFile(customUpload(62), user);
    expect(next.options).toMatchObject({ selectedSheets: ["Custom layout"], headerRows: { "Custom layout": 2 }, columnMappings: { "Custom layout": { "0": "campaign", "1": "goalType", "2": "mtd", "3": "dateUpdated" } } });
    expect(next.records).toHaveLength(1);
    expect(next.records[0].source.mtd).toBe(62);
    expect(next.inspection.metadata?.automaticMapping).toMatchObject({ source: "PREVIOUS_IMPORT", id: first.id });
    const other = await client.user.create({ data: { email: "other-import-test@example.invalid", name: "Other importer", password: "unusable", role: "CEO" } });
    const isolated = await service.stageFile(customUpload(63), { id: other.id, role: "CEO" });
    expect(isolated.records).toHaveLength(0);
    expect(isolated.inspection.metadata?.automaticMapping).toBeUndefined();
  });

  it("imports every original worksheet without campaign mapping and reopens the exact saved values", async () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["LINE", "BC", "CTC", "BT", "Achievement"], ["LINE 1", 12, null, 0, 0.25], ["LINE 2", 8, 4, 2, 0.5]]);
    sheet.E2.z = "0.00%";
    sheet.E3 = { t: "e", v: 7, w: "#DIV/0!", f: "1/0" };
    XLSX.utils.book_append_sheet(book, sheet, "Dashboard");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Source note", "Keep as supplied"]]), "Hidden notes");
    book.Workbook = { Sheets: [{ name: "Dashboard", Hidden: 0 }, { name: "Hidden notes", Hidden: 1 }] };
    const file = new File([new Uint8Array(XLSX.write(book, { type: "buffer", bookType: "xlsx" }))], "source-workbook.xlsx");
    const preview = await service.stageFile(file, user);
    const before = await client.productionMonitoring.count();
    const saved = await service.importSourceWorkbook(preview.id, preview.previewHash, user);
    expect(saved).toMatchObject({ status: "COMPLETED", worksheets: 2, sourceRows: 4, inserted: 0, updated: 0 });
    expect(await service.importSourceWorkbook(preview.id, preview.previewHash, user)).toEqual(saved);
    expect(await client.productionMonitoring.count()).toBe(before);
    const reopened = await service.getPreview(preview.id, user);
    expect(reopened.result).toMatchObject({ worksheets: 2, sourceRows: 4 });
    expect(reopened.inspection.metadata?.workbookImported).toMatchObject({ actorId: user.id });
    expect(reopened.inspection.sheets[1].visibility).toBe("HIDDEN");
    const row = await client.productionImportRawRow.findUniqueOrThrow({ where: { importId_sourceSheet_sourceRow: { importId: preview.id, sourceSheet: "Dashboard", sourceRow: 2 } } });
    const source = unpackRawRow(row.rawPayload);
    expect(source.cells.map(cell => cell.value)).toEqual(["LINE 1", 12, null, 0, 0.25]);
    expect(source.cells[4].formatted).toBe("25.00%");
    const stored = await client.productionImport.findUniqueOrThrow({ where: { id: preview.id } });
    expect(Buffer.from(stored.originalFile!).equals(Buffer.from(await file.arrayBuffer()))).toBe(true);
    await expect(service.reviewBatch(preview.id, preview.options, user)).rejects.toThrow(/no longer be edited/);
    await expect(service.importSourceWorkbook(preview.id, preview.previewHash, { id: "unrelated-user", role: "COLLECTOR" })).rejects.toMatchObject({ status: 403 });
  });

  it("blocks source workbook import when source cells or the confirmed preview changed", async () => {
    const preview = await service.stageFile(upload(73), user);
    await expect(service.importSourceWorkbook(preview.id, "stale-preview", user)).rejects.toMatchObject({ status: 409 });
    const row = await client.productionImportRawRow.findFirstOrThrow({ where: { importId: preview.id, sourceSheet: "August", sourceRow: 2 } });
    const payload = unpackRawRow(row.rawPayload);
    payload.cells[0].value = "Changed source";
    await client.productionImportRawRow.update({ where: { id: row.id }, data: { rawPayload: JSON.parse(JSON.stringify(payload)) } });
    await expect(service.importSourceWorkbook(preview.id, preview.previewHash, user)).rejects.toMatchObject({ status: 422 });
    expect((await client.productionImport.findUniqueOrThrow({ where: { id: preview.id } })).status).toBe("READY");
  });

  it("unlocks in place, reconciles full source, and never persists the password or decrypted archive", async () => {
    const { unlockBatch } = await import("./unlock");
    const secret = "unique-fixture-password-2026";
    const plain = Buffer.from(await upload(56).arrayBuffer());
    const encrypted = encryptedFixture(secret, plain);
    const staged = await service.stageFile(new File([new Uint8Array(encrypted)], "encrypted-source.xlsx"), user);
    expect(staged.reconciliation).toMatchObject({ sourceRows: null, sourceNonEmptyCells: null, discoveredSheets: null });
    await expect(unlockBatch(staged.id, "incorrect-fixture-secret", user)).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    expect((await service.getPreview(staged.id, user)).status).toBe("INVALID_PASSWORD");
    const currentBefore = (await client.productionMonitoring.findFirstOrThrow()).mtd;
    const preview = await unlockBatch(staged.id, secret, user);
    expect(preview.id).toBe(staged.id);
    expect(preview.stages).toMatchObject({ access: "DECRYPTED", extraction: "EXTRACTION_COMPLETED", business: "READY_FOR_IMPORT" });
    expect(preview.reconciliation?.passed).toBe(true);
    expect(preview.inspection.sheets).toHaveLength(2);
    expect((await client.productionMonitoring.findFirstOrThrow()).mtd).toBe(currentBefore);
    const archive = await client.productionImport.findUniqueOrThrow({ where: { id: staged.id } });
    expect(Buffer.from(archive.originalFile!).equals(Buffer.from(encrypted))).toBe(true);
    expect(archive.originalFile).not.toEqual(plain);
    const issues = await client.productionImportIssue.findMany({ where: { importId: staged.id } });
    const source = await client.productionImportRawRow.findMany({ where: { importId: staged.id } });
    expect(JSON.stringify({ archive, issues, source })).not.toContain(secret);
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["UNLOCK_ATTEMPT", "INVALID_PASSWORD", "DECRYPTED", "EXTRACTION_COMPLETED"]));
    const again = await unlockBatch(staged.id, secret, user);
    expect(again.reconciliation).toEqual(preview.reconciliation);
    expect(await client.productionImportRawRow.count({ where: { importId: staged.id } })).toBe(4);
    expect((await commit(preview)).updated).toBe(1);
  });
  it("allows only the exact uploader to unlock, including admin sessions", async () => {
    const { unlockBatch } = await import("./unlock");
    const preview = await service.stageFile(new File([new Uint8Array(encryptedFixture())], "private-encrypted.xlsx"), user);
    await expect(unlockBatch(preview.id, "fixture-only-password", { ...user, id: "another-admin" })).rejects.toThrow(/Only the uploader/);
    await expect(unlockBatch(preview.id, "fixture-only-password", { id: "another-collector", role: "COLLECTOR" })).rejects.toThrow(/access/);
    await expect(unlockBatch(preview.id, "", user)).rejects.toThrow(/Enter a password/);
    expect(await client.productionImportIssue.count({ where: { importId: preview.id } })).toBe(0);
  });
  it("limits attempts durably per file and prevents concurrent duplicate unlocks", async () => {
    const { unlockBatch } = await import("./unlock");
    const preview = await service.stageFile(new File([new Uint8Array(encryptedFixture())], "limited.xlsx"), user);
    for (let attempt = 0; attempt < 5; attempt++) await expect(unlockBatch(preview.id, "wrong-fixture-value", user)).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    await expect(unlockBatch(preview.id, "fixture-only-password", user)).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(await client.productionImportIssue.count({ where: { importId: preview.id, code: "UNLOCK_ATTEMPT" } })).toBe(5);
    const concurrent = await service.stageFile(new File([new Uint8Array(encryptedFixture())], "concurrent.xlsx"), user);
    const results = await Promise.allSettled([unlockBatch(concurrent.id, "fixture-only-password", user), unlockBatch(concurrent.id, "fixture-only-password", user)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    expect(await client.productionImportRawRow.count({ where: { importId: concurrent.id } })).toBe(34);
  });
  it("resumes interrupted unlocks and keeps independent files and passwords separate", async () => {
    const { unlockBatch } = await import("./unlock");
    const first = await service.stageFile(new File([new Uint8Array(encryptedFixture("first-fixture-key"))], "first.xlsx"), user);
    const second = await service.stageFile(new File([new Uint8Array(encryptedFixture("second-fixture-key"))], "second.xlsx"), user);
    const controller = new AbortController(); controller.abort();
    await expect(unlockBatch(first.id, "first-fixture-key", user, controller.signal)).rejects.toMatchObject({ code: "REQUEST_INTERRUPTED" });
    expect((await service.getPreview(first.id, user)).status).toBe("PASSWORD_REQUIRED");
    expect((await service.getPreview(second.id, user)).status).toBe("PASSWORD_REQUIRED");
    expect((await unlockBatch(first.id, "first-fixture-key", user)).reconciliation?.passed).toBe(true);
    expect((await service.getPreview(second.id, user)).status).toBe("PASSWORD_REQUIRED");
    expect((await unlockBatch(second.id, "second-fixture-key", user)).reconciliation?.passed).toBe(true);
  });
  it("blocks malformed extraction atomically and enforces a user-wide attempt limit", async () => {
    const { unlockBatch } = await import("./unlock");
    const { encrypt } = await import("officecrypto-tool");
    const malformed = encrypt(Buffer.from("not a valid workbook zip"), { password: "fixture-only-key" });
    const preview = await service.stageFile(new File([new Uint8Array(malformed)], "corrupt-payload.xlsx"), user);
    await expect(unlockBatch(preview.id, "fixture-only-key", user)).rejects.toMatchObject({ code: "CORRUPTED_WORKBOOK" });
    expect(await client.productionImportRawRow.count({ where: { importId: preview.id } })).toBe(0);
    expect(Buffer.from((await client.productionImport.findUniqueOrThrow({ where: { id: preview.id } })).originalFile!).equals(Buffer.from(malformed))).toBe(true);
    const limited = await client.user.create({ data: { email: "unlock-rate@example.invalid", name: "Rate test", password: "unusable", role: "CEO" } });
    const limitedUser = { id: limited.id, role: "CEO" };
    const locked = await service.stageFile(new File([new Uint8Array(encryptedFixture())], "rate-new-file.xlsx"), limitedUser);
    await client.productionImportIssue.createMany({ data: Array.from({ length: 15 }, () => ({ importId: locked.id, level: "INFORMATIONAL", code: "UNLOCK_ATTEMPT", message: "Fixture attempt", rawData: { actorId: limited.id } })) });
    await expect(unlockBatch(locked.id, "fixture-only-password", limitedUser)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("reconciles compact large sources and blocks tampering before business writes", async () => {
    const book = XLSX.read(Buffer.from(await upload(67).arrayBuffer()), { type: "buffer" });
    book.Sheets.Notes.A10001 = { t: "s", v: "Last supporting source row" };
    book.Sheets.Notes["!ref"] = "A1:B10001";
    const preview = await reviewed(new File([new Uint8Array(XLSX.write(book, { type: "buffer", bookType: "xlsx" }))], "large-source.xlsx"));
    expect(preview.inspection.metadata?.largeWorkbook).toBe(true);
    expect(preview.reconciliation).toMatchObject({ passed: true, sourceRows: 10003, persistedRows: 10003 });
    const stored = await client.productionImportRawRow.findUniqueOrThrow({ where: { importId_sourceSheet_sourceRow: { importId: preview.id, sourceSheet: "Notes", sourceRow: 10001 } } });
    expect((stored.rawPayload as { encoding: string }).encoding).toBe("DEFLATE_RAW_ROW_V1");
    const payload = unpackRawRow(stored.rawPayload);
    payload.cells[0].value = "Tampered supporting data";
    await client.productionImportRawRow.update({ where: { id: stored.id }, data: { rawPayload: compressRawRow(payload) } });
    expect((await service.getPreview(preview.id, user)).reconciliation?.passed).toBe(false);
    await expect(commit(preview)).rejects.toThrow(/Source capture is incomplete/);
  }, 120000);

});
