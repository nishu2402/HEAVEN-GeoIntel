import { describe, it, expect } from "vitest";
import { extractAudio } from "@/lib/analysis/meta/audio";
import { asciiBytes } from "@/lib/analysis/meta/bytes";

const A = (s: string) => asciiBytes(s);
const cat = (...p: (number[] | Uint8Array)[]) => new Uint8Array(p.flatMap((x) => Array.from(x)));
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const synchsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const utf16le = (s: string) => [...s].flatMap((c) => u16le(c.charCodeAt(0)));
const utf16be = (s: string) => [...s].flatMap((c) => [(c.charCodeAt(0) >> 8) & 0xff, c.charCodeAt(0) & 0xff]);
const val = (r: { fields: { label: string; value: string }[] }, label: string) =>
  r.fields.find((f) => f.label === label)?.value;

describe("meta/audio MP3 / ID3", () => {
  const frame24 = (id: string, body: number[]) => [...A(id), ...synchsafe(body.length), 0, 0, ...body];
  const frame23 = (id: string, body: number[]) => [...A(id), ...u32be(body.length), 0, 0, ...body];

  it("reads ID3v2.4 text frames across all encodings", () => {
    const frames = [
      ...frame24("TIT2", [3, ...A("Song")]),           // UTF-8
      ...frame24("TPE1", [0, ...A("Artist")]),          // Latin-1
      ...frame24("TSSE", [1, 0xff, 0xfe, ...utf16le("LAME")]), // UTF-16 LE BOM
      ...frame24("TENC", [1, 0xfe, 0xff, ...utf16be("Ripper")]), // UTF-16 BE BOM
      ...frame24("TALB", [2, ...utf16be("Album")]),     // UTF-16BE, no BOM
      ...frame24("TCON", [0, ...A("Rock")]),
      ...frame24("PRIV", [1, 2, 3]),                     // unknown frame -> ignored
      ...new Array(14).fill(0),                          // >=10 bytes padding -> id reads null, walk ends
    ];
    const mp3 = cat(A("ID3"), [4, 0, 0], synchsafe(frames.length), frames);
    const r = extractAudio("mp3", mp3);
    expect(val(r, "Tag version")).toBe("ID3v2.4");
    expect(val(r, "Title")).toBe("Song");
    expect(val(r, "Artist")).toBe("Artist");
    expect(val(r, "Encoder")).toBe("LAME");
    expect(val(r, "Encoded by")).toBe("Ripper");
    expect(val(r, "Album")).toBe("Album");
    expect(r.fields.find((f) => f.label === "Artist")?.sensitive).toBe(true);
  });

  it("reads ID3v2.3 (regular size fields) and stops on a zero-size frame", () => {
    const frames = [...frame23("TIT2", [0, ...A("Three")]), ...A("TXXX"), ...u32be(0), 0, 0];
    const mp3 = cat(A("ID3"), [3, 0, 0], synchsafe(frames.length), frames);
    expect(val(extractAudio("mp3", mp3), "Title")).toBe("Three");
  });

  it("notes an unparsed ID3v2.2 tag and falls back to ID3v1", () => {
    const v1 = cat(A("TAG"), A("Old Title".padEnd(30, "\0")), A("Old Artist".padEnd(30, "\0")),
      A("Old Album".padEnd(30, "\0")), A("2001"), A("a comment".padEnd(30, "\0")), [0]);
    const mp3 = cat(A("ID3"), [2, 0, 0], synchsafe(0), v1);
    const r = extractAudio("mp3", mp3);
    expect(val(r, "Tag version")).toBe("ID3v2.2");
    expect(val(r, "Title")).toBe("Old Title");
    expect(val(r, "Artist")).toBe("Old Artist");
    expect(val(r, "Comment")).toBe("a comment");
  });

  it("skips an empty-text frame and a frame whose size overruns the buffer", () => {
    const frames = [
      ...frame24("TIT2", [0]),                    // encoding byte only, no text -> dropped
      ...A("TPE1"), ...synchsafe(1000), 0, 0,     // declared size runs past the buffer -> body unreadable
    ];
    const mp3 = cat(A("ID3"), [4, 0, 0], synchsafe(frames.length), frames);
    const r = extractAudio("mp3", mp3);
    expect(r.fields.filter((f) => f.label !== "Tag version")).toEqual([]);
  });

  it("reads a bare ID3v1 tag and ignores a file with neither", () => {
    const v1 = cat(new Uint8Array(64), A("TAG"), A("T".padEnd(30, "\0")), new Uint8Array(95));
    expect(val(extractAudio("mp3", v1), "Title")).toBe("T");
    expect(extractAudio("mp3", cat([0xff, 0xfb, 0x90, 0x00])).fields).toEqual([]);
    // Truncated ID3v2 header (size unreadable).
    expect(extractAudio("mp3", cat(A("ID3"), [4, 0])).fields).toEqual([]);
  });
});

