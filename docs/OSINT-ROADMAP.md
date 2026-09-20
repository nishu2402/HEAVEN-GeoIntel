# OSINT depth: gap analysis and roadmap

Last reviewed 2026-09-14.

This document answers three questions the project keeps coming back to: what can
the tool already do, where is it genuinely limited, and what is worth building
next without breaking the two rules that define it (keyless first, and never a
false positive). The limits are stated plainly, since a confident wrong answer is
the one failure this tool is built to avoid.

## 1. Where the tool stands today

- 11 lookup and workbench modes: phone, email, username, IP, domain, wallet,
  hash, file, bulk, graph, cases.
- 34 registered sources, 25 of them keyless. Every keyed source degrades to
  "not configured" and never blocks a lookup.
- One deduplicated breach union across sources, per identifier, with per-breach
  data classes, dates, record counts, verified and password flags.
- Three vendored, keyless breach catalogs that describe a breach a per-account
  source returned by name only: a rich credential tier (HIBP plus XposedOrNot,
  their overlapping rows unioned) and a scoped Wikipedia notable-breaches tier
  for large institutional incidents the credential indexes never carry.
- 100 percent test coverage on everything that ships (the `src/lib` tree, every
  API route, the proxy and every component), enforced in CI.

For a single analyst working keyless, it is already close to a one stop
console.

## 2. The breach question, answered honestly

The recurring report is "this tool shows a few breaches for my address, other
sites show many". Measured on a real address on 2026-09-05:

- XposedOrNot returned 3 breaches. LeakCheck returned the same 3. Their union is
  3, and each one already carries what leaked and when.
- Sites that show "more" for the same address are almost always reading Have I
  Been Pwned's per-account API (a paid key) or a paid credential database such
  as DeHashed or Snusbase. Those hold breaches the free indexes never received.

So for a lightly exposed address, 3 is not the tool undercounting. It is the
true keyless answer, and the tool now says so in the panel: the union is a
floor, not a ceiling.

There are only two ways to show more, and the project's rules decide both:

1. Read a paid index. The tool already supports this for HIBP: set an API key
   and its breaches join the same union automatically, no code change. This is
   opt in, so keyless installs are unaffected.
2. Invent the extra breaches. This is forbidden. The zero false positive rule
   means the tool will never assert an exposure it cannot attribute to a real
   source.

Everything below works within those rules.

## 3. What shipped in this pass (2026-09-05)

- Dropped the `id` junk data class. LeakCheck lists `id`, a leaked table's
  internal row id, among its exposed fields. It is not exposed PII, so it was
  surfacing as a meaningless chip beside real classes. It is now filtered out of
  the union while the raw per-source panel still shows LeakCheck's fields
  verbatim for provenance.
- Added XposedOrNot's breach catalog as a second keyless enrichment source,
  merged with the HIBP catalog. Measured, this adds 43 breaches the HIBP
  snapshot lacks: regional leaks (Flipkart, BDV, CouponMom) and combo or stealer
  lists (AntiPublic, 14 billion records). A bare breach name from LeakCheck that
  matches one of these now gets its data classes and record count filled in.
- Made the keyless ceiling explicit in the unified breach panel, and pointed the
  analyst at the paid indexes in the OSINT matrix for a manual deep dive.

## 3b. Shipped in the follow-up pass (2026-09-05)

- Pwned Passwords range check (roadmap quick win 1) shipped in hash mode over
  k-anonymity: the browser sends only a five-character SHA-1 prefix, relayed
  through the tool's own endpoint, and matches the suffix locally.
- Keyless mail-exchange fingerprint (roadmap medium item 3) shipped in email
  mode. It resolves the domain's MX records over the existing Cloudflare DoH
  source and names the mail provider (Google Workspace, Microsoft 365,
  Proofpoint, Mimecast, Zoho, Proton, a self-managed server, and so on). It is
  corroboration about the domain, never a claim that an address is valid, and it
  reused the DNS source so the source count did not move.
- Domain-mode regional breaches (roadmap medium item 4) need no further work:
  `breachesForDomain` already reads the merged HIBP plus XposedOrNot index, so
  the extra regional leaks XON carries surface in domain mode automatically.
