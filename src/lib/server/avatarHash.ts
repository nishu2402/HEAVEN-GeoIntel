// ── Server-side avatar hashing ───────────────────────────────────────────────
//
// The perceptual match that proves "the same photo is on GitHub and Mastodon"
// now happens here instead of in the browser. See analysis/imageGray.ts for why
// the browser could not do it: the canvas read needs CORS, and two of the three
// avatar hosts in a measured lookup send no CORS header at all.
//
// Two things this adds beyond moving the work:
//
//   • PLACEHOLDER FILTERING. mastodon.social serves
//     /avatars/original/missing.png to every account with no photo. Hashing it
//     "matched" unrelated accounts that had merely both left the default in
//     place, and the identity card presented that file as the subject's avatar.
//     Known defaults are recognised and excluded by URL, with the pattern that
//     matched recorded so the panel can say why.
//   • AN SSRF GUARD. An avatar URL is attacker-controlled input: anyone can set
//     their profile photo to http://169.254.169.254/latest/meta-data/. Only
//     https is fetched, only hosts that resolve to globally-routable addresses,
//     redirects are followed by hand with every hop re-checked, and the body is
//     size-capped.

import { withUserAgent } from "./fetchSafe";
import { mapLimit } from "./concurrency";
import { resolvesPublic } from "./httpProbe";
import { decodeGrayscale, resampleGray } from "../analysis/imageGray";
import { placeholderReason } from "../analysis/avatarPlaceholders";
import { dHashFromGray, type HashedAvatar } from "../analysis/phash";

/** dHash grid: 9 columns give 8 difference bits per row, 8 rows give 64 bits. */
const HASH_COLS = 9;
const HASH_ROWS = 8;
/** Avatars are small. Anything larger is not an avatar, and is not downloaded. */
const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 6000;
const MAX_HOPS = 3;

export interface AvatarInput {
  url: string;
  source: string;
}

/** An avatar that contributed no hash, and the reason it did not. */
export interface SkippedAvatar extends AvatarInput {
  reason: string;
}

/**
 * Fetch one image, following redirects by hand so each hop can be vetted.
 * Returns null for anything that is not a fetchable, in-budget image.
 */
async function fetchImage(url: string): Promise<Uint8Array | null> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return null;
  }
  // http:// avatars are not fetched at all: the URL comes from a third party,
  // and a cleartext hop is both downgradeable and unnecessary in 2026.
  if (current.protocol !== "https:") return null;

  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    // Vetted by what the name resolves to, not just how it is spelled: a
    // profile photo on a host that resolves inward is not fetched.
    if (!(await resolvesPublic(current.hostname))) return null;
    let res: Response;
    try {
      res = await fetch(current.toString(), withUserAgent({
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8" },
        cache: "no-store",
      }));
    } catch {
      return null;
    }

    // `res.headers?` because a duck-typed response (a stub, a runtime that
    // omits headers on an error) must still be readable: the body is the point
    // and the headers are garnish. fetchSafe takes the same precaution.
    const location = res.headers?.get("location") ?? null;
    if (res.status >= 300 && res.status < 400 && location) {
      /* v8 ignore next -- cancel() rejecting is not reachable from a test */
      void res.body?.cancel().catch(() => {});
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        /* v8 ignore next 2 -- `new URL` with a base only throws on a malformed
           base, which cannot happen here. */
        return null;
      }
      if (next.protocol !== "https:") return null;
      current = next;
      continue;
    }

    if (!res.ok) return null;
    const type = res.headers?.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("image/")) return null;
    const declared = Number(res.headers?.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      /* v8 ignore next -- cancel() rejecting is not reachable from a test */
      void res.body?.cancel().catch(() => {});
      return null;
    }
    return readCapped(res, MAX_BYTES);
  }
  return null; // redirect loop
}

/**
 * The body, or null once it passes `limit`.
 *
 * Content-Length is the host's own claim and a chunked response makes none, so
 * the cap is enforced on what actually arrives: read in chunks and abandoned
 * the moment it is too big, instead of buffering an endless body until the
 * timeout and checking its size afterwards.
 */
async function readCapped(res: Response, limit: number): Promise<Uint8Array | null> {
  if (!res.body) {
    // A duck-typed response with no stream (see `res.headers?` above).
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > limit ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        /* v8 ignore next -- cancel() rejecting is not reachable from a test */
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null; // the connection died mid-body: nothing trustworthy to hash
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * A URL for the same image in a format we can decode, or null.
 *
 * cdn.bsky.app serves `image/webp` by default, and WebP means VP8, which is an
 * entire video codec — not something to implement for a 64-bit hash. The same
 * CDN serves the identical image as JPEG when the path carries the `@jpeg`
 * format selector (its own API used to return URLs in exactly that form), so
 * Bluesky avatars are fetched that way. This only affects what is DOWNLOADED
 * for hashing; the URL shown to the analyst is always the one the platform gave.
 */
export function decodableVariant(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    /* v8 ignore next 2 -- hashAvatar's fetch rejects an unparseable URL; this
       only chooses a variant. */
    return null;
  }
  if (u.host.toLowerCase() === "cdn.bsky.app" && !/@[a-z0-9]+$/i.test(u.pathname)) {
    return `${u.origin}${u.pathname}@jpeg${u.search}`;
  }
  return null;
}

/** Perceptual hash of one avatar URL, or the reason there is none. */
export async function hashAvatar(input: AvatarInput): Promise<HashedAvatar | SkippedAvatar> {
  const placeholder = placeholderReason(input.url);
  if (placeholder) return { ...input, reason: placeholder };

  const variant = decodableVariant(input.url);
  const bytes = (variant ? await fetchImage(variant) : null) ?? (await fetchImage(input.url));
  if (!bytes) return { ...input, reason: "image could not be fetched" };

  const image = await decodeGrayscale(bytes);
  if (!image) return { ...input, reason: "unsupported image format (WebP and AVIF are not decoded)" };

  const gray = resampleGray(image, HASH_COLS, HASH_ROWS);
  return { source: input.source, url: input.url, hash: dHashFromGray(gray, HASH_COLS, HASH_ROWS) };
}

function isHashed(v: HashedAvatar | SkippedAvatar): v is HashedAvatar {
  return "hash" in v;
}

/**
 * Hash a set of avatars concurrently. Deduplicates by URL first — the same
 * photo URL on two platforms is not evidence of anything, and fetching it twice
 * is just rude.
 */
export async function hashAvatars(
  inputs: AvatarInput[],
  concurrency: number,
): Promise<{ hashed: HashedAvatar[]; skipped: SkippedAvatar[] }> {
  const unique = [...new Map(inputs.map((a) => [a.url, a])).values()];
  const results = await mapLimit(unique, concurrency, hashAvatar, (a) => {
    try {
      return new URL(a.url).host.toLowerCase();
    } catch {
      /* v8 ignore next 2 -- an unparseable URL is caught by hashAvatar itself;
         this only decides politeness grouping. */
      return null;
    }
  });
  return {
    hashed: results.filter(isHashed),
    skipped: results.filter((r): r is SkippedAvatar => !isHashed(r)),
  };
}
