// Independent validation of a generated world package. Runs only inside the worker process
// (scripts/project-validate-worker.js), never in the HTTP/UI host. Generic checks apply to any
// package: compile, structure, initialization, signal direction/types, finite values, determinism,
// snapshot/migrate/dispose and the package's own tests. The M8 conveyor profile adds physics checks
// located by signal role, not by the prepared example's geometry or speed. Each failure is
// classified so repair requests carry diagnostics; no check is relaxed to make a package pass.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { GeneratedWorldModule, RawValue, WorldManifest, WorldSignal } from "../proof/contracts.ts";
import { validateManifest } from "../proof/manifest.ts";
import { InstrumentedWorldContext } from "../proof/world-context.ts";
import { canonical } from "../campaign/ledger.ts";

import type { CheckGroup, Classification, ValidationCheck, ValidationResult } from "./types.ts";
export type { CheckGroup, Classification, ValidationCheck, ValidationResult } from "./types.ts";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const INT_RANGE: Record<string, [number, number]> = { SINT: [-128, 127], USINT: [0, 255], INT: [-32768, 32767], UINT: [0, 65535], DINT: [-2147483648, 2147483647], UDINT: [0, 4294967295] };

function run(command: string, args: string[], timeoutMs: number, cwd: string): Promise<{ code: number | null; output: string; timedOut: boolean; ms: number }> {
  const started = Date.now();
  return new Promise(resolve => {
    execFile(command, args, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: safeEnv() },
      (error, stdout, stderr) => resolve({ code: error ? (typeof (error as any).code === "number" ? (error as any).code : 1) : 0, output: `${stdout}${stderr}`,
        timedOut: Boolean(error && (error as any).killed), ms: Date.now() - started }));
  });
}

export function typeOk(signal: WorldSignal, value: RawValue): string | undefined {
  if (signal.dataType === "BOOL") return typeof value === "boolean" ? undefined : `${signal.id} must be BOOL, got ${JSON.stringify(value)}`;
  if (signal.dataType === "STRING") return typeof value === "string" ? undefined : `${signal.id} must be STRING`;
  if (typeof value !== "number" || !Number.isFinite(value)) return `${signal.id} must be a finite ${signal.dataType}, got ${JSON.stringify(value)}`;
  if (signal.dataType === "REAL") return Number.isFinite(Math.fround(value)) ? undefined : `${signal.id} overflows REAL`;
  const [min, max] = INT_RANGE[signal.dataType]!;
  return Number.isInteger(value) && value >= min && value <= max ? undefined : `${signal.id} must be an integer ${signal.dataType} in [${min}, ${max}], got ${value}`;
}

/** Drives a world deterministically through the context the coordinator uses. */
class Harness {
  readonly world: GeneratedWorldModule; readonly ctx: InstrumentedWorldContext; readonly manifest: WorldManifest;
  outputs: Record<string, RawValue>; sequence = 0;
  constructor(world: GeneratedWorldModule, seed: number) {
    this.world = world; this.manifest = world.manifest;
    this.ctx = new InstrumentedWorldContext(world.manifest, { seed, worldVersion: world.manifest.packageVersion });
    this.outputs = Object.fromEntries(world.manifest.signals.filter(s => s.direction === "plc_to_world").map(s => [s.id, s.normalValue]));
  }
  async init() { await this.world.initialize(this.ctx, { seed: 1, worldVersion: this.manifest.packageVersion }); }
  async step() {
    const frame = { sequence: ++this.sequence, observedAtMs: this.ctx.time.nowMs, values: { ...this.outputs } };
    this.ctx.setPlcFrame(frame); await this.world.onPlcFrame(this.ctx, frame);
    await this.world.tick(this.ctx, this.ctx.advance(this.manifest.tickMs));
    for (const control of this.ctx.takeDueControls()) await this.world.onControl(this.ctx, control);
  }
  async run(ms: number, each?: (h: Harness) => void) { for (let t = 0; t < ms; t += this.manifest.tickMs) { await this.step(); each?.(this); } }
  inputs() { return this.ctx.plc.currentInputState(); }
  positions(): Record<string, number> {
    return Object.fromEntries([...this.ctx.entityState.values()].filter(e => typeof e.state.positionM === "number").map(e => [e.id, e.state.positionM as number]));
  }
}

