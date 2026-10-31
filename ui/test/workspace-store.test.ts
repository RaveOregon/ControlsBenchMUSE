import assert from "node:assert/strict";
import test from "node:test";
import { ReplaySession } from "../src/adapters/replay/replay-session.ts";
import { classifyActivity } from "../src/model/activity.ts";
import { defaultScope } from "../src/model/plan.ts";
import { WorkspaceStore } from "../src/model/workspace-store.ts";
import { LIMITS, SIGNALS, ev } from "./helpers.ts";
import { loadRepoFixtures } from "./load-fixtures.ts";

test("campaign moves ready → running → paused → running → stopped and finalizes the run record", () => {
  const store = new WorkspaceStore("replay", SIGNALS);
  assert.equal(store.state.phase, "ready");
  assert.deepEqual(store.start(0), { ok: true });
  assert.equal(store.state.phase, "running");
  assert.deepEqual(store.pause(1000), { ok: true });
  assert.equal(store.state.phase, "paused");
  assert.deepEqual(store.resume(1000), { ok: true });
  assert.deepEqual(store.stop(2500), { ok: true });
  assert.equal(store.state.phase, "stopped");
  assert.equal(store.state.finalized, true);
  assert.equal(store.state.endedAtMs, 2500);
  const leftovers = Object.values(store.state.checks).filter((check) => store.state.scope[check.id]);
  assert.ok(leftovers.every((check) => check.status === "not_run"), "planned checks become not run when stopped");
  assert.ok(leftovers.every((check) => check.summary === "Stopped by engineer before a verdict"));
  const commands = store.state.timeline.filter((event) => event.kind === "engineer.command").map((event) => (event.kind === "engineer.command" ? event.command : ""));
  assert.deepEqual(commands, ["start", "pause", "resume", "stop"]);
});

test("illegal transitions are refused with a reason instead of silently changing authority", () => {
  const store = new WorkspaceStore("replay", SIGNALS);
  assert.equal(store.pause(0).ok, false);
  assert.equal(store.stop(0).ok, false);
  store.start(0);
  const reset = store.resetSimulation(10);
  assert.equal(reset.ok, false);
  assert.match((reset as { reason: string }).reason, /Stop the campaign/);
  assert.equal(store.exitSimulation(10).ok, false);
  assert.equal(store.setScope(["IO-1"], false).ok, false, "scope is locked while running");
  assert.equal(store.start(10).ok, false);
  assert.equal(store.state.connection.simulationRequested, true);
});

test("Pause holds the current raw image; Reset zeros it while staying in simulation", () => {
  const store = new WorkspaceStore("replay", SIGNALS);
  store.start(0);
  store.applyEvents([ev(10, { kind: "raw.input", signalId: "PE_Entry", value: true, cause: "test" }), ev(10, { kind: "raw.input", signalId: "Encoder_Count", value: 1900, cause: "test" }), ev(10, { kind: "plc.output", values: { Motor_RunCmd: true }, origin: "plc" })]);
  store.pause(20);
  assert.equal(store.state.inputs.PE_Entry?.value, true, "paused image is held, not cleared");
  store.stop(30);
  assert.equal(store.state.inputs.Encoder_Count?.value, 1900, "stop holds the final image for inspection");
  assert.deepEqual(store.resetSimulation(40), { ok: true });
  assert.equal(store.state.inputs.PE_Entry?.value, false);
  assert.equal(store.state.inputs.D1_HomeFB?.value, false, "BOOL inputs zero to false");
  assert.equal(store.state.inputs.Belt_SpeedActual?.value, 0, "REAL inputs zero to 0");
  assert.equal(store.state.inputs.Encoder_Count?.value, 0, "UDINT inputs zero to 0");
  assert.equal(store.state.outputs.Motor_RunCmd?.value, true, "PLC outputs are not workstation-owned and are untouched");
  assert.equal(store.state.connection.simulationRequested, true, "reset stays in simulation");
});

test("Exit Simulation deliberately returns authority to hardware; a campaign cannot start until simulation is re-entered", () => {
  const store = new WorkspaceStore("replay", SIGNALS);
  assert.deepEqual(store.exitSimulation(0), { ok: true });
  assert.equal(store.state.connection.simulationRequested, false);
  assert.equal(store.state.connection.simulationApplied, null, "replay cannot claim the PLC confirmed passthrough");
  assert.equal(store.start(1).ok, false);
  assert.equal(classifyActivity(store.state, 1).state, "hardware");
  assert.deepEqual(store.enterSimulation(2), { ok: true });
  assert.equal(store.state.inputs.PE_Entry?.value, false, "entering simulation initializes a zero image");
  assert.deepEqual(store.start(3), { ok: true });
});

