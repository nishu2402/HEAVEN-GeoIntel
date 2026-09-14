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
      ...frame24("PRIV", [1, 2, 3]),                     // no printable owner -> nothing
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

describe("meta/audio MP3 stream header", () => {
  const frame24 = (id: string, body: number[]) => [...A(id), ...synchsafe(body.length), 0, 0, ...body];
  /** An MPEG 1 Layer III frame header: bitrate index 9 (128 kbps), 44.1 kHz. */
  const mpegHeader = (opts: { version?: number; bitrateIdx?: number; rateIdx?: number; mode?: number; layer?: number } = {}) => {
    const version = opts.version ?? 3;
    const layer = opts.layer ?? 1;
    return [
      0xff,
      0xe0 | (version << 3) | (layer << 1) | 1,
      ((opts.bitrateIdx ?? 9) << 4) | ((opts.rateIdx ?? 0) << 2),
      (opts.mode ?? 0) << 6,
    ];
  };
  const xing = (frames: number) => [...A("Xing"), ...u32be(1), ...u32be(frames)];

  it("describes the stream and times it from the Xing frame count", () => {
    // 32 bytes of side info sit between the header and the Xing tag in a
    // stereo MPEG 1 frame; 9200 frames at 1152 samples each is 240 seconds.
    const file = cat(mpegHeader(), new Array(32).fill(0), xing(9200), new Array(64).fill(0));
    const r = extractAudio("mp3", file);
    expect(val(r, "Format")).toBe("MPEG 1 Layer III");
    expect(val(r, "Sample rate")).toBe("44100 Hz");
    expect(val(r, "Channels")).toBe("stereo");
    expect(val(r, "Bitrate")).toBe("128 kbps (variable)");
    expect(val(r, "Duration")).toBe("4m 00s");
  });

  it("times a constant-bitrate file from its length instead", () => {
    // 96000 bytes at 128 kbps is 6 seconds of audio, and no Xing tag is present.
    const file = cat(mpegHeader(), new Array(95996).fill(0));
    expect(val(extractAudio("mp3", file), "Duration")).toBe("0m 06s");
    expect(val(extractAudio("mp3", file), "Bitrate")).toBe("128 kbps");
  });

  it("renders a long recording in hours", () => {
    const file = cat(mpegHeader(), new Array(32).fill(0), xing(200000), new Array(16).fill(0));
    expect(val(extractAudio("mp3", file), "Duration")).toBe("1h 27m 04s");
  });

  it("reads the mono and MPEG 2 layouts, where the Xing tag sits closer in", () => {
    const mono = cat(mpegHeader({ mode: 3 }), new Array(17).fill(0), xing(1000), new Array(8).fill(0));
    expect(val(extractAudio("mp3", mono), "Channels")).toBe("mono");
    expect(val(extractAudio("mp3", mono), "Duration")).toBe("0m 26s");
    const v2 = cat(mpegHeader({ version: 2, bitrateIdx: 8, rateIdx: 1 }), new Array(17).fill(0), xing(500), new Array(8).fill(0));
    expect(val(extractAudio("mp3", v2), "Format")).toBe("MPEG 2 Layer III");
    expect(val(extractAudio("mp3", v2), "Sample rate")).toBe("24000 Hz");
    expect(val(extractAudio("mp3", v2), "Bitrate")).toBe("64 kbps (variable)");
    const v25 = cat(mpegHeader({ version: 0, rateIdx: 2 }), new Array(32).fill(0));
    expect(val(extractAudio("mp3", v25), "Format")).toBe("MPEG 2.5 Layer III");
    expect(val(extractAudio("mp3", v25), "Sample rate")).toBe("8000 Hz");
  });

  it("finds the stream after an ID3 tag", () => {
    const frames = frame24("TIT2", [3, ...A("Song")]);
    const file = cat(A("ID3"), [4, 0, 0], synchsafe(frames.length), frames, mpegHeader(), new Array(32).fill(0), xing(100), new Array(8).fill(0));
    const r = extractAudio("mp3", file);
    expect(val(r, "Title")).toBe("Song");
    expect(val(r, "Format")).toBe("MPEG 1 Layer III");
  });

  it("describes nothing when the stream is a layer or version it does not read", () => {
    const layer2 = cat(mpegHeader({ layer: 2 }), new Array(32).fill(0));
    expect(val(extractAudio("mp3", layer2), "Format")).toBeUndefined();
    const reserved = cat(mpegHeader({ version: 1 }), new Array(32).fill(0));
    expect(val(extractAudio("mp3", reserved), "Format")).toBeUndefined();
    // A free-format or invalid bitrate index states no bitrate and no duration.
    const free = cat(mpegHeader({ bitrateIdx: 0 }), new Array(32).fill(0));
    expect(val(extractAudio("mp3", free), "Format")).toBe("MPEG 1 Layer III");
    expect(val(extractAudio("mp3", free), "Bitrate")).toBeUndefined();
    expect(val(extractAudio("mp3", free), "Duration")).toBeUndefined();
  });

  it("states no sample rate for a reserved rate index", () => {
    const reserved = cat(mpegHeader({ rateIdx: 3 }), new Array(32).fill(0));
    expect(val(extractAudio("mp3", reserved), "Format")).toBe("MPEG 1 Layer III");
    expect(val(extractAudio("mp3", reserved), "Sample rate")).toBeUndefined();
    expect(val(extractAudio("mp3", reserved), "Duration")).toBe("0m 00s"); // 36 bytes at 128 kbps
  });

  it("reads the MPEG 2 stereo layout, where the Xing tag sits at 17 bytes", () => {
    const v2 = cat(mpegHeader({ version: 2, bitrateIdx: 8, rateIdx: 0 }), new Array(17).fill(0), xing(500), new Array(8).fill(0));
    expect(val(extractAudio("mp3", v2), "Channels")).toBe("stereo");
    expect(val(extractAudio("mp3", v2), "Duration")).toBe("0m 26s");
  });

  it("ignores a Xing header the file ends inside, at either field", () => {
    const noCount = cat(mpegHeader(), new Array(32).fill(0), [...A("Xing"), ...u32be(1)]);
    expect(val(extractAudio("mp3", noCount), "Duration")).toBe("0m 00s");
    const noFlags = cat(mpegHeader(), new Array(32).fill(0), A("Xing"));
    expect(val(extractAudio("mp3", noFlags), "Duration")).toBe("0m 00s");
  });

  it("reads the MPEG 2 mono layout, where the Xing tag sits at 9 bytes", () => {
    const v2mono = cat(mpegHeader({ version: 2, bitrateIdx: 8, rateIdx: 0, mode: 3 }), new Array(9).fill(0), xing(500), new Array(8).fill(0));
    expect(val(extractAudio("mp3", v2mono), "Channels")).toBe("mono");
    expect(val(extractAudio("mp3", v2mono), "Duration")).toBe("0m 26s");
  });

  it("reports nothing at all when no frame sync is present", () => {
    expect(extractAudio("mp3", cat(new Array(64).fill(0))).fields).toHaveLength(0);
  });

  it("ignores a Xing header whose frame-count flag is not set", () => {
    const noFlag = cat(mpegHeader(), new Array(32).fill(0), [...A("Xing"), ...u32be(0), ...u32be(9200)], new Array(64).fill(0));
    // Falls back to the length-derived figure rather than trusting the count.
    expect(val(extractAudio("mp3", noFlag), "Bitrate")).toBe("128 kbps (variable)");
    expect(val(extractAudio("mp3", noFlag), "Duration")).toBe("0m 00s");
  });
});

