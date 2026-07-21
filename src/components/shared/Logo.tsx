import { BRAND, LOGO } from "@/lib/brand/logo";

// The brand mark as React. Deliberately hook-free so it renders in both server
// and client components (the 404 page is a server component, the header is not).
// Geometry and colour come from src/lib/brand/logo.ts — the same module that
// generates the favicon, the OG image and the report letterheads, so the mark
// can never drift between the app and its exports.

export interface LogoProps {
  /** Rendered square size in px. Default 28 (header scale). */
  size?: number;
  /** Collapse the mark to a single colour — for print or a light background. */
  mono?: string;
  /**
   * Prefix for the gradient's element id. Only matters when two marks with
   * *different* colouring share a document; pass a distinct value there.
   */
  idPrefix?: string;
  /** Accessible label. Omitted → the mark is exposed as decorative. */
  title?: string;
  className?: string;
  /** Opt into the ambient orbit spin (see .hv-logo-mark in globals.css). */
  animated?: boolean;
}

export function Logo({
  size = 28,
  mono,
  idPrefix = "hv-logo",
  title,
  className,
  animated,
}: LogoProps) {
  const gradId = `${idPrefix}-frame`;
  const frameStroke = mono ?? `url(#${gradId})`;
  const globeStroke = mono ?? BRAND.cyan;
  const markStroke = mono ?? BRAND.green;

  return (
    <svg
      viewBox={LOGO.viewBox}
      width={size}
      height={size}
      fill="none"
      // shrink-0 is not cosmetic: as a flex child the SVG has an auto min-width
      // and gets crushed (a 30px mark collapses to ~5px) whenever the row runs
      // out of room. Every lockup below puts it in a flex row.
      className={["shrink-0", animated ? "hv-logo-mark" : "", className ?? ""].filter(Boolean).join(" ")}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true, focusable: false })}
    >
      {/* No <defs> in mono: there is no gradient to define. */}
      {!mono && (
        <defs>
          <linearGradient id={gradId} x1="32" y1="2" x2="32" y2="62" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={BRAND.green} />
            <stop offset="1" stopColor={BRAND.cyan} />
          </linearGradient>
        </defs>
      )}
      <path d={LOGO.hexPath} stroke={frameStroke} strokeWidth={LOGO.hexStroke} strokeLinejoin="round" />
      <circle cx="32" cy="32" r={LOGO.globeR} stroke={globeStroke} strokeWidth={LOGO.globeStroke} opacity={LOGO.globeOpacity} />
      <ellipse
        className="hv-logo-orbit"
        cx="32"
        cy="32"
        rx={LOGO.globeR}
        ry={LOGO.orbitRy}
        stroke={globeStroke}
        strokeWidth={LOGO.globeStroke}
        opacity={LOGO.orbitOpacity}
        transform={`rotate(${LOGO.orbitTilt} 32 32)`}
      />
      <path d={LOGO.hPath} stroke={markStroke} strokeWidth={LOGO.hStroke} strokeLinecap="square" />
    </svg>
  );
}

export interface LogoLockupProps {
  /** Size of the mark; the wordmark scales with the surrounding font size. */
  size?: number;
  /** Show the "// unified osint platform" tagline beside the wordmark. */
  tagline?: boolean;
  /** Wrapper classes — use this to set the wordmark's font size. */
  className?: string;
  animated?: boolean;
  /**
   * Drop the wordmark below `md`, leaving the mark alone. For dense bars (the
   * app header) where the controls need the width — the mark is designed to
   * carry the brand on its own. Without this the wordmark is `nowrap` inside a
   * shrunk flex item, so it silently overflows and collides with the controls
   * instead of making the container wider.
   */
  compact?: boolean;
}

/**
 * Mark + wordmark. The single lockup used by the header, the consent gate and
 * the 404 page, so the brand reads identically everywhere in the app.
 */
export function LogoLockup({ size = 28, tagline, className, animated, compact }: LogoLockupProps) {
  return (
    <span className={["flex items-center gap-2 sm:gap-2.5 min-w-0", className ?? ""].filter(Boolean).join(" ")}>
      <Logo size={size} animated={animated} title={`${BRAND.name} — ${BRAND.tagline}`} />
      <span
        className={[
          compact ? "hidden md:inline" : "",
          "font-mono font-bold tracking-widest whitespace-nowrap",
        ].filter(Boolean).join(" ")}
      >
        <span className="glow-green">HEAVEN</span>
        <span className="text-[var(--hv-ink-dim)]">-</span>
        <span className="gradient-text">GeoIntel</span>
      </span>
      {/* Staggered so the lockup never crowds the controls: mark → +wordmark at
          md → +tagline at xl. At lg the tagline lands flush against the control
          cluster with zero gap, so it waits one breakpoint longer. */}
      {tagline && (
        <span className="text-[11px] text-[var(--hv-ink-dim)] uppercase tracking-widest hidden xl:block">
          {"//"} {BRAND.tagline.toLowerCase()}
        </span>
      )}
    </span>
  );
}

export default Logo;
