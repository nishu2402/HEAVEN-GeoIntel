#!/usr/bin/env node
/**
 * Generate every static brand asset from src/lib/brand/logo.ts.
 *
 * The React <Logo>, the report letterheads and these files all read the same
 * geometry module, so the mark cannot drift between the app and its exports.
 * Re-run this after changing that module:
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * Rasterisation uses the system Chrome (same approach as capture-screenshots.mjs),
 * so there is no image-processing dependency to install.
 */

import puppeteer from "puppeteer-core";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND, logoSvg } from "../src/lib/brand/logo.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const APP = join(ROOT, "src", "app");
const PUBLIC_BRAND = join(ROOT, "public", "brand");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const MONO = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace";

await mkdir(PUBLIC_BRAND, { recursive: true });

// ── 1. Vector assets ────────────────────────────────────────────────────────
// icon.svg is what browsers actually put in the tab; the public/ copies are for
// READMEs, docs and anyone embedding the mark.
const svgs = {
  [join(APP, "icon.svg")]: logoSvg({ size: 64, idPrefix: "icon", title: BRAND.name }),
  [join(PUBLIC_BRAND, "mark.svg")]: logoSvg({ size: 256, idPrefix: "mark", title: BRAND.name }),
  [join(PUBLIC_BRAND, "mark-mono.svg")]: logoSvg({ size: 256, mono: BRAND.ink, title: BRAND.name }),
  [join(PUBLIC_BRAND, "mark-light.svg")]: logoSvg({ size: 256, mono: "#ffffff", title: BRAND.name }),
};
for (const [path, svg] of Object.entries(svgs)) {
  await writeFile(path, svg + "\n", "utf8");
  console.log("wrote", path.replace(ROOT + "/", ""));
}

// ── 2. Rasteriser ───────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
});

/** Screenshot arbitrary HTML at an exact pixel size. */
async function shoot(html, width, height, { transparent = false, scale = 1 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>
       *{margin:0;padding:0;box-sizing:border-box}
       html,body{width:${width}px;height:${height}px;overflow:hidden}
       body{background:${transparent ? "transparent" : BRAND.ink}}
     </style>${html}`,
    { waitUntil: "load" },
  );
  const buf = await page.screenshot({ omitBackground: transparent, type: "png" });
  await page.close();
  return buf;
}

/** The bare mark on a transparent canvas, padded so it never touches the edge. */
const markHtml = (px, pad = 0, mono) =>
  `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:${pad}px">
     ${logoSvg({ size: px - pad * 2, idPrefix: "r" + px, ...(mono ? { mono } : {}) })}
   </div>`;

// ── 3. favicon.ico (16/32/48, PNG-compressed entries) ───────────────────────
// Browsers still request /favicon.ico directly, so ship a real one rather than
// relying on icon.svg alone.
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;
  for (const [i, img] of images.entries()) {
    const at = i * 16;
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, at); // 0 encodes 256
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, at + 1);
    entries.writeUInt8(0, at + 2); // palette size
    entries.writeUInt8(0, at + 3); // reserved
    entries.writeUInt16LE(1, at + 4); // colour planes
    entries.writeUInt16LE(32, at + 6); // bits per pixel
    entries.writeUInt32LE(img.buf.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += img.buf.length;
  }
  return Buffer.concat([header, entries, ...images.map((i) => i.buf)]);
}

const icoSizes = [16, 32, 48];
const icoImages = [];
for (const size of icoSizes) {
  icoImages.push({ size, buf: await shoot(markHtml(size), size, size, { transparent: true }) });
}
await writeFile(join(APP, "favicon.ico"), buildIco(icoImages));
console.log("wrote src/app/favicon.ico");

// ── 4. PNG marks ────────────────────────────────────────────────────────────
// apple-icon sits on an opaque tile: iOS composites it onto white otherwise.
await writeFile(
  join(APP, "apple-icon.png"),
  await shoot(
    `<div style="width:100%;height:100%;background:${BRAND.ink};display:flex;align-items:center;justify-content:center">
       ${logoSvg({ size: 124, idPrefix: "apple" })}
     </div>`,
    180,
    180,
  ),
);
console.log("wrote src/app/apple-icon.png");

await writeFile(
  join(PUBLIC_BRAND, "mark.png"),
  await shoot(markHtml(512, 32), 512, 512, { transparent: true }),
);
console.log("wrote public/brand/mark.png");

// ── 5. Social / README artwork ──────────────────────────────────────────────
// A single composition, rendered at two aspect ratios.
const banner = ({ w, h, markPx, titlePx, showModes }) => `
<div style="position:relative;width:${w}px;height:${h}px;background:
     radial-gradient(120% 120% at 50% 0%, #0d1730 0%, #05060d 62%);
     font-family:${MONO};overflow:hidden">
  <!-- graticule: the same grid the app draws behind its panels -->
  <div style="position:absolute;inset:0;
       background-image:linear-gradient(rgba(0,255,133,.055) 1px,transparent 1px),
                        linear-gradient(90deg,rgba(0,255,133,.055) 1px,transparent 1px);
       background-size:44px 44px"></div>
  <!-- glow anchored behind the mark -->
  <div style="position:absolute;left:50%;top:44%;width:${Math.round(w * 0.62)}px;height:${Math.round(h * 0.9)}px;
       transform:translate(-50%,-50%);
       background:radial-gradient(closest-side, rgba(0,255,133,.16), transparent 70%)"></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;
       align-items:center;justify-content:center;gap:${Math.round(h * 0.045)}px">
    <div style="filter:drop-shadow(0 0 22px rgba(0,255,133,.42))">${logoSvg({ size: markPx, idPrefix: "banner" })}</div>
    <div style="font-size:${titlePx}px;font-weight:700;letter-spacing:.14em;line-height:1">
      <span style="color:${BRAND.green};text-shadow:0 0 20px rgba(0,255,133,.55)">HEAVEN</span><span
            style="color:#3f6b57">-</span><span
            style="background:linear-gradient(90deg,${BRAND.green},${BRAND.cyan});-webkit-background-clip:text;
                   -webkit-text-fill-color:transparent">GeoIntel</span>
    </div>
    <div style="font-size:${Math.round(titlePx * 0.3)}px;letter-spacing:.44em;color:#7fae93;text-transform:uppercase">
      ${BRAND.tagline}
    </div>
    ${showModes ? `<div style="margin-top:${Math.round(h * 0.03)}px;font-size:${Math.round(titlePx * 0.26)}px;
        letter-spacing:.3em;color:#4d6b5c;text-transform:uppercase">
        Phone · Email · Username · IP · Domain</div>` : ""}
  </div>
  <div style="position:absolute;left:0;right:0;top:0;height:3px;
       background:linear-gradient(90deg,transparent,${BRAND.green},${BRAND.cyan},transparent)"></div>
</div>`;

await writeFile(
  join(APP, "opengraph-image.png"),
  await shoot(banner({ w: 1200, h: 630, markPx: 168, titlePx: 78, showModes: true }), 1200, 630),
);
console.log("wrote src/app/opengraph-image.png");

await writeFile(
  join(PUBLIC_BRAND, "hero.png"),
  await shoot(banner({ w: 1280, h: 340, markPx: 96, titlePx: 46, showModes: true }), 1280, 340, { scale: 2 }),
);
console.log("wrote public/brand/hero.png");

await browser.close();

console.log("\nBrand assets regenerated.");
