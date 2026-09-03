// ── Live HTTP + TLS probe (domain mode) ──────────────────────────────────────
//
// Everything else in domain mode asks a third party about the target. This
// module is the only place the tool talks to the target itself, which makes it
// both the most useful source for a pentester (headers and a certificate are
// ground truth, not someone's cached opinion) and the only one that needs an
// SSRF guard.
//
// The judgement lives in analysis/httpPosture.ts. This file does the network.

import tls from "node:tls";
import { classifyIp } from "../analysis/ipClassify";
import { withUserAgent } from "./fetchSafe";
import {
  gradeSecurityHeaders, fingerprintTech, findDisclosures, analyzeCookies, decodeEntities,
} from "../analysis/httpPosture";
import type { HttpProbe, TlsInfo, HeaderMap } from "../types";

const HTTP_TIMEOUT_MS = 6000;
const TLS_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;
/** Enough markup for <title> and every generator/asset-path marker. */
const BODY_SNIFF_BYTES = 24_000;

/**
 * SSRF guard.
 *
 * The other domain-mode sources are safe by construction: the request goes to
 * Cloudflare or crt.sh and the target is only ever a query parameter. This one
 * connects to whatever the user typed, so a hostname that resolves inward turns
 * the server into a proxy for its own network. `localtest.me` and
 * `1.0.0.127.nip.io` both resolve to 127.0.0.1 while passing every syntactic
 * domain check, and cloud metadata at 169.254.169.254 is the classic target.
 *
 * The addresses come from the DoH answers the route has already collected, so
 * this costs nothing extra. Requiring EVERY address to be globally routable —
 * rather than merely one — means a split-horizon name that answers with both a
 * public and an internal address is refused rather than raced.
 *
 * This is not a complete defence: DNS can change between our resolution and the
 * connection (a DNS-rebinding race). It removes the trivially exploitable case,
 * and a deployment exposing this tool to untrusted users should also egress-
 * filter the container.
 */
export function isProbeTarget(addresses: string[]): boolean {
  if (addresses.length === 0) return false;
  return addresses.every((ip) => classifyIp(ip)?.isGloballyRoutable === true);
}

function headerMap(res: Response): HeaderMap {
  const out: HeaderMap = {};
  res.headers.forEach((v, k) => { out[k.toLowerCase()] = v; });
  // `Response.headers.forEach` collapses repeated Set-Cookie headers on some
  // runtimes; getSetCookie() is the spec-blessed way to get all of them, and
  // the cookie audit is worthless if it only sees the first one.
  const all = res.headers.getSetCookie?.() ?? [];
  if (all.length) out["set-cookie"] = all.join(", ");
  return out;
}

/** Read at most `limit` bytes of the body, then abandon the rest. */
async function readPrefix(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  try {
    while (out.length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
  } catch {
    /* a truncated body is still worth fingerprinting */
  } finally {
    void reader.cancel().catch(() => {});
  }
  return out.slice(0, limit);
}

/**
 * Follow redirects by hand so the chain itself becomes evidence.
 *
 * `redirect: "follow"` would be less code, but it discards exactly the part a
 * pentester wants: whether the apex bounces through a third-party domain, how
 * many hops it takes, and whether any hop drops back to http://.
 */
async function walk(startUrl: string): Promise<{ res: Response; url: string; chain: string[] } | null> {
  let url = startUrl;
  const chain: string[] = [];
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    let res: Response;
    try {
      res = await fetch(url, withUserAgent({
        redirect: "manual",
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
        cache: "no-store",
      }));
    } catch {
      // Nothing usable came back. An earlier version returned a synthetic
      // `new Response(null, { status: 0 })` here to preserve the chain — but the
      // Response constructor rejects any status outside 200-599, so that threw a
      // RangeError out of the probe and took the whole domain lookup with it.
      // The chain was discarded by the caller regardless.
      return null;
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, url).toString();
      chain.push(`${res.status} ${url} → ${next}`);
      /* v8 ignore next -- cancel() rejecting is not reachable from a test */
      void res.body?.cancel().catch(() => {});
      url = next;
      continue;
    }
    return { res, url, chain };
  }
  // Redirect ceiling: a loop, or a chain too long to be a real destination.
  return null;
}

