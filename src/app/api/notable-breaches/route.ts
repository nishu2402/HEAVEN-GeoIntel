import { NextResponse } from "next/server";
import { notableBreaches, notableMeta } from "@/lib/data/breachCatalog";

// ── Notable breaches reference — keyless, offline ─────────────────────────────
// Serves the vendored Wikipedia notable-breaches tier: the largest documented
// government and institutional data breaches, by record count. Each row carries a
// record count and year only, describes an incident the credential indexes never
// hold, and asserts nothing about any identifier. The whole list is read straight
// from the bundled snapshot, so this needs no key and makes no upstream call; the
// browser filters and searches the rows locally.

export async function GET(): Promise<NextResponse> {
  const breaches = notableBreaches();
  const { version } = notableMeta();
  return NextResponse.json({
    source: "Wikipedia: List of data breaches",
    version,
    count: breaches.length,
    breaches,
  });
}
