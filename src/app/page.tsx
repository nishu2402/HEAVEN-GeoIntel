"use client";

import { useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Shield, Terminal, AtSign, Network, Globe } from "lucide-react";
import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse, IpLookupResponse, DomainLookupResponse,
} from "@/lib/types";
import { countryToFlagEmoji } from "@/lib/phoneAnalysis";
import { MODES, type Mode } from "@/lib/modes";
import type { GraphEntity } from "@/components/graph/LinkGraph";

import PhoneInput from "@/components/phone/PhoneInput";
import EmailInput from "@/components/email/EmailInput";
import BulkLookup from "@/components/dashboard/BulkLookup";
import ResultsDashboard from "@/components/dashboard/ResultsDashboard";
import EmailResultsDashboard from "@/components/email/EmailResultsDashboard";
import UsernameResultsDashboard from "@/components/username/UsernameResultsDashboard";
import IpResultsDashboard from "@/components/network/IpResultsDashboard";
import DomainResultsDashboard from "@/components/network/DomainResultsDashboard";
import CasesPanel from "@/components/cases/CasesPanel";
import LinkGraph from "@/components/graph/LinkGraph";
import LoadingSkeletons from "@/components/dashboard/LoadingSkeletons";
import BootSequence from "@/components/shared/BootSequence";
import SimpleLookupInput from "@/components/shared/SimpleLookupInput";
import ThemeToggle from "@/components/shared/ThemeToggle";
import CommandPalette from "@/components/shared/CommandPalette";
import PanelErrorBoundary from "@/components/shared/PanelErrorBoundary";
import { saveToHistory } from "@/components/dashboard/HistorySidebar";

const MatrixRain = dynamic(() => import("@/components/shared/MatrixRain"), { ssr: false });
const HistorySidebar = dynamic(() => import("@/components/dashboard/HistorySidebar"), { ssr: false });

type Status = "idle" | "loading" | "done" | "error";
interface ApiErrorResponse { error?: string }

function PageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("phone");
  const [booted, setBooted] = useState(false);

  // Per-mode state
  const [phoneStatus, setPhoneStatus] = useState<Status>("idle");
  const [phoneResult, setPhoneResult] = useState<LookupResponse | null>(null);
  const [phoneErr, setPhoneErr] = useState("");
  const [currentE164, setCurrentE164] = useState("");

  const [emailStatus, setEmailStatus] = useState<Status>("idle");
  const [emailResult, setEmailResult] = useState<EmailLookupResponse | null>(null);
  const [emailErr, setEmailErr] = useState("");

  const [userStatus, setUserStatus] = useState<Status>("idle");
  const [userResult, setUserResult] = useState<UsernameLookupResponse | null>(null);
  const [userErr, setUserErr] = useState("");

  const [ipStatus, setIpStatus] = useState<Status>("idle");
  const [ipResult, setIpResult] = useState<IpLookupResponse | null>(null);
  const [ipErr, setIpErr] = useState("");

  const [domStatus, setDomStatus] = useState<Status>("idle");
  const [domResult, setDomResult] = useState<DomainLookupResponse | null>(null);
  const [domErr, setDomErr] = useState("");

  // Session graph — every successful lookup adds a node
  const [sessionEntities, setSessionEntities] = useState<GraphEntity[]>([]);
  const addEntity = useCallback((kind: GraphEntity["kind"], value: string) => {
    setSessionEntities((prev) =>
      prev.some((e) => e.kind === kind && e.value === value) ? prev : [...prev, { kind, value }]
    );
  }, []);

  const isBooting = !booted;

  // ── Lookup runners ──────────────────────────────────────────────────────
  const runLookup = useCallback(async (number: string) => {
    setPhoneStatus("loading"); setPhoneResult(null); setPhoneErr(""); setCurrentE164(number);
    const params = new URLSearchParams(); params.set("q", number);
    router.replace(`?${params.toString()}`, { scroll: false });
    try {
      const res = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number }) });
      const json = (await res.json()) as LookupResponse | ApiErrorResponse;
      if (!res.ok) { setPhoneErr((json as ApiErrorResponse).error ?? `HTTP ${res.status}`); setPhoneStatus("error"); return; }
      const data = json as LookupResponse;
      setPhoneResult(data); setPhoneStatus("done");
      addEntity("phone", data.input.e164);
      saveToHistory({ e164: data.input.e164, country: data.input.country, countryCallingCode: data.input.countryCallingCode, timestamp: Date.now(), flagEmoji: countryToFlagEmoji(data.input.country) });
    } catch { setPhoneErr("Network error — is the dev server running?"); setPhoneStatus("error"); }
  }, [router, addEntity]);

  const runEmail = useCallback(async (email: string) => {
    setEmailStatus("loading"); setEmailResult(null); setEmailErr("");
    try {
      const res = await fetch("/api/email-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const json = (await res.json()) as EmailLookupResponse | ApiErrorResponse;
      if (!res.ok) { setEmailErr((json as ApiErrorResponse).error ?? `HTTP ${res.status}`); setEmailStatus("error"); return; }
      setEmailResult(json as EmailLookupResponse); setEmailStatus("done"); addEntity("email", (json as EmailLookupResponse).email);
    } catch { setEmailErr("Network error — is the dev server running?"); setEmailStatus("error"); }
  }, [addEntity]);

  const runUsername = useCallback(async (username: string) => {
    setUserStatus("loading"); setUserResult(null); setUserErr("");
    try {
      const res = await fetch("/api/username-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
      const json = (await res.json()) as UsernameLookupResponse | ApiErrorResponse;
      if (!res.ok) { setUserErr((json as ApiErrorResponse).error ?? `HTTP ${res.status}`); setUserStatus("error"); return; }
      setUserResult(json as UsernameLookupResponse); setUserStatus("done"); addEntity("username", (json as UsernameLookupResponse).username);
    } catch { setUserErr("Network error — is the dev server running?"); setUserStatus("error"); }
  }, [addEntity]);

  const runIp = useCallback(async (ipAddr: string) => {
    setIpStatus("loading"); setIpResult(null); setIpErr("");
    try {
      const res = await fetch("/api/ip-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip: ipAddr }) });
      const json = (await res.json()) as IpLookupResponse | ApiErrorResponse;
      if (!res.ok) { setIpErr((json as ApiErrorResponse).error ?? `HTTP ${res.status}`); setIpStatus("error"); return; }
      setIpResult(json as IpLookupResponse); setIpStatus("done"); addEntity("ip", (json as IpLookupResponse).input);
    } catch { setIpErr("Network error — is the dev server running?"); setIpStatus("error"); }
  }, [addEntity]);

  const runDomain = useCallback(async (domain: string) => {
    setDomStatus("loading"); setDomResult(null); setDomErr("");
    try {
      const res = await fetch("/api/domain-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain }) });
      const json = (await res.json()) as DomainLookupResponse | ApiErrorResponse;
      if (!res.ok) { setDomErr((json as ApiErrorResponse).error ?? `HTTP ${res.status}`); setDomStatus("error"); return; }
      setDomResult(json as DomainLookupResponse); setDomStatus("done"); addEntity("domain", (json as DomainLookupResponse).domain);
    } catch { setDomErr("Network error — is the dev server running?"); setDomStatus("error"); }
  }, [addEntity]);

  const handleBootDone = useCallback(() => {
    setBooted(true);
    const q = searchParams.get("q");
    if (q) void runLookup(q);
  }, [searchParams, runLookup]);

  // Command palette smart-run
  const onQuickLookup = useCallback((m: Mode, value: string) => {
    setMode(m);
    if (m === "phone") void runLookup(value);
    else if (m === "email") void runEmail(value);
    else if (m === "username") void runUsername(value);
    else if (m === "ip") void runIp(value);
    else if (m === "domain") void runDomain(value);
  }, [runLookup, runEmail, runUsername, runIp, runDomain]);

  return (
    <>
      <MatrixRain />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="border-b border-[var(--hv-glass-border)] px-4 sm:px-6 py-3 flex items-center justify-between glass sticky top-0 z-20">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Terminal className="w-5 h-5 text-[var(--hv-green)] shrink-0" />
            <span className="font-mono font-bold text-sm sm:text-base tracking-widest">
              <span className="glow-green">HEAVEN</span>
              <span className="text-[var(--hv-ink-dim)]">-</span>
              <span className="gradient-text">GeoIntel</span>
            </span>
            <span className="text-[11px] text-[var(--hv-ink-dim)] uppercase tracking-widest hidden md:block">
              {"//"} unified osint platform
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <CommandPalette onMode={setMode} onQuickLookup={onQuickLookup} />
            <ThemeToggle />
            <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-[var(--hv-ink-dim)] font-mono">
              <Shield className="w-3 h-3" /> DEFENSIVE OSINT
            </div>
            <div className="text-[11px] text-[var(--hv-ink-dim)] font-mono hidden sm:block">v1.3</div>
          </div>
        </header>

        <main id="main" className="flex-1 container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-5xl">
          {isBooting && (
            <div className="mb-6 terminal-card p-4 sm:p-6">
              <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] mb-4">
                [ SYSTEM INIT ] — HEAVEN-GeoIntel Unified OSINT Platform
              </div>
              <BootSequence onDone={handleBootDone} />
            </div>
          )}

          {!isBooting && (
            <div className="terminal-card holo p-4 sm:p-5 mb-4 space-y-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)]">[ TARGET ACQUISITION ]</div>
                  <div className="text-[11px] font-mono text-[var(--hv-ink-dim)] hidden sm:block">
                    press <kbd className="px-1 py-0.5 rounded bg-[var(--hv-glass-border)]">⌘K</kbd> for command palette
                  </div>
                </div>
                {/* 8-mode switcher */}
                <div className="flex flex-wrap gap-1.5 font-mono text-sm" role="tablist" aria-label="Lookup mode">
                  {MODES.map((m) => (
                    <button key={m.id} onClick={() => setMode(m.id)} role="tab" aria-selected={mode === m.id}
                      className={`px-3 py-2 rounded-md border tracking-widest uppercase transition-all text-xs sm:text-sm focus:outline-none ${
                        mode === m.id
                          ? "border-[var(--hv-green)] text-[var(--hv-green)] bg-[var(--hv-green)]/10 shadow-[0_0_14px_-2px_var(--hv-green)]"
                          : "border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:border-[var(--hv-glass-hi)] hover:text-[var(--hv-ink)]"
                      }`}>
                      <span className="mr-1">{m.glyph}</span>{m.label}
                    </button>
                  ))}
                </div>
              </div>

              {mode === "phone" && (
                <PhoneInput onLookup={runLookup} onClear={phoneStatus !== "idle" || phoneResult ? () => { setPhoneStatus("idle"); setPhoneResult(null); setPhoneErr(""); setCurrentE164(""); router.replace("/", { scroll: false }); } : undefined} loading={phoneStatus === "loading"} />
              )}
              {mode === "email" && (
                <EmailInput onLookup={runEmail} onClear={emailStatus !== "idle" || emailResult ? () => { setEmailStatus("idle"); setEmailResult(null); setEmailErr(""); } : undefined} loading={emailStatus === "loading"} />
              )}
              {mode === "username" && (
                <SimpleLookupInput placeholder="username / handle (no @)" hint="Checks ~45 sites for a registered account — found / unverified."
                  icon={<AtSign className="w-4 h-4" />} loading={userStatus === "loading"} onLookup={runUsername}
                  onClear={userStatus !== "idle" ? () => { setUserStatus("idle"); setUserResult(null); setUserErr(""); } : undefined}
                  validate={(v) => /^[a-zA-Z0-9._-]{2,40}$/.test(v.replace(/^@/, "")) ? null : "2–40 chars: letters, digits, . _ -"} />
              )}
              {mode === "ip" && (
                <SimpleLookupInput placeholder="8.8.8.8 or 2606:4700:4700::1111" hint="Geo, ASN, ISP, reverse DNS + VPN/proxy/hosting flags. Free, no key."
                  icon={<Network className="w-4 h-4" />} loading={ipStatus === "loading"} onLookup={runIp}
                  onClear={ipStatus !== "idle" ? () => { setIpStatus("idle"); setIpResult(null); setIpErr(""); } : undefined} />
              )}
              {mode === "domain" && (
                <SimpleLookupInput placeholder="example.com" hint="DNS, WHOIS, SPF/DMARC, subdomains (cert transparency). Free, no key."
                  icon={<Globe className="w-4 h-4" />} loading={domStatus === "loading"} onLookup={runDomain}
                  onClear={domStatus !== "idle" ? () => { setDomStatus("idle"); setDomResult(null); setDomErr(""); } : undefined} />
              )}
              {mode === "bulk" && <BulkLookup />}
            </div>
          )}

          {/* History — phone mode only */}
          {!isBooting && mode === "phone" && (
            <div className="mb-4"><HistorySidebar onSelect={runLookup} currentE164={currentE164} /></div>
          )}

          {/* Loading states */}
          {((mode === "phone" && phoneStatus === "loading") || (mode === "email" && emailStatus === "loading")
            || (mode === "username" && userStatus === "loading") || (mode === "ip" && ipStatus === "loading")
            || (mode === "domain" && domStatus === "loading")) && <LoadingSkeletons />}

          {/* Errors */}
          {((mode === "phone" && phoneStatus === "error" && phoneErr) || (mode === "email" && emailStatus === "error" && emailErr)
            || (mode === "username" && userStatus === "error" && userErr) || (mode === "ip" && ipStatus === "error" && ipErr)
            || (mode === "domain" && domStatus === "error" && domErr)) && (
            <div className="mt-6 terminal-card p-5 border" style={{ borderColor: "#ff4d6d50" }}>
              <div className="text-[13px] uppercase tracking-widest text-[#ff4d6d]/70 mb-2">[ LOOKUP FAILED ]</div>
              <div className="text-[#ff4d6d] font-mono text-sm">
                <span className="opacity-60">[ERROR] </span>
                {mode === "phone" ? phoneErr : mode === "email" ? emailErr : mode === "username" ? userErr : mode === "ip" ? ipErr : domErr}
              </div>
            </div>
          )}

          {/* Results */}
          {mode === "phone"    && phoneStatus === "done" && phoneResult && <PanelErrorBoundary label="Phone results"><ResultsDashboard data={phoneResult} /></PanelErrorBoundary>}
          {mode === "email"    && emailStatus === "done" && emailResult && <PanelErrorBoundary label="Email results"><EmailResultsDashboard data={emailResult} /></PanelErrorBoundary>}
          {mode === "username" && userStatus === "done"  && userResult  && <PanelErrorBoundary label="Username results"><UsernameResultsDashboard data={userResult} /></PanelErrorBoundary>}
          {mode === "ip"       && ipStatus === "done"    && ipResult    && <PanelErrorBoundary label="IP results"><IpResultsDashboard data={ipResult} /></PanelErrorBoundary>}
          {mode === "domain"   && domStatus === "done"   && domResult   && <PanelErrorBoundary label="Domain results"><DomainResultsDashboard data={domResult} /></PanelErrorBoundary>}

          {!isBooting && mode === "graph" && (
            <div className="mt-6"><PanelErrorBoundary label="Graph"><LinkGraph entities={sessionEntities} title="SESSION LINK GRAPH" /></PanelErrorBoundary></div>
          )}
          {!isBooting && mode === "cases" && <PanelErrorBoundary label="Cases"><CasesPanel /></PanelErrorBoundary>}
        </main>

        <footer className="border-t border-[var(--hv-glass-border)] px-4 py-4 glass">
          <div className="text-center text-[12px] font-mono text-[var(--hv-ink-dim)] tracking-widest uppercase">
            OSINT METADATA ONLY · NO REAL-TIME LOCATION · USE RESPONSIBLY
          </div>
          <div className="text-center text-[11px] font-mono text-[var(--hv-ink-dim)] opacity-60 mt-1 tracking-wide">
            Phone · Email · Username · IP · Domain · Link-analysis · Persistent cases · Offline-first
          </div>
        </footer>
      </div>
    </>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center font-mono text-[var(--hv-ink-dim)] text-sm">[ LOADING... ]</div>}>
      <PageContent />
    </Suspense>
  );
}
