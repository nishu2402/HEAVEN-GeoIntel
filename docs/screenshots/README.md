# Screenshots

The main README references the four PNGs in this folder:

| Filename                | What it shows |
|-------------------------|---------------|
| `phone-results.png`     | Top of the phone-results dashboard — header, threat score, data-source strip |
| `dork-generator.png`    | The Dork Generator card — categories, hit-rate badges, engine selector |
| `osint-pivots.png`      | The OSINT Pivot Matrix — filter chips + categorised links with access badges |
| `bulk-mode.png`         | The BULK tab with sample phone numbers pasted in |

## Regenerate

If you change the UI and want to refresh these images, run:

```bash
npm run dev                       # in one terminal
node scripts/capture-screenshots.mjs   # in another
```

The script uses `puppeteer-core` against your system Chrome (no extra browser
download). It captures full-quality PNGs at 2× device pixel ratio.

If your Chrome lives somewhere other than the macOS default
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, edit the
`CHROME` constant at the top of [`scripts/capture-screenshots.mjs`](../../scripts/capture-screenshots.mjs).

## Optional extras

If you want to add more screenshots to the README, drop them here with any
filename and add a `<img src="./docs/screenshots/<filename>" />` line to the
README table.
