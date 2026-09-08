"use client";

import { useState, useCallback, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Shield, AtSign, Network, Globe, RefreshCw, X, Sparkles } from "lucide-react";
import type {
  LookupResponse, EmailLookupResponse, UsernameLookupResponse, IpLookupResponse, DomainLookupResponse, WalletLookupResponse, HashLookupResponse,
} from "@/lib/types";
import { countryToFlagEmoji } from "@/lib/analysis/phoneAnalysis";
import { MODES, toMode, detectMode, modeName, type Mode } from "@/lib/client/modes";
import { postLookup } from "@/lib/client/postLookup";
import type { GraphEntity } from "@/components/graph/LinkGraph";

import PhoneInput from "@/components/phone/PhoneInput";
import EmailInput from "@/components/email/EmailInput";
import BulkLookup from "@/components/dashboard/BulkLookup";
import ResultsDashboard from "@/components/dashboard/ResultsDashboard";
import EmailResultsDashboard from "@/components/email/EmailResultsDashboard";
import UsernameResultsDashboard from "@/components/username/UsernameResultsDashboard";
import IpResultsDashboard from "@/components/network/IpResultsDashboard";
import DomainResultsDashboard from "@/components/network/DomainResultsDashboard";
import WalletResultsDashboard from "@/components/wallet/WalletResultsDashboard";
import HashResultsDashboard from "@/components/hash/HashResultsDashboard";
import CryptoWorkbench from "@/components/hash/CryptoWorkbench";
import PwnedPasswordCheck from "@/components/hash/PwnedPasswordCheck";
import CasesPanel from "@/components/cases/CasesPanel";
import ImageExifPanel from "@/components/image/ImageExifPanel";
import EmailHeaderTracePanel from "@/components/email/EmailHeaderTracePanel";
import AddToCase from "@/components/shared/AddToCase";
import {
  entitiesFromPhone, entitiesFromEmail, entitiesFromUsername, entitiesFromIp, entitiesFromDomain,
} from "@/lib/analysis/entityExtract";
import {
  pivotsFromPhone, pivotsFromEmail, pivotsFromUsername, pivotsFromIp, pivotsFromDomain,
  edgesFromPivots,
} from "@/lib/analysis/autoPivot";
import {
  factsFromPhone, factsFromEmail, factsFromUsername, factsFromIp, factsFromDomain,
} from "@/lib/analysis/caseSnapshot";
import AutoPivots from "@/components/shared/AutoPivots";
import AiAnalysisPanel from "@/components/shared/AiAnalysisPanel";
import AiTextIntel from "@/components/shared/AiTextIntel";
import LinkGraph from "@/components/graph/LinkGraph";
import LoadingSkeletons from "@/components/dashboard/LoadingSkeletons";
import ScanProgress from "@/components/dashboard/ScanProgress";
import BootSequence from "@/components/shared/BootSequence";
import SimpleLookupInput from "@/components/shared/SimpleLookupInput";
import ThemeToggle from "@/components/shared/ThemeToggle";
import EffectsToggle from "@/components/shared/EffectsToggle";
import SourcesPanel from "@/components/shared/SourcesPanel";
import NotableBreachesPanel from "@/components/shared/NotableBreachesPanel";
import UpdateChecker from "@/components/shared/UpdateChecker";
import UpdateBanner from "@/components/shared/UpdateBanner";
import HelpPopover from "@/components/shared/HelpPopover";
import OpsecPanel from "@/components/shared/OpsecPanel";
import CommandPalette from "@/components/shared/CommandPalette";
import PanelErrorBoundary from "@/components/shared/PanelErrorBoundary";
import ConsentGate from "@/components/shared/ConsentGate";
import Logo, { LogoLockup } from "@/components/shared/Logo";
import RecentLookups from "@/components/shared/RecentLookups";
import { APP_VERSION } from "@/lib/version";
import { pushLookup } from "@/lib/client/lookupHistory";
import { getSessionGraph, saveSessionGraph } from "@/lib/client/sessionGraph";
import { saveToHistory } from "@/components/dashboard/HistorySidebar";

