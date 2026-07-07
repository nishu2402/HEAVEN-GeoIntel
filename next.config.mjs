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
  "https://avatars.githubusercontent.com",
  // FullContact serves avatars from its CDN
  "https://d2ojpxxtu63wzl.cloudfront.net",
  "https://img.fullcontact.com",
].join(" ");

// CSP has to adapt to how the app is actually served. This tool runs over plain
// HTTP by default — on localhost AND on a LAN IP (phone access via scripts/
// start.sh). Two directives that are normally "good hardening" actively BREAK
// that setup, each leaving the page stuck on its `[ LOADING… ]` fallback:
//
//  1. `connect-src 'self'` — in DEV, turbopack/Fast Refresh opens an HMR
//     WebSocket. Safari (unlike Chrome) does NOT treat same-origin `ws://` as
//     covered by 'self', so it blocks the socket and the client never hydrates.
//     → In dev we widen connect-src to allow ws:/wss:.
//
//  2. `upgrade-insecure-requests` — only meaningful when the page is served over
//     HTTPS. Over plain HTTP it rewrites EVERY same-origin asset from http:// to
//     https://; with no TLS server those requests fail and the JS chunks never
//     load. localhost gets a browser carve-out so it limps along, but a LAN IP
//     (http://192.168.x.x:3000) does not → the phone just shows loading.
//     → Off by default; opt in with FORCE_HTTPS=1 only behind a real TLS proxy.
const isDev = process.env.NODE_ENV !== "production";
const httpsDeploy = process.env.FORCE_HTTPS === "1";

const cspDirectives = [
  "default-src 'self'",
  // 'unsafe-eval' is only needed by the dev server (HMR / fast refresh). The
  // production bundle never eval()s, so we drop it there to shrink the XSS
  // surface. 'unsafe-inline' stays for the tiny anti-flash theme script in
  // <head> and Next's inline bootstrap (a nonce-based CSP would remove it, but
  // that's a larger change for a self-hosted tool).
  isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  `img-src 'self' ${IMG_ALLOWED}`,
  // Browser only calls our own origin — every third-party fetch is proxied
  // through /api/* on the server. 'self' is sufficient in production; dev also
  // needs the HMR websocket (ws:/wss:), which Safari won't allow via 'self'.
  isDev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
];
if (httpsDeploy) {
  // Forces http→https for sub-resources. Safe ONLY when the page itself is
  // served over https; harmful on the default HTTP (localhost/LAN) deployment.
  cspDirectives.push("upgrade-insecure-requests");
}
const CSP = cspDirectives.join("; ");

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
          // HSTS is gated on the SAME condition as upgrade-insecure-requests: only
          // when the app is actually served over HTTPS (FORCE_HTTPS=1 behind a TLS
          // proxy). Sending it on the default HTTP (localhost/LAN) deployment would
          // teach the browser to refuse the very origin it's being served from.
          ...(httpsDeploy
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
            : []),
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
