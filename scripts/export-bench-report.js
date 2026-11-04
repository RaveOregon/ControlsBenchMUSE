// Offline bench report export from a saved campaign directory.
//
//   node scripts/export-bench-report.js <campaign-directory> --out <directory> [--title "W4 adaptive PLC investigation"] [--diagnostics]
//
// Reads only the bounded allowlist in src/report/saved-campaign.ts (report, ledger, separate
// audit/review files, model exchange lineage, ledger-named vision frames) and never writes into
// the evidence directory. Writes report.html (standalone: styles and verified images embedded)
// and report-bundle.json (the same data, which Results > Open saved report can display).
// --diagnostics adds the evidence directory relative to the current folder; leave it off for sharing.
// The renderer is the portal's own React component, loaded through the UI's Vite module runner.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadSavedCampaign } from "../src/report/saved-campaign.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  out: { type: "string" }, title: { type: "string" }, diagnostics: { type: "boolean", default: false }
} });
if (positionals.length !== 1 || !values.out) {
  console.error("usage: node scripts/export-bench-report.js <campaign-directory> --out <directory> [--title <text>] [--diagnostics]");
  process.exit(2);
}
const source = resolve(positionals[0]), out = resolve(values.out);
if (out === source || out.startsWith(source + sep)) throw new Error("Refusing to write inside the evidence directory");

const started = Date.now();
const bundle = loadSavedCampaign(source, { title: values.title, diagnosticsBase: values.diagnostics ? process.cwd() : undefined });
const uiRoot = fileURLToPath(new URL("../ui/", import.meta.url));
const vite = await import(pathToFileURL(join(uiRoot, "node_modules/vite/dist/node/index.js")).href);
const { module } = await vite.runnerImport(join(uiRoot, "src/report/standalone.tsx"), { root: uiRoot, logLevel: "error" });
const html = module.renderStandaloneReport(bundle);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "report.html"), html);
writeFileSync(join(out, "report-bundle.json"), JSON.stringify(bundle, null, 2) + "\n");
const media = Object.values(bundle.media);
console.log(JSON.stringify({
  campaignId: bundle.report.campaignId, status: bundle.report.status, evidenceClass: bundle.report.evidenceClass, out,
  reportMatchesLedgerReconstruction: bundle.reportIntegrity.matchesLedgerReconstruction,
  htmlBytes: Buffer.byteLength(html), embeddedImages: media.filter(m => m.status === "embedded").length,
  missingImages: media.filter(m => m.status !== "embedded").length, attachments: bundle.attachments.map(a => `${a.file}:${a.status}`),
  elapsedMs: Date.now() - started
}, null, 2));
