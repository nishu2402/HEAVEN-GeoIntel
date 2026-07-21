import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand/logo";

// Installable-app metadata. Next serves this at /manifest.webmanifest and links
// it from every page automatically. Icons point at the committed public/brand
// assets (stable URLs) rather than the hashed app/ icon routes.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} — ${BRAND.tagline}`,
    short_name: "GeoIntel",
    description:
      "Defensive OSINT for phone, email, username, IP, and domain — offline-first, no tracking.",
    start_url: "/",
    display: "standalone",
    background_color: "#05060d",
    theme_color: BRAND.green,
    categories: ["security", "utilities"],
    icons: [
      { src: "/brand/mark.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/brand/mark.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
