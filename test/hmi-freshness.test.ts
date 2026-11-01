import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyJournal, HmiJournal } from "../src/hmi/journal.ts";
import { PlcLink } from "../src/hmi/link.ts";
import { HmiService } from "../src/hmi/service.ts";
import { FixturePlc } from "../src/hmi/fixture.ts";
import { createHmiServer, listen } from "../src/hmi/http.ts";
import { ScriptedPlc, waitFor } from "./fixtures/hmi/scripted-transport.ts";

function link(plc: ScriptedPlc, extra: Partial<ConstructorParameters<typeof PlcLink>[0]> = {}) {
  return new PlcLink({ transportFactory: event => plc.transport(event), journal: new HmiJournal(), endpoint: "scripted://m8", pollIntervalMs: 20, staleAfterMs: 150,
    failuresBeforeReconnect: 3, backoffMs: [30], ...extra });
}

test("fresh means a recent good read; unchanged values are not stale", async () => {
  const plc = new ScriptedPlc(), l = link(plc);
  l.start();
  try {
    await waitFor(() => l.fresh, 1000, "fresh");
    await new Promise(r => setTimeout(r, 300)); // values unchanged for twice the stale threshold
    await waitFor(() => l.view.plcScanning !== null, 1000, "scan check");
    assert.equal(l.fresh, true);
    assert.equal(l.view.state, "connected");
    assert.equal(l.view.plcScanning, true);
  } finally { await l.stop(); }
});

test("a slower poll rate raises the stale threshold with it, so healthy slow polling is never shown stale", async () => {
  const plc = new ScriptedPlc(), l = new PlcLink({ transportFactory: event => plc.transport(event), journal: new HmiJournal(), endpoint: "scripted://m8", pollIntervalMs: 20 });
  l.start();
  try {
    await waitFor(() => l.fresh, 1000, "fresh");
    l.setPollInterval(600);
    assert.equal(l.view.staleAfterMs, 2400);
    await new Promise(r => setTimeout(r, 900));
    assert.equal(l.view.state, "connected", "no stale flag between healthy slow polls");
    const before = l.latest!.sequence;
    l.setPollInterval(20);
    await waitFor(() => l.latest!.sequence > before, 200, "faster rate applied at once");
  } finally { await l.stop(); }
});

test("read failures turn the link stale with values held, then reconnect with a fresh session", async () => {
  const plc = new ScriptedPlc(), l = link(plc, { failuresBeforeReconnect: 50, pollIntervalMs: 20 });
  l.start();
  try {
    await waitFor(() => l.fresh, 1000, "fresh");
    const held = l.latest!.sequence;
    plc.readFails = true;
    await waitFor(() => l.view.state === "stale", 1000, "stale");
    assert.equal(l.fresh, false);
    assert.equal(l.latest!.sequence, held, "last values held, not cleared or synthesized");
  } finally { await l.stop(); }
  const plc2 = new ScriptedPlc(), l2 = link(plc2);
  l2.start();
  try {
    await waitFor(() => l2.fresh, 1000, "fresh");
    plc2.readFails = true;
    await waitFor(() => l2.view.state === "reconnecting", 2000, "reconnecting");
    assert.ok(plc2.closes >= 1, "the failed session is closed");
    plc2.readFails = false;
    await waitFor(() => l2.fresh, 2000, "fresh again");
    assert.ok(l2.view.reconnects >= 1);
    assert.equal(plc2.opens, plc2.closes + 1, "every failed session was closed before a new one opened");
  } finally { await l2.stop(); }
});

test("reads are batched under the server's node limit; an oversized request is a configuration stop, not a reconnect loop", async () => {
  const plc = new ScriptedPlc(), l = link(plc);
  l.start();
  try {
    await waitFor(() => l.fresh, 1000, "fresh with batched reads");
    assert.equal(Object.keys(l.latest!.values).length, 103);
    assert.ok(Math.max(...plc.readSizes) <= 60);
  } finally { await l.stop(); }
  const plc2 = new ScriptedPlc(), l2 = link(plc2, { maxNodesPerRead: 200 });
  l2.start();
  try {
    await waitFor(() => l2.view.state === "disconnected", 1000, "configuration stop");
    await new Promise(r => setTimeout(r, 150));
    assert.equal(plc2.opens, 1, "no reconnect loop");
    assert.match(l2.view.detail, /configuration limit/);
  } finally { await l2.stop(); }
});

