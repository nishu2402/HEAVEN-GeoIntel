# Screenshots

The main README references the seven PNGs in this folder. Every one is captured at
the same fixed viewport (1440x900 at 2x, so 2880x1800), which is what keeps the
README grid even instead of ragged.

| Filename | What it shows |
|----------|---------------|
| `phone-results.png`   | The phone result card: number, validity, abuse and exposure scores, exports and data sources, over the at-a-glance grid |
| `osint-pivots.png`    | The OSINT Pivot Matrix: access-tier filter chips over categorised reverse-lookup links |
| `breach-intel.png`    | The unified breach view (one row per breach, merged across sources) above the free no-key lookups |
| `number-intel.png`    | Number anatomy: country code, area code and subscriber digits with libphonenumber checks and standard formats |
| `command-palette.png` | The Ctrl/Cmd-K command palette listing all eleven modes |
| `ai-analysis.png`     | The AI Analysis panel: the explainable risk score broken into its factors, with the optional AI Analyst and its in-panel setup below |
| `bulk-mode.png`       | The BULK tab with five numbers pasted in and the finished 5/5 result table below |

The phone flow, the palette and the risk panel are all computed locally, so they
render the same on any machine and never capture an upstream error. Bulk is the
one exception: it runs the real lookup per row, so its table needs a network.

## Regenerate

```bash
HV_DATA_DIR=/tmp/shot-state node node_modules/next/dist/bin/next dev -p 3987
SCREENSHOT_BASE=http://localhost:3987 npm run screenshots
```

Two details in that first line are deliberate. `HV_DATA_DIR` points the server at
a scratch state directory, so the AI Analyst panel is captured in the first-run
state a reader of the README will actually see instead of reporting a key saved
on your machine, and your own saved keys are left alone. The port keeps the
capture off whatever you already have on 3000. `SCREENSHOT_BASE` defaults to
`http://localhost:3000` if you leave it out.

The script uses `puppeteer-core` against your system Chrome (no extra browser
download) and writes high-DPI PNGs back into this folder. If your Chrome lives
somewhere other than the macOS default, edit the `CHROME` constant at the top of
[`scripts/capture-screenshots.mjs`](../../scripts/capture-screenshots.mjs).

Re-shoot these whenever the header, theme or a captured panel changes. They show
the real UI, so a stale screenshot is a wrong one. The script now fails loudly
when a panel it targets has been renamed, rather than quietly shooting whatever
was on screen: if a run stops with "no terminal-card matched …" or "could not
find …", fix the needle in the script instead of committing the shot it would
have taken.

## Not screenshots: the brand assets

The logo files (favicon, app icons, OG image, README hero, `public/brand/*`) are
**generated**, not captured. They come from the geometry in
[`src/lib/brand/logo.ts`](../../src/lib/brand/logo.ts) via a separate script:

```bash
npm run brand                     # poster + app icons + release banner
```

That one needs no dev server. It chains three generators: `brand:poster` (the
animated README poster and the terminal banner), `generate-brand-assets.mjs` (the
favicon, app icons, OG image and README hero) and `brand:release` (the GitHub
release banner in [`docs/assets`](../assets)). Re-run it after editing the brand
module, and commit the regenerated files.