const MatrixRain = dynamic(() => import("@/components/shared/MatrixRain"), { ssr: false });
const HistorySidebar = dynamic(() => import("@/components/dashboard/HistorySidebar"), { ssr: false });

type Status = "idle" | "loading" | "done" | "error";

const BOOTED_KEY = "hv-booted-v1";
// Separate from BOOTED_KEY so the one-time orientation can be reset (or added
// for existing users) without replaying the boot animation.
const TOUR_KEY = "hv-tour-seen-v1";

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

// First-run orientation: a single dismissible card that points a brand-new
// visitor at the few things worth knowing, then never shows again. Kept
// deliberately light (one card, no multi-step spotlight overlay) so it guides
// without getting in the way of the affordances that already exist — the boot
// splash, the example chips, the ⌘K hint, and Help.
function WelcomeTour({ onDismiss }: { onDismiss: () => void }) {
  const steps = [
    { n: "1", accent: "var(--hv-green)", title: "Pick a mode", body: "Use the tabs below (or press 1 to 9) to switch between phone, email, username, IP, domain, wallet, hash, and more." },
    { n: "2", accent: "var(--hv-cyan)", title: "Not sure? Try one", body: "Tap an example chip under the box, or press ⌘K to search every mode from a single bar." },
    { n: "3", accent: "var(--hv-amber)", title: "Go deeper", body: "Every result copies, exports, and pivots to related identifiers. Add optional API keys later under Sources for wider coverage." },
  ];
  return (
    <div className="terminal-card holo p-4 sm:p-5 mb-4 relative">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss the welcome guide"
        className="absolute top-2.5 right-2.5 p-1 rounded text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)] hover:bg-[var(--hv-glass-border)]/40 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-center gap-2 mb-2 pr-8">
        <Sparkles className="w-4 h-4 text-[var(--hv-cyan)]" />
        <span className="font-mono font-bold tracking-widest uppercase text-sm">New here? 30-second orientation</span>
      </div>
      <p className="text-[13px] text-[var(--hv-ink-dim)] leading-relaxed mb-3">
        Pick what you are investigating, drop in one identifier, and get a keyless OSINT read. No account, no API key.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-3">
        {steps.map((s) => (
          <div key={s.n} className="rounded-md border border-[var(--hv-glass-border)] p-2.5">
            <div className="text-[11px] font-mono font-bold uppercase tracking-widest mb-1" style={{ color: s.accent }}>{s.n} · {s.title}</div>
            <div className="text-[12px] text-[var(--hv-ink-dim)] leading-snug">{s.body}</div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="btn-neon px-4 py-2 text-[11px] font-mono font-bold uppercase tracking-widest"
      >
        Got it, start investigating
      </button>
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

  const [walletStatus, setWalletStatus] = useState<Status>("idle");
  const [walletResult, setWalletResult] = useState<WalletLookupResponse | null>(null);
  const [walletErr, setWalletErr] = useState("");

  const [hashStatus, setHashStatus] = useState<Status>("idle");
  const [hashResult, setHashResult] = useState<HashLookupResponse | null>(null);
  const [hashErr, setHashErr] = useState("");

  // Last dispatched lookup (mode + value), captured at the top of every runner.
  // When a lookup fails, the error card uses it to re-run in one click, so a
  // dropped connection or a rate-limited upstream never forces a full re-type.
  const [lastRun, setLastRun] = useState<{ mode: Mode; value: string } | null>(null);

  // First-run orientation card. Defaults to hidden and is switched on from an
  // effect after mount (never during SSR, where there is no localStorage) so the
  // server and first client render agree — the same hydration-safe pattern the
  // boot flag uses.
  const [showTour, setShowTour] = useState(false);
  const dismissTour = useCallback(() => {
    setShowTour(false);
    try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* ignore */ }
  }, []);

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
    setLastRun({ mode: "phone", value: number }); syncUrl("phone", number);
    const out = await postLookup<LookupResponse>("/api/lookup", { number });
    if (!out.ok) { setPhoneErr(out.error); setPhoneStatus("error"); return; }
    const data = out.data;
    setPhoneResult(data); setPhoneStatus("done");
    addEntities(entitiesFromPhone(data));
    saveToHistory({ e164: data.input.e164, country: data.input.country, countryCallingCode: data.input.countryCallingCode, timestamp: Date.now(), flagEmoji: countryToFlagEmoji(data.input.country) });
  }, [syncUrl, addEntities]);

  const runEmail = useCallback(async (email: string) => {
    setEmailStatus("loading"); setEmailResult(null); setEmailErr(""); setLastRun({ mode: "email", value: email }); syncUrl("email", email);
    const out = await postLookup<EmailLookupResponse>("/api/email-lookup", { email });
    if (!out.ok) { setEmailErr(out.error); setEmailStatus("error"); return; }
    setEmailResult(out.data); setEmailStatus("done"); addEntities(entitiesFromEmail(out.data));
  }, [syncUrl, addEntities]);

  const runUsername = useCallback(async (username: string) => {
    setUserStatus("loading"); setUserResult(null); setUserErr(""); setLastRun({ mode: "username", value: username }); syncUrl("username", username);
    const out = await postLookup<UsernameLookupResponse>("/api/username-lookup", { username });
    if (!out.ok) { setUserErr(out.error); setUserStatus("error"); return; }
    setUserResult(out.data); setUserStatus("done"); addEntities(entitiesFromUsername(out.data));
  }, [syncUrl, addEntities]);

  const runIp = useCallback(async (ipAddr: string) => {
    setIpStatus("loading"); setIpResult(null); setIpErr(""); setLastRun({ mode: "ip", value: ipAddr }); syncUrl("ip", ipAddr);
    const out = await postLookup<IpLookupResponse>("/api/ip-lookup", { ip: ipAddr });
    if (!out.ok) { setIpErr(out.error); setIpStatus("error"); return; }
    setIpResult(out.data); setIpStatus("done"); addEntities(entitiesFromIp(out.data));
  }, [syncUrl, addEntities]);

  const runDomain = useCallback(async (domain: string) => {
    setDomStatus("loading"); setDomResult(null); setDomErr(""); setLastRun({ mode: "domain", value: domain }); syncUrl("domain", domain);
    const out = await postLookup<DomainLookupResponse>("/api/domain-lookup", { domain });
    if (!out.ok) { setDomErr(out.error); setDomStatus("error"); return; }
    setDomResult(out.data); setDomStatus("done"); addEntities(entitiesFromDomain(out.data));
  }, [syncUrl, addEntities]);

  const runWallet = useCallback(async (address: string) => {
    setWalletStatus("loading"); setWalletResult(null); setWalletErr(""); setLastRun({ mode: "wallet", value: address }); syncUrl("wallet", address);
    const out = await postLookup<WalletLookupResponse>("/api/wallet-lookup", { address });
    if (!out.ok) { setWalletErr(out.error); setWalletStatus("error"); return; }
    setWalletResult(out.data); setWalletStatus("done");
  }, [syncUrl]);

  const runHash = useCallback(async (hash: string) => {
    setHashStatus("loading"); setHashResult(null); setHashErr(""); setLastRun({ mode: "hash", value: hash }); syncUrl("hash", hash);
    const out = await postLookup<HashLookupResponse>("/api/hash-lookup", { hash });
    if (!out.ok) { setHashErr(out.error); setHashStatus("error"); return; }
    setHashResult(out.data); setHashStatus("done");
  }, [syncUrl]);

  // Run whatever a shared/bookmarked URL points at: ?mode=…&q=… (defaults to phone
  // for a bare ?q= so older phone share links still work).
  //
  // The mode is restored even with no `q`. Bulk, Graph and Cases take no single
  // query, so a link copied from one of those screens carries only ?mode=… —
  // and used to open on Phone, which made "COPY LINK" misleading on exactly the
  // three screens an analyst is most likely to be sharing with a colleague.
  const runDeep = useCallback(() => {
    const q = searchParams.get("q");
    const urlMode = toMode(searchParams.get("mode"));
    if (urlMode) setMode(urlMode);
    if (!q) return;
    switch (urlMode) {
      case "email":    void runEmail(q);    break;
      case "username": void runUsername(q); break;
      case "ip":       void runIp(q);       break;
      case "domain":   void runDomain(q);   break;
      case "wallet":   void runWallet(q);   break;
      case "hash":     void runHash(q);     break;
      // A bare ?q= (an old phone share link) and ?mode=phone both land here.
      // A `q` alongside a non-lookup mode is nonsense we simply ignore.
      case "file": case "bulk": case "graph": case "cases": break;
      default:         setMode("phone"); void runLookup(q);
    }
  }, [searchParams, runLookup, runEmail, runUsername, runIp, runDomain, runWallet, runHash]);

  // Switching tabs rewrites the URL, so COPY LINK reflects the screen you are
  // actually on. Bulk, Graph and Cases take no query, so they carry ?mode= only;
  // a lookup tab re-attaches its own identifier when one is already loaded, so
  // flipping away to Graph and back does not silently drop the shareable result.
  const selectMode = useCallback((next: Mode) => {
    setMode(next);
    const query =
      next === "phone"    ? currentE164 :
      next === "email"    ? emailResult?.email ?? "" :
      next === "username" ? userResult?.username ?? "" :
      next === "ip"       ? ipResult?.input ?? "" :
      next === "domain"   ? domResult?.domain ?? "" :
      next === "wallet"   ? walletResult?.input ?? "" :
      next === "hash"     ? hashResult?.input ?? "" : "";
    const p = new URLSearchParams();
    p.set("mode", next);
    if (query) p.set("q", query);
    router.replace(`?${p.toString()}`, { scroll: false });
  }, [router, currentE164, emailResult, userResult, ipResult, domResult, walletResult, hashResult]);

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

  // Show the orientation card once, to anyone who has never dismissed it. Read
  // in an effect (not initial state) so SSR and the first client render match.
  useEffect(() => {
    try {
      if (localStorage.getItem(TOUR_KEY) !== "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShowTour(true);
      }
    } catch { /* ignore */ }
    // run once on mount
  }, []);

  // Command palette smart-run
  const onQuickLookup = useCallback((m: Mode, value: string) => {
    setMode(m);
    if (m === "phone") void runLookup(value);
    else if (m === "email") void runEmail(value);
    else if (m === "username") void runUsername(value);
    else if (m === "ip") void runIp(value);
    else if (m === "domain") void runDomain(value);
    else if (m === "wallet") void runWallet(value);
    else if (m === "hash") void runHash(value);
  }, [runLookup, runEmail, runUsername, runIp, runDomain, runWallet, runHash]);

  // Re-run the last dispatched lookup — the action behind the error card's RETRY
  // button, so a transient upstream failure is one click to recover from.
  const retryLast = useCallback(() => {
    if (lastRun) onQuickLookup(lastRun.mode, lastRun.value);
  }, [lastRun, onQuickLookup]);

  // Dismiss the active mode's error and return that mode to its idle input state.
  const dismissError = useCallback(() => {
    if (mode === "phone") { setPhoneStatus("idle"); setPhoneErr(""); }
    else if (mode === "email") { setEmailStatus("idle"); setEmailErr(""); }
    else if (mode === "username") { setUserStatus("idle"); setUserErr(""); }
    else if (mode === "ip") { setIpStatus("idle"); setIpErr(""); }
    else if (mode === "domain") { setDomStatus("idle"); setDomErr(""); }
    else if (mode === "wallet") { setWalletStatus("idle"); setWalletErr(""); }
    else if (mode === "hash") { setHashStatus("idle"); setHashErr(""); }
  }, [mode]);

  // Keyboard shortcuts: 1–8 switch mode, "/" focuses the input. Ignored while the
  // user is typing or holding a modifier (so ⌘K and normal input still work).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key >= "1" && e.key <= "9") {
        const m = MODES[Number(e.key) - 1];
        if (m) { e.preventDefault(); selectMode(m.id); }
      } else if (e.key === "/") {
        const input = document.querySelector<HTMLElement>("main input, main textarea");
        if (input) { e.preventDefault(); input.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectMode]);

  return (
    <>
      <ConsentGate />
      <MatrixRain />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Update bar — full width across the very top, shown only when a genuine
            newer release exists (same shared check as the header button). */}
        <UpdateBanner />

        {/* Header */}
        <header className="border-b border-[var(--hv-glass-border)] px-3 sm:px-6 py-3 flex items-center justify-between gap-2 glass sticky top-0 z-20">
          <h1 className="m-0 min-w-0 text-sm sm:text-base">
            <LogoLockup size={30} tagline animated compact />
          </h1>
          {/* flex-wrap + min-w-0 (not shrink-0): on a phone the control cluster
              wraps to a second row instead of forcing the whole page into a
              horizontal scroll. */}
          <div className="flex items-center flex-wrap justify-end gap-1.5 sm:gap-3 min-w-0">
            <CommandPalette onMode={setMode} onQuickLookup={onQuickLookup} />
            <RecentLookups onRun={onQuickLookup} />
            <SourcesPanel />
            <NotableBreachesPanel />
            <OpsecPanel />
            <HelpPopover />
            <UpdateChecker />
            <EffectsToggle />
            <ThemeToggle />
            <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-[var(--hv-ink-dim)] font-mono">
              <Shield className="w-3 h-3" /> DEFENSIVE OSINT
            </div>
            <div className="text-[11px] text-[var(--hv-ink-dim)] font-mono hidden sm:block">v{APP_VERSION}</div>
          </div>
        </header>

        <main id="main" className="flex-1 container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-5xl">
          {isBooting && (
            <div className="mb-6 terminal-card p-4 sm:p-6">
              {/* Cold-start splash: the mark at display size, since this panel is
                  the first thing a first-run user actually watches. */}
              <div className="flex items-center gap-3 sm:gap-4 mb-4 pb-4 border-b border-[var(--hv-glass-border)]">
                <Logo size={44} animated />
                <div className="min-w-0">
                  <div className="font-mono font-bold tracking-widest text-base sm:text-lg">
                    <span className="glow-green">HEAVEN</span>
                    <span className="text-[var(--hv-ink-dim)]">-</span>
                    <span className="gradient-text">GeoIntel</span>
                  </div>
                  <div className="text-[11px] uppercase tracking-widest text-[var(--hv-ink-dim)] mt-0.5">
                    [ SYSTEM INIT ]: Unified OSINT Platform
                  </div>
                </div>
              </div>
              <BootSequence onDone={handleBootDone} />
            </div>
          )}

          {/* One-time orientation, above the input so a first-run user reads it
              before the box. Dismissible and never shown again. */}
          {!isBooting && showTour && <WelcomeTour onDismiss={dismissTour} />}

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
                    press <kbd className="px-1 py-0.5 rounded bg-[var(--hv-glass-border)] text-[var(--hv-ink)]">⌘K</kbd> for command palette
                  </div>
                </div>
                {/* 9-mode switcher */}
                <div className="flex flex-wrap gap-1.5 font-mono text-sm" role="tablist" aria-label="Lookup mode">
                  {MODES.map((m, i) => (
                    // Keys 1-9 switch the first nine modes; surface that in the
                    // tooltip so the shortcut is discoverable without opening Help.
                    <button key={m.id} onClick={() => selectMode(m.id)} role="tab" aria-selected={mode === m.id}
                      title={i < 9 ? `${modeName(m)} · press ${i + 1}` : modeName(m)}
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
                  <PhoneInput onLookup={runLookup} activeNumber={currentE164} onClear={phoneStatus !== "idle" || phoneResult ? () => { setPhoneStatus("idle"); setPhoneResult(null); setPhoneErr(""); setCurrentE164(""); router.replace("/", { scroll: false }); } : undefined} loading={phoneStatus === "loading"} />
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
                  <SimpleLookupInput placeholder="username / handle (no @)" hint="Pulls rich profiles from GitHub, GitLab, Hacker News, Reddit & Bluesky + sweeps dozens more sites: never a false positive."
                    icon={<AtSign className="w-4 h-4" />} loading={userStatus === "loading"} onLookup={runUsername}
                    onClear={userStatus !== "idle" ? () => { setUserStatus("idle"); setUserResult(null); setUserErr(""); router.replace("/", { scroll: false }); } : undefined}
                    validate={(v) => /^[a-zA-Z0-9._-]{2,40}$/.test(v.replace(/^@/, "")) ? null : "2-40 chars: letters, digits, . _ -"} />
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
                  <SimpleLookupInput placeholder="example.com" hint="DNS, WHOIS, SPF/DMARC, subdomains, live security headers + TLS. Free, no key."
                    icon={<Globe className="w-4 h-4" />} loading={domStatus === "loading"} onLookup={runDomain}
                    onClear={domStatus !== "idle" ? () => { setDomStatus("idle"); setDomResult(null); setDomErr(""); router.replace("/", { scroll: false }); } : undefined} />
                  {domStatus === "idle" && <ExampleChips items={["github.com", "cloudflare.com"]} onPick={runDomain} />}
                </>
              )}
              {mode === "wallet" && (
                <>
                  <SimpleLookupInput placeholder="0x… (ETH) or bc1… / 1… / 3… (BTC)" hint="Balance, transaction count + activity straight from the public ledger. Free, no key."
                    icon={<Network className="w-4 h-4" />} loading={walletStatus === "loading"} onLookup={runWallet}
                    onClear={walletStatus !== "idle" ? () => { setWalletStatus("idle"); setWalletResult(null); setWalletErr(""); router.replace("/", { scroll: false }); } : undefined}
                    validate={(v) => detectMode(v.trim()) === "wallet" ? null : "Enter a BTC or ETH address"} />
                  {walletStatus === "idle" && <ExampleChips items={["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"]} onPick={runWallet} />}
                </>
              )}
              {mode === "hash" && (
                <>
                  <SimpleLookupInput placeholder="MD5 / SHA-1 / SHA-256 hex digest" hint="Known-software (NSRL) reputation from CIRCL hashlookup, plus verdict-engine pivots. Free, no key."
                    icon={<Network className="w-4 h-4" />} loading={hashStatus === "loading"} onLookup={runHash}
                    onClear={hashStatus !== "idle" ? () => { setHashStatus("idle"); setHashResult(null); setHashErr(""); router.replace("/", { scroll: false }); } : undefined}
                    validate={(v) => detectMode(v.trim()) === "hash" ? null : "Enter a 32/40/64-char hex hash"} />
                  {hashStatus === "idle" && <ExampleChips items={["8ed4b4ed952526d89899e723f3488de4", "da39a3ee5e6b4b0d3255bfef95601890afd80709"]} onPick={runHash} />}
                </>
              )}
              {mode === "bulk" && <BulkLookup />}
              {mode === "file" && <PanelErrorBoundary label="File metadata"><ImageExifPanel /></PanelErrorBoundary>}
            </div>
          )}

          {/* History — phone mode only */}
          {!isBooting && mode === "phone" && (
            <div className="mb-4"><HistorySidebar onSelect={runLookup} currentE164={currentE164} /></div>
          )}

          {/* Email header trace — always available in email mode (no lookup needed) */}
          {!isBooting && mode === "email" && (
            <div className="mb-4"><PanelErrorBoundary label="Header trace"><EmailHeaderTracePanel onIpLookup={(ip) => { setMode("ip"); void runIp(ip); }} /></PanelErrorBoundary></div>
          )}

          {/* Crypto workbench — always available in hash mode (no lookup needed):
              hash, encode and encrypt/decrypt any text locally, alongside the
              digest-reputation lookup above. */}
          {!isBooting && mode === "hash" && (
            <div className="mb-4 space-y-4">
              <PanelErrorBoundary label="Crypto workbench"><CryptoWorkbench /></PanelErrorBoundary>
              <PanelErrorBoundary label="Password exposure"><PwnedPasswordCheck /></PanelErrorBoundary>
            </div>
          )}

          {/* Loading states */}
          {((mode === "phone" && phoneStatus === "loading") || (mode === "email" && emailStatus === "loading")
            || (mode === "username" && userStatus === "loading") || (mode === "ip" && ipStatus === "loading")
            || (mode === "domain" && domStatus === "loading") || (mode === "wallet" && walletStatus === "loading")
            || (mode === "hash" && hashStatus === "loading")) && <><ScanProgress mode={mode} /><LoadingSkeletons /></>}

          {/* Errors */}
          {((mode === "phone" && phoneStatus === "error" && phoneErr) || (mode === "email" && emailStatus === "error" && emailErr)
            || (mode === "username" && userStatus === "error" && userErr) || (mode === "ip" && ipStatus === "error" && ipErr)
            || (mode === "domain" && domStatus === "error" && domErr) || (mode === "wallet" && walletStatus === "error" && walletErr)
            || (mode === "hash" && hashStatus === "error" && hashErr)) && (
            <div className="mt-6 terminal-card p-5 border" style={{ borderColor: "#ff4d6d50" }}>
              <div className="text-[13px] uppercase tracking-widest text-[#ff4d6d]/87 mb-2">[ LOOKUP FAILED ]</div>
              <div className="text-[#ff4d6d] font-mono text-sm">
                <span className="opacity-60">[ERROR] </span>
                {mode === "phone" ? phoneErr : mode === "email" ? emailErr : mode === "username" ? userErr : mode === "ip" ? ipErr : mode === "domain" ? domErr : mode === "wallet" ? walletErr : hashErr}
              </div>
              {/* A failure is usually a transient upstream (a free source hits its
                  per-IP quota, or the network blips). Offer a one-click re-run and
                  a dismiss, so the user is never stranded having to re-type. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {lastRun && (
                  <button
                    onClick={retryLast}
                    className="btn-neon flex items-center gap-1.5 px-4 py-2 text-[11px] font-mono font-bold uppercase tracking-widest"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Retry
                  </button>
                )}
                <button
                  onClick={dismissError}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-[var(--hv-glass-border)] text-[11px] font-mono uppercase tracking-widest text-[var(--hv-ink-dim)] hover:text-[var(--hv-ink)] hover:border-[var(--hv-glass-hi)] transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Dismiss
                </button>
                <span className="text-[11px] font-mono text-[var(--hv-ink-dim)]">
                  Free sources rate-limit by IP: waiting a moment and retrying usually clears it.
                </span>
              </div>
            </div>
          )}

          {/* Results — each can pin its primary + derived identifiers to a case in one click */}
          {mode === "phone"    && phoneStatus === "done" && phoneResult && <PanelErrorBoundary label="Phone results"><div className="mt-6 flex justify-end"><AddToCase entities={entitiesFromPhone(phoneResult)} edges={edgesFromPivots({ kind: "phone", value: phoneResult.input.e164 }, pivotsFromPhone(phoneResult))} snapshot={{ kind: "phone", value: phoneResult.input.e164, facts: factsFromPhone(phoneResult), fromCache: phoneResult.cachedAt !== undefined }} /></div><ResultsDashboard data={phoneResult} onUsernameSweep={(h) => { setMode("username"); void runUsername(h); }} onEmailLookup={(e) => { setMode("email"); void runEmail(e); }} /><div className="mt-4"><AutoPivots pivots={pivotsFromPhone(phoneResult)} onRun={onQuickLookup} /></div><div className="mt-4"><AiAnalysisPanel input={{ kind: "phone", data: phoneResult }} /></div></PanelErrorBoundary>}
          {mode === "email"    && emailStatus === "done" && emailResult && <PanelErrorBoundary label="Email results"><div className="mt-6 flex justify-end"><AddToCase entities={entitiesFromEmail(emailResult)} edges={edgesFromPivots({ kind: "email", value: emailResult.email }, pivotsFromEmail(emailResult))} snapshot={{ kind: "email", value: emailResult.email, facts: factsFromEmail(emailResult), fromCache: emailResult.cachedAt !== undefined }} /></div><EmailResultsDashboard data={emailResult} onUsernameSweep={(h) => { setMode("username"); void runUsername(h); }} /><div className="mt-4"><AutoPivots pivots={pivotsFromEmail(emailResult)} onRun={onQuickLookup} /></div><div className="mt-4"><AiAnalysisPanel input={{ kind: "email", data: emailResult }} /></div></PanelErrorBoundary>}
          {mode === "username" && userStatus === "done"  && userResult  && <PanelErrorBoundary label="Username results"><div className="mt-6 flex justify-end"><AddToCase entities={entitiesFromUsername(userResult)} edges={edgesFromPivots({ kind: "username", value: userResult.username }, pivotsFromUsername(userResult))} snapshot={{ kind: "username", value: userResult.username, facts: factsFromUsername(userResult), fromCache: userResult.cachedAt !== undefined }} /></div><UsernameResultsDashboard data={userResult} /><div className="mt-4"><AutoPivots pivots={pivotsFromUsername(userResult)} onRun={onQuickLookup} /></div><div className="mt-4"><AiAnalysisPanel input={{ kind: "username", data: userResult }} /></div></PanelErrorBoundary>}
          {mode === "ip"       && ipStatus === "done"    && ipResult    && <PanelErrorBoundary label="IP results"><div className="mt-6 flex justify-end"><AddToCase entities={entitiesFromIp(ipResult)} edges={edgesFromPivots({ kind: "ip", value: ipResult.input }, pivotsFromIp(ipResult))} snapshot={{ kind: "ip", value: ipResult.input, facts: factsFromIp(ipResult), fromCache: ipResult.cachedAt !== undefined }} /></div><IpResultsDashboard data={ipResult} onDomainLookup={(d) => { setMode("domain"); void runDomain(d); }} /><div className="mt-4"><AutoPivots pivots={pivotsFromIp(ipResult)} onRun={onQuickLookup} /></div><div className="mt-4"><AiAnalysisPanel input={{ kind: "ip", data: ipResult }} /></div></PanelErrorBoundary>}
          {mode === "domain"   && domStatus === "done"   && domResult   && <PanelErrorBoundary label="Domain results"><div className="mt-6 flex justify-end"><AddToCase entities={entitiesFromDomain(domResult)} edges={edgesFromPivots({ kind: "domain", value: domResult.domain }, pivotsFromDomain(domResult))} snapshot={{ kind: "domain", value: domResult.domain, facts: factsFromDomain(domResult), fromCache: domResult.cachedAt !== undefined }} /></div><DomainResultsDashboard data={domResult} onIpLookup={(v) => { setMode("ip"); void runIp(v); }} /><div className="mt-4"><AutoPivots pivots={pivotsFromDomain(domResult)} onRun={onQuickLookup} /></div><div className="mt-4"><AiAnalysisPanel input={{ kind: "domain", data: domResult }} /></div></PanelErrorBoundary>}

          {mode === "wallet"   && walletStatus === "done" && walletResult && <PanelErrorBoundary label="Wallet results"><WalletResultsDashboard data={walletResult} /><div className="mt-4"><AiAnalysisPanel input={{ kind: "wallet", data: walletResult }} /></div></PanelErrorBoundary>}
          {mode === "hash"     && hashStatus === "done"   && hashResult   && <PanelErrorBoundary label="Hash results"><HashResultsDashboard data={hashResult} /><div className="mt-4"><AiAnalysisPanel input={{ kind: "hash", data: hashResult }} /></div></PanelErrorBoundary>}

          {!isBooting && mode === "graph" && (
            <div className="mt-6 space-y-4">
              {/* Paste raw text (a dump, a report), extract identifiers on-device,
                  and drop them straight into the graph below or run one as a lookup. */}
              <PanelErrorBoundary label="AI text intel"><AiTextIntel onAddEntities={addEntities} onQuickLookup={onQuickLookup} /></PanelErrorBoundary>
              <PanelErrorBoundary label="Graph"><LinkGraph entities={sessionEntities} title="SESSION LINK GRAPH" onChange={setSessionEntities} /></PanelErrorBoundary>
            </div>
          )}
          {!isBooting && mode === "cases" && <PanelErrorBoundary label="Cases"><CasesPanel /></PanelErrorBoundary>}
        </main>

        <footer className="border-t border-[var(--hv-glass-border)] px-4 py-4 glass">
          <div className="text-center text-[12px] font-mono text-[var(--hv-ink-dim)] tracking-widest uppercase">
            OSINT METADATA ONLY · NO REAL-TIME LOCATION · USE RESPONSIBLY
          </div>
          <div className="text-center text-[11px] font-mono text-[var(--hv-ink-dim)] opacity-60 mt-1 tracking-wide">
            Phone · Email · Username · IP · Domain · Wallet · Hash · File metadata · Link-analysis · Persistent cases · Offline-first
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
