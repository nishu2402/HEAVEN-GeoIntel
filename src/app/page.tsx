"use client";

import { useState, useCallback, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Shield, Terminal, AtSign, Network, Globe } from "lucide-react";
import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse, IpLookupResponse, DomainLookupResponse,
} from "@/lib/types";
import { countryToFlagEmoji } from "@/lib/analysis/phoneAnalysis";
import { MODES, type Mode } from "@/lib/client/modes";
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
import AddToCase from "@/components/shared/AddToCase";
import {
  entitiesFromPhone, entitiesFromEmail, entitiesFromUsername, entitiesFromIp, entitiesFromDomain,
} from "@/lib/analysis/entityExtract";
import LinkGraph from "@/components/graph/LinkGraph";
import LoadingSkeletons from "@/components/dashboard/LoadingSkeletons";
import ScanProgress from "@/components/dashboard/ScanProgress";
import BootSequence from "@/components/shared/BootSequence";
import SimpleLookupInput from "@/components/shared/SimpleLookupInput";
import ThemeToggle from "@/components/shared/ThemeToggle";
import EffectsToggle from "@/components/shared/EffectsToggle";
import SourcesPanel from "@/components/shared/SourcesPanel";
import HelpPopover from "@/components/shared/HelpPopover";
import CommandPalette from "@/components/shared/CommandPalette";
import PanelErrorBoundary from "@/components/shared/PanelErrorBoundary";
import ConsentGate from "@/components/shared/ConsentGate";
import RecentLookups from "@/components/shared/RecentLookups";
import { pushLookup } from "@/lib/client/lookupHistory";
import { getSessionGraph, saveSessionGraph } from "@/lib/client/sessionGraph";
import { saveToHistory } from "@/components/dashboard/HistorySidebar";

const MatrixRain = dynamic(() => import("@/components/shared/MatrixRain"), { ssr: false });
const HistorySidebar = dynamic(() => import("@/components/dashboard/HistorySidebar"), { ssr: false });

type Status = "idle" | "loading" | "done" | "error";
interface ApiErrorResponse { error?: string }

const BOOTED_KEY = "hv-booted-v1";

// One-click sample values so a first-time user is never staring at a blank box.
function ExampleChips({ items, onPick }: { items: string[]; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-mono text-[var(--hv-ink-dim)] uppercase tracking-widest">Try</span>
      {items.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          className="text-[11px] font-mono px-2 py-0.5 rounded-md border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] transition-colors"
        >
          {v}
        </button>
      ))}
    </div>
  );
}

function PageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("phone");
  // MUST start false on BOTH server and first client render (the server has no
  // localStorage) — reading the flag here would cause a hydration mismatch. The
  // mount effect below flips it to true immediately for returning visitors, so
  // the boot animation is skipped after the first run (no full replay).
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

  // Session graph — every successful lookup seeds it with the primary identifier
  // AND the identifiers that result derived (a domain's IPs, an IP's reverse host,
  // an email's domain, …), so the graph fills with real relationships as you work.
  // It also survives a reload: hydrated from localStorage on mount and persisted
  // on every change (see the two effects below).
  const [sessionEntities, setSessionEntities] = useState<GraphEntity[]>([]);
  const [graphHydrated, setGraphHydrated] = useState(false);
  const addEntities = useCallback((list: { kind: GraphEntity["kind"]; value: string }[]) => {
    if (list.length === 0) return;
    setSessionEntities((prev) => {
      const seen = new Set(prev.map((e) => `${e.kind}:${e.value.toLowerCase()}`));
      const merged = [...prev];
      for (const e of list) {
        const k = `${e.kind}:${e.value.toLowerCase()}`;
        if (!seen.has(k)) { seen.add(k); merged.push({ kind: e.kind, value: e.value }); }
      }
      return merged;
    });
    pushLookup(list[0].kind, list[0].value); // primary only → cross-mode history
  }, []);

  // Hydrate the session graph from localStorage once on mount. Kept out of the
  // initial useState (the server has no localStorage — reading it there would
  // cause an SSR/first-render hydration mismatch). Merge, don't replace: a
  // deep-link lookup may have already added nodes before this effect runs.
  useEffect(() => {
    const saved = getSessionGraph();
    if (saved.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessionEntities((prev) => {
        const seen = new Set(prev.map((e) => `${e.kind}:${e.value.toLowerCase()}`));
        const merged = [...prev];
        for (const e of saved) {
          const k = `${e.kind}:${e.value.toLowerCase()}`;
          if (!seen.has(k)) { seen.add(k); merged.push(e); }
        }
        return merged;
      });
    }
    setGraphHydrated(true);
    // run once on mount
  }, []);

  // Persist the session graph on every change — but only after hydration, so the
  // initial empty state can never clobber a previously saved graph.
  useEffect(() => {
    if (!graphHydrated) return;
    saveSessionGraph(sessionEntities);
  }, [graphHydrated, sessionEntities]);

  const isBooting = !booted;

  // Reflect the active lookup in the URL (?mode=…&q=…) so EVERY result — not just
  // phone — is bookmarkable and shareable by copying the address bar.
  const syncUrl = useCallback((m: Mode, value: string) => {
    const p = new URLSearchParams(); p.set("mode", m); p.set("q", value);
    router.replace(`?${p.toString()}`, { scroll: false });
  }, [router]);

  // ── Lookup runners ──────────────────────────────────────────────────────
  const runLookup = useCallback(async (number: string) => {
    setPhoneStatus("loading"); setPhoneResult(null); setPhoneErr(""); setCurrentE164(number);
    syncUrl("phone", number);
    try {
      const res = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number }) });
      const json = (await res.json()) as LookupResponse | ApiErrorResponse;
      if (!res.ok) { setPhoneErr((json as ApiErrorResponse).error ?? `HTTP ${res.status}`); setPhoneStatus("error"); return; }
      const data = json as LookupResponse;
      setPhoneResult(data); setPhoneStatus("done");
      addEntities(entitiesFromPhone(data));
      saveToHistory({ e164: data.input.e164, country: data.input.country, countryCallingCode: data.input.countryCallingCode, timestamp: Date.now(), flagEmoji: countryToFlagEmoji(data.input.country) });
    } catch { setPhoneErr("Couldn't reach the server. Check your connection and try again."); setPhoneStatus("error"); }
  }, [syncUrl, addEntities]);

  const runEmail = useCallback(async (email: string) => {
    setEmailStatus("loading"); setEmailResult(null); setEmailErr(""); syncUrl("email", email);
    try {
      const res = await fetch("/api/email-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const json = (await res.json()) as EmailLookupResponse | ApiErrorResponse;
      if (!res.ok) { setEmailErr((json as ApiErrorResponse).error ?? `HTTP ${res.status}`); setEmailStatus("error"); return; }
      setEmailResult(json as EmailLookupResponse); setEmailStatus("done"); addEntities(entitiesFromEmail(json as EmailLookupResponse));
    } catch { setEmailErr("Couldn't reach the server. Check your connection and try again."); setEmailStatus("error"); }
  }, [syncUrl, addEntities]);

  const runUsername = useCallback(async (username: string) => {
    setUserStatus("loading"); setUserResult(null); setUserErr(""); syncUrl("username", username);
    try {
      const res = await fetch("/api/username-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
      const json = (await res.json()) as UsernameLookupResponse | ApiErrorResponse;
      if (!res.ok) { setUserErr((json as ApiErrorResponse).error ?? `HTTP ${res.status}`); setUserStatus("error"); return; }
      setUserResult(json as UsernameLookupResponse); setUserStatus("done"); addEntities(entitiesFromUsername(json as UsernameLookupResponse));
    } catch { setUserErr("Couldn't reach the server. Check your connection and try again."); setUserStatus("error"); }
  }, [syncUrl, addEntities]);

  const runIp = useCallback(async (ipAddr: string) => {
    setIpStatus("loading"); setIpResult(null); setIpErr(""); syncUrl("ip", ipAddr);
    try {
      const res = await fetch("/api/ip-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip: ipAddr }) });
      const json = (await res.json()) as IpLookupResponse | ApiErrorResponse;
      if (!res.ok) { setIpErr((json as ApiErrorResponse).error ?? `HTTP ${res.status}`); setIpStatus("error"); return; }
      setIpResult(json as IpLookupResponse); setIpStatus("done"); addEntities(entitiesFromIp(json as IpLookupResponse));
    } catch { setIpErr("Couldn't reach the server. Check your connection and try again."); setIpStatus("error"); }
  }, [syncUrl, addEntities]);

  const runDomain = useCallback(async (domain: string) => {
    setDomStatus("loading"); setDomResult(null); setDomErr(""); syncUrl("domain", domain);
    try {
      const res = await fetch("/api/domain-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain }) });
      const json = (await res.json()) as DomainLookupResponse | ApiErrorResponse;
      if (!res.ok) { setDomErr((json as ApiErrorResponse).error ?? `HTTP ${res.status}`); setDomStatus("error"); return; }
      setDomResult(json as DomainLookupResponse); setDomStatus("done"); addEntities(entitiesFromDomain(json as DomainLookupResponse));
    } catch { setDomErr("Couldn't reach the server. Check your connection and try again."); setDomStatus("error"); }
  }, [syncUrl, addEntities]);

  // Run whatever a shared/bookmarked URL points at: ?mode=…&q=… (defaults to phone
  // for a bare ?q= so older phone share links still work).
  const runDeep = useCallback(() => {
    const q = searchParams.get("q");
    if (!q) return;
    switch (searchParams.get("mode")) {
      case "email":    setMode("email");    void runEmail(q);    break;
      case "username": setMode("username"); void runUsername(q); break;
      case "ip":       setMode("ip");       void runIp(q);       break;
      case "domain":   setMode("domain");   void runDomain(q);   break;
      default:         void runLookup(q);
    }
  }, [searchParams, runLookup, runEmail, runUsername, runIp, runDomain]);

  const handleBootDone = useCallback(() => {
    setBooted(true);
    try { localStorage.setItem(BOOTED_KEY, "1"); } catch { /* ignore */ }
    runDeep();
  }, [runDeep]);

  // Returning visitor: skip the boot animation entirely (it already played once).
  // Still honours a ?mode=&q= deep link so a shared result URL runs immediately.
  useEffect(() => {
    try {
      if (localStorage.getItem(BOOTED_KEY) === "1") {
        // Returning visitor: skip the boot animation and run any deep link. This
        // is a one-shot mount side effect, not derivable state — the rule flags
        // the setBooted here, but the effect is the correct tool.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setBooted(true);
        runDeep();
      }
    } catch { /* ignore */ }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Command palette smart-run
  const onQuickLookup = useCallback((m: Mode, value: string) => {
    setMode(m);
    if (m === "phone") void runLookup(value);
    else if (m === "email") void runEmail(value);
    else if (m === "username") void runUsername(value);
    else if (m === "ip") void runIp(value);
    else if (m === "domain") void runDomain(value);
  }, [runLookup, runEmail, runUsername, runIp, runDomain]);

  // Keyboard shortcuts: 1–8 switch mode, "/" focuses the input. Ignored while the
  // user is typing or holding a modifier (so ⌘K and normal input still work).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key >= "1" && e.key <= "8") {
        const m = MODES[Number(e.key) - 1];
        if (m) { e.preventDefault(); setMode(m.id); }
      } else if (e.key === "/") {
        const input = document.querySelector<HTMLElement>("main input, main textarea");
        if (input) { e.preventDefault(); input.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <ConsentGate />
      <MatrixRain />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="border-b border-[var(--hv-glass-border)] px-4 sm:px-6 py-3 flex items-center justify-between glass sticky top-0 z-20">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Terminal className="w-5 h-5 text-[var(--hv-green)] shrink-0" />
            <h1 className="font-mono font-bold text-sm sm:text-base tracking-widest m-0">
              <span className="glow-green">HEAVEN</span>
              <span className="text-[var(--hv-ink-dim)]">-</span>
              <span className="gradient-text">GeoIntel</span>
            </h1>
            <span className="text-[11px] text-[var(--hv-ink-dim)] uppercase tracking-widest hidden md:block">
              {"//"} unified osint platform
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <CommandPalette onMode={setMode} onQuickLookup={onQuickLookup} />
            <RecentLookups onRun={onQuickLookup} />
            <SourcesPanel />
            <HelpPopover />
            <EffectsToggle />
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

          {/* relative z-10 on the input card: lift it above the sibling cards below
              it (History, results) so the country dropdown — trapped in this card's
              backdrop-filter stacking context — overlays them instead of being
              painted under. Stays below the sticky header (z-20). */}
          {!isBooting && (
            <div className="terminal-card holo p-4 sm:p-5 mb-4 space-y-4 relative z-10">
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
                <>
                  <PhoneInput onLookup={runLookup} onClear={phoneStatus !== "idle" || phoneResult ? () => { setPhoneStatus("idle"); setPhoneResult(null); setPhoneErr(""); setCurrentE164(""); router.replace("/", { scroll: false }); } : undefined} loading={phoneStatus === "loading"} />
                  {phoneStatus === "idle" && !phoneResult && <ExampleChips items={["+1 415 555 2671", "+44 7911 123456", "+91 98765 43210"]} onPick={runLookup} />}
                </>
              )}
              {mode === "email" && (
                <>
                  <EmailInput onLookup={runEmail} onClear={emailStatus !== "idle" || emailResult ? () => { setEmailStatus("idle"); setEmailResult(null); setEmailErr(""); router.replace("/", { scroll: false }); } : undefined} loading={emailStatus === "loading"} />
                  {emailStatus === "idle" && !emailResult && <ExampleChips items={["test@example.com", "john.doe@gmail.com"]} onPick={runEmail} />}
                </>
              )}
              {mode === "username" && (
                <>
                  <SimpleLookupInput placeholder="username / handle (no @)" hint="Pulls rich profiles from GitHub, GitLab, Hacker News & Reddit + sweeps dozens more sites — never a false positive."
                    icon={<AtSign className="w-4 h-4" />} loading={userStatus === "loading"} onLookup={runUsername}
                    onClear={userStatus !== "idle" ? () => { setUserStatus("idle"); setUserResult(null); setUserErr(""); router.replace("/", { scroll: false }); } : undefined}
                    validate={(v) => /^[a-zA-Z0-9._-]{2,40}$/.test(v.replace(/^@/, "")) ? null : "2–40 chars: letters, digits, . _ -"} />
                  {userStatus === "idle" && <ExampleChips items={["torvalds", "octocat"]} onPick={runUsername} />}
                </>
              )}
              {mode === "ip" && (
                <>
                  <SimpleLookupInput placeholder="8.8.8.8 or 2606:4700:4700::1111" hint="Geo, ASN, ISP, reverse DNS + VPN/proxy/hosting flags. Free, no key."
                    icon={<Network className="w-4 h-4" />} loading={ipStatus === "loading"} onLookup={runIp}
                    onClear={ipStatus !== "idle" ? () => { setIpStatus("idle"); setIpResult(null); setIpErr(""); router.replace("/", { scroll: false }); } : undefined} />
                  {ipStatus === "idle" && <ExampleChips items={["8.8.8.8", "1.1.1.1"]} onPick={runIp} />}
                </>
              )}
              {mode === "domain" && (
                <>
                  <SimpleLookupInput placeholder="example.com" hint="DNS, WHOIS, SPF/DMARC, subdomains (cert transparency). Free, no key."
                    icon={<Globe className="w-4 h-4" />} loading={domStatus === "loading"} onLookup={runDomain}
                    onClear={domStatus !== "idle" ? () => { setDomStatus("idle"); setDomResult(null); setDomErr(""); router.replace("/", { scroll: false }); } : undefined} />
                  {domStatus === "idle" && <ExampleChips items={["github.com", "cloudflare.com"]} onPick={runDomain} />}
                </>
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
            || (mode === "domain" && domStatus === "loading")) && <><ScanProgress mode={mode} /><LoadingSkeletons /></>}

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

          {/* Results — each can pin its primary + derived identifiers to a case in one click */}
          {mode === "phone"    && phoneStatus === "done" && phoneResult && <PanelErrorBoundary label="Phone results"><div className="mt-6 flex justify-end"><AddToCase entities={entitiesFromPhone(phoneResult)} /></div><ResultsDashboard data={phoneResult} onUsernameSweep={(h) => { setMode("username"); void runUsername(h); }} onEmailLookup={(e) => { setMode("email"); void runEmail(e); }} /></PanelErrorBoundary>}
          {mode === "email"    && emailStatus === "done" && emailResult && <PanelErrorBoundary label="Email results"><div className="mt-6 flex justify-end"><AddToCase entities={entitiesFromEmail(emailResult)} /></div><EmailResultsDashboard data={emailResult} onUsernameSweep={(h) => { setMode("username"); void runUsername(h); }} /></PanelErrorBoundary>}
          {mode === "username" && userStatus === "done"  && userResult  && <PanelErrorBoundary label="Username results"><div className="mt-6 flex justify-end"><AddToCase entities={entitiesFromUsername(userResult)} /></div><UsernameResultsDashboard data={userResult} /></PanelErrorBoundary>}
          {mode === "ip"       && ipStatus === "done"    && ipResult    && <PanelErrorBoundary label="IP results"><div className="mt-6 flex justify-end"><AddToCase entities={entitiesFromIp(ipResult)} /></div><IpResultsDashboard data={ipResult} onDomainLookup={(d) => { setMode("domain"); void runDomain(d); }} /></PanelErrorBoundary>}
          {mode === "domain"   && domStatus === "done"   && domResult   && <PanelErrorBoundary label="Domain results"><div className="mt-6 flex justify-end"><AddToCase entities={entitiesFromDomain(domResult)} /></div><DomainResultsDashboard data={domResult} onIpLookup={(v) => { setMode("ip"); void runIp(v); }} /></PanelErrorBoundary>}

          {!isBooting && mode === "graph" && (
            <div className="mt-6"><PanelErrorBoundary label="Graph"><LinkGraph entities={sessionEntities} title="SESSION LINK GRAPH" onChange={setSessionEntities} /></PanelErrorBoundary></div>
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
          <div className="text-center text-[11px] font-mono text-[var(--hv-ink-dim)] mt-2 tracking-wide">
            Created &amp; developed by <span className="text-[var(--hv-cyan)] font-bold">Nisarg Chasmawala (Shroff)</span>
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