export async function validatePackage(dir: string, options: { profile: "m8-conveyor" | "generic"; seed?: number }): Promise<ValidationResult> {
  const started = Date.now(), startedAtIso = new Date().toISOString();
  const checks: ValidationCheck[] = [], measured: Record<string, number | string> = {};
  const add = (id: string, group: CheckGroup, title: string, ok: boolean | "skipped", detail: string, classification?: Classification) =>
    checks.push({ id, group, title, status: ok === "skipped" ? "skipped" : ok ? "pass" : "fail", detail, ...(ok === false && classification ? { classification } : {}) });
  const worldFile = join(dir, "world.ts"), testFile = join(dir, "world.test.ts"), manifestFile = join(dir, "world.manifest.json");
  const result = (): ValidationResult => ({ schema: "controlsbench.world-validation.v1", ok: checks.every(c => c.status !== "fail"), startedAtIso, durationMs: Date.now() - started,
    profile: options.profile, ...(existsSync(worldFile) ? { worldSha256: sha(readFileSync(worldFile)) } : {}), ...(existsSync(manifestFile) ? { manifestSha256: sha(readFileSync(manifestFile)) } : {}), checks, measured });

  // 1. Compile under strict TypeScript, from a temporary config so the package stays portable.
  const tmp = mkdtempSync(join(tmpdir(), "cb-validate-"));
  try {
    writeFileSync(join(tmp, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2024", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true,
      allowImportingTsExtensions: true, skipLibCheck: true, types: ["node"], typeRoots: [join(repo, "node_modules/@types")] }, files: [worldFile, testFile, join(dir, "contracts.ts")] }));
    const tsc = await run(process.execPath, [join(repo, "node_modules/typescript/bin/tsc"), "-p", join(tmp, "tsconfig.json"), "--pretty", "false"], 120_000, dir);
    const diagnostics = tsc.output.split(/\r?\n/).filter(l => /error TS\d+/.test(l)).map(l => l.replaceAll(dir.replaceAll("\\", "/"), ".").replaceAll(dir, ".")).slice(0, 40);
    add("compile.strict", "compile", "Strict TypeScript compile", tsc.code === 0 && !tsc.timedOut, tsc.timedOut ? "Compiler timed out" : tsc.code === 0 ? "No compiler errors" : diagnostics.join("\n") || tsc.output.slice(0, 2000), "compiler");
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  // 2. Structure: the module the child would load, and its manifest file.
  let world: GeneratedWorldModule;
  try {
    const module = await import(`${pathToFileURL(worldFile).href}?validate=${Date.now()}`);
    world = module.default;
    const missing = ["initialize", "onPlcFrame", "onControl", "tick", "snapshot", "migrate", "dispose"].filter(k => typeof (world as any)?.[k] !== "function");
    if (!world || missing.length || module.world !== world) throw new Error(`Module must export world as both named and default with ${missing.join(", ") || "all lifecycle methods"}`);
    validateManifest(world.manifest);
    add("structure.module", "structure", "Module exports and lifecycle", true, "Named and default world export with all lifecycle methods");
  } catch (error) { add("structure.module", "structure", "Module exports and lifecycle", false, String((error as Error).message).slice(0, 1500), "structural"); return result(); }
  const fileManifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  add("structure.manifest", "structure", "Manifest file matches the module manifest", canonical(fileManifest) === canonical(world.manifest),
    "world.manifest.json must equal the manifest the module exports", "structural");
  const inputs = world.manifest.signals.filter(s => s.direction === "world_to_plc");

  // 3. Generic runtime behavior.
  const imageProblems = (image: Readonly<Record<string, RawValue>>) => inputs.map(s => typeOk(s, image[s.id])).filter((x): x is string => !!x);
  try {
    const h = new Harness(world, options.seed ?? 20261103);
    await h.init();
    const afterInit = imageProblems(h.inputs());
    add("runtime.initialize", "runtime", "Initialize establishes a typed normal image", !afterInit.length, afterInit.join("; ") || `${inputs.length} raw inputs typed after initialize`, "behavioral");
    const problems = new Set<string>();
    await h.run(3000, x => imageProblems(x.inputs()).forEach(p => problems.add(p)));
    add("runtime.finite", "runtime", "Raw inputs stay typed and finite while idle", !problems.size, [...problems].slice(0, 10).join("; ") || "3 s idle at normal PLC outputs", "behavioral");
    const snapshot = await world.snapshot(h.ctx);
    const roundTrip = JSON.parse(JSON.stringify(snapshot));
    const migrated = await world.migrate(h.ctx, roundTrip, { fromWorldVersion: world.manifest.packageVersion, toWorldVersion: world.manifest.packageVersion });
    add("runtime.snapshot", "runtime", "Snapshot is JSON-safe and migrates", canonical(roundTrip) === canonical(snapshot) && !!migrated && typeof migrated === "object", "Snapshot round-trips through JSON and migrate returns a snapshot", "structural");
    await world.dispose(h.ctx, "validation");
    const a = new Harness(world, 7), b = new Harness(world, 7);
    await a.init(); await b.init(); await a.run(1000); await b.run(1000);
    add("runtime.deterministic", "runtime", "Same seed and inputs give the same image", canonical(a.inputs()) === canonical(b.inputs()), "Two seeded runs compared after 1 s", "behavioral");
  } catch (error) { add("runtime.exception", "runtime", "World runs without throwing", false, String((error as Error).stack ?? error).slice(0, 1500), "behavioral"); }

  // 4. Conveyor physics by role (M8 conveyor profile).
  if (options.profile === "m8-conveyor") {
    try { await conveyorPhysics(world, add, measured); }
    catch (error) { add("physics.exception", "physics", "Conveyor physics scenario runs", false, String((error as Error).stack ?? error).slice(0, 1500), "behavioral"); }
  }

  // 5. The package's own tests, in a separate process with a deadline.
  const tests = await run(process.execPath, ["--test", "--test-reporter=spec", testFile], 90_000, dir);
  const count = (label: string) => Number(new RegExp(`ℹ ${label} (\\d+)`).exec(tests.output)?.[1] ?? NaN);
  const pass = count("pass"), fail = count("fail");
  const r = result();
  r.generatedTests = { pass: Number.isFinite(pass) ? pass : 0, fail: Number.isFinite(fail) ? fail : 0, durationMs: tests.ms };
  checks.push({ id: "tests.generated", group: "generated_tests", title: "Package's own physical-invariant tests", status: tests.code === 0 && !tests.timedOut && pass > 0 ? "pass" : "fail",
    detail: tests.timedOut ? "Generated tests timed out" : tests.code === 0 ? `${pass} passed` : tests.output.split(/\r?\n/).filter(l => /✖|not ok|Error|assert/i.test(l)).slice(0, 30).join("\n").slice(0, 3000),
    ...(tests.code === 0 && pass > 0 ? {} : { classification: "test_defect" as const }) });
  return { ...result(), generatedTests: r.generatedTests };
}