describe("meta/audio structured ID3 frames", () => {
  const frame24 = (id: string, body: number[]) => [...A(id), ...synchsafe(body.length), 0, 0, ...body];
  const tagged = (frames: number[]) => cat(A("ID3"), [4, 0, 0], synchsafe(frames.length), frames);

  it("splits a comment, a custom text frame and a custom URL into label and value", () => {
    const r = extractAudio("mp3", tagged([
      ...frame24("COMM", [0, ...A("eng"), ...A("ripper note"), 0, ...A("ripped from CD")]),
      ...frame24("TXXX", [0, ...A("Purchase account"), 0, ...A("j.okafor@example.com")]),
      ...frame24("WXXX", [0, ...A("Store"), 0, ...A("https://example.com/album")]),
    ]));
    expect(val(r, "Comment: ripper note")).toBe("ripped from CD");
    expect(val(r, "Custom: Purchase account")).toBe("j.okafor@example.com");
    expect(val(r, "URL: Store")).toBe("https://example.com/album");
    expect(r.fields.find((f) => f.label.startsWith("Custom"))?.sensitive).toBe(true);
  });

  it("labels a described frame with no description, and skips one with no value", () => {
    const r = extractAudio("mp3", tagged([
      ...frame24("COMM", [0, ...A("eng"), 0, ...A("just a comment")]),
      ...frame24("TXXX", [0, ...A("empty"), 0]),
      ...frame24("WXXX", [0, ...A("no separator")]),
    ]));
    expect(val(r, "Comment")).toBe("just a comment");
    expect(val(r, "Custom: empty")).toBeUndefined();
    expect(val(r, "URL: no separator")).toBeUndefined();
  });

  it("reads a described frame written in UTF-16 and in UTF-8", () => {
    const body = [1, ...A("eng"), 0xff, 0xfe, ...utf16le("note"), 0, 0, ...utf16le("wide value")];
    expect(val(extractAudio("mp3", tagged(frame24("COMM", body))), "Comment: note")).toBe("wide value");
    const utf8 = [3, ...new TextEncoder().encode("Café"), 0, ...new TextEncoder().encode("naïve")];
    expect(val(extractAudio("mp3", tagged(frame24("TXXX", utf8))), "Custom: Café")).toBe("naïve");
  });

  it("sizes embedded artwork and other encapsulated objects", () => {
    const r = extractAudio("mp3", tagged([
      ...frame24("APIC", new Array(2048).fill(1)),
      ...frame24("GEOB", new Array(64).fill(1)),
    ]));
    expect(val(r, "Embedded artwork")).toBe("2,048 bytes");
    expect(val(r, "Embedded object")).toBe("64 bytes");
  });

  it("names the application behind a private frame", () => {
    const body = [...A("WM/MediaClassPrimaryID"), 0, 1, 2, 3];
    expect(val(extractAudio("mp3", tagged(frame24("PRIV", body))), "Private frame owner")).toBe("WM/MediaClassPrimaryID");
  });

  it("reads the rest of the registered text frames", () => {
    const r = extractAudio("mp3", tagged([
      ...frame24("TPE2", [0, ...A("Various")]),
      ...frame24("TCOM", [0, ...A("A. Composer")]),
      ...frame24("TOWN", [0, ...A("licensee-4471")]),
      ...frame24("TRCK", [0, ...A("3/12")]),
      ...frame24("TPUB", [0, ...A("Sable Records")]),
      ...frame24("TSRC", [0, ...A("GBAYE0601498")]),
      ...frame24("TDTG", [0, ...A("2024-01-02T10:00:00")]),
    ]));
    expect(val(r, "Album artist")).toBe("Various");
    expect(val(r, "Composer")).toBe("A. Composer");
    expect(val(r, "File owner")).toBe("licensee-4471");
    expect(val(r, "Track")).toBe("3/12");
    expect(val(r, "Publisher")).toBe("Sable Records");
    expect(val(r, "ISRC")).toBe("GBAYE0601498");
    expect(val(r, "Tagged")).toBe("2024-01-02T10:00:00");
  });
});

