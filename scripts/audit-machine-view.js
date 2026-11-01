// Presentation audit: renders the package against representative and worst-case snapshots in
// headless Chrome, measures every label and state indicator, and checks overlap, clipping,
// legibility and frame-to-frame motion. Writes <package>/audit/{audit.json,*.png}.
// Annotated screenshots (red = error, amber = warning) are what a repair request shows Muse.
//
//   node scripts/audit-machine-view.js [--package <dir>]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { auditActuators, auditLayout, auditMotion, buildAuditReport } from "../src/machine-view/audit.ts";
import { applyFrame, buildSnapshot, resolveFrame } from "../src/machine-view/frame.ts";
import { TRUSTED_CSS, prepareSvg } from "../src/machine-view/host.ts";
import { jsonText, validatePackage } from "../src/machine-view/package.ts";
import { replaySnapshots } from "../src/machine-view/replay.ts";
import { parseSvg, serializeSvg } from "../src/machine-view/svg.ts";
import { launch } from "./lib/chrome.js";

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const relative = arg("--package") ?? JSON.parse(await readFile(resolve("artifacts/machine-view/latest.json"), "utf8")).relativeDirectory;
const dir = resolve(relative);
const files = {};
for (const name of ["view.manifest.json", "equipment.json", "view-bindings.json", "view.svg"]) files[name] = await readFile(join(dir, name), "utf8");
const contract = JSON.parse(await readFile(resolve("artifacts/machine-view/contract/binding-contract.json"), "utf8"));
const worldDir = JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8")).relativeDirectory;
const { report, pkg } = await validatePackage({ files, contract, worldManifestText: await readFile(resolve(worldDir, "world.manifest.json"), "utf8") });
if (!report.viewValid) throw new Error(`Package is not view-valid: ${report.errors.join("; ")}`);

const trace = JSON.parse(await readFile(resolve(worldDir, "gate-b-trace.json"), "utf8"));
const runIds = ["cp5-routed-a", "cp6-routed-b", "cp6-runout", "cp5-missed-a"];
const runs = Object.fromEntries(runIds.map(id => [id, replaySnapshots(trace.runs.find(r => r.label === id), { packageId: pkg.manifest.packageId, channels: contract.channels, evidenceClass: "surrogate_contract" })]));
const base = { packageId: pkg.manifest.packageId, mode: "live", evidenceClass: "live_plc", sequence: 1, link: { state: "fresh" } };
const all = (fn) => Object.fromEntries(contract.channels.map(c => [c.signal, fn(c)]));
const worst = buildSnapshot(contract.channels, { ...base, raw: all(c => c.dataType === "BOOL" ? true : c.dataType === "UDINT" ? 4294967295 : 100), outputs: all(() => true), entities: [] });
const idle = buildSnapshot(contract.channels, { ...base, raw: all(c => c.normalValue), outputs: all(c => c.normalValue), entities: [] });
const pick = (id, test) => runs[id].find(f => f.entities.items.some(test));
const stable = [
  { id: "no-data", snapshot: null },
  { id: "idle", snapshot: idle },
  { id: "worst-case-values", snapshot: worst },
  { id: "a-diverted", snapshot: pick("cp5-routed-a", e => e.state.path === "exitA" && e.state.positionM > 2.05) },
  { id: "b-diverted", snapshot: pick("cp6-routed-b", e => e.state.path === "exitB" && e.state.positionM > 3.2) },
  { id: "runout", snapshot: pick("cp6-runout", e => e.state.path === "main" && e.state.positionM > 3.5) },
  { id: "stale", snapshot: { ...pick("cp5-routed-a", e => e.state.path === "exitA" && e.state.positionM > 2.05), link: { state: "stale", ageMs: 2400, reason: "subscription lost" } } }
];
// Every third recorded frame of each run, to catch labels that cartons pass over.
const sweep = runIds.flatMap(id => runs[id].filter((f, i) => i % 3 === 0 && f.entities.items.length > 0).map(f => ({ id: `${id}@${f.frame.sourceTimeMs}ms`, snapshot: f, sweep: true })));

