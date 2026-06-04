import { defineConfig, devices } from "@playwright/test";

// E2E runs against a PRODUCTION build (next start) for speed + no per-route
// dev compilation flakiness. Run `npm run build` first (the webServer just
// boots the existing build). Browser: Chromium (installed via
// `npx playwright install chromium`).
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3210",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node node_modules/next/dist/bin/next start -p 3210 -H 127.0.0.1",
    url: "http://127.0.0.1:3210/api/health",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
