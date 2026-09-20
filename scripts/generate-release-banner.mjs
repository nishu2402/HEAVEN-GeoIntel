#!/usr/bin/env node
/**
 * Generate the release / social banner: docs/assets/heaven-release-banner.png.
 *
 * A wide 1280x500 card meant for the GitHub Release page and the repository
 * social preview (it is deliberately NOT embedded in the README, which already
 * carries the animated poster). It mirrors the composition of the sibling
 * HEAVEN pentest framework's release banner so the two projects read as one
 * family, but every colour, number and label here is GeoIntel's own.
 *
 * The mark comes from src/lib/brand/logo.ts, so it can never drift from the app.
 * The numbers are the same source-derived stats the poster prints; they are
 * passed in below rather than re-imported to keep this script dependency-light.
 * Re-run after a release (the version string is the only thing that usually
 * moves):
 *
 *   npm run brand:release
 *
 * Rasterisation uses the system Chrome, same as scripts/generate-brand-assets.mjs.
 */

import puppeteer from "puppeteer-core";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND, logoSvg } from "../src/lib/brand/logo.ts";
import { APP_VERSION } from "../src/lib/version.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "docs", "assets");
const OUT = join(OUT_DIR, "heaven-release-banner.png");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const MONO = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace";

// Palette: GeoIntel's neon pair plus the violet the README badges already use.
const GREEN = BRAND.green; // #00ff85
const CYAN = BRAND.cyan; // #22d3ee
const VIOLET = "#bf5fff";
const MUTED = "#6b8a7c";
const FAINT = "#4d6b5c";

// The four-stage flow, its accent colour and the concrete things each stage
// touches. All truthful: identifier intake, keyless enrichment, the link graph
// and risk spine, then the report/case exports.
const PIPELINE = [
  { title: "COLLECT", color: GREEN, sub: "phone · email · user · ip" },
  { title: "ENRICH", color: CYAN, sub: "34 sources · keyless" },
  { title: "CORRELATE", color: VIOLET, sub: "link graph · risk score" },
  { title: "REPORT", color: GREEN, sub: "pdf · html · case file" },
];

// Six trust metrics. Unlike the poster, these are TYPED IN, not read from the
// registries, and no test compares them with anything: this banner is a release
// asset, so nothing in the build fails when they drift. The last four must match
// `scripts/poster-stats.mjs` (identifiers, sources, modes, apiOperations) and the
// first two the build gate. Re-check all six when cutting a release.
const CARDS = [
  { n: "3488", label: "TESTS", color: GREEN },
  { n: "100%", label: "COVERAGE", color: CYAN },
  { n: "7", label: "IDENTIFIERS", color: VIOLET },
  { n: "34", label: "SOURCES", color: GREEN },
  { n: "11", label: "MODES", color: CYAN },
  { n: "30", label: "API OPS", color: VIOLET },
];

const W = 1280;
const H = 500;