test("a rejected credential stops reconnection instead of hammering the PLC", async () => {
  const plc = new ScriptedPlc(); plc.openError = "BadUserAccessDenied (0x801f0000)";
  const l = link(plc);
  l.start();
  try {
    await waitFor(() => l.view.state === "disconnected", 1000, "disconnected");
    await new Promise(r => setTimeout(r, 150));
    assert.equal(plc.opens, 1);
    assert.match(l.view.detail, /no automatic retry/);
  } finally { await l.stop(); }
});

test("a frozen PlcCycle is reported as not scanning; a boot change is reported once", async () => {
  const plc = new ScriptedPlc(); const boots: string[] = [];
  const l = link(plc, { onBootChange: (from, to) => boots.push(`${from}->${to}`) });
  l.start();
  try {
    await waitFor(() => l.view.plcScanning === true, 1000, "scanning");
    plc.freezeCycle = true;
    await waitFor(() => l.view.plcScanning === false, 1000, "not scanning");
    plc.freezeCycle = false;
    plc.set({ "GVL_BenchRead.PlcBootIdentity": "boot-2" });
    await waitFor(() => boots.length === 1, 1000, "boot change");
    await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(boots, ["boot-1->boot-2"]);
    assert.equal(l.view.previousBootIdentity, "boot-1");
  } finally { await l.stop(); }
});

test("HTTP: identity and state are served; cross-origin and non-fixture controls are refused; client TS is stripped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hmi-http-"));
  const service = new HmiService({ source: { kind: "fixture", plc: new FixturePlc("m10-final-held") }, pollIntervalMs: 40, artifactRoot: dir, ownershipRoots: [dir] });
  const server = createHmiServer(service);
  service.url = await listen(server, 0);
  await service.start();
  try {
    await waitFor(() => service.link.fresh, 2000, "fresh");
    const identity = await (await fetch(`${service.url}api/identity`)).json();
    assert.equal(identity.source.kind, "fixture");
    assert.match(identity.source.fixtureBasis, /transport\.jsonl\.gz/);
    const state = await (await fetch(`${service.url}api/state`)).json();
    assert.equal(state.snapshot.values["GVL_DemoRead.Status.FaultCode"].value, 23);
    assert.equal(state.alarms.active[0].firstObservedBasis, "active_at_observation_start");
    assert.equal(state.preconditions.reset.find((p: { id: string }) => p.id === "completion").met, false);
    const cross = await fetch(`${service.url}api/commands`, { method: "POST", headers: { "content-type": "application/json", origin: "http://evil.example" }, body: JSON.stringify({ requestId: "x-000001", action: "stop" }) });
    assert.equal(cross.status, 403);
    const js = await fetch(`${service.url}app/main.ts`);
    assert.match(js.headers.get("content-type")!, /javascript/);
    const body = await js.text();
    assert.doesNotMatch(body, /import type/);
    assert.equal((await fetch(`${service.url}app/../../live/m8-map.ts`)).status, 404);
    // The fixture HMI clears the fixture cause, then Reset is accepted by the fixture emulation.
    const reset1 = await (await fetch(`${service.url}api/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "fx-reset-0001", action: "reset", origin: "test" }) })).json();
    assert.equal(reset1.outcome, "rejected");
    await fetch(`${service.url}api/fixture/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clearCause: true }) });
    await new Promise(r => setTimeout(r, 120));
    const reset2 = await (await fetch(`${service.url}api/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "fx-reset-0002", action: "reset", origin: "test" }) })).json();
    assert.equal(reset2.outcome, "applied");
  } finally {
    await service.stop(); server.close();
    assert.ok(verifyJournal(service.journal.file!).records > 5);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HTTP: fixture controls are refused in live mode", async () => {
  const plc = new ScriptedPlc(), dir = mkdtempSync(join(tmpdir(), "hmi-http-live-"));
  const service = new HmiService({ source: { kind: "live_plc", endpoint: "scripted://m8", userConfigured: true, transportFactory: e => plc.transport(e) }, pollIntervalMs: 40, ownershipRoots: [dir] });
  const server = createHmiServer(service);
  service.url = await listen(server, 0);
  await service.start();
  try {
    const res = await fetch(`${service.url}api/fixture/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fault: { code: 10, text: "x" } }) });
    assert.equal(res.status, 403);
  } finally { await service.stop(); server.close(); rmSync(dir, { recursive: true, force: true }); }
});
