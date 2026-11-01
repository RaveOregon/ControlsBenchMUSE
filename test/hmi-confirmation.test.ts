import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { M8Transport, TransportEvent } from "../src/live/m8-opcua.ts";
import type { CommandAction } from "../src/hmi/protocol.ts";
import { HmiService } from "../src/hmi/service.ts";
import { P } from "../src/hmi/signals.ts";
import { ScriptedPlc, waitFor } from "./fixtures/hmi/scripted-transport.ts";

type Wrap = (transport: M8Transport) => M8Transport;
async function harness(options: { wrap?: Wrap; writeTimeoutMs?: number; writeDrainMs?: number } = {}) {
  const plc = new ScriptedPlc();
  const root = mkdtempSync(join(tmpdir(), "hmi-confirm-"));
  const factory = (event: TransportEvent) => (options.wrap ?? (t => t))(plc.transport(event));
  const service = new HmiService({ source: { kind: "live_plc", endpoint: "scripted://m8", userConfigured: true, transportFactory: factory },
    pollIntervalMs: 20, ackTimeoutMs: 300, settleMs: 300, ownershipRoots: [root], commandPolicy: "enabled",
    writeTimeoutMs: options.writeTimeoutMs, writeDrainMs: options.writeDrainMs });
  await service.start();
  await waitFor(() => service.link.fresh, 2000, "fresh link");
  const cleanup = async () => { await service.stop(); rmSync(root, { recursive: true, force: true }); };
  return { plc, service, cleanup };
}
const UNCERTAIN = "UncertainLastUsableValue (0x40900000)";
const BAD = "BadNotConnected (0x808A0000)";
let n = 0;
const submit = (service: HmiService, action: CommandAction) => service.submitCommand({ requestId: `req-confirm-${String(++n).padStart(4, "0")}`, action, origin: "test" });

const sequenced: Array<{ action: "start" | "stop" | "reset"; ack: string; accepted?: string }> = [
  { action: "start", ack: P.startAck, accepted: P.startAccepted },
  { action: "stop", ack: P.stopAck },
  { action: "reset", ack: P.resetAck, accepted: P.resetAccepted }
];
const faults: Array<{ label: string; apply: (plc: ScriptedPlc, path: string) => void; pattern: RegExp }> = [
  { label: "Uncertain quality", apply: (plc, p) => { plc.sampleOverride[p] = { status: UNCERTAIN }; }, pattern: /quality Uncertain/ },
  { label: "Bad quality", apply: (plc, p) => { plc.sampleOverride[p] = { status: BAD }; }, pattern: /quality Bad/ },
  { label: "a missing sample", apply: (plc, p) => { plc.omit.add(p); }, pattern: /missing/ },
  { label: "no source timestamp", apply: (plc, p) => { plc.sampleOverride[p] = { sourceTimestamp: "" }; }, pattern: /timestamp/ },
  { label: "no server timestamp", apply: (plc, p) => { plc.sampleOverride[p] = { serverTimestamp: "" }; }, pattern: /timestamp/ }
];

for (const s of sequenced) for (const f of faults) {
  test(`${s.action}: an acknowledgement with ${f.label} is unconfirmed, never applied or rejected`, async () => {
    const { plc, service, cleanup } = await harness();
    try {
      f.apply(plc, s.ack);
      const c = await submit(service, s.action);
      assert.equal(c.outcome, "unconfirmed");
      assert.equal(c.accepted, undefined);
      assert.ok(c.deliveredAtIso, "the write was delivered");
      assert.equal(c.confirmation?.[s.ack]?.good, false);
      assert.match(c.detail, f.pattern);
      const terminal = service.journal.tail.find(r => r.type === "command.unconfirmed" && r.data.requestId === c.requestId);
      assert.ok(terminal, "journaled as unconfirmed");
      assert.equal((terminal.data.confirmation as Record<string, { good: boolean }>)[s.ack].good, false, "the actual confirmation sample is preserved");
    } finally { await cleanup(); }
  });
}

for (const s of sequenced.filter(x => x.accepted)) for (const f of [...faults, { label: "a non-boolean value", apply: (plc: ScriptedPlc, p: string) => { plc.sampleOverride[p] = { value: "TRUE" }; }, pattern: /unexpected value/ }]) {
  test(`${s.action}: a Good echo with ${f.label} on ${s.accepted!.split(".").at(-1)} is unconfirmed`, async () => {
    const { plc, service, cleanup } = await harness();
    try {
      if (s.action === "reset") plc.ack = "reject";
      f.apply(plc, s.accepted!);
      const c = await submit(service, s.action);
      assert.equal(c.outcome, "unconfirmed", "neither applied nor rejected");
      assert.equal(c.accepted, undefined);
      assert.equal(c.confirmation?.[s.ack]?.good, true);
      assert.equal(c.confirmation?.[s.accepted!]?.good, false);
      assert.match(c.detail, f.pattern);
    } finally { await cleanup(); }
  });
}

