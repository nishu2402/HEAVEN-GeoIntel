import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Default env is node (lib + route logic tests). Component render tests opt
    // into jsdom per-file via a `// @vitest-environment jsdom` comment.
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", ".claude"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/types.ts"],
      // The pure logic layer is fully covered; keep it that way. New lib code must
      // ship with tests (or an explicit `/* v8 ignore */` for defensive branches).
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
