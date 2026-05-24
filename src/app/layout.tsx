import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HEAVEN-GeoIntel — Phone & Email OSINT Platform",
  description:
    "Defensive OSINT platform for phone numbers and email addresses — carrier, breach history, identity enrichment, fraud signals, and country intelligence. Offline-first. No tracking.",
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
  ],
  authors: [{ name: "HEAVEN-GeoIntel" }],
  openGraph: {
    title: "HEAVEN-GeoIntel — Phone & Email OSINT Platform",
    description:
      "Carrier, breach history, identity enrichment, fraud signals for phones and emails. Offline-first. Zero API keys required for core features.",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "HEAVEN-GeoIntel — Phone & Email OSINT Platform",
    description:
      "Defensive OSINT for phones and emails. Breach data, identity enrichment, fraud score, carrier intel — offline-first, no tracking.",
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