test("Review reproduction: StartAck and StartAccepted both Uncertain with valid-looking values is not applied", async () => {
  const { plc, service, cleanup } = await harness();
  try {
    plc.sampleOverride[P.startAck] = { status: UNCERTAIN }; plc.sampleOverride[P.startAccepted] = { status: UNCERTAIN };
    const c = await submit(service, "start");
    assert.equal(c.outcome, "unconfirmed");
    assert.notEqual(c.accepted, true);
    assert.equal(c.confirmation?.[P.startAck]?.status, UNCERTAIN);
  } finally { await cleanup(); }
});

test("A non-Good request sequence read is refused before any write", async () => {
  for (const f of faults) {
    const { plc, service, cleanup } = await harness();
    try {
      f.apply(plc, P.startSeq);
      const c = await submit(service, "start");
      assert.equal(c.outcome, "refused", f.label);
      assert.deepEqual(plc.writes, [], `${f.label}: nothing written`);
      assert.match(c.detail, /Not sent to the PLC/);
    } finally { await cleanup(); }
  }
});

for (const f of [...faults, { label: "a non-boolean value", apply: (plc: ScriptedPlc, p: string) => { plc.sampleOverride[p] = { value: 1 }; }, pattern: /unexpected value/ }]) {
  test(`Auto: a readback with ${f.label} is unconfirmed, not applied`, async () => {
    const { plc, service, cleanup } = await harness();
    try {
      f.apply(plc, P.autoRequest);
      const c = await submit(service, "auto_on");
      assert.equal(c.outcome, "unconfirmed");
      assert.equal(c.ackKind, "readback");
      assert.equal(c.acknowledgedAtIso, undefined);
      assert.equal(c.confirmation?.[P.autoRequest]?.good, false);
      assert.match(c.detail, f.pattern);
    } finally { await cleanup(); }
  });
}

test("Good-quality confirmation still applies, and its samples are kept as evidence", async () => {
  const { service, cleanup } = await harness();
  try {
    const c = await submit(service, "start");
    assert.equal(c.outcome, "applied");
    assert.equal(c.confirmation?.[P.startSeq]?.good, true);
    assert.equal(c.confirmation?.[P.startAck]?.good, true);
    assert.equal(c.confirmation?.[P.startAccepted]?.value, true);
  } finally { await cleanup(); }
});

/** Holds StartSequence writes until released, like a server request that outlives its client timeout. */
function delayStartWrites() {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const wrap: Wrap = t => ({ ...t, async write(items) { if (items.some(i => i.path === P.startSeq)) await gate; return t.write(items); } });
  return { wrap, release: () => release() };
}

test("Review reproduction: a timed-out Start write cannot be overtaken by a later Stop", async () => {
  const delayed = delayStartWrites();
  const { plc, service, cleanup } = await harness({ wrap: delayed.wrap, writeTimeoutMs: 150, writeDrainMs: 5000 });
  try {
    const start = await submit(service, "start");
    assert.equal(start.outcome, "unconfirmed", "a timeout is not cancellation");
    assert.match(start.detail, /may still apply/);
    assert.ok(service.link.quarantine, "operator writes quarantined");
    const stop = await submit(service, "stop");
    assert.equal(stop.outcome, "refused");
    assert.match(stop.detail, /operator writes held/);
    delayed.release();
    await waitFor(() => plc.writes.some(w => w.path === P.startSeq), 2000, "delayed Start landed");
    await waitFor(() => !service.link.quarantine, 3000, "quarantine cleared after settlement and a fresh read");
    const types = service.journal.tail.map(r => r.type).filter(t => t.startsWith("link.quarantine") || t === "link.write_settled");
    assert.deepEqual(types, ["link.quarantined", "link.write_settled", "link.quarantine_cleared"]);
    const cleared = service.journal.tail.find(r => r.type === "link.quarantine_cleared")!;
    assert.ok(Date.parse(String(cleared.data.freshReadRequestedAtIso)) >= Date.parse(String(cleared.data.settledAtIso)), "the clearing read was issued after settlement");
    await waitFor(() => service.link.fresh, 2000, "fresh link");
    const later = await submit(service, "stop");
    assert.equal(later.outcome, "applied");
    assert.deepEqual(plc.writes.map(w => w.path), [P.startSeq, P.stopSeq], "the Stop was written only after the Start settled");
  } finally { delayed.release(); await cleanup(); }
});

test("A write that never settles closes the session at the drain deadline, and a new session does not clear the quarantine", async () => {
  const delayed = delayStartWrites();
  const { plc, service, cleanup } = await harness({ wrap: delayed.wrap, writeTimeoutMs: 100, writeDrainMs: 200 });
  try {
    const start = await submit(service, "start");
    assert.equal(start.outcome, "unconfirmed");
    await waitFor(() => plc.closes >= 1 && plc.opens >= 2, 3000, "session closed and reopened");
    await waitFor(() => service.link.fresh, 3000, "fresh on the new session");
    assert.ok(service.link.quarantine, "still held: the old request may still land");
    assert.equal((await submit(service, "stop")).outcome, "refused");
    assert.deepEqual(plc.writes, []);
    delayed.release();
    await waitFor(() => !service.link.quarantine, 3000, "cleared once the write settled and a fresh read followed");
    assert.ok(service.journal.tail.some(r => r.type === "link.drain_expired"));
  } finally { delayed.release(); await cleanup(); }
});
