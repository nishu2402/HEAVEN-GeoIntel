"use client";

import { useState } from "react";
import { FileText, Download } from "lucide-react";
import type { LookupResponse } from "@/lib/types";
import { BRAND, asciiLetterhead, logoSvg } from "@/lib/brand/logo";

interface Props {
  data: LookupResponse;
}

function val(v: unknown): string {
  if (v === null || v === undefined) return "N/A";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ") || "N/A";
  return String(v);
}

/**
 * @param letterhead Render the ASCII brand mark above the title. On for the
 *   standalone .txt export; off for the HTML export, which shows the real SVG
 *   mark in its masthead and would otherwise carry the identity twice.
 */
function generateTextReport(data: LookupResponse, letterhead = true): string {
  const { input, aggregated, analysis, sources, threatScore, threatLabel } = data;
  const now = new Date().toISOString();
  const separator = "─".repeat(70);
  const fc = sources.fullContact.ok ? sources.fullContact.data : null;
  const bd = sources.breachDirectory.ok ? sources.breachDirectory.data : null;

  const sourceStatus = [
    `  libphonenumber-js : ACTIVE (offline, always available)`,
    `  NumVerify         : ${sources.numverify.ok ? "ACTIVE" : sources.numverify.error === "NOT_CONFIGURED" ? "NOT CONFIGURED" : `ERROR — ${sources.numverify.error}`}`,
    `  IPQualityScore    : ${sources.ipqs.ok ? "ACTIVE" : sources.ipqs.error === "NOT_CONFIGURED" ? "NOT CONFIGURED" : `ERROR — ${sources.ipqs.error}`}`,
    `  AbstractAPI       : ${sources.abstract.ok ? "ACTIVE" : sources.abstract.error === "NOT_CONFIGURED" ? "NOT CONFIGURED" : `ERROR — ${sources.abstract.error}`}`,
    `  Twilio Lookup     : ${sources.twilio.ok ? "ACTIVE" : sources.twilio.error === "NOT_CONFIGURED" ? "NOT CONFIGURED" : `ERROR — ${sources.twilio.error}`}`,
    `  BreachDirectory   : ${sources.breachDirectory.ok ? "ACTIVE" : sources.breachDirectory.error === "NOT_CONFIGURED" ? "NOT CONFIGURED" : `ERROR — ${sources.breachDirectory.error}`}`,
    `  FullContact       : ${sources.fullContact.ok ? "ACTIVE" : sources.fullContact.error === "NOT_CONFIGURED" ? "NOT CONFIGURED" : `ERROR — ${sources.fullContact.error}`}`,
  ].join("\n");

  const npa = analysis.npaInfo;

  const title = `${BRAND.name} — Phone Intelligence Report`;
  const head = letterhead
    ? [asciiLetterhead([
        title,
        BRAND.tagline,
        "",
        `Generated   : ${now}`,
        `Threat Score: ${threatScore}/100 — ${threatLabel}`,
      ])]
    : [
        title,
        `Generated   : ${now}`,
        `Threat Score: ${threatScore}/100 — ${threatLabel}`,
      ];

  const lines = [
    ...head,
    separator,
    ``,
    `TARGET NUMBER`,
    separator,
    `  E.164 (canonical)  : ${input.e164}`,
    `  International      : ${aggregated.formatInternational}`,
    `  National           : ${aggregated.formatNational}`,
    `  RFC 3966           : ${aggregated.formatRfc3966}`,
    `  Valid              : ${val(input.isValid)}`,
    `  Possible           : ${val(input.isPossible)}`,
    ``,
    `GEOGRAPHIC INTELLIGENCE`,
    separator,
    `  Country            : ${aggregated.countryName} (${aggregated.country})`,
    `  Calling Code       : ${input.countryCallingCode}`,
    ...(npa ? [
      `  State / Province   : ${npa.state} (${npa.stateAbbr})`,
      `  Metro / Region     : ${npa.region}`,
      `  Area Code (NPA)    : ${analysis.nationalNumber.slice(0, 3)}`,
    ] : []),
    ...(aggregated.region && aggregated.region !== aggregated.city ? [`  Region (API)       : ${aggregated.region}`] : []),
    ...(aggregated.city                                   ? [`  City (API)         : ${aggregated.city}`]   : []),
    `  Timezone           : ${aggregated.timezone?.[0] ?? (npa?.timezone ?? "N/A")}${aggregated.utcOffsets?.[0] ? ` (${aggregated.utcOffsets[0]})` : ""}`,
    ``,
    `NUMBER CLASSIFICATION`,
    separator,
    `  Line Type          : ${val(aggregated.lineType)}`,
    `  Type Description   : ${val(aggregated.typeDescription)}`,
    `  Ambiguous Type     : ${val(aggregated.isAmbiguousType)} ${aggregated.isAmbiguousType ? "(mobile/landline unresolvable from number structure)" : ""}`,
    `  Confirmed Mobile   : ${val(aggregated.isMobile)}`,
    `  Confirmed Fixed    : ${val(aggregated.isFixedLine)}`,
    `  VoIP               : ${val(aggregated.isVoip)}`,
    `  Toll-Free          : ${val(analysis.isTollFree)}`,
    `  Premium Rate       : ${val(analysis.isPremiumRate)}`,
    ``,
    `CARRIER / NETWORK`,
    separator,
    `  Carrier            : ${val(aggregated.carrier)}`,
    `  Prepaid            : ${val(aggregated.prepaid)}`,
    `  Line Active        : ${val(aggregated.active)}`,
    `  Active Status      : ${val(aggregated.activeStatus)}`,
    `  User Activity      : ${val(aggregated.userActivity)}`,
    `  MCC / MNC          : ${aggregated.mobileCountryCode && aggregated.mobileNetworkCode ? `${aggregated.mobileCountryCode} / ${aggregated.mobileNetworkCode}` : "N/A"}`,
    ``,
    `CALLER IDENTITY`,
    separator,
    `  Owner / CNAM       : ${val(aggregated.callerName)}`,
    `  Caller Type        : ${val(aggregated.callerType)}`,
    `  Associated Emails  : ${val(aggregated.associatedEmails)}`,
    ``,
    `IDENTITY ENRICHMENT — FullContact`,
    separator,
    ...(fc ? [
      `  Full Name          : ${val(fc.fullName)}`,
      `  Title              : ${val(fc.title)}`,
      `  Organization       : ${val(fc.organization)}`,
      `  Location           : ${val(fc.location)}`,
      `  Bio                : ${val(fc.bio)}`,
      `  Age                : ${val(fc.age)}`,
      `  Gender             : ${val(fc.gender)}`,
      `  Linked Emails      : ${val(fc.otherEmails)}`,
      `  Linked Phones      : ${val(fc.phones)}`,
      `  Social Profiles    : ${fc.profiles.length > 0 ? fc.profiles.map((p) => `${p.platform}:${p.username || p.url}`).join(", ") : "N/A"}`,
      ...(fc.employment.length > 0 ? [
        `  Employment:`,
        ...fc.employment.map((e) => `    ${e.current ? "[CURRENT]" : "[PAST]"} ${e.name}${e.title ? ` — ${e.title}` : ""}`),
      ] : []),
    ] : [
      `  Status             : ${sources.fullContact.error === "NOT_CONFIGURED" ? "NOT CONFIGURED — add FULLCONTACT_API_KEY" : sources.fullContact.error === "NOT_FOUND" ? "No record found" : (sources.fullContact.error ?? "N/A")}`,
    ]),
    ``,
    `BREACH DATABASE — BreachDirectory`,
    separator,
    ...(bd && bd.found > 0 ? [
      `  Records Found      : ${bd.found}`,
      `  Sources            : ${bd.sources.join(", ") || "N/A"}`,
      ``,
      `  CREDENTIAL LIST:`,
      ...bd.results.slice(0, 20).map((r, i) => [
        `    [${i + 1}] Sources : ${r.sources.join(", ") || "—"}`,
        r.password ? `         Partial : ${r.password}` : "",
        r.sha1     ? `         SHA-1   : ${r.sha1}` : "",
        r.hash     ? `         MD5     : ${r.hash}` : "",
      ].filter(Boolean).join("\n")),
    ] : [
      `  Status             : ${sources.breachDirectory.error === "NOT_CONFIGURED" ? "NOT CONFIGURED — add RAPIDAPI_KEY" : bd && bd.found === 0 ? "CLEAN — no credential records found" : (sources.breachDirectory.error ?? "N/A")}`,
    ]),
    ``,
    `RISK INTELLIGENCE`,
    separator,
    `  Fraud Score        : ${aggregated.fraudScore !== null ? `${aggregated.fraudScore}/100` : "N/A"}`,
    `  High Risk          : ${val(aggregated.isRisky)}`,
    `  Recent Abuse       : ${val(aggregated.recentAbuse)}`,
    `  VoIP               : ${val(aggregated.isVoip)}`,
    `  Disposable         : ${val(aggregated.isDisposable)}`,
    ``,
    `NUMBER STRUCTURE`,
    separator,
    `  Area Code          : ${val(analysis.areaCode)}`,
    `  Subscriber         : ${val(analysis.subscriberNumber)}`,
    `  Carrier Prefix     : ${val(aggregated.carrierPrefix)}`,
    `  Digit Count        : ${val(aggregated.numberLength)}`,
    `  Expected Length    : ${analysis.expectedLengths.length > 0 ? analysis.expectedLengths.join(" or ") : "N/A"}`,
    ``,
    `DATA SOURCES`,
    separator,
    sourceStatus,
    ``,
    separator,
    `Report generated by HEAVEN-GeoIntel — for authorized use only.`,
    `All intelligence should be verified before use in assessments.`,
  ];

  return lines.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function generateHtmlReport(data: LookupResponse): string {
  const escaped = esc(generateTextReport(data, false));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${BRAND.name} Report — ${esc(data.input.e164)}</title>
<style>
  body { background: #05060d; color: #d6ffe6; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
         padding: 40px 24px; max-width: 960px; margin: 0 auto; }
  .masthead { display: flex; align-items: center; gap: 18px; padding-bottom: 18px; margin-bottom: 26px;
              border-bottom: 1px solid rgba(0, 255, 133, 0.22); }
  .masthead h1 { margin: 0; font-size: 15px; letter-spacing: .28em; text-transform: uppercase; color: ${BRAND.green}; }
  .masthead p  { margin: 5px 0 0; font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: #7fae93; }
  pre { white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.7; margin: 0; }
  /* Printed on paper the neon inverts to ink; the mark keeps its own colours. */
  @media print {
    body { background: #fff; color: #10151f; padding: 0; max-width: none; }
    .masthead h1 { color: #10151f; }
    .masthead p { color: #4a5b53; }
    @page { margin: 14mm; }
  }
</style>
</head>
<body>
<header class="masthead">
${logoSvg({ size: 54, idPrefix: "rpt" })}
<div>
  <h1>${BRAND.name}</h1>
  <p>${BRAND.tagline} — Intelligence Report</p>
</div>
</header>
<pre>${escaped}</pre>
</body>
</html>`;
}

export default function ReportExport({ data }: Props) {
  const [exported, setExported] = useState<"text" | "html" | null>(null);

  const downloadText = () => {
    const content = generateTextReport(data);
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `geointel_${data.input.e164.replace(/\D/g, "")}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setExported("text");
    setTimeout(() => setExported(null), 2000);
  };

  const downloadHtml = () => {
    const content = generateHtmlReport(data);
    const blob = new Blob([content], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `geointel_${data.input.e164.replace(/\D/g, "")}_${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
    setExported("html");
    setTimeout(() => setExported(null), 2000);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={downloadText}
        className="flex items-center gap-1.5 text-xs border border-[#00ff41]/30 px-3 py-1.5 text-[#00ff41]/70 hover:text-[#00ff41] hover:border-[#00ff41]/60 transition-colors font-mono"
      >
        <FileText className="w-3 h-3" />
        {exported === "text" ? "SAVED" : "EXPORT TXT REPORT"}
      </button>
      <button
        onClick={downloadHtml}
        className="flex items-center gap-1.5 text-xs border border-[#00d9ff]/30 px-3 py-1.5 text-[#00d9ff]/70 hover:text-[#00d9ff] hover:border-[#00d9ff]/60 transition-colors font-mono"
      >
        <Download className="w-3 h-3" />
        {exported === "html" ? "SAVED" : "EXPORT HTML REPORT"}
      </button>
    </div>
  );
}
