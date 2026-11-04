// Results destination: the engineer-facing bench report for the current host campaign, or for a
// saved report bundle the engineer opens. Downloads keep the authoritative JSON report and the full
// ledger alongside the standalone HTML. Recorded qualification history stays separate and collapsed.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { REPORT_BUNDLE_VERSION, scrubLocalPaths, type ReportBundle } from "../../../src/report/bundle.ts";
import { BenchReport } from "../report/BenchReport.tsx";
import { buildReportView, safeImageSrc } from "../report/view-model.ts";
import "../report/bench-report.css";
import type { WorkspaceState } from "../model/workspace-store.ts";

export interface HostReportLinks { bundleUrl: string; reportUrl: string; ledgerUrl: string }
type Loaded = { bundle?: ReportBundle; error?: string; loading: boolean };

const TERMINAL = ["completed", "stopped", "failed"];
const REFRESH_MS = 15_000;

function checkBundle(value: unknown): ReportBundle {
  const b = value as ReportBundle;
  if (!b || typeof b !== "object" || b.schemaVersion !== REPORT_BUNDLE_VERSION || typeof b.report?.campaignId !== "string" || !Array.isArray(b.report.experiments)
    || !Array.isArray(b.report.findings) || typeof b.evidence !== "object" || !b.ledger || !b.hmi) throw new Error(`Not a ${REPORT_BUNDLE_VERSION} report bundle`);
  return b;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
}
function base64(bytes: ArrayBuffer): string {
  let s = ""; const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) s += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(s);
}
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Builds the shareable HTML: host frames are fetched only from vetted host routes and kept only when their hash matches. */
async function exportHtml(bundle: ReportBundle, links?: HostReportLinks): Promise<void> {
  const inlineMedia: Record<string, string> = {};
  for (const m of Object.values(bundle.media)) {
    const src = m.status === "url" ? safeImageSrc(m.url) : undefined;
    if (!src || !m.contentType || !/^image\/(jpeg|png)$/.test(m.contentType)) continue;
    const response = await fetch(src);
    if (!response.ok) continue;
    const bytes = await response.arrayBuffer();
    if (await sha256Hex(bytes) === m.sha256) inlineMedia[m.sha256] = `data:${m.contentType};base64,${base64(bytes)}`;
  }
  let shareable = bundle;
  if (links && bundle.context.kind === "host_current") {
    const response = await fetch(links.reportUrl);
    if (response.ok) {
      const bytes = await response.arrayBuffer();
      shareable = { ...bundle, sources: [...bundle.sources, { file: "report.json", role: "Structured campaign report as served by the host at export", sha256: await sha256Hex(bytes),
        byteLength: bytes.byteLength, embeddedBase64: base64(bytes), contentType: "application/json" }] };
    }
  }
  const { renderStandaloneReport } = await import("../report/standalone.tsx");
  download(`controlsbench-report-${bundle.report.campaignId}.html`, renderStandaloneReport(scrubLocalPaths(shareable), { inlineMedia }), "text/html");
}

/** Opens `details[data-print-open]` in the report while printing, then restores them; lazy screenshots load first. */
function usePrintExpansion() {
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      document.querySelectorAll<HTMLImageElement>(".bench-report img[loading=lazy]").forEach(i => { i.loading = "eager"; });
      opened = [...document.querySelectorAll<HTMLDetailsElement>(".bench-report details[data-print-open]")].filter(d => !d.open); opened.forEach(d => { d.open = true; });
    };
    const after = () => { opened.forEach(d => { d.open = false; }); opened = []; };
    window.addEventListener("beforeprint", before); window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);
}

