"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LookupResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  sources: LookupResponse["sources"];
}

type SourceKey = keyof LookupResponse["sources"];

const SOURCE_LABELS: Record<SourceKey, string> = {
  numverify: "NumVerify",
  ipqs: "IPQS",
  abstract: "Abstract",
  twilio: "Twilio",
  breachDirectory: "Breach",
  fullContact: "FullContact",
  hudsonRock: "HudsonRock",
  leakCheck: "LeakCheck",
};

const SOURCE_ENV_HINT: Record<SourceKey, string> = {
  numverify: "NUMVERIFY_API_KEY",
  ipqs: "IPQS_API_KEY",
  abstract: "ABSTRACT_API_KEY",
  twilio: "TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN",
  breachDirectory: "RAPIDAPI_KEY",
  fullContact: "FULLCONTACT_API_KEY",
  hudsonRock: "(no key: free)",
  leakCheck: "(no key: free)",
};

function StatusDot({ ok, error }: { ok: boolean; error?: string }) {
  if (error === "NOT_CONFIGURED") return <span className="w-2 h-2 rounded-full bg-[#444] inline-block" />;
  return (
    <span
      className={cn(
        "w-2 h-2 rounded-full inline-block",
        ok ? "bg-[#00ff41]" : "bg-[#ff3e3e]"
      )}
    />
  );
}

export default function SourceTabs({ sources }: Props) {
  const keys = Object.keys(sources) as SourceKey[];

  return (
    <Tabs defaultValue={keys[0]} className="w-full">
      <TabsList className="w-full grid grid-cols-3 sm:grid-cols-7 bg-[#0a0a0a] border border-[#00ff41]/20 rounded-none h-auto p-0">
        {keys.map((key) => {
          const src = sources[key];
          return (
            <TabsTrigger
              key={key}
              value={key}
              className="rounded-none text-xs font-mono data-[state=active]:bg-[#00ff41]/10 data-[state=active]:text-[#00ff41] data-[state=active]:shadow-none text-[#00ff41]/54 py-2.5 flex items-center gap-2 border-r border-[#00ff41]/10 last:border-r-0"
            >
              <StatusDot ok={src.ok} error={src.error} />
              {SOURCE_LABELS[key]}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {keys.map((key) => {
        const src = sources[key];
        return (
          <TabsContent key={key} value={key} className="mt-0">
            <div className="border border-t-0 border-[#00ff41]/20 bg-[#050505] p-4">
              {src.error === "NOT_CONFIGURED" ? (
                <div className="text-center py-6">
                  {/* Was #555 / #333 on #050505 — 2.7:1 and 1.6:1. The env-var
                      name is the one thing an analyst needs to read here. */}
                  <div className="text-[var(--hv-muted-ink)] text-xs uppercase tracking-widest mb-1">NOT CONFIGURED</div>
                  <div className="text-[var(--hv-muted-ink)] text-xs font-mono">Set {SOURCE_ENV_HINT[key]} in .env.local</div>
                </div>
              ) : !src.ok ? (
                <div className="text-[#ff3e3e] text-xs font-mono">
                  <span className="text-[#ff3e3e]/92">[ERROR] </span>
                  {src.error ?? "Unknown error"}
                </div>
              ) : (
                <pre className="text-xs text-[#00ff41]/90 font-mono overflow-x-auto whitespace-pre-wrap break-words leading-relaxed">
                  {JSON.stringify(src.data, null, 2)}
                </pre>
              )}
            </div>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
