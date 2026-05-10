# HEAVEN-GeoIntel

**Phone number intelligence platform.** A production-ready web application that returns accurate carrier info, line type, country intelligence, SIM data, fraud signals, caller identity, and format cross-references for any phone number on Earth — with zero API keys required.

> **Scope:** This tool returns publicly derivable *metadata* only (number type, country, timezone, carrier prefix, format). It does **not** and **cannot** provide real-time GPS location, live device tracking, SS7 interception, or any form of unauthorized surveillance. Such capabilities are illegal and will never be added.

---

## Start in one command

```bash
bash start.sh
```

The script checks Node.js, installs dependencies if needed, creates `.env.local`, auto-detects an available port, and starts the server. No manual steps required.

**Alternatively:**

```bash
npm run setup
```

Both require [Node.js 18+](https://nodejs.org). Nothing else.

---

## Global command

After running `bash start.sh` once, a `geointel` shell function is automatically registered in your `~/.zshrc`. Open a new terminal and type:

```bash
geointel
```

That starts the app from anywhere on your system. To install it manually at any time:

```bash
npm run install-global
```

---

## What you get with zero configuration

The app works fully offline. Every lookup returns real data derived from the phone number structure and bundled datasets — no simulation, no placeholder values.

| Panel | What it shows |
|---|---|
| **Result Header** | E.164 number, country flag, valid/invalid badge, line type badge, ambiguity warning, caller name (if API configured) |
| **Data Source Status** | Live indicator showing which of the 5 data sources returned data |
| **Metric Cards** | Only populated fields are shown — no N/A cards. Offline gives 6–8 accurate cards; with API keys, up to 16 |
| **Number Structure** | Country code · area code · subscriber number · NXX central office code. Country-specific extraction rules (US/CA, GB, DE, FR, AU) |
| **Format Cross-Reference** | E.164, International, National, RFC 3966 — all copyable, with HTML `<a tel:>` snippet |
| **SIM & Carrier Intelligence** | Owner/CNAM, network carrier, prepaid status, line active, active status, user activity, MCC/MNC, PLMN code, city, associated emails |
| **QR Code** | Canvas-rendered QR for the `tel:` URI — downloadable as PNG |
| **Country Intelligence** | Capital, continent, region, population, currency, languages, driving side, emergency number, internet penetration, GDP per capita, timezones |
| **OSINT Pivots** | 16 external investigation links grouped by category: Identity, Breach, Social, Spam, Carrier |
| **Raw Source JSON** | Per-API response tabs showing exact data returned (or NOT CONFIGURED when key absent) |
| **History Drawer** | Last 20 lookups, saved in browser localStorage |
| **Shareable URL** | `?q=+14155552671` — paste it and the lookup auto-runs |
| **Export JSON** | Full response as `<e164>_<timestamp>.json` |

---

## Data accuracy

Fields are only shown when the data is real and confirmed. Nothing is guessed or defaulted.

**Always accurate (offline, zero APIs):**
- Country, calling code, flag
- Number validity (libphonenumber-js strict validation)
- Number type — mobile / fixed / VoIP / toll-free / premium rate / pager / personal
- Ambiguous type detection: `FIXED_LINE_OR_MOBILE` numbers are labelled "TYPE AMBIGUOUS" — never falsely claimed as mobile or landline
- IANA timezone + UTC offset (110+ countries/territories)
- Area code — extracted only for countries with known rules (US/CA, GB, DE, FR, AU, IT, ES, PL, NL)
- NXX central office code (carrier prefix block) — correctly derived from the subscriber portion, not the area code
- All 4 number formats
- Expected digit length per country

**Only shown when an API provides it:**
- Carrier name (IPQualityScore, NumVerify, AbstractAPI, Twilio)
- Owner / Caller name / CNAM (Twilio, IPQualityScore)
- Fraud score 0–100 (IPQualityScore)
- Prepaid vs contract (IPQualityScore)
- Line active status (IPQualityScore)
- User activity level (IPQualityScore)
- MCC / MNC / PLMN codes (Twilio)
- Recent abuse flag, risk flag (IPQualityScore)
- Associated email addresses (IPQualityScore)

---

## Optional API enrichment

Add keys to `.env.local` for enriched carrier, fraud, and SIM data. The app works fully without them.

| Service | What it adds | Free tier |
|---|---|---|
| **IPQualityScore** | Fraud score, VOIP flag, recent abuse, risk flag, prepaid, active status, user activity, city, emails | 200/day |
| **NumVerify** | Carrier name, line type, location | 100/month |
| **AbstractAPI** | Carrier, line type, country | 250/month |
| **Twilio Lookup v2** | Carrier name, line type, owner/CNAM, MCC, MNC | ~$0.005/lookup |

```env
# .env.local — add any or all, leave blank to skip
NUMVERIFY_API_KEY=
IPQS_API_KEY=
ABSTRACT_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
```

Sign up links: [IPQualityScore](https://www.ipqualityscore.com) · [NumVerify](https://numverify.com) · [AbstractAPI](https://www.abstractapi.com/api/phone-validation) · [Twilio](https://www.twilio.com)

---

## How it works

```
Browser → POST /api/lookup { number: "+14155552671" }
              │
              ├─ libphonenumber-js  (always, offline)
              │    parse · validate · format (E.164 / national / international / RFC3966)
              │    detect type: mobile / fixed / VoIP / toll-free / premium / pager / UAN
              │    ambiguous type (FIXED_LINE_OR_MOBILE) flagged — never falsely claimed
              │    IANA timezone derived from 110-country bundled map
              │    area code extracted per country-specific rules
              │    NXX central office code extracted from subscriber portion
              │
              ├─ Bundled country dataset  (always, offline)
              │    capital · currency · languages · driving side · emergency number
              │    population · GDP per capita · internet users · timezones
              │
              └─ Optional API fan-out  (Promise.allSettled — one failure ≠ total failure)
                   NumVerify     → carrier name, line type, location
                   IPQualityScore → fraud score, prepaid, active, abuse signals, MCC, city
                   AbstractAPI   → carrier, line type
                   Twilio Lookup → carrier, line type intelligence, owner/CNAM, MCC/MNC
```

**Caching:** Results cached in-memory for 24 hours, keyed by E.164. Repeat lookups are instant.

**Rate limiting:** 10 requests per minute per IP (token bucket). Returns HTTP 429 when exceeded.

---

## OSINT pivot links

16 investigation links, grouped into 5 categories:

| Category | Services |
|---|---|
| **Identity / Reverse Lookup** | Truecaller, Sync.me, NumLookup, That's Them, Spy Dialer, CallerSmart |
| **Breach / Data Exposure** | Epieos (phone → email correlation), HaveIBeenPwned |
| **Social / Open Web** | Google: LinkedIn, Facebook, Instagram dorks · Broad Google dork |
| **Spam / Abuse Reports** | 800notes, Should I Answer, Who Called Me |
| **Carrier / Telecom** | PhoneValidator |

---

## Security

- **API keys never leave the server.** All external calls happen in `app/api/lookup/route.ts` (server-side only). Verified: `grep -r "process.env" .next/static/` returns nothing.
- **Security headers on all routes.** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (blocks geolocation/camera/mic), `Content-Security-Policy`.
- **No geolocation, no tracking.** The app derives metadata from number structure and public databases — it makes no attempt to locate a device or intercept calls.
- **Rate limited.** 10 requests/minute per IP prevents bulk scraping.
- **Safe dependencies only.** `libphonenumber-js` is Google's libphonenumber compiled to JS. No telemetry, no tracking packages.

---

## Project structure

```
app/
├── api/lookup/route.ts    POST endpoint — parse, analyze, fan-out, aggregate
├── layout.tsx             Root layout — JetBrains Mono, meta tags, OG/Twitter cards
├── page.tsx               Main page — boot sequence, input, results, shareable URL
├── not-found.tsx          Custom 404 page (matrix theme)
├── robots.ts              robots.txt
└── globals.css            Matrix/terminal theme, CRT scanlines, shadcn overrides

components/
├── MatrixRain.tsx         Canvas background animation (7% opacity, katakana)
├── BootSequence.tsx       Staggered terminal init sequence (Framer Motion)
├── PhoneInput.tsx         250+ country combobox + AsYouType formatter + validation
├── ResultsDashboard.tsx   All result panels — only shows populated fields, no N/A cards
├── MetricCard.tsx         Individual animated metric tile
├── FraudScoreBar.tsx      Animated 0–100 fraud score bar with color bands
├── NumberBreakdown.tsx    Visual digit structure — country code · area · subscriber
├── SimIntelPanel.tsx      SIM intelligence — owner, prepaid, active, MCC/MNC, emails
├── QrCodePanel.tsx        Canvas QR code for tel: URI, downloadable as PNG
├── CountryPanel.tsx       Bundled country intelligence display
├── FormatPanel.tsx        Format cross-reference + validation matrix
├── OsintPivots.tsx        16 external investigation links in 5 categories
├── HistorySidebar.tsx     localStorage history drawer (last 20 lookups)
├── ShareButton.tsx        Copies ?q= shareable URL to clipboard
├── SourceTabs.tsx         Raw JSON per API source with status indicators
└── LoadingSkeletons.tsx   Matrix-pulsing skeleton loaders

lib/
├── phoneAnalysis.ts       Offline analysis engine
│                           · 110+ country IANA timezone map
│                           · Country-specific area code extraction (6 countries)
│                           · NXX central office code extraction
│                           · Expected digit lengths (40+ countries)
│                           · Ambiguous type detection (FIXED_LINE_OR_MOBILE)
├── countryIntel.ts        Bundled dataset for 40+ countries (zero API)
├── types.ts               Full TypeScript interface tree
├── cache.ts               24h in-memory Map cache
├── rateLimit.ts           Token-bucket rate limiter (10/min/IP)
├── flagEmoji.ts           Country code → emoji flag
└── utils.ts               Tailwind merge helper
```

---

## Available scripts

| Command | What it does |
|---|---|
| `bash start.sh` | One-step: install deps, register global command, start dev server |
| `npm run setup` | Same as above, npm version |
| `npm run install-global` | Register the `geointel` shell command in `~/.zshrc` |
| `npm run dev` | Start dev server (requires prior `npm install`) |
| `npm run build` | Production build |
| `npm run start` | Start production server (requires prior `npm run build`) |
| `npm run lint` | ESLint check |

---

## Requirements

- **Node.js 18 or higher** — [nodejs.org](https://nodejs.org)
- **npm 9 or higher** — included with Node.js
- No database, no Docker, no Redis, no cloud account

---

## Accepted number formats

Any format libphonenumber-js can parse:

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

**Port 3000 already in use**
`start.sh` automatically detects the next available port and prints the correct URL. No manual action needed.

**Number shows as INVALID**
Include the full country calling code: `+1` for US/Canada, `+44` for UK, etc. Or select the country from the dropdown and enter just the local number.

**Carrier / Owner / Fraud Score not showing**
These fields are API-only. Add the relevant keys to `.env.local`. All other fields — timezone, type, country intelligence, formats, QR code — always populate without any API keys.

**`npm run dev` fails with MODULE_NOT_FOUND**
Use `bash start.sh` or `npm run setup` instead. Both invoke Next.js directly via `node node_modules/next/dist/bin/next` and bypass any symlink issues.

---

## License

MIT — use freely, attribution appreciated.

---

*Metadata only · No real-time location · No device tracking · Use responsibly*
