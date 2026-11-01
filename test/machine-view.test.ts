import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { deriveContract } from "../src/machine-view/contract-source.ts";
import type { BindingContract, EquipmentFile, HostFrameMessage, ViewSnapshot } from "../src/machine-view/contracts.ts";
import { applyFrame, buildFallback, buildSnapshot, renderFallbackHtml, resolveFrame, validateSnapshot, type LoadedPackage } from "../src/machine-view/frame.ts";
import { PathMap } from "../src/machine-view/geometry.ts";
import { assemblePackage, buildGenerationRequest, outputSchema, type GeneratedView } from "../src/machine-view/generation.ts";
import { MachineViewController, SANDBOX, buildSrcdoc, contentSecurityPolicy, runtimeSource, type EvidenceSelection, type Timers, type ViewHostStatus } from "../src/machine-view/host.ts";
import { jsonText, validatePackage } from "../src/machine-view/package.ts";
import { replaySnapshots, type TraceRun } from "../src/machine-view/replay.ts";
import { indexById, parseSvg, walk } from "../src/machine-view/svg.ts";
import { fixturePaths, fixtureView } from "./fixtures/machine-view/fixture-view.ts";
import { auditLayout, auditMotion, buildAuditReport, describeFindings, type MeasuredItem } from "../src/machine-view/audit.ts";
import { MAX_TWEEN_MS, tweenFor } from "../src/machine-view/host.ts";
import type { FrameOp } from "../src/machine-view/contracts.ts";

const gateB = JSON.parse(await readFile(resolve(`${JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8")).relativeDirectory}/gate-b-trace.json`), "utf8")) as { runs: TraceRun[] };

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const read = (path: string) => readFile(resolve(path), "utf8");

async function loadContract() {
  const latest = JSON.parse(await read("artifacts/generated-world/latest.json")).relativeDirectory as string;
  const doc = async (path: string) => { const text = await read(path); return { path, text, sha256: sha256(text) }; };
  const sources = {
    specification: await doc("docs/conveyor-machine-spec.md"),
    worldManifest: await doc(`${latest}/world.manifest.json`),
    worldSource: await doc(`${latest}/world.ts`),
    worldAssumptions: await doc(`${latest}/assumptions.md`),
    signalMap: await doc("codesys/demo/signal-map-v1.json")
  };
  const { equipment, contract: partial } = deriveContract(sources);
  const equipmentText = jsonText(equipment);
  const contract: BindingContract = { ...partial, equipmentSha256: sha256(equipmentText) };
  return { sources, equipment, equipmentText, contract, latest };
}

const ctx = await loadContract();

async function packageFor(view: GeneratedView | null, mutate?: (files: Record<string, string>) => void) {
  const assembled = await assemblePackage({ equipmentText: ctx.equipmentText, contract: ctx.contract, generated: view, provenance: { model: "test-fixture", responseId: null, generatedAt: null } });
  const files: Record<string, string> = { ...assembled.files };
  mutate?.(files);
  const result = await validatePackage({ files, contract: ctx.contract, worldManifestText: ctx.sources.worldManifest.text });
  return { ...result, files, assembled };
}

const validFixture = await packageFor(fixtureView(ctx.equipment, ctx.contract));
const pkg = validFixture.pkg!;
const replaySnapshotsFor = (label: string) => replaySnapshots(gateB.runs.find(r => r.label === label)!, { packageId: pkg.manifest.packageId, channels: ctx.contract.channels, evidenceClass: "surrogate_contract" });

/** Re-hash an edited svg so the integrity check passes and the targeted check is exercised. */
async function withSvg(edit: (svg: string) => string) {
  const view = fixtureView(ctx.equipment, ctx.contract);
  view.svg = edit(view.svg);
  return packageFor(view);
}
const failed = (report: { checks: Array<{ id: string; passed: boolean }> }, id: string) => report.checks.some(c => c.id === id && !c.passed);

function snapshot(overrides: Partial<Parameters<typeof buildSnapshot>[1]> = {}): ViewSnapshot {
  const normal: Record<string, boolean | number> = {};
  for (const c of ctx.contract.channels) normal[c.signal] = typeof c.normalValue === "number" || typeof c.normalValue === "boolean" ? c.normalValue : 0;
  return buildSnapshot(ctx.contract.channels, { packageId: pkg.manifest.packageId, mode: "live", evidenceClass: "live_plc", sequence: 1, link: { state: "fresh" }, raw: normal, outputs: normal, entities: [], ...overrides });
}

function render(s: ViewSnapshot, p: LoadedPackage = pkg) {
  const root = parseSvg(p.svg!);
  const result = applyFrame(root, resolveFrame(p, s));
  return { root, ids: indexById(root), ...result };
}

// ---------------------------------------------------------------------------------------------

