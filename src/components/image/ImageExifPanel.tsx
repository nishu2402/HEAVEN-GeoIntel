"use client";

import { useCallback, useRef, useState } from "react";
import {
  Camera, MapPin, ExternalLink, Copy, Check, ImageOff, Aperture, Clock, Compass,
  Mountain, AlertTriangle, Upload, ScanEye,
} from "lucide-react";
import { copyText } from "@/lib/utils";
import {
  parseExif, formatDms, decimalPair, mapLinks, reverseImageLinks, type ImageMeta,
} from "@/lib/analysis/exif";

interface FileFacts { name: string; size: number; typeLabel: string }

/** Human-readable byte size for the file summary. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_BYTES = 40 * 1024 * 1024; // 40 MB: a generous ceiling for a still image

function Row({ label, value, accent }: { label: React.ReactNode; value: React.ReactNode; accent?: string }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-[var(--hv-glass-border)] last:border-b-0">
      <span className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] w-32 shrink-0 pt-0.5">{label}</span>
      <span className="font-mono text-xs flex-1 break-all" style={{ color: accent ?? "var(--hv-ink)" }}>{value}</span>
    </div>
  );
}

export default function ImageExifPanel() {
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  const [facts, setFacts] = useState<FileFacts | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [copied, setCopied] = useState(false);
  const previewRef = useRef<string | null>(null);

  const ingest = useCallback(async (file: File) => {
    setError(null); setShowMap(false); setCopied(false);
    if (file.size > MAX_BYTES) { setError("File is larger than 40 MB: pick a still image."); return; }
    const buf = new Uint8Array(await file.arrayBuffer());
    const parsed = parseExif(buf);
    // Revoke the previous object URL before replacing it (no leaked blobs).
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = parsed.format === "unknown" ? null : URL.createObjectURL(file);
    previewRef.current = url;
    setPreview(url);
    setMeta(parsed);
    setFacts({ name: file.name, size: file.size, typeLabel: file.type || parsed.format });
  }, []);

  const onInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void ingest(file);
  }, [ingest]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void ingest(file);
  }, [ingest]);

  const copyCoord = useCallback((text: string) => {
    void copyText(text); setCopied(true); setTimeout(() => setCopied(false), 1600);
  }, []);

  const gps = meta?.gps ?? null;

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`terminal-card flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed cursor-pointer transition-colors ${
          dragOver ? "border-[var(--hv-green)] bg-[var(--hv-green)]/5" : "border-[var(--hv-glass-border)] hover:border-[var(--hv-glass-hi)]"
        }`}
      >
        <Upload className="w-7 h-7 text-[var(--hv-cyan)]" />
        <div className="text-sm font-mono text-[var(--hv-ink)]">Drop a JPEG or PNG, or click to choose</div>
        <div className="text-[11px] font-mono text-[var(--hv-ink-dim)] text-center max-w-md">
          Parsed entirely in your browser. The image is never uploaded, so any location it carries never leaves this machine.
        </div>
        <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={onInput} />
      </label>

      {error && (
        <div className="terminal-card p-4 border font-mono text-sm text-[#ff4d6d]" style={{ borderColor: "#ff4d6d50" }}>
          <span className="opacity-60">[ERROR] </span>{error}
        </div>
      )}

      {meta && facts && (
        <div className="space-y-4">
          <div className="terminal-card p-5 space-y-4">
            <div className="flex items-start gap-4 flex-wrap">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt={facts.name} className="w-28 h-28 object-cover rounded border border-[var(--hv-glass-border)]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold gradient-text font-mono break-all">{facts.name}</div>
                <div className="text-[12px] font-mono text-[var(--hv-ink-dim)] mt-1">
                  {facts.typeLabel} · {humanSize(facts.size)}
                  {meta.width && meta.height ? ` · ${meta.width}×${meta.height}px` : ""}
                </div>
                <div className="mt-2">
                  {meta.format === "unknown" ? (
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-mono font-bold px-2 py-0.5 rounded border tracking-widest text-[var(--hv-amber)]" style={{ borderColor: "#fbbf2470", backgroundColor: "#fbbf2416" }}>
                      <ImageOff className="w-3 h-3" /> UNSUPPORTED FORMAT
                    </span>
                  ) : meta.hasExif ? (
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-mono font-bold px-2 py-0.5 rounded border tracking-widest text-[var(--hv-green)]" style={{ borderColor: "#00ff8570", backgroundColor: "#00ff8516" }}>
                      <Camera className="w-3 h-3" /> EXIF PRESENT{gps ? " · GPS FOUND" : ""}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-mono font-bold px-2 py-0.5 rounded border tracking-widest text-[var(--hv-ink-dim)]" style={{ borderColor: "var(--hv-glass-border)" }}>
                      <ImageOff className="w-3 h-3" /> NO EXIF METADATA
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* GPS: the headline for GEOINT */}
          {gps && (
            <div className="terminal-card p-4 space-y-3">
              <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[var(--hv-green)]" /> GPS COORDINATE
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xl font-mono font-bold text-[var(--hv-green)]">{decimalPair(gps)}</span>
                <button type="button" onClick={() => copyCoord(decimalPair(gps))} title="Copy coordinate"
                  className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)]">
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                <Row label="Latitude" value={formatDms(gps.latitude, "lat")} accent="var(--hv-cyan)" />
                <Row label="Longitude" value={formatDms(gps.longitude, "lon")} accent="var(--hv-cyan)" />
                <Row label={"Altitude"} value={gps.altitude !== null ? <span className="inline-flex items-center gap-1"><Mountain className="w-3 h-3" />{gps.altitude.toFixed(1)} m</span> : null} />
                <Row label="Heading" value={gps.direction !== null ? <span className="inline-flex items-center gap-1"><Compass className="w-3 h-3" />{gps.direction.toFixed(0)}°</span> : null} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                {mapLinks(gps).map((p) => (
                  <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-start gap-2 p-2.5 rounded-md border border-[var(--hv-glass-border)] hover:border-[var(--hv-glass-hi)] transition-all">
                    <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-[var(--hv-cyan)]" />
                    <div className="min-w-0"><div className="text-xs font-bold text-[var(--hv-cyan)]">{p.label}</div><div className="text-[12px] text-[var(--hv-ink-dim)] leading-tight">{p.note}</div></div>
                  </a>
                ))}
              </div>
              {showMap ? (
                <iframe
                  title="Map preview"
                  className="w-full h-64 rounded border border-[var(--hv-glass-border)]"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${gps.longitude - 0.01}%2C${gps.latitude - 0.01}%2C${gps.longitude + 0.01}%2C${gps.latitude + 0.01}&layer=mapnik&marker=${gps.latitude}%2C${gps.longitude}`}
                />
              ) : (
                <button type="button" onClick={() => setShowMap(true)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-ink-dim)] hover:text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)]">
                  <MapPin className="w-3 h-3" /> Load map preview (sends the coordinate to OpenStreetMap)
                </button>
              )}
            </div>
          )}

          {/* Camera + capture */}
          {meta.hasExif && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="terminal-card p-4 space-y-1">
                <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] mb-2 flex items-center gap-1.5"><Camera className="w-3 h-3" /> CAMERA</div>
                <Row label="Make" value={meta.tags.make} accent="var(--hv-green)" />
                <Row label="Model" value={meta.tags.model} accent="var(--hv-green)" />
                <Row label="Lens" value={meta.tags.lens} />
                <Row label="Software" value={meta.tags.software} accent="var(--hv-magenta)" />
                <Row label="Orientation" value={meta.tags.orientation !== null ? String(meta.tags.orientation) : null} />
              </div>
              <div className="terminal-card p-4 space-y-1">
                <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] mb-2 flex items-center gap-1.5"><Aperture className="w-3 h-3" /> CAPTURE</div>
                <Row label={<span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> Taken</span>} value={meta.tags.dateTimeOriginal} accent="var(--hv-cyan)" />
                <Row label="Aperture" value={meta.tags.fNumber !== null ? `f/${meta.tags.fNumber}` : null} />
                <Row label="Shutter" value={meta.tags.exposureTime} />
                <Row label="ISO" value={meta.tags.iso !== null ? String(meta.tags.iso) : null} />
                <Row label="Focal length" value={meta.tags.focalLength !== null ? `${meta.tags.focalLength} mm` : null} />
              </div>
            </div>
          )}

          {/* Reverse-image / face search */}
          {meta.format !== "unknown" && (
            <div className="terminal-card p-4 space-y-2">
              <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5"><ScanEye className="w-3 h-3" /> REVERSE-IMAGE &amp; FACE SEARCH</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {reverseImageLinks().map((p) => (
                  <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-start gap-2 p-2.5 rounded-md border border-[var(--hv-glass-border)] hover:border-[var(--hv-glass-hi)] transition-all">
                    <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-[var(--hv-magenta)]" />
                    <div className="min-w-0"><div className="text-xs font-bold text-[var(--hv-magenta)]">{p.label}</div><div className="text-[12px] text-[var(--hv-ink-dim)] leading-tight">{p.note}</div></div>
                  </a>
                ))}
              </div>
              <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] pt-1 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3" /> These engines take an uploaded file: drop the same image into whichever opens.
              </p>
            </div>
          )}

          <p className="text-[11px] font-mono text-[var(--hv-ink-dim)] px-1 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> HEIC/HEIF (the iPhone default) is not parsed here. Export or convert to JPEG to read its GPS.
          </p>
        </div>
      )}
    </div>
  );
}
