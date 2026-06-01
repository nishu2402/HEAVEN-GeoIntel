/** @type {import('next').NextConfig} */

// External hosts the BROWSER may load images from. Server-side fetches to
// third-party OSINT APIs are NOT in scope for CSP (those are server-to-server).
const IMG_ALLOWED = [
  "data:",
  "blob:",
  "https://gravatar.com",
  "https://secure.gravatar.com",
  "https://media.licdn.com",
  "https://pbs.twimg.com",
  "https://lh3.googleusercontent.com",
  // FullContact serves avatars from its CDN
  "https://d2ojpxxtu63wzl.cloudfront.net",
  "https://img.fullcontact.com",
].join(" ");

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  `img-src 'self' ${IMG_ALLOWED}`,
  // Browser only calls our own origin — every third-party fetch is
  // proxied through /api/* on the server. So 'self' is sufficient.
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // upgrade-insecure-requests forces http→https for sub-resources when
  // the page itself is served over https.
  "upgrade-insecure-requests",
].join("; ");

const nextConfig = {
  // Next 16's `next dev` blocks cross-origin requests to dev internals (HMR,
  // /_next/*). This ONLY affects DEV mode AND only when the browser's Origin
  // differs from the host you loaded — i.e. it never bites when you open the
  // exact dev URL directly. Next's matcher matches DNS subdomains, NOT raw IP
  // octets, so "192.168.*" can't match "192.168.0.5" — wildcards on IPs are
  // useless. For LAN access we run PRODUCTION mode (scripts/start.sh), which has
  // no such block. This list just smooths over loopback hostnames in dev.
  allowedDevOrigins: ["localhost", "127.0.0.1", "*.local"],
  images: {
    // The app renders plain <img> tags (never next/image), so disable the
    // built-in Image Optimizer entirely — removes the /_next/image endpoint
    // and its DoS / unbounded-cache attack surface (defense in depth).
    unoptimized: true,
    remotePatterns: [],
  },
  // Disable the "X-Powered-By: Next.js" banner — small fingerprint reduction.
  poweredByHeader: false,
  // Don't ship source maps to the browser in production (smaller + less leak).
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      {
        // Hardened headers on every page + asset
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options",          value: "DENY" },
          { key: "X-Content-Type-Options",   value: "nosniff" },
          { key: "Referrer-Policy",          value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",       value: "geolocation=(), camera=(), microphone=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), midi=()" },
          { key: "Cross-Origin-Opener-Policy",  value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Content-Security-Policy",  value: CSP },
        ],
      },
      {
        // Lookup API routes — never indexed, never cached, never embeddable.
        // We intentionally do NOT send an Access-Control-Allow-Origin header
        // here: omitting it means browsers enforce same-origin by default and
        // block cross-site reads. ("same-origin" is NOT a valid ACAO value, so
        // sending it would be a no-op at best and a malformed duplicate header
        // when a route also sets its own — e.g. the public /api/docs spec.)
        source: "/api/lookup(.*)",
        headers: [
          { key: "X-Robots-Tag",  value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      {
        source: "/api/email-lookup(.*)",
        headers: [
          { key: "X-Robots-Tag",  value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      {
        source: "/api/bulk-lookup(.*)",
        headers: [
          { key: "X-Robots-Tag",  value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      {
        source: "/api/username-lookup(.*)",
        headers: [
          { key: "X-Robots-Tag",  value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      {
        source: "/api/ip-lookup(.*)",
        headers: [
          { key: "X-Robots-Tag",  value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      {
        source: "/api/domain-lookup(.*)",
        headers: [
          { key: "X-Robots-Tag",  value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      {
        source: "/api/cases(.*)",
        headers: [
          { key: "X-Robots-Tag",  value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
    ];
  },
};

export default nextConfig;
