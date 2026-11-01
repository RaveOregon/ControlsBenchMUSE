import assert from "node:assert/strict";
import test from "node:test";
import { M8OpcUaConnector } from "../src/live/m8-opcua.ts";
import type { M8Sample, M8Transport } from "../src/live/m8-opcua.ts";
import { requiredSignals, rawInputs, validateM8Image, withM8Observations, writeSignals } from "../src/live/m8-map.ts";
import type { RawValue } from "../src/proof/contracts.ts";
import world from "../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts";
import { CampaignLedger } from "../src/campaign/ledger.ts";
import { m8ControllerActions } from "../src/campaign/m8-bindings.ts";
import { validateManifest } from "../src/proof/manifest.ts";

// Protocol fixture only: never an oracle for M8 conveyor behavior.
class ProtocolTransport implements M8Transport {
  values: Record<string, RawValue> = {};
  writes: { path: string; value: RawValue }[][] = [];
  torn = false; badQuality = false; boot = "boot-1"; build = 8001;
  constructor() {
    for (const s of requiredSignals) this.values[s.iecPath] = s.iecType === "ULINT" ? "0" : s.iecType.startsWith("STRING") ? "" : s.iecType === "BOOL" ? false : 0;
    Object.assign(this.values, { "GVL_DemoRead.BuildId": 8001, "GVL_DemoRead.InterfaceVersion": 1, "GVL_BenchRead.SimApplied": true });
  }
  async open() {}
  async close() {}
  async read(paths: string[]) {
    this.values["GVL_BenchRead.PlcBootIdentity"] = this.boot; this.values["GVL_DemoRead.BuildId"] = this.build;
    const at = new Date().toISOString();
    return Object.fromEntries(paths.map(p => [p, { value: this.values[p], status: this.badQuality ? "Bad" : "Good", sourceTimestamp: at, serverTimestamp: at, receivedAtIso: at }])) as Record<string, M8Sample>;
  }
  async write(items: { path: string; value: RawValue }[]) {
    const allow = new Set(writeSignals.map(s => s.iecPath)); items.forEach(i => assert(allow.has(i.path)));
    this.writes.push(structuredClone(items)); for (const i of items) this.values[i.path] = i.value;
    if (items.some(i => i.path.endsWith("SessionResetRequest") && i.value === true)) {
      const n = "GVL_BenchRead.SessionResetCount"; this.values[n] = String(BigInt(String(this.values[n])) + 1n);
      this.values["GVL_BenchRead.AppliedEpoch"] = "0"; this.values["GVL_BenchRead.AppliedSequence"] = "0";
    }
    if (items.some(i => i.path === "GVL_BenchWrite.RequestedSequence" && i.value !== "0")) {
      const slot = Number(this.values["GVL_BenchWrite.RequestedSlot"]);
      assert.equal(this.values[`GVL_BenchWrite.Slot${slot}_Valid`], true);
      for (const k of rawInputs) this.values[`GVL_BenchRead.Active_${k}`] = this.values[`GVL_BenchWrite.Slot${slot}_${k}`];
      if (this.torn) this.values["GVL_BenchRead.Active_Encoder_Count"] = 999;
      this.values["GVL_BenchRead.AppliedEpoch"] = this.values["GVL_BenchWrite.RequestedEpoch"];
      this.values["GVL_BenchRead.AppliedSequence"] = this.values["GVL_BenchWrite.RequestedSequence"];
      this.values["GVL_BenchRead.ActiveSlot"] = slot;
    }
    const c = "GVL_DemoRead.Status.";
    for (const name of ["Start", "Stop", "Reset"]) if (items.some(i => i.path === `GVL_DemoWrite.${name}Sequence`)) {
      this.values[`${c}${name}Ack`] = this.values[`GVL_DemoWrite.${name}Sequence`];
      if (name !== "Stop") this.values[`${c}${name}Accepted`] = true;
    }
    if (items.some(i => i.path === "GVL_DemoWrite.OfferSequence")) {
      this.values[`${c}OfferAckSequence`] = this.values["GVL_DemoWrite.OfferSequence"];
      this.values[`${c}OfferAckItemId`] = this.values["GVL_DemoWrite.OfferItemId"]; this.values[`${c}OfferAccepted`] = true;
    }
  }
}
const image = () => Object.fromEntries(world.manifest.signals.filter(s => s.direction === "world_to_plc").map(s => [s.id, s.dataType === "BOOL" ? false : 0]));
test("M8 map extends observation declarations without mutating preserved world behavior", () => {
  const wrapped = withM8Observations(world); validateManifest(wrapped.manifest);
  assert.equal(wrapped.tick, world.tick); assert.equal(wrapped.onControl, world.onControl);
  assert(wrapped.manifest.signals.some(s => s.id === "controller.CompletionDisposition"));
  assert(!world.manifest.signals.some(s => s.id === "controller.CompletionDisposition"));
  assert.throws(() => validateM8Image({ ...image(), extra: true }), /exact complete/);
  assert.throws(() => validateM8Image({ ...image(), Encoder_Count: -1 }), /UDINT/);
});
test("M8 connector uses five separate ordered writes, exact active image and at most 10 Hz", async () => {
  const t = new ProtocolTransport(), events: any[] = [], c = new M8OpcUaConnector(t, (kind, data) => events.push({ kind, ...data }));
  await c.open(); await c.resetSession(); const start = t.writes.length;
  const a = await c.commit({ ...image(), Encoder_Count: 13, Belt_SpeedActual: 0.1 }); const b = await c.commit(image());
  assert.equal(a.appliedSequence, "1"); assert.equal(b.appliedSequence, "2"); assert.equal(a.image.Belt_SpeedActual, Math.fround(0.1));
  assert(b.sentAtMonotonicMs - a.sentAtMonotonicMs >= 100);
  assert.equal(t.writes[start].length, 1); assert.equal(t.writes[start][0].value, false);
  assert.equal(t.writes[start+1].length, 22); assert.equal(t.writes[start+2][0].value, true);
  assert.deepEqual(t.writes[start+4].map(i => i.path), ["GVL_BenchWrite.RequestedSequence"]);
  assert.equal(events.filter(e => e.kind === "commit.acknowledged").length, 2); await c.close();
});
test("M8 rejects wrong build, bad quality, boot changes and torn images without retrying", async () => {
  for (const fault of ["build", "quality", "boot", "torn"]) {
    const t = new ProtocolTransport(), c = new M8OpcUaConnector(t); await c.open();
    if (fault === "build") t.build = 7;
    if (fault === "quality") t.badQuality = true;
    if (fault === "boot") t.boot = "boot-2";
    if (fault === "torn") t.torn = true;
    await assert.rejects(fault === "torn" ? c.commit(image()) : c.observe());
    const writes = t.writes.length; await assert.rejects(c.observe(), /quarantined/); assert.equal(t.writes.length, writes); await c.close();
  }
});
test("M8 WCS payload precedes sequence, operator ack is retained as campaign evidence", async () => {
  const t = new ProtocolTransport(), c = new M8OpcUaConnector(t), ledger = new CampaignLedger("m8-actions"); await c.open();
  const adapter = m8ControllerActions(c, ledger);
  await adapter.execute({ id: "offer", name: "assign_route", arguments: { itemId: "101", route: "A" } }, new AbortController().signal);
  assert.deepEqual(t.writes[0].map(i => i.path), ["GVL_DemoWrite.OfferItemId", "GVL_DemoWrite.OfferRoute"]);
  assert.equal(t.writes[1][0].path, "GVL_DemoWrite.OfferSequence");
  await adapter.execute({ id: "start", name: "operator_action", arguments: { action: "start" } }, new AbortController().signal);
  assert.equal(ledger.events.filter(e => e.type === "controller.action").length, 2);
  await assert.rejects(adapter.execute({ id: "bad", name: "assign_route", arguments: { itemId: "not-a-UDINT", route: "B" } }, new AbortController().signal), /UDINT/);
  await c.close();
});

test("authentication failure stays read/write-free; dirty baseline is rejected before simulation writes", async () => {
  const auth = new ProtocolTransport(); auth.open = async () => { throw new Error("BadUserAccessDenied"); };
  const c = new M8OpcUaConnector(auth, () => {}, { requireStoppedBaseline: true });
  await assert.rejects(c.open(), /BadUserAccessDenied/); assert.equal(auth.writes.length, 0); await c.close();
  for (const [name, badValue] of Object.entries({ Mode: 1, FaultCode: 23, ItemActive: true, CompletionPending: true })) {
    const t = new ProtocolTransport(); t.values[`GVL_DemoRead.Status.${name}`] = badValue;
    const dirty = new M8OpcUaConnector(t, () => {}, { requireStoppedBaseline: true });
    await assert.rejects(dirty.open(), /clean stopped M8 baseline/); assert.equal(t.writes.length, 0); await dirty.close();
  }
});