// ── Radar / scope motif (echoes the logo's globe + tilted orbit) ────────────
const radar = `
<svg width="212" height="212" viewBox="0 0 212 212" xmlns="http://www.w3.org/2000/svg" fill="none">
  <defs>
    <radialGradient id="sweep" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse"
      gradientTransform="translate(106 106) rotate(-42) scale(96)">
      <stop offset="0" stop-color="${GREEN}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${GREEN}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="scopeGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${CYAN}" stop-opacity="0.10"/>
      <stop offset="1" stop-color="${CYAN}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="106" cy="106" r="96" fill="url(#scopeGlow)"/>
  <circle cx="106" cy="106" r="94" stroke="${CYAN}" stroke-opacity="0.34" stroke-width="1.4"/>
  <circle cx="106" cy="106" r="66" stroke="${CYAN}" stroke-opacity="0.18" stroke-width="1.2"/>
  <circle cx="106" cy="106" r="38" stroke="${CYAN}" stroke-opacity="0.16" stroke-width="1.2"/>
  <line x1="106" y1="12" x2="106" y2="200" stroke="${CYAN}" stroke-opacity="0.10" stroke-width="1"/>
  <line x1="12" y1="106" x2="200" y2="106" stroke="${CYAN}" stroke-opacity="0.10" stroke-width="1"/>
  <ellipse cx="106" cy="106" rx="94" ry="30" stroke="${CYAN}" stroke-opacity="0.22" stroke-width="1.2"
    transform="rotate(-20 106 106)"/>
  <path d="M106 106 L106 12 A94 94 0 0 1 176 46 Z" fill="url(#sweep)"/>
  <line x1="106" y1="106" x2="176" y2="46" stroke="${GREEN}" stroke-opacity="0.8" stroke-width="1.6"/>
  <circle cx="150" cy="70" r="4.2" fill="${GREEN}"/>
  <circle cx="150" cy="70" r="8" fill="${GREEN}" fill-opacity="0.22"/>
  <circle cx="70" cy="140" r="3.4" fill="${VIOLET}"/>
  <circle cx="70" cy="140" r="7" fill="${VIOLET}" fill-opacity="0.22"/>
  <circle cx="150" cy="150" r="3" fill="${CYAN}"/>
  <circle cx="106" cy="106" r="3.4" fill="${GREEN}"/>
</svg>`;

// ── Sub-builders ────────────────────────────────────────────────────────────
const stage = (s, i) => `
  <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:11px">
    <div style="font-size:15px;font-weight:700;letter-spacing:.16em;color:${s.color}">${s.title}</div>
    <div style="width:15px;height:15px;border-radius:50%;background:${s.color};
      box-shadow:0 0 12px ${s.color},0 0 0 4px rgba(5,6,13,1),0 0 0 5px ${s.color}55"></div>
    <div style="font-size:12.5px;letter-spacing:.05em;color:${MUTED}">${s.sub}</div>
  </div>`;

const card = (c) => `
  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;
    height:74px;border-radius:13px;border:1px solid rgba(34,211,238,.24);
    background:linear-gradient(180deg,rgba(34,211,238,.05),rgba(34,211,238,.015))">
    <div style="font-size:30px;font-weight:800;line-height:1;color:${c.color};
      text-shadow:0 0 16px ${c.color}66">${c.n}</div>
    <div style="font-size:11px;letter-spacing:.14em;color:${MUTED}">${c.label}</div>
  </div>`;