test("contract is derived deterministically from spec, world package and M8 signal map, and matches the frozen artifacts", async () => {
  assert.equal(ctx.equipment.equipment.length, 15);
  assert.equal(ctx.contract.channels.length, 25);
  assert.deepEqual(new Set(ctx.contract.channels.map(c => c.equipmentId)), new Set(ctx.equipment.equipment.filter(e => e.channels.length).map(e => e.id)));
  assert.equal(ctx.contract.channels.filter(c => c.source === "plc_output").length, 5);
  const divert1 = ctx.equipment.equipment.find(e => e.id === "divert1")!;
  assert.deepEqual(divert1.geometry, { path: "main", stationM: 1.6 });
  assert.ok(divert1.sources.some(s => s.locator.includes("DO-02 D1_ExtendCmd")));
  assert.equal(await read("artifacts/machine-view/contract/equipment.json"), ctx.equipmentText, "frozen equipment.json is current");
  assert.equal(await read("artifacts/machine-view/contract/binding-contract.json"), jsonText(ctx.contract), "frozen binding contract is current");
});

test("contract derivation rejects disagreeing sources instead of guessing", () => {
  const bad = { ...ctx.sources, worldAssumptions: { ...ctx.sources.worldAssumptions, text: ctx.sources.worldAssumptions.text.replace("entry PE at 0.50 m", "entry PE at 0.70 m") } };
  assert.throws(() => deriveContract(bad), /peEntryM/);
  const map = JSON.parse(ctx.sources.signalMap.text);
  map.signals = map.signals.filter((s: { logical: string }) => s.logical !== "raw.slot0.PE_Entry");
  assert.throws(() => deriveContract({ ...ctx.sources, signalMap: { ...ctx.sources.signalMap, text: JSON.stringify(map) } }), /lacks raw.slot0.PE_Entry/);
});

test("contract-only package validates for fallback and the host shows unknown values, then supplied values", async () => {
  const { report, pkg: contractPkg } = await packageFor(null);
  assert.equal(report.contractValid, true);
  assert.equal(report.viewValid, false);
  const controller = new MachineViewController({ pkg: contractPkg, report });
  assert.equal(controller.status.state, "fallback");
  assert.equal(controller.srcdoc, null);
  const before = controller.fallback()!;
  assert.ok(before.equipment.flatMap(e => e.values).every(v => v.display === "unknown" && v.health === "unknown"));
  assert.equal(before.entitiesSupplied, false);
  const s = buildSnapshot(ctx.contract.channels, { packageId: contractPkg!.manifest.packageId, mode: "replay", evidenceClass: "preserved_live_plc", sequence: 3, link: { state: "stale", ageMs: 1800 }, raw: { PE_Entry: true }, evidenceRefs: { "world.PE_Entry": "ev-7" } });
  assert.deepEqual(controller.push(s), { accepted: true, errors: [] });
  const after = controller.fallback()!;
  const pe = after.equipment.find(e => e.id === "peEntry")!.values[0]!;
  assert.deepEqual([pe.display, pe.health, pe.evidenceRef], ["true", "stale", "ev-7"]);
  assert.equal(after.equipment.find(e => e.id === "drive")!.values[0]!.display, "unknown");
  assert.match(after.banner!.text, /STALE for 1\.8 s/);
  const html = renderFallbackHtml({ ...after, reason: "<script>alert(1)</script>" });
  assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"));
});

test("fixture view passes every validator check", () => {
  assert.equal(validFixture.report.contractValid, true);
  assert.deepEqual(validFixture.report.errors, []);
  assert.equal(validFixture.report.viewValid, true);
  assert.ok(validFixture.report.checks.some(c => c.id === "render.smoke" && c.passed));
});

