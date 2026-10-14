import { defineConfig } from "@playwright/test";
const url = process.env.SMART_IMPORT_TEST_DATABASE_URL;
if (!url || !/^opsview_smart_import_test_[a-f0-9]{16}$/.test(new URL(url).searchParams.get("schema") ?? "")) throw new Error("Browser tests must run through the isolated schema runner.");
export default defineConfig({
  testDir: "./e2e", workers: 1, fullyParallel: false, timeout: 90000, expect: { timeout: 60000 },
  use: { baseURL: "http://localhost:3197", browserName: "chromium", headless: true },
  webServer: { command: "node node_modules/next/dist/bin/next start -p 3197", url: "http://localhost:3197/login", reuseExistingServer: false, timeout: 60000, env: { DATABASE_URL: url, NEXTAUTH_URL: "http://localhost:3197", NEXTAUTH_SECRET: "isolated-import-browser-test-secret" } },
});
