// ── Email header trace (pure, no network) ────────────────────────────────────
//
// Paste a raw email header block and this reconstructs the delivery path: every
// `Received:` hop oldest-first, the sending IP at each, the time each took, and
// the SPF/DKIM/DMARC verdicts. The origin IP it recovers feeds straight into IP
// mode, so a header block becomes a geolocation + reputation pivot without
// leaving the console. Pure string parsing — nothing is fetched, nothing guessed.
//
// Zero-false-positive discipline: an IP is only reported when it is a
// syntactically valid, in-range IPv4. A hop with no legible sender IP says so
// rather than borrowing one from elsewhere in the line.

export interface ReceivedHop {
  /** 0 = origin (the earliest Received, at the bottom of the stack). */
  index: number;
  from: string | null;
  by: string | null;
  protocol: string | null;
  ip: string | null;
  timestamp: string | null;
  /** Seconds elapsed since the previous (older) hop, when both are dated. */
  delaySeconds: number | null;
}

export interface HeaderAnalysis {
  hops: ReceivedHop[];
  /** The earliest hop's sender IP — the best candidate for the true origin. */
  originIp: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  date: string | null;
  messageId: string | null;
  returnPath: string | null;
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
}

/** Unfold RFC 5322 continuation lines (a line starting with WSP continues the previous). */
function unfold(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length > 0) out[out.length - 1] += " " + line.trim();
    else out.push(line);
  }
  return out;
}

/** All values for a header name (case-insensitive), in file order. */
function headerValues(lines: string[], name: string): string[] {
  const prefix = name.toLowerCase() + ":";
  const out: string[] = [];
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx > 0 && line.slice(0, idx + 1).toLowerCase() === prefix) out.push(line.slice(idx + 1).trim());
  }
  return out;
}

function firstHeader(lines: string[], name: string): string | null {
  return headerValues(lines, name)[0] ?? null;
}

const IPV4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;

function validIpv4(s: string): boolean {
  const parts = s.split(".");
  return parts.length === 4 && parts.every((p) => { const n = Number(p); return p !== "" && n >= 0 && n <= 255; });
}

/** Pull the sender IP out of a Received line — bracketed/parenthesised IPv4 only. */
function extractIp(received: string): string | null {
  const m = received.match(IPV4);
  return m && validIpv4(m[1]) ? m[1] : null;
}

function token(received: string, key: string): string | null {
  const m = received.match(new RegExp(`\\b${key}\\s+([^;\\s]+)`, "i"));
  return m ? m[1] : null;
}

/** The timestamp is what follows the final ";" in a Received header. */
function receivedTimestamp(received: string): string | null {
  const i = received.lastIndexOf(";");
  if (i < 0) return null;
  const ts = received.slice(i + 1).trim();
  return ts || null;
}

function parseAuth(lines: string[], key: string): string | null {
  for (const v of headerValues(lines, "Authentication-Results")) {
    const m = v.match(new RegExp(`\\b${key}=(\\w+)`, "i"));
    if (m) return m[1].toLowerCase();
  }
  return null;
}

export function analyzeHeaders(raw: string): HeaderAnalysis {
  const lines = unfold(raw);
  const received = headerValues(lines, "Received"); // newest-first as they appear

  // Reverse to oldest-first so index 0 is the origin.
  const ordered = [...received].reverse();
  const hops: ReceivedHop[] = ordered.map((r, index) => ({
    index,
    from: token(r, "from"),
    by: token(r, "by"),
    protocol: token(r, "with"),
    ip: extractIp(r),
    timestamp: receivedTimestamp(r),
    delaySeconds: null,
  }));

  // Delay between consecutive dated hops.
  for (let i = 1; i < hops.length; i++) {
    const prev = hops[i - 1].timestamp ? Date.parse(hops[i - 1].timestamp as string) : NaN;
    const cur = hops[i].timestamp ? Date.parse(hops[i].timestamp as string) : NaN;
    if (!Number.isNaN(prev) && !Number.isNaN(cur)) hops[i].delaySeconds = Math.round((cur - prev) / 1000);
  }

  const originIp = hops.find((h) => h.ip !== null)?.ip ?? null;

  // SPF/DKIM/DMARC: prefer Authentication-Results; fall back to Received-SPF for SPF.
  let spf = parseAuth(lines, "spf");
  if (!spf) {
    const rspf = firstHeader(lines, "Received-SPF");
    spf = rspf ? (rspf.match(/^(\w+)/)?.[1]?.toLowerCase() ?? null) : null;
  }

  return {
    hops,
    originIp,
    from: firstHeader(lines, "From"),
    to: firstHeader(lines, "To"),
    subject: firstHeader(lines, "Subject"),
    date: firstHeader(lines, "Date"),
    messageId: firstHeader(lines, "Message-ID"),
    returnPath: firstHeader(lines, "Return-Path"),
    spf,
    dkim: parseAuth(lines, "dkim"),
    dmarc: parseAuth(lines, "dmarc"),
  };
}
