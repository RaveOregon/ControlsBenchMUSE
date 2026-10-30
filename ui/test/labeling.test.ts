import assert from "node:assert/strict";
import test from "node:test";
import { LiveEventMapper, LiveSession, type CommitReceiptLike, type ConnectorObservationLike } from "../src/adapters/live/coordinator-source.ts";
import { verifyProvenance } from "../src/adapters/replay/fixtures.ts";
import { parseWorldGeometry } from "../src/adapters/replay/geometry.ts";
import { evidenceTag } from "../src/components/labels.ts";
import { ModeMismatchError, WorkspaceStore } from "../src/model/workspace-store.ts";
import { SIGNALS, ev } from "./helpers.ts";
import { loadRepoFixtures } from "./load-fixtures.ts";

const observation: ConnectorObservationLike = {
  observedAtIso: "2026-10-31T10:00:00.000Z",
  observedAtMonotonicMs: 5000,
  bootIdentity: "1419755446149",
  appliedEpoch: "9",
  appliedSequence: "41",
  plcCycle: "1200",
  plcTimeUs: "1",
  outputCaptureCycle: "1200",
  outputCaptureTimeUs: "1",
  connectorStale: false,
  simulationApplied: true,
  values: { Motor_RunCmd: true, PE_Entry: false }
};

test("a replay workspace refuses live-labeled events and a live workspace refuses replayed ones", () => {
  const replay = new WorkspaceStore("replay", SIGNALS);
  assert.throws(() => replay.applyEvents([ev(0, { kind: "plc.heartbeat", plcCycle: "1" }, { mode: "live" })]), ModeMismatchError);
  const live = new WorkspaceStore("live", SIGNALS);
  assert.throws(() => live.applyEvents([ev(0, { kind: "plc.heartbeat", plcCycle: "1" }, { mode: "replay" })]), ModeMismatchError);
  assert.equal(live.state.connection.plcCycle, undefined, "nothing from the rejected batch is applied");
});

test("engineer commands are recorded in the workspace's own mode as local evidence", () => {
  const replay = new WorkspaceStore("replay", SIGNALS);
  replay.start(0);
  replay.steer("Spend more time on divert 2 jams", 10);
  const local = replay.state.timeline.filter((event) => event.provenance.evidenceClass === "engineer_local");
  assert.equal(local.length, 2);
  assert.ok(local.every((event) => event.provenance.mode === "replay" && event.provenance.source === "workspace"));
  const reset = new WorkspaceStore("replay", SIGNALS);
  reset.resetSimulation(0);
  const detail = reset.state.timeline.at(-1)!;
  assert.match(detail.summary, /replay: local image only, nothing sent to a PLC/);
});

test("evidence tags never describe recorded PLC measurements as live", () => {
  assert.equal(evidenceTag("plc_measurement", "replay").text, "PLC · recorded");
  assert.equal(evidenceTag("plc_measurement", "live").text, "PLC · live");
  assert.equal(evidenceTag("surrogate_contract", "replay").text, "surrogate");
  assert.equal(evidenceTag("world_model", "replay").text, "world · recorded");
  assert.equal(evidenceTag("plc_measurement", "replay", "awaiting_live").text, "awaiting live");
  for (const cls of ["surrogate_contract", "world_model", "plc_measurement", "agent_record", "audit", "engineer_local"] as const) {
    assert.doesNotMatch(evidenceTag(cls, "replay").text, /live/, cls);
  }
});

test("the live adapter labels coordinator records as live and maps sequence, boot identity, and staleness", () => {
  const mapper = new LiveEventMapper(["Motor_RunCmd"]);
  const first = mapper.observation(observation);
  assert.ok(first.every((event) => event.provenance.mode === "live" && event.provenance.clock === "live_wall" && event.provenance.source === "live:coordinator"));
  assert.ok(first.some((event) => event.kind === "plc.identity" && event.bootIdentity === "1419755446149"));
  const outputs = first.find((event) => event.kind === "plc.output");
  assert.deepEqual(outputs?.kind === "plc.output" && outputs.values, { Motor_RunCmd: true }, "only manifest outputs are treated as PLC outputs");

  const stale = mapper.observation({ ...observation, observedAtMonotonicMs: 6000, connectorStale: true });
  assert.ok(stale.some((event) => event.kind === "connector.link" && event.state === "lost"));
  assert.equal(stale.some((event) => event.kind === "plc.identity"), false, "unchanged boot identity is not re-announced");

  const receipt: CommitReceiptLike = { ...observation, workstationEpoch: "9", workstationSequence: "42", appliedSequence: "42", slot: 1, sentAtIso: "", sentAtMonotonicMs: 7000, acknowledgedAtIso: "", acknowledgedAtMonotonicMs: 7016, latencyMs: 16, image: { PE_Entry: true, Encoder_Count: 12 } };
  const committed = mapper.receipt(receipt);
  const ack = committed.find((event) => event.kind === "connector.ack");
  assert.equal(ack?.kind === "connector.ack" && ack.latencyMs, 16);
  assert.equal(ack?.atMs, 2016, "campaign time starts at the first live record");
  assert.deepEqual(
    committed.filter((event) => event.kind === "raw.input").map((event) => (event.kind === "raw.input" ? [event.signalId, event.value] : null)),
    [["PE_Entry", true], ["Encoder_Count", 12]]
  );

  const store = new WorkspaceStore("live", SIGNALS);
  store.applyEvents([...first, ...committed]);
  assert.equal(store.state.connection.appliedSequence, "42");
  assert.equal(store.state.connection.simulationApplied, true);
});

test("the live source cannot start or command anything without an attached coordinator", () => {
  const session = new LiveSession(new WorkspaceStore("live", SIGNALS), ["Motor_RunCmd"]);
  assert.match(session.unavailableReason ?? "", /No live coordinator/);
  assert.equal(session.start().ok, false);
  assert.equal(session.store.state.phase, "ready");
  const sent: string[] = [];
  session.attach({ send: (command) => sent.push(command.type) });
  assert.equal(session.unavailableReason, undefined);
  assert.deepEqual(session.start(), { ok: true });
  assert.deepEqual(sent, ["start"]);
});

test("preserved fixtures verify against the hashes recorded when the evidence was produced", async () => {
  const checks = await verifyProvenance(await loadRepoFixtures());
  const byKey = new Map(checks.map((check) => [check.key, check.status]));
  for (const key of ["manifest", "worldSource", "m1Result", "m2Result", "m2Trace"] as const) assert.equal(byKey.get(key), "verified", key);
  assert.ok(checks.every((check) => check.status !== "mismatch"));
});

test("schematic geometry comes from the generated world's declared CONFIG", async () => {
  const bundle = await loadRepoFixtures();
  const geometry = parseWorldGeometry(bundle.worldSource);
  assert.ok(geometry);
  assert.equal(geometry.peEntryM, 0.5);
  assert.equal(geometry.divert1M, 1.6);
  assert.equal(geometry.divert2M, 2.8);
  assert.equal(geometry.runoutEndM, 4.2);
  assert.equal(geometry.encoderCountsPerM, 1000);
  assert.equal(parseWorldGeometry("export const world = {};"), null, "no CONFIG means no invented geometry");
});
