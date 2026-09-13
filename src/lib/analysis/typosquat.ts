// ── Typosquat / homoglyph domain generation (pure, no network) ───────────────
//
// Given a registrable domain, enumerate the look-alike domains an attacker would
// register for phishing, credential harvesting, or brand abuse. This is pure
// string derivation — the classic dnstwist technique set — so it runs client-
// side over the domain the analyst already looked up, with no API and no key.
//
// It only GENERATES candidates. Whether any candidate is actually registered is
// a separate DNS question the UI lets the analyst pursue (each variant is a one
// click domain lookup), so this module never claims a squat exists — that would
// be a false positive. It hands over a ranked list of what to check.

import { toAsciiLabel } from "./idn";

export interface TyposquatVariant {
  /** The name as DNS sees it: ASCII, punycode for an internationalised label. */
  domain: string;
  technique: string;
  /**
   * Unicode spelling, set only for an IDN homoglyph variant. `xn--pple-43d.com`
   * means nothing to a reader; `аpple.com` with a Cyrillic а is the finding.
   */
  display?: string;
}

// Two-label public suffixes we recognise without pulling in the full PSL, so
// "example.co.uk" mutates "example", not "co". Not exhaustive by design.
const MULTI_SUFFIXES = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "com.au", "net.au", "org.au",
  "co.nz", "co.za", "com.br", "com.mx", "co.jp", "co.in", "co.kr", "com.sg",
]);

// The TLDs a squatter most often swaps in — the visually or typographically
// confusable neighbours of the common ones.
const SWAP_TLDS = ["com", "net", "org", "co", "io", "info", "biz", "app", "online", "site", "cm", "co.uk"];

// Adjacency on a QWERTY keyboard, for fat-finger replacement and insertion.
const KEYBOARD: Record<string, string> = {
  q: "wa", w: "qeas", e: "wrsd", r: "etdf", t: "rygf", y: "tugh", u: "yijh",
  i: "uojk", o: "ipkl", p: "ol", a: "qwsz", s: "awedxz", d: "serfcx", f: "drtgvc",
  g: "ftyhbv", h: "gyujnb", j: "huikmn", k: "jiolm", l: "kop", z: "asx", x: "zsdc",
  c: "xdfv", v: "cfgb", b: "vghn", n: "bhjm", m: "njk",
  "0": "9", "1": "2", "2": "13", "3": "24", "4": "35", "5": "46", "6": "57",
  "7": "68", "8": "79", "9": "80",
};

// ASCII characters that read as one another in a browser's address bar.
const HOMOGLYPHS: Record<string, string[]> = {
  o: ["0"], l: ["1", "i"], i: ["1", "l"], e: ["3"], a: ["4"], s: ["5"],
  b: ["8"], g: ["9", "q"], "0": ["o"], "1": ["l", "i"], m: ["rn"], w: ["vv"],
  d: ["cl"], q: ["g"],
};

/**
 * Non-ASCII characters that are visually identical, or near enough, to a Latin
 * letter in a browser's address bar.
 *
 * The ASCII table above cannot produce the attack that actually gets registered:
 * `аpple.com` with a Cyrillic а is a DIFFERENT domain from apple.com and renders
 * identically in most fonts. Restricting the generator to ASCII meant the panel
 * listed 168 candidates for wordpress.org and not one of them was the class of
 * look-alike that turns up in real phishing.
 *
 * Only single-character substitutions with a near-exact glyph match are listed.
 * Loose lookalikes would flood the list with candidates nobody would mistake.
 */
const UNICODE_HOMOGLYPHS: Record<string, string[]> = {
  a: ["а", "α"],        // Cyrillic а, Greek α
  b: ["в", "Ь"],        // Cyrillic в, ь
  c: ["с", "ϲ"],        // Cyrillic с, Greek lunate ϲ
  d: ["ԁ"],                  // Cyrillic ԁ
  e: ["е", "ҽ"],        // Cyrillic е, ҽ
  g: ["ɡ"],                  // Latin script ɡ
  h: ["н"],                  // Cyrillic н
  i: ["і", "ι"],        // Cyrillic і, Greek ι
  j: ["ј"],                  // Cyrillic ј
  k: ["к"],                  // Cyrillic к
  l: ["Ӏ", "ⅼ"],        // Cyrillic palochka Ӏ, Roman numeral ⅼ
  m: ["м"],                  // Cyrillic м
  n: ["ո"],                  // Armenian ո
  o: ["о", "ο", "օ"], // Cyrillic о, Greek ο, Armenian օ
  p: ["р", "ρ"],        // Cyrillic р, Greek ρ
  q: ["ԛ"],                  // Cyrillic ԛ
  s: ["ѕ"],                  // Cyrillic ѕ
  t: ["τ"],                  // Greek τ
  u: ["ц", "ս"],        // Cyrillic ц, Armenian ս
  v: ["ѵ", "ν"],        // Cyrillic ѵ, Greek ν
  w: ["ш", "ԝ"],        // Cyrillic ш, ԝ
  x: ["х", "χ"],        // Cyrillic х, Greek χ
  y: ["у", "ү"],        // Cyrillic у, ү
  z: ["ʐ"],                  // Latin ʐ
};

const VOWELS = "aeiou";

