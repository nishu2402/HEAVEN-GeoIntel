// ── Key-name presentation ────────────────────────────────────────────────────
//
// The key store's allow-list is written in environment-variable spelling, which
// is what the server needs and not what a person should have to read in a
// settings pane. These turn a name like TWILIO_AUTH_TOKEN into something a
// human recognises, and say which half of the app a key belongs to.
//
// Both panels that write keys share this, so a name cannot read one way in the
// sources dialog and another way in settings.

import { PROVIDER_KEY_NAME, PROVIDER_LABEL, API_KEY_URL, FREE_TIER, type CloudProvider } from "../ai/analyst";
import { SOURCES, type SourceDef } from "../sources/manifest";

/**
 * Pretty label for an env-var name, e.g. TWILIO_ACCOUNT_SID → "Account Sid".
 * The acronym fix-up has to come last: title-casing runs over the whole string,
 * so any earlier "RapidAPI" would be flattened back to "Rapidapi".
 */
export function keyLabel(name: string): string {
  return name
    .replace(/_API_KEY$/, "")
    .replace(/^TWILIO_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bRapidapi\b/g, "RapidAPI");
}

/** A manifest entry gated on credentials, which is the only kind a key maps to. */
type KeyedSource = SourceDef & { keys: readonly string[] };

/**
 * The manifest entry that claims a key name, or null when nothing does.
 *
 * The manifest already carries each provider's real name and signup page, so a
 * settings row reads "Have I Been Pwned" rather than the env var title-cased
 * into "Hibp".
 */
export function sourceForKey(name: string): KeyedSource | null {
  const claims = (s: SourceDef): s is KeyedSource => s.keys?.includes(name as never) === true;
  return SOURCES.find(claims) ?? null;
}

/**
 * How an OSINT key is introduced where there is no surrounding source card to
 * give it context. A provider that needs more than one credential (Twilio wants
 * an account SID and an auth token) names which one this is; a provider with a
 * single key just uses its own name.
 *
 * Falls back to the env-var spelling for a key the manifest does not describe,
 * which is what a newly allow-listed source looks like before its entry lands.
 */
export function sourceKeyLabel(name: string): string {
  const source = sourceForKey(name);
  if (source === null) return keyLabel(name);
  return source.keys.length > 1 ? `${source.name}: ${keyLabel(name)}` : source.name;
}

/** Which cloud provider a key name belongs to, or null when it is an OSINT source's. */
export function providerForKey(name: string): CloudProvider | null {
  const found = (Object.keys(PROVIDER_KEY_NAME) as CloudProvider[]).find(
    (p) => PROVIDER_KEY_NAME[p] === name,
  );
  return found ?? null;
}

/**
 * The one name a key is shown under when nothing around it supplies context:
 * the AI provider's label, the OSINT source's, or the env-var spelling for a
 * key neither describes. Settings renders rows and writes its confirmations
 * through this, so a key cannot be "Have I Been Pwned" in the list and "Hibp"
 * in the sentence that says it was saved.
 */
export function displayKeyLabel(name: string): string {
  const provider = providerForKey(name);
  return provider === null ? sourceKeyLabel(name) : PROVIDER_LABEL[provider];
}

/** How one AI provider's key is introduced in settings: name, console, free tier. */
export interface ProviderKeyInfo {
  provider: CloudProvider;
  /** The allow-listed store name, taken from the same map the relay reads. */
  name: string;
  label: string;
  console: string;
  free: boolean;
}

/** The AI providers whose keys settings offers, in the picker's own order. */
export const PROVIDER_KEYS: ProviderKeyInfo[] = (Object.keys(PROVIDER_KEY_NAME) as CloudProvider[]).map((p) => ({
  provider: p,
  name: PROVIDER_KEY_NAME[p],
  label: PROVIDER_LABEL[p],
  console: API_KEY_URL[p],
  free: FREE_TIER.includes(p),
}));
