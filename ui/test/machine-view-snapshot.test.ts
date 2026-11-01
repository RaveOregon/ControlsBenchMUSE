import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { LoadedPackage } from "../../src/machine-view/frame.ts";
import { resolveSample } from "../../src/machine-view/frame.ts";
import { workspaceViewSnapshot } from "../src/model/machine-view-snapshot.ts";
import { WorkspaceStore } from "../src/model/workspace-store.ts";
import { ev, SIGNALS } from "./helpers.ts";

const root = new URL("../../", import.meta.url);
const pointer = JSON.parse(readFileSync(new URL("artifacts/machine-view/latest.json", root), "utf8"));
const read = (name: string) => JSON.parse(readFileSync(new URL(`${pointer.relativeDirectory}/${name}`, root), "utf8"));
const pkg: LoadedPackage = { manifest: read("view.manifest.json"), equipment: read("equipment.json"), bindings: read("view-bindings.json"), svg: null };

test("a public projection alone cannot supply carton positions; coordinator entity publications retain their evidence", () => {
  const store = new WorkspaceStore("replay", SIGNALS);
  assert.equal(workspaceViewSnapshot(pkg, store.state, 0).entities.supplied, false);
  const event = ev(10, { kind: "entity.publish", entityId: "carton-1", entityType: "carton", state: { itemId: "101", path: "exitA", positionM: 1.7, velocityMps: 0.5, requestedRoute: "A", jammed: false, lengthM: 0.3 } });
  event.provenance.sourceAtMs = 1234;
  store.applyEvents([event]);
  const snapshot = workspaceViewSnapshot(pkg, store.state, 10);
  assert.equal(snapshot.entities.supplied, true); assert.deepEqual(snapshot.entities.items[0]!.state, (event as typeof event & { state: unknown }).state);
  assert.equal(snapshot.entities.items[0]!.evidenceRef, event.id); assert.equal(snapshot.frame.sourceTimeMs, 1234);
  store.applyEvents([ev(20, { kind: "entity.remove", entityId: "carton-1", reason: "recorded exit" })]);
  assert.deepEqual(workspaceViewSnapshot(pkg, store.state, 20).entities.items, []);
});

test("the mounted-view adapter preserves unknown/bad quality, aging, held state and disconnected overlays", () => {
  const store = new WorkspaceStore("live", SIGNALS);
  Object.assign(store.state.connection, { link: "up", simulationApplied: true, lastPlcHeartbeatAtMs: 100 });
  store.state.inputs.PE_Entry = { value: true, quality: "good", observedAtMs: 100, eventId: "c:1#2" };
  store.state.outputs.Motor_RunCmd = { value: true, quality: "unknown", observedAtMs: 100, eventId: "c:2" };
  const channel = pkg.bindings.channels.find(c => c.id === "plc.Motor_RunCmd")!;
  let snapshot = workspaceViewSnapshot(pkg, store.state, 100);
  assert.equal(resolveSample(channel, snapshot).display, "unknown"); assert.equal(snapshot.channels["world.PE_Entry"]!.evidenceRef, "c:1");
  store.state.outputs.Motor_RunCmd.quality = "bad";
  assert.equal(resolveSample(channel, workspaceViewSnapshot(pkg, store.state, 100)).health, "bad");
  snapshot = workspaceViewSnapshot(pkg, store.state, 2201); assert.equal(snapshot.link.state, "stale");
  store.state.phase = "paused"; assert.equal(workspaceViewSnapshot(pkg, store.state, 100).link.state, "held");
  store.state.host = { state: "reconnecting", detail: "stream lost" };
  assert.equal(workspaceViewSnapshot(pkg, store.state, 100).link.state, "disconnected");
});
