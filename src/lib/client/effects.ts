// ── Visual-effects setting (client, localStorage) ───────────────────────────
// Controls the heavy decorative animations (Canvas "matrix rain", etc.). Default
// is ON, but OFF automatically when the OS requests reduced motion — unless the
// user has explicitly overridden it with the header toggle. Honouring this makes
// the tool comfortable on low-end phones and for motion-sensitive users.

export const FX_KEY = "hv-fx";
export const FX_EVENT = "hv-fx-changed";

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** True when decorative animations should run. */
export function effectsEnabled(): boolean {
  try {
    const v = localStorage.getItem(FX_KEY);
    if (v === "0") return false; // user turned them off
    if (v === "1") return true; // user turned them on (overrides OS pref)
    return !prefersReducedMotion(); // unset → on, unless the OS prefers reduced motion
  } catch {
    return true;
  }
}

/**
 * Reflect the effects state onto <html data-fx="on|off"> so the CSS ambiance
 * (scanline drift, holo border, wordmark sweep, card-hover glow) switches with
 * the same setting that gates the Canvas matrix rain. The inline boot script in
 * layout.tsx sets this before first paint; this keeps it in step on every toggle.
 */
function applyFxAttribute(on: boolean): void {
  try {
    document.documentElement.setAttribute("data-fx", on ? "on" : "off");
  } catch {
    /* no document (SSR or unit test): the inline boot script owns first paint */
  }
}

/** Persist the user's choice, sync the data-fx attribute, and notify listeners. */
export function setEffects(on: boolean): void {
  try {
    localStorage.setItem(FX_KEY, on ? "1" : "0");
    window.dispatchEvent(new CustomEvent(FX_EVENT));
  } catch {
    /* private mode or quota: best effort */
  }
  applyFxAttribute(on);
}
