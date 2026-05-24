import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://heaven-geointel.example"),
  title: "HEAVEN-GeoIntel — Phone & Email OSINT Platform",
  description:
    "Defensive OSINT for phone numbers and email addresses — carrier, breach history, infostealer infections (Hudson Rock), identity enrichment, fraud signals, country intelligence. Offline-first. No tracking.",
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
    title: "HEAVEN-GeoIntel — Phone & Email OSINT Platform",
    description:
      "Carrier, breach history, Hudson Rock infostealer infections, identity enrichment, fraud signals. Offline-first. Zero API keys required for core features.",
    type: "website",
    locale: "en_US",
    siteName: "HEAVEN-GeoIntel",
  },
  twitter: {
    card: "summary_large_image",
    title: "HEAVEN-GeoIntel — Phone & Email OSINT Platform",
    description:
      "Defensive OSINT for phones and emails. Breach data, identity enrichment, fraud score, carrier intel — offline-first, no tracking.",
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
    <html lang="en" className={`dark ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-[#0a0a0a] text-[#00ff41] antialiased font-mono">
        {/* Skip link — invisible until keyboard-focused, jumps past header straight to main */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-[#0a0a0a] focus:border focus:border-[#00ff41] focus:text-[#00ff41] focus:font-mono focus:text-xs focus:uppercase focus:tracking-widest"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
