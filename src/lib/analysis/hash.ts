// ── File-hash / IOC OSINT — pure hash logic + response parsing ───────────────
//
// Detects the algorithm of a file hash and turns the keyless CIRCL hashlookup
// response into an analyst-facing reputation. hashlookup answers one question
// with authority: is this hash a KNOWN piece of software, present in NSRL and
// other curated "known-good" databases? A hit means the file is almost certainly
// benign, catalogued software; a miss means only that it is unknown to those
// databases — NOT that it is malicious.
//
// That asymmetry is the whole discipline here. A keyless known-good source can
// clear a hash, but it can never convict one. So a miss is reported as "unknown,
// pivot to a verdict engine", never as a detection, and the malware-verdict
// engines (VirusTotal, abuse.ch) are offered only as manual pivots. There is no
// false-positive surface: we assert benign only on a real database hit and
// assert nothing on a miss.

export type HashKind = "md5" | "sha1" | "sha256";

/** Classify a bare hex hash by length, or null when it is not one. */
export function detectHashKind(raw: string): HashKind | null {
  const s = raw.trim().toLowerCase();
  // Bare hex only. A 0x prefix (an Ethereum address is 0x + 40 hex) fails the
  // charset test here on the "x", so wallet addresses never misroute to a hash.
  if (!/^[0-9a-f]+$/.test(s)) return null;
  if (s.length === 32) return "md5";
  if (s.length === 40) return "sha1";
  if (s.length === 64) return "sha256";
  return null;
}

export interface HashFacts {
  kind: HashKind;
  /** The queried hash, lower-cased. */
  input: string;
  /** True only when the hash is present in a known-software database. */
  known: boolean;
  fileName: string | null;
  fileSize: number | null;
  productName: string | null;
  /** Curating source, e.g. "NSRL". */
  source: string | null;
  /** Specific database, e.g. "nsrl_modern_rds". */
  database: string | null;
  /** hashlookup trust score, 0-100. */
  trust: number | null;
  // Cross-algorithm hashes returned by hashlookup — completeness + pivots.
  md5: string | null;
  sha1: string | null;
  sha256: string | null;
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

function productName(v: unknown): string | null {
  if (v && typeof v === "object" && "ProductName" in v) {
    return asStr((v as Record<string, unknown>).ProductName);
  }
  return null;
}

/**
 * Turn a hashlookup HTTP result into facts.
 *   • 200 with a record  → known:true, with whatever fields were returned.
 *   • 404 (or a 200 that only carries a "Non existing …" message) → known:false,
 *     a valid negative answer, NOT an error.
 *   • anything else (network failure, 5xx) → null, so the route reports an outage
 *     rather than a false "clean".
 */
export function buildHashFacts(kind: HashKind, input: string, status: number, json: unknown): HashFacts | null {
  const empty = {
    kind, input, fileName: null, fileSize: null, productName: null,
    source: null, database: null, trust: null, md5: null, sha1: null, sha256: null,
  };
  if (status === 404) return { ...empty, known: false };
  if (status !== 200) return null;
  const d = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  if (!d) return null;
  // A hashlookup miss always carries a "Non existing …" message (some deployments
  // answer it 200 rather than 404); a found record never has a `message` field.
  if (typeof d.message === "string") return { ...empty, known: false };
  return {
    kind,
    input,
    known: true,
    fileName: asStr(d.FileName),
    fileSize: asNum(d.FileSize),
    productName: productName(d.ProductCode),
    source: asStr(d.source),
    database: asStr(d.db),
    trust: asNum(d["hashlookup:trust"]),
    md5: asStr(d.MD5),
    sha1: asStr(d["SHA-1"]),
    sha256: asStr(d["SHA-256"]),
  };
}

export interface HashReputation {
  label: string;
  tone: "good" | "unknown";
  detail: string;
}

/** The single, carefully-scoped verdict a keyless known-good source can give. */
export function hashReputation(f: HashFacts): HashReputation {
  if (f.known) {
    const via = f.source ? ` (${f.source})` : "";
    return {
      tone: "good",
      label: "Known software",
      detail: `Catalogued as legitimate, known software${via}. This is a known-good match, not a malware verdict.`,
    };
  }
  return {
    tone: "unknown",
    label: "Not in known-software databases",
    detail: "Absent from NSRL and other known-good sets. That is not a detection: pivot to a multi-engine verdict to classify it.",
  };
}

/** Verdict engines and threat-intel repositories to pivot into (open in browser). */
export function hashPivots(kind: HashKind, hash: string): { label: string; url: string; note: string }[] {
  const h = encodeURIComponent(hash);
  return [
    { label: "VirusTotal", url: `https://www.virustotal.com/gui/file/${h}`, note: "Multi-engine AV verdict, behaviour and relations" },
    { label: "MalwareBazaar", url: `https://bazaar.abuse.ch/browse.php?search=${kind}%3A${h}`, note: "abuse.ch malware sample repository" },
    { label: "ThreatFox", url: `https://threatfox.abuse.ch/browse/?search=ioc%3A${h}`, note: "abuse.ch indicator-of-compromise database" },
    { label: "Hybrid Analysis", url: `https://www.hybrid-analysis.com/search?query=${h}`, note: "Sandbox detonation and behaviour reports" },
    { label: "MalShare", url: `https://malshare.com/search.php?query=${h}`, note: "Community malware sample sharing" },
    { label: "Web search", url: `https://www.google.com/search?q=%22${h}%22`, note: "Open-web mentions of the hash" },
  ];
}
