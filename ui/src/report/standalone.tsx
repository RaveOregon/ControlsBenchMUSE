// Standalone, shareable bench report: one self-contained HTML file rendered from the same
// component as the in-app report. Styles and the selected verified images are embedded, so it
// stays readable after the local server stops. It carries no host URLs, secrets or local paths
// (the bundle is scrubbed by its producer) and only a small fixed script for printing, evidence
// links and image enlargement. Report content is rendered as escaped text.

import { renderToStaticMarkup } from "react-dom/server";
import { scrubLocalPaths, type ReportBundle } from "../../../src/report/bundle.ts";
import { BenchReport } from "./BenchReport.tsx";
import reportCss from "./bench-report.css?raw";
import { buildReportView, fmtTime, safeImageSrc } from "./view-model.ts";

// Mirrors the application's colour tokens (ui/src/styles.css) for a standalone document.
const TOKENS = `
:root { color-scheme: dark; --bg: #0f1216; --panel: #161b21; --panel-2: #1c232b; --line: #2a333d; --line-strong: #3a4552; --text: #e6eaef; --text-2: #a9b3be;
  --text-3: #76818d; --accent: #5aa9ff; --ok: #3ccf8e; --warn: #f2b33d; --bad: #ff6b6b; --reason: #b48cff; --wait: #4fc3d9; --replay: #f2b33d; --live: #3ccf8e;
  --mono: "Cascadia Mono", "JetBrains Mono", Consolas, ui-monospace, monospace; --sans: "Segoe UI", system-ui, -apple-system, sans-serif; --radius: 8px; }
@media (prefers-color-scheme: light) { :root { color-scheme: light; --bg: #f3f5f7; --panel: #ffffff; --panel-2: #f7f9fb; --line: #dde3e9; --line-strong: #c4ccd5;
  --text: #17202a; --text-2: #4a5662; --text-3: #6b7785; --accent: #1f6fd1; --ok: #13895a; --warn: #a3650f; --bad: #c93636; --reason: #7a4fd6; --wait: #11829a; --replay: #a3650f; --live: #13895a; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
main { max-width: 1240px; margin: 0 auto; padding: 28px 24px 48px; }
.btn { border: 1px solid var(--line-strong); background: var(--panel-2); color: var(--text); border-radius: 6px; padding: 6px 12px; cursor: pointer; font: inherit; }
@page { margin: 14mm 12mm; }
@media print {
  :root { color-scheme: light; --bg: #fff; --panel: #fff; --panel-2: #fff; --line: #c9cfd6; --line-strong: #9aa4ae; --text: #111; --text-2: #333; --text-3: #555;
    --accent: #0b57b0; --ok: #0b6e45; --warn: #8a5300; --bad: #b02020; --reason: #5b34b0; --wait: #0b6878; --replay: #8a5300; --live: #0b6e45; }
  main { max-width: none; padding: 0; }
}`;

// Fixed behaviour only: open the details that hold an evidence anchor, expand details before
// printing (and restore after), print button, image enlargement. No data is read or sent.
const SCRIPT = `(function(){
  function reveal(hash){ var el = hash && document.getElementById(decodeURIComponent(hash.slice(1))); if(!el) return;
    for (var d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
    el.scrollIntoView({block:'center'}); el.classList.add('br-flash'); setTimeout(function(){ el.classList.remove('br-flash'); }, 1600); }
  window.addEventListener('hashchange', function(){ reveal(location.hash); });
  if (location.hash) reveal(location.hash);
  var opened = [];
  window.addEventListener('beforeprint', function(){ document.querySelectorAll('details[data-print-open]').forEach(function(d){ if(!d.open){ d.open = true; opened.push(d); } }); });
  window.addEventListener('afterprint', function(){ opened.forEach(function(d){ d.open = false; }); opened = []; });
  document.addEventListener('click', function(e){
    if (e.target.closest('[data-action="print"]')) { window.print(); return; }
    var t = e.target.closest('.br-thumb'); if (t) t.classList.toggle('expanded');
  });
})();`;

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export interface StandaloneOptions {
  /** Replace any non-embedded image with this resolver's data URI (e.g. a host frame fetched and hash-checked by the caller). */
  inlineMedia?: Record<string, string>;
}

/** Renders a complete, self-contained HTML document for a report bundle. */
export function renderStandaloneReport(input: ReportBundle, options: StandaloneOptions = {}): string {
  const bundle = scrubLocalPaths(input);
  // Only embedded data is portable: host URLs are replaced by caller-supplied verified data or a placeholder.
  const media = Object.fromEntries(Object.entries(bundle.media).map(([sha, m]) => {
    const inline = safeImageSrc(options.inlineMedia?.[sha]);
    if (inline?.startsWith("data:")) return [sha, { ...m, status: "embedded" as const, dataUri: inline, url: undefined, note: "Embedded at export; SHA-256 verified against the ledger" }];
    if (m.status === "url") return [sha, { ...m, status: "missing" as const, url: undefined, note: "Image was not embedded at export; it remains on the host that recorded it" }];
    return [sha, m];
  }));
  const view = buildReportView({ ...bundle, media });
  const toolbar = <><button type="button" className="btn" data-action="print">Print / Save as PDF</button>
    <span className="muted">Standalone copy generated {fmtTime(bundle.generatedAtIso)}. Evidence links point into this document's appendix.</span></>;
  const body = renderToStaticMarkup(<main><BenchReport view={view} mode="standalone" toolbar={toolbar} /></main>);
  const title = `${view.title} — ${view.campaignId}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="ControlsBench Muse bench report (${escapeAttr(bundle.schemaVersion)})">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeAttr(title).replace(/>/g, "&gt;")}</title>
<style>${TOKENS}
${reportCss}</style>
</head>
<body>
${body}
<script>${SCRIPT}</script>
</body>
</html>
`;
}