async function conveyorPhysics(world: GeneratedWorldModule, add: (id: string, group: CheckGroup, title: string, ok: boolean | "skipped", detail: string, c?: Classification) => void, measured: Record<string, number | string>) {
  const role = (r: string) => world.manifest.signals.find(s => s.role === r);
  const run = role("drive.runCommand"), feedback = role("drive.runningFeedback"), encoder = role("motion.encoderCount"), entry = role("sensor.entry");
  const speed = world.manifest.signals.find(s => s.direction === "world_to_plc" && s.dataType === "REAL" && /speed/i.test(`${s.id} ${s.role}`));
  if (!run || !feedback || !encoder || !entry) { add("physics.roles", "physics", "Drive, feedback, encoder and entry roles", false, "Required roles missing; physics not checked", "structural"); return; }
  const h = new Harness(world, 11);
  await h.init();
  const enc = () => Number(h.inputs()[encoder.id]), fb = () => h.inputs()[feedback.id] === true, sp = () => speed ? Number(h.inputs()[speed.id]) : NaN;
  // Stopped: nothing moves, including an introduced item.
  const enc0 = enc();
  try { await world.onControl(h.ctx, { id: "carton.introduce", payload: { itemId: "VAL-1", cartonId: "VAL-1", requestedRoute: null }, cause: "validation" }); }
  catch (error) { add("physics.introduce", "physics", "Item introduction control accepts a minimal payload", false, String((error as Error).message).slice(0, 500), "behavioral"); }
  const p0 = h.positions();
  await h.run(1500);
  const p1 = h.positions();
  const movedWhileStopped = Object.keys(p0).filter(id => p1[id] !== undefined && Math.abs(p1[id]! - p0[id]!) > 1e-9);
  add("physics.no_motion_stopped", "physics", "No motion, feedback or encoder change without a run command", enc() === enc0 && !fb() && !movedWhileStopped.length,
    `encoder ${enc0}→${enc()}, feedback ${fb()}, items moved: ${movedWhileStopped.join(", ") || "none"}`, "behavioral");
  // Running: feedback, encoder and items advance; record measured behavior.
  h.outputs[run.id] = true;
  let firstFeedbackMs = NaN, firstEntryMs = NaN, maxSpeed = 0;
  const runStart = h.ctx.time.nowMs, encStart = enc(), pStart = h.positions();
  await h.run(4000, x => {
    const t = x.ctx.time.nowMs - runStart;
    if (Number.isNaN(firstFeedbackMs) && fb()) firstFeedbackMs = t;
    if (Number.isNaN(firstEntryMs) && x.inputs()[entry.id] === true) firstEntryMs = t;
    if (Number.isFinite(sp())) maxSpeed = Math.max(maxSpeed, sp());
  });
  const encWindowStart = enc(); await h.run(1000); const encRate = enc() - encWindowStart;
  const pEnd = h.positions();
  const advanced = Object.keys(pStart).filter(id => pEnd[id] !== undefined && pEnd[id]! > pStart[id]!);
  Object.assign(measured, { steadySpeedMps: Number.isFinite(sp()) ? Number(sp().toFixed(4)) : "not reported", encoderCountsPerSecond: encRate,
    runCommandToFeedbackMs: Number.isNaN(firstFeedbackMs) ? "never" : firstFeedbackMs, runCommandToEntrySensorMs: Number.isNaN(firstEntryMs) ? "never" : firstEntryMs });
  if (Number.isFinite(sp()) && sp() > 0) measured.encoderCountsPerMetre = Number((encRate / sp()).toFixed(1));
  add("physics.run_feedback", "physics", "Run command produces running feedback through drive dynamics", !Number.isNaN(firstFeedbackMs), `first feedback after ${firstFeedbackMs} ms`, "behavioral");
  add("physics.encoder_motion", "physics", "Encoder counts advance with belt travel", enc() > encStart && encRate > 0, `encoder ${encStart}→${enc()}, ${encRate} counts in the last second`, "behavioral");
  add("physics.item_motion", "physics", "Introduced item moves under the running drive", advanced.length > 0 || !Object.keys(pStart).length, Object.keys(pStart).length ? `${advanced.length} of ${Object.keys(pStart).length} items advanced` : "No item entity published; motion not observable", "behavioral");
  // Stop: decelerate (not an instantaneous jump), then hold.
  h.outputs[run.id] = false;
  const speeds: number[] = [];
  await h.run(5000, () => speeds.push(sp()));
  const encAtRest = enc(), pRest = h.positions(); await h.run(1000);
  const stoppedMoving = enc() === encAtRest && Object.keys(pRest).every(id => h.positions()[id] === undefined || h.positions()[id] === pRest[id]);
  const finiteSpeeds = speeds.filter(Number.isFinite);
  const ticksToZero = finiteSpeeds.findIndex(v => v <= 1e-9);
  const nonIncreasing = finiteSpeeds.every((v, i) => i === 0 || v <= finiteSpeeds[i - 1]! + 1e-9);
  measured.stopToRestMs = ticksToZero < 0 ? "not at rest within 5 s" : (ticksToZero + 1) * world.manifest.tickMs;
  add("physics.decelerate_hold", "physics", "Stop decelerates monotonically to rest and then holds", ticksToZero >= 0 && nonIncreasing && stoppedMoving && (ticksToZero > 0 || maxSpeed === 0),
    `speed ${finiteSpeeds[0]?.toFixed(3) ?? "?"}→0 in ${measured.stopToRestMs} ms; ${stoppedMoving ? "holds at rest" : "still moving after rest"}`, "behavioral");
}

/** Generated code and its tests never see model keys or credentials. */
export function safeEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SystemRoot", "windir", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG"];
  return Object.fromEntries(keep.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]])) as NodeJS.ProcessEnv;
}
