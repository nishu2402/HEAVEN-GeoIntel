# Screenshots

The main README references the six PNGs in this folder. Every one is captured at
the same fixed viewport (1440x900 at 2x, so 2880x1800), which is what keeps the
README grid even instead of ragged.

| Filename | What it shows |
|----------|---------------|
| `phone-results.png`   | Top of the phone dashboard: mode bar, result header, threat score, exports and data sources |
| `osint-pivots.png`    | The OSINT Pivot Matrix: access-tier filter chips over categorised reverse-lookup links |
| `breach-intel.png`    | The unified breach view (one row per breach, merged across sources) above the free no-key lookups |
| `number-intel.png`    | Number anatomy: country code, area code and subscriber digits with libphonenumber checks and standard formats |
| `command-palette.png` | The Ctrl/Cmd-K command palette listing all eleven modes |
| `bulk-mode.png`       | The BULK tab with sample numbers pasted in and the offline result table below |

All six come from offline-deterministic views (the phone flow is computed locally,
the palette and bulk table need no network), so they render the same on any
machine and never capture an upstream error.

## Regenerate

```bash
npm run dev                       # terminal 1
npm run screenshots               # terminal 2  (= node scripts/capture-screenshots.mjs)
```

The script uses `puppeteer-core` against your system Chrome (no extra browser
download) and writes high-DPI PNGs back into this folder. If your Chrome lives
somewhere other than the macOS default, edit the `CHROME` constant at the top of
[`scripts/capture-screenshots.mjs`](../../scripts/capture-screenshots.mjs).

Re-shoot these whenever the header, theme or a captured panel changes. They show
the real UI, so a stale screenshot is a wrong one.

## Not screenshots: the brand assets

The logo files (favicon, app icons, OG image, README hero, `public/brand/*`) are
**generated**, not captured. They come from the geometry in
[`src/lib/brand/logo.ts`](../../src/lib/brand/logo.ts) via a separate script:

```bash
npm run brand                     # = node scripts/generate-brand-assets.mjs
```

That one needs no dev server. Re-run it after editing the brand module, and commit
the regenerated files.