const html = `
<div style="position:relative;width:${W}px;height:${H}px;font-family:${MONO};
  background:radial-gradient(130% 120% at 28% -10%, #0d1730 0%, #05060d 60%);overflow:hidden">

  <!-- corner glows: green top-left, violet bottom-right (the README badge violet) -->
  <div style="position:absolute;left:-8%;top:-30%;width:55%;height:90%;
    background:radial-gradient(closest-side,rgba(0,255,133,.16),transparent 70%)"></div>
  <div style="position:absolute;right:-6%;bottom:-34%;width:58%;height:95%;
    background:radial-gradient(closest-side,rgba(191,95,255,.14),transparent 70%)"></div>

  <!-- graticule: the grid the app draws behind its panels -->
  <div style="position:absolute;inset:0;
    background-image:linear-gradient(rgba(0,255,133,.05) 1px,transparent 1px),
                     linear-gradient(90deg,rgba(0,255,133,.05) 1px,transparent 1px);
    background-size:40px 40px"></div>

  <!-- framed card -->
  <div style="position:absolute;inset:16px;border-radius:22px;
    border:1.5px solid rgba(34,211,238,.30);
    box-shadow:inset 0 0 60px rgba(0,255,133,.05),0 0 40px rgba(0,0,0,.5)"></div>

  <!-- top accent line -->
  <div style="position:absolute;left:16px;right:16px;top:16px;height:3px;border-radius:3px 3px 0 0;
    background:linear-gradient(90deg,transparent,${GREEN},${CYAN},${VIOLET},transparent)"></div>

  <!-- logo mark -->
  <div style="position:absolute;left:52px;top:52px;
    filter:drop-shadow(0 0 20px rgba(0,255,133,.45))">${logoSvg({ size: 116, idPrefix: "rb" })}</div>

  <!-- wordmark block -->
  <div style="position:absolute;left:196px;top:50px">
    <div style="font-size:66px;font-weight:800;letter-spacing:.01em;line-height:1;white-space:nowrap">
      <span style="color:${GREEN};text-shadow:0 0 26px rgba(0,255,133,.6)">HEAVEN</span><span
        style="color:#3f6b57">-</span><span
        style="background:linear-gradient(90deg,${GREEN},${CYAN});-webkit-background-clip:text;
        -webkit-text-fill-color:transparent">GeoIntel</span>
    </div>
    <div style="margin-top:16px;font-size:20px;letter-spacing:.42em;color:#4fd1c5;text-transform:uppercase">
      Unified OSINT Platform</div>
    <div style="margin-top:16px;font-size:22px;font-weight:700;letter-spacing:.01em">
      <span style="color:${GREEN}">Search It.</span>
      <span style="color:${FAINT}">·</span>
      <span style="color:${CYAN}">Verify It.</span>
      <span style="color:${FAINT}">·</span>
      <span style="color:${GREEN}">Report It.</span>
    </div>
    <div style="margin-top:14px;font-size:14px;letter-spacing:.08em;color:${MUTED};text-transform:uppercase">
      Seven identifier types · 34 sources · Zero API keys required</div>
  </div>

  <!-- radar -->
  <div style="position:absolute;right:66px;top:44px;display:flex;flex-direction:column;align-items:center;gap:8px">
    ${radar}
    <div style="display:flex;align-items:center;gap:8px;font-size:13px;letter-spacing:.22em;color:#8fd0b3">
      <span style="width:8px;height:8px;border-radius:50%;background:${GREEN};
        box-shadow:0 0 10px ${GREEN}"></span>LIVE OSINT</div>
  </div>

  <!-- pipeline -->
  <div style="position:absolute;left:60px;right:60px;top:286px;height:64px">
    <div style="position:absolute;left:8%;right:8%;top:33px;height:0;
      border-top:1.5px dashed rgba(34,211,238,.30)"></div>
    <div style="position:absolute;inset:0;display:flex;align-items:flex-start">
      ${PIPELINE.map(stage).join("")}
    </div>
  </div>

  <!-- stat cards -->
  <div style="position:absolute;left:44px;right:44px;top:368px;display:flex;gap:12px">
    ${CARDS.map(card).join("")}
  </div>

  <!-- footer strip -->
  <div style="position:absolute;left:44px;right:44px;top:456px;padding-top:12px;
    border-top:1px solid rgba(34,211,238,.14);display:flex;justify-content:space-between;
    font-size:12px;letter-spacing:.12em;color:${FAINT};text-transform:uppercase">
    <span>CLI · Web UI · REST API · Docker · OpenAPI 3.1</span>
    <span style="color:#7fae93">v${APP_VERSION} · MIT License</span>
  </div>
</div>`;

// ── Rasterise ───────────────────────────────────────────────────────────────
await mkdir(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
await page.setContent(
  `<!doctype html><meta charset="utf-8"><style>
     *{margin:0;padding:0;box-sizing:border-box}
     html,body{width:${W}px;height:${H}px;overflow:hidden}
     body{background:${BRAND.ink}}
   </style>${html}`,
  { waitUntil: "load" },
);
const buf = await page.screenshot({ type: "png" });
await writeFile(OUT, buf);
await browser.close();

console.log("wrote", OUT.replace(ROOT + "/", ""), `(${W}x${H} @2x)`);
