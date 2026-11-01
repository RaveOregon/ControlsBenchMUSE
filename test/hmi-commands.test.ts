import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HmiService } from "../src/hmi/service.ts";
import { ScriptedPlc, waitFor } from "./fixtures/hmi/scripted-transport.ts";

async function harness(options: { ownershipLock?: boolean; commandPolicy?: "auto" | "enabled" | "disabled" } = {}) {
  const plc = new ScriptedPlc();
  const root = mkdtempSync(join(tmpdir(), "hmi-cmd-"));
  if (options.ownershipLock) { mkdirSync(join(root, "artifacts/m10"), { recursive: true }); writeFileSync(join(root, "artifacts/m10/live.lock"), ""); }
  const service = new HmiService({ source: { kind: "live_plc", endpoint: "scripted://m8", userConfigured: true, transportFactory: event => plc.transport(event) },
    pollIntervalMs: 20, ackTimeoutMs: 400, settleMs: 300, ownershipRoots: [root], commandPolicy: options.commandPolicy });
  await service.start();
  await waitFor(() => service.link.fresh, 2000, "fresh link");
  const cleanup = async () => { await service.stop(); rmSync(root, { recursive: true, force: true }); };
  return { plc, service, cleanup };
}
const operatorWrites = (plc: ScriptedPlc) => plc.writes.map(w => w.path);
const types = (service: HmiService, requestId: string) => service.journal.tail.filter(r => r.data.requestId === requestId).map(r => r.type);

test("Start is applied only from the PLC sequence echo plus StartAccepted, and writes only StartSequence", async () => {
  const { plc, service, cleanup } = await harness();
  try {
    plc.set({ "GVL_DemoWrite.StartSequence": 41, "GVL_DemoRead.Status.StartAck": 41 });
    const c = await service.submitCommand({ requestId: "req-start-0001", action: "start", clientSessionId: undefined, origin: "test" });
    assert.equal(c.outcome, "applied");
    assert.equal(c.ackKind, "plc_sequence_ack");
    assert.equal(c.expectedSequence, 42);
    assert.equal(c.accepted, true);
    assert.deepEqual(operatorWrites(plc), ["GVL_DemoWrite.StartSequence"], "Start must not silently set AutoRequest or any other field");
    assert.deepEqual(types(service, "req-start-0001").slice(0, 3), ["command.requested", "command.delivered", "command.applied"]);
    assert.ok(c.evidenceRefs.length >= 3 && c.evidenceRefs.every(r => r.startsWith("hmi-journal:")));
    await waitFor(() => !!service.commands.get("req-start-0001")?.resulting, 2000, "resulting state");
  } finally { await cleanup(); }
});

test("Reset acknowledged with ResetAccepted=FALSE is a PLC rejection with observed preconditions", async () => {
  const { plc, service, cleanup } = await harness();
  try {
    plc.ack = "reject";
    plc.set({ "GVL_DemoRead.Status.Mode": 3, "GVL_DemoRead.Status.CompletionPending": true, "GVL_BenchRead.Active_PE_D1Approach": true, "GVL_BenchRead.Active_D1_HomeFB": true, "GVL_BenchRead.Active_D2_HomeFB": true, "GVL_BenchRead.Active_Runout_Ready": true });
    await new Promise(r => setTimeout(r, 60));
    const c = await service.submitCommand({ requestId: "req-reset-0001", action: "reset", origin: "test" });
    assert.equal(c.outcome, "rejected");
    assert.equal(c.accepted, false);
    const unmet = c.preconditions!.filter(p => p.met === false).map(p => p.id).sort();
    assert.deepEqual(unmet, ["beams", "completion"]);
    assert.match(c.detail, /refused by the controller/);
  } finally { await cleanup(); }
});

test("Stop is applied from the StopAck echo alone (M8 has no StopAccepted)", async () => {
  const { service, cleanup } = await harness();
  try {
    const c = await service.submitCommand({ requestId: "req-stop-0001", action: "stop", origin: "test" });
    assert.equal(c.outcome, "applied");
    assert.equal(c.ackKind, "plc_sequence_echo");
    assert.equal(c.acceptedField, undefined);
  } finally { await cleanup(); }
});

test("No acknowledgement within the deadline is timed_out, never applied, and says it may still apply", async () => {
  const { plc, service, cleanup } = await harness();
  try {
    plc.ack = "none";
    const c = await service.submitCommand({ requestId: "req-start-0002", action: "start", origin: "test" });
    assert.equal(c.outcome, "timed_out");
    assert.ok(c.deliveredAtIso, "the write was delivered");
    assert.equal(c.acknowledgedAtIso, undefined);
    assert.match(c.detail, /may still apply/);
  } finally { await cleanup(); }
});