/** Does plain http:// hand the visitor to https://? null when http is dead. */
async function checkHttpsUpgrade(domain: string): Promise<boolean | null> {
  try {
    const res = await fetch(`http://${domain}/`, withUserAgent({
      redirect: "manual", signal: AbortSignal.timeout(HTTP_TIMEOUT_MS), cache: "no-store",
    }));
    /* v8 ignore next -- cancel() rejecting is not reachable from a test */
    void res.body?.cancel().catch(() => {});
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      return new URL(location, `http://${domain}/`).protocol === "https:";
    }
    return false;
  } catch {
    return null;
  }
}

/**
 * A distinguished-name field as a single string.
 *
 * node types these as `string | string[]` because a DN may legitimately repeat
 * an attribute (two O= entries in one subject). Joining beats picking the first:
 * a cross-signed intermediate whose issuer carries both names should show both.
 */
function dn(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? value.join(", ") : value;
}

/** Turn node's `Mar 12 00:00:00 2027 GMT` into an ISO date, or null. */
function certDate(raw: string | undefined): { iso: string | null; ms: number | null } {
  if (!raw) return { iso: null, ms: null };
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return { iso: null, ms: null };
  return { iso: new Date(ms).toISOString().slice(0, 10), ms };
}

/**
 * Certificate + negotiated parameters, straight off the socket.
 *
 * `rejectUnauthorized: false` looks alarming and is the whole point: a
 * self-signed or expired certificate is a FINDING, and refusing the connection
 * would report it as "unreachable" and lose it. Nothing from this socket is
 * trusted or executed — the certificate is read, `authorized` records whether
 * the chain actually validated, and the connection is closed.
 */
export function probeTls(domain: string): Promise<TlsInfo | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: TlsInfo | null) => { if (!settled) { settled = true; resolve(v); } };
    const socket = tls.connect(
      { host: domain, port: 443, servername: domain, rejectUnauthorized: false, timeout: TLS_TIMEOUT_MS },
      () => {
        const cert = socket.getPeerCertificate(false);
        const cipher = socket.getCipher();
        const to = certDate(cert?.valid_to);
        done({
          protocol: socket.getProtocol(),
          cipher: cipher?.name ?? null,
          issuer: cert?.issuer ? (dn(cert.issuer.O) ?? dn(cert.issuer.CN)) : null,
          subject: dn(cert?.subject?.CN),
          altNames: (cert?.subjectaltname ?? "")
            .split(",").map((s) => s.trim().replace(/^DNS:/, "")).filter(Boolean),
          validFrom: certDate(cert?.valid_from).iso,
          validTo: to.iso,
          daysRemaining: to.ms === null ? null : Math.floor((to.ms - Date.now()) / 86_400_000),
          trusted: socket.authorized,
          trustError: socket.authorized ? null : (socket.authorizationError?.message ?? String(socket.authorizationError ?? "untrusted")),
        });
        socket.destroy();
      },
    );
    socket.on("timeout", () => { socket.destroy(); done(null); });
    socket.on("error", () => { socket.destroy(); done(null); });
  });
}

/**
 * Probe the live site. Returns null when there is nothing to probe — the guard
 * refused the target, or 443 answered nothing. Both are ordinary outcomes for a
 * parked or mail-only domain, so neither is reported as a source failure.
 */
export async function probeHttp(domain: string, addresses: string[]): Promise<HttpProbe | null> {
  if (!isProbeTarget(addresses)) return null;

  const [walked, tlsInfo, httpsRedirect] = await Promise.all([
    walk(`https://${domain}/`),
    probeTls(domain),
    checkHttpsUpgrade(domain),
  ]);
  if (!walked) return null;

  const { res, url, chain } = walked;
  const headers = headerMap(res);
  const body = await readPrefix(res, BODY_SNIFF_BYTES);

  return {
    url,
    status: res.status,
    redirectChain: chain,
    httpsRedirect,
    security: gradeSecurityHeaders(headers),
    tech: fingerprintTech(headers, body),
    disclosures: findDisclosures(headers),
    cookies: analyzeCookies(headers["set-cookie"] ?? null),
    title: (() => {
      const raw = body.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1];
      return raw ? decodeEntities(raw).trim().replace(/\s+/g, " ") : null;
    })(),
    tls: tlsInfo,
  };
}
