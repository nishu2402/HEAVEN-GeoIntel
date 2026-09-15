import { describe, it, expect } from "vitest";
import { extractText } from "@/lib/analysis/meta/text";
import { sniff } from "@/lib/analysis/meta/sniff";

const enc = (s: string) => new TextEncoder().encode(s);
const run = (kind: string, s: string) => extractText(kind, enc(s));
const val = (r: { fields: { label: string; value: string }[] }, label: string) =>
  r.fields.find((f) => f.label === label)?.value;

describe("meta/text shape facts every text file has", () => {
  it("reads the byte-order mark, line endings, line count and character set", () => {
    const crlf = extractText("text", new Uint8Array([0xef, 0xbb, 0xbf, ...enc("a\r\nb\r\nc")]));
    expect(val(crlf, "Byte-order mark")).toBe("UTF-8 byte-order mark");
    expect(val(crlf, "Line endings")).toBe("CRLF (Windows)");
    expect(val(crlf, "Lines")).toBe("3"); // two breaks and a final unterminated line
    expect(val(crlf, "Character set")).toBe("ASCII only");

    const lf = run("text", "one\ntwo\n");
    expect(val(lf, "Line endings")).toBe("LF (Unix)");
    expect(val(lf, "Lines")).toBe("2");
    expect(val(lf, "Byte-order mark")).toBeUndefined();

    expect(val(run("text", "a\r\nb\nc"), "Line endings")).toBe("mixed (CRLF and LF)");
    expect(val(run("text", "café"), "Character set")).toBe("beyond ASCII (accented or non-Latin characters present)");
    expect(val(run("text", "no breaks"), "Lines")).toBeUndefined();
  });

  it("names both UTF-16 byte-order marks", () => {
    expect(val(extractText("text", new Uint8Array([0xff, 0xfe, 0x61, 0x00])), "Byte-order mark"))
      .toBe("UTF-16 little-endian byte-order mark");
    expect(val(extractText("text", new Uint8Array([0xfe, 0xff, 0x00, 0x61])), "Byte-order mark"))
      .toBe("UTF-16 big-endian byte-order mark");
  });

  it("returns nothing for a kind it does not cover", () => {
    expect(extractText("png", enc("not text")).fields).toHaveLength(0);
  });

  it("reads the shape of the other plain-text kinds it accepts", () => {
    for (const kind of ["md", "log", "yaml", "yml", "ini", "toml", "srt", "vtt"]) {
      expect(val(run(kind, "a\nb\n"), "Lines")).toBe("2");
    }
  });
});

describe("meta/text HTML", () => {
  const page = `<!DOCTYPE html><html lang="en-GB"><head>
    <title>Quarterly &amp; annual results</title>
    <meta name="generator" content="WordPress 6.4.2">
    <meta content="Dana Whitfield" name="author">
    <meta name="description" content="Results for the year">
    <meta name="keywords" content="finance, results">
    <meta name="copyright" content="Northgate Ltd">
    <meta name="application-name" content="Investor portal">
    <meta name="robots" content="noindex">
    <meta property="og:site_name" content="Northgate Investors">
    <link rel="stylesheet" href="https://cdn.example.net/site.css">
    <script src="https://analytics.example.com/t.js"></script>
    </head><body>
    <!-- built by jenkins-agent-04 at 2024-03-02 -->
    <!--[if IE]> legacy <![endif]-->
    <img src="/logo.png"><img src="/chart.png">
    <form action="/subscribe"></form>
    </body></html>`;

  it("reads the title, the meta block, the structure and the hosts", () => {
    const r = run("html", page);
    expect(val(r, "Title")).toBe("Quarterly & annual results");
    expect(val(r, "Generator")).toBe("WordPress 6.4.2");
    expect(val(r, "Author")).toBe("Dana Whitfield"); // attributes in either order
    expect(val(r, "Description")).toBe("Results for the year");
    expect(val(r, "Keywords")).toBe("finance, results");
    expect(val(r, "Copyright")).toBe("Northgate Ltd");
    expect(val(r, "Application")).toBe("Investor portal");
    expect(val(r, "Robots directive")).toBe("noindex");
    expect(val(r, "Site name")).toBe("Northgate Investors");
    expect(val(r, "Language")).toBe("en-GB");
    expect(val(r, "Structure")).toBe("1 scripts, 1 stylesheets, 2 images, 1 forms");
    expect(val(r, "External hosts")).toBe("cdn.example.net, analytics.example.com");
    expect(r.fields.find((f) => f.label === "Generator")?.sensitive).toBe(true);
  });

  it("surfaces the comments a build pipeline left behind", () => {
    const r = run("html", page);
    expect(val(r, "Comments")).toBe("built by jenkins-agent-04 at 2024-03-02");
    expect(r.fields.find((f) => f.label === "Comments")?.sensitive).toBe(true);
  });

  it("reads a page with none of that without inventing any of it", () => {
    const r = run("html", "<html><body><p>Bare</p><!--  --></body></html>");
    expect(val(r, "Title")).toBeUndefined();
    expect(val(r, "Generator")).toBeUndefined();
    expect(val(r, "Site name")).toBeUndefined();
    expect(val(r, "Language")).toBeUndefined();
    expect(val(r, "External hosts")).toBeUndefined();
    expect(val(r, "Comments")).toBeUndefined();
    expect(val(r, "Structure")).toBe("0 scripts, 0 stylesheets, 0 images, 0 forms");
  });

  it("caps the host list rather than printing every link on a page", () => {
    const many = Array.from({ length: 30 }, (_, i) => `<a href="https://host${i}.example.com/">x</a>`).join("");
    expect(val(run("html", many), "External hosts")?.split(", ")).toHaveLength(20);
  });

  it("caps the comment list too", () => {
    const many = Array.from({ length: 9 }, (_, i) => `<!-- note ${i} -->`).join("");
    expect(val(run("html", many), "Comments")?.split(" | ")).toHaveLength(5);
  });
});

