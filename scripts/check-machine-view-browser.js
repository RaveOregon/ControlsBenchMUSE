// Real-browser check of the isolated view host: loads the package srcdoc in a sandboxed iframe
// inside headless Chrome, drives recorded snapshots through the actual runtime, records the
// protocol result, screenshots each scenario, and probes that injected markup script cannot
// run under the CSP. No model call, network or PLC.
//
//   node scripts/check-machine-view-browser.js --package <dir> [--out <dir>]
//   node scripts/check-machine-view-browser.js --fixture --out <dir>
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSnapshot, resolveFrame } from "../src/machine-view/frame.ts";
import { assemblePackage } from "../src/machine-view/generation.ts";
import { buildSrcdoc, randomToken } from "../src/machine-view/host.ts";
import { jsonText, validatePackage } from "../src/machine-view/package.ts";
import { replaySnapshots } from "../src/machine-view/replay.ts";

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const chrome = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => p && existsSync(p));
if (!chrome) throw new Error("No Chrome/Edge found; set CHROME_PATH");

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
  { id: "08-replay-sequence", note: "full cp5-routed-a replay at 10 Hz through the runtime", snapshots: routedA, screenshot: false }
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

// Minimal DevTools-protocol driver: one headless browser, wait for the harness to finish.
const profile = await mkdtemp(join(tmpdir(), "cb-chrome-"));
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((ok, fail) => {
  let buffer = "";
  const timer = setTimeout(() => fail(new Error("Chrome did not expose DevTools")), 30_000);
  browser.stderr.on("data", chunk => { buffer += chunk; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffer); if (m) { clearTimeout(timer); ok(m[1]); } });
});
const port = new URL(wsUrl).port;
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
let nextId = 0;
const pending = new Map();
socket.onmessage = (event) => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const cdp = (method, params = {}) => new Promise((ok, fail) => { const id = ++nextId; pending.set(id, m => m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result)); socket.send(JSON.stringify({ id, method, params })); });
await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 640, deviceScaleFactor: 1, mobile: false });
async function load(file, waitForDone) {
  await cdp("Page.navigate", { url: pathToFileURL(file).href });
  const deadline = Date.now() + 30_000;
  for (;;) {
    await new Promise(r => setTimeout(r, 100));
    const { result } = await cdp("Runtime.evaluate", { expression: "document.getElementById('result') ? document.getElementById('result').textContent : 'pending'", returnByValue: true });
    const parsed = result.value && result.value !== "pending" ? JSON.parse(result.value) : null;
    if (parsed && (waitForDone ? parsed.done : parsed.ready !== null)) { await new Promise(r => setTimeout(r, waitForDone ? 300 : 1000)); return JSON.parse((await cdp("Runtime.evaluate", { expression: "document.getElementById('result').textContent", returnByValue: true })).result.value); }
    if (Date.now() > deadline) return parsed;
  }
}

const results = [];
for (const s of scenarios) {
  const token = randomToken();
  const srcdoc = buildSrcdoc(pkg, token, randomToken());
  const frames = s.snapshots.map((snap, i) => ({ protocol: "controlsbench.machine-view.protocol.v1", token, type: "frame", sequence: i + 1, ops: resolveFrame(pkg, snap) }));
  const file = join(outDir, `${s.id}.html`);
  await writeFile(file, harness(srcdoc, token, frames));
  const result = await load(file, true);
  if (s.screenshot !== false) await writeFile(join(outDir, `${s.id}.png`), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
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
socket.close();
browser.kill();
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
