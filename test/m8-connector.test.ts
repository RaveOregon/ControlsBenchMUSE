import assert from "node:assert/strict";
import test from "node:test";
import { M8OpcUaConnector } from "../src/live/m8-opcua.ts";
import { ProtocolTransport } from "./fixtures/m8-protocol-transport.ts";
import { validateM8Image, withM8Observations } from "../src/live/m8-map.ts";
import world from "../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts";
import { CampaignLedger } from "../src/campaign/ledger.ts";
import { m8ControllerActions } from "../src/campaign/m8-bindings.ts";
import { validateManifest } from "../src/proof/manifest.ts";

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

test("lightweight link inspection retains full receipt evidence without rereading the 72-field image/status batch", async () => {
  const t = new ProtocolTransport(), c = new M8OpcUaConnector(t); await c.open();
  const receipt = await c.commit(image()), full = c.latest; t.readSizes.length = 0;
  const link = await c.inspectLink();
  assert.deepEqual(link.values, {}); assert(t.readSizes.every(n => n <= 12));
  assert.equal(c.latest, full); assert.equal(receipt.image.Encoder_Count, 0);
  assert(Object.hasOwn(receipt.values, "controller.CompletionSequence")); await c.close();
});
