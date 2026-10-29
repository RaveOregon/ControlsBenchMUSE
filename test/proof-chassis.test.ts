import assert from "node:assert/strict";
import test from "node:test";
import type { WorldManifest } from "../src/proof/contracts.ts";
import { validateManifest } from "../src/proof/manifest.ts";
import { InstrumentedWorldContext } from "../src/proof/world-context.ts";

const manifest: WorldManifest = {
  packageVersion: "1.0.0",
  stateSchemaVersion: "1",
  worldId: "generic-contract-fixture",
  name: "Generic contract fixture",
  tickMs: 50,
  signals: [
    {
      id: "out.command",
      name: "Command",
      direction: "plc_to_world",
      dataType: "BOOL",
      normalValue: false,
      deviceId: "device",
      role: "fixture.command",
      description: "Generic output"
    },
    {
      id: "in.home",
      name: "Home",
      direction: "world_to_plc",
      dataType: "BOOL",
      normalValue: true,
      deviceId: "device",
      role: "fixture.home",
      description: "Generic input"
    }
  ],
  controls: [{ id: "fixture.change", description: "Generic external intervention" }],
  inspectableState: ["fixture"],
  assumptions: [],
  faultCapabilities: [],
  evidenceTypes: ["fixture"],
  capabilities: { snapshot: true, migrate: true, seededRandom: true }
};

test("manifest validation rejects duplicate semantic roles", () => {
  const duplicate = structuredClone(manifest);
  duplicate.signals.push({ ...duplicate.signals[0], id: "out.other" });
  assert.throws(() => validateManifest(duplicate), /duplicate signal role/);
});

test("context begins with a zero PLC input image and records attributable effects", () => {
  const ctx = new InstrumentedWorldContext(manifest, { seed: 42, worldVersion: "test" });
  assert.equal(ctx.plc.currentInputState()["in.home"], false);
  ctx.plc.writeRawInput({ signalId: "in.home", value: true, cause: "fixture initialized" });
  assert.equal(ctx.plc.currentInputState()["in.home"], true);
  const event = ctx.events.at(-1);
  assert.equal(event?.lane, "raw_input");
  assert.equal(event?.worldVersion, "test");
  assert.equal(event?.data.cause, "fixture initialized");
});

test("context enforces direction, increasing frame sequences, and declared controls", () => {
  const ctx = new InstrumentedWorldContext(manifest, { seed: 7, worldVersion: "test" });
  assert.throws(() => ctx.plc.writeRawInput({ signalId: "out.command", value: true, cause: "wrong lane" }), /expected world_to_plc/);
  ctx.setPlcFrame({ sequence: 1, observedAtMs: 0, values: { "out.command": true } });
  assert.equal(ctx.plc.readRawOutput("out.command"), true);
  assert.throws(() => ctx.setPlcFrame({ sequence: 1, observedAtMs: 1, values: {} }), /sequence must increase/);
  assert.throws(() => ctx.recordControl({ id: "unknown", cause: "fixture" }), /Undeclared/);
  ctx.recordControl({ id: "fixture.change", cause: "fixture" });
});

test("seeded random and scheduled controls are repeatable", () => {
  const first = new InstrumentedWorldContext(manifest, { seed: 99, worldVersion: "a" });
  const second = new InstrumentedWorldContext(manifest, { seed: 99, worldVersion: "b" });
  assert.deepEqual(
    [first.random.next(), first.random.integer(2, 8)],
    [second.random.next(), second.random.integer(2, 8)]
  );
  first.schedule.at({ dueAtMs: 100, control: { id: "fixture.change", cause: "scheduled fixture" } });
  first.advance(50);
  assert.deepEqual(first.takeDueControls(), []);
  first.advance(50);
  assert.equal(first.takeDueControls()[0]?.id, "fixture.change");
});
