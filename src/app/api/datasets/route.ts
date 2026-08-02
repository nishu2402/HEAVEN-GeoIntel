import { NextResponse } from "next/server";
import { datasetStatus, reloadDatasets } from "@/lib/server/datasets";
import { USERNAME_SITES, activeUsernameSites } from "@/lib/data/usernameSites";

// Reports which bundled datasets have a runtime overlay installed from
// .data/datasets/, and lets the operator re-read them without a restart.
// Never returns dataset CONTENTS — only names, versions and row counts.

export const dynamic = "force-dynamic";

async function report() {
  const status = await datasetStatus();
  return {
    ...status,
    // The sweep catalog is the one dataset whose effective size is worth
    // surfacing directly — it's what the README's site count refers to.
    usernameSites: { bundled: USERNAME_SITES.length, active: activeUsernameSites().length },
  };
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(await report(), { headers: { "Cache-Control": "no-store" } });
}

/** Re-read every overlay from disk. Returns the same report as GET. */
export async function POST(): Promise<NextResponse> {
  await reloadDatasets();
  return NextResponse.json(await report(), { headers: { "Cache-Control": "no-store" } });
}
