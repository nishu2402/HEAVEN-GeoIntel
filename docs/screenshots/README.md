# Screenshots

The main README references the four PNGs in this folder:

| Filename | What it shows |
|----------|---------------|
| `phone-results.png`  | Top of the phone-results dashboard — header, threat score, data-source strip |
| `osint-pivots.png`   | The OSINT Pivot Matrix — filter chips + categorised links with access badges |
| `breach-intel.png`   | The credential-breach card — one-click free breach-database lookups |
| `bulk-mode.png`      | The BULK tab with sample phone numbers pasted in |

## Regenerate

```bash
npm run dev                       # terminal 1
npm run screenshots               # terminal 2  (= node scripts/capture-screenshots.mjs)
```

The script uses `puppeteer-core` against your system Chrome (no extra browser
download) and writes high-DPI PNGs back into this folder. If your Chrome lives
somewhere other than the macOS default, edit the `CHROME` constant at the top of
[`scripts/capture-screenshots.mjs`](../../scripts/capture-screenshots.mjs).

Re-shoot these whenever the header, theme or a captured panel changes — they show
the real UI, so a stale screenshot is a wrong one.

## Not screenshots: the brand assets

The logo files (favicon, app icons, OG image, README hero, `public/brand/*`) are
**generated**, not captured — they come from the geometry in
[`src/lib/brand/logo.ts`](../../src/lib/brand/logo.ts) via a separate script:

```bash
npm run brand                     # = node scripts/generate-brand-assets.mjs
```

That one needs no dev server. Re-run it after editing the brand module, and commit
the regenerated files.