describe("meta/text SVG", () => {
  const drawing = `<!-- Generator: Adobe Illustrator 28.0.0, SVG Export Plug-In -->
    <svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 744 1052"
      sodipodi:docname="floorplan-final-v3.svg" inkscape:version="1.3 (0e150ed)"
      inkscape:export-filename="/home/kosei/plans/out.png">
      <title>Second floor</title><desc>Survey drawing</desc>
      <metadata><rdf:RDF><cc:Work>
        <dc:creator>K. Osei</dc:creator><dc:title>Floor plan</dc:title>
        <dc:rights>CC BY 4.0</dc:rights><dc:date>2024-03-02</dc:date>
      </cc:Work></rdf:RDF></metadata>
      <image href="data:image/png;base64,AAAA"/>
      <image href="https://tiles.example.org/a.png"/>
      <rect/><circle/>
    </svg>`;

  it("reads the editor's fingerprints, including the local filename", () => {
    const r = run("svg", drawing);
    expect(val(r, "Original filename")).toBe("floorplan-final-v3.svg");
    expect(val(r, "Inkscape version")).toBe("1.3 (0e150ed)");
    expect(val(r, "Export path")).toBe("/home/kosei/plans/out.png");
    expect(val(r, "Generator")).toMatch(/^Generator: Adobe Illustrator 28/);
    expect(r.fields.find((f) => f.label === "Original filename")?.sensitive).toBe(true);
  });

  it("reads the titles, the RDF block and the drawing's own measurements", () => {
    const r = run("svg", drawing);
    expect(val(r, "Title")).toBe("Second floor");
    expect(val(r, "Description")).toBe("Survey drawing");
    expect(val(r, "Width")).toBe("210mm");
    expect(val(r, "Height")).toBe("297mm");
    expect(val(r, "View box")).toBe("0 0 744 1052");
    expect(val(r, "Creator")).toBe("K. Osei");
    expect(val(r, "RDF title")).toBe("Floor plan");
    expect(val(r, "Rights")).toBe("CC BY 4.0");
    expect(val(r, "Date")).toBe("2024-03-02");
    expect(val(r, "Embedded images")).toBe("1");
    expect(val(r, "External hosts")).toBe("tiles.example.org");
    expect(Number(val(r, "Elements"))).toBeGreaterThan(5);
  });

  it("truncates a value too long to belong in a panel", () => {
    const long = `<svg><title>${"x".repeat(3000)}</title></svg>`;
    expect(val(run("svg", long), "Title")).toHaveLength(2001); // 2000 characters and the ellipsis
  });

  it("reads nothing from text that only claims to be SVG", () => {
    const r = run("svg", "no markup at all");
    expect(val(r, "Width")).toBeUndefined();
    expect(val(r, "Elements")).toBeUndefined();
  });

  it("decodes numeric entities in a title", () => {
    expect(val(run("svg", "<svg><title>A&#38;B</title></svg>"), "Title")).toBe("A&B");
  });

  it("does not call the specification's own namespace an external host", () => {
    const bare = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/ns"><rect/></svg>`;
    const r = run("svg", bare);
    expect(val(r, "External hosts")).toBeUndefined();
    expect(val(r, "Embedded images")).toBeUndefined();
    expect(val(r, "Generator")).toBeUndefined();
  });

  // The toolchain hosts used to be excluded with endsWith(), so any host ENDING
  // in one of those names was dropped from the report. A file that phones home
  // to evilw3.org is exactly the file this field exists for.
  it("does not mistake a look-alike host for the toolchain's own", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <image href="https://evilw3.org/a.png"/>
      <image href="https://notsourceforge.net/b.png"/>
      <image href="https://w3.org.tracker.test/c.png"/>
      <image href="https://dl.sourceforge.net/dtd.dtd"/>
    </svg>`;
    const hosts = val(run("svg", svg), "External hosts")?.split(", ");
    expect(hosts).toEqual(["evilw3.org", "notsourceforge.net", "w3.org.tracker.test"]);
  });
});

describe("meta/text XML and JSON", () => {
  it("reads the declaration, doctype, root element and namespaces", () => {
    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <!-- a comment before the root -->
      <plist xmlns:x="urn:one" xmlns:y="urn:two"><dict/></plist>`;
    const r = run("xml", xml);
    expect(val(r, "XML version")).toBe("1.0");
    expect(val(r, "Declared encoding")).toBe("ISO-8859-1");
    expect(val(r, "Document type")).toBe("plist");
    expect(val(r, "Root element")).toBe("plist");
    expect(val(r, "Namespaces")).toBe("urn:one, urn:two");
  });

  it("reads a bare XML document without inventing a declaration", () => {
    const r = run("xml", "<catalog><item/></catalog>");
    expect(val(r, "XML version")).toBeUndefined();
    expect(val(r, "Document type")).toBeUndefined();
    expect(val(r, "Namespaces")).toBeUndefined();
    expect(val(r, "Root element")).toBe("catalog");
  });

  // The prologue is walked token by token rather than deleted in one pass: a
  // single replace() can close two halves of the source up into a token that was
  // not in the file, and then claim to have removed every one of them.
  it("names the root element whatever the prologue does", () => {
    expect(val(run("xml", "<!<!-- -->-- x --><real/>"), "Root element")).toBe("real");
    expect(val(run("xml", "</stray><after/>"), "Root element")).toBe("after");
    expect(val(run("xml", "<?xml version=\"1.0\""), "Root element")).toBeUndefined();
    expect(val(run("xml", "<!-- never closed"), "Root element")).toBeUndefined();
    expect(val(run("xml", "<!-- nothing follows -->"), "Root element")).toBeUndefined();
    expect(val(run("xml", "no markup here"), "Root element")).toBeUndefined();
  });

  it("caps a long namespace list", () => {
    const many = Array.from({ length: 12 }, (_, i) => `xmlns:n${i}="urn:${i}"`).join(" ");
    expect(val(run("xml", `<root ${many}/>`), "Namespaces")?.split(", ")).toHaveLength(8);
  });

  it("describes the shape of a JSON object, array and scalar", () => {
    const obj = run("json", '{"name":"a","tags":[1,2],"meta":{"x":1}}');
    expect(val(obj, "Shape")).toBe("object with 3 top-level keys");
    expect(val(obj, "Top-level keys")).toBe("name, tags, meta");
    const one = run("json", '{"only":1}');
    expect(val(one, "Shape")).toBe("object with 1 top-level key");

    const arr = run("json", '[{"id":1,"email":"a@example.com"},{"id":2,"email":"b@example.com"}]');
    expect(val(arr, "Shape")).toBe("array of 2 items");
    expect(val(arr, "Item fields")).toBe("id, email");
    expect(val(run("json", "[42]"), "Shape")).toBe("array of 1 item");
    expect(val(run("json", "[42]"), "Item fields")).toBeUndefined();
    expect(val(run("json", "[null]"), "Item fields")).toBeUndefined();
    expect(val(run("json", "[]"), "Item fields")).toBeUndefined();

    expect(val(run("json", '"just a string"'), "Shape")).toBe("a single string value");
    expect(val(run("json", "null"), "Shape")).toBe("a single object value");
  });

  it("says plainly when a JSON file does not parse", () => {
    const r = run("json", "{not valid json");
    expect(r.fields.filter((f) => f.group === "Data")).toHaveLength(0);
    expect((r.notes ?? []).some((n) => /does not parse/.test(n))).toBe(true);
  });

  it("caps long key lists", () => {
    const wide = JSON.stringify(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])));
    expect(val(run("json", wide), "Top-level keys")?.split(", ")).toHaveLength(20);
    expect(val(run("json", `[${wide}]`), "Item fields")?.split(", ")).toHaveLength(20);
  });
});

