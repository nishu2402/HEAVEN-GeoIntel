import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Copy text to clipboard. navigator.clipboard is undefined on insecure
 * (plain-HTTP / LAN) origins — fall back to a hidden textarea + execCommand
 * so copy works when the tool is served over HTTP. Returns true on success.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Return `url` only if it is an absolute http(s) URL, otherwise `undefined`.
 *
 * Some links we render come from THIRD-PARTY OSINT sources (a Gravatar profile a
 * target controls, a FullContact "social profile" URL, …). React does NOT block
 * `javascript:` / `data:` URLs in an href, and our production CSP keeps
 * `script-src 'unsafe-inline'` (for the anti-flash theme script), so a
 * `javascript:` href would execute on our origin when the analyst clicks it —
 * a click-to-XSS that could then hit same-origin /api/keys and /api/cases.
 * Passing every remote-supplied href/src through this closes that hole; feed the
 * result straight to `href={safeExternalUrl(x)}` (an undefined href is inert).
 */
export function safeExternalUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    // new URL() strips embedded control chars/tabs before reading the protocol,
    // so `java\tscript:…` and leading-whitespace tricks are caught here too.
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined; // relative, protocol-relative, or unparseable → not a safe external link
  }
}