test("A later acknowledgement from another writer is reported as ambiguous, not applied", async () => {
  const { plc, service, cleanup } = await harness();
  try {
    plc.ack = "other-writer";
    const c = await service.submitCommand({ requestId: "req-reset-0002", action: "reset", origin: "test" });
    assert.equal(c.outcome, "failed");
    assert.match(c.detail, /another writer/);
  } finally { await cleanup(); }
});

test("Auto has no PLC acknowledgement field: it is applied by labelled readback of AutoRequest", async () => {
  const { plc, service, cleanup } = await harness();
  try {
    const c = await service.submitCommand({ requestId: "req-auto-0001", action: "auto_on", origin: "test" });
    assert.equal(c.outcome, "applied");
    assert.equal(c.ackKind, "readback");
    assert.match(c.detail, /no Auto acknowledgement field/);
    assert.deepEqual(plc.writes, [{ path: "GVL_DemoWrite.AutoRequest", value: true }]);
  } finally { await cleanup(); }
});

test("Commands are refused without any write when another lane owns the runtime, or the HMI is read-only", async () => {
  for (const options of [{ ownershipLock: true }, { commandPolicy: "disabled" as const }]) {
    const { plc, service, cleanup } = await harness(options);
    try {
      const c = await service.submitCommand({ requestId: `req-own-${options.ownershipLock ? "lock" : "ro"}-1`, action: "stop", origin: "test" });
      assert.equal(c.outcome, "refused");
      assert.equal(plc.writes.length, 0);
      assert.equal(service.state().ownership.commandsEnabled, false);
      if (options.ownershipLock) assert.equal(service.link.view.pollIntervalMs, 1000, "polls slowly while another lane owns the runtime");
    } finally { await cleanup(); }
  }
});

test("Commands are refused without writes when PLC data is stale, the identity is wrong, or a command is in flight", async () => {
  const { plc, service, cleanup } = await harness();
  try {
    plc.set({ "GVL_DemoRead.BuildId": 9999 });
    await new Promise(r => setTimeout(r, 60));
    const wrong = await service.submitCommand({ requestId: "req-id-000001", action: "start", origin: "test" });
    assert.equal(wrong.outcome, "refused"); assert.match(wrong.detail, /BuildId 9999/);
    plc.set({ "GVL_DemoRead.BuildId": 8001 });
    await new Promise(r => setTimeout(r, 60));
    plc.ack = "none";
    const first = service.submitCommand({ requestId: "req-busy-00001", action: "stop", origin: "test" });
    await waitFor(() => service.commands.inFlight === "req-busy-00001", 1000, "in flight");
    const second = await service.submitCommand({ requestId: "req-busy-00002", action: "start", origin: "test" });
    assert.equal(second.outcome, "refused"); assert.match(second.detail, /still awaiting/);
    await first;
    plc.readFails = true;
    await waitFor(() => !service.link.fresh, 3000, "stale link");
    const stale = await service.submitCommand({ requestId: "req-stale-0001", action: "start", origin: "test" });
    assert.equal(stale.outcome, "refused"); assert.match(stale.detail, /not fresh/);
    assert.deepEqual(operatorWrites(plc), ["GVL_DemoWrite.StopSequence"], "only the first, admitted command wrote");
  } finally { await cleanup(); }
});

test("A duplicate request ID returns the recorded outcome and never writes again", async () => {
  const { plc, service, cleanup } = await harness();
  try {
    const a = await service.submitCommand({ requestId: "req-dup-000001", action: "stop", origin: "test" });
    const b = await service.submitCommand({ requestId: "req-dup-000001", action: "stop", origin: "test" });
    assert.equal(b.outcome, a.outcome);
    assert.equal(plc.writes.length, 1);
  } finally { await cleanup(); }
});

test("The HMI link refuses any write outside the four operator request paths", async () => {
  const { plc, service, cleanup } = await harness();
  try {
    for (const path of ["GVL_DemoWrite.CompletionAck", "GVL_DemoWrite.OfferSequence", "GVL_BenchWrite.SimRequest", "GVL_BenchWrite.Slot0_PE_Entry", "GVL_BenchWrite.WorkstationHeartbeat"])
      await assert.rejects(service.link.write([{ path, value: 1 }]), /outside operator allowlist/);
    assert.equal(plc.writes.length, 0);
  } finally { await cleanup(); }
});
