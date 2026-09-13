// ── Internationalised names: one canonical host form, both ways ──────────────
//
// Every domain-shaped input used to meet an ASCII-only regex, so `münchen.de`
// and `test@münchen.de` were rejected outright as invalid while their punycode
// spelling `xn--mnchen-3ya.de` sailed through. That is backwards for OSINT work:
// homoglyph and IDN abuse is a large share of real phishing, and the analyst who
// pastes the name as it appears in the mail they are investigating is the one
// the tool must serve first.
//
// So a host is normalised ONCE, here, to its ASCII (A-label) form via the
// platform's own UTS-46 implementation in `URL` — the same table browsers use to
// decide what a name resolves to, rather than a hand-rolled mapping. The reverse
// direction matters for reading: `xn--80ak6aa92e.com` tells an analyst nothing,
// `аpple.com` tells them everything, so `toUnicodeHost` decodes the A-labels for
// display. Nothing here guesses: an input that will not parse comes back null,
// and a label that will not decode is shown exactly as it arrived.

// ── Punycode decoding (RFC 3492) ─────────────────────────────────────────────
// Encoding comes free from `URL`. Decoding does not: Node's `punycode` module is
// deprecated and the browser exposes no equivalent, and this runs in both. The
// algorithm is the reference one, variable names included, so it reads against
// the RFC.

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const DELIMITER = "-";
const MAX_CODE_POINT = 0x10ffff;

/** A basic code point's digit value, or null when it is not a digit at all. */
function basicToDigit(code: number): number | null {
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 26; // 0-9 → 26-35
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;       // a-z → 0-25
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;       // A-Z → 0-25
  return null;
}

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

/**
 * Decode one punycode payload (the part after `xn--`) to its Unicode label, or
 * null when the payload is malformed. Malformed is the common case in the wild:
 * a truncated or invented `xn--` label is exactly what a phishing domain list is
 * full of, and it must read as "cannot decode", never as an invented name.
 */
export function punycodeDecode(payload: string): string | null {
  if (payload === "") return null;
  const lastDelim = payload.lastIndexOf(DELIMITER);
  const basic = lastDelim > 0 ? payload.slice(0, lastDelim) : "";
  // Basic code points must be ASCII, and the payload itself must be ASCII.
  if (!/^[\x20-\x7e]*$/.test(payload)) return null;
  const output: number[] = [];
  for (const ch of basic) output.push(ch.codePointAt(0) as number);

  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  let index = lastDelim > 0 ? lastDelim + 1 : 0;

  while (index < payload.length) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= payload.length) return null;          // ran out mid-number
      const digit = basicToDigit(payload.charCodeAt(index++));
      if (digit === null || digit >= BASE) return null;
      if (digit > Math.floor((0x7fffffff - i) / w)) return null; // overflow
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      /* v8 ignore next -- `w` only passes this bound on a code point's 7th
         digit, which needs a bias of 235 or more; adapt() tops out at 198 for
         any reachable delta, so the `i` overflow above rejects such an input
         first. Measured: 600k fuzzed payloads never reach it. The RFC's own
         guard stays, because the ceiling is a property of the constants. */
      if (w > Math.floor(0x7fffffff / (BASE - t))) return null;  // overflow
      w *= BASE - t;
    }
    const outLength = output.length + 1;
    bias = adapt(i - oldi, outLength, oldi === 0);
    if (Math.floor(i / outLength) > 0x7fffffff - n) return null;
    n += Math.floor(i / outLength);
    i %= outLength;
    if (n > MAX_CODE_POINT || (n >= 0xd800 && n <= 0xdfff)) return null; // lone surrogate
    output.splice(i++, 0, n);
  }

  return String.fromCodePoint(...output);
}

// ── Host normalisation ───────────────────────────────────────────────────────

/** One DNS label: 1-63 of letters/digits/hyphen, no leading or trailing hyphen. */
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A hostname with at least two labels, each syntactically valid, ASCII only. */
export function isValidAsciiHost(host: string): boolean {
  if (host.length > 253) return false;
  const labels = host.split(".");
  return labels.length >= 2 && labels.every((l) => LABEL_RE.test(l));
}