- Third keyless enrichment catalog (roadmap quick win 2) shipped as a scoped
  Wikipedia notable-breaches tier. A survey first confirmed there is no third
  keyless catalog API that carries per-breach data classes: HackMyIP has no
  breach endpoint, BreachDirectory is key-walled, LeakCheck is per-account only,
  and Wikidata models no breach records. Wikipedia's "List of data breaches" is
  the one real, keyless, machine-readable option, so `refresh-wikipedia-breaches.mjs`
  vendors the rows with a clean numeric record count into
  `wikipediaBreaches.snapshot.json`. These are large government and institutional
  incidents the credential catalogs never carry; the tier holds no data classes
  and no domains, is subtracted of any key the rich tier already describes, is
  tried only after the rich tier, and is counted separately so the describable
  figure is not inflated. Measured, it adds about 60 institutional breaches the
  credential tier lacks. Because those entities are almost never what a per-account
  or domain lookup returns, the tier is now surfaced on its own terms rather than
  left to a lookup that never matches it: a keyless, searchable Notable Breaches
  reference in the header, backed by a new `/api/notable-breaches` route that reads
  the bundled snapshot largest first. That gives the vendored rows a home the
  analyst can actually use, so the "future notable breaches view" this tier was
  scoped for now exists. It stays a reference of known breaches by size, never a
  presence claim about any identifier.
- Catalog merge upgraded from richer-wins to a UNION. When HIBP and XposedOrNot
  both describe one breach, `buildCatalogIndex` now merges their data classes and
  fills any missing field from the other row, so a breach both know is described
  with the combined field set instead of one row winning and the other's
  exclusive classes being discarded.

## 3c. What shipped in the depth pass (2026-09-13)

Three of the gaps below were closed by measurement rather than by a key, and two
workflow items that had been parked as "needs infrastructure" turned out to need
none.

- **Identity fusion now requires proof.** A shared handle was being read as
  evidence of one owner. Two keyless proofs are accepted, a public self-link and
  a server-side perceptual avatar match; everything else is labelled a
  candidate and capped. This is the false-positive rule applied to the one place
  in the tool that was still guessing.
- **The WhatsMyName catalog is read for its detection contract**, not just its
  URLs: 242 validated sites swept per request, 392 more on request, each
  classified only when the response matches the contract's found or free pair.
- **Passive DNS and reverse IP are keyless** (see 4.3), and both feed subdomain
  coverage alongside two certificate-transparency sources that now always run.
  `wordpress.org` went from 9 reported subdomains to 494.
- **Port and CVE exposure is read for a domain's own addresses**, using the
  sources the IP mode already had.
- **GLEIF legal-entity lookup**, keyless, driven by the WHOIS registrant or, for
  the GDPR-redacted majority, by the organisation a CA verified on an OV or EV
  certificate.
- **OFAC SDN screening is vendored offline**, 1,056 addresses across 20 chains,
  in the same pattern as the breach catalogs.
- **Internationalised names are first-class** in every domain and email input.
- **An evidence locker** completes the chain a report starts: response bytes,
  SHA-256, per-case manifest, and a verify pass that re-hashes every artifact.
- **A change inbox** (see 4.4), **bulk as a real job across every mode**, and a
  **headless CLI** over the same HTTP API.

## 4. Gap analysis

### 4.1 Breach and credential depth
- Per-account presence is capped by the keyless indexes that answer "is THIS
  identifier breached": XposedOrNot, LeakCheck, ProxyNova COMB (email only) and
  Hudson Rock (stealer logs). That pool is small and already fully used. There
  is no known additional keyless per-account breach index to add.
- Enrichment breadth (describing a named breach) is now vendored from three
  keyless catalogs: HIBP plus XON for credential breaches, and a Wikipedia
  notable-breaches tier for institutional ones. That is close to the keyless
  ceiling; there is no further reliable keyless catalog API carrying per-breach
  data classes to add.
- Real credential values live only behind paid databases. The tool masks
  everything it does see and links out to the paid options rather than pretending
  to hold them.