describe("meta/audio FLAC", () => {
  const streaminfo = (rate: number, samples: number) => {
    const body = new Array(34).fill(0);
    const packed = u32be((rate << 12) >>> 0); // sample rate in the top 20 bits
    for (let i = 0; i < 4; i++) body[10 + i] = packed[i];
    const s = u32be(samples);
    for (let i = 0; i < 4; i++) body[14 + i] = s[i];
    return [0x00, ...u32be(34).slice(1), ...body]; // type 0, 3-byte size
  };
  const vorbis = (last: boolean, comments: string[]) => {
    const vendor = A("libFLAC");
    const body = [...u32le(vendor.length), ...vendor, ...u32le(comments.length)];
    for (const c of comments) { const b = A(c); body.push(...u32le(b.length), ...b); }
    return [last ? 0x84 : 0x04, ...u32be(body.length).slice(1), ...body];
  };

  it("reads stream info and Vorbis comments, skipping unknown and malformed tags", () => {
    const flac = cat(A("fLaC"),
      streaminfo(44100, 441000),
      [0x01, 0, 0, 4, 0, 0, 0, 0], // a PADDING block (type 1) -> skipped
      vorbis(true, ["ARTIST=Band", "TITLE=Track", "FOO=bar", "noequalsign", "DATE=2020"]));
    const r = extractAudio("flac", flac);
    expect(val(r, "Sample rate")).toBe("44100 Hz");
    expect(val(r, "Duration")).toBe("0m 10s");
    expect(val(r, "Artist")).toBe("Band");
    expect(val(r, "Title")).toBe("Track");
    expect(val(r, "Date")).toBe("2020");
    expect(val(r, "Encoder")).toBe("libFLAC");
  });

  it("degrades on truncated blocks and zeroed stream info", () => {
    expect(extractAudio("flac", new Uint8Array(A("fLaC"))).fields).toEqual([]); // no block header
    const zeroInfo = cat(A("fLaC"), [0x80, ...u32be(34).slice(1)], new Uint8Array(34));
    expect(extractAudio("flac", zeroInfo).fields).toEqual([]); // rate 0 -> nothing pushed
    // STREAMINFO header present but its body is truncated (rate unreadable).
    expect(extractAudio("flac", cat(A("fLaC"), [0x80, 0, 0, 34])).fields).toEqual([]);
    // Vendor-length field itself unreadable.
    expect(extractAudio("flac", cat(A("fLaC"), [0x84, 0, 0, 4])).fields).toEqual([]);
    // Huge vendor length -> vendor unreadable and the comment count runs off the end.
    expect(extractAudio("flac", cat(A("fLaC"), [0x84, 0, 0, 8, ...u32le(99)])).fields).toEqual([]);
    // Empty vendor, then a zero-length comment (dropped) and a comment whose length is out of range.
    const badComments = cat(A("fLaC"), [0x84, 0, 0, 16, ...u32le(0), ...u32le(2), ...u32le(0)]);
    expect(extractAudio("flac", badComments).fields).toEqual([]);
  });
});

describe("meta/audio WAV", () => {
  const chunk = (id: string, data: number[]) => {
    const out = [...A(id.padEnd(4)), ...u32le(data.length), ...data];
    if (data.length & 1) out.push(0);
    return out;
  };

  it("reads fmt parameters and the INFO list, skipping other chunks", () => {
    const fmt = [...u16le(1), ...u16le(2), ...u32le(48000), ...u32le(0), ...u16le(4), ...u16le(16)];
    const info = [...A("INFO"),
      ...chunk("IART", A("Composer\0")), ...chunk("INAM", A("Waveform\0")),
      ...chunk("ISFT", A("Audacity\0")), ...chunk("IXYZ", A("skip\0"))];
    const wav = cat(A("RIFF"), u32le(0), A("WAVE"),
      chunk("data", [1, 2, 3]), chunk("fmt ", fmt), chunk("LIST", info));
    const r = extractAudio("wav", wav);
    expect(val(r, "Sample rate")).toBe("48000 Hz");
    expect(val(r, "Channels")).toBe("2");
    expect(val(r, "Bit depth")).toBe("16-bit");
    expect(val(r, "Artist")).toBe("Composer");
    expect(val(r, "Software")).toBe("Audacity");
  });

  it("omits zeroed fmt values", () => {
    const wav = cat(A("RIFF"), u32le(0), A("WAVE"), A("fmt "), u32le(16), new Uint8Array(16));
    expect(extractAudio("wav", wav).fields).toEqual([]);
  });

  it("ignores a non-INFO LIST", () => {
    const wav = cat(A("RIFF"), u32le(0), A("WAVE"), chunk("LIST", [...A("adtl"), 1, 2, 3, 4]));
    expect(extractAudio("wav", wav).fields).toEqual([]);
  });

  it("stops the INFO walk when a sub-chunk runs past the declared list", () => {
    // LIST size (999) and the IART size (5) both overrun the buffer.
    const wav = cat(A("RIFF"), u32le(0), A("WAVE"), A("LIST"), u32le(999), A("INFO"), A("IART"), u32le(5));
    expect(extractAudio("wav", wav).fields).toEqual([]);
  });

  it("returns nothing for an unhandled kind", () => {
    expect(extractAudio("ogg", new Uint8Array(4)).fields).toEqual([]);
  });
});
