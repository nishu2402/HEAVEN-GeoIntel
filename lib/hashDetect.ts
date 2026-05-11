/**
 * Hash type detection and cracking intelligence.
 * Identifies hash algorithms from format and length, rates crack difficulty,
 * and provides the best online tool for the job.
 */

export interface HashInfo {
  algorithm: string;       // "MD5" | "SHA-1" | "bcrypt" | ...
  bits: number | null;     // key length in bits (null = unknown)
  crackable: "trivial" | "easy" | "hard" | "infeasible";
  color: string;           // UI accent
  note: string;            // human-readable one-liner
  bestTool: { label: string; url: string };
}

const CRACKSTATION: HashInfo["bestTool"] = {
  label: "CrackStation",
  url: "https://crackstation.net/",
};
const HASHES_COM: HashInfo["bestTool"] = {
  label: "Hashes.com",
  url: "https://hashes.com/en/decrypt/hash",
};
const HASHKILLER: HashInfo["bestTool"] = {
  label: "Hashkiller",
  url: "https://hashkiller.io/listmanager",
};

/**
 * Given a hash string, return everything known about its type.
 * Also accepts partial passwords (contains *) and plaintext.
 */
export function detectHash(hash: string): HashInfo {
  if (!hash) return unknown();

  const h = hash.trim();

  // Partial password (e.g. "p****d") — not a hash at all
  if (h.includes("*")) {
    return {
      algorithm: "Partial Plaintext",
      bits: null,
      crackable: "trivial",
      color: "#ff1a1a",
      note: "Partial password shown — original may be fully known in breach DB",
      bestTool: CRACKSTATION,
    };
  }

  // bcrypt  $2a$, $2b$, $2y$
  if (/^\$2[aby]\$\d{2}\$/.test(h)) {
    return {
      algorithm: "bcrypt",
      bits: null,
      crackable: "infeasible",
      color: "#00ff41",
      note: "bcrypt — adaptive cost function, GPU-resistant. Brute-force impractical.",
      bestTool: HASHES_COM,
    };
  }

  // MD5crypt  $1$
  if (h.startsWith("$1$")) {
    return {
      algorithm: "MD5crypt",
      bits: 128,
      crackable: "easy",
      color: "#ff6600",
      note: "MD5crypt — crackable with dictionary + Hashcat rules in hours.",
      bestTool: CRACKSTATION,
    };
  }

  // SHA-256crypt  $5$
  if (h.startsWith("$5$")) {
    return {
      algorithm: "SHA-256crypt",
      bits: 256,
      crackable: "hard",
      color: "#ffaa00",
      note: "SHA-256crypt — iterated hash, GPU cracking is slow but possible.",
      bestTool: HASHES_COM,
    };
  }

  // SHA-512crypt  $6$
  if (h.startsWith("$6$")) {
    return {
      algorithm: "SHA-512crypt",
      bits: 512,
      crackable: "hard",
      color: "#ffaa00",
      note: "SHA-512crypt — strong. Very slow to crack, but weak passwords fall.",
      bestTool: HASHES_COM,
    };
  }

  // scrypt  $s1$
  if (h.startsWith("$s1$")) {
    return {
      algorithm: "scrypt",
      bits: null,
      crackable: "infeasible",
      color: "#00ff41",
      note: "scrypt — memory-hard, GPU/ASIC resistant.",
      bestTool: HASHES_COM,
    };
  }

  // Argon2  $argon2
  if (h.startsWith("$argon2")) {
    return {
      algorithm: "Argon2",
      bits: null,
      crackable: "infeasible",
      color: "#00ff41",
      note: "Argon2 — winner of PHC, state-of-the-art. GPU cracking not feasible.",
      bestTool: HASHES_COM,
    };
  }

  // PBKDF2  starts with pbkdf2 or sha1:
  if (/^(pbkdf2|sha1:iter|sha256:iter)/i.test(h)) {
    return {
      algorithm: "PBKDF2",
      bits: null,
      crackable: "hard",
      color: "#ffaa00",
      note: "PBKDF2 — iterated HMAC. Crackable with weak passwords + long time.",
      bestTool: HASHES_COM,
    };
  }

  // NTLM — 32 hex chars, but we can check for known NTLM signatures
  // (We can't distinguish MD5 from NTLM by length alone — flag both)

  // Pure hex string — classify by length
  if (/^[0-9a-f]+$/i.test(h)) {
    switch (h.length) {
      case 32:
        return {
          algorithm: "MD5 / NTLM",
          bits: 128,
          crackable: "trivial",
          color: "#ff1a1a",
          note: "MD5 or NTLM — 32-char hex. Rainbow tables crack most in seconds.",
          bestTool: CRACKSTATION,
        };
      case 40:
        return {
          algorithm: "SHA-1",
          bits: 160,
          crackable: "easy",
          color: "#ff3e3e",
          note: "SHA-1 — crackable with CrackStation for common passwords instantly.",
          bestTool: CRACKSTATION,
        };
      case 56:
        return {
          algorithm: "SHA-224",
          bits: 224,
          crackable: "easy",
          color: "#ff6600",
          note: "SHA-224 — unsalted, crackable with Hashcat dictionary attack.",
          bestTool: HASHKILLER,
        };
      case 64:
        return {
          algorithm: "SHA-256",
          bits: 256,
          crackable: "hard",
          color: "#ffaa00",
          note: "SHA-256 — unsalted. Strong passwords survive. Weak ones fall to GPU.",
          bestTool: HASHES_COM,
        };
      case 96:
        return {
          algorithm: "SHA-384",
          bits: 384,
          crackable: "hard",
          color: "#ffaa00",
          note: "SHA-384 — rarely cracked, but unsalted weak passwords are vulnerable.",
          bestTool: HASHES_COM,
        };
      case 128:
        return {
          algorithm: "SHA-512",
          bits: 512,
          crackable: "hard",
          color: "#ffaa00",
          note: "SHA-512 — unsalted. GPU cracking possible for dictionary words.",
          bestTool: HASHES_COM,
        };
    }
  }

  // Base64-encoded hash (MySQL 4.1, WordPress, etc.)
  if (/^\*[0-9A-F]{40}$/.test(h)) {
    return {
      algorithm: "MySQL 4.1+",
      bits: 160,
      crackable: "easy",
      color: "#ff6600",
      note: "MySQL SHA-1 double hash — crackable with specialized wordlists.",
      bestTool: HASHKILLER,
    };
  }

  // Looks like a DES crypt  (2-char salt + 11-char result)
  if (/^[./0-9A-Za-z]{13}$/.test(h)) {
    return {
      algorithm: "DES crypt",
      bits: 56,
      crackable: "trivial",
      color: "#ff1a1a",
      note: "DES crypt — 56-bit key. Completely broken. Crack in minutes.",
      bestTool: CRACKSTATION,
    };
  }

  return unknown();
}

function unknown(): HashInfo {
  return {
    algorithm: "Unknown",
    bits: null,
    crackable: "easy",
    color: "#555",
    note: "Format not recognized — paste into a hash identifier for analysis.",
    bestTool: HASHES_COM,
  };
}

export const CRACK_DIFFICULTY_LABEL: Record<HashInfo["crackable"], string> = {
  trivial:    "TRIVIAL — seconds",
  easy:       "EASY — minutes to hours",
  hard:       "HARD — GPU farm required",
  infeasible: "INFEASIBLE — not crackable",
};

export const CRACK_DIFFICULTY_COLOR: Record<HashInfo["crackable"], string> = {
  trivial:    "#ff1a1a",
  easy:       "#ff6600",
  hard:       "#ffaa00",
  infeasible: "#00ff41",
};
