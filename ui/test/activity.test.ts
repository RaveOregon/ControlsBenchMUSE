import assert from "node:assert/strict";
import test from "node:test";
import { classifyActivity, plcStaleThresholdMs } from "../src/model/activity.ts";
import { WorkspaceStore } from "../src/model/workspace-store.ts";
import { LIMITS, SIGNALS, ev, episode } from "./helpers.ts";

function running(): WorkspaceStore {
  const store = new WorkspaceStore("replay", SIGNALS);
  store.start(0);
  store.applyEvents([ev(0, { kind: "budget.limits", limits: LIMITS })]);
  return store;
}

test("slow reasoning is distinguished from a timed-out request", () => {
  const store = running();
  store.applyEvents([episode(0), ev(1000, { kind: "agent.request.start", requestId: "r1", purpose: "gate_c_hot_reload_candidate", model: "muse-wonder-1.0", reservedUsd: 0.75, timeoutMs: 300_000 })]);
  const reasoning = classifyActivity(store.state, 56_331);
  assert.equal(reasoning.state, "reasoning");
  assert.equal(reasoning.elapsedLabel, "55.3 s");
  assert.match(reasoning.detail ?? "", /request limit 05:00, reserved \$0\.75/);
  assert.equal(reasoning.health.muse.tone, "reasoning");
  const timedOut = classifyActivity(store.state, 301_000);
  assert.equal(timedOut.state, "request_timed_out");
  assert.match(timedOut.headline, /no further spend/);
});

test("a healthy condition wait is not a stall, but an overdue one is", () => {
  const store = running();
  store.applyEvents([episode(0, { world: true }), ev(0, { kind: "world.heartbeat", tick: 0 }), ev(100, { kind: "wait.start", condition: "D1_ExtendedFB = 1", timeoutMs: 2000 }), ev(1100, { kind: "world.heartbeat", tick: 55 })]);
  const waiting = classifyActivity(store.state, 1200);
  assert.equal(waiting.state, "waiting");
  assert.equal(waiting.headline, "Waiting for D1_ExtendedFB = 1");
  assert.equal(waiting.health.world.tone, "active");
  store.applyEvents([ev(2100, { kind: "world.heartbeat", tick: 105 })]);
  assert.equal(classifyActivity(store.state, 2200).state, "condition_timeout");
});

test("a world with no heartbeat beyond its threshold is reported as stalled", () => {
  const store = running();
  store.applyEvents([episode(0, { world: true }), ev(500, { kind: "world.heartbeat", tick: 25 })]);
  assert.equal(classifyActivity(store.state, 2400).state, "active");
  const stalled = classifyActivity(store.state, 2600);
  assert.equal(stalled.state, "world_stalled");
  assert.equal(stalled.health.world.tone, "stalled");
});

test("PLC staleness, a known PLC restart, and connector loss are separate states", () => {
  const store = running();
  store.applyEvents([episode(0, { connector: true, plc: true }), ev(0, { kind: "connector.session", transport: "OPC UA", endpoint: "opc.tcp://127.0.0.1:4840", securityMode: "SignAndEncrypt", securityPolicy: "Basic256Sha256", identity: "username", publishingIntervalMs: 20 }), ev(0, { kind: "connector.link", state: "up", detail: "" }), ev(100, { kind: "plc.heartbeat", plcCycle: "10" })]);
  assert.equal(plcStaleThresholdMs(20), 500);
  assert.equal(classifyActivity(store.state, 550).health.plc.tone, "active");
  const stale = classifyActivity(store.state, 700);
  assert.equal(stale.state, "plc_stale");
  store.applyEvents([ev(700, { kind: "plc.restart", detail: "cold reset" })]);
  assert.equal(classifyActivity(store.state, 5000).state, "plc_restarting", "a known restart is not reported as an unexplained stale link");
  store.applyEvents([ev(5100, { kind: "plc.identity", bootIdentity: "2", previousBootIdentity: "1" }), ev(5200, { kind: "connector.link", state: "lost", detail: "client dropped" })]);
  const lost = classifyActivity(store.state, 5300);
  assert.equal(lost.state, "connector_lost");
  assert.match(lost.headline, /holds the last simulated image/);
  assert.equal(store.state.connection.previousBootIdentity, "1");
});

test("untimed records never produce staleness or measured elapsed times", () => {
  const store = running();
  store.applyEvents([episode(0, { connector: true, plc: true, clock: "discrete" }), ev(0, { kind: "plc.heartbeat", plcCycle: "1" }, { clock: "discrete" }), ev(0, { kind: "step", phase: "connecting", message: "Opening session" }, { clock: "discrete" })]);
  const view = classifyActivity(store.state, 5000);
  assert.equal(view.state, "active");
  assert.equal(view.elapsedLabel, "timing not recorded");
  assert.notEqual(view.health.plc.tone, "stalled");
});

test("Pause, Stop, and completion override in-progress activity", () => {
  const store = running();
  store.applyEvents([episode(0), ev(10, { kind: "agent.request.start", requestId: "r1", purpose: "x", model: "m", reservedUsd: 0.5, timeoutMs: 300_000 })]);
  store.pause(20);
  const paused = classifyActivity(store.state, 400_000);
  assert.equal(paused.state, "paused", "a paused campaign is never reported as a timed-out or stalled agent");
  assert.match(paused.headline, /Playback paused/);
  store.stop(30);
  assert.equal(classifyActivity(store.state, 40).state, "stopped");
  assert.equal(store.state.budget.reservedUsd, 0, "finalizing releases the abandoned reservation");
});

test("recorded guard exercises are labeled as exercises, not live failures", () => {
  const store = running();
  store.applyEvents([episode(0, { clock: "discrete" }), ev(100, { kind: "runtime.flag", state: "world_stalled", message: "World heartbeat stale for 5000 ms", elapsedMs: 5000, exercise: true }, { clock: "discrete" })]);
  const view = classifyActivity(store.state, 200);
  assert.equal(view.state, "world_stalled");
  assert.equal(view.exercise, true);
  assert.match(view.headline, /^Guard exercise · /);
  assert.equal(view.elapsedLabel, "5.0 s (recorded guard input)");
  assert.equal(store.state.phase, "running", "an exercise flag does not change the campaign phase");
});