test("budget reserves in-flight cost, settles recorded cost, and holds the campaign at the hard stop", () => {
  const store = new WorkspaceStore("replay", SIGNALS);
  store.start(0);
  store.applyEvents([ev(0, { kind: "budget.limits", limits: LIMITS })]);
  let at = 0;
  for (let index = 0; index < 5; index += 1) {
    store.applyEvents([ev(at, { kind: "agent.request.start", requestId: `r${index}`, purpose: "diagnosis", model: "muse-wonder-1.0", reservedUsd: 1, timeoutMs: LIMITS.requestTimeoutMs })]);
    assert.equal(store.state.budget.reservedUsd, 1);
    at += 1000;
    store.applyEvents([ev(at, { kind: "agent.request.end", requestId: `r${index}`, status: "completed", failed: false, durationMs: 1000, costUsd: 1 })]);
    assert.equal(store.state.budget.reservedUsd, 0);
    if (index === 2) assert.equal(store.state.budget.level, "warning");
  }
  assert.equal(store.state.budget.spentUsd, 5);
  assert.equal(store.state.budget.level, "hard_stop");
  assert.equal(store.state.phase, "budget_hold");
  const view = classifyActivity(store.state, at);
  assert.equal(view.state, "budget_hold");
  assert.match(view.headline, /no further model calls/);
  assert.equal(store.resume(at).ok, false, "a budget hold is not resumed implicitly");
  assert.deepEqual(store.stop(at), { ok: true });
});

test("replay Pause freezes the playhead and image; Resume continues from the held state", async () => {
  const bundle = await loadRepoFixtures();
  const session = new ReplaySession(bundle, new WorkspaceStore("replay", bundle.manifest.signals));
  session.speed = 1;
  assert.deepEqual(session.start(), { ok: true });
  session.advance(20_000);
  session.pause();
  const held = JSON.stringify(session.store.state.inputs);
  const playhead = session.playheadMs;
  session.advance(30_000);
  assert.equal(session.playheadMs, playhead);
  assert.equal(JSON.stringify(session.store.state.inputs), held);
  session.resume();
  session.advance(5_000);
  assert.equal(session.playheadMs, playhead + 5_000);
  assert.notEqual(JSON.stringify(session.store.state.inputs), held, "recorded Gate B evidence continues after resume");
});

test("a full replay completes, finalizes, and reports recorded verdicts honestly", async () => {
  const bundle = await loadRepoFixtures();
  const session = new ReplaySession(bundle, new WorkspaceStore("replay", bundle.manifest.signals));
  session.speed = 20;
  session.start();
  for (let step = 0; step < 400 && session.store.state.phase === "running"; step += 1) session.advance(250);
  const state = session.store.state;
  assert.equal(state.phase, "completed");
  assert.equal(state.finalized, true);
  const status = (id: string) => state.checks[id]?.status;
  for (const id of ["IO-1", "IO-2", "SM-1", "SM-2", "FN-1", "FN-2", "FN-3", "FN-4", "RT-1", "RT-2", "RT-5", "FR-1", "FR-2", "FR-3", "FR-4", "NO-1", "ES-1", "ES-2", "AI-2", "AI-3", "EV-1"]) assert.equal(status(id), "pass", id);
  for (const id of ["RT-3", "RT-4", "FR-5", "NO-2", "CQ-4", "CQ-5"]) assert.equal(status(id), "pass", id);
  for (const id of ["CQ-20", "CQ-50"]) assert.equal(status(id), "fail", id);
  assert.equal(status("AI-1"), "inconclusive", "insufficient_evidence is shown as inconclusive, not as a pass");
  for (const id of ["FN-5", "ES-3"]) assert.equal(status(id), "not_run", `${id} awaits the live connector`);
  assert.equal(state.checks["AI-2"]?.addedBy, "muse");
  assert.equal(state.agent.calls.length, 6);
  assert.equal(Number(state.budget.spentUsd.toFixed(2)), 3.25);
  assert.equal(state.budget.level, "warning");
  assert.equal(state.hotReload.activeVersion, "0.5.1-gate-c");
  assert.deepEqual(defaultScope()["EV-1"], true);
});
