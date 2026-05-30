"use client";

export default function LoadingSkeletons() {
  return (
    <div className="space-y-4 mt-6" aria-label="Loading results">
      {/* Header skeleton */}
      <div className="terminal-card p-5 space-y-3">
        <div className="skeleton-matrix h-3 w-24 rounded-none" />
        <div className="flex gap-4 items-center">
          <div className="skeleton-matrix w-12 h-12 rounded-none" />
          <div className="space-y-2 flex-1">
            <div className="skeleton-matrix h-7 w-48 rounded-none" />
            <div className="skeleton-matrix h-4 w-32 rounded-none" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="skeleton-matrix h-8 w-28 rounded-none" />
          <div className="skeleton-matrix h-8 w-32 rounded-none" />
        </div>
      </div>

      {/* Metric cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="terminal-card p-4 space-y-2">
            <div className="skeleton-matrix h-2.5 w-16 rounded-none" />
            <div className="skeleton-matrix h-5 w-24 rounded-none" />
          </div>
        ))}
      </div>

      {/* Fraud score skeleton */}
      <div className="terminal-card p-4 space-y-2">
        <div className="flex justify-between">
          <div className="skeleton-matrix h-3 w-20 rounded-none" />
          <div className="skeleton-matrix h-3 w-24 rounded-none" />
        </div>
        <div className="skeleton-matrix h-2 w-full rounded-none" />
      </div>

      {/* Source tabs skeleton */}
      <div className="space-y-2">
        <div className="skeleton-matrix h-2.5 w-32 rounded-none" />
        <div className="border border-[#00ff41]/15">
          <div className="grid grid-cols-4 border-b border-[#00ff41]/15">
            {["NumVerify", "IPQS", "Abstract", "Twilio"].map((l) => (
              <div key={l} className="skeleton-matrix h-10" />
            ))}
          </div>
          <div className="p-4 space-y-1">
            {/* Deterministic widths — no Math.random() (avoids SSR/CSR hydration mismatch). */}
            {[92, 74, 88, 61, 95, 70, 83, 66].map((w, i) => (
              <div key={i} className="skeleton-matrix h-3 rounded-none" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
