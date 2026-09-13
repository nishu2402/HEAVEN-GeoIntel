// ── Platform default avatars (pure) ──────────────────────────────────────────
//
// Every entry is a file a platform serves to accounts that uploaded no photo.
// They matter twice over:
//
//   • As identity evidence they are worthless, and worse than worthless when
//     presented as a fact. A live lookup surfaced
//     `mastodon.social/avatars/original/missing.png` as the subject's avatar —
//     that is the platform's own placeholder, shown for every account without a
//     picture.
//   • In a perceptual comparison they are actively misleading: two accounts that
//     both left the default in place would "match" at 100%, manufacturing a link
//     between strangers.
//
// Recognising them by URL is exact and auditable. Guessing from image content
// would not be.

export const PLACEHOLDER_PATTERNS: { pattern: RegExp; what: string }[] = [
  { pattern: /\/avatars\/original\/missing/i, what: "Mastodon default avatar" },
  { pattern: /\/missing[_-]?(still|avatar)?\.(png|jpe?g|gif|webp)$/i, what: "platform default avatar" },
  { pattern: /\/default[_-]?(avatar|profile|user|image)/i, what: "platform default avatar" },
  { pattern: /\/no[_-]?(avatar|photo|image)/i, what: "platform default avatar" },
  { pattern: /\/blank[_-]?(avatar|profile)/i, what: "platform default avatar" },
  { pattern: /\/anonymous[_.-]/i, what: "platform default avatar" },
  { pattern: /cdn\.discordapp\.com\/embed\/avatars\//i, what: "Discord default avatar" },
  { pattern: /gravatar\.com\/avatar\/[^?]*\?.*\bd=(mm|mp|identicon|monsterid|wavatar|retro|robohash|blank)\b/i, what: "Gravatar fallback image" },
  { pattern: /\/images\/user-image\.svg/i, what: "Chess.com default avatar" },
  { pattern: /\/assets\/images\/avatar[_-]?default/i, what: "platform default avatar" },
];

/** Which default this URL is, or null when it is a real uploaded image. */
export function placeholderReason(url: string): string | null {
  return PLACEHOLDER_PATTERNS.find((p) => p.pattern.test(url))?.what ?? null;
}

/** True when the URL is a known platform default. */
export function isPlaceholderAvatar(url: string): boolean {
  return placeholderReason(url) !== null;
}
