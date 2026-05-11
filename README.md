# HEAVEN-GeoIntel

**Open-source OSINT intelligence platform for phone numbers and email addresses.** A production-ready web application built for penetration testers, security researchers, and OSINT analysts. Returns real, actionable intelligence — not placeholders — with zero API keys required for core functionality.

> **Scope:** This tool returns publicly derivable *metadata* only. It does **not** and **cannot** provide real-time GPS location, live device tracking, SS7 interception, or any form of unauthorized surveillance. Use only within your authorized scope.

---

## Start in one command

```bash
bash start.sh
```

The script checks Node.js, installs dependencies, creates `.env.local`, auto-detects an available port, and starts the server. No manual steps required.

**Alternatively:**

```bash
npm run setup
```

Both require [Node.js 18+](https://nodejs.org). Nothing else.

---

## Global command

After running `bash start.sh` once, a `geointel` shell function is registered in `~/.zshrc`. Open a new terminal and type:

```bash
geointel
```

To install it manually at any time:

```bash
npm run install-global
```

---

## Two modes: Phone and Email

Switch between modes using the `[ PHONE ]` and `[ EMAIL ]` tabs in the input card. Each mode has its own independent result state — switching tabs preserves your previous results.

---

## Phone Intelligence

### What you get with zero configuration

Every phone lookup returns real data derived from the number structure and bundled datasets. No simulation, no placeholder values.

| Panel | What it shows |
|---|---|
| **Result Header** | E.164, country flag, line type badge, caller name (API), ambiguity warning |
| **Threat Assessment** | Fraud score, VoIP/prepaid/abuse flags, risk level |
| **Pentester Panel** | Live local time, call window (business/evening/late night/weekend), NPA area code intel (US/CA), attack surface analysis |
| **Number Structure** | Country code · area code · subscriber number · NXX prefix. Country-specific extraction (US/CA, GB, DE, FR, AU) |
| **Metric Cards** | Only populated fields — no N/A cards. 6–8 offline; up to 16 with API keys |
| **Format Cross-Reference** | E.164, International, National, RFC 3966 — all copyable |
| **Number Permutations** | 11 format variants for database/OSINT searching (dots, dashes, URL-encoded, WhatsApp link, etc.) |
| **SIM & Carrier Intel** | Owner/CNAM, carrier, prepaid status, active status, MCC/MNC/PLMN, associated emails |
| **Country Intelligence** | Capital, continent, region, population, currency, languages, driving side, emergency number, internet penetration, GDP per capita |
| **Dork Generator** | 18 pre-built Google dorks — LinkedIn, Facebook, Twitter, GitHub, Pastebin, credential dumps, PDFs, and more |
| **OSINT Pivots** | 38 investigation links across 6 categories — Identity, Breach, Social, Messaging, Carrier, Intel |
| **QR Code** | Canvas-rendered QR for the `tel:` URI, downloadable as PNG |
| **Report Export** | Download full intelligence report as `.txt` or `.html` |
| **History Drawer** | Last 20 lookups saved in browser localStorage |
| **Shareable URL** | `?q=+14155552671` auto-runs the lookup |

### NPA Area Code Database (US/CA)

350+ US and Canadian area codes are bundled offline, mapped to:
- State or province
- Metro region / major city
- IANA timezone
- Country

This means every US/CA number immediately shows local time, call window assessment, and geographic context — with **zero API calls**.

### Phone OSINT pivots — 38 links, 6 categories

| Category | Services |
|---|---|
| **Identity / Reverse Lookup** | Truecaller, Sync.me, NumLookup, That's Them, Spy Dialer, CallerSmart, TruePeopleSearch, FastPeopleSearch, USPhoneBook, AnyWho, Infobel, PhoneBook.com |
| **Breach / Data Exposure** | Epieos, HaveIBeenPwned, IntelligenceX, Dehashed, LeakCheck |
| **Social / Open Web** | Google (LinkedIn, Facebook, Instagram, Twitter), Bing, Google Maps, Pastebin |
| **Messaging Platforms** | WhatsApp (wa.me/), Telegram (+prefix), Signal, Viber, iMessage check |
| **Carrier / Telecom** | FreeCarrierLookup, HLR-Lookups, TextMagic, MNP portability checker |
| **Intel / Deep Search** | IntelligenceX, Dehashed, Epieos correlation, HIBP, LeakCheck |

---

## Email Intelligence

### What you get with zero configuration

Every email lookup runs offline analysis instantly, then fans out to free data sources simultaneously.

| Panel | What it shows |
|---|---|
| **Identity Header** | Confirmed name (Gravatar) or inferred name (username pattern), avatar photo, location, threat score bar |
| **Threat Score** | 0–100 risk score calculated from breach count, password risk level, recency, and reputation signals |
| **Breach Database** | Real breach results from XposedOrNot — 1000+ databases, no API key required |
| **Breach Detail** | Per-breach: name, year, record count, exposed data types, password risk level (Plaintext / Easy Crack / Hashed) |
| **Risk Flags** | Critical banners when plaintext passwords or crackable hashes are found in breach data |
| **Email Classification** | Provider type (corporate/free/disposable/privacy/government/educational), disposable detection (300+ domains), role address detection |
| **Gravatar Profile** | Display name, username, location, about, linked social accounts — free, no key |
| **Reputation** | EmailRep.io signals: suspicious, blacklisted, malicious activity, credentials leaked, spam, first/last seen, registered platforms |
| **Validation** | Abstract API: deliverability, quality score (0–1), SMTP validity, MX records, catch-all detection |
| **Deliverability** | Hunter.io: deliverable/risky/undeliverable result, confidence score, SMTP check |
| **OSINT Matrix** | 25 investigation links across 4 categories — Breach, Identity, Social, Domain |
| **Report Export** | Full intelligence report as `.txt` including all breach details |

### Breach Intelligence — XposedOrNot

The core feature that makes the email module genuinely useful for pentesters. XposedOrNot aggregates 1000+ breach databases and returns:

- **Which specific breaches** the email appeared in (LinkedIn 2012, Adobe 2013, etc.)
- **What data was stolen** in each breach (Passwords, Usernames, Phone Numbers, Credit Cards…)
- **Password risk level** per breach:
  - `PLAINTEXT` — credentials are fully compromised. Assume all reused passwords are known.
  - `EASY CRACK` — MD5/SHA1 hashes, crackable with Hashcat/rainbow tables within hours
  - `HASHED` — bcrypt/SHA-256, significantly harder to crack
- **Record count** — how large the breach was
- **Verification status** — whether the breach is confirmed authentic

No API key required. Free to use.

### Email OSINT pivots — 25 links, 4 categories

| Category | Services |
|---|---|
| **Breach / Credential Exposure** | HaveIBeenPwned, IntelligenceX, Dehashed, LeakCheck, Snusbase, BreachDirectory |
| **Identity / OSINT Correlation** | Epieos, Gravatar, EmailRep.io, That's Them, Hunter.io Domain Search, Pipl |
| **Social Media / Open Web** | Google dorks (LinkedIn, Twitter, Facebook, GitHub), GitHub commit search, Bing, Pastebin |
| **Domain / Infrastructure** | MXToolbox, WHOIS, ViewDNS, Spamhaus, SecurityTrails, Shodan |

---

## Optional API enrichment

Add keys to `.env.local` for deeper intelligence. The app works fully without them.

### Phone enrichment

| Service | What it adds | Free tier |
|---|---|---|
| **IPQualityScore** | Fraud score, VoIP flag, recent abuse, risk flag, prepaid, active status, user activity, city, associated emails | 200/day |
| **NumVerify** | Carrier name, line type, location | 100/month |
| **AbstractAPI** (phone) | Carrier, line type, country | 250/month |
| **Twilio Lookup v2** | Carrier name, owner/CNAM, MCC, MNC | ~$0.005/lookup |

### Email enrichment

| Service | What it adds | Free tier |
|---|---|---|
| **Hunter.io** | Email deliverability result, confidence score, SMTP check | 25/month |
| **AbstractAPI** (email) | SMTP validity, MX records, quality score, catch-all detection | 250/month |
| **EmailRep.io** | Reputation, breach flags, platform registrations — works without key | Higher quota with key |

```env
# .env.local — add any or all, leave blank to skip

# Phone sources
NUMVERIFY_API_KEY=
IPQS_API_KEY=
ABSTRACT_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=

# Email sources
HUNTER_API_KEY=
EMAILREP_API_KEY=
```

Sign up links: [IPQualityScore](https://www.ipqualityscore.com) · [NumVerify](https://numverify.com) · [AbstractAPI](https://www.abstractapi.com) · [Twilio](https://www.twilio.com) · [Hunter.io](https://hunter.io) · [EmailRep.io](https://emailrep.io)

---

## How it works

### Phone lookup

```
Browser → POST /api/lookup { number: "+14155552671" }
              │
              ├─ libphonenumber-js  (always, offline)
              │    parse · validate · format (E.164 / national / international / RFC3966)
              │    detect type: mobile / fixed / VoIP / toll-free / premium / pager
              │    ambiguous type (FIXED_LINE_OR_MOBILE) flagged — never falsely claimed
              │    IANA timezone derived from 110-country bundled map
              │    area code extracted per country-specific rules
              │    NXX central office code from subscriber portion
              │
              ├─ US/CA NPA database  (always, offline)
              │    350+ area codes → state · region · timezone · country
              │
              ├─ Bundled country dataset  (always, offline)
              │    capital · currency · languages · driving side · emergency number
              │    population · GDP · internet users · timezones
              │
              └─ Optional API fan-out  (Promise.allSettled — one failure ≠ total failure)
                   NumVerify      → carrier name, line type, location
                   IPQualityScore → fraud score, prepaid, active, abuse, MCC, city
                   AbstractAPI    → carrier, line type
                   Twilio Lookup  → carrier, line type, owner/CNAM, MCC/MNC
```

### Email lookup

```
Browser → POST /api/email-lookup { email: "target@domain.com" }
              │
              ├─ Offline analysis  (always, instant)
              │    disposable domain detection (300+ domains)
              │    free webmail / privacy provider / role address classification
              │    username pattern analysis → inferred name (john.smith → "John Smith")
              │    provider classification: corporate / free / educational / gov / privacy / disposable
              │
              └─ Free source fan-out  (Promise.allSettled — parallel, resilient)
                   Gravatar       → MD5 hash → real name, avatar, location, linked accounts (free, no key)
                   XposedOrNot    → breach database lookup — 1000+ sources (free, no key)
                   EmailRep.io    → reputation, breach flags, platform registrations (free, no key)
                   AbstractAPI    → SMTP/MX validation, quality score (ABSTRACT_API_KEY)
                   Hunter.io      → deliverability check, confidence score (HUNTER_API_KEY)
```

**Caching:** Results cached in-memory for 24 hours (500 entries max, LRU eviction). Repeat lookups are instant.

**Rate limiting:** 10 requests per minute per IP. Returns HTTP 429 when exceeded.

---

## Data accuracy

### Phone — always accurate (offline, zero APIs)

- Country, calling code, flag emoji
- Number validity (libphonenumber-js strict validation)
- Number type — mobile / fixed / VoIP / toll-free / premium / pager / personal
- Ambiguous type: `FIXED_LINE_OR_MOBILE` shown as "TYPE AMBIGUOUS" — never falsely claimed
- IANA timezone + UTC offset (110+ countries/territories)
- Area code — extracted for US/CA, GB, DE, FR, AU, IT, ES, PL, NL only
- NXX central office code — from subscriber portion, not area code
- All 4 number formats
- Expected digit length per country
- State/province, metro region, local timezone for US/CA numbers (NPA database)

### Email — offline analysis (zero APIs)

- Disposable provider detection (300+ throwaway services)
- Privacy provider detection (ProtonMail, Tutanota, Riseup, etc.)
- Free webmail detection (Gmail, Outlook, Yahoo, iCloud, etc.)
- Role address detection (admin@, support@, info@, noreply@, etc.)
- Provider name resolution (50+ known providers)
- Government/military detection (.gov, .mil, .gov.uk, .gov.au)
- Educational detection (.edu, .ac.uk, .edu.au, .ac.in)
- Name inference from username patterns (`john.smith` → "John Smith")

---

## Security

- **API keys never leave the server.** All external calls happen in server-side API routes. Verified: `grep -r "process.env" .next/static/` returns nothing.
- **Security headers on all routes.** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (blocks geolocation/camera/mic), `Content-Security-Policy`.
- **No geolocation, no tracking.** Derives metadata from number/email structure and public databases only.
- **Rate limited.** 10 requests/minute per IP prevents bulk scraping.
- **Safe dependencies only.** `libphonenumber-js` is Google's libphonenumber compiled to JS. No telemetry packages.

---

## Project structure

```
app/
├── api/
│   ├── lookup/route.ts          Phone POST endpoint — parse, analyze, fan-out, aggregate
│   └── email-lookup/route.ts    Email POST endpoint — Gravatar, XON, EmailRep, Abstract, Hunter
├── layout.tsx                   Root layout — JetBrains Mono, meta tags, OG/Twitter cards
├── page.tsx                     Main page — mode switcher, boot sequence, input, results
├── not-found.tsx                Custom 404 (matrix theme)
├── robots.ts                    robots.txt
└── globals.css                  Matrix/terminal theme, CRT scanlines, shadcn overrides

components/
│
│  ── Shared ──────────────────────────────────────────────────────────────────
├── MatrixRain.tsx               Canvas katakana background animation
├── BootSequence.tsx             Staggered terminal init sequence (Framer Motion)
├── LoadingSkeletons.tsx         Matrix-pulsing skeleton loaders
│
│  ── Phone ───────────────────────────────────────────────────────────────────
├── PhoneInput.tsx               250+ country combobox + AsYouType formatter + validation
├── ResultsDashboard.tsx         All phone result panels — no N/A cards
├── PentesterPanel.tsx           Live clock, call window, NPA intel, attack surface flags
├── MetricCard.tsx               Animated metric tile
├── FraudScoreBar.tsx            Animated 0–100 fraud score bar
├── NumberBreakdown.tsx          Visual digit structure breakdown
├── NumberPermutations.tsx       11 format variants for OSINT database searching
├── DorkGenerator.tsx            18 pre-built Google dorks with copy + open buttons
├── OsintPivots.tsx              38 investigation links across 6 categories
├── SimIntelPanel.tsx            SIM intelligence — owner, prepaid, active, MCC/MNC
├── QrCodePanel.tsx              Canvas QR code for tel: URI
├── CountryPanel.tsx             Bundled country intelligence display
├── FormatPanel.tsx              Format cross-reference + validation matrix
├── HistorySidebar.tsx           localStorage history drawer (last 20 lookups)
├── ShareButton.tsx              Copies ?q= shareable URL to clipboard
├── SourceTabs.tsx               Raw JSON per API source
├── ReportExport.tsx             Download report as .txt or .html
│
│  ── Email ───────────────────────────────────────────────────────────────────
├── EmailInput.tsx               Email input with regex validation + status line
├── EmailResultsDashboard.tsx    Full email results — threat score, breach panel, identity, reputation
├── BreachPanel.tsx              Breach database results — per-breach detail, password risk, warnings
└── EmailOsintPivots.tsx         25 investigation links across 4 categories

lib/
├── phoneAnalysis.ts             Offline phone engine (110+ country timezone map, area codes, NXX)
├── emailAnalysis.ts             Offline email engine (classification, name inference)
├── countryIntel.ts              Bundled dataset for 40+ countries (zero API)
├── usNpaDatabase.ts             US/CA NPA area code database (350+ entries, offline)
├── disposableEmailDomains.ts    300+ disposable domains + webmail + privacy + role prefix sets
├── types.ts                     Full TypeScript interface tree (phone + email)
├── cache.ts                     24h in-memory Map cache
├── rateLimit.ts                 Token-bucket rate limiter (10/min/IP)
├── flagEmoji.ts                 Country code → emoji flag
└── utils.ts                     Tailwind merge helper
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

## Accepted input formats

### Phone numbers

Any format libphonenumber-js can parse:

```
+14155552671          # E.164 (recommended)
+44 7911 123456       # International with spaces
+33 1 42 86 83 26     # French format
+91 98765 43210       # Indian format
001 (415) 555-2671    # US with IDD prefix
```

### Email addresses

Standard RFC 5322 format:

```
user@domain.com
first.last@corporate.org
user+tag@provider.net
```

---

## Troubleshooting

**Port 3000 already in use**
`start.sh` automatically detects the next available port and prints the correct URL.

**Phone shows as INVALID**
Include the full country calling code: `+1` for US/Canada, `+44` for UK, etc. Or select the country from the dropdown.

**Carrier / Fraud Score not showing**
These fields require API keys. Add them to `.env.local`. Country, type, timezone, and format data always populate without any keys.

**Email breach panel shows no data**
XposedOrNot may rate-limit repeated lookups. Wait a moment and try again. A clean result ("no exposures found") is also a valid outcome.

**`npm run dev` fails with MODULE_NOT_FOUND**
Use `bash start.sh` or `npm run setup` instead. Both invoke Next.js via `node node_modules/next/dist/bin/next` and bypass any symlink issues.

---

## License

MIT — use freely, attribution appreciated.

---

*Metadata only · No real-time location · No device tracking · Authorized use only*
