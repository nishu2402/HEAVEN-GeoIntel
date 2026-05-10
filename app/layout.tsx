import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HEAVEN-GeoIntel — Phone Intelligence Platform",
  description:
    "Defensive OSINT phone number metadata lookup — carrier, line type, country intelligence, fraud signals, and format cross-references. No tracking. No geolocation. Zero API keys required.",
  keywords: [
    "phone OSINT",
    "phone number lookup",
    "carrier lookup",
    "phone intelligence",
    "number validation",
    "telecom OSINT",
  ],
  authors: [{ name: "HEAVEN-GeoIntel" }],
  openGraph: {
    title: "HEAVEN-GeoIntel — Phone Intelligence Platform",
    description:
      "Carrier, line type, country intelligence, fraud signals, and format cross-references for any phone number. Offline-first. Zero API keys required.",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "HEAVEN-GeoIntel — Phone Intelligence Platform",
    description:
      "Defensive OSINT phone intelligence. Carrier, type, fraud score, country data — offline-first, no tracking.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-[#0a0a0a] text-[#00ff41] antialiased font-mono">
        {children}
      </body>
    </html>
  );
}
