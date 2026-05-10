import {
  DISPOSABLE_DOMAINS,
  FREE_WEBMAIL_DOMAINS,
  PRIVACY_DOMAINS,
  ROLE_PREFIXES,
} from "./disposableEmailDomains";
import type { EmailAnalysis, EmailProviderType } from "./types";

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

function toTitleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Try to infer a real name from an email username.
 * Returns null when the pattern doesn't clearly indicate a name.
 */
function guessNameFromUsername(username: string): string | null {
  // Strip common suffixes like numbers at end
  const cleaned = username.replace(/\d+$/, "").replace(/[._\-]+$/, "");
  if (cleaned.length < 2) return null;

  // firstname.lastname or firstname_lastname or firstname-lastname
  const dotSplit = cleaned.split(/[._\-]/);
  if (dotSplit.length === 2 && dotSplit[0].length >= 2 && dotSplit[1].length >= 2) {
    const [first, last] = dotSplit;
    // Both parts should look like name segments (mostly letters)
    if (/^[a-zA-Z]+$/.test(first) && /^[a-zA-Z]+$/.test(last)) {
      return `${toTitleCase(first)} ${toTitleCase(last)}`;
    }
  }

  // firstnamelastname heuristic: if it's one word and 5-20 chars, might be a name
  if (/^[a-zA-Z]{5,20}$/.test(cleaned)) {
    // Can't reliably split — return the cleaned username with capitalization
    return toTitleCase(cleaned);
  }

  return null;
}

function getProviderName(domain: string): string {
  const known: Record<string, string> = {
    "gmail.com": "Gmail",
    "googlemail.com": "Gmail",
    "outlook.com": "Outlook",
    "hotmail.com": "Hotmail",
    "live.com": "Live",
    "msn.com": "MSN",
    "yahoo.com": "Yahoo Mail",
    "ymail.com": "Yahoo Mail",
    "icloud.com": "iCloud Mail",
    "me.com": "iCloud Mail",
    "mac.com": "iCloud Mail",
    "protonmail.com": "ProtonMail",
    "protonmail.ch": "ProtonMail",
    "proton.me": "ProtonMail",
    "pm.me": "ProtonMail",
    "tutanota.com": "Tutanota",
    "tuta.io": "Tutanota",
    "aol.com": "AOL Mail",
    "mail.com": "Mail.com",
    "gmx.com": "GMX Mail",
    "gmx.de": "GMX Mail",
    "web.de": "Web.de",
    "yandex.com": "Yandex Mail",
    "yandex.ru": "Yandex Mail",
    "mail.ru": "Mail.ru",
    "qq.com": "QQ Mail",
    "163.com": "NetEase 163",
    "126.com": "NetEase 126",
    "zoho.com": "Zoho Mail",
    "fastmail.com": "Fastmail",
    "mailfence.com": "Mailfence",
    "startmail.com": "StartMail",
    "runbox.com": "Runbox",
    "posteo.de": "Posteo",
    "disroot.org": "Disroot",
    "riseup.net": "Riseup",
    "mailinator.com": "Mailinator",
    "guerrillamail.com": "Guerrilla Mail",
    "yopmail.com": "YOPmail",
    "tempmail.com": "TempMail",
    "10minutemail.com": "10 Minute Mail",
    "maildrop.cc": "Maildrop",
  };
  return known[domain] ?? null;
}

export function analyzeEmail(raw: string): EmailAnalysis {
  const email = raw.trim().toLowerCase();
  const atIdx = email.lastIndexOf("@");
  const username = atIdx > 0 ? email.slice(0, atIdx) : email;
  const domain = atIdx > 0 ? email.slice(atIdx + 1) : "";
  const tldDot = domain.lastIndexOf(".");
  const tld = tldDot >= 0 ? domain.slice(tldDot + 1) : "";

  const isValidFormat = EMAIL_RE.test(email);

  const isDisposable = DISPOSABLE_DOMAINS.has(domain);
  const isPrivacyFocused = PRIVACY_DOMAINS.has(domain);
  const isWebmail = FREE_WEBMAIL_DOMAINS.has(domain);

  const rolePrefix = username.split(/[+.]/)[0]; // support+tag@… → support
  const isRoleAddress = ROLE_PREFIXES.has(rolePrefix);

  // TLD-based gov/edu/mil detection
  const isGov = tld === "gov" || tld === "mil" || domain.endsWith(".gov.uk") || domain.endsWith(".gov.au");
  const isEdu = tld === "edu" || domain.endsWith(".ac.uk") || domain.endsWith(".edu.au") || domain.endsWith(".ac.in");

  let providerType: EmailProviderType;
  if (!isValidFormat) {
    providerType = "unknown";
  } else if (isDisposable) {
    providerType = "disposable";
  } else if (isPrivacyFocused) {
    providerType = "privacy";
  } else if (isGov) {
    providerType = "government";
  } else if (isEdu) {
    providerType = "educational";
  } else if (isWebmail) {
    providerType = "free";
  } else {
    providerType = "corporate";
  }

  const knownName = getProviderName(domain);
  let providerName: string;
  if (knownName) {
    providerName = knownName;
  } else if (isGov) {
    providerName = "Government";
  } else if (isEdu) {
    providerName = "Educational Institution";
  } else if (providerType === "corporate") {
    // Derive from domain: strip TLD, capitalize
    const base = domain.replace(`.${tld}`, "");
    providerName = `${toTitleCase(base)} (Corporate)`;
  } else {
    providerName = domain;
  }

  return {
    email,
    username,
    domain,
    tld,
    isValidFormat,
    providerType,
    providerName,
    isDisposable,
    isWebmail,
    isPrivacyFocused,
    isRoleAddress,
    guessedName: isRoleAddress ? null : guessNameFromUsername(username),
  };
}
