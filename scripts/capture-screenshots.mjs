#!/usr/bin/env node
/**
 * Capture README screenshots from a running dev server using the system Chrome.
 *
 * Prereq: dev server running on http://localhost:3000  (npm run dev)
 *
 * Run: node scripts/capture-screenshots.mjs
 */

import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "docs", "screenshots");
const BASE = "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const WIDTH = 1400;
const HEIGHT = 900;
const DPR = 2; // retina-quality output

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR },
  args: ["--hide-scrollbars", "--no-sandbox", "--disable-gpu"],
});

async function capture(url, file, opts = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR });
  console.log(`→ ${url}  (${file})`);
  await page.goto(BASE + url, { waitUntil: "networkidle2", timeout: 30000 });
  // Let Framer Motion + Hudson Rock fetch settle
  await new Promise((r) => setTimeout(r, 1500));

  if (opts.action) await opts.action(page);

  if (opts.selector) {
    const el = await page.$(opts.selector);
    if (!el) throw new Error(`selector not found: ${opts.selector}`);
    await el.scrollIntoView();
    await new Promise((r) => setTimeout(r, 400));
    // Capture just that element with some padding around it
    await el.screenshot({ path: join(OUT, file), type: "png" });
  } else if (opts.fullPage) {
    await page.screenshot({ path: join(OUT, file), type: "png", fullPage: true });
  } else {
    await page.screenshot({ path: join(OUT, file), type: "png" });
  }
  await page.close();
  console.log(`  ✓ ${file}`);
}

// 1. Hero result-page screenshot — header + threat score + first card
await capture("/?q=%2B14155552671", "phone-results.png", {
  action: async (page) => {
    // Scroll a touch so the header doesn't dominate the frame
    await page.evaluate(() => window.scrollTo(0, 0));
  },
});

// 2. Dork Generator — find the panel and screenshot just it
await capture("/?q=%2B14155552671", "dork-generator.png", {
  selector: "section, [data-testid='dork-generator'], div.terminal-card", // fallback chain
  action: async (page) => {
    // Locate the Dork Generator card by its header text
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("div.terminal-card"))
        .find((d) => /DORK GENERATOR/.test(d.textContent || ""));
      if (el) el.setAttribute("data-shot", "1");
    });
  },
  // override selector to use our marker
  // (puppeteer takes the most recent opts.selector, so set it below in a second pass)
});

// 3. OSINT Pivots — screenshot the pivot card
await capture("/?q=%2B14155552671", "osint-pivots.png", {
  action: async (page) => {
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("div.terminal-card"))
        .find((d) => /OSINT PIVOT MATRIX/.test(d.textContent || ""));
      if (el) {
        el.setAttribute("data-shot", "2");
        el.scrollIntoView({ behavior: "instant", block: "start" });
        window.scrollBy(0, -50);
      }
    });
    await new Promise((r) => setTimeout(r, 400));
  },
});

// 4. Bulk mode — click the BULK tab in TARGET ACQUISITION
await capture("/", "bulk-mode.png", {
  action: async (page) => {
    await page.evaluate(() => {
      // wait for boot sequence to finish — clicking "skip" if present
      const skip = Array.from(document.querySelectorAll("button"))
        .find((b) => /SKIP/i.test(b.textContent || ""));
      skip?.click();
    });
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button"))
        .find((b) => /BULK/i.test(b.textContent || ""));
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 600));
  },
});

await browser.close();

// Replace screenshots #2 and #3 with element-only crops via a second pass
const browser2 = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR },
  args: ["--hide-scrollbars", "--no-sandbox", "--disable-gpu"],
});

async function captureCardByText(text, file) {
  const page = await browser2.newPage();
  await page.setViewport({ width: WIDTH, height: 3000, deviceScaleFactor: DPR });
  await page.goto(BASE + "/?q=%2B14155552671", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));
  const handle = await page.evaluateHandle((needle) => {
    return Array.from(document.querySelectorAll("div.terminal-card"))
      .find((d) => (d.textContent || "").includes(needle));
  }, text);
  const el = handle.asElement();
  if (!el) throw new Error(`no card with text "${text}"`);
  await el.scrollIntoView();
  await new Promise((r) => setTimeout(r, 400));
  await el.screenshot({ path: join(OUT, file), type: "png" });
  await page.close();
  console.log(`  ✓ ${file} (element crop)`);
}

await captureCardByText("DORK GENERATOR", "dork-generator.png");
await captureCardByText("OSINT PIVOT MATRIX", "osint-pivots.png");

await browser2.close();
console.log("\nAll done. Output in", OUT);
