"use client";

import { useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Shield, Terminal } from "lucide-react";
import type { LookupResponse } from "@/lib/types";
import { countryToFlagEmoji } from "@/lib/phoneAnalysis";
import PhoneInput from "@/components/PhoneInput";
import ResultsDashboard from "@/components/ResultsDashboard";
import LoadingSkeletons from "@/components/LoadingSkeletons";
import BootSequence from "@/components/BootSequence";
import { saveToHistory } from "@/components/HistorySidebar";

const MatrixRain = dynamic(() => import("@/components/MatrixRain"), { ssr: false });
const HistorySidebar = dynamic(() => import("@/components/HistorySidebar"), { ssr: false });

type Status = "boot" | "idle" | "loading" | "done" | "error";

interface ApiErrorResponse {
  error?: string;
}

function PageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("boot");
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [currentE164, setCurrentE164] = useState<string>("");

  const runLookup = useCallback(async (number: string) => {
    setStatus("loading");
    setResult(null);
    setErrorMsg("");
    setCurrentE164(number);

    // Update URL for shareability
    const params = new URLSearchParams();
    params.set("q", number);
    router.replace(`?${params.toString()}`, { scroll: false });

    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number }),
      });

      const json = (await res.json()) as LookupResponse | ApiErrorResponse;

      if (!res.ok) {
        const errJson = json as ApiErrorResponse;
        setErrorMsg(errJson.error ?? `HTTP ${res.status}`);
        setStatus("error");
        return;
      }

      const data = json as LookupResponse;
      setResult(data);
      setStatus("done");

      saveToHistory({
        e164: data.input.e164,
        country: data.input.country,
        countryCallingCode: data.input.countryCallingCode,
        timestamp: Date.now(),
        flagEmoji: countryToFlagEmoji(data.input.country),
      });
    } catch {
      setErrorMsg("Network error — is the dev server running?");
      setStatus("error");
    }
  }, [router]);

  const handleHistorySelect = useCallback(
    (e164: string) => runLookup(e164),
    [runLookup]
  );

  // Auto-run from ?q= query param
  const handleBootDone = useCallback(() => {
    setStatus("idle");
    const q = searchParams.get("q");
    if (q) {
      void runLookup(q);
    }
  }, [searchParams, runLookup]);

  return (
    <>
      <MatrixRain />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="border-b border-[#00ff41]/20 px-6 py-3 flex items-center justify-between bg-[#0a0a0a]/80 backdrop-blur-sm sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-[#00ff41]" />
            <span className="font-mono font-bold text-sm tracking-widest">
              <span className="glow-green">HEAVEN</span>
              <span className="text-[#00ff41]/50">-</span>
              <span className="text-[#00d9ff]">GeoIntel</span>
            </span>
            <span className="text-[10px] text-[#00ff41]/30 uppercase tracking-widest hidden sm:block">
              {"//"} phone intelligence platform
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-[10px] text-[#00ff41]/30 font-mono hidden md:flex">
              <Shield className="w-3 h-3" />
              DEFENSIVE OSINT ONLY
            </div>
            <div className="text-[10px] text-[#00ff41]/25 font-mono hidden sm:block">
              HEAVEN-GeoIntel v2.0
            </div>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl">

          {/* Boot sequence */}
          {status === "boot" && (
            <div className="mb-8 terminal-card p-6">
              <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/40 mb-4">
                [ SYSTEM INIT ] — HEAVEN-GeoIntel Phone Intelligence Platform
              </div>
              <BootSequence onDone={handleBootDone} />
            </div>
          )}

          {/* Input */}
          {status !== "boot" && (
            <div className="terminal-card p-6 mb-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/40">
                  [ TARGET ACQUISITION ]
                </div>
                <div className="text-[10px] text-[#00ff41]/25 font-mono">
                  Works offline · no API keys required
                </div>
              </div>
              <PhoneInput onLookup={runLookup} loading={status === "loading"} />
            </div>
          )}

          {/* History */}
          {status !== "boot" && (
            <div className="mb-4">
              <HistorySidebar onSelect={handleHistorySelect} currentE164={currentE164} />
            </div>
          )}

          {/* Loading */}
          {status === "loading" && <LoadingSkeletons />}

          {/* Error */}
          {status === "error" && (
            <div className="mt-6 terminal-card p-5 border border-[#ff3e3e]/30">
              <div className="text-[10px] uppercase tracking-widest text-[#ff3e3e]/60 mb-2">
                [ LOOKUP FAILED ]
              </div>
              <div className="text-[#ff3e3e] font-mono text-sm">
                <span className="text-[#ff3e3e]/60">[ERROR] </span>
                {errorMsg}
              </div>
              <button
                onClick={() => {
                  setStatus("idle");
                  router.replace("/", { scroll: false });
                }}
                className="mt-3 text-[10px] uppercase tracking-widest text-[#00ff41]/50 hover:text-[#00ff41] transition-colors font-mono"
              >
                ← RETRY
              </button>
            </div>
          )}

          {/* Results */}
          {status === "done" && result && <ResultsDashboard data={result} />}
        </main>

        {/* Footer */}
        <footer className="border-t border-[#00ff41]/15 px-6 py-4 bg-[#0a0a0a]/80 backdrop-blur-sm">
          <div className="text-center text-[10px] font-mono text-[#00ff41]/25 tracking-widest uppercase">
            OSINT METADATA ONLY · NO REAL-TIME LOCATION · NO GPS TRACKING · USE RESPONSIBLY
          </div>
          <div className="text-center text-[9px] font-mono text-[#00ff41]/15 mt-1 tracking-wide">
            Powered by libphonenumber-js · Offline-first · Open source intelligence
          </div>
        </footer>
      </div>
    </>
  );
}

import { Suspense } from "react";

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center font-mono text-[#00ff41]/50 text-sm">
          [ LOADING... ]
        </div>
      }
    >
      <PageContent />
    </Suspense>
  );
}
