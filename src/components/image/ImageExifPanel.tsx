"use client";

import { useCallback, useRef, useState } from "react";
import {
  Camera, MapPin, ExternalLink, Copy, Check, FileQuestion, Aperture, Clock, Compass,
  Mountain, AlertTriangle, Upload, ScanEye, FileText, Fingerprint, Gauge, ShieldAlert, Info,
} from "lucide-react";
import { copyText } from "@/lib/utils";
import { formatDms, decimalPair, mapLinks, reverseImageLinks } from "@/lib/analysis/exif";
import { extractFileMeta, hashFile } from "@/lib/analysis/meta/fileMeta";
import type { UniversalMeta, FileHashes } from "@/lib/analysis/meta/types";

/** Human-readable byte size for the file summary. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB: generous for a document, video or archive

// Image kinds a browser can safely render as an inline preview thumbnail.
const PREVIEWABLE = new Set(["jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico"]);

/** One-line reading of the entropy figure (packing / encryption signal). */
function entropyNote(bits: number): string {
  if (bits >= 7.5) return "high — likely compressed or encrypted";
  if (bits < 1) return "very low — highly repetitive data";
  return "typical for structured data";
}

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
  const [meta, setMeta] = useState<UniversalMeta | null>(null);
  const [name, setName] = useState<string>("");
  const [size, setSize] = useState<number>(0);
  const [hashes, setHashes] = useState<FileHashes | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);

  const ingest = useCallback(async (file: File) => {
    setError(null); setShowMap(false); setCopied(null); setHashes(null);
    if (file.size > MAX_BYTES) { setError("File is larger than 100 MB: pick a smaller file."); return; }
    let buf: Uint8Array;
    let parsed: UniversalMeta;
    try {
      buf = new Uint8Array(await file.arrayBuffer());
      parsed = await extractFileMeta(buf, file.name);
    } catch {
      // The parsers are bounds-checked and never throw on hostile bytes, but a
      // read that fails (unreadable file, a platform primitive unavailable) must
      // surface as a message, not an unhandled rejection that leaves a blank panel.
      setError("This file could not be read; it may be corrupt or unsupported.");
      return;
    }
    // Revoke the previous object URL before replacing it (no leaked blobs).
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = PREVIEWABLE.has(parsed.identity.kind) ? URL.createObjectURL(file) : null;
    previewRef.current = url;
    setPreview(url);
    setMeta(parsed);
    setName(file.name);
    setSize(file.size);
    // Hashing a large file can take a moment; let the metadata render first.
    void hashFile(buf).then(setHashes).catch(() => setHashes(null));
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

  const copyItem = useCallback((id: string, text: string) => {
    void copyText(text); setCopied(id); setTimeout(() => setCopied(null), 1600);
  }, []);

  const gps = meta?.gps ?? null;
  const image = meta?.image ?? null;
  const groups = meta ? [...new Set(meta.fields.map((f) => f.group))] : [];

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
        <div className="text-sm font-mono text-[var(--hv-ink)]">Drop any file, or click to choose</div>
        <div className="text-[11px] font-mono text-[var(--hv-ink-dim)] text-center max-w-md">
          Images, video, audio, documents, archives and more. Parsed entirely in your browser, so the file, and any
          location or author it carries, never leaves this machine.
        </div>
        <input type="file" className="hidden" onChange={onInput} />
      </label>

      {error && (
        <div className="terminal-card p-4 border font-mono text-sm text-[#ff4d6d]" style={{ borderColor: "#ff4d6d50" }}>
          <span className="opacity-60">[ERROR] </span>{error}
        </div>
      )}

      {meta && (
        <div className="space-y-4">
          {/* File identity */}
          <div className="terminal-card p-5 space-y-4">
            <div className="flex items-start gap-4 flex-wrap">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt={name} className="w-28 h-28 object-cover rounded border border-[var(--hv-glass-border)]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold gradient-text font-mono break-all">{name}</div>
                <div className="text-[12px] font-mono text-[var(--hv-ink-dim)] mt-1">
                  {meta.identity.label} · {meta.identity.mime} · {humanSize(size)}
                  {image?.width && image?.height ? ` · ${image.width}×${image.height}px` : ""}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {meta.identity.kind === "unknown" ? (
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-mono font-bold px-2 py-0.5 rounded border tracking-widest text-[var(--hv-amber)]" style={{ borderColor: "#fbbf2470", backgroundColor: "#fbbf2416" }}>
                      <FileQuestion className="w-3 h-3" /> UNIDENTIFIED
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-mono font-bold px-2 py-0.5 rounded border tracking-widest text-[var(--hv-cyan)]" style={{ borderColor: "var(--hv-glass-hi)" }}>
                      <FileText className="w-3 h-3" /> {meta.identity.kind.toUpperCase()}
                    </span>
                  )}
                  {image?.hasExif && (
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-mono font-bold px-2 py-0.5 rounded border tracking-widest text-[var(--hv-green)]" style={{ borderColor: "#00ff8570", backgroundColor: "#00ff8516" }}>
                      <Camera className="w-3 h-3" /> EXIF PRESENT{gps ? " · GPS FOUND" : ""}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {meta.extMismatch && (
              <div className="flex items-start gap-2 p-2.5 rounded-md border text-[12px] font-mono text-[var(--hv-amber)]" style={{ borderColor: "#fbbf2470", backgroundColor: "#fbbf2410" }}>
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Extension mismatch: this file is named <b>.{meta.extMismatch.claimed}</b> but its contents are actually
                  <b> {meta.extMismatch.actual}</b>. A disguised extension can be a sign of tampering.
                </span>
              </div>
            )}
          </div>

          {/* GPS: the headline for GEOINT */}
          {gps && (
            <div className="terminal-card p-4 space-y-3">
              <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[var(--hv-green)]" /> GPS COORDINATE
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xl font-mono font-bold text-[var(--hv-green)]">{decimalPair(gps)}</span>
                <button type="button" onClick={() => copyItem("coord", decimalPair(gps))} title="Copy coordinate"
                  className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded border border-[var(--hv-glass-border)] text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)]">
                  {copied === "coord" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied === "coord" ? "Copied" : "Copy"}
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

          {/* Camera + capture (images with EXIF) */}
          {image?.hasExif && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="terminal-card p-4 space-y-1">
                <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] mb-2 flex items-center gap-1.5"><Camera className="w-3 h-3" /> CAMERA</div>
                <Row label="Make" value={image.tags.make} accent="var(--hv-green)" />
                <Row label="Model" value={image.tags.model} accent="var(--hv-green)" />
                <Row label="Lens" value={image.tags.lens} />
                <Row label="Software" value={image.tags.software} accent="var(--hv-magenta)" />
                <Row label="Orientation" value={image.tags.orientation !== null ? String(image.tags.orientation) : null} />
              </div>
              <div className="terminal-card p-4 space-y-1">
                <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] mb-2 flex items-center gap-1.5"><Aperture className="w-3 h-3" /> CAPTURE</div>
                <Row label={<span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> Taken</span>} value={image.tags.dateTimeOriginal} accent="var(--hv-cyan)" />
                <Row label="Aperture" value={image.tags.fNumber !== null ? `f/${image.tags.fNumber}` : null} />
                <Row label="Shutter" value={image.tags.exposureTime} />
                <Row label="ISO" value={image.tags.iso !== null ? String(image.tags.iso) : null} />
                <Row label="Focal length" value={image.tags.focalLength !== null ? `${image.tags.focalLength} mm` : null} />
              </div>
            </div>
          )}

          {/* Format-specific metadata, grouped */}
          {groups.map((group) => (
            <div key={group} className="terminal-card p-4 space-y-1">
              <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] mb-2 flex items-center gap-1.5">
                <Info className="w-3 h-3" /> {group}
              </div>
              {meta.fields.filter((f) => f.group === group).map((f, i) => (
                <Row key={`${f.label}-${i}`} label={f.label} value={f.value} accent={f.sensitive ? "var(--hv-amber)" : undefined} />
              ))}
            </div>
          ))}

          {/* Integrity: hashes + entropy, for any file */}
          <div className="terminal-card p-4 space-y-1">
            <div className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] mb-2 flex items-center gap-1.5"><Fingerprint className="w-3 h-3" /> INTEGRITY</div>
            {hashes ? (
              <>
                <HashRow label="SHA-256" value={hashes.sha256} copied={copied === "sha256"} onCopy={() => copyItem("sha256", hashes.sha256)} />
                <HashRow label="SHA-1" value={hashes.sha1} copied={copied === "sha1"} onCopy={() => copyItem("sha1", hashes.sha1)} />
              </>
            ) : (
              <div className="text-[12px] font-mono text-[var(--hv-ink-dim)] py-1.5">Computing digests…</div>
            )}
            {meta.entropy !== null && (
              <Row label={<span className="inline-flex items-center gap-1"><Gauge className="w-3 h-3" /> Entropy</span>}
                value={`${meta.entropy.toFixed(2)} bits/byte (${entropyNote(meta.entropy)})`} />
            )}
          </div>

          {/* Honest limitations */}
          {meta.notes.length > 0 && (
            <div className="terminal-card p-4 space-y-1.5">
              {meta.notes.map((note, i) => (
                <p key={i} className="text-[11px] font-mono text-[var(--hv-ink-dim)] flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {note}
                </p>
              ))}
            </div>
          )}

          {/* Reverse-image / face search (images only) */}
          {image && (
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
            <AlertTriangle className="w-3 h-3" /> Everything above is read from the file&rsquo;s own bytes in your browser. Nothing is uploaded.
          </p>
        </div>
      )}
    </div>
  );
}

function HashRow({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-[var(--hv-glass-border)] last:border-b-0">
      <span className="text-[12px] uppercase tracking-widest text-[var(--hv-ink-dim)] w-20 shrink-0 pt-0.5">{label}</span>
      <span className="font-mono text-[11px] flex-1 break-all text-[var(--hv-ink)]">{value}</span>
      <button type="button" onClick={onCopy} title={`Copy ${label}`}
        className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded border border-[var(--hv-glass-border)] text-[var(--hv-cyan)] hover:border-[var(--hv-glass-hi)] shrink-0">
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
}