function page(svgMarkup, bannerText) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${TRUSTED_CSS}</style></head><body><div id="cb-banner" data-level="info">${bannerText.replace(/</g, "&lt;")}</div><div id="cb-stage">${svgMarkup}</div><div id="audit-overlay" style="position:fixed;inset:0;pointer-events:none"></div></body></html>`;
}

const measure = `(() => {
  const svg = document.querySelector("#cb-stage > svg");
  const scale = svg.getScreenCTM().a;
  const vb = svg.getBoundingClientRect();
  const stage = document.getElementById("cb-stage").getBoundingClientRect();
  const view = { x: Math.max(vb.x, stage.x), y: Math.max(vb.y, stage.y), width: Math.min(vb.right, stage.right) - Math.max(vb.x, stage.x), height: Math.min(vb.bottom, stage.bottom) - Math.max(vb.y, stage.y) };
  const visible = el => { for (let n = el; n && n !== svg; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false; } return true; };
  const owner = el => { const c = el.closest("[data-cb-clone]"); if (c) return "clone:" + c.getAttribute("data-cb-clone"); const g = el.closest("[data-cb-equipment]"); return g ? "equipment:" + g.getAttribute("data-cb-equipment") : null; };
  const box = r => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const items = [];
  for (const el of svg.querySelectorAll("text")) {
    if (!visible(el)) continue;
    const moving = Boolean(el.closest("[data-cb-clone]"));
    const b = el.getBBox();
    const key = el.id ? "#" + el.id : moving ? "carton-label:" + (el.getAttribute("data-cb-field") || "static") : "label@" + Math.round(b.x) + "," + Math.round(b.y) + ":" + el.textContent.trim().slice(0, 24);
    const cs = getComputedStyle(el);
    const strokePx = cs.stroke && cs.stroke !== "none" ? parseFloat(cs.strokeWidth) * scale : 0;
    items.push({ key, kind: "text", text: el.textContent.trim(), box: box(el.getBoundingClientRect()), fontPx: parseFloat(cs.fontSize) * scale, strokePx, owner: owner(el), moving });
  }
  for (const id of ${JSON.stringify(pkg.bindings.bindings.filter(b => b.kind === "state" || b.kind === "rotate").map(b => b.element))}) {
    const el = document.getElementById(id); if (!el || el.tagName.toLowerCase() === "text" || !visible(el)) continue;
    items.push({ key: "#" + id, kind: "indicator", text: id, box: box(el.getBoundingClientRect()), fontPx: null, owner: owner(el), moving: false });
  }
  for (const el of svg.querySelectorAll("[data-cb-clone]")) if (visible(el)) items.push({ key: "carton:" + el.getAttribute("data-cb-clone"), kind: "indicator", text: "carton", box: box(el.getBoundingClientRect()), fontPx: null, owner: "clone:" + el.getAttribute("data-cb-clone"), moving: true });
  return { viewport: view, items };
})()`;

const outDir = join(dir, "audit");
await mkdir(outDir, { recursive: true });
const browser = await launch({ width: 1280, height: 624 });
const scenes = [];
const htmlFor = (s) => {
  const root = parseSvg(prepareSvg(pkg));
  let bannerText = "Waiting for the first snapshot · all values unknown · simulated physical truth, not the PLC HMI";
  if (s.snapshot) { const r = applyFrame(root, resolveFrame(pkg, s.snapshot)); bannerText = r.banner?.text ?? bannerText; }
  return page(serializeSvg(root), bannerText);
};
for (const s of [...stable, ...sweep]) {
  if (!s.sweep && !s.snapshot && s.id !== "no-data") throw new Error(`No recorded frame for ${s.id}`);
  const file = join(outDir, `${s.id.replace(/[^\w.-]+/g, "_")}.html`);
  await writeFile(file, htmlFor(s));
  await browser.navigate(file);
  await browser.waitFor("document.readyState === 'complete' && Boolean(document.querySelector('#cb-stage > svg'))");
  const measured = await browser.evaluate(measure);
  scenes.push({ scenario: s.id, sweep: Boolean(s.sweep), file, ...measured });
}

// Actuator geometry: sweep cartons along each path with each divert at home and fully extended.
const type = pkg.equipment.entityTypes[0];
const pathOf = (id) => type.paths.find(p => p.id === id);
const actuatorSamples = [];
let paintedBeneath = [];
const rotates = pkg.bindings.bindings.filter(b => b.kind === "rotate");
const entityBinding = pkg.bindings.bindings.find(b => b.kind === "entities");
for (const rot of rotates) {
  const channel = contract.channels.find(c => c.id === rot.channel);
  const divert = pkg.equipment.equipment.find(e => e.id === channel.equipmentId);
  const station = divert.geometry.stationM;
  const branch = type.paths.find(p => p.branchFrom && p.branchFrom.atM === station);
  for (const pose of ["home", "extended"]) {
    const value = pose === "home" ? rot.inputMin : rot.inputMax;
    const cartons = [];
    const add = (path, from, to, step) => { for (let m = from; m <= to + 1e-9; m += step) cartons.push({ path, m: Math.round(m * 1000) / 1000 }); };
    // Homed: cartons run the whole main lane past this divert. Extended: up to the station on main, then the branch.
    if (pose === "home") add("main", Math.max(0, station - 0.6), Math.min(pathOf("main").toM, station + 0.6), 0.05);
    else { add("main", Math.max(0, station - 0.8), station - 0.05, 0.05); if (branch) add(branch.id, station + 0.05, Math.min(branch.toM, station + 0.6), 0.05); }
    const snapshot = buildSnapshot(contract.channels, { ...base, raw: { ...all(c => c.normalValue), [channel.signal]: value }, outputs: all(c => c.normalValue),
      entities: cartons.map((c, i) => ({ id: `probe-${i}`, type: type.type, state: { positionM: c.m, path: c.path, itemId: "", requestedRoute: null, velocityMps: 0, jammed: false } })) });
    const root = parseSvg(prepareSvg(pkg));
    applyFrame(root, resolveFrame(pkg, snapshot));
    const file = join(outDir, `${divert.id}-${pose}.html`);
    await writeFile(file, page(serializeSvg(root), `${divert.id} ${pose}: carton sweep`));
    await browser.navigate(file);
    await browser.waitFor("document.readyState === 'complete' && Boolean(document.querySelector('#cb-stage > svg'))");
    const result = await browser.evaluate(`(() => {
      const svg = document.querySelector("#cb-stage > svg");
      const paddle = document.getElementById(${JSON.stringify(rot.element)});
      const shapes = [paddle, ...paddle.querySelectorAll("*")].filter(n => typeof n.isPointInFill === "function");
      const toLocal = (shape, x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(shape.getScreenCTM().inverse()); };
      const hit = (x, y) => shapes.some(s => { const p = toLocal(s, x, y); return s.isPointInFill(p) || s.isPointInStroke(p); });
      const out = [];
      for (const clone of svg.querySelectorAll("[data-cb-clone]")) {
        const parts = [...clone.querySelectorAll("rect,path,polygon")].filter(n => !n.closest("text"));
        const body = parts.sort((a, b) => { const A = a.getBBox(), B = b.getBBox(); return B.width * B.height - A.width * A.height; })[0];
        if (!body) continue;
        const bb = body.getBBox(), m = body.getScreenCTM();
        let n = 0;
        for (let i = 1; i <= 7; i++) for (let j = 1; j <= 3; j++) {
          const p = svg.createSVGPoint(); p.x = bb.x + bb.width * (0.05 + 0.9 * (i - 1) / 6); p.y = bb.y + bb.height * (0.15 + 0.7 * (j - 1) / 2);
          const s = p.matrixTransform(m); if (hit(s.x, s.y)) n++;
        }
        out.push({ key: clone.getAttribute("data-cb-clone"), n });
      }
      const container = document.getElementById(${JSON.stringify(entityBinding.container)});
      const beneath = Boolean(paddle.compareDocumentPosition(container) & Node.DOCUMENT_POSITION_PRECEDING);
      return { out, beneath };
    })()`);
    for (const r of result.out) {
      const c = cartons[Number(r.key.split("-")[1])];
      actuatorSamples.push({ equipmentId: divert.id, element: rot.element, pose, path: c.path, positionM: c.m, overlapPoints: r.n });
    }
    if (result.beneath && !paintedBeneath.some(p => p.element === rot.element)) paintedBeneath.push({ element: rot.element, container: entityBinding.container });
    await writeFile(join(outDir, `${divert.id}-${pose}.png`), await browser.screenshot());
  }
}
const actuators = auditActuators({ samples: actuatorSamples, paintedBeneath });

const layout = auditLayout(scenes);
const motion = auditMotion(pkg, runs);
const result = buildAuditReport(pkg.manifest.packageId, layout, motion, scenes.map(s => s.scenario), actuators);

// Annotated screenshots of the stable scenarios.
const screenshots = [];
for (const scene of scenes.filter(s => !s.sweep)) {
  await browser.navigate(scene.file);
  await browser.waitFor("document.readyState === 'complete'");
  const clean = `${scene.scenario}.clean.png`;
  await writeFile(join(outDir, clean), await browser.screenshot());
  screenshots.push(clean);
  const relevant = result.findings.filter(f => f.category !== "legibility" && f.category !== "motion" && (f.scenarios.includes(scene.scenario) || (f.category === "transient_overlap" && scene.scenario.endsWith("diverted"))));
  const boxes = relevant.flatMap(f => f.elements.map(key => ({ f, item: scene.items.find(i => i.key === key) ?? scenes.flatMap(x => x.items).find(i => i.key === key && !i.moving) }))).filter(b => b.item);
  await browser.navigate(scene.file);
  await browser.waitFor("document.readyState === 'complete'");
  await browser.evaluate(`(() => { const o = document.getElementById("audit-overlay"); for (const b of ${JSON.stringify(boxes.map(b => ({ ...b.item.box, sev: b.f.severity, id: b.f.id })))}) { const d = document.createElement("div"); d.style.cssText = "position:fixed;left:" + (b.x - 2) + "px;top:" + (b.y - 2) + "px;width:" + (b.width + 4) + "px;height:" + (b.height + 4) + "px;border:2px solid " + (b.sev === "error" ? "#e00" : "#e90") + ";box-sizing:border-box"; const t = document.createElement("span"); t.textContent = b.id; t.style.cssText = "position:absolute;top:-14px;left:0;font:700 10px monospace;color:#fff;background:" + (b.sev === "error" ? "#e00" : "#e90") + ";padding:0 2px"; d.appendChild(t); o.appendChild(d); } return true; })()`);
  const png = `${scene.scenario}.png`;
  await writeFile(join(outDir, png), await browser.screenshot());
  screenshots.push(png);
}
browser.close();

const audit = { ...result, auditedAt: new Date().toISOString(), package: relative, svgSha256: report.hashes["view.svg"], screenshots, actuatorSweep: actuatorSamples.filter(s => s.overlapPoints > 0), thresholds: { note: "text overlap: >=4 px2 and >=4% of the smaller label with 1 px clearance; label over indicator: >=15%; minimum 10 px font at 1280 px width; carton jump: >3x median step; belt alias: step >=40% of mark period" } };
await writeFile(join(outDir, "audit.json"), jsonText(audit));
console.log(JSON.stringify({ package: relative, passed: audit.passed, counts: audit.counts, motion: audit.motion, findings: audit.findings.map(f => `${f.id} ${f.severity} ${f.category}: ${f.detail} [${f.scenarios.length} scenario(s)]`) }, null, 2));
