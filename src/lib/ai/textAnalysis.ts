// ── On-device ML: text intelligence (bundled weights, keyless, offline) ──────
//
// This is the model layer of Phase 2. It runs three genuinely useful NLP tasks
// on arbitrary pasted or extracted text, entirely in-process with no network and
// no API key:
//
//   1. entity extraction  — pull the identifiers a text already contains
//      (emails, IPs, domains, URLs, crypto wallets, file hashes, E.164 phones,
//      @handles), each verbatim from the input and shape-validated.
//   2. text classification — a small bag-of-words model with checked-in weights
//      that labels the topic (credentials, network, financial, threat, personal)
//      so an analyst can triage a wall of pasted text at a glance.
//   3. language identification — script + stopword profiles, also bundled.
//
// The founding rule of the whole AI layer holds here without exception: nothing
// is invented. Every extracted entity is a substring of the input that passed a
// strict shape check, so the "extraction" is grounded the same way autoPivot's
// suggestions are. The classifier and language guess are labels ABOUT the text,
// each carrying a confidence, never a new fact about any subject. The "bundled
// weights" are the keyword and stopword tables below: kilobytes of checked-in
// data, so the tool ships an ML capability that works with the network unplugged.

// ── Entity extraction ────────────────────────────────────────────────────────

export type MlEntityKind =
  | "email" | "ip" | "domain" | "url" | "phone" | "wallet" | "hash" | "username";

export interface MlEntity {
  kind: MlEntityKind;
  /** The matched text, verbatim (normalised for case where the kind allows). */
  value: string;
  /**
   * How confident we are this substring IS an identifier of this kind, in
   * [0,1]. A URL-embedded host is near-certain; a bare @handle could be a
   * mention rather than an account, so it scores lower. Extraction never emits a
   * value that failed its shape check, so even the low end is a real candidate.
   */
  confidence: number;
}

