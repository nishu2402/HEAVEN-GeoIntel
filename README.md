# PHONEOSINT — HEAVEN-GeoIntel

**Phone number metadata intelligence platform.** A real, production-ready web application that returns carrier info, line type, country intelligence, fraud signals, and format cross-references for any phone number on Earth — with zero API keys required.

> **Scope:** This tool returns publicly derivable *metadata* only (number type, country, timezone, carrier prefix, format). It does **not** and **cannot** provide real-time GPS location, live device tracking, SS7 interception, or any form of unauthorized surveillance. Such features are illegal and will never be added.

---

## One-step start

```bash
bash start.sh
```

That's it. The script checks Node.js, installs dependencies if needed, creates `.env.local`, and opens the dev server at **http://localhost:3000**. No manual steps.

**Alternatively**, with npm:

```bash
npm run setup
```

Both commands require [Node.js 18+](https://nodejs.org). Nothing else.

---

## What you get immediately (zero configuration)

The app works fully offline, with no API keys. Every lookup returns:

| Panel | Data |
|---|---|
| **Header** | E.164 number, country flag, valid/invalid badge, type badge |
| **12 Metric Cards** | Carrier, Line Type, Country, Region, Timezone (UTC offset), VOIP flag, Recent Abuse, Risk Flag, Number Length, Mobile, Toll-Free, Premium Rate |
| **Number Structure** | Visual breakdown of country code · area code · subscriber number, carrier prefix block, digit-length indicator |
| **Format Cross-Reference** | E.164, International, National, RFC 3966 — all copyable, with HTML `<a tel:>` snippet |
| **Country Intelligence** | Capital, continent, region, population, currency, languages, driving side, emergency number, internet penetration, GDP per capita, timezones |
| **OSINT Pivot Links** | 8 external links (Truecaller, Sync.me, Epieos, HaveIBeenPwned, Google dorks) built from the number |
| **Raw Source JSON** | Per-API response tabs (shows NOT CONFIGURED when keys absent) |
| **History Drawer** | Last 20 lookups saved in browser localStorage |
| **Shareable URL** | `?q=+14155552671` — paste the URL and the lookup auto-runs |
| **Export** | Download full JSON response as `<e164>_<timestamp>.json` |

---

## Optional API enrichment (still free, no credit card)

Add keys to `.env.local` for richer carrier, fraud, and line-type data from external APIs. The app works without them — these are additive:

| Service | What it adds | Free tier | Sign up |
|---|---|---|---|
| **IPQualityScore** | Fraud score (0–100), VOIP flag, recent abuse, risky flag, prepaid flag | 200/day | [ipqualityscore.com](https://www.ipqualityscore.com) |
| **NumVerify** | Carrier name, line type, location string | 100/month | [numverify.com](https://numverify.com) |
| **AbstractAPI** | Carrier, line type, country | 250/month | [abstractapi.com](https://www.abstractapi.com/api/phone-validation) |
| **Twilio Lookup v2** | Carrier name, line type intelligence, caller name | ~$0.005/lookup | [twilio.com](https://www.twilio.com) |

```env
# .env.local — fill in any or all, leave empty to skip
NUMVERIFY_API_KEY=
IPQS_API_KEY=
ABSTRACT_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
```

---

## How it works

```
Browser → POST /api/lookup { number: "+14155552671" }
              │
              ├─ libphonenumber-js (always, offline)
              │    parse · validate · format E.164/national/international/RFC3966
              │    detect type: mobile/fixed/VoIP/toll-free/premium/UAN/pager
              │    derive timezone from bundled country→IANA map
              │    extract area code + carrier prefix block
              │
              ├─ Bundled country dataset (always, offline)
              │    capital · currency · languages · driving side · emergency no.
              │    population · GDP · internet users · timezones
              │
              └─ Optional API fan-out (Promise.allSettled — one failure ≠ total failure)
                   NumVerify → carrier name, line type
                   IPQualityScore → fraud score, abuse signals
                   AbstractAPI → carrier, type
                   Twilio Lookup → carrier, line type intelligence
```

**Caching:** Results are cached in-memory for 24 hours, keyed by E.164. Repeat lookups are instant.

**Rate limiting:** 10 requests per minute per IP (in-memory token bucket). Returns HTTP 429 when exceeded.

---

## Project structure

```
app/
├── api/lookup/route.ts    POST endpoint — parses, analyzes, fans out, aggregates
├── layout.tsx             Root layout — JetBrains Mono font, dark theme
├── page.tsx               Main page — boot sequence, input, results
└── globals.css            Matrix/terminal theme, CRT scanlines, shadcn overrides

components/
├── MatrixRain.tsx         Canvas background animation (7% opacity)
├── BootSequence.tsx       Staggered terminal init text (Framer Motion)
├── PhoneInput.tsx         250+ country combobox + AsYouType formatter + validation
├── ResultsDashboard.tsx   All result panels wired together
├── MetricCard.tsx         Individual animated metric tile
├── FraudScoreBar.tsx      Animated 0–100 bar with color coding
├── NumberBreakdown.tsx    Visual digit structure panel
├── CountryPanel.tsx       Bundled country intelligence display
├── FormatPanel.tsx        Format cross-reference + validation matrix
├── OsintPivots.tsx        8 external investigation links
├── HistorySidebar.tsx     localStorage history drawer
├── ShareButton.tsx        Copies ?q= shareable URL
├── SourceTabs.tsx         Raw JSON tabs per API source
└── LoadingSkeletons.tsx   Matrix-pulsing skeleton loaders

lib/
├── phoneAnalysis.ts       Deep libphonenumber-js analysis engine
│                           · 80-country IANA timezone map
│                           · Country-specific area code extraction
│                           · Carrier prefix block detection
│                           · Expected digit length per country
├── countryIntel.ts        Bundled dataset for 40+ countries (zero API)
├── types.ts               Complete TypeScript interface tree
├── cache.ts               24h in-memory Map cache
├── rateLimit.ts           Token-bucket rate limiter (10/min/IP)
├── flagEmoji.ts           Country code → emoji flag
└── utils.ts               Tailwind merge helper
```

---

## Security

- **API keys never leave the server.** The route handler lives in `app/api/lookup/route.ts` (server-only). Verified: `grep -r "process.env" .next/static/` returns nothing.
- **No geolocation, no tracking.** The app derives metadata from the number structure and public databases — it makes no attempt to locate a device or intercept calls.
- **Rate limited.** 10 requests/minute per IP prevents bulk scraping.
- **Safe dependencies only.** `libphonenumber-js` is Google's libphonenumber compiled to JS. No telemetry, no tracking packages.

---

## Available scripts

| Command | What it does |
|---|---|
| `bash start.sh` | **One-step:** installs deps + starts dev server |
| `npm run setup` | Same as above, npm version |
| `npm run dev` | Start dev server (requires prior `npm install`) |
| `npm run build` | Production build |
| `npm run start` | Start production server (requires prior `npm run build`) |
| `npm run lint` | ESLint check |

---

## Requirements

- **Node.js 18 or higher** — [nodejs.org](https://nodejs.org)
- **npm 9 or higher** — included with Node.js
- No database, no Docker, no Redis, no environment setup

---

## Tested phone number formats

The app accepts any format libphonenumber-js can parse:

```
+14155552671          # E.164 (recommended)
+44 7911 123456       # International with spaces
+33 1 42 86 83 26     # French format
+91 98765 43210       # Indian format
+86 138 0013 8000     # Chinese format
001 (415) 555-2671    # US with IDD prefix
```

---

## Troubleshooting

**`npm run dev` fails with MODULE_NOT_FOUND`**
The `.bin/next` symlink is corrupted on this system. Use `bash start.sh` or `npm run setup` instead — both call `node node_modules/next/dist/bin/next` directly.

**Port 3000 already in use**
```bash
PORT=3001 npm run dev
```

**Results show N/A for Carrier / Fraud Score**
These fields come from optional external APIs. Add keys to `.env.local` to enable them. All other fields (timezone, type, country intel, formats) always populate without API keys.

**Number shows as INVALID**
Include the full country calling code: `+1` for US/Canada, `+44` for UK, etc. Or select the country from the dropdown and enter just the local number.

---

## License

MIT — use freely, attribute appreciated.

---

*OSINT metadata only · No real-time location · No device tracking · Use responsibly*
