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

### Global command

After running `bash start.sh` once, a `geointel` shell function is registered in `~/.zshrc`. Open a new terminal and type:

```bash
geointel
```

To install it manually at any time:
```bash
npm run install-global
```

---

<a id="phone-intelligence"></a>
## 📞 Phone Intelligence

<p align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&height=4&color=0:FFAA00,50:FF3333,100:BF5FFF"/>
</p>

### What you get with zero configuration

Every phone lookup returns real data derived from the number structure and bundled datasets — no simulation, no placeholders.

<div align="center">

| Panel | What It Shows |
|---|---|
| **Result Header** | E.164 · country flag · line type badge · caller name (API) · ambiguity warning |
| **Threat Assessment** | Fraud score · VoIP/prepaid/abuse flags · risk level |
| **Pentester Panel** | Live local time · call window (business/evening/late/weekend) · NPA area code intel · attack surface analysis |
| **Number Structure** | Country code · area code · subscriber number · NXX prefix — country-specific extraction (US/CA · GB · DE · FR · AU) |
| **Metric Cards** | Only populated fields — no N/A cards. 6–8 offline; up to 16 with API keys |
| **Format Cross-Reference** | E.164 · International · National · RFC 3966 — all copyable |
| **Number Permutations** | 11 format variants for database/OSINT searching (dots · dashes · URL-encoded · WhatsApp link · etc.) |
| **SIM & Carrier Intel** | Owner/CNAM · carrier · prepaid status · active status · MCC/MNC/PLMN · associated emails |
| **Country Intelligence** | Capital · continent · region · population · currency · languages · driving side · emergency number · internet penetration · GDP per capita |
| **Dork Generator** | 18 pre-built Google dorks — LinkedIn · Facebook · Twitter · GitHub · Pastebin · credential dumps · PDFs |
| **OSINT Pivots** | 38 investigation links across 6 categories |
| **QR Code** | Canvas-rendered QR for the `tel:` URI · downloadable as PNG |
| **Report Export** | Full intelligence report as `.txt` or `.html` |
| **History Drawer** | Last 20 lookups saved in browser localStorage |
| **Shareable URL** | `?q=+14155552671` auto-runs the lookup |

</div>

### NPA Area Code Database (US/CA)

350+ US and Canadian area codes bundled offline, mapped to: state/province · metro region/major city · IANA timezone · country. Every US/CA number immediately shows local time, call window, and geographic context — **zero API calls**.

### Phone OSINT Pivots — 38 links, 6 categories

<div align="center">

| Category | Services |
|---|---|
| **Identity / Reverse Lookup** | Truecaller · Sync.me · NumLookup · That's Them · Spy Dialer · CallerSmart · TruePeopleSearch · FastPeopleSearch · USPhoneBook · AnyWho · Infobel · PhoneBook.com |
| **Breach / Data Exposure** | Epieos · HaveIBeenPwned · IntelligenceX · Dehashed · LeakCheck |
| **Social / Open Web** | Google (LinkedIn · Facebook · Instagram · Twitter) · Bing · Google Maps · Pastebin |
| **Messaging Platforms** | WhatsApp (wa.me/) · Telegram (+prefix) · Signal · Viber · iMessage check |
| **Carrier / Telecom** | FreeCarrierLookup · HLR-Lookups · TextMagic · MNP portability checker |
| **Intel / Deep Search** | IntelligenceX · Dehashed · Epieos correlation · HIBP · LeakCheck |

</div>

### Accepted Phone Formats

```
+14155552671          # E.164 (recommended)
+44 7911 123456       # International with spaces
+33 1 42 86 83 26     # French format
+91 98765 43210       # Indian format
001 (415) 555-2671    # US with IDD prefix
```

---

<a id="email-intelligence"></a>
## 📧 Email Intelligence

<p align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&height=4&color=0:BF5FFF,50:00D9D9,100:FFAA00"/>
</p>

### What you get with zero configuration

Every email lookup runs offline analysis instantly, then fans out to free data sources simultaneously.

<div align="center">

| Panel | What It Shows |
|---|---|
| **Identity Header** | Confirmed name (Gravatar) or inferred name (username pattern) · avatar photo · location · threat score bar |
| **Threat Score** | 0–100 risk score — breach count · password risk level · recency · reputation signals |
| **Breach Database** | Real breach results from XposedOrNot — 1000+ databases · no API key required |
| **Breach Detail** | Per-breach: name · year · record count · exposed data types · password risk level (Plaintext / Easy Crack / Hashed) |
| **Risk Flags** | Critical banners when plaintext passwords or crackable hashes are found |
| **Email Classification** | Provider type (corporate/free/disposable/privacy/government/educational) · disposable detection (300+ domains) · role address detection |
| **Gravatar Profile** | Display name · username · location · about · linked social accounts — free, no key |
| **Reputation** | EmailRep.io signals: suspicious · blacklisted · malicious activity · credentials leaked · spam · first/last seen · registered platforms |
| **Validation** | AbstractAPI: deliverability · quality score (0–1) · SMTP validity · MX records · catch-all detection |
| **Deliverability** | Hunter.io: deliverable/risky/undeliverable · confidence score · SMTP check |
| **OSINT Matrix** | 25 investigation links across 4 categories |
| **Report Export** | Full intelligence report as `.txt` including all breach details |

