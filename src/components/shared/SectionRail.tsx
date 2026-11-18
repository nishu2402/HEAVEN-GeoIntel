"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * One entry in the section rail. `group` is only compared for equality: a thin
 * divider is drawn wherever the group changes, so the long panel stack reads as
 * a few clusters instead of one undifferentiated ribbon. The string value is
 * never shown, so it can be any short tag.
 */
export interface JumpItem { id: string; label: string; group?: string }

/**
 * A slim navigation rail that docks to the top of the viewport for the whole
 * result scroll. The old jump nav lived inside the "at a glance" card, so it
 * scrolled off the moment you entered the panel stack: on the phone dashboard
 * that stack is a dozen near-identical glass cards with no way back to the top
 * and no sense of place. This rail sticks, marks the section you last jumped to
 * (aria-current), and separates the logical groups, giving the scroll a spine.
 * One component serves the phone, email, domain and IP dashboards.
 */
export default function SectionRail({ items }: { items: JumpItem[] }) {
  const [active, setActive] = useState<string | null>(null);
  // A rail click pins its section so the scroll-spy does not ripple through the
  // sections the smooth scroll passes. Each scroll tick re-arms the release, so
  // the pin lifts only once scrolling stops (a click needing no scroll arms it
  // once, so the pin never sticks). At rest the highlight is already the clicked
  // section, so the release just drops the pin and lets the next scroll resume.
  const pinnedRef = useRef<string | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const armSettle = useCallback(() => {
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => { pinnedRef.current = null; }, 150);
  }, []);

  // Scroll-spy: as you free-scroll the result stack, light up whichever section
  // currently sits in the band just below the docked rail, so the rail follows
  // where you are and not only where you last clicked. The band starts below the
  // header + rail and stops short of the fold, so the topmost section near the
  // top of the viewport wins. jsdom ships no IntersectionObserver; component
  // tests install one through installResizeObserver and drive it with
  // fireIntersection.
  //
  // Callers build `items` inline, so a new array lands on every render. Keying
  // the effect on the id list (a stable string) instead of the array reference
  // keeps it from tearing down and rebuilding the observer each render; it
  // rebuilds only when the sections themselves change.
  const idsKey = items.map((j) => j.id).join("\n");

  useEffect(() => {
    const ids = idsKey ? idsKey.split("\n") : [];
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const BAND_TOP = 140;
    const inBand = new Set<string>();
    const sync = () => {
      if (pinnedRef.current) return;
      const current = ids.find((id) => inBand.has(id));
      if (current) {
        setActive(current);
        return;
      }
      // Band empty: we are above the first section, below the last, or in a gap
      // between two tracked sections (some dashboards drop untracked content, like
      // the unlock-intel promo, between sections). Light the first when we are
      // above it and the last when below it; in a mid-stack gap both tests fail,
      // so the last highlight is kept and the rail does not flicker off. An
      // instant jump to the very top or bottom lands here too (nothing crosses
      // the band), and the same two ends catch it.
      const first = sections[0];
      const last = sections[sections.length - 1];
      if (first.getBoundingClientRect().top > BAND_TOP) setActive(first.id);
      else if (last.getBoundingClientRect().bottom < BAND_TOP) setActive(last.id);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) inBand.add(entry.target.id);
          else inBand.delete(entry.target.id);
        }
        sync();
      },
      { rootMargin: `-${BAND_TOP}px 0px -70% 0px` },
    );
    for (const el of sections) observer.observe(el);

    // The observer only reacts when a section crosses the band. An instant jump
    // to the very top or bottom (Home/End, a back-to-top control) moves nothing
    // through it, so a passive scroll listener re-runs the check. While a click
    // is pinned, each tick pushes the settle out instead. setActive ignores a
    // repeat value, so staying put does not re-render.
    const onScroll = () => {
      if (pinnedRef.current) {
        armSettle();
        return;
      }
      sync();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      clearTimeout(settleRef.current);
    };
  }, [idsKey, armSettle]);

  if (items.length === 0) return null;

  const go = (id: string) => {
    const el = document.getElementById(id);
    setActive(id);
    if (!el) return;
    pinnedRef.current = id;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    armSettle();
  };

  return (
    <nav
      aria-label="Jump to section"
      style={{ top: "var(--hv-rail-top)" }}
      className="sticky z-30 flex items-center gap-1 overflow-x-auto rounded-[0.5rem] border border-[var(--hv-glass-border)] bg-[var(--hv-glass-bg)] px-2 py-1.5 backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <span className="shrink-0 px-1 text-[10px] font-mono uppercase tracking-widest text-[var(--hv-ink-dim)]">
        Sections
      </span>
      {items.map((j, i) => {
        const divider = i > 0 && j.group !== items[i - 1].group;
        return (
          <span key={j.id} className="flex shrink-0 items-center">
            {divider && <span aria-hidden="true" className="mx-1 h-4 w-px bg-[var(--hv-glass-border)]" />}
            <button
              type="button"
              onClick={() => go(j.id)}
              aria-current={active === j.id ? "true" : undefined}
              className={cn(
                // The active section adopts the mode accent (--hv-accent, set on
                // <main>), so the rail matches the active tab and input focus.
                "whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-mono transition-colors",
                active === j.id
                  ? "border-[var(--hv-accent)] bg-[var(--hv-glass-border)] text-[var(--hv-accent)]"
                  : "border-transparent text-[var(--hv-ink-dim)] hover:border-[var(--hv-glass-border)] hover:text-[var(--hv-ink)]",
              )}
            >
              {j.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