describe("meta/text delimited data", () => {
  it("reads the header row, the column count and the row count", () => {
    const csv = 'name,email,city\n"Okafor, J.",j@example.com,Lagos\nP. Silva,p@example.com,Porto\n';
    const r = run("csv", csv);
    expect(val(r, "Delimiter")).toBe("comma");
    expect(val(r, "Columns")).toBe("3"); // from the header row, which names three
    expect(val(r, "Rows")).toBe("2");
    expect(val(r, "Header")).toContain("name");
    expect(r.fields.find((f) => f.label === "Header")?.sensitive).toBe(true);
  });

  it("reads a tab-separated file and an empty one", () => {
    expect(val(run("tsv", "a\tb\n1\t2"), "Delimiter")).toBe("tab");
    expect(val(run("tsv", "a\tb\n1\t2"), "Columns")).toBe("2");
    expect(run("csv", "").fields.filter((f) => f.group === "Data")).toHaveLength(0);
  });

  it("caps a very wide header", () => {
    const wide = Array.from({ length: 40 }, (_, i) => `col${i}`).join(",");
    expect(val(run("csv", wide), "Header")?.split(", ")).toHaveLength(24);
  });
});

describe("meta/text RTF", () => {
  it("reads the author block, the timestamps and the counts", () => {
    const rtf = String.raw`{\rtf1\ansi{\info{\title Budget}{\subject FY25}{\author Dana Whitfield}` +
      String.raw`{\manager R. Alvarez}{\company Northgate Ltd}{\operator m.okafor}{\category Internal}` +
      String.raw`{\keywords budget, draft}{\comment none}{\doccomm reviewed}` +
      String.raw`{\creatim\yr2024\mo3\dy2\hr10\min15}{\revtim\yr2024\mo3\dy9\hr8\min5}` +
      String.raw`{\printim\yr2024\mo3\dy4\hr12\min0}{\*\generator Riched20 10.0.19041}` +
      String.raw`\vern61\edmins184\nofpages12\nofwords3120}\objdata }`;
    const r = run("rtf", rtf);
    expect(val(r, "Title")).toBe("Budget");
    expect(val(r, "Subject")).toBe("FY25");
    expect(val(r, "Author")).toBe("Dana Whitfield");
    expect(val(r, "Manager")).toBe("R. Alvarez");
    expect(val(r, "Company")).toBe("Northgate Ltd");
    expect(val(r, "Last saved by")).toBe("m.okafor");
    expect(val(r, "Category")).toBe("Internal");
    expect(val(r, "Keywords")).toBe("budget, draft");
    expect(val(r, "Document comment")).toBe("reviewed");
    expect(val(r, "Created")).toBe("2024-03-02 10:15");
    expect(val(r, "Modified")).toBe("2024-03-09 08:05");
    expect(val(r, "Last printed")).toBe("2024-03-04 12:00");
    expect(val(r, "Generator")).toBe("Riched20 10.0.19041");
    expect(val(r, "Total editing time")).toBe("184 minutes");
    expect(val(r, "Internal version")).toBe("61");
    expect(val(r, "Pages")).toBe("12");
    expect(val(r, "Words")).toBe("3120");
    expect(val(r, "Embedded objects")).toBe("present");
    expect(r.fields.find((f) => f.label === "Author")?.sensitive).toBe(true);
  });

  it("defaults the parts of a timestamp a document leaves out", () => {
    expect(val(run("rtf", String.raw`{\rtf1{\creatim\yr2024}}`), "Created")).toBe("2024-01-01 00:00");
  });

  it("reads a document that states none of it", () => {
    const r = run("rtf", String.raw`{\rtf1\ansi Plain body text.}`);
    expect(r.fields.filter((f) => f.group === "Document")).toHaveLength(0);
    expect(val(r, "Created")).toBeUndefined();
    expect(val(r, "Embedded objects")).toBeUndefined();
  });

  it("ignores a timestamp group with no year at all", () => {
    expect(val(run("rtf", String.raw`{\rtf1{\creatim\mo3\dy2}}`), "Created")).toBeUndefined();
  });
});

