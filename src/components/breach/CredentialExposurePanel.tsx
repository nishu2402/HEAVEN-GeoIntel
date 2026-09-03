"use client";

import { KeyRound, Repeat, ShieldAlert } from "lucide-react";
import type { CredentialExposure } from "@/lib/analysis/credentialExposure";

interface Props {
  exposure: CredentialExposure;
  subject: "email address" | "phone number" | "username";
}

/**
 * Password-exposure summary: how many breaches exposed a password for this
 * identifier, plus ProxyNova COMB's masked credential pairs, fused into a reuse
 * verdict. Renders nothing when there is no leaked-credential evidence — the
 * breach panel already carries the clean case, so a second "nothing found" box
 * would only add noise (and risk reading as reassurance when a source failed).
 */
export default function CredentialExposurePanel({ exposure: e, subject }: Props) {
  if (!e.exposed) return null;

  const isReuse = e.reuse === "likely";

  return (
    <div className="terminal-card p-4 space-y-3 border" style={{ borderColor: "#ff6a0055" }}>
      <div className="text-[12px] uppercase tracking-widest text-[#00ff41]/65 flex items-center gap-1.5">
        <KeyRound className="w-3 h-3 text-[#ff6600]" /> PASSWORD EXPOSURE
      </div>

      <div
        className="flex items-center gap-2 text-[13px] font-mono font-bold"
        style={{ color: isReuse ? "#ff3e3e" : "#ff6600" }}
      >
        {isReuse ? <Repeat className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
        {isReuse ? "PASSWORD REUSE LIKELY" : "PASSWORD EXPOSED"}
      </div>

      <div className="text-[13px] font-mono text-[#ff6600]/90 space-y-1">
        {e.passwordBreaches > 0 && (
          <div>
            {e.passwordBreaches} breach{e.passwordBreaches === 1 ? "" : "es"} exposed a password for this {subject}.
          </div>
        )}
        {e.pairs > 0 && (
          <div>
            {e.capped ? "At least " : ""}{e.distinctPasswords} distinct password
            {e.distinctPasswords === 1 ? "" : "s"} for this {subject}{" "}
            {e.distinctPasswords === 1 ? "appears" : "appear"} in leaked credential dumps
            {" "}({e.pairs} pair{e.pairs === 1 ? "" : "s"} seen).
          </div>
        )}
        {e.stealerLogs > 0 && (
          <div>
            {e.stealerLogs} infostealer log{e.stealerLogs === 1 ? "" : "s"} captured{" "}
            {e.stealerPasswords} distinct password{e.stealerPasswords === 1 ? "" : "s"} for this {subject}.
          </div>
        )}
      </div>

      {e.samples.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-widest text-[#00ff41]/54">Masked previews</div>
          <div className="flex flex-wrap gap-1.5">
            {e.samples.map((s, i) => (
              <span
                key={`${s}-${i}`}
                className="text-[12px] font-mono text-[#ff6600]/90 px-1.5 py-0.5 border border-[#ff6600]/30 bg-[#ff6600]/[0.06]"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {isReuse && (
        <div className="text-[12px] font-mono text-[#ff3e3e]/85 border-t border-[#ff3e3e]/15 pt-2">
          A small set of passwords spans more breaches than distinct passwords seen. Treat every
          account that shared one as compromised and rotate them.
        </div>
      )}

      <div className="text-[11px] font-mono text-[#00ff41]/45 border-t border-[#00ff41]/10 pt-2">
        Passwords are masked at the source and never shown or stored in full. Counts are a floor:
        the free index caps its results.
      </div>
    </div>
  );
}
