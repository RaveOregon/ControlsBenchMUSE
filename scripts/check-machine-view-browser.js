// Real-browser check of the isolated view host: loads the package srcdoc in a sandboxed iframe
// inside headless Chrome, drives recorded snapshots through the actual runtime, records the
// protocol result, screenshots each scenario, and probes that injected markup script cannot
// run under the CSP. No model call, network or PLC.
//
//   node scripts/check-machine-view-browser.js --package <dir> [--out <dir>]
//   node scripts/check-machine-view-browser.js --fixture --out <dir>
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch } from "./lib/chrome.js";
import { buildSnapshot, resolveFrame } from "../src/machine-view/frame.ts";
import { assemblePackage } from "../src/machine-view/generation.ts";
import { buildSrcdoc, randomToken } from "../src/machine-view/host.ts";
import { jsonText, validatePackage } from "../src/machine-view/package.ts";
import { replaySnapshots } from "../src/machine-view/replay.ts";

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

const contract = JSON.parse(await readFile(resolve("artifacts/machine-view/contract/binding-contract.json"), "utf8"));
const worldDir = JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8")).relativeDirectory;
const worldManifestText = await readFile(resolve(worldDir, "world.manifest.json"), "utf8");
let files;
let label;
if (process.argv.includes("--fixture")) {
  const { fixtureView } = await import("../test/fixtures/machine-view/fixture-view.ts");
  const equipmentText = await readFile(resolve("artifacts/machine-view/contract/equipment.json"), "utf8");
  files = (await assemblePackage({ equipmentText, contract, generated: fixtureView(JSON.parse(equipmentText), contract), provenance: { model: "test-fixture", responseId: null, generatedAt: null } })).files;
  label = "test fixture";
} else {
  const dir = resolve(arg("--package") ?? "");
  files = {};
  for (const name of ["view.manifest.json", "equipment.json", "view-bindings.json", "view.svg"]) {
    const text = await readFile(join(dir, name), "utf8").catch(() => undefined);
    if (text !== undefined) files[name] = text;
  }
  label = dir;
}
const outDir = resolve(arg("--out") ?? (process.argv.includes("--fixture") ? await mkdtemp(join(tmpdir(), "cb-view-")) : join(resolve(arg("--package")), "browser-check")));
await mkdir(outDir, { recursive: true });

const { report, pkg } = await validatePackage({ files, contract, worldManifestText });
if (!report.viewValid) throw new Error(`Package is not view-valid: ${report.errors.join("; ")}`);

const trace = JSON.parse(await readFile(resolve(worldDir, "gate-b-trace.json"), "utf8"));
const replay = (runLabel) => replaySnapshots(trace.runs.find(r => r.label === runLabel), { packageId: pkg.manifest.packageId, channels: contract.channels, evidenceClass: "surrogate_contract" });
const routedA = replay("cp5-routed-a");
const routedB = replay("cp6-routed-b");
const runout = replay("cp6-runout");
const firstWhere = (frames, test) => frames.find(f => f.entities.items.some(test));
const scenarios = [
  { id: "01-no-data", note: "before any snapshot: every bound element unknown", snapshots: [] },
  { id: "02-a-approach", note: "Gate B cp5-routed-a, carton approaching divert 1 with D1 extended", snapshots: [firstWhere(routedA, e => e.state.path === "main" && e.state.positionM > 1.1)] },
  { id: "03-a-diverted", note: "Gate B cp5-routed-a, carton on exit A", snapshots: [firstWhere(routedA, e => e.state.path === "exitA" && e.state.positionM > 2.05)] },
  { id: "04-b-diverted", note: "Gate B cp6-routed-b, carton on exit B", snapshots: [firstWhere(routedB, e => e.state.path === "exitB" && e.state.positionM > 3.2)] },
  { id: "05-runout", note: "Gate B cp6-runout, carton at runout photoeye", snapshots: [firstWhere(runout, e => e.state.path === "main" && e.state.positionM > 3.5)] },
  { id: "06-stale", note: "same as 03 but connector stale for 2.4 s", snapshots: [{ ...firstWhere(routedA, e => e.state.path === "exitA" && e.state.positionM > 2.05), link: { state: "stale", ageMs: 2400, reason: "subscription lost" } }] },
  { id: "07-unknown-world", note: "PLC outputs only; world image and entities not supplied", snapshots: [buildSnapshot(contract.channels, { packageId: pkg.manifest.packageId, mode: "live", evidenceClass: "live_plc", sequence: 1, link: { state: "fresh" }, outputs: { Motor_RunCmd: true, D1_ExtendCmd: false, D2_ExtendCmd: true, StackLight_Red: false, StackLight_Green: true } })] },
  { id: "08-replay-sequence", note: "full cp5-routed-a replay at 10 Hz through the runtime", snapshots: routedA, screenshot: false, tweenMs: 100 }
];
for (const s of scenarios) if (s.snapshots.some(x => !x)) throw new Error(`Scenario ${s.id} found no matching recorded frame`);

