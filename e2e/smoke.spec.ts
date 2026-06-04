import { test, expect, type Page } from "@playwright/test";

// Mirrors the flows verified by hand via the preview browser: consent gate,
// editable graph (add/edit/remove), case create + interop export buttons, and
// the cross-mode recent-lookups control.

async function dismissConsent(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Permitted use" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: /Continue/i }).click();
    await expect(dialog).toBeHidden();
  }
}

test("consent gate shows on first run, then dismisses + persists", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Permitted use" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/Authorized use only/i);
  await dialog.getByRole("button", { name: /Continue/i }).click();
  await expect(dialog).toBeHidden();
  // Persisted: a reload does not show it again.
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Permitted use" })).toBeHidden();
});

test("graph mode: add, then remove a node", async ({ page }) => {
  await page.goto("/");
  await dismissConsent(page);

  await page.getByRole("tab", { name: /GRAPH/ }).first().click();

  const input = page.locator('input[placeholder^="add a node"]');
  await expect(input).toBeVisible();
  await input.fill("+14155552671");
  await page.getByRole("button", { name: /ADD NODE/ }).click();

  // The new node label is rendered in the SVG, and the legend counts it.
  await expect(page.locator("svg >> text=+14155552671")).toBeVisible();
  await expect(page.getByText(/PHONE \(1\)/)).toBeVisible();

  // Remove it via the editable graph's CLEAR control (a real button — robust),
  // and confirm the node disappears.
  await page.getByRole("button", { name: /^CLEAR/ }).click();
  await expect(page.locator("svg >> text=+14155552671")).toHaveCount(0);
});

test("cases: create a case + all interop export buttons render", async ({ page }) => {
  await page.goto("/");
  await dismissConsent(page);

  await page.getByRole("tab", { name: /CASES/ }).first().click();
  await page.locator('input[placeholder^="New case name"]').fill("E2E Smoke");
  await page.getByRole("button", { name: /^CREATE/ }).click();

  for (const label of ["JSON", "REPORT", "CSV", "STIX", "MALTEGO"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${label}$`) }).first()).toBeVisible();
  }

  // Clean up so the file-backed store isn't left with a test case.
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /WIPE ALL/ }).click();
});

test("header exposes the Recent lookups control", async ({ page }) => {
  await page.goto("/");
  await dismissConsent(page);
  await expect(page.getByRole("button", { name: /Recent lookups/i })).toBeVisible();
});
