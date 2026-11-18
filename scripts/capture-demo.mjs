#!/usr/bin/env node
/**
 * Record the README "See It In Action" demo (docs/assets/demo.gif) from a
 * running dev server, using the system Chrome. This is the moving companion to
 * capture-screenshots.mjs: same browser, same offline test number, same clean
 * frame (dev overlay hidden, sticky header forced opaque), captured at 2x so the
 * text stays sharp, and it stops on each panel of the dossier in turn.
 *
 * The take is one real session on the fictional number +14155552671, which is
 * computed entirely offline, so it records the same on any machine and never
 * captures an upstream error:
 *   1. open the command palette on the home screen, hold briefly,
 *   2. run the lookup, then stop on the result card and on number anatomy,
 *      the OSINT pivots, the breach view and the AI risk read-out in turn.
 *
 * Prereq: a dev server running against an EMPTY state directory, exactly as for
 * the screenshots, so the AI Analyst shows its first-run setup rather than a key
 * saved on your machine:
 *
 *   HV_DATA_DIR=/tmp/shot-state node node_modules/next/dist/bin/next dev -p 3987
 *   SCREENSHOT_BASE=http://localhost:3987 npm run demo
 *
 * SCREENSHOT_BASE (or DEMO_BASE) defaults to http://localhost:3000. The frames
 * are written to a scratch directory and assembled into docs/assets/demo.gif
 * with ffmpeg. If ffmpeg is not installed the frames are kept and the exact
 * assemble command is printed, so nothing is lost.
 */

import puppeteer from "puppeteer-core";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "docs", "assets");
const GIF = join(OUT, "demo.gif");

const BASE = process.env.DEMO_BASE || process.env.SCREENSHOT_BASE || "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Captured at 2x like the screenshots so text renders sharp, then scaled down on
// encode: a large downscale from a retina source is what keeps the edges crisp.
// A GIF still pays for every pixel and frame, so the output is a moderate 900px
// wide at 10 frames a second, flatter than the full-resolution screenshots.
const WIDTH = 1280;
const HEIGHT = 800;
const DPR = 2;
const FPS = 10;
const OUT_WIDTH = 900;
const COLORS = 256;
const HEADER = 76;
const PHONE = "/?q=%2B14155552671"; // +14155552671, fully offline

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// DEMO_FRAMES_DIR keeps the raw PNG frames in a known directory and leaves them
// in place at the end, so the GIF can be re-encoded without re-recording.
const KEEP = Boolean(process.env.DEMO_FRAMES_DIR);
const frames = process.env.DEMO_FRAMES_DIR || (await mkdtemp(join(tmpdir(), "heaven-demo-")));
await mkdir(frames, { recursive: true });
await mkdir(OUT, { recursive: true });

let frameIndex = 0;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR },
  args: ["--hide-scrollbars", "--no-sandbox", "--disable-gpu"],
});

// Same gates as the screenshot run: consent accepted, boot animation and the
// first-run tour marked as seen, so none of them overlays the take.
async function newPage() {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem("hv-consent-v1", "1");
      localStorage.setItem("hv-booted-v1", "1");
      localStorage.setItem("hv-tour-seen-v1", "1");
    } catch {
      /* ignore */
    }
  });
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR });
  return page;
}

async function hideDevOverlay(page) {
  await page.addStyleTag({
    content: "nextjs-portal,[data-nextjs-dev-tools-button]{display:none !important}",
  });
}

async function opaqueHeader(page) {
  await page.evaluate(() => {
    const h = document.querySelector("header");
    if (h) h.style.setProperty("background-color", "rgb(10, 16, 28)", "important");
  });
}

async function grab(page) {
  await opaqueHeader(page);
  const file = join(frames, `f-${String(frameIndex++).padStart(4, "0")}.png`);
  await page.screenshot({ path: file, type: "png" });
}

// Hold on the current view for roughly `seconds`, one frame at a time, so the
// viewer has time to read a panel before the pan moves on.
async function hold(page, seconds) {
  const n = Math.max(1, Math.round(seconds * FPS));
  for (let i = 0; i < n; i++) {
    await grab(page);
    await sleep(1000 / FPS);
  }
}