</div>

### Breach Intelligence — XposedOrNot

The core feature for pentesters. XposedOrNot aggregates 1000+ breach databases and returns:

- **Which specific breaches** the email appeared in (LinkedIn 2012, Adobe 2013, etc.)
- **What data was stolen** in each breach (Passwords · Usernames · Phone Numbers · Credit Cards…)
- **Password risk level** per breach:
  - `PLAINTEXT` — credentials fully compromised. Assume all reused passwords are known.
  - `EASY CRACK` — MD5/SHA1 hashes, crackable with Hashcat/rainbow tables within hours
  - `HASHED` — bcrypt/SHA-256, significantly harder to crack
- **Record count** — how large the breach was
- **Verification status** — whether the breach is confirmed authentic

No API key required. Free to use.

### Email OSINT Pivots — 25 links, 4 categories

<div align="center">

| Category | Services |
|---|---|
| **Breach / Credential Exposure** | HaveIBeenPwned · IntelligenceX · Dehashed · LeakCheck · Snusbase · BreachDirectory |
| **Identity / OSINT Correlation** | Epieos · Gravatar · EmailRep.io · That's Them · Hunter.io Domain Search · Pipl |
| **Social Media / Open Web** | Google dorks (LinkedIn · Twitter · Facebook · GitHub) · GitHub commit search · Bing · Pastebin |
| **Domain / Infrastructure** | MXToolbox · WHOIS · ViewDNS · Spamhaus · SecurityTrails · Shodan |

</div>

### Accepted Email Formats

```
user@domain.com
first.last@corporate.org
user+tag@provider.net
```

---

<a id="api-enrichment"></a>
## 🔑 Optional API Enrichment

<p align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&height=4&color=0:44FF88,50:FFAA00,100:BF5FFF"/>
</p>

The app works fully without API keys. Add keys to `.env.local` for deeper intelligence.

### Phone Enrichment

<div align="center">

| Service | What It Adds | Free Tier |
|---|---|---|
| **IPQualityScore** | Fraud score · VoIP flag · recent abuse · risk flag · prepaid · active status · user activity · city · associated emails | 200/day |
| **NumVerify** | Carrier name · line type · location | 100/month |
| **AbstractAPI** (phone) | Carrier · line type · country | 250/month |
| **Twilio Lookup v2** | Carrier name · owner/CNAM · MCC · MNC | ~$0.005/lookup |

</div>

### Email Enrichment

<div align="center">

| Service | What It Adds | Free Tier |
|---|---|---|
| **Hunter.io** | Email deliverability · confidence score · SMTP check | 25/month |
| **AbstractAPI** (email) | SMTP validity · MX records · quality score · catch-all detection | 250/month |
| **EmailRep.io** | Reputation · breach flags · platform registrations — works without key | Higher quota with key |

</div>

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

