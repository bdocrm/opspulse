const path = require("path");
const { spawnSync } = require("child_process");
// A live Next dev server owns .next and can hold Prisma's Windows engine open.
// Build into a separate directory and reuse the already-generated schema client.
const result = spawnSync(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "build"], {
  env: { ...process.env, OPSVIEW_BUILD_DIR: ".next-import-test" }, stdio: "inherit",
});
process.exitCode = result.status ?? 1;
