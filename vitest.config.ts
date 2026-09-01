import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    globals: true,
    coverage: {
      provider: "v8",
      include: ["utils/**", "lib/**"],
      exclude: ["**/node_modules/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
