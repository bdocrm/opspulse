import { test, expect, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import * as XLSX from "xlsx";
import { augustFixture, encryptedFixture } from "../lib/smart-import/fixtures";

const url = process.env.SMART_IMPORT_TEST_DATABASE_URL!;
const client = new PrismaClient({ datasources: { db: { url } } });
const endpoint = "/api/production-monitoring/smart-import";
async function login(context: BrowserContext, email = "browser-import@example.invalid") {
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, email, password: "isolated-browser-test", callbackUrl: "/production-monitoring/smart-import", json: "true" } });
  expect((await (await context.request.get("/api/auth/session")).json()).user?.email).toBe(email);
}
test.beforeAll(async () => {
  const password = await bcrypt.hash("isolated-browser-test", 4);
  await client.user.createMany({ data: [{ email: "browser-import@example.invalid", name: "Import browser test", password, role: "CEO" }, { email: "browser-collector@example.invalid", name: "Unassigned collector", password, role: "COLLECTOR" }], skipDuplicates: true });
  for (const name of ["RBSC", ...Array.from({ length: 29 }, (_, index) => `Campaign ${index + 3}`)]) await client.campaign.upsert({ where: { normalizedName: name.toUpperCase() }, update: {}, create: { campaignName: name, normalizedName: name.toUpperCase(), goalType: "sales", monthlyGoal: 0, kpiMetric: "count" } });
});
test.afterAll(async () => { await client.$disconnect(); });