describe("meta/text email messages", () => {
  const message = [
    "Return-Path: <bounce@mail.example.net>",
    "Received: from relay2.example.net by mx.example.org; Sat, 2 Mar 2024 10:15:00 +0000",
    "Received: from workstation.corp.example.net by relay2.example.net; Sat, 2 Mar 2024 10:14:58 +0000",
    "Received-SPF: pass (example.net: domain permits)",
    "DKIM-Signature: v=1; a=rsa-sha256; d=example.net; s=sel1; h=from:to",
    "From: Dana Whitfield <dana@example.net>",
    "To: ops@example.org, security@example.org",
    "Cc: audit@example.org",
    "Reply-To: dana.w@example.net",
    "Subject: Quarterly results,",
    " continued",
    "Date: Sat, 2 Mar 2024 10:14:55 +0000",
    "Message-ID: <a1b2@workstation.corp.example.net>",
    "In-Reply-To: <prev@example.org>",
    "X-Mailer: Microsoft Outlook 16.0",
    "X-Originating-IP: [203.0.113.44]",
    'Content-Type: multipart/mixed; boundary="b1"',
    "",
    "--b1",
    'Content-Disposition: attachment; filename="results.xlsx"',
    "--b1",
    'Content-Disposition: attachment; filename="notes.txt"',
  ].join("\r\n");

  it("reads the sender, recipients, client and delivery path", () => {
    const r = run("eml", message);
    expect(val(r, "From")).toBe("Dana Whitfield <dana@example.net>");
    expect(val(r, "To")).toBe("ops@example.org, security@example.org");
    expect(val(r, "Cc")).toBe("audit@example.org");
    expect(val(r, "Reply to")).toBe("dana.w@example.net");
    expect(val(r, "Return path")).toBe("<bounce@mail.example.net>");
    expect(val(r, "Subject")).toBe("Quarterly results, continued"); // the folded line is joined
    expect(val(r, "Message id")).toBe("<a1b2@workstation.corp.example.net>");
    expect(val(r, "In reply to")).toBe("<prev@example.org>");
    expect(val(r, "Mail client")).toBe("Microsoft Outlook 16.0");
    expect(val(r, "Originating IP")).toBe("[203.0.113.44]");
    expect(val(r, "Delivery hops")).toBe("2");
    expect(val(r, "DKIM signing domain")).toBe("example.net");
    expect(val(r, "SPF result")).toBe("pass");
    expect(val(r, "Attachments")).toBe("results.xlsx, notes.txt");
    expect(r.fields.find((f) => f.label === "From")?.sensitive).toBe(true);
  });

  it("keeps the first client header when a message carries two", () => {
    const both = "Message-ID: <x@y>\r\nX-Mailer: Outlook\r\nUser-Agent: Thunderbird\r\n\r\nbody";
    const r = run("eml", both);
    expect(r.fields.filter((f) => f.label === "Mail client")).toHaveLength(1);
    expect(val(r, "Mail client")).toBe("Outlook");
  });

  it("reads a bare message without inventing headers it lacks", () => {
    const r = run("eml", "From: a@b\r\n\r\nbody");
    expect(val(r, "From")).toBe("a@b");
    expect(val(r, "Delivery hops")).toBeUndefined();
    expect(val(r, "DKIM signing domain")).toBeUndefined();
    expect(val(r, "SPF result")).toBeUndefined();
    expect(val(r, "Attachments")).toBeUndefined();
  });

  it("ignores a header that is present but empty", () => {
    expect(val(run("eml", "From:\r\nMessage-ID: <x@y>\r\n\r\nbody"), "From")).toBeUndefined();
  });

  it("caps a long attachment list", () => {
    const many = Array.from({ length: 15 }, (_, i) => `Content-Disposition: attachment; filename="f${i}.txt"`).join("\r\n");
    expect(val(run("eml", `From: a@b\r\n\r\n${many}`), "Attachments")?.split(", ")).toHaveLength(10);
  });
});

describe("meta/text scripts", () => {
  it("names the interpreter a script asks for", () => {
    expect(val(run("script", "#!/bin/bash\necho hi"), "Interpreter")).toBe("/bin/bash");
    expect(val(run("script", "#!/usr/bin/env python3\nprint(1)"), "Interpreter")).toBe("/usr/bin/env python3");
    expect(val(run("script", "no shebang here"), "Interpreter")).toBeUndefined();
  });
});

describe("meta/sniff recognises a saved email", () => {
  it("identifies a message by the headers only a transported one carries", () => {
    const eml = "Return-Path: <a@b>\r\nFrom: a@b\r\nSubject: hi\r\n\r\nbody";
    expect(sniff(new TextEncoder().encode(eml)).kind).toBe("eml");
    expect(sniff(new TextEncoder().encode(eml)).mime).toBe("message/rfc822");
  });

  it("does not call an ordinary document mail because a line has a colon", () => {
    const notes = "From: my notes\r\nToday I wrote some things.\r\n";
    expect(sniff(new TextEncoder().encode(notes)).kind).toBe("text");
  });
});
