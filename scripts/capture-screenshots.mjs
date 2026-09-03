#!/usr/bin/env node
/**
 * Capture README screenshots from a running dev server using the system Chrome.
 *
 * Every shot is taken at ONE fixed viewport (1440x900 at 2x device pixels), so
 * every PNG comes out the same 2880x1800 and the README grid stays even. That is
 * the whole point of the rewrite: the old set mixed full-viewport shots with
 * element crops of wildly different heights, which made the table look ragged.
 * A card taller than the viewport is scrolled under the sticky header and cropped
 * at the fold, which reads as "there is more below".
 *
 * The six views here are all offline-deterministic (the phone flow is computed
 * locally, the command palette and bulk table need no network), so they render
 * the same on any machine and never show an upstream error.
 *
 * Prereq: dev server running on http://localhost:3000  (npm run dev)
 * Run:    node scripts/capture-screenshots.mjs
 */

import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "docs", "screenshots");
const BASE = "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const WIDTH = 1440;
const HEIGHT = 900;
const DPR = 2; // retina-quality output -> 2880x1800 PNGs
const HEADER = 76; // sticky top bar (60px) plus a little breathing room
const PHONE = "/?q=%2B14155552671"; // +14155552671, fully offline

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true, // puppeteer 23+ dropped the "new" string; `true` is now the new headless mode
  defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR },
  args: ["--hide-scrollbars", "--no-sandbox", "--disable-gpu"],
});

// A fresh page with the consent accepted and the boot sequence marked as seen,
// so neither the permitted-use modal nor the intro animation overlays a shot.
// evaluateOnNewDocument runs before any page script, so both gates read "done".
async function newPage() {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem("hv-consent-v1", "1");
      localStorage.setItem("hv-booted-v1", "1");
    } catch {
      /* ignore */
    }
  });
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR });
  return page;
}

// Scroll the terminal-card whose text contains `needle` so its top sits just
// below the sticky header, then settle. Returns false if no such card exists.
async function frameCard(page, needle) {
  const found = await page.evaluate(
    (text, header) => {
      const card = Array.from(document.querySelectorAll("div.terminal-card")).find((d) =>
        (d.textContent || "").includes(text),
      );
      if (!card) return false;
      const y = card.getBoundingClientRect().top + window.scrollY - header;
      window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
      return true;
    },
    needle,
    HEADER,
  );
  await sleep(500);
  return found;
}

// The sticky header is translucent (55% alpha), so on a scrolled shot the card
// behind it bleeds through as faint text. Force it opaque with the same hue right
// before the capture — visually identical over the dark page, but nothing shows
// through. Harmless on the unscrolled shots.
async function opaqueHeader(page) {
  await page.evaluate(() => {
    const h = document.querySelector("header");
    if (h) h.style.setProperty("background-color", "rgb(10, 16, 28)", "important");
  });
}

async function shot(file, { url, setup }) {
  const page = await newPage();
  console.log(`→ ${url}  (${file})`);
  await page.goto(BASE + url, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1600); // let Framer Motion + any client compute settle
  if (setup) await setup(page);
  await opaqueHeader(page);
  await page.screenshot({ path: join(OUT, file), type: "png" }); // viewport, uniform size
  await page.close();
  console.log(`  ✓ ${file}`);
}

// 1. Phone dashboard — lead with the result card (number, threat score, at a glance).
await shot("phone-results.png", {
  url: PHONE,
  setup: async (page) => {
    await frameCard(page, "THREAT SCORE");
  },
});

// 2. OSINT pivot matrix — the categorised reverse-lookup / messaging / search links.
await shot("osint-pivots.png", {
  url: PHONE,
  setup: async (page) => {
    await frameCard(page, "[ OSINT PIVOT MATRIX ]");
  },
});

// 3. Breach + infostealer — the unified breach view over the free one-click lookups.
await shot("breach-intel.png", {
  url: PHONE,
  setup: async (page) => {
    (await frameCard(page, "UNIFIED BREACH VIEW")) ||
      (await frameCard(page, "CREDENTIAL BREACH SEARCH"));
  },
});

// 4. Number intelligence — the offline anatomy / country breakdown for the number.
await shot("number-intel.png", {
  url: PHONE,
  setup: async (page) => {
    (await frameCard(page, "[ NUMBER ANATOMY ]")) ||
      (await frameCard(page, "[ COUNTRY INTELLIGENCE ]"));
  },
});

// 5. Command palette — one keystroke to reach any of the eleven modes.
await shot("command-palette.png", {
  url: "/",
  setup: async (page) => {
    await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Open command palette"]');
      btn?.click();
    });
    await sleep(600);
  },
});

// 6. Bulk mode — score a batch of numbers offline, then export the table.
await shot("bulk-mode.png", {
  url: "/",
  setup: async (page) => {
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll("button")).find((b) =>
        /^\s*[^\w]*BULK\b/i.test(b.textContent || ""),
      );
      tab?.click();
    });
    await sleep(500);
    const numbers = [
      "+14155552671",
      "+442079460958",
      "+919876543210",
      "+81312345678",
      "+4915112345678",
    ].join("\n");
    await page.evaluate((value) => {
      const box = document.querySelector("textarea");
      if (!box) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter.call(box, value);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    }, numbers);
    await sleep(400);
    await page.evaluate(() => {
      const run = Array.from(document.querySelectorAll("button")).find((b) =>
        /RUN BULK/i.test(b.textContent || ""),
      );
      run?.click();
    });
    await sleep(1200);
  },
});

await browser.close();
console.log("\nAll done. Output in", OUT);