test("validator rejects scripting, external references, independent animation and reserved overrides", async () => {
  const cases: Array<[string, (svg: string) => string, RegExp]> = [
    ["script", s => s.replace("</svg>", "<script>fetch('x')</script></svg>"), /<script> is not allowed/],
    ["handler", s => s.replace('<g id="cartons"/>', '<g id="cartons" onclick="x()"/>'), /onclick/],
    ["foreignObject", s => s.replace("</svg>", "<foreignObject><div/></foreignObject></svg>"), /foreignObject/],
    ["external href", s => s.replace("</svg>", '<use href="https://example.com/a.svg#x"/></svg>'), /in-document #fragment/],
    ["external url", s => s.replace('fill="#c8a46e"', 'fill="url(https://x/y)"'), /non-fragment url|external/],
    ["SMIL", s => s.replace('<g id="cartons"/>', '<g id="cartons"><animate attributeName="x" dur="1s"/></g>'), /animate/],
    ["keyframes", s => s.replace("</style>", "@keyframes spin{from{opacity:0}}</style>"), /animation/],
    ["transition", s => s.replace("</style>", ".belt{transition:all 1s}</style>"), /transitions/],
    ["important", s => s.replace("</style>", ".belt{opacity:1 !important}</style>"), /!important/],
    ["body selector", s => s.replace("</style>", "body{display:none}</style>"), /document-level/],
    ["banner override", s => s.replace("</style>", "#cb-banner{display:none}</style>"), /reserved host identifiers/],
    ["reserved attr", s => s.replace('<g id="cartons"/>', '<g id="cartons" data-cb-health="good"/>'), /reserved for the host/],
    ["doctype", s => `<!DOCTYPE svg [<!ENTITY x "y">]>${s}`, /DOCTYPE/]
  ];
  for (const [name, edit, pattern] of cases) {
    const { report } = await withSvg(edit);
    assert.equal(report.viewValid, false, name);
    assert.match(report.errors.join("\n"), pattern, name);
  }
});

test("validator enforces binding coverage, anchors, motion, selection and geometry coherence", async () => {
  const drop = async (filter: (b: Record<string, unknown>) => boolean, edit?: (v: GeneratedView) => void) => {
    const view = fixtureView(ctx.equipment, ctx.contract);
    view.bindings = view.bindings.filter(b => !filter(b as Record<string, unknown>));
    edit?.(view);
    return (await packageFor(view)).report;
  };
  assert.ok(failed(await drop(b => b.channel === "plc.Motor_RunCmd"), "coverage.channels"));
  assert.ok(failed(await drop(b => b.id === "b_divert1_anchor"), "coverage.anchors"));
  assert.ok(failed(await drop(b => b.kind === "rotate" && b.channel === "world.D2_Position", v => v.bindings.push({ ...(v.bindings.find(b => (b as { kind: string }).kind === "state") as object), id: "b_d2pos_text", kind: "text", channel: "world.D2_Position" })), "coverage.motion"));
  assert.ok(failed(await drop(b => b.kind === "entities"), "coverage.entities"));
  assert.ok(failed(await drop(() => false, v => { v.svg = v.svg.replace('data-cb-equipment="stackLight"', ""); }), "selection.equipment"));
  assert.ok(failed(await drop(() => false, v => { v.entityPaths.find(p => p.path === "exitA")!.points[0]!.y += 25; }), "geometry.paths"));
  assert.ok(failed(await drop(() => false, v => { v.entityPaths = v.entityPaths.filter(p => p.path !== "exitB"); }), "geometry.paths"));
  assert.ok(failed(await drop(() => false, v => { v.bindings.push({ ...(v.bindings[0] as object), id: "b_dupe_transform", kind: "rotate", element: "divert1_anchor", channel: "world.D1_Position", inputMin: 0, inputMax: 100, angleMin: 0, angleMax: 10, pivotX: 0, pivotY: 0 }); }), "bindings.structure"));
  assert.ok(failed(await drop(() => false, v => { v.svg = v.svg.replace("[data-cb-value=\"true\"]{fill:#ffd24a}", ""); }), "style.state"));
  const missingElement = await drop(() => false, v => { v.svg = v.svg.replace('id="peEntry_beam"', 'id="peEntry_beam_renamed"'); });
  assert.ok(failed(missingElement, "bindings.references"));
});

test("validator checks integrity, contract identity, world compatibility and credentials", async () => {
  const tampered = await packageFor(fixtureView(ctx.equipment, ctx.contract), files => { files["view.svg"] = files["view.svg"]!.replace("test fixture", "tampered"); });
  assert.equal(tampered.report.contractValid, true, "svg is view-tier; contract stays usable for fallback");
  assert.ok(failed(tampered.report, "view.entry"));
  const otherContract = { ...ctx.contract, channels: ctx.contract.channels.slice(1) };
  const mismatch = await validatePackage({ files: validFixture.files, contract: otherContract });
  assert.equal(mismatch.report.contractValid, false);
  const wrongWorld = await validatePackage({ files: validFixture.files, contract: ctx.contract, worldManifestText: `${ctx.sources.worldManifest.text} ` });
  assert.ok(failed(wrongWorld.report, "compatibility.world"));
  const leaked = await withSvg(s => s.replace("not the PLC HMI", "opc.tcp://127.0.0.1:4840 user password"));
  assert.equal(leaked.report.contractValid, false);
  assert.ok(failed(leaked.report, "security.no_credentials"));
  const controller = new MachineViewController({ pkg: leaked.pkg, report: leaked.report });
  assert.equal(controller.status.state, "invalid_package");
  assert.match(controller.fallbackHtml(), /Machine view unavailable/);
});

test("frames follow supplied snapshots: sensors, commands vs feedback, divert position and belt travel", () => {
  const s = snapshot({ raw: { PE_Entry: true, D1_Position: 100, Encoder_Count: 1234, Belt_SpeedActual: 0.5, Drive_RunningFB: false }, outputs: { Motor_RunCmd: true, D1_ExtendCmd: true } });
  const { ids, missing } = render(s);
  assert.deepEqual(missing, []);
  assert.equal(ids.get("peEntry_beam")!.attrs["data-cb-value"], "true");
  assert.equal(ids.get("peEntry_beam")!.attrs["data-cb-health"], "good");
  assert.equal(ids.get("panel_Motor_RunCmd")!.attrs["data-cb-value"], "true");
  assert.equal(ids.get("panel_Motor_RunCmd")!.attrs["data-cb-source"], "plc");
  assert.equal(ids.get("panel_Drive_RunningFB")!.attrs["data-cb-value"], "false", "command on is not shown as running feedback");
  assert.equal(ids.get("panel_Drive_RunningFB")!.attrs["data-cb-source"], "world");
  assert.equal(ids.get("divert1_paddle")!.attrs.transform, "rotate(30 0 -20)");
  assert.equal(ids.get("panel_Belt_SpeedActual")!.children[0]!.type === "text" && (ids.get("panel_Belt_SpeedActual")!.children[0] as { text: string }).text, "0.50");
  // 1.234 m x 200 px/m = 246.8 px; mod 20 = 6.8
  assert.equal(ids.get("belt_marks")!.attrs.transform, "translate(6.8 0)");
  assert.equal(ids.get("peExitA_anchor")!.attrs.transform, `translate(${Math.round((60 + 1.6 * 200 + 0.5 * 200 * Math.cos(Math.PI / 6)) * 100) / 100} ${Math.round((200 + 0.5 * 200 * Math.sin(Math.PI / 6)) * 100) / 100})`);
});

test("replay of the preserved Gate B routed-A run moves the carton onto exit A only from recorded state", async () => {
  const latest = ctx.latest;
  const trace = JSON.parse(await read(`${latest}/gate-b-trace.json`)) as { evidenceClass: string; runs: TraceRun[] };
  assert.equal(trace.evidenceClass, "surrogate_contract");
  const run = trace.runs.find(r => r.label === "cp5-routed-a")!;
  const frames = replaySnapshots(run, { packageId: pkg.manifest.packageId, channels: ctx.contract.channels, evidenceClass: "surrogate_contract" });
  assert.equal(frames.length, Math.ceil(run.finalTimeMs / 100) + 1);
  for (const f of frames) assert.deepEqual(validateSnapshot(pkg, f), []);
  const paths = new PathMap(fixturePaths(ctx.equipment), ctx.equipment.entityTypes[0]);
  const onA = frames.find(f => f.entities.items.some(e => e.state.path === "exitA"))!;
  assert.ok(onA, "a recorded frame shows the carton on exit A");
  const carton = onA.entities.items[0]!;
  const { root, banner } = render(onA);
  const clones = [...walk(root)].filter(({ el }) => el.attrs["data-cb-clone"] !== undefined).map(({ el }) => el);
  assert.equal(clones.length, 1);
  const p = paths.position("exitA", carton.state.positionM as number)!;
  assert.match(clones[0]!.attrs.transform!, new RegExp(`^translate\\(${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}\\) rotate\\(30\\)$`));
  assert.equal(clones[0]!.attrs["data-cb-route"], "A");
  assert.equal(clones[0]!.attrs.id, undefined, "clones carry no duplicate ids");
  assert.match(banner!.text, /Replay · surrogate contract · no PLC/);
  const last = frames.at(-1)!;
  assert.equal(last.entities.items.length, 0, "removed carton disappears");
  const mid = frames[Math.floor(frames.length / 2)]!;
  assert.deepEqual(frames.map(f => f.frame.sequence), frames.map((_, i) => i));
  assert.ok(mid.frame.sourceTimeMs! < last.frame.sourceTimeMs!);
});

test("stale, held, passthrough, missing and unsupplied values are visibly marked, never fabricated", () => {
  const missing = buildSnapshot(ctx.contract.channels, { packageId: pkg.manifest.packageId, mode: "live", evidenceClass: "live_plc", sequence: 2, link: { state: "fresh" }, raw: { PE_Entry: true } });
  const m = render(missing);
  assert.equal(m.ids.get("peD1Approach_beam")!.attrs["data-cb-value"], "unknown");
  assert.equal(m.ids.get("peD1Approach_beam")!.attrs["data-cb-health"], "unknown");
  assert.equal((m.ids.get("panel_Encoder_Count")!.children[0] as { text: string }).text, "unknown");
  assert.equal(m.ids.get("divert1_paddle")!.attrs.transform, undefined, "unknown position draws no fabricated angle");
  assert.equal([...walk(m.root)].filter(({ el }) => el.attrs["data-cb-clone"]).length, 0);
  assert.match(m.banner!.text, /carton positions not supplied: unknown/);
  assert.equal(m.banner!.level, "warn");

  const stale = render(snapshot({ link: { state: "stale", ageMs: 2500, reason: "subscription lost" }, raw: { PE_Entry: true } }));
  assert.equal(stale.ids.get("peEntry_beam")!.attrs["data-cb-value"], "true", "last value is kept");
  assert.equal(stale.ids.get("peEntry_beam")!.attrs["data-cb-health"], "stale");
  assert.equal(stale.banner!.level, "bad");
  assert.match(stale.banner!.text, /STALE for 2\.5 s \(subscription lost\)/);

  const aged = buildSnapshot(ctx.contract.channels, { packageId: pkg.manifest.packageId, mode: "live", evidenceClass: "live_plc", sequence: 3, link: { state: "fresh" }, raw: { PE_Entry: false }, observedAtMs: { "world.PE_Entry": 1000 }, nowMs: 2600, staleAfterMs: 1000, entities: [] });
  assert.equal(aged.channels["world.PE_Entry"]!.health, "stale");
  const replayNeverAges = buildSnapshot(ctx.contract.channels, { packageId: pkg.manifest.packageId, mode: "replay", evidenceClass: "preserved_live_plc", sequence: 3, link: { state: "not_connected" }, raw: { PE_Entry: false }, observedAtMs: { "world.PE_Entry": 0 }, nowMs: 1e9, entities: [] });
  assert.equal(replayNeverAges.channels["world.PE_Entry"]!.health, "good");

  const pass = render(snapshot({ link: { state: "passthrough" } }));
  assert.equal(pass.ids.get("peEntry_beam")!.attrs["data-cb-health"], "held");
  assert.equal(pass.ids.get("panel_Motor_RunCmd")!.attrs["data-cb-health"], "good");
  assert.match(pass.banner!.text, /PASSTHROUGH/);

  const bad = render(snapshot({ quality: { "world.PE_Entry": "bad" }, raw: { PE_Entry: true } }));
  assert.equal(bad.ids.get("peEntry_beam")!.attrs["data-cb-value"], "unknown");
  assert.equal(bad.ids.get("peEntry_beam")!.attrs["data-cb-health"], "bad");

  const jam = render(snapshot({ link: { state: "stale", ageMs: 900 }, entities: [{ id: "carton-9", type: "carton", state: { positionM: 9.5, path: "main", itemId: "X9", requestedRoute: "B", velocityMps: 0, jammed: true } }] }));
  const clone = [...walk(jam.root)].find(({ el }) => el.attrs["data-cb-clone"] === "carton-9")!.el;
  assert.deepEqual([clone.attrs["data-cb-health"], clone.attrs["data-cb-outside"], clone.attrs["data-cb-jammed"]], ["stale", "true", "true"]);
});

test("snapshot validation keeps the interface narrow", () => {
  const good = snapshot();
  assert.deepEqual(validateSnapshot(pkg, good), []);
  assert.match(validateSnapshot(pkg, { ...good, endpoint: "opc.tcp://x" }).join(), /Unexpected snapshot field endpoint/);
  assert.match(validateSnapshot(pkg, { ...good, channels: { ...good.channels, "plc.controller.Mode": { value: 1, health: "good" } } }).join(), /Undeclared channel/);
  assert.match(validateSnapshot(pkg, { ...good, channels: { ...good.channels, "world.PE_Entry": { value: 1, health: "good" } } }).join(), /does not match BOOL/);
  assert.match(validateSnapshot(pkg, { ...good, channels: { ...good.channels, "world.Encoder_Count": { value: -1, health: "good" } } }).join(), /does not match UDINT/);
  assert.match(validateSnapshot(pkg, { ...good, packageId: "other" }).join(), /targets package other/);
  assert.match(validateSnapshot(pkg, { ...good, entities: { supplied: true, health: "good", items: [{ id: "c", type: "carton", state: { positionM: 1, path: "main", secretTruth: "x" } }] } }).join(), /undeclared field secretTruth/);
});

const stateOf = (c: MachineViewController): ViewHostStatus["state"] => c.status.state;

class FakeTimers implements Timers {
  t = 0;
  #queue: Array<{ at: number; fn: () => void; id: number }> = [];
  #id = 0;
  now() { return this.t; }
  setTimeout(fn: () => void, ms: number) { const id = ++this.#id; this.#queue.push({ at: this.t + ms, fn, id }); return id; }
  clearTimeout(handle: unknown) { this.#queue = this.#queue.filter(q => q.id !== handle); }
  advance(ms: number) { this.t += ms; const due = this.#queue.filter(q => q.at <= this.t); this.#queue = this.#queue.filter(q => q.at > this.t); for (const q of due) q.fn(); }
}

function mounted() {
  const timers = new FakeTimers();
  const posted: HostFrameMessage[] = [];
  const statuses: ViewHostStatus[] = [];
  const selections: EvidenceSelection[] = [];
  const controller = new MachineViewController({ pkg, report: validFixture.report, timers, post: m => posted.push(m), onStatus: s => statuses.push(s), onSelect: s => selections.push(s), token: "tok", nonce: "non" });
  const ready = () => controller.receive({ protocol: "controlsbench.machine-view.protocol.v1", token: "tok", type: "ready", elementIds: [...indexById(parseSvg(pkg.svg!)).keys()] });
  const applied = (sequence: number, missing: string[] = []) => controller.receive({ protocol: "controlsbench.machine-view.protocol.v1", token: "tok", type: "applied", sequence, missing });
  return { timers, posted, statuses, selections, controller, ready, applied };
}

test("host protocol: ready handshake, frames, acknowledgement, selection evidence and token isolation", () => {
  const h = mounted();
  assert.equal(stateOf(h.controller), "loading");
  h.controller.push(snapshot({ raw: { PE_Entry: true }, evidenceRefs: { "world.PE_Entry": "ledger#41" } }));
  assert.equal(h.posted.length, 0, "no frame before ready");
  h.controller.receive({ protocol: "controlsbench.machine-view.protocol.v1", token: "wrong", type: "ready", elementIds: [] });
  assert.equal(stateOf(h.controller), "loading", "foreign token ignored");
  h.ready();
  assert.equal(stateOf(h.controller), "ready");
  assert.equal(h.posted.length, 1, "latest snapshot sent on ready");
  assert.ok(h.posted[0]!.ops.some(op => op.op === "attrs" && op.id === "peEntry_beam" && op.attrs["data-cb-value"] === "true"));
  h.applied(1);
  h.timers.advance(5000);
  assert.equal(stateOf(h.controller), "ready", "acknowledged frame does not time out");
  h.controller.receive({ protocol: "controlsbench.machine-view.protocol.v1", token: "tok", type: "select", equipmentId: "peEntry", entityId: null });
  assert.equal(h.selections.length, 1);
  assert.deepEqual(h.selections[0]!.evidenceRefs, ["ledger#41"]);
  assert.equal(h.selections[0]!.values[0]!.truthClass, "simulated_physical_truth");
  h.controller.receive({ protocol: "controlsbench.machine-view.protocol.v1", token: "tok", type: "select", equipmentId: "notDeclared", entityId: null });
  assert.equal(h.selections.length, 1, "undeclared equipment ignored");
  const rejected = h.controller.push({ ...snapshot(), channels: { "world.PE_Entry": { value: "yes", health: "good" } } });
  assert.equal(rejected.accepted, false);
  const held = h.posted.at(-1)!;
  assert.ok(held.ops.some(op => op.op === "banner" && /HELD \(host supplied an invalid snapshot/.test(op.text)), "invalid snapshot holds last valid frame visibly");
  assert.ok(held.ops.some(op => op.op === "attrs" && op.id === "peEntry_beam" && op.attrs["data-cb-health"] === "held"));
});

test("host falls back without throwing when the view is slow, broken or incomplete", () => {
  const slowAck = mounted();
  slowAck.ready();
  slowAck.controller.push(snapshot());
  slowAck.timers.advance(2001);
  assert.equal(stateOf(slowAck.controller), "fallback");
  assert.match(slowAck.controller.status.reason!, /did not acknowledge frame 1/);
  assert.ok(slowAck.controller.fallback()!.equipment.length === 15, "fallback keeps showing the last snapshot");
  assert.doesNotThrow(() => slowAck.controller.push(snapshot()));

  const neverReady = mounted();
  neverReady.timers.advance(5001);
  assert.match(neverReady.controller.status.reason!, /did not report ready/);

  const incomplete = mounted();
  incomplete.controller.receive({ protocol: "controlsbench.machine-view.protocol.v1", token: "tok", type: "ready", elementIds: ["lane"] });
  assert.match(incomplete.controller.status.reason!, /lacks bound elements/);

  const crashed = mounted();
  crashed.ready();
  crashed.controller.receive({ protocol: "controlsbench.machine-view.protocol.v1", token: "tok", type: "error", message: "TypeError" });
  assert.match(crashed.controller.status.reason!, /runtime error: TypeError/);

  const throwingPost = new MachineViewController({ pkg, report: validFixture.report, timers: new FakeTimers(), post: () => { throw new Error("detached"); }, token: "tok" });
  throwingPost.receive({ protocol: "controlsbench.machine-view.protocol.v1", token: "tok", type: "ready", elementIds: [...indexById(parseSvg(pkg.svg!)).keys()] });
  assert.doesNotThrow(() => throwingPost.push(snapshot()));
  assert.equal(stateOf(throwingPost), "fallback");
});

test("isolated srcdoc: sandbox without same-origin, CSP with no network, only the nonce'd host script", () => {
  assert.equal(SANDBOX, "allow-scripts");
  const doc = buildSrcdoc(pkg, "tok", "abc123");
  const csp = contentSecurityPolicy("abc123");
  assert.ok(doc.includes(csp.replace(/'/g, "'")));
  for (const directive of ["default-src 'none'", "connect-src 'none'", "img-src 'none'", "form-action 'none'", "script-src 'nonce-abc123'"]) assert.ok(csp.includes(directive), directive);
  assert.equal((doc.match(/<script/g) ?? []).length, 1);
  assert.ok(doc.includes('<script nonce="abc123">'));
  const runtime = runtimeSource("tok");
  for (const forbidden of ["fetch", "XMLHttpRequest", "WebSocket", "eval(", "Function(", "innerHTML", "localStorage", "import("]) assert.ok(!runtime.includes(forbidden), forbidden);
  const stage = parseSvg(/<div id="cb-stage">([\s\S]*?)<\/div><style>/.exec(doc)![1]!);
  const ids = indexById(stage);
  assert.equal(ids.get("peEntry_beam")!.attrs["data-cb-health"], "unknown", "bound elements start unknown");
  assert.equal(ids.get("panel_Encoder_Count")!.attrs["data-cb-health"], "unknown", "bound text starts unknown");
  assert.equal(ids.get("panel_Encoder_Count")!.attrs["data-cb-value"], undefined, "bound text never carries indicator state, so state styling cannot hide its value");
  assert.equal(ids.get("carton_tpl")!.attrs["data-cb-template"], "");
  assert.equal(ids.get("peEntry_anchor")!.attrs.role, "button");
  assert.ok(!/opc\.tcp|password|MODEL_API_KEY/i.test(doc));
});

test("generation request format is fully preserved, keyless and bounded to one call", async () => {
  const texts = { equipmentText: ctx.equipmentText, contractText: jsonText(ctx.contract), assumptionsText: ctx.sources.worldAssumptions.text, specificationText: ctx.sources.specification.text, worldManifestText: ctx.sources.worldManifest.text };
  const input = { requestId: "req-test", createdAt: "2026-10-31T00:00:00.000Z", endpoint: "https://api.meta.ai/v1/responses", model: "muse-wonder-1.0", maxOutputTokens: 32000, reservationUsd: 1, perRequestHardUsd: 1, timeoutMs: 420000, equipment: ctx.equipment as EquipmentFile, contract: ctx.contract, texts, paths: { equipment: "e", contract: "c", assumptions: "a", specification: "s", worldManifest: "w" } };
  const a = await buildGenerationRequest(input);
  const b = await buildGenerationRequest(input);
  assert.deepEqual(a, b, "deterministic");
  assert.equal(a.bodySha256, sha256(JSON.stringify(a.body)));
  assert.deepEqual(a.budget, { reservationUsd: 1, perRequestHardUsd: 1, timeoutMs: 420000, maxCalls: 1, automaticRetries: 0, repairCalls: 0 });
  assert.deepEqual(a.inputs.map(i => i.role), ["specification", "equipment", "binding_contract", "world_manifest", "world_assumptions", "view_protocol"]);
  assert.equal(a.inputs[0]!.sha256, ctx.sources.specification.sha256);
  const body = JSON.stringify(a.body);
  assert.ok(!/authorization|bearer|MODEL_API_KEY/i.test(body));
  assert.equal((a.body.text as { format: { strict: boolean } }).format.strict, true);
  assert.deepEqual(outputSchema.required, ["svg", "entityPaths", "bindings", "layoutAssumptions", "designNotes"]);
  assert.match(String((a.body.input as Array<{ content: string }>)[0]!.content), /NOT the PLC HMI/);
});

test("preserved Muse Wonder package still validates against the frozen contract and its recorded hashes", async () => {
  const latest = JSON.parse(await read("artifacts/machine-view/latest.json")) as { relativeDirectory: string; packageId: string };
  const dir = latest.relativeDirectory;
  const files: Record<string, string> = {};
  for (const name of ["view.manifest.json", "equipment.json", "view-bindings.json", "view.svg"]) files[name] = await read(`${dir}/${name}`);
  const { report, pkg: generated } = await validatePackage({ files, contract: ctx.contract, worldManifestText: ctx.sources.worldManifest.text });
  assert.deepEqual(report.errors, []);
  assert.equal(report.viewValid, true);
  assert.equal(report.packageId, latest.packageId);
  const record = JSON.parse(await read(`${dir}/generation.json`));
  assert.equal(record.status, "completed");
  if (record.purpose === "machine_view_refinement") {
    if (record.disposition !== "promoted") {
      // Promoted later, without a model call, after a host fix; the decision is preserved.
      const promotion = JSON.parse(await read(`${dir}/promotion.json`));
      assert.equal(promotion.disposition, "promoted_after_host_fix");
      assert.equal(promotion.modelCalls, 0);
      assert.equal(promotion.candidate.auditErrors, 0);
      assert.ok(promotion.candidate.auditErrors < promotion.incumbent.auditErrors);
    } else assert.ok(record.audit.errors < record.parent.audit.errors, "promoted refinement has fewer audit errors than its parent");
    const audit = JSON.parse(await read(`${dir}/audit/audit.json`));
    assert.equal(audit.svgSha256, sha256(files["view.svg"]!), "audit covers the promoted SVG");
    assert.equal(audit.counts.error, 0);
    const parentRecord = JSON.parse(await read(`${record.parent.relativeDirectory}/generation.json`));
    assert.equal(parentRecord.status, "completed", "parent generation stays preserved");
  } else assert.equal(record.repairLineage.length, 0);
  assert.deepEqual(record.hashes.files, generated!.manifest.files);
  const requestRecord = JSON.parse(await read(`${dir}/generation/request.json`));
  assert.equal(sha256(JSON.stringify(requestRecord.body)), record.request.bodySha256, "preserved request body matches its recorded hash");
  assert.ok(!/authorization|bearer/i.test(await read(`${dir}/generation/request.json`)));
  const output = await read(`${dir}/generation/output.json`);
  assert.equal(sha256(output), record.hashes.outputText);
  assert.equal(JSON.parse(output).svg, files["view.svg"], "package SVG is the unmodified model output");
  const frames = replaySnapshots((JSON.parse(await read(`${ctx.latest}/gate-b-trace.json`)) as { runs: TraceRun[] }).runs.find(r => r.label === "cp6-routed-b")!, { packageId: generated!.manifest.packageId, channels: ctx.contract.channels, evidenceClass: "surrogate_contract" });
  for (const f of frames) assert.deepEqual(render(f, generated!).missing, []);
});

test("easing is offered only between consecutive, current frames and never for degraded values", () => {
  const a = snapshot({ sequence: 4, sourceTimeMs: 400, raw: { D1_Position: 20, Encoder_Count: 100 } });
  const b = snapshot({ sequence: 5, sourceTimeMs: 500, raw: { D1_Position: 40, Encoder_Count: 150 } });
  assert.equal(tweenFor(a, b, 0), 100);
  assert.equal(tweenFor(null, b, 0), 0);
  assert.equal(tweenFor(a, { ...b, frame: { ...b.frame, sequence: 9 } }, 0), 0, "a jump or scrub snaps");
  assert.equal(tweenFor(a, { ...b, link: { state: "stale", ageMs: 900, reason: null } }, 0), 0, "stale snaps");
  assert.equal(tweenFor(a, { ...b, frame: { ...b.frame, sourceTimeMs: 2400 } }, 0), 0, "a long gap snaps");
  assert.equal(tweenFor({ ...a, frame: { ...a.frame, sourceTimeMs: null } }, { ...b, frame: { ...b.frame, sourceTimeMs: null } }, 400), MAX_TWEEN_MS, "live arrival gap is capped");
  const motionOf = (s: ViewSnapshot, id: string) => resolveFrame(pkg, s).find((op): op is Extract<FrameOp, { op: "attrs" }> => op.op === "attrs" && op.id === id)?.motion;
  assert.deepEqual(motionOf(b, "divert1_paddle"), { kind: "rotate", angle: 12, px: 0, py: -20 });
  assert.equal(motionOf({ ...b, link: { state: "stale", ageMs: 900, reason: null } }, "divert1_paddle"), undefined, "stale value: exact end state, no easing data");
  assert.equal(motionOf(snapshot({ quality: { "world.D1_Position": "bad" } }), "divert1_paddle"), undefined);
  const withCarton = snapshot({ entities: [{ id: "c1", type: "carton", state: { positionM: 1, path: "main", itemId: "X", requestedRoute: null, velocityMps: 0.5, jammed: false } }] });
  const item = resolveFrame(pkg, withCarton).find((op): op is Extract<FrameOp, { op: "entities" }> => op.op === "entities")!.items[0]!;
  assert.deepEqual(item.motion, { kind: "pose", x: 260, y: 200, angle: 0 });
  assert.match(runtimeSource("t"), /prefers-reduced-motion/);
});

test("presentation audit measures overlap, indicator cover, clipping, smeared text and motion", () => {
  const item = (key: string, x: number, y: number, w = 40, h = 12, extra: Partial<MeasuredItem> = {}): MeasuredItem => ({ key, kind: "text", text: key, box: { x, y, width: w, height: h }, fontPx: 12, owner: null, moving: false, ...extra });
  const findings = auditLayout([{ scenario: "s", viewport: { x: 0, y: 0, width: 500, height: 300 }, items: [
    item("a", 10, 10), item("b", 30, 12),
    item("c", 100, 100), item("lamp", 105, 100, 10, 10, { kind: "indicator" }),
    item("edge", 480, 50),
    item("smear", 200, 200, 40, 12, { strokePx: 2.2 }),
    item("carton", 30, 14, 40, 12, { moving: true, owner: "clone:1" }),
    item("tiny", 300, 250, 30, 10, { fontPx: 9 })
  ] }]);
  const cats = (c: string) => findings.filter(f => f.category === c);
  assert.deepEqual(cats("text_overlap").map(f => f.elements), [["a", "b"]]);
  assert.deepEqual(cats("text_on_indicator").map(f => f.elements), [["c", "lamp"]]);
  assert.deepEqual(cats("outside_view").map(f => f.elements), [["edge"]]);
  assert.ok(cats("transient_overlap").length >= 1 && cats("transient_overlap").every(f => f.severity === "warning"));
  assert.ok(cats("legibility").some(f => f.severity === "error" && f.elements[0] === "smear"));
  assert.ok(cats("legibility").some(f => f.severity === "warning" && f.elements.includes("tiny")));
  const motion = auditMotion(pkg, { routed: replaySnapshotsFor("cp5-routed-a") });
  assert.equal(motion.summary.carton.jumps, 0);
  assert.equal(motion.summary.carton.medianStepPx, 10, "0.05 m per 100 ms frame at 200 px/m");
  // The fixture's belt marks repeat every 20 px but move 10 px per frame: they would strobe.
  assert.equal(motion.summary.belt.aliasRisk, true);
  assert.ok(motion.findings.some(f => f.id === "M03" && f.severity === "error"));
  const report = buildAuditReport("p", findings, motion, ["s"]);
  assert.equal(report.passed, false);
  assert.match(describeFindings(report), /\[error\/text_overlap\]/);
});