test("rejects unauthenticated uploads and shows login for the protected page", async ({ page }) => {
  const response = await page.request.post(endpoint, { maxRedirects: 0, multipart: { file: { name: "fixture.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: augustFixture() } } });
  expect([401, 302, 307]).toContain(response.status());
  expect(await client.productionImport.count()).toBe(0);
  await page.goto("/production-monitoring/smart-import");
  await expect(page).toHaveURL(/\/login/);
});
test("browser discovers all August rows and exposes audit, mapping and raw remarks", async ({ page, context }) => {
  await login(context);
  await page.goto("/production-monitoring/smart-import");
  await page.getByLabel("Productivity file").setInputFiles({ name: "AUGUST PROD(1).xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: augustFixture() });
  await page.getByRole("button", { name: "Inspect file", exact: true }).click();
  await expect(page.getByText("Raw extraction:")).toContainText("VERIFIED");
  await expect(page.getByText("Detail records: 31", { exact: true })).toBeVisible();
  await expect(page.getByText("Source cells: 514", { exact: true })).toBeVisible();
  await expect(page.getByText("Stored cells: 514", { exact: true })).toBeVisible();
  await page.getByText("Inspect any captured source row", { exact: true }).click();
  await page.getByLabel("Source row", { exact: true }).fill("4");
  await page.getByRole("button", { name: "View source", exact: true }).click();
  await expect(page.locator("pre").filter({ hasText: '"Q4"' })).toContainText("FINAL");
  await page.getByRole("button", { name: "Confirm KPI configurations & revalidate" }).click();
  await expect(page.getByRole("button", { name: "Import selected records (31)" })).toBeEnabled();
  await page.getByRole("button", { name: "Import selected records (31)" }).click();
  await page.getByRole("button", { name: "Confirm import", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import Completed", exact: true })).toBeVisible();
  const id = new URL(page.url()).searchParams.get("batch");
  const report = await (await page.request.get(`${endpoint}/${id}?format=report`)).json();
  expect(report.reconciliation).toMatchObject({ passed: true, committedRecords: 31, sourceNonEmptyCells: 514, persistedRawNonEmptyCells: 514 });
  const production = await (await page.request.get(`/api/production-monitoring?month=8&year=2026&importBatchId=${id}&limit=100`)).json();
  expect(production.records).toHaveLength(31);
  expect(production.records.every((row: { source: { batchId: string; sheet: string; row: number } }) => row.source.batchId === id && row.source.sheet === "Sheet1" && row.source.row >= 4)).toBe(true);
  await page.goto("/production-monitoring");
  await page.getByLabel("Import batch", { exact: true }).fill(id!);
  await page.getByLabel("Data source", { exact: true }).selectOption("SMART_IMPORT");
  await page.getByRole("button", { name: "Inspect mtd source", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toContainText("AUGUST PROD(1).xlsx");
  await expect(page.getByRole("dialog")).toContainText("Sheet1");
  await expect(page.getByRole("dialog")).toContainText(id!);
  const again = await (await page.request.post(endpoint, { multipart: { file: { name: "AUGUST PROD(1).xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: augustFixture() } } })).json();
  const repeated = await page.request.post(`${endpoint}/${again.id}`, { data: { action: "commit", previewHash: again.previewHash, selectedRows: [] } });
  expect(repeated.status()).toBe(200);
  expect(await repeated.json()).toMatchObject({ inserted: 0, updated: 0, duplicates: 31 });
});
test("in-app password unlock validates errors, preserves the encrypted source, and resumes review", async ({ page, context }) => {
  await login(context);
  await page.goto("/production-monitoring/smart-import");
  const source = encryptedFixture();
  await page.getByLabel("Productivity file").setInputFiles({ name: "encrypted-fixture.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: source });
  await page.getByRole("button", { name: "Inspect file", exact: true }).click();
  await expect(page.getByLabel("Workbook password", { exact: true })).toBeVisible();
  await expect(page.getByText("Worksheets, rows, columns, and source-cell counts: Pending until extraction succeeds.")).toBeVisible();
  const id = new URL(page.url()).searchParams.get("batch");
  await page.getByLabel("Workbook password", { exact: true }).fill("incorrect-fixture-password");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(page.getByLabel("Workbook password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Unlock & Process Workbook", exact: true }).click();
  await expect(page.getByRole("alert").first()).toContainText("That password did not unlock");
  await expect(page.getByLabel("Workbook password", { exact: true })).toHaveValue("");
  await page.getByLabel("Workbook password", { exact: true }).fill("fixture-only-password");
  await page.getByRole("button", { name: "Unlock & Process Workbook", exact: true }).click();
  await expect(page.getByText("Raw extraction:")).toContainText("VERIFIED");
  const preview = await (await page.request.get(`${endpoint}/${id}`)).json();
  expect(preview.stages).toMatchObject({ access: "DECRYPTED", extraction: "EXTRACTION_COMPLETED" });
  expect(preview.reconciliation).toMatchObject({ passed: true, sourceNonEmptyCells: 514, persistedRawNonEmptyCells: 514 });
  expect((await (await page.request.get(`${endpoint}/${id}?format=source`)).body()).equals(source)).toBe(true);
  expect(preview.result).toBeNull();
  await page.getByRole("button", { name: /Complete import.*skip duplicates/ }).click();
  await page.getByRole("button", { name: "Confirm import", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import Completed", exact: true })).toBeVisible();
  const completed = await (await page.request.get(`${endpoint}/${id}`)).json();
  expect(completed.stages.business).toBe("IMPORT_COMPLETED");
  expect(completed.result).toMatchObject({ inserted: 0, updated: 0, duplicates: 31 });
});
test("multi-file upload unlocks independent workbooks with different passwords", async ({ page, context }) => {
  await login(context);
  await page.goto("/production-monitoring/smart-import");
  await page.getByLabel("Productivity file").setInputFiles([
    { name: "first-locked.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: encryptedFixture("first-fixture-key") },
    { name: "second-locked.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: encryptedFixture("second-fixture-key") },
  ]);
  await page.getByRole("button", { name: "Inspect file", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Uploaded workbooks" })).toBeVisible();
  await page.getByLabel("Workbook password", { exact: true }).fill("second-fixture-key");
  await page.getByRole("button", { name: "Unlock & Process Workbook", exact: true }).click();
  await expect(page.getByText("Raw extraction:")).toContainText("VERIFIED");
  await page.getByRole("button", { name: "Open workbook", exact: true }).first().click();
  await expect(page.getByLabel("Workbook password", { exact: true })).toBeVisible();
  await page.getByLabel("Workbook password", { exact: true }).fill("first-fixture-key");
  await page.getByRole("button", { name: "Unlock & Process Workbook", exact: true }).click();
  await expect(page.getByText("Raw extraction:")).toContainText("VERIFIED");
});
test("unassigned collector retains source but cannot normalize inaccessible campaigns", async ({ page, context }) => {
  await login(context, "browser-collector@example.invalid");
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Campaign", "Goal Type", "MTD", "DATE"], ["RBSC", "Count", 1, "September 1, 2026"]]), "Data");
  const response = await page.request.post(endpoint, { multipart: { file: { name: "restricted.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) } } });
  const preview = await response.json();
  expect(response.status()).toBe(201);
  expect(preview.records[0].campaignId).toBeNull();
  const commit = await page.request.post(`${endpoint}/${preview.id}`, { data: { action: "commit", previewHash: preview.previewHash, selectedRows: [preview.records[0].rowKey] } });
  expect(commit.status()).toBe(422);
  expect((await (await page.request.get(`${endpoint}/${preview.id}`)).json()).reconciliation.passed).toBe(true);
});

test("unmapped workbooks display paginated Excel cells, hidden sheets, formulas and header selection", async ({ page, context }) => {
  await login(context);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), "HOME");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Agent", "Value", "Region"], ...Array.from({ length: 65 }, (_, index) => [`Agent ${index + 1}`, index, "Fixture region"])]), "Data");
  const notes = XLSX.utils.aoa_to_sheet([["Supporting formula", 42]]);
  notes.B1 = { t: "n", v: 42, f: "6*7" };
  XLSX.utils.book_append_sheet(book, notes, "Hidden notes");
  book.Workbook = { Sheets: [{ name: "HOME", Hidden: 0 }, { name: "Data", Hidden: 0 }, { name: "Hidden notes", Hidden: 1 }] };
  const staged = await (await page.request.post(endpoint, { multipart: { file: { name: "unmapped-dashboard.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) } } })).json();
  expect(staged.records).toHaveLength(0);
  expect(staged.stages.business).toBe("READY_FOR_VALIDATION");
  await page.goto(`/production-monitoring/smart-import?batch=${staged.id}`);
  await expect(page.getByRole("heading", { name: "Extracted Excel Preview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bulk Import Preview", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Preview worksheet", { exact: true })).toHaveValue("Data");
  const table = page.getByRole("table", { name: "Extracted worksheet rows" });
  await expect(table).toContainText("Agent 1");
  await expect(table.locator("tbody tr")).toHaveCount(50);
  await page.getByLabel("Go to worksheet row", { exact: true }).fill("61");
  await page.getByRole("button", { name: "Go to row", exact: true }).click();
  await expect(table).toContainText("Agent 60");
  await expect(table.locator("tbody tr")).toHaveCount(16);
  await page.getByLabel("Preview worksheet", { exact: true }).selectOption("Hidden notes");
  await expect(table).toContainText("Supporting formula");
  await page.getByRole("checkbox", { name: "Show formula expressions" }).check();
  await expect(table).toContainText("=6*7");
  await page.getByLabel("Preview worksheet", { exact: true }).selectOption("Data");
  await page.getByRole("button", { name: "Use worksheet row 1 as header", exact: true }).click();
  await expect(page.getByText(/Selected header: row 1/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply mappings & revalidate", exact: true })).toBeVisible();
  expect((await (await page.request.get(`${endpoint}/${staged.id}`)).json()).result).toBeNull();
});
