"use client";

import { useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Shield, Terminal } from "lucide-react";
import type { LookupResponse, EmailLookupResponse } from "@/lib/types";
import { countryToFlagEmoji } from "@/lib/phoneAnalysis";
import PhoneInput from "@/components/PhoneInput";
import EmailInput from "@/components/EmailInput";
import ResultsDashboard from "@/components/ResultsDashboard";
import EmailResultsDashboard from "@/components/EmailResultsDashboard";
import LoadingSkeletons from "@/components/LoadingSkeletons";
import BootSequence from "@/components/BootSequence";
import { saveToHistory } from "@/components/HistorySidebar";

const MatrixRain = dynamic(() => import("@/components/MatrixRain"), { ssr: false });
const HistorySidebar = dynamic(() => import("@/components/HistorySidebar"), { ssr: false });

type PhoneStatus = "boot" | "idle" | "loading" | "done" | "error";
type EmailStatus = "idle" | "loading" | "done" | "error";
type Mode = "phone" | "email";

interface ApiErrorResponse {
  error?: string;
}

function PageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("phone");

  // Phone state
  const [phoneStatus, setPhoneStatus] = useState<PhoneStatus>("boot");
  const [phoneResult, setPhoneResult] = useState<LookupResponse | null>(null);
  const [phoneErrorMsg, setPhoneErrorMsg] = useState<string>("");
  const [currentE164, setCurrentE164] = useState<string>("");

  // Email state
  const [emailStatus, setEmailStatus] = useState<EmailStatus>("idle");
  const [emailResult, setEmailResult] = useState<EmailLookupResponse | null>(null);
  const [emailErrorMsg, setEmailErrorMsg] = useState<string>("");

  const isBooting = phoneStatus === "boot";

  const runLookup = useCallback(async (number: string) => {
    setPhoneStatus("loading");
    setPhoneResult(null);
    setPhoneErrorMsg("");
    setCurrentE164(number);

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
        setPhoneErrorMsg((json as ApiErrorResponse).error ?? `HTTP ${res.status}`);
        setPhoneStatus("error");
        return;
      }

      const data = json as LookupResponse;
      setPhoneResult(data);
      setPhoneStatus("done");

      saveToHistory({
        e164: data.input.e164,
        country: data.input.country,
        countryCallingCode: data.input.countryCallingCode,
        timestamp: Date.now(),
        flagEmoji: countryToFlagEmoji(data.input.country),
      });
    } catch {
      setPhoneErrorMsg("Network error — is the dev server running?");
      setPhoneStatus("error");
    }
  }, [router]);

  const runEmailLookup = useCallback(async (email: string) => {
    setEmailStatus("loading");
    setEmailResult(null);
    setEmailErrorMsg("");

    try {
      const res = await fetch("/api/email-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const json = (await res.json()) as EmailLookupResponse | ApiErrorResponse;

      if (!res.ok) {
        setEmailErrorMsg((json as ApiErrorResponse).error ?? `HTTP ${res.status}`);
        setEmailStatus("error");
        return;
      }

      setEmailResult(json as EmailLookupResponse);
      setEmailStatus("done");
    } catch {
      setEmailErrorMsg("Network error — is the dev server running?");
      setEmailStatus("error");
    }
  }, []);

  const handleHistorySelect = useCallback(
    (e164: string) => runLookup(e164),
    [runLookup]
  );

  const handleBootDone = useCallback(() => {
    setPhoneStatus("idle");
    const q = searchParams.get("q");
    if (q) void runLookup(q);
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
              {"//"} osint intelligence platform
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
          {isBooting && (
            <div className="mb-8 terminal-card p-6">
              <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/40 mb-4">
                [ SYSTEM INIT ] — HEAVEN-GeoIntel OSINT Intelligence Platform
              </div>
              <BootSequence onDone={handleBootDone} />
            </div>
          )}

          {/* Input card */}
          {!isBooting && (
            <div className="terminal-card p-6 mb-4 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/40">
                  [ TARGET ACQUISITION ]
                </div>
                {/* Mode tabs */}
                <div className="flex items-center gap-1.5 font-mono text-[10px]">
                  {(["phone", "email"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`px-3 py-1.5 border tracking-widest uppercase transition-all ${
                        mode === m
                          ? "border-[#00ff41] text-[#00ff41] bg-[#00ff41]/10 shadow-[0_0_10px_rgba(0,255,65,0.15)]"
                          : "border-[#00ff41]/20 text-[#00ff41]/35 hover:border-[#00ff41]/50 hover:text-[#00ff41]/60"
                      }`}
                    >
                      {m === "phone" ? "[ PHONE ]" : "[ EMAIL ]"}
                    </button>
                  ))}
                  <span className="text-[#00ff41]/20 ml-1 hidden sm:block">
                    · offline-first
                  </span>
                </div>
              </div>

              {mode === "phone" && (
                <PhoneInput onLookup={runLookup} loading={phoneStatus === "loading"} />
              )}
              {mode === "email" && (
                <EmailInput onLookup={runEmailLookup} loading={emailStatus === "loading"} />
              )}
            </div>
          )}

          {/* History — phone mode only */}
          {!isBooting && mode === "phone" && (
            <div className="mb-4">
              <HistorySidebar onSelect={handleHistorySelect} currentE164={currentE164} />
            </div>
          )}

          {/* Loading */}
          {((mode === "phone" && phoneStatus === "loading") ||
            (mode === "email" && emailStatus === "loading")) && <LoadingSkeletons />}

          {/* Phone error */}
          {mode === "phone" && phoneStatus === "error" && (
            <div className="mt-6 terminal-card p-5 border border-[#ff3e3e]/30">
              <div className="text-[10px] uppercase tracking-widest text-[#ff3e3e]/60 mb-2">
                [ LOOKUP FAILED ]
              </div>
              <div className="text-[#ff3e3e] font-mono text-sm">
                <span className="text-[#ff3e3e]/60">[ERROR] </span>
                {phoneErrorMsg}
              </div>
              <button
                onClick={() => {
                  setPhoneStatus("idle");
                  router.replace("/", { scroll: false });
                }}
                className="mt-3 text-[10px] uppercase tracking-widest text-[#00ff41]/50 hover:text-[#00ff41] transition-colors font-mono"
              >
                ← RETRY
              </button>
            </div>
          )}

          {/* Email error */}
          {mode === "email" && emailStatus === "error" && (
            <div className="mt-6 terminal-card p-5 border border-[#ff3e3e]/30">
              <div className="text-[10px] uppercase tracking-widest text-[#ff3e3e]/60 mb-2">
                [ LOOKUP FAILED ]
              </div>
              <div className="text-[#ff3e3e] font-mono text-sm">
                <span className="text-[#ff3e3e]/60">[ERROR] </span>
                {emailErrorMsg}
              </div>
              <button
                onClick={() => setEmailStatus("idle")}
                className="mt-3 text-[10px] uppercase tracking-widest text-[#00ff41]/50 hover:text-[#00ff41] transition-colors font-mono"
              >
                ← RETRY
              </button>
            </div>
          )}

          {/* Phone results */}
          {mode === "phone" && phoneStatus === "done" && phoneResult && (
            <ResultsDashboard data={phoneResult} />
          )}

          {/* Email results */}
          {mode === "email" && emailStatus === "done" && emailResult && (
            <EmailResultsDashboard data={emailResult} />
          )}
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