// The common public suffixes a bare token must end in to be read as a domain.
// This is the precision guard: without it "report.pdf" or "config.yaml" would be
// extracted as domains. Emails and URLs carry their own unambiguous host, so
// they are NOT gated on this set — only free-standing tokens are.
const COMMON_TLDS = new Set([
  "com", "net", "org", "io", "co", "gov", "edu", "mil", "int", "info", "biz",
  "app", "dev", "xyz", "online", "site", "tech", "cloud", "ai", "me", "tv",
  "us", "uk", "ca", "au", "de", "fr", "nl", "ru", "cn", "jp", "kr", "in",
  "br", "es", "it", "se", "no", "fi", "dk", "pl", "ch", "at", "be", "cz",
  "pt", "gr", "ie", "nz", "za", "mx", "ar", "cl", "tr", "ua", "ir", "sa",
  "ae", "sg", "hk", "tw", "th", "id", "my", "ph", "vn", "eu", "gg", "sh",
  "to", "cc", "ws", "is", "li", "ly", "fm", "gl", "st", "so", "re", "pw",
]);

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const ETH_RE = /\b0x[a-fA-F0-9]{40}\b/g;
const BTC_RE = /\b(?:bc1[a-z0-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g;
const HASH_RE = /\b(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{40}|[a-fA-F0-9]{32})\b/g;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const IPV6_RE = /\b(?:[a-fA-F0-9]{1,4}:){2,7}[a-fA-F0-9]{1,4}\b|\b(?:[a-fA-F0-9]{1,4}:){1,7}:/g;
const PHONE_RE = /\+[1-9]\d{6,14}\b/g;
const HANDLE_RE = /(?:^|[\s(:])@([a-zA-Z0-9_]{2,30})\b/g;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi;

/** Blank out a matched span so a later, broader pattern can't re-claim it. */
function blank(text: string, start: number, len: number): string {
  return text.slice(0, start) + " ".repeat(len) + text.slice(start + len);
}

/** The registered suffix of a host, lower-cased (the part after the last dot). */
function tld(host: string): string {
  const parts = host.toLowerCase().split(".");
  return parts[parts.length - 1];
}

interface Pattern {
  kind: MlEntityKind;
  re: RegExp;
  confidence: number;
  /** The capture group index to take as the value (0 = whole match). */
  group?: number;
  /** Optional extra guard beyond the regex; return false to reject a match. */
  accept?: (value: string) => boolean;
}

// Order matters: a URL and an email each contain a host, and an ETH address is
// 40 hex digits that the SHA-1 branch of HASH_RE would otherwise claim. Running
// the specific, self-delimiting patterns first and blanking their spans means
// the broad domain / hash patterns only ever see text nothing else took.
const PATTERNS: Pattern[] = [
  { kind: "url", re: URL_RE, confidence: 0.97 },
  { kind: "email", re: EMAIL_RE, confidence: 0.97 },
  { kind: "wallet", re: ETH_RE, confidence: 0.95 },
  { kind: "wallet", re: BTC_RE, confidence: 0.9 },
  { kind: "hash", re: HASH_RE, confidence: 0.85 },
  { kind: "ip", re: IPV4_RE, confidence: 0.95 },
  { kind: "ip", re: IPV6_RE, confidence: 0.85 },
  { kind: "phone", re: PHONE_RE, confidence: 0.9 },
  { kind: "username", re: HANDLE_RE, confidence: 0.55, group: 1 },
  { kind: "domain", re: DOMAIN_RE, confidence: 0.7, accept: (v) => COMMON_TLDS.has(tld(v)) },
];

/** Lower-case the value for kinds where case is not significant. */
function normaliseValue(kind: MlEntityKind, value: string): string {
  if (kind === "email" || kind === "domain" || kind === "ip") return value.toLowerCase();
  return value;
}

/**
 * Pull every identifier the text contains. Pure and deterministic: same input →
 * same ordered, de-duped list. Never emits a value that failed its shape check,
 * so a caller can trust each entry is a real candidate of that kind.
 */
export function extractEntities(text: string): MlEntity[] {
  let working = text;
  const out: MlEntity[] = [];
  const seen = new Set<string>();

  for (const p of PATTERNS) {
    // Collect this pattern's matches before mutating `working`, so overlapping
    // matches of the SAME pattern are all captured; then blank every span.
    const spans: { start: number; len: number }[] = [];
    for (const m of working.matchAll(p.re)) {
      const whole = m[0];
      let value = (p.group ? m[p.group] : whole) as string;
      // A URL match greedily absorbs the sentence punctuation that follows it
      // ("…example.net." / "…example.net,"); trim it so the stored value is the
      // URL alone. Everything else is already delimited by its own shape.
      if (p.kind === "url") value = value.replace(/[.,;:!?]+$/, "");
      const at = m.index + whole.indexOf(value);
      if (p.accept && !p.accept(value)) continue;
      const norm = normaliseValue(p.kind, value);
      const key = `${p.kind}:${norm.toLowerCase()}`;
      spans.push({ start: at, len: value.length });
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: p.kind, value: norm, confidence: p.confidence });
    }
    for (const s of spans) working = blank(working, s.start, s.len);
  }

  return out;
}

// ── Text classification (bag-of-words, checked-in weights) ───────────────────

export type TextCategory =
  | "credentials" | "network" | "financial" | "threat" | "personal" | "neutral";

export interface CategoryScore {
  category: TextCategory;
  score: number;
}

export interface TextClassification {
  /** The winning label, or "neutral" when no category has any evidence. */
  category: TextCategory;
  /** Share of total weight the winner holds, in [0,1]. 0 when neutral. */
  confidence: number;
  /** Every non-zero category, strongest first — the explainability trail. */
  scores: CategoryScore[];
}

// The bundled "model": the words that vote for each topic. Weights are small
// integers reflecting how strongly a term implies its category. This is a
// deliberately legible Naive-Bayes-shaped table, not a black box — an analyst
// can read exactly why a paste was labelled the way it was.
const KEYWORD_WEIGHTS: Record<Exclude<TextCategory, "neutral">, Record<string, number>> = {
  credentials: {
    password: 3, passwd: 3, pwd: 2, login: 2, username: 1, credential: 3,
    credentials: 3, hash: 1, combo: 3, dump: 2, leak: 2, plaintext: 3,
    bcrypt: 2, md5: 1, sha1: 1, cracked: 2, hashcat: 3, wordlist: 2,
    // A breach is where leaked credentials come from, so the term votes here too
    // (it also votes for `threat` below) — a word may belong to several topics.
    breach: 1,
  },
  network: {
    port: 2, ports: 2, cve: 3, vulnerability: 3, nmap: 3,
    shodan: 3, subnet: 2, firewall: 2, router: 1, dns: 2, tls: 1, ssl: 1,
    proxy: 2, vpn: 2, scan: 2, banner: 1, ssh: 2, rdp: 2, ip: 1,
  },
  financial: {
    wallet: 3, bitcoin: 3, ethereum: 3, crypto: 2, transaction: 2, wire: 2,
    iban: 3, swift: 2, payment: 2, invoice: 2, btc: 2, eth: 1, usdt: 2,
    ledger: 2, blockchain: 2, satoshi: 2, ransom: 2,
  },
  threat: {
    malware: 3, ransomware: 3, phishing: 3, trojan: 3, stealer: 3, botnet: 2,
    c2: 3, backdoor: 3, exfiltration: 3, payload: 2, dropper: 2, apt: 2,
    threat: 1, attacker: 2, compromise: 2, breach: 1, ioc: 3, rat: 2, exploit: 2,
  },
  personal: {
    address: 2, phone: 2, email: 1, birthday: 2, dob: 3, ssn: 3, passport: 3,
    "driver": 1, license: 1, resident: 1, tax: 2, name: 1, contact: 1,
    gender: 1, nationality: 2, employer: 1,
  },
};

// Invert the table once at module load: word → [category, weight] votes. Lookup
// per token is then a single Map.get, and the whole classify pass is one loop.
const WORD_VOTES = new Map<string, [Exclude<TextCategory, "neutral">, number][]>();
for (const [category, words] of Object.entries(KEYWORD_WEIGHTS) as [Exclude<TextCategory, "neutral">, Record<string, number>][]) {
  for (const [word, weight] of Object.entries(words)) {
    const votes = WORD_VOTES.get(word) ?? [];
    votes.push([category, weight]);
    WORD_VOTES.set(word, votes);
  }
}

/** Split text into lower-case word tokens (letters and digits only). */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Label the topic of a block of text. Pure. When no keyword fires the result is
 * `neutral` with confidence 0 — the model never forces a category onto text that
 * gave it no evidence.
 */
export function classifyText(text: string): TextClassification {
  const totals = new Map<Exclude<TextCategory, "neutral">, number>();
  for (const token of tokenize(text)) {
    const votes = WORD_VOTES.get(token);
    if (!votes) continue;
    for (const [category, weight] of votes) {
      totals.set(category, (totals.get(category) ?? 0) + weight);
    }
  }

  const scores: CategoryScore[] = [...totals.entries()]
    .map(([category, score]) => ({ category, score }))
    .sort((a, b) => b.score - a.score || a.category.localeCompare(b.category));

  if (scores.length === 0) {
    return { category: "neutral", confidence: 0, scores: [] };
  }
  const total = scores.reduce((sum, s) => sum + s.score, 0);
  const top = scores[0];
  return { category: top.category, confidence: top.score / total, scores };
}

// ── Language identification (script + stopword profiles, bundled) ────────────

export interface LanguageGuess {
  /** ISO-639-1 code, or "unknown" when nothing scored. */
  language: string;
  confidence: number;
}

// A non-Latin script is a strong, cheap signal: the first pattern that matches
// wins. Script is not language, so these are best-effort guesses at the most
// common language for each script, and they carry a moderate confidence.
const SCRIPT_PATTERNS: [RegExp, string, number][] = [
  [/[぀-ヿ]/, "ja", 0.9],       // hiragana / katakana → Japanese
  [/[가-힯]/, "ko", 0.9],       // hangul → Korean
  [/[一-鿿]/, "zh", 0.8],       // han → Chinese (also used by ja)
  [/[؀-ۿ]/, "ar", 0.9],       // Arabic
  [/[Ѐ-ӿ]/, "ru", 0.8],       // Cyrillic → Russian (most common)
  [/[Ͱ-Ͽ]/, "el", 0.9],       // Greek
  [/[֐-׿]/, "he", 0.9],       // Hebrew
  [/[฀-๿]/, "th", 0.9],       // Thai
];

// Latin-script languages are separated by their most frequent function words.
const STOPWORDS: Record<string, string[]> = {
  en: ["the", "and", "of", "to", "in", "is", "that", "for", "with", "was", "this"],
  es: ["el", "la", "de", "que", "los", "las", "una", "por", "con", "para", "del"],
  fr: ["le", "la", "les", "des", "une", "que", "pour", "dans", "avec", "est", "sur"],
  de: ["der", "die", "und", "das", "den", "mit", "ist", "nicht", "auch", "ein", "von"],
  pt: ["de", "que", "os", "as", "uma", "para", "com", "não", "por", "mais", "dos"],
  it: ["il", "di", "che", "la", "le", "un", "per", "con", "non", "una", "sono"],
  nl: ["de", "het", "een", "en", "van", "dat", "niet", "met", "voor", "zijn", "op"],
};

// Invert to word → languages that count it as a stopword.
const STOPWORD_INDEX = new Map<string, string[]>();
for (const [lang, words] of Object.entries(STOPWORDS)) {
  for (const word of words) {
    const langs = STOPWORD_INDEX.get(word) ?? [];
    langs.push(lang);
    STOPWORD_INDEX.set(word, langs);
  }
}

/**
 * Guess the language of the text. A non-Latin script short-circuits to its most
 * likely language; otherwise Latin text is scored by stopword overlap. Returns
 * `unknown` at confidence 0 when there is nothing to go on (too short, or no
 * recognised function words). Pure.
 */
export function detectLanguage(text: string): LanguageGuess {
  for (const [re, language, confidence] of SCRIPT_PATTERNS) {
    if (re.test(text)) return { language, confidence };
  }

  const hits = new Map<string, number>();
  for (const token of tokenize(text)) {
    const langs = STOPWORD_INDEX.get(token);
    if (!langs) continue;
    for (const lang of langs) hits.set(lang, (hits.get(lang) ?? 0) + 1);
  }

  const ranked = [...hits.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length === 0) return { language: "unknown", confidence: 0 };
  const total = ranked.reduce((sum, [, n]) => sum + n, 0);
  const [language, top] = ranked[0];
  return { language, confidence: top / total };
}