/**
 * Canonical ASCII host for any domain-shaped input: Unicode or punycode, bare
 * or wrapped in a URL, with or without a port, scheme, path or trailing dot.
 * Returns null when the input is not a hostname at all.
 *
 * `@` is rejected rather than parsed. `URL` reads `a@b.com` as credentials plus
 * the host `b.com`, so accepting it would silently look up a different name than
 * the one the analyst typed.
 */
export function toAsciiHost(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes("@")) return null;
  const withoutScheme = trimmed.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  /* v8 ignore next -- `split` always yields at least one element, so the `??`
     is a type-narrowing formality rather than a reachable branch. */
  const hostish = withoutScheme.split(/[/?#\\]/)[0] ?? "";
  if (!hostish) return null;
  let host: string;
  try {
    host = new URL(`http://${hostish}`).hostname;
  } catch {
    return null; // spaces, empty labels, an unparseable IDN
  }
  // A fully-qualified name's root dot is correct DNS and meaningless to every
  // upstream here, so it is dropped rather than rejected.
  host = host.replace(/\.$/, "");
  return isValidAsciiHost(host) ? host : null;
}

/**
 * Display form of an ASCII host: every `xn--` label decoded back to Unicode.
 * A label that does not decode is kept verbatim, so the result is always
 * readable and never fabricated.
 */
export function toUnicodeHost(host: string): string {
  return host
    .split(".")
    .map((label) => {
      if (!/^xn--/i.test(label)) return label;
      return punycodeDecode(label.slice(4)) ?? label;
    })
    .join(".");
}

/** True when the ASCII host carries at least one internationalised label. */
export function isIdnHost(host: string): boolean {
  return host.split(".").some((l) => /^xn--/i.test(l));
}

/**
 * Encode a Unicode label to its A-label form, or null when it cannot be encoded.
 * Used by the typosquat generator, which produces Cyrillic and Greek look-alikes
 * that only mean something once they are spelled the way DNS will see them.
 */
export function toAsciiLabel(label: string): string | null {
  const host = toAsciiHost(`${label}.test`);
  if (!host) return null;
  const encoded = host.slice(0, -".test".length);
  /* v8 ignore next -- toAsciiHost has already rejected an empty label (a host
     of ".test" does not parse), so the empty case cannot arrive here. */
  return encoded ? encoded : null;
}

// ── Email addresses ──────────────────────────────────────────────────────────

export interface NormalizedEmail {
  /** The address with its domain in ASCII form — what every upstream is given. */
  email: string;
  local: string;
  /** ASCII (A-label) domain. */
  domain: string;
  /** Unicode domain for display; equal to `domain` for an ASCII name. */
  domainUnicode: string;
}

/**
 * Characters an address's local part may use here. Deliberately narrower than
 * RFC 5321 (no quoted strings, no SMTPUTF8 Unicode), because every upstream in
 * this tool takes a plain ASCII mailbox and a wider rule would only produce
 * lookups that fail further down.
 */
const LOCAL_RE = /^[a-zA-Z0-9._%+\-]+$/;

/**
 * Is this a well-formed address?
 *
 * The one definition, shared by the input field and the analysis, because two
 * copies drifted: both were `…@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`, whose final
 * group cannot match an A-label. That rejected every internationalised TLD, so
 * `a@пример.рф` (which punycodes to `xn--e1afmkfd.xn--p1ai`) was reported as a
 * malformed address rather than looked up.
 */
export function isValidEmailFormat(input: string): boolean {
  const n = normalizeEmail(input);
  return n !== null && LOCAL_RE.test(n.local);
}

/**
 * Split and normalise an address, punycoding the domain half. The local part is
 * left exactly as typed: it is the mailbox owner's business, case can be
 * significant, and SMTPUTF8 allows Unicode there.
 */
export function normalizeEmail(input: string): NormalizedEmail | null {
  const trimmed = input.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = toAsciiHost(trimmed.slice(at + 1));
  if (!domain) return null;
  return { email: `${local}@${domain}`, local, domain, domainUnicode: toUnicodeHost(domain) };
}
