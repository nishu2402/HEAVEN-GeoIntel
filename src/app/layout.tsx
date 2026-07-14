import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css"; // side-effect import — DO NOT remove (loads the global stylesheet)
import { ThemeProvider } from "@/components/shared/ThemeProvider";

// Static, compile-time constant — no user or runtime input reaches it. Applies the
// persisted theme before first paint to prevent a flash of the wrong theme.
// Uses only ===, try/catch and dot access — no <, >, or & — so React renders it
// verbatim as a plain inline <script> child (no dangerouslySetInnerHTML needed).
const THEME_INIT =
  "try{var t=localStorage.getItem('heaven-geointel-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://heaven-geointel.example"),
  title: "HEAVEN-GeoIntel — Unified OSINT Platform",
  description:
    "Defensive OSINT for phone, email, username, IP, and domain — carrier & breach data, infostealer infections (Hudson Rock), username enumeration across 45+ sites, IP geolocation/ASN, DNS/WHOIS/subdomains, link-analysis graph, persistent cases. Offline-first. No tracking.",
  applicationName: "HEAVEN-GeoIntel",
  keywords: [
    "phone OSINT",
    "email OSINT",
    "phone number lookup",
    "email breach check",
    "carrier lookup",
    "phone intelligence",
    "email reputation",
    "telecom OSINT",
    "identity enrichment",
    "infostealer",
    "Hudson Rock",
    "BreachDirectory",
    "XposedOrNot",
  ],
  authors: [{ name: "HEAVEN" }],
  creator: "HEAVEN",
  category: "security",
  openGraph: {
    title: "HEAVEN-GeoIntel — Unified OSINT Platform",
    description:
      "Phone · Email · Username · IP · Domain OSINT in one console. Breach + infostealer data, username enumeration, IP/ASN, DNS/WHOIS/subdomains, link-graph, persistent cases. Offline-first. Zero API keys for core features.",
    type: "website",
    locale: "en_US",
    siteName: "HEAVEN-GeoIntel",
  },
  twitter: {
    card: "summary_large_image",
    title: "HEAVEN-GeoIntel — Unified OSINT Platform",
    description:
      "Phone · Email · Username · IP · Domain OSINT, link-analysis graph, persistent cases — offline-first, no tracking.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  // The /api/* routes already set X-Robots-Tag: noindex via next.config.mjs.
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport = {
  themeColor: "#00ff41",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // data-theme="dark" rendered on the server = the default. The pre-paint
    // script only *overrides* it to "light" when localStorage says so.
    // suppressHydrationWarning covers that single attribute diff (expected,
    // per Next.js theming guidance) so it never logs a hydration error.
    <html lang="en" data-theme="dark" suppressHydrationWarning className={jetbrainsMono.variable}>
      <head>
        {/* Apply persisted theme before paint to avoid a flash of the wrong theme.
            A plain inline <script> child runs synchronously during head parse. */}
        <script id="theme-init">{THEME_INIT}</script>
      </head>
      <body className="min-h-screen antialiased font-mono">
        {/* Skip link — invisible until keyboard-focused, jumps past header straight to main */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-[var(--hv-page-0)] focus:border focus:border-[var(--hv-green)] focus:text-[var(--hv-green)] focus:font-mono focus:text-xs focus:uppercase focus:tracking-widest"
        >
          Skip to main content
        </a>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
