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
 * Six of the seven views are offline-deterministic (the phone flow, its AI risk
 * read-out and the command palette are all computed locally), so they render the
 * same on any machine and never show an upstream error. Bulk is the exception:
 * it runs the real lookup for every row, so that one shot needs a network and
 * waits for the table to fill.
 *
 * Prereq: a dev server running against an EMPTY state directory, e.g.
 *
 *   HV_DATA_DIR=/tmp/shot-state node node_modules/next/dist/bin/next dev -p 3987
 *   SCREENSHOT_BASE=http://localhost:3987 node scripts/capture-screenshots.mjs
 *
 * The state dir matters: a saved AI provider key makes the AI Analyst panel
 * report "ready (key saved on this machine)" instead of the first-run setup
 * every reader of the README will actually see. Pointing HV_DATA_DIR at a scratch
 * directory captures the out-of-the-box state and leaves your own keys alone.
 * SCREENSHOT_BASE defaults to http://localhost:3000.
 */

import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "docs", "screenshots");
// Defaults to the dev server's usual port; override with SCREENSHOT_BASE when it
// runs elsewhere (e.g. a second server on another port so the primary one is
// left alone).
const BASE = process.env.SCREENSHOT_BASE || "http://localhost:3000";
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
      // First-run orientation card. Left on, it pushes every shot down by ~390px
      // and puts a one-time explainer where the product should be.
      localStorage.setItem("hv-tour-seen-v1", "1");
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

// The dev server injects its own floating dev-tools button (a <nextjs-portal>
// custom element pinned to the bottom-left). It is not part of the app, but it
// sat in the corner of every previously captured shot. Hide the host element so
// a dev-server capture shows only the product.
async function hideDevOverlay(page) {
  await page.addStyleTag({
    content: "nextjs-portal,[data-nextjs-dev-tools-button]{display:none !important}",
  });
}

// frameCard returns false when a panel has been renamed, and a silent false
// leaves the page at scroll 0 — which is how the lead shot ended up showing an
// empty input box instead of a result. Every caller goes through this instead:
// it takes the alternatives in order and throws when none of them exist, so a
// renamed panel breaks the capture run rather than the README.
async function mustFrame(page, ...needles) {
  for (const needle of needles) {
    if (await frameCard(page, needle)) return needle;
  }
  throw new Error(
    `no terminal-card matched ${needles.map((n) => JSON.stringify(n)).join(" or ")} — ` +
      `the panel was probably renamed; update the needle in this script`,
  );
}

// Same reasoning as mustFrame, for buttons: a renamed control used to leave the
// page untouched and the shot silently wrong (the bulk table never ran because
// "RUN BULK" had become "Run").
async function clickButton(page, match, what) {
  const hit = await page.evaluate((src) => {
    const test = new Function("return " + src)();
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      test((b.textContent || "").trim().replace(/\s+/g, " ")),
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, match.toString());
  if (!hit) throw new Error(`could not find ${what} — it was probably renamed`);
}

async function shot(file, { url, setup }) {
  const page = await newPage();
  console.log(`→ ${url}  (${file})`);
  await page.goto(BASE + url, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1600); // let Framer Motion + any client compute settle
  if (setup) await setup(page);
  await hideDevOverlay(page);
  await opaqueHeader(page);
  await page.screenshot({ path: join(OUT, file), type: "png" }); // viewport, uniform size
  await page.close();
  console.log(`  ✓ ${file}`);
}

// 1. Phone dashboard — lead with the result card itself: the number, its
//    validity, the abuse/exposure scores, and the at-a-glance grid under it.
await shot("phone-results.png", {
  url: PHONE,
  setup: async (page) => {
    await mustFrame(page, "Abuse Risk");
  },
});

// 2. OSINT pivot matrix — the categorised reverse-lookup / messaging / search links.
await shot("osint-pivots.png", {
  url: PHONE,
  setup: async (page) => {
    await mustFrame(page, "[ OSINT PIVOT MATRIX ]");
  },
});

// 3. Breach + infostealer — the unified breach view over the free one-click lookups.
await shot("breach-intel.png", {
  url: PHONE,
  setup: async (page) => {
    await mustFrame(page, "UNIFIED BREACH VIEW", "CREDENTIAL BREACH SEARCH");
  },
});

// 4. Number intelligence — the offline anatomy / country breakdown for the number.
await shot("number-intel.png", {
  url: PHONE,
  setup: async (page) => {
    await mustFrame(page, "[ NUMBER ANATOMY ]", "[ COUNTRY INTELLIGENCE ]");
  },
});

// 5. AI Analysis — the explainable, grounded risk read-out and the optional,
//    opt-in AI Analyst below it. Computed locally, so it renders offline.
await shot("ai-analysis.png", {
  url: PHONE,
  setup: async (page) => {
    await mustFrame(page, "AI Analysis");
  },
});

// 6. Command palette — one keystroke to reach any of the eleven modes.
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

// 7. Bulk mode — triage a batch of numbers in one pass, then export the table.
//    A bulk run does the real per-row lookup, so this one waits for the table
//    to fill rather than guessing at a duration.
await shot("bulk-mode.png", {
  url: "/",
  setup: async (page) => {
    await clickButton(page, (t) => /^[^\w]*BULK\b/i.test(t), "the BULK tab");
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
      if (!box) throw new Error("bulk textarea not found");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter.call(box, value);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    }, numbers);
    await sleep(400);
    await clickButton(page, (t) => t === "Run", "the bulk Run button");
    // Every row has to come back before the shot, or the table is half empty.
    await page.waitForFunction(
      (rows) => document.querySelectorAll("table tbody tr").length >= rows,
      { timeout: 60000 },
      5,
    );
    await sleep(600);
  },
});

await browser.close();
console.log("\nAll done. Output in", OUT);