export function ResultsPage({ state, links, open, fallback, historical }: { state: WorkspaceState; links?: HostReportLinks; open?: { url: string; title: string; nonce: number }; fallback: ReactNode; historical: ReactNode }) {
  usePrintExpansion();
  const hosted = links ? state.hosted : undefined;
  const status = hosted?.projection?.status;
  const finalized = Boolean(status && TERMINAL.includes(status));
  const [host, setHost] = useState<Loaded>({ loading: false });
  const [saved, setSaved] = useState<{ name: string; bundle?: ReportBundle; error?: string }>();
  const [busy, setBusy] = useState<string>();

  const load = useCallback(async () => {
    if (!links) return;
    setHost(h => ({ ...h, loading: true }));
    try {
      const response = await fetch(links.bundleUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 404 ? "No campaign on the host yet" : `Host returned ${response.status}`);
      setHost({ bundle: checkBundle(await response.json()), loading: false });
    } catch (error) { setHost(h => ({ ...h, error: String(error instanceof Error ? error.message : error), loading: false })); }
  }, [links]);
  // Reload when the campaign changes or finalizes; while running, refresh at a modest cadence.
  useEffect(() => { if (hosted?.campaignId) void load(); }, [hosted?.campaignId, finalized, load]);
  useEffect(() => {
    if (!hosted?.campaignId || finalized) return;
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [hosted?.campaignId, finalized, load]);

  const active = saved?.bundle ?? (host.bundle?.report.campaignId === hosted?.campaignId ? host.bundle : undefined);
  const view = useMemo(() => {
    if (!active) return undefined;
    try { return { view: buildReportView(active) }; } catch (error) { return { error: String(error) }; }
  }, [active]);

  // A project's archived run report, served by this host's project API only.
  useEffect(() => {
    if (!open || !open.url.startsWith("/api/projects/")) return;
    fetch(open.url, { cache: "no-store" }).then(r => r.ok ? r.json() : Promise.reject(new Error(`Host returned ${r.status}`)))
      .then(b => setSaved({ name: open.title, bundle: checkBundle(b) }), e => setSaved({ name: open.title, error: `${open.title}: ${(e as Error).message}` }));
  }, [open]);
  const openFile = async (file: File) => {
    try { setSaved({ name: file.name, bundle: checkBundle(JSON.parse(await file.text())) }); }
    catch (error) { setSaved({ name: file.name, error: `${file.name} is not a readable bench report bundle (${error instanceof Error ? error.message : String(error)}).` }); }
  };
  const run = (label: string, task: () => Promise<void>) => { setBusy(label); task().catch(error => alert(`Export failed: ${error}`)).finally(() => setBusy(undefined)); };

  const toolbar = active && <>
    <button type="button" className="btn primary" disabled={Boolean(busy)} onClick={() => run("html", () => exportHtml(active, saved?.bundle ? undefined : links))}>{busy === "html" ? "Preparing HTML…" : "Download HTML report"}</button>
    <button type="button" className="btn" onClick={() => window.print()}>Print / Save as PDF</button>
    {!saved?.bundle && links && <>
      <a className="btn" href={links.reportUrl} download={`controlsbench-${active.report.evidenceClass ?? "campaign"}-${active.report.campaignId}.json`}>Download JSON report</a>
      <a className="btn" href={links.ledgerUrl} download>Download full ledger (JSONL)</a>
      <button type="button" className="btn" disabled={host.loading} onClick={() => void load()}>{host.loading ? "Refreshing…" : "Refresh"}</button>
    </>}
    {saved?.bundle && <button type="button" className="btn" onClick={() => setSaved(undefined)}>Close saved report</button>}
  </>;
  const opener = <label className="btn no-print" title="Open a report-bundle.json exported by scripts/export-bench-report.js">Open saved report…<input type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ""; }} /></label>;

  return <>
    {saved && <div className="source-notice no-print" role="status">{saved.bundle ? <><b>Viewing saved report {saved.name}.</b> This is a historical record opened from a file, not the host's current campaign.</> : saved.error}</div>}
    {view?.view ? <BenchReport view={view.view} mode="app" toolbar={<>{toolbar}{opener}</>} />
      : <>
        <div className="page-heading"><div><div className="eyebrow">Results</div><h1>Bench test report</h1>
          <p>{hosted ? (host.error ? `Report unavailable: ${host.error}.` : "Loading the campaign report…") : links ? "No campaign yet. Start a campaign; its report appears here." : "This workspace has no host campaign report. Its own recorded checks are below, or open a saved report."}</p>
          {view?.error && <p className="verdict-fail">Report could not be displayed: {view.error}</p>}</div>{opener}</div>
        {!links && fallback}
      </>}
    {historical}
  </>;
}