Sign up: [IPQualityScore](https://www.ipqualityscore.com) · [NumVerify](https://numverify.com) · [AbstractAPI](https://www.abstractapi.com) · [Twilio](https://www.twilio.com) · [Hunter.io](https://hunter.io) · [EmailRep.io](https://emailrep.io)

---

<a id="how-it-works"></a>
## ⚙️ How It Works

<p align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&height=4&color=0:00D9D9,50:BF5FFF,100:FF3333"/>
</p>

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

<a id="data-accuracy"></a>
## ✅ Data Accuracy

<p align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&height=4&color=0:FFAA00,50:44FF88,100:00D9D9"/>
</p>

### Phone — always accurate (offline, zero APIs)

- Country · calling code · flag emoji
- Number validity (libphonenumber-js strict validation)
- Number type — mobile / fixed / VoIP / toll-free / premium / pager / personal
- Ambiguous type: `FIXED_LINE_OR_MOBILE` shown as "TYPE AMBIGUOUS" — never falsely claimed
- IANA timezone + UTC offset (110+ countries/territories)
- Area code — extracted for US/CA · GB · DE · FR · AU · IT · ES · PL · NL only
- NXX central office code — from subscriber portion, not area code
- All 4 number formats
- Expected digit length per country
- State/province · metro region · local timezone for US/CA (NPA database)

### Email — offline analysis (zero APIs)

- Disposable provider detection (300+ throwaway services)
- Privacy provider detection (ProtonMail · Tutanota · Riseup · etc.)
- Free webmail detection (Gmail · Outlook · Yahoo · iCloud · etc.)
- Role address detection (admin@ · support@ · info@ · noreply@ · etc.)
- Provider name resolution (50+ known providers)
- Government/military detection (.gov · .mil · .gov.uk · .gov.au)
- Educational detection (.edu · .ac.uk · .edu.au · .ac.in)
- Name inference from username patterns (`john.smith` → "John Smith")

---

<a id="security"></a>
## 🔒 Security

<p align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&height=4&color=0:FF3333,50:FFAA00,100:44FF88"/>
</p>

<div align="center">

| Control | Implementation |
|---|---|
| **API key isolation** | All external calls happen in server-side API routes — keys never leave the server. Verified: `grep -r "process.env" .next/static/` returns nothing. |
| **Security headers** | `X-Frame-Options: DENY` · `X-Content-Type-Options: nosniff` · `Referrer-Policy` · `Permissions-Policy` (blocks geolocation/camera/mic) · `Content-Security-Policy` |
| **No tracking** | Derives metadata from number/email structure and public databases only. No geolocation, no device tracking. |
| **Rate limiting** | 10 requests/minute/IP — prevents bulk scraping and abuse |
| **Safe dependencies** | `libphonenumber-js` is Google's libphonenumber compiled to JS. No telemetry packages. |

</div>

---

<a id="project-structure"></a>
## 📁 Project Structure

<p align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&height=4&color=0:BF5FFF,50:FF3333,100:FFAA00"/>
</p>

```
app/
├── api/
│   ├── lookup/route.ts          ← Phone POST endpoint — parse, analyze, fan-out, aggregate
│   └── email-lookup/route.ts    ← Email POST endpoint — Gravatar, XON, EmailRep, Abstract, Hunter
├── layout.tsx                   ← Root layout — JetBrains Mono, meta tags, OG/Twitter cards
├── page.tsx                     ← Main page — mode switcher, boot sequence, input, results
├── not-found.tsx                ← Custom 404 (matrix theme)
├── robots.ts                    ← robots.txt
└── globals.css                  ← Matrix/terminal theme, CRT scanlines, shadcn overrides

components/
│
│  ── Shared ──────────────────────────────────────────────────────────
├── MatrixRain.tsx               ← Canvas katakana background animation
├── BootSequence.tsx             ← Staggered terminal init (Framer Motion)
├── LoadingSkeletons.tsx         ← Matrix-pulsing skeleton loaders
│
│  ── Phone ────────────────────────────────────────────────────────────
├── PhoneInput.tsx               ← 250+ country combobox + AsYouType formatter + validation
├── ResultsDashboard.tsx         ← All phone result panels — no N/A cards
├── PentesterPanel.tsx           ← Live clock, call window, NPA intel, attack surface flags
├── MetricCard.tsx               ← Animated metric tile
├── FraudScoreBar.tsx            ← Animated 0–100 fraud score bar
├── NumberBreakdown.tsx          ← Visual digit structure breakdown
├── NumberPermutations.tsx       ← 11 format variants for OSINT database searching
├── DorkGenerator.tsx            ← 18 pre-built Google dorks with copy + open buttons
├── OsintPivots.tsx              ← 38 investigation links across 6 categories
├── SimIntelPanel.tsx            ← SIM intelligence — owner, prepaid, active, MCC/MNC
├── QrCodePanel.tsx              ← Canvas QR code for tel: URI
├── CountryPanel.tsx             ← Bundled country intelligence display
├── FormatPanel.tsx              ← Format cross-reference + validation matrix
├── HistorySidebar.tsx           ← localStorage history drawer (last 20 lookups)
├── ShareButton.tsx              ← Copies ?q= shareable URL to clipboard
├── SourceTabs.tsx               ← Raw JSON per API source
└── ReportExport.tsx             ← Download report as .txt or .html
│
│  ── Email ────────────────────────────────────────────────────────────
├── EmailInput.tsx               ← Email input with regex validation + status line
├── EmailResultsDashboard.tsx    ← Full email results — threat score, breach, identity, reputation
├── BreachPanel.tsx              ← Per-breach detail, password risk, warnings
└── EmailOsintPivots.tsx         ← 25 investigation links across 4 categories

lib/
├── phoneAnalysis.ts             ← Offline phone engine (110+ country timezone map, area codes, NXX)
├── emailAnalysis.ts             ← Offline email engine (classification, name inference)
├── countryIntel.ts              ← Bundled dataset for 40+ countries (zero API)
├── usNpaDatabase.ts             ← US/CA NPA area code database (350+ entries, offline)
├── disposableEmailDomains.ts    ← 300+ disposable domains + webmail + privacy + role prefix sets
├── types.ts                     ← Full TypeScript interface tree (phone + email)
├── cache.ts                     ← 24h in-memory Map cache
├── rateLimit.ts                 ← Token-bucket rate limiter (10/min/IP)
├── flagEmoji.ts                 ← Country code → emoji flag
└── utils.ts                     ← Tailwind merge helper
```

---

<a id="tech-stack"></a>
## ⚡ Tech Stack

<p align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&height=4&color=0:00D9D9,25:FFAA00,50:BF5FFF,75:44FF88,100:FF3333"/>
</p>

<div align="center">

| Layer | Technology |
|---|---|
| **Framework** | Next.js 15 (App Router) |
| **Language** | TypeScript — full interface tree for all data types |
| **Phone Parsing** | `libphonenumber-js` — Google's libphonenumber compiled to JS |
| **UI** | Tailwind CSS · shadcn/ui components |
| **Animation** | Framer Motion (boot sequence) · Canvas API (katakana rain · QR code) |
| **Breach Data** | XposedOrNot (free · no key) |
| **Profile Data** | Gravatar (free · no key) |
| **Reputation** | EmailRep.io (free · no key) |
| **Phone Enrichment** | IPQualityScore · NumVerify · AbstractAPI · Twilio (all optional) |
| **Email Enrichment** | Hunter.io · AbstractAPI (both optional) |
| **Caching** | In-memory Map · LRU eviction · 24h TTL · 500 entries max |
| **Rate Limiting** | Token-bucket per IP · 10 req/min |
| **Font** | JetBrains Mono (monospace) · system sans for body |

</div>

---

<a id="available-scripts"></a>
## 📜 Available Scripts

<p align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&height=4&color=0:44FF88,50:00D9D9,100:BF5FFF"/>
</p>

<div align="center">

| Command | What It Does |
|---|---|
| `bash start.sh` | One-step: install deps · register global command · start dev server |
| `npm run setup` | Same as above, npm version |
| `npm run install-global` | Register the `geointel` shell command in `~/.zshrc` |
| `npm run dev` | Start dev server (requires prior `npm install`) |
| `npm run build` | Production build |
| `npm run start` | Start production server (requires prior `npm run build`) |
| `npm run lint` | ESLint check |

</div>

---

<a id="troubleshooting"></a>
## 🔧 Troubleshooting

<p align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&height=4&color=0:FF3333,50:FFAA00,100:44FF88"/>
</p>

### Port 3000 already in use
`start.sh` automatically detects the next available port and prints the correct URL. No manual action needed.

### Phone shows as INVALID
Include the full country calling code: `+1` for US/Canada, `+44` for UK, etc. Or select the country from the combobox dropdown — it will format the number automatically.

### Carrier / Fraud Score not showing
These fields require API keys in `.env.local`. Country, type, timezone, and all format data always populate without any keys.

### Email breach panel shows no data
XposedOrNot may rate-limit repeated lookups. Wait a moment and retry. A clean result ("no exposures found") is also a valid — and good — outcome.

### `npm run dev` fails with MODULE_NOT_FOUND
Use `bash start.sh` or `npm run setup` instead. Both invoke Next.js via `node node_modules/next/dist/bin/next` and bypass symlink issues.

---

<a id="disclaimer"></a>
## ⚠️ Disclaimer

<p align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&height=4&color=0:FF3333,50:FFAA00,100:FF3333"/>
</p>

> **HEAVEN-GeoIntel is an OSINT research and authorized penetration testing tool.**
>
> This tool returns publicly derivable *metadata* only. It does **not** and **cannot** provide real-time GPS location, live device tracking, SS7 interception, or any form of unauthorized surveillance.
>
> Use only within your authorized engagement scope. Unauthorized use against systems or individuals you do not have explicit permission to investigate may be illegal in your jurisdiction.

---

<p align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&height=200&color=0:05070F,20:0D0500,40:1A0A00,60:7A3500,80:FFAA00,100:05070F&section=footer&text=Made%20with%20%F0%9F%94%90%20by%20Nisarg%20Chasmawala%20(HEAVEN)&fontSize=22&fontAlignY=65&fontColor=FFAA00&animation=twinkling"/>
</p>

<p align="center">
<strong>⭐ If this project helped you, please give it a star on GitHub!</strong>
</p>

<p align="center">
<img src="https://img.shields.io/github/stars/nishu2402/HEAVEN-GeoIntel?style=social" alt="Stars"/>
<img src="https://img.shields.io/github/forks/nishu2402/HEAVEN-GeoIntel?style=social" alt="Forks"/>
<img src="https://img.shields.io/github/watchers/nishu2402/HEAVEN-GeoIntel?style=social" alt="Watchers"/>
</p>
