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
  images: {
    remotePatterns: [],
  },
  // Disable the "X-Powered-By: Next.js" banner — small fingerprint reduction.
  poweredByHeader: false,
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
        // API routes — never indexed, never cached, never embeddable
        source: "/api/(.*)",
        headers: [
          { key: "X-Robots-Tag",             value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control",            value: "no-store, max-age=0" },
          // Same-origin CORS — block cross-origin browsers explicitly.
          // Server-side curl/fetch from other hosts is unaffected (CORS is a
          // browser-only enforcement), but rate-limited in the route handlers.
          { key: "Access-Control-Allow-Origin", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