### 4.2 Password exposure
- CLOSED. The tool reports which breaches carried a password, and hash mode now
  also answers whether a specific password is in a breach corpus, keyless, over
  the Pwned Passwords range API's k-anonymity (only a five-character SHA-1
  prefix leaves the browser, relayed through the tool's own endpoint). See
  section 3b. Nothing keyless remains in this gap.

### 4.3 Infrastructure and network
- IP, domain, ASN, routing, subdomain takeover and typosquat are covered
  keyless.
- The claim that reverse IP and passive DNS "at depth are mostly keyed
  upstreams" was wrong, and was corrected by measurement on 2026-09-13: Mnemonic
  returns 1,000 passive-DNS records for `wordpress.org` without a key, and
  HackerTarget returns 499 reverse-IP hostnames for one address. Both are now
  native panels and both also feed subdomain coverage. See section 3c.
- What remains genuinely keyed here is historical depth beyond a single free
  tier: full passive-DNS history over years, and reverse IP without a daily
  quota. Those stay pivot links.

### 4.4 Workflow
- On demand case snapshots and diffs exist, and the half of alerting that needs
  no key now exists too: an in-tool change inbox over the snapshots already on
  disk, with an optional outbound webhook (`CHANGE_WEBHOOK_URL`). See section 3c.
- What is still unbuilt on purpose is the SCHEDULER. Re-running a case on a
  timer needs a persistent process this deployment model does not assume, and
  delivery by email or push needs a key. The inbox answers "what moved" without
  either.

## 5. Roadmap, keyless first

Ordered by value per unit of effort. None of these add a mandatory dependency.

### Quick wins
1. Pwned Passwords range check (k-anonymity) in the hash and credential views.
   Keyless, high value, well bounded. SHIPPED (see section 3b).
2. Vendor one or two more keyless breach catalogs for enrichment breadth, using
   the same snapshot and merge pattern the HIBP and XON catalogs already use.
   SHIPPED as the Wikipedia notable-breaches tier (see section 3b), the one real
   keyless catalog left after HIBP and XON. It is deliberately scoped and
   low-yield for a per-account or domain lookup, because those two catalogs
   already describe most breaches such a lookup can return; the same pass also
   upgraded the HIBP-plus-XON merge to a data-class union so their overlapping
   rows reinforce rather than replace each other.

### Medium
3. Email reputation corroboration from a keyless signal where one exists, kept
   strictly as corroboration and never as a presence claim. SHIPPED as the
   keyless MX mail-provider fingerprint (see section 3b). Further keyless
   corroboration signals can still be added under the same rule.
4. Domain mode: surface the newly merged catalog's extra regional breaches in
   the known-breaches panel. SATISFIED: `breachesForDomain` already reads the
   merged HIBP plus XON index, so those breaches surface without extra wiring.

### Larger
5. A local, opt in enrichment cache so repeated lookups during an engagement do
   not re-hit rate limited upstreams.
6. Case scheduling once a deployment target with a persistent scheduler exists.
   Alert delivery stays behind an explicit, user supplied channel. The
   key-free half of this shipped as the change inbox and its optional webhook
   (see 3c); only the timer is outstanding.
7. Re-validate the WhatsMyName catalog on a schedule. 255 of 672 contracts
   passed validation on 2026-09-12, and the failures are mostly real rather
   than artefacts: Instagram and Spotify, probed alone and unhurried, answer 200
   for a real handle and a nonexistent one alike with neither marker present, so
   no honest server-side classification exists for them. A periodic re-run would
   let recovered sites rejoin the default sweep.

## 6. Optional depth, only if you choose a key

If matching a paid site's breach count matters for a specific engagement, the
only honest way is to add the key that site uses:

- HIBP: set `HIBP_API_KEY`. Its per-account breaches join the union and the
  headline can match HIBP's own count. Already wired, zero code change.
- DeHashed, Snusbase, IntelligenceX: paid, and intentionally left as manual
  pivots in the OSINT matrix rather than integrated, so a keyless install never
  implies it can reach them.

Everything else in this document stays true whether or not any key is set.