describe("meta/audio WAV beyond the INFO list", () => {
  const chunk = (id: string, data: number[]) => [...A(id.padEnd(4)), ...u32le(data.length), ...data, ...(data.length & 1 ? [0] : [])];
  const wav = (...chunks: number[][]) => {
    const body = [...A("WAVE"), ...chunks.flat()];
    return cat(A("RIFF"), u32le(body.length), body);
  };
  const fmt = (format = 1) => chunk("fmt ", [
    ...u16le(format), ...u16le(2), ...u32le(48000), ...u32le(192000), ...u16le(4), ...u16le(16),
  ]);
  const padTo = (s: string, n: number) => [...A(s), ...new Array(Math.max(0, n - s.length)).fill(0)];

  it("names the format and times the file from its data chunk", () => {
    const r = extractAudio("wav", wav(fmt(), chunk("data", new Array(384000).fill(0))));
    expect(val(r, "Format")).toBe("PCM");
    expect(val(r, "Sample rate")).toBe("48000 Hz");
    expect(val(r, "Duration")).toBe("0m 02s");
    expect(val(extractAudio("wav", wav(fmt(3))), "Format")).toBe("IEEE float");
    expect(val(extractAudio("wav", wav(fmt(0x99))), "Format")).toBe("format code 153");
  });

  it("reads the Broadcast Wave block a field recorder writes", () => {
    const bext = chunk("bext", [
      ...padTo("Interview, harbour office", 256),
      ...padTo("Sound Devices MixPre-6 II", 32),
      ...padTo("SD-778812-TAKE04", 32),
      ...padTo("2024-05-14", 10),
      ...padTo("09:42:11", 8),
      ...new Array(8).fill(0), ...u16le(1), ...new Array(64).fill(0), ...new Array(190).fill(0),
      ...padTo("A=PCM,F=48000,W=24,M=stereo,T=MixPre", 120),
    ]);
    const r = extractAudio("wav", wav(fmt(), bext));
    expect(val(r, "Description")).toBe("Interview, harbour office");
    expect(val(r, "Originator")).toBe("Sound Devices MixPre-6 II");
    expect(val(r, "Originator reference")).toBe("SD-778812-TAKE04");
    expect(val(r, "Recorded")).toBe("2024-05-14 09:42:11");
    expect(val(r, "Coding history")).toBe("A=PCM,F=48000,W=24,M=stereo,T=MixPre");
    expect(r.fields.find((f) => f.label === "Originator")?.sensitive).toBe(true);
  });

  it("reads a date with no time, and reports nothing from an empty block", () => {
    const dateOnly = chunk("bext", [...new Array(256).fill(0), ...new Array(32).fill(0), ...new Array(32).fill(0), ...padTo("2024-05-14", 10), ...new Array(8).fill(0)]);
    expect(val(extractAudio("wav", wav(dateOnly)), "Recorded")).toBe("2024-05-14");
    expect(extractAudio("wav", wav(chunk("bext", new Array(400).fill(0)))).fields).toHaveLength(0);
  });

  it("reads nothing from a format chunk or an iXML block the file ends inside", () => {
    const shortFmt = cat(A("RIFF"), u32le(20), A("WAVE"), A("fmt "), u32le(16), u16le(1), u16le(2));
    expect(val(extractAudio("wav", shortFmt), "Duration")).toBeUndefined();
    const emptyXml = cat(A("RIFF"), u32le(16), A("WAVE"), A("iXML"), u32le(64));
    expect(extractAudio("wav", emptyXml).fields).toHaveLength(0);
  });

  it("reads the scene and take out of an iXML block", () => {
    const ixml = chunk("iXML", A("<BWFXML><PROJECT>Harbour</PROJECT><SCENE>12A</SCENE><TAKE>4</TAKE><NOTE>wind</NOTE></BWFXML>"));
    const r = extractAudio("wav", wav(ixml));
    expect(val(r, "Project")).toBe("Harbour");
    expect(val(r, "Scene")).toBe("12A");
    expect(val(r, "Take")).toBe("4");
    expect(val(r, "Note")).toBe("wind");
    // A block with none of those tags contributes nothing.
    expect(extractAudio("wav", wav(chunk("iXML", A("<BWFXML/>")))).fields).toHaveLength(0);
  });

  it("reads the rest of the registered INFO tags", () => {
    const info = chunk("LIST", [...A("INFO"),
      ...chunk("IENG", A("K. Osei")), ...chunk("ITCH", A("studio-b")),
      ...chunk("ICMS", A("Northgate")), ...chunk("IARL", A("shelf 4")),
      ...chunk("ISBJ", A("harbour")), ...chunk("IKEY", A("field, ambient")), ...chunk("IMED", A("SD card")),
    ]);
    const r = extractAudio("wav", wav(info));
    expect(val(r, "Engineer")).toBe("K. Osei");
    expect(val(r, "Technician")).toBe("studio-b");
    expect(val(r, "Commissioned by")).toBe("Northgate");
    expect(val(r, "Archival location")).toBe("shelf 4");
    expect(val(r, "Subject")).toBe("harbour");
    expect(val(r, "Keywords")).toBe("field, ambient");
    expect(val(r, "Medium")).toBe("SD card");
  });
});

