// ── Access tiers for outbound OSINT pivot links ──────────────────────────────
//
// What an analyst actually needs to know before clicking is not "is this site
// good" but "what happens when I click": do I land on results, hit a bot wall,
// get a login form, or a paywall. That is what a tier encodes.
//
// This lives in one module because the phone and email pivot panels had already
// drifted apart — phone carried tiers and a filter, email carried neither, so
// the same paid service (Dehashed) rendered as a plain link on one screen and a
// PAID-badged link on the other. Both panels now read their tiers from here.
//
// ── The rule for assigning a tier ──
// Tiers are set from OBSERVED behaviour in a REAL BROWSER, never from a
// scripted probe. The distinction matters more than it sounds: a `curl` with a
// browser User-Agent gets 403 from Radaris, which looks like a wall, while an
// actual browser loads the results page. Measuring with a script alone
// mislabels the honest sites as broken and the broken ones as merely guarded.
//
// `captcha` means a challenge appears and then clears ("Just a moment...",
// "Confirm you're human"). `blocked` means the site refuses a real browser
// outright with a Cloudflare 1020-style "Sorry, you have been blocked" — no
// challenge is offered, so there is nothing for the analyst to solve.
// `login` and `paid` describe the service's own access model. `free` promises
// that a click lands on results, so never apply it to a URL nobody has opened.
//
// `blocked` is the only tier that is not a property of the site. It is what one
// address saw on one day, so it carries its vantage with it — read
// BLOCK_VANTAGE below before trusting, copying, or re-measuring it.
//
// `npm run links:check` is a pointer, not a verdict: it reports Radaris and
// freecarrierlookup.com as walled when both load fine in a browser, and it
// reported ZabaSearch as healthy while the browser showed it fabricating an
// owner for a number with no record. Open the link before you re-tier it.

export type AccessTier = "free" | "captcha" | "app" | "login" | "paid" | "blocked";

export interface AccessTierMeta {
  label: string;
  color: string;
  bg: string;
  /** Shown as the filter chip's tooltip — says what a click will actually do. */
  hint: string;
}

/**
 * Where and when the `blocked` tier was measured.
 *
 * The other five tiers survive a change of address. A paywall charges everyone,
 * a login form asks everyone, a CAPTCHA is offered to everyone. A refusal is
 * different: it is the site's opinion of the visitor, and the visitor is half
 * the measurement. Recording the tier without recording who was turned away
 * states a fact about the world that was only ever a fact about this machine.
 *
 * What was measured: the four sites carrying this tier (TruePeopleSearch,
 * FastPeopleSearch, USPhoneBook, PeekYou) are US people-search services, and
 * they refused an ordinary Chrome session, with no challenge offered, from a
 * residential consumer line outside the US.
 *
 * What that rules out: the reflex explanation. "Use a residential IP" was the
 * first thing written here and it was wrong, because the address already was
 * one. Nothing about hosting, VPN, or datacenter ranges is doing this.
 *
 * What stays untested: the visitor's country, which is the obvious remaining
 * variable for four US-only services. This host cannot close it — every free
 * proxy that would move the request to the US is itself in a datacenter, which
 * is the other thing these sites refuse, so a failure through one proves
 * nothing. A US residential connection would settle it in a minute. Until
 * somebody has one, the dated claim below is the whole of what is known.
 */
export const BLOCK_VANTAGE = {
  date: "2026-09-02",
  /** The class of network on purpose, never the operator or the address. */
  network: "a residential line outside the US",
  agent: "an ordinary desktop Chrome session",
} as const;

/** What was seen. */
export const BLOCK_MEASURED =
  `Refused ${BLOCK_VANTAGE.agent} outright, no challenge to solve: measured ${BLOCK_VANTAGE.date} from ${BLOCK_VANTAGE.network}.`;

/** What that does and does not license the analyst to conclude. */
export const BLOCK_LIMIT =
  "One address on one day, not a property of the site: try it from yours.";

/**
 * The two halves together, written once so the filter chip, the row and the
 * docs cannot drift into disagreeing about what the badge claims. The row shows
 * the limit (the half an analyst can act on) and hovers the whole thing.
 */
export const BLOCK_CAVEAT = `${BLOCK_MEASURED} ${BLOCK_LIMIT}`;

export const ACCESS_META: Record<AccessTier, AccessTierMeta> = {
  free: {
    label: "FREE", color: "#00ff41", bg: "rgba(0,255,65,0.10)",
    hint: "Opens straight onto results: no account, no challenge",
  },
  captcha: {
    label: "CAPTCHA", color: "#00d9ff", bg: "rgba(0,217,255,0.10)",
    hint: "Answers with a bot-check interstitial first; a real browser clears it",
  },
  app: {
    label: "APP", color: "#bf5fff", bg: "rgba(191,95,255,0.10)",
    hint: "A URI for a local app, not a web page: the row copies it instead of navigating",
  },
  login: {
    label: "LOGIN", color: "#ffaa00", bg: "rgba(255,170,0,0.10)",
    hint: "Needs a (usually free) account before it will run the query",
  },
  paid: {
    label: "PAID", color: "#ff6600", bg: "rgba(255,102,0,0.10)",
    hint: "Commercial service: expect a paywall on the actual results",
  },
  blocked: {
    label: "BLOCKED", color: "#ff3355", bg: "rgba(255,51,85,0.10)",
    hint: BLOCK_CAVEAT,
  },
};

/** Display order: cheapest access first, so the useful rows sort to the top. */
export const TIER_ORDER: Record<AccessTier, number> = {
  free: 0, captcha: 1, app: 2, login: 3, paid: 4, blocked: 5,
};

/**
 * The tiers shown before the analyst touches a filter.
 *
 * `blocked` is hidden rather than deleted, and the difference is the point.
 * Deleting the rows would tell the next analyst nothing and invite them to go
 * find the same four sites again. Hiding them records that the source was
 * checked and refused, while leaving it one chip away for the analyst whose
 * address is not this one — which, per BLOCK_VANTAGE, is the case the tool has
 * no evidence about.
 */
export const DEFAULT_TIERS: AccessTier[] = ["free", "captcha", "app"];

/** Every tier, in display order — the filter chips iterate this. */
export const ALL_TIERS: AccessTier[] = (Object.keys(ACCESS_META) as AccessTier[])
  .sort((a, b) => TIER_ORDER[a] - TIER_ORDER[b]);

/**
 * `true` when a link is an application URI rather than a web page.
 *
 * `tg:`, `viber:` and `sms:` handed to an `<a href>` are the tool's
 * most-reported bug: a desktop browser with no registered handler answers the
 * click with "can't open this page". Callers render these as copy-to-clipboard
 * rows instead of navigations.
 */
export function isAppScheme(url: string): boolean {
  return /^(tg|viber|sms|tel|whatsapp|skype|callto):/i.test(url);
}