// Scroll the terminal-card whose text contains `needle` so its top sits just
// below the sticky header. Returns false when no such card exists, so a renamed
// panel is skipped rather than aborting the take.
async function frameCard(page, needle) {
  return page.evaluate(
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
}

// Scene 1: the command palette on the home screen. Soft-skipped if the control
// is not found, so a renamed button never aborts the whole recording.
const home = await newPage();
await home.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 30000 });
await sleep(1600);
await hideDevOverlay(home);
const openedPalette = await home.evaluate(() => {
  const btn = document.querySelector('button[aria-label="Open command palette"]');
  if (!btn) return false;
  btn.click();
  return true;
});
if (openedPalette) {
  await sleep(600);
  await hold(home, 1.6);
} else {
  console.warn("! command palette button not found; skipping that scene");
  await hold(home, 0.8);
}
await home.close();

// Scene 2: the lookup, then a stop on each panel in turn. Holding on a panel
// (rather than scrolling through it) is what keeps the GIF small: the encoder
// stores a still frame as almost nothing, so most of the file is the handful of
// jumps between panels. It also gives the viewer time to read each one.
const page = await newPage();
console.log(`-> ${BASE + PHONE}`);
await page.goto(BASE + PHONE, { waitUntil: "networkidle2", timeout: 30000 });
await sleep(1800); // let the result card render and framer-motion settle
await hideDevOverlay(page);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await hold(page, 1.3); // the result card at the top

// Each stop is a terminal-card matched by the text it contains. The fallbacks
// cover the panels the app renders under more than one heading.
const panels = [
  ["[ NUMBER ANATOMY ]", "[ COUNTRY INTELLIGENCE ]"],
  ["[ OSINT PIVOT MATRIX ]"],
  ["UNIFIED BREACH VIEW", "CREDENTIAL BREACH SEARCH"],
  ["AI Analysis"],
];
for (const needles of panels) {
  for (const needle of needles) {
    if (await frameCard(page, needle)) break;
  }
  await sleep(350); // let the scroll settle before the hold
  await hold(page, 1.3);
}
await page.close();

await browser.close();

if (frameIndex === 0) {
  console.error("No frames were captured. Is the dev server running at " + BASE + " ?");
  await rm(frames, { recursive: true, force: true });
  process.exit(1);
}

// Assemble the GIF. palettegen/paletteuse is the standard two-pass path that
// keeps the neon palette clean instead of banded.
const filter =
  `scale=${OUT_WIDTH}:-1:flags=lanczos,split[s0][s1];` +
  `[s0]palettegen=max_colors=${COLORS}:stats_mode=full[p];` +
  `[s1][p]paletteuse=dither=none`;
const args = [
  "-y",
  "-framerate",
  String(FPS),
  "-i",
  join(frames, "f-%04d.png"),
  "-vf",
  filter,
  "-loop",
  "0",
  GIF,
];

const ffmpeg = spawnSync("ffmpeg", args, { stdio: "inherit" });

if (ffmpeg.error || ffmpeg.status !== 0) {
  // Single-quote every argument so the printed command is safe to paste: the
  // filtergraph contains ; [ ] and , which the shell would otherwise read.
  const quoted = args.map((a) => `'${a}'`).join(" ");
  console.warn(
    "\n! ffmpeg is not available, so the GIF was not assembled. The " +
      frameIndex +
      " captured frames are kept at:\n    " +
      frames +
      "\n\n  Install it with:  brew install ffmpeg\n" +
      "  Then either re-run `npm run demo`, or encode these exact frames with:\n    ffmpeg " +
      quoted +
      "\n",
  );
  process.exit(ffmpeg.status ?? 1);
}

if (!KEEP) await rm(frames, { recursive: true, force: true });
const mb = (bytes) => (bytes / 1048576).toFixed(1) + " MB";
console.log("\nWrote " + GIF + " from " + frameIndex + " frames (" + mb(statSync(GIF).size) + ").");

// Shrink with gifsicle when it is on the PATH. ffmpeg's gif muxer does only
// light inter-frame work, so the still holds above cost far more than they
// should. The UI animates faintly even at rest, so the held frames are never
// byte-identical and -O3 alone cannot drop them; the lossy pass collapses those
// near-duplicate frames, which is what cuts the file by a large margin. It is
// optional: without gifsicle the ffmpeg GIF is left in place, just larger.
const before = statSync(GIF).size;
const gifsicle = spawnSync("gifsicle", ["-O3", "--lossy=30", GIF, "-o", GIF], {
  stdio: "inherit",
});
if (gifsicle.error || gifsicle.status !== 0) {
  console.log(
    "Tip: install gifsicle (brew install gifsicle) to shrink this further; it is " +
      mb(before) +
      " now.",
  );
} else {
  console.log("Optimized with gifsicle: " + mb(before) + " -> " + mb(statSync(GIF).size) + ".");
}

console.log(
  "Done. README's See It In Action section already points at docs/assets/demo.gif, so the refreshed demo shows on the next load.",
);
