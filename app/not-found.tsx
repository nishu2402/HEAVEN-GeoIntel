import Link from "next/link";
import { Terminal } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center font-mono p-8">
      <div className="terminal-card p-8 max-w-md w-full space-y-6">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-[#00ff41]" />
          <span className="text-sm font-bold tracking-widest">
            <span className="text-[#00ff41]">HEAVEN</span>
            <span className="text-[#00ff41]/50">-</span>
            <span className="text-[#00d9ff]">GeoIntel</span>
          </span>
        </div>

        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-[#ff3e3e]/60">
            [ 404 — TARGET NOT FOUND ]
          </div>
          <div className="text-4xl font-bold text-[#ff3e3e]/80">404</div>
          <div className="text-sm text-[#00ff41]/60">
            The requested path does not exist in this system.
          </div>
        </div>

        <div className="text-xs text-[#00ff41]/40 font-mono space-y-1">
          <div>[ERROR] Route resolution failed</div>
          <div>[INFO]  Available targets: /</div>
        </div>

        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-[#00ff41] hover:text-[#00d9ff] transition-colors border border-[#00ff41]/30 hover:border-[#00d9ff]/50 px-4 py-2"
        >
          ← RETURN TO BASE
        </Link>
      </div>
    </div>
  );
}
