// W4 zero-model commissioning harness and W4 held-state recovery, offline. Every harness run is the
// real script with the real CampaignRuntime and the isolated child; every recovery run is the real
// script. The bench fixture (test/fixtures/w4-bench-transport.ts) is a protocol fixture with scripted
// reactions, never an M8 oracle: these tests prove the harness/recovery control flow, evidence and
// refusals, not PLC behavior. Recovery assertions count the fixture's recorded writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createTransport, editBenchState, readBenchValue } from "./fixtures/w4-bench-transport.ts";
import { AT_REST, ReadOnlyTransport, classifyHeldState, commissioningQualification, recordedChildExited } from "../scripts/lib/w4-commissioning.ts";
import type { HeldState, Inspection } from "../scripts/lib/w4-commissioning.ts";
import { rawInputs } from "../src/live/m8-map.ts";
import type { RawValue } from "../src/proof/contracts.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/w4-bench-transport.ts", import.meta.url));
const evidence = process.env.W4_COMMISSIONING_EVIDENCE;
const offlineEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^OPC_|KEY|TOKEN|SECRET|PASSWORD|^CONTROLSBENCH_WONDER/i.test(k))) as NodeJS.ProcessEnv;
interface Run { code: number | null; stdout: string; stderr: string; summary: Record<string, any> }
function node(script: string, args: string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env: offlineEnv(), windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => { stdout += d; }); child.stderr.on("data", d => { stderr += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${script} timed out\n${stdout}\n${stderr}`)); }, 150_000);
    child.on("exit", code => { clearTimeout(timer); const last = stdout.trim().split(/\r?\n/).at(-1) ?? "{}";
      let summary = {}; try { summary = JSON.parse(last); } catch { summary = { unparsed: last }; } resolve({ code, stdout, stderr, summary }); });
  });
}
const lines = (file: string) => existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) : [];
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
function bench(name: string, options: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), `w4-${name}-`));
  const stateFile = join(dir, "bench.json"), lock = join(dir, "offline.lock"), runs = join(dir, "runs");
  let recoveries = 0;
  const b = { dir, stateFile, lock, runs,
    harness: (args: string[] = [], extra: Record<string, unknown> = {}) => node("scripts/run-w4-commissioning.js", ["--offline", "--transport-module", fixture,
      "--transport-options", JSON.stringify({ stateFile, writesFile: join(dir, "harness-writes.jsonl"), ...options, ...extra }), "--ownership", lock, "--artifacts", runs, ...args]),
    recover: async (run: string, args: string[] = []) => {
      const writesFile = join(dir, `recovery-writes-${++recoveries}.jsonl`);
      const out = await node("scripts/recover-w4-held.js", [run, "--offline", "--transport-module", fixture, "--transport-options", JSON.stringify({ stateFile, writesFile }),
        "--ownership", lock, "--artifacts", runs, ...args]);
      return { ...out, writes: lines(writesFile), result: out.summary.directory ? json(join(out.summary.directory, "result.json")) : null };
    },
    keep: (label: string, path: string) => { if (evidence) cpSync(path, join(evidence, "samples", label), { recursive: true }); },
    cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  return b;
}
const heldSha = (run: string) => json(join(run, "result.json")).heldState.sha256 as string;

test("commissioning refuses before any PLC write: held lock, unclean baseline, live-mode test hooks", async () => {
  const b = bench("refusals");
  try {
    writeFileSync(b.lock, JSON.stringify({ owner: "someone-else" }));
    const held = await b.harness();
    assert.equal(held.code, 1); assert.equal(held.summary.status, "refused"); assert.match(held.summary.error, /Runtime ownership is held/);
    assert.equal(existsSync(b.stateFile), false, "no transport was opened"); assert.equal(existsSync(join(held.summary.directory, "inspection-transport.jsonl")), false);
    rmSync(b.lock);
    createTransport({ stateFile: b.stateFile }).persist();
    editBenchState(b.stateFile, { values: { "controller.Mode": 1, "controller.ModeText": "Auto", Motor_RunCmd: true } });
    const unclean = await b.harness();
    assert.equal(unclean.code, 1); assert.equal(unclean.summary.status, "refused"); assert.match(unclean.summary.error, /Baseline is not a clean stopped M8 state \(controller\.Mode=1, Motor_RunCmd=true\)/);
    assert.equal(lines(join(b.dir, "harness-writes.jsonl")).length, 0); assert.equal(existsSync(b.lock), false);
    assert.equal(existsSync(join(unclean.summary.directory, "wonder-process")), false, "no child session was started");
    const baseline = json(join(unclean.summary.directory, "baseline.json"));
    assert.equal(baseline.refusedWrites, 0); assert.equal(baseline.summary.mode, "Auto");
    const live = await node("scripts/run-w4-commissioning.js", ["--offline-abort-at", "x", "--artifacts", b.runs]);
    assert.equal(live.code, 1); assert.match(live.summary.error, /Offline test hooks are refused in live mode/);
    const livePins = await node("scripts/run-w4-commissioning.js", ["--artifacts", b.runs]);
    assert.equal(livePins.code, 1); assert.match(livePins.summary.error, /(uncommitted src\/scripts\/test changes|Pinned adapter commit)/);
  } finally { b.cleanup(); }
});

test("offline commissioning passes end to end through the real runtime and isolated child", async () => {
  const b = bench("pass");
  try {
    const out = await b.harness();
    assert.equal(out.code, 0, out.stdout + out.stderr); assert.equal(out.summary.status, "pass");
    const run = out.summary.directory, r = json(join(run, "result.json"));
    assert.deepEqual(r.phases.map((p: any) => `${p.name}:${p.status}`), ["preconditions:pass", "baseline:pass", "session:pass", "normal:pass", "leases:pass", "fault:pass", "shutdown:pass"]);
    assert.equal(r.scope, "offline-fake-transport"); assert.equal(r.evidenceClass, "fake_connector"); assert.equal(r.modelCalls, 0); assert.equal(r.paidCalls, 0);
    const leases = r.measurements.leases;
    assert.deepEqual(leases.receipts.map((x: any) => [x.mode, x.state, x.valid]), [["hold", "released", true], ["continue", "released", true], ["condition_deadline", "released", true],
      ["condition_deadline", "condition_met", false], ["condition_deadline", "released", true], ["continue", "expired", false]]);
    assert(leases.receipts.at(-1).elapsedMs >= 400 && leases.receipts.at(-1).elapsedMs < 1500, "child expired the lease during the parent stall");
    assert(leases.stallCommits.stallMs >= 1500 && leases.stallCommits.childCommitsDuringStall >= 10 && leases.stallCommits.maxGapMs < 300, JSON.stringify(leases.stallCommits));
    for (const hold of [leases.conditionHold, leases.expiryHold]) { assert.equal(hold.distinctImages, 1); assert(BigInt(hold.plcCycleLast) > BigInt(hold.plcCycleFirst)); }
    assert.equal(r.measurements.cadence.gapsOver300Ms, 0); assert.deepEqual(r.measurements.cadence.faults, []);
    assert.deepEqual(r.finalState.postStopBaselineMismatches, []); assert.equal(r.finalState.postStopMatchesApplied, true); assert.equal(r.finalState.ownership, "released");
    assert.equal(existsSync(b.lock), false); assert.equal(existsSync(join(run, "held-state.json")), false); assert.equal(r.child.exit.code, 0);
    const ledger = lines(join(run, "campaign.jsonl"));
    for (const late of ["late-after-condition", "late-after-expiry"]) assert(!ledger.some(e => e.type === "action.requested" && e.data.actionId === late), `${late} never ran`);
    assert(ledger.some(e => e.type === "fault.truth" && e.data.truth.controlId === "fault.setOverload"));
    assert.equal(ledger.filter(e => e.type === "campaign.state").at(-1).data.state, "completed");
    assert.equal(readBenchValue(b.stateFile, "controller.CountExitA"), 1); assert.equal(readBenchValue(b.stateFile, "controller.CountRunout"), 1);
    b.keep("pass", run);
  } finally { b.cleanup(); }
});

test("held mid-transit: exact record, transit-pending refusal, changed preconditions refused, authorized reconciliation", async () => {
  const b = bench("transit");
  try {
    const out = await b.harness(["--offline-abort-at", "normal:carton-in-transit"]);
    assert.equal(out.code, 1); assert.equal(out.summary.status, "held");
    const run = out.summary.directory, held: HeldState = json(join(run, "held-state.json"));
    // The record carries the exact applied identity, image and item state the fixture PLC holds.
    assert.equal(held.plc.bootIdentity, "boot-1");
    assert.equal(held.plc.appliedEpoch, readBenchValue(b.stateFile, "GVL_BenchRead.AppliedEpoch")); assert.equal(held.plc.appliedSequence, readBenchValue(b.stateFile, "GVL_BenchRead.AppliedSequence"));
    assert.deepEqual(held.appliedImage, Object.fromEntries(rawInputs.map(k => [k, readBenchValue(b.stateFile, `GVL_BenchRead.Active_${k}`)])));
    assert.equal(held.controller["controller.ItemActive"], true); assert.equal(held.controller["controller.ActiveItemId"], 401); assert.equal(held.world.cartons.length, 1);
    assert.equal(held.inFlightCommit, null); assert.deepEqual(held.inFlightCommands, []); assert.deepEqual(held.outstandingWrites.atClose, []);
    assert.equal(held.ownership.closeResult, "released"); assert.equal(held.ledger.agreesWithChild, true); assert.equal(held.postStopInspection?.activeImageMatchesApplied, true);
    const pending = await b.recover(run);
    assert.equal(pending.code, 1); assert.equal(pending.summary.path, "transit-pending"); assert.equal(pending.writes.length, 0); assert.equal(existsSync(b.lock), false);
    // Stand in for the bench: the recorded H2 transit-timeout evolution of a held Auto carton.
    const sequence = Number(readBenchValue(b.stateFile, "controller.CompletionSequence")), faulted = Number(readBenchValue(b.stateFile, "controller.CountFaulted"));
    editBenchState(b.stateFile, { values: { Motor_RunCmd: false, D1_ExtendCmd: false, StackLight_Red: true, StackLight_Green: false, "controller.Mode": 3, "controller.ModeText": "Faulted",
      "controller.FaultCode": 33, "controller.FaultText": "Carton transit timeout", "controller.ItemActive": false, "controller.Disposition": 4, "controller.CompletionSequence": sequence + 1,
      "controller.CompletionPending": true, "controller.CompletionExit": 0, "controller.CompletionDisposition": 4, "controller.CompletionItemId": 401, "controller.CompletionRoute": 1,
      "controller.CountFaulted": faulted + 1, "controller.EncoderDelta": 0 } });
    const inspected = await b.recover(run);
    assert.equal(inspected.code, 0); assert.equal(inspected.summary.status, "inspected"); assert.equal(inspected.summary.path, "transit-timeout"); assert.equal(inspected.writes.length, 0);
    assert.deepEqual(inspected.result.classification.plan, [{ op: "stop" }, { op: "fresh_world" }, { op: "completion_ack", sequence: sequence + 1 }, { op: "reset" }]);
    const sha = heldSha(run), original = readFileSync(b.stateFile);
    const refused = async (label: string, change: () => void, pattern: RegExp, args = ["--reconcile", "--authorize", sha]) => {
      change();
      const r = await b.recover(run, args);
      assert.equal(r.code, 1, label); assert.match(r.summary.error, pattern, label); assert.equal(r.writes.length, 0, `${label}: no PLC write`);
      writeFileSync(b.stateFile, original);
    };
    await refused("no authorization", () => {}, /--reconcile requires --authorize/, ["--reconcile"]);
    await refused("wrong authorization", () => {}, /--reconcile requires --authorize/, ["--reconcile", "--authorize", "0".repeat(64)]);
    await refused("PLC restarted", () => editBenchState(b.stateFile, { boot: "boot-2" }), /PLC boot identity unchanged/);
    await refused("another writer's sequence", () => editBenchState(b.stateFile, { values: { "GVL_BenchRead.AppliedSequence": "999" } }), /applied epoch\/sequence is the run's own/);
    await refused("changed held image", () => editBenchState(b.stateFile, { values: { "GVL_BenchRead.Active_PE_ExitB": true } }), /active raw image equals/);
    await refused("changed counter", () => editBenchState(b.stateFile, { values: { "controller.CountExitB": 7 } }), /CountExitB unchanged/);
    await refused("different fault", () => editBenchState(b.stateFile, { values: { "controller.FaultCode": 34 } }), /fault 33, Faulted/);
    writeFileSync(b.lock, JSON.stringify({ owner: "someone-else" }));
    await refused("foreign lock", () => {}, /held by another owner/);
    assert.deepEqual(json(b.lock), { owner: "someone-else" }); rmSync(b.lock);
    const heldBytes = readFileSync(join(run, "held-state.json"));
    writeFileSync(join(run, "held-state.json"), Buffer.concat([heldBytes, Buffer.from(" ")]));
    await refused("tampered record", () => {}, /held-state\.json differs from the hash the run recorded/);
    writeFileSync(join(run, "held-state.json"), heldBytes);
    const done = await b.recover(run, ["--reconcile", "--authorize", sha]);
    assert.equal(done.code, 0, done.stdout + done.stderr); assert.equal(done.summary.status, "pass"); assert.equal(done.result.writesAuthorized, true);
    const order = done.writes.map((w: any) => w.items.map((i: any) => i.path.split(".").at(-1)));
    const first = (leaf: string) => order.findIndex((paths: string[]) => paths.includes(leaf));
    assert.equal(first("StopSequence"), 0); assert(first("SessionResetRequest") > 0 && first("CompletionAck") > first("RequestedSequence") && first("ResetSequence") > first("CompletionAck"));
    assert.deepEqual(order.at(-1), ["ResetSequence"]);
    for (const [name, value] of Object.entries({ "controller.Mode": 0, "controller.FaultCode": 0, Motor_RunCmd: false, "controller.ItemActive": false, "controller.CompletionPending": false }))
      assert.equal(readBenchValue(b.stateFile, name), value, name);
    assert.equal(existsSync(b.lock), false);
    b.keep("held-transit", run);
  } finally { b.cleanup(); }
});

test("uncertain write: a hung WCS offer quarantines, the lock is retained, inspection restores it, observation resolves the write", async () => {
  const b = bench("uncertain", { hangWriteMatch: "OfferSequence" });
  try {
    const out = await b.harness(["--offline-timing", JSON.stringify({ operationTimeoutMs: 1500, drainMs: 1500 })]);
    assert.equal(out.summary.status, "held", out.stdout + out.stderr);
    const run = out.summary.directory, held: HeldState = json(join(run, "held-state.json"));
    assert.equal(held.ownership.closeResult, "retained_uncertain"); assert.equal(held.ownership.lockMatchesRun, true);
    assert((held.outstandingWrites.atClose as { paths: string[] }[]).some(w => w.paths.includes("GVL_DemoWrite.OfferSequence")));
    assert(held.outstandingWrites.atQuarantine.length > 0);
    const lockBytes = readFileSync(b.lock);
    const inspected = await b.recover(run);
    assert.equal(inspected.summary.status, "inspected", inspected.stdout + inspected.stderr); assert.equal(inspected.summary.path, "held-running");
    assert.equal(inspected.writes.length, 0); assert.deepEqual(readFileSync(b.lock), lockBytes, "adopted lock restored byte-for-byte");
    assert.equal(inspected.result.ownership.adopted.nonce, held.child.nonce);
    const done = await b.recover(run, ["--reconcile", "--authorize", heldSha(run)]);
    assert.equal(done.summary.status, "pass", done.stdout + done.stderr);
    assert.deepEqual(done.writes[0].items.map((i: any) => i.path), ["GVL_DemoWrite.StopSequence"]);
    assert.equal(readBenchValue(b.stateFile, "controller.Mode"), 0); assert.equal(existsSync(b.lock), false);
    b.keep("held-uncertain-write", run);
  } finally { b.cleanup(); }
});

test("child exit: the dead run's lock is adopted only with its nonce and no live host, then restored after inspection", async () => {
  const b = bench("child-exit", { exitAfterCommits: 14 });
  try {
    const out = await b.harness();
    assert.equal(out.summary.status, "held", out.stdout + out.stderr);
    const run = out.summary.directory, held: HeldState = json(join(run, "held-state.json"));
    assert.equal(held.child.exit?.code, 70); assert.equal(held.outstandingWrites.childClosed, false); assert.equal(held.outstandingWrites.atClose, "not_recorded");
    assert.equal(held.ownership.lockPresent, true); assert.equal(held.ownership.lockMatchesRun, true);
    const lockBytes = readFileSync(b.lock);
    const live = JSON.parse(lockBytes.toString("utf8"));
    writeFileSync(b.lock, JSON.stringify({ ...live, parentPid: process.pid }) + "\n");
    const hostAlive = await b.recover(run);
    assert.equal(hostAlive.code, 1); assert.match(hostAlive.summary.error, /host process \d+ is still running/); assert.equal(hostAlive.writes.length, 0);
    writeFileSync(b.lock, lockBytes);
    // Where the child died (before or after its last commit landed) decides the path; either way inspection writes nothing.
    const inspected = await b.recover(run);
    const c = inspected.result.classification;
    assert(c && ["last_acknowledged", "in_flight"].includes(c.matchedCommit), inspected.stdout + inspected.stderr);
    if (c.matchedCommit === "in_flight" && Object.keys(c.differences).length) assert(c.refusals.some((r: string) => /late in-flight commit/.test(r)));
    assert.equal(inspected.writes.length, 0); assert.deepEqual(readFileSync(b.lock), lockBytes);
    assert.equal(inspected.result.ownership.adopted.nonce, held.child.nonce);
  } finally { b.cleanup(); }
});

test("undeclared PLC fault stops held and is refused as outside the recorded paths", async () => {
  const b = bench("fault12", { unexpectedFault: { code: 12, text: "Motor running feedback lost", afterItemCommits: 3 } });
  try {
    const out = await b.harness();
    assert.equal(out.summary.status, "held"); assert.match(out.summary.error, /Unexpected M8 fault 12/);
    const run = out.summary.directory, held: HeldState = json(join(run, "held-state.json"));
    assert.equal(held.controller["controller.FaultCode"], 12); assert.equal(held.controller["controller.CompletionPending"], true); assert.equal(held.controller["controller.CompletionDisposition"], 4);
    const r = await b.recover(run, ["--reconcile", "--authorize", heldSha(run)]);
    assert.equal(r.code, 1); assert.equal(r.summary.path, null); assert.match(r.summary.error, /held state matches a recorded W4 reconciliation path/); assert.equal(r.writes.length, 0);
    assert.equal(existsSync(b.lock), false);
  } finally { b.cleanup(); }
});

test("a run held at the stopped baseline needs no reconciliation and is not written", async () => {
  const b = bench("stopped");
  try {
    const out = await b.harness(["--offline-abort-at", "shutdown:stopped"]);
    assert.equal(out.summary.status, "held");
    const r = await b.recover(out.summary.directory, ["--reconcile", "--authorize", heldSha(out.summary.directory)]);
    assert.equal(r.code, 0, r.stdout + r.stderr); assert.equal(r.summary.status, "no_reconciliation_required"); assert.equal(r.summary.path, "stopped-clean"); assert.equal(r.writes.length, 0);
    assert.equal(existsSync(b.lock), false);
  } finally { b.cleanup(); }
});

// Synthetic records for the recorded paths the bench fixture does not reach.
const image = (over: Record<string, RawValue> = {}) => ({ ...Object.fromEntries(rawInputs.map(k => [k, typeof AT_REST[k] === "boolean" ? AT_REST[k] : k.endsWith("_Ready") ? true : k === "Drive_Overload" ? false : 0])), ...over });
function synthetic(R: Record<string, RawValue>, over: Partial<HeldState> = {}, applied = image()): HeldState {
  return { lastAcknowledgedCommit: { epoch: "11", sequence: "5", slot: 0, acknowledgedAtIso: "", image: applied }, inFlightCommit: null, inFlightCommands: [],
    lastObservation: { observedAtIso: "", plcCycle: "1", values: R, activeImage: applied }, plc: { bootIdentity: "boot-1" },
    outstandingWrites: { atClose: [], atQuarantine: [], settledAfterQuarantine: [], childClosed: true }, world: { cartons: [], injectedFaults: [], clearedFaults: [] }, ...over } as unknown as HeldState;
}
const current = (C: Record<string, RawValue>, activeImage = image(), applied = { epoch: "11", sequence: "5" }): Inspection =>
  ({ observation: { bootIdentity: "boot-1", simulationApplied: true, appliedEpoch: applied.epoch, appliedSequence: applied.sequence, values: C }, activeImage }) as unknown as Inspection;
const stopped: Record<string, RawValue> = { "controller.Mode": 0, "controller.ModeText": "Stopped", "controller.FaultCode": 0, "controller.FaultText": "", "controller.ItemActive": false,
  "controller.CompletionPending": false, Motor_RunCmd: false, StackLight_Red: false, "controller.StartAck": 4, "controller.StartAccepted": true, "controller.ResetAck": 2,
  "controller.ResetAccepted": true, "controller.CountExitA": 1, "controller.CountExitB": 0, "controller.CountRunout": 0, "controller.CountMisroute": 0, "controller.CountFaulted": 0 };

test("classification: recorded overload and start-feedback paths, late commit settlement, and refusals", () => {
  const overloadR = { ...stopped, "controller.Mode": 3, "controller.ModeText": "Faulted", "controller.FaultCode": 10, "controller.FaultText": "Drive overload", StackLight_Red: true };
  const overloadImage = image({ Drive_Overload: true });
  const injected = { injectedFaults: [{ actionId: "f", controlId: "fault.setOverload", parameters: { active: true } }], clearedFaults: [], cartons: [] };
  const overload = classifyHeldState(synthetic(overloadR, { world: injected }, overloadImage), current(overloadR, overloadImage));
  assert.equal(overload.path, "held-overload"); assert.equal(overload.supported, true); assert.deepEqual(overload.plan.map(s => s.op), ["stop", "fresh_world", "reset"]);
  assert.equal(classifyHeldState(synthetic(overloadR, {}, overloadImage), current(overloadR, overloadImage)).supported, false, "overload the run did not inject");
  const resetLanded = { ...overloadR, "controller.ResetAck": 3, "controller.ResetAccepted": false };
  assert.equal(classifyHeldState(synthetic(overloadR, { world: injected, inFlightCommands: [{ actionId: "r", action: "reset", parameters: {} }] }, overloadImage), current(resetLanded, overloadImage)).supported, true);
  const unrecorded = classifyHeldState(synthetic(overloadR, { world: injected }, overloadImage), current(resetLanded, overloadImage));
  assert.equal(unrecorded.supported, false); assert(unrecorded.refusals.some(r => /reset acknowledgement changed only for a recorded in-flight reset/.test(r)));
  const startC = { ...stopped, "controller.StartAck": 5, "controller.Mode": 3, "controller.ModeText": "Faulted", "controller.FaultCode": 11, "controller.FaultText": "Motor running feedback missing on start", StackLight_Red: true };
  const start = classifyHeldState(synthetic(stopped, { inFlightCommands: [{ actionId: "s", action: "start", parameters: {} }] }), current(startC));
  assert.equal(start.path, "start-feedback-timeout"); assert.deepEqual(start.plan.map(s => s.op), ["stop", "reset"]);
  const lateImage = image({ Encoder_Count: 42 });
  const late = classifyHeldState(synthetic(stopped, { inFlightCommit: { epoch: "11", sequence: "6", image: lateImage, sentAtIso: "" } }), current(stopped, lateImage, { epoch: "11", sequence: "6" }));
  assert.equal(late.matchedCommit, "in_flight"); assert.equal(late.path, "stopped-clean"); assert.deepEqual(late.plan, []);
  const lateWrong = classifyHeldState(synthetic(stopped, { inFlightCommit: { epoch: "11", sequence: "6", image: lateImage, sentAtIso: "" } }), current(stopped, image({ Encoder_Count: 43 }), { epoch: "11", sequence: "6" }));
  assert.equal(lateWrong.supported, false);
  const reacted = classifyHeldState(synthetic(stopped, { inFlightCommit: { epoch: "11", sequence: "6", image: lateImage, sentAtIso: "" } }),
    current({ ...stopped, "controller.ItemActive": true }, lateImage, { epoch: "11", sequence: "6" }));
  assert.equal(reacted.supported, false); assert(reacted.refusals.some(r => /late in-flight commit/.test(r)), "an unobserved controller reaction to a late commit is refused");
  const unknownWrite = classifyHeldState(synthetic(stopped, { outstandingWrites: { atClose: [{ paths: ["GVL_BenchWrite.SomethingElse"] }], atQuarantine: [], settledAfterQuarantine: [], childClosed: true } }), current(stopped));
  assert.equal(unknownWrite.supported, false);
  const extra = classifyHeldState(synthetic(stopped), current({ ...stopped, "controller.ExceptionCode": 3 }));
  assert.equal(extra.supported, false, "any unexplained controller change is refused");
});

test("read-only inspection gate refuses every write until an explicit authorization", async () => {
  const inner = createTransport({}), events: string[] = [];
  const gate = new ReadOnlyTransport(inner, kind => events.push(kind));
  await assert.rejects(gate.write([{ path: "GVL_DemoWrite.StopSequence", value: 1 }]), /Read-only inspection/);
  assert.equal(gate.refusedWrites, 1); assert.equal(inner.writes.length, 0);
  gate.authorize("test authorization");
  await gate.write([{ path: "GVL_DemoWrite.StopSequence", value: 1 }]);
  assert.equal(inner.writes.length, 1); assert.deepEqual(events, ["write.refused", "writes.authorized"]);
});

test("recovery distinguishes a recorded child exit from a reused PID, disconnect or foreign nonce", () => {
  const record = { child: { pid: process.pid, nonce: "original-fork", exit: { code: 0, signal: null } } } as HeldState;
  const journal = [{ kind: "child.ready", identity: { pid: process.pid, nonce: "original-fork" } }, { kind: "child.exit", code: 0, signal: null }];
  // The saved PID deliberately names this living test process. The matching terminal event
  // proves the original fork ended; this is not authority to adopt another runtime's lock.
  assert.equal(recordedChildExited(record, journal), true);
  assert.equal(recordedChildExited(record, journal.slice(0, 1)), false);
  assert.equal(recordedChildExited(record, [{ ...journal[0], identity: { pid: process.pid, nonce: "other-fork" } }, journal[1]]), false);
  assert.equal(recordedChildExited({ child: { ...record.child, exit: { code: null, signal: null } } } as HeldState,
    [journal[0], { kind: "child.exit", code: null, signal: null }]), false, "IPC disconnect is not an OS terminal exit");
  assert.equal(recordedChildExited(record, [journal[1], journal[0]]), false, "exit must follow this child's ready record");
});

test("live commissioning qualification rejects missing, slow, empty and late-expiry evidence", () => {
  const good = { cadence: { commits: 100, gapMaxMs: 250, gapsOver300Ms: 0, faults: [] }, leases: {
    stallCommits: { stallMs: 1500, childCommitsDuringStall: 7, maxGapMs: 250 },
    receipts: [["hold", "released", true], ["continue", "released", true], ["condition_deadline", "released", true],
      ["condition_deadline", "condition_met", false], ["condition_deadline", "released", true], ["continue", "expired", false]]
      .map(([mode, state, valid]) => ({ mode, state, valid, timeoutMs: 400, elapsedMs: 500, worldHeld: true })),
    conditionHold: { samples: 3, distinctImages: 1, plcCycleFirst: "100", plcCycleLast: "104" },
    expiryHold: { samples: 3, distinctImages: 1, plcCycleFirst: "105", plcCycleLast: "109" } } };
  assert.deepEqual(commissioningQualification(good), { passed: true, failures: [] });
  assert.equal(commissioningQualification({}).passed, false);
  const cases = [
    (m: any) => { m.cadence.gapMaxMs = 301; m.cadence.gapsOver300Ms = 1; },
    (m: any) => { m.cadence.faults.push("quarantined"); },
    (m: any) => { m.leases.stallCommits.childCommitsDuringStall = 0; },
    (m: any) => { m.leases.stallCommits.maxGapMs = 900; },
    (m: any) => { m.leases.receipts.at(-1).elapsedMs = 1500; },
    (m: any) => { m.leases.conditionHold.samples = 0; m.leases.conditionHold.distinctImages = 0; },
    (m: any) => { m.leases.expiryHold.distinctImages = 2; },
    (m: any) => { m.leases.expiryHold.plcCycleLast = m.leases.expiryHold.plcCycleFirst; }
  ];
  for (const mutate of cases) { const m = structuredClone(good); mutate(m); assert.equal(commissioningQualification(m).passed, false); }
});