describe("meta/audio FLAC beyond the basics", () => {
  const block = (type: number, data: number[], last = false) =>
    [...[(last ? 0x80 : 0) | type], ...u32be(data.length).slice(1), ...data];
  /** A STREAMINFO with a 44.1 kHz rate, 2 channels and 16-bit samples. */
  const streamInfo = (samples: number) => {
    const packed = (44100 << 12) | ((2 - 1) << 9) | ((16 - 1) << 4);
    return [...new Array(10).fill(0), ...u32be(packed), ...u32be(samples), ...new Array(16).fill(0)];
  };
  const comments = (vendor: string, pairs: string[]) => [
    ...u32le(vendor.length), ...A(vendor), ...u32le(pairs.length),
    ...pairs.flatMap((p) => [...u32le(p.length), ...A(p)]),
  ];

  it("reports channels and bit depth alongside the rate and duration", () => {
    const r = extractAudio("flac", cat(A("fLaC"), block(0, streamInfo(44100 * 125), true)));
    expect(val(r, "Sample rate")).toBe("44100 Hz");
    expect(val(r, "Channels")).toBe("2");
    expect(val(r, "Bit depth")).toBe("16-bit");
    expect(val(r, "Duration")).toBe("2m 05s");
  });

  it("keeps an unregistered Vorbis key and drops the replay-gain noise", () => {
    const r = extractAudio("flac", cat(A("fLaC"), block(4, comments("libFLAC 1.4", [
      "ARTIST=M. Okonkwo",
      "ORGANIZATION=Harbour Recordings",
      "LOCATION=Trieste",
      "RECORDING_DEVICE=Zoom H6",
      "REPLAYGAIN_TRACK_GAIN=-6.5 dB",
    ]), true)));
    expect(val(r, "Artist")).toBe("M. Okonkwo");
    expect(val(r, "Organisation")).toBe("Harbour Recordings");
    expect(val(r, "Location")).toBe("Trieste");
    expect(val(r, "RECORDING_DEVICE")).toBe("Zoom H6");
    expect(val(r, "REPLAYGAIN_TRACK_GAIN")).toBeUndefined();
  });

  it("gives no duration for a stream of unknown length", () => {
    // A FLAC may legally declare a total sample count of zero when the encoder
    // did not know the length; the rate is still real, so it is still reported.
    const r = extractAudio("flac", cat(A("fLaC"), block(0, streamInfo(0), true)));
    expect(val(r, "Sample rate")).toBe("44100 Hz");
    expect(val(r, "Duration")).toBeUndefined();
  });

  it("sizes an embedded picture block", () => {
    const r = extractAudio("flac", cat(A("fLaC"), block(6, new Array(4096).fill(0), true)));
    expect(val(r, "Embedded artwork")).toBe("4,096 bytes");
  });
});