function harness(srcdoc, token, frames) {
  const safe = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><title>machine-view harness</title><style>body{margin:0;background:#0b0e12}iframe{border:0;width:1280px;height:600px;display:block}pre{color:#9ab;font:10px monospace;margin:0;padding:2px 6px;white-space:pre-wrap}</style></head><body>
<iframe id="v" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><pre id="result">pending</pre><script>
const frames=${safe(frames)},token=${safe(token)},iframe=document.getElementById("v"),out={ready:null,applied:0,missing:[],errors:[],foreign:[],done:false};
function render(){document.getElementById("result").textContent=JSON.stringify(out);}
function send(i){if(i<frames.length)iframe.contentWindow.postMessage(frames[i],"*");else{out.done=true;render();}}
window.addEventListener("message",e=>{if(e.source!==iframe.contentWindow)return;const m=e.data;
if(!m||m.token!==token){out.foreign.push(m);render();return;}
if(m.type==="ready"){out.ready=m.elementIds.length;send(0);}else if(m.type==="applied"){out.applied++;out.missing.push(...m.missing);send(out.applied);}else if(m.type==="error")out.errors.push(m.message);render();});
iframe.srcdoc=${safe(srcdoc)};
</script></body></html>`;
}

const browser = await launch({ width: 1280, height: 640 });
const chrome = browser.chrome;
const readResult = `(() => { const el = document.getElementById("result"); return el && el.textContent !== "pending" ? JSON.parse(el.textContent) : null; })()`;
async function load(file, waitForDone) {
  await browser.navigate(file);
  await browser.waitFor(`(() => { const r = ${readResult}; return Boolean(r && (${waitForDone ? "r.done" : "r.ready !== null"})); })()`);
  await new Promise(r => setTimeout(r, waitForDone ? 400 : 1000));
  return browser.evaluate(readResult);
}

const results = [];
for (const s of scenarios) {
  const token = randomToken();
  const srcdoc = buildSrcdoc(pkg, token, randomToken());
  const frames = s.snapshots.map((snap, i) => ({ protocol: "controlsbench.machine-view.protocol.v1", token, type: "frame", sequence: i + 1, tweenMs: s.tweenMs && i > 0 ? s.tweenMs : 0, ops: resolveFrame(pkg, snap) }));
  const file = join(outDir, `${s.id}.html`);
  await writeFile(file, harness(srcdoc, token, frames));
  const result = await load(file, true);
  if (s.screenshot !== false) await writeFile(join(outDir, `${s.id}.png`), await browser.screenshot());
  const passed = Boolean(result && result.ready > 0 && result.done && result.applied === frames.length && result.missing.length === 0 && result.errors.length === 0 && result.foreign.length === 0);
  results.push({ id: s.id, note: s.note, frames: frames.length, result, passed, screenshot: s.screenshot === false ? null : `${s.id}.png` });
  console.log(`[browser] ${s.id} ${passed ? "pass" : "FAIL"} ${JSON.stringify(result)}`);
}

// CSP probe: smuggle script past the validator by constructing srcdoc directly.
const token = randomToken();
const evil = { ...pkg, svg: pkg.svg.replace("<svg ", "<svg onload=\"parent.postMessage({pwned:'onload-handler'},'*')\" ").replace(/<\/svg>\s*$/, "<script>parent.postMessage({pwned:'inline-script'},'*')</script></svg>") };
const probeFile = join(outDir, "csp-probe.html");
await writeFile(probeFile, harness(buildSrcdoc(evil, token, randomToken()), token, []));
const probe = await load(probeFile, false);
browser.close();
const probePassed = Boolean(probe && probe.ready > 0 && probe.foreign.length === 0);
console.log(`[browser] csp-probe ${probePassed ? "pass" : "FAIL"} ${JSON.stringify(probe)}`);

const summary = {
  checkedAt: new Date().toISOString(),
  package: label,
  packageId: pkg.manifest.packageId,
  svgSha256: createHash("sha256").update(pkg.svg).digest("hex"),
  browser: chrome.replace(/\\/g, "/"),
  sandbox: "allow-scripts (no allow-same-origin)",
  evidenceClassOfReplay: "surrogate_contract (Gate B world trace; no PLC)",
  scenarios: results,
  cspProbe: { passed: probePassed, result: probe, note: "Markup containing <script> and an event handler was injected directly into srcdoc, bypassing the validator; no message from it reached the host." },
  passed: results.every(r => r.passed) && probePassed
};
await writeFile(join(outDir, "browser-check.json"), jsonText(summary));
console.log(`[browser] ${summary.passed ? "PASS" : "FAIL"} -> ${outDir}`);
if (!summary.passed) process.exit(1);