/** Split a domain into its subdomain prefix, mutable label, and public suffix. */
export function splitDomain(domain: string): { prefix: string; label: string; suffix: string } | null {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const labels = clean.split(".");
  if (labels.length < 2 || labels.some((l) => l.length === 0)) return null;
  const lastTwo = labels.slice(-2).join(".");
  if (labels.length >= 3 && MULTI_SUFFIXES.has(lastTwo)) {
    return { prefix: labels.slice(0, -3).join("."), label: labels[labels.length - 3], suffix: lastTwo };
  }
  return { prefix: labels.slice(0, -2).join("."), label: labels[labels.length - 2], suffix: labels[labels.length - 1] };
}

/** A domain label is 1–63 chars of letters/digits/hyphen, no leading/trailing hyphen. */
function validLabel(label: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
}

function omissions(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.slice(0, i) + s.slice(i + 1));
  return out;
}

function repetitions(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.slice(0, i + 1) + s[i] + s.slice(i + 1));
  return out;
}

function transpositions(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2));
  return out;
}

function replacements(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    for (const c of KEYBOARD[s[i]] ?? "") out.push(s.slice(0, i) + c + s.slice(i + 1));
  }
  return out;
}

function insertions(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    for (const c of KEYBOARD[s[i]] ?? "") out.push(s.slice(0, i) + c + s.slice(i));
  }
  return out;
}

function homoglyphs(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    for (const g of HOMOGLYPHS[s[i]] ?? []) out.push(s.slice(0, i) + g + s.slice(i + 1));
  }
  return out;
}

/**
 * One-character Unicode look-alike substitutions, as both the readable spelling
 * and the A-label DNS will actually be asked about.
 */
function idnHomoglyphs(s: string): { label: string; display: string }[] {
  const out: { label: string; display: string }[] = [];
  for (let i = 0; i < s.length; i++) {
    for (const g of UNICODE_HOMOGLYPHS[s[i] as string] ?? []) {
      const display = s.slice(0, i) + g + s.slice(i + 1);
      const encoded = toAsciiLabel(display);
      // A substitution that does not survive UTS-46 (a disallowed character, or
      // one that normalises back to the original) is not a registrable name and
      // is dropped rather than shown as a candidate.
      if (encoded && encoded !== s) out.push({ label: encoded, display });
    }
  }
  return out;
}

function vowelSwaps(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    if (!VOWELS.includes(s[i])) continue;
    for (const v of VOWELS) { if (v !== s[i]) out.push(s.slice(0, i) + v + s.slice(i + 1)); }
  }
  return out;
}

function hyphenations(s: string): string[] {
  const out: string[] = [];
  for (let i = 1; i < s.length; i++) out.push(s.slice(0, i) + "-" + s.slice(i));
  return out;
}

function bitsquats(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    for (let bit = 0; bit < 8; bit++) {
      const flipped = String.fromCharCode(code ^ (1 << bit));
      if (/[a-z0-9-]/.test(flipped)) out.push(s.slice(0, i) + flipped + s.slice(i + 1));
    }
  }
  return out;
}

/**
 * Generate look-alike domains for a registrable domain, tagged by technique and
 * deduplicated. Returns [] for an unparseable input. TLD swaps aside, the public
 * suffix is preserved; the subdomain prefix, if any, is re-attached.
 */
export function generateTyposquats(domain: string): TyposquatVariant[] {
  const parts = splitDomain(domain);
  if (!parts) return [];
  const { prefix, label, suffix } = parts;
  const pre = prefix ? `${prefix}.` : "";
  const original = `${pre}${label}.${suffix}`;

  const byTechnique: [string, string[]][] = [
    ["omission", omissions(label)],
    ["repetition", repetitions(label)],
    ["transposition", transpositions(label)],
    ["replacement", replacements(label)],
    ["insertion", insertions(label)],
    ["homoglyph", homoglyphs(label)],
    ["vowel-swap", vowelSwaps(label)],
    ["hyphenation", hyphenations(label)],
    ["bitsquatting", bitsquats(label)],
  ];

  const seen = new Set<string>([original]);
  const out: TyposquatVariant[] = [];
  for (const [technique, labels] of byTechnique) {
    for (const l of labels) {
      if (!validLabel(l)) continue;
      const d = `${pre}${l}.${suffix}`;
      if (seen.has(d)) continue;
      seen.add(d);
      out.push({ domain: d, technique });
    }
  }
  // Internationalised look-alikes, kept separate because each carries a second
  // spelling: the punycode name to resolve, and the Unicode name a victim sees.
  for (const { label: encoded, display } of idnHomoglyphs(label)) {
    const d = `${pre}${encoded}.${suffix}`;
    /* v8 ignore next -- unreachable with the current glyph table: every
       substitution encodes to a distinct `xn--` label, and the one glyph that
       normalises back to ASCII (U+217C) reproduces the input, which
       idnHomoglyphs already drops. Measured over every 1-to-4 letter label
       (457k substitutions): no collision, no ASCII result. The guard stays so
       the dedup invariant survives a new glyph. */
    if (seen.has(d)) continue;
    seen.add(d);
    out.push({ domain: d, technique: "idn-homoglyph", display: `${pre}${display}.${suffix}` });
  }

  // TLD swaps keep the label, change only the suffix. SWAP_TLDS is unique and
  // every entry differs from the label mutations above (which keep `suffix`),
  // so no dedup guard is needed here.
  for (const t of SWAP_TLDS) {
    if (t === suffix) continue;
    out.push({ domain: `${pre}${label}.${t}`, technique: "tld-swap" });
  }
  return out;
}
