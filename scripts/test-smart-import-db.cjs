const { randomBytes } = require("crypto");
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
require("@next/env").loadEnvConfig(process.cwd());

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to create an isolated test schema.");
  const schema = `opsview_smart_import_test_${randomBytes(8).toString("hex")}`;
  const url = new URL(process.env.DATABASE_URL);
  // A direct Neon connection keeps scratch-schema search_path settings out of
  // the application's transaction pool. The credentials/database stay the same.
  if (url.hostname.endsWith(".neon.tech")) url.hostname = url.hostname.replace("-pooler.", ".");
  url.searchParams.set("schema", schema);
  const env = { ...process.env, DATABASE_URL: url.toString(), SMART_IMPORT_TEST_DATABASE_URL: url.toString() };
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  let code = 1;
  const legacySchemaFile = path.resolve("prisma", `.${schema}.prisma`);
  try {
    const legacy = fs.readFileSync("prisma/schema.prisma", "utf8")
      .replace(/^\s*(?:parentImportId|parentImport|resumedImports|reconciliation|calculationRules|sourceProvenance)\s+.*$/gm, "")
      .replace(/^\s*@@index\(\[parentImportId\]\).*$/gm, "")
      .replace(/model ImportMappingTemplate \{[\s\S]*?\n\}/, "");
    fs.writeFileSync(legacySchemaFile, legacy);
    const setup = spawnSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--skip-generate", "--schema", legacySchemaFile], { env, stdio: "inherit" });
    if (setup.status !== 0) throw new Error("Isolated database setup failed.");
    const sql = fs.readFileSync("prisma/migrations/20261014000000_workbook_preservation/migration.sql", "utf8")
      .replace(/"(ProductionImport|CampaignMetricConfig|ImportMappingTemplate|User|ProductionMonitoring)"/g, (_, table) => `"${schema}"."${table}"`);
    await client.$transaction(async tx => {
      for (const statement of sql.split(";").filter(statement => statement.trim())) await tx.$executeRawUnsafe(statement);
    });
    console.log("Additive workbook preservation migration applied in the isolated schema.");
    const args = process.argv.includes("--e2e")
      ? [path.resolve("node_modules/@playwright/test/cli.js"), "test"]
      : [path.resolve("node_modules/vitest/vitest.mjs"), "run", "lib/smart-import/persistence.test.ts"];
    const tests = spawnSync(process.execPath, args, { env, stdio: "inherit" });
    code = tests.status ?? 1;
  } finally {
    if (!/^opsview_smart_import_test_[a-f0-9]{16}$/.test(schema) || url.searchParams.get("schema") !== schema) throw new Error("Refusing cleanup outside the generated scratch schema.");
    await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.$disconnect();
    if (legacySchemaFile !== path.resolve("prisma", `.${schema}.prisma`)) throw new Error("Unexpected scratch schema file path.");
    fs.rmSync(legacySchemaFile, { force: true });
  }
  process.exitCode = code;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
