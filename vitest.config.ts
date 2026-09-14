import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // Default env is node (lib + route logic tests). Component render tests opt
    // into jsdom per-file via a `// @vitest-environment jsdom` comment.
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", ".claude"],
    // Hard guard: route handlers write through HV_DATA_DIR (audit log, cases,
    // API keys). Without a default here, any test that exercises a route
    // WITHOUT setting its own temp dir writes into the developer's real ./.data
    // — silently polluting their cases and audit log. Point the whole run at a
    // throwaway directory; suites that need isolation still set their own.
    env: { HV_DATA_DIR: path.resolve(import.meta.dirname, ".vitest-data") },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Everything that ships is gated at 100%: the pure logic layer, every
      // route handler, the proxy, and — since the last component was brought
      // under it — the whole component tree.
      //
      // Components used to be listed here one file at a time, which is a list
      // that silently omits whatever nobody remembered to add: a new panel with
      // a full test suite still sat outside the gate, and its uncovered branch
      // went unreported because the file was never measured. A glob cannot
      // forget. A new component now either ships with tests or fails the build,
      // which is the same bargain the lib layer has always had.
      include: [
        "src/lib/**/*.ts",
        // The highest-risk code in the repo: every outbound fetch lives in a
        // route handler, and the CSRF + auth gate lives in proxy.ts. These were
        // outside the gate until 1.4 — tests existed, but nothing enforced that
        // they covered the error paths.
        "src/app/api/**/route.ts",
        "src/proxy.ts",
        "src/components/**/*.tsx",
      ],
      exclude: ["src/lib/types.ts"],
      // New gated code must ship with tests (or an explicit `/* v8 ignore */` for
      // defensive branches) or this fails the build.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
