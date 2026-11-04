import { test } from "node:test";
import assert from "node:assert/strict";
import { world } from "./world.ts";
import type { PlcOutputFrame, RawValue, WorldContext } from "./contracts.ts";

// Minimal WorldContext harness recording raw inputs and published entities.
function makeHarness() {
  const inputs: Record<string, RawValue> = {};
  const entities = new Map<string, Record<string, unknown>>();
  const outputs: Record<string, RawValue> = {
    Motor_RunCmd: false, D1_ExtendCmd: false, D2_ExtendCmd: false,
    StackLight_Red: false, StackLight_Green: false,
  };
  let tickNo = 0;
  const ctx: WorldContext = {
    time: { nowMs: 0, deltaMs: 100, tick: 0 },
    random: { next: () => 0.5, integer: (a: number, _b: number) => a },
    plc: {
      readRawOutput: (id: string) => outputs[id] ?? false,
      writeRawInput: (e) => { inputs[e.signalId] = e.value; },
      currentOutputFrame: (): PlcOutputFrame => ({ sequence: tickNo, observedAtMs: tickNo * 100, values: { ...outputs } }),
      currentInputState: () => ({ ...inputs }),
    },
    schedule: { at: () => "sched-1", cancel: () => undefined },
    entities: {
      publish: (s) => { entities.set(s.id, { ...s.state }); },
      remove: (id: string) => { entities.delete(id); },
    },
    evidence: { append: () => undefined },
    status: { report: () => undefined },
  };
  return { ctx, inputs, entities, outputs };
}

type Harness = ReturnType<typeof makeHarness>;

async function tickN(h: Harness, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await world.tick(h.ctx, { nowMs: (i + 1) * 100, deltaMs: 100, tick: i + 1 });
  }
}

async function setOutputs(h: Harness, patch: Record<string, RawValue>): Promise<void> {
  Object.assign(h.outputs, patch);
  await world.onPlcFrame(h.ctx, { sequence: 1, observedAtMs: 0, values: { ...h.outputs } });
}

async function freshWorld(h: Harness): Promise<void> {
  await world.initialize(h.ctx, { seed: 42, worldVersion: "1.0.2" });
}

test("normal state: photoeyes clear, diverts home, drive stopped", async () => {
  const h = makeHarness();
  await freshWorld(h);
  assert.equal(h.inputs.PE_Entry, false);
  assert.equal(h.inputs.D1_HomeFB, true);
  assert.equal(h.inputs.D1_ExtendedFB, false);
  assert.equal(h.inputs.Drive_RunningFB, false);
  assert.equal(h.inputs.Runout_Ready, true);
  assert.equal(h.inputs.Belt_SpeedActual, 0);
});

test("no motion and no encoder travel while drive is stopped", async () => {
  const h = makeHarness();
  await freshWorld(h);
  await world.onControl(h.ctx, { id: "carton.introduce", payload: { id: "c1" }, cause: "test" });
  const enc0 = Number(h.inputs.Encoder_Count ?? 0);
  await tickN(h, 30);
  const c = h.entities.get("c1");
  assert.ok(c, "carton entity published");
  assert.equal(Number(c.positionM), 0, "carton must not move without drive");
  assert.equal(Number(c.velocityMps), 0);
  assert.equal(Number(h.inputs.Encoder_Count ?? 0), enc0, "encoder must not advance without belt travel");
});

test("motion only under drive, encoder follows travel, deceleration on stop", async () => {
  const h = makeHarness();
  await freshWorld(h);
  await world.onControl(h.ctx, { id: "carton.introduce", payload: { id: "c2" }, cause: "test" });
  await setOutputs(h, { Motor_RunCmd: true });
  await tickN(h, 20);
  const moving = h.entities.get("c2");
  assert.ok(moving);
  const posRun = Number(moving.positionM);
  const velRun = Number(moving.velocityMps);
  assert.ok(posRun > 0, "carton travels under drive");
  assert.ok(velRun > 0, "carton has positive velocity under drive");
  const encRun = Number(h.inputs.Encoder_Count);
  assert.ok(encRun > 0, "encoder counts from belt travel");
  // Encoder travel and carton travel describe the same belt motion (within quantisation).
  assert.ok(Math.abs(encRun / 1000 - posRun) < 0.05, "encoder distance consistent with carton travel");
  await setOutputs(h, { Motor_RunCmd: false });
  await tickN(h, 1);
  const coasting = h.entities.get("c2");
  assert.ok(coasting);
  assert.ok(Number(coasting.velocityMps) < velRun, "velocity decreases after stop command (coast, not instant halt)");
  await tickN(h, 30);
  const stopped = h.entities.get("c2");
  assert.ok(stopped);
  assert.equal(Number(stopped.velocityMps), 0, "carton settles to rest");
  const posSettled = Number(stopped.positionM);
  const encSettled = Number(h.inputs.Encoder_Count);
  await tickN(h, 10);
  const later = h.entities.get("c2");
  assert.ok(later);
  assert.equal(Number(later.positionM), posSettled, "position holds after settling");
  assert.equal(Number(h.inputs.Encoder_Count), encSettled, "encoder holds after settling");
});

test("photoeyes are derived from carton position", async () => {
  const h = makeHarness();
  await freshWorld(h);
  await world.onControl(h.ctx, { id: "carton.introduce", payload: { id: "c3" }, cause: "test" });
  assert.equal(h.inputs.PE_Entry, false);
  await setOutputs(h, { Motor_RunCmd: true });
  let sawEntry = false;
  let sawD1Approach = false;
  for (let i = 0; i < 60; i++) {
    await tickN(h, 1);
    if (h.inputs.PE_Entry === true) sawEntry = true;
    if (sawEntry && h.inputs.PE_D1Approach === true) sawD1Approach = true;
  }
  assert.ok(sawEntry, "entry photoeye trips as the carton passes it");
  assert.ok(sawD1Approach, "D1 approach trips later, in geometric order");
});

test("divert actuator travels with feedback following actual position", async () => {
  const h = makeHarness();
  await freshWorld(h);
  await setOutputs(h, { D1_ExtendCmd: true });
  await tickN(h, 1);
  const midPos = Number(h.inputs.D1_Position);
  assert.ok(midPos > 0 && midPos < 100, "divert is mid-travel after one tick");
  assert.equal(h.inputs.D1_HomeFB, false, "neither limit asserted mid-travel");
  assert.equal(h.inputs.D1_ExtendedFB, false);
  await tickN(h, 10);
  assert.equal(Number(h.inputs.D1_Position), 100);
  assert.equal(h.inputs.D1_ExtendedFB, true);
  assert.equal(h.inputs.D1_HomeFB, false);
  await setOutputs(h, { D1_ExtendCmd: false });
  await tickN(h, 10);
  assert.equal(Number(h.inputs.D1_Position), 0);
  assert.equal(h.inputs.D1_HomeFB, true);
  assert.equal(h.inputs.D1_ExtendedFB, false);
});

test("extended D1 sends the carton to Exit A only (actual position governs)", async () => {
  const h = makeHarness();
  await freshWorld(h);
  await world.onControl(h.ctx, { id: "carton.introduce", payload: { id: "c4" }, cause: "test" });
  await setOutputs(h, { Motor_RunCmd: true, D1_ExtendCmd: true });
  let sawA = false;
  let sawRunout = false;
  let sawB = false;
  for (let i = 0; i < 120 && h.entities.has("c4"); i++) {
    await tickN(h, 1);
    if (h.inputs.PE_ExitA === true) sawA = true;
    if (h.inputs.PE_Runout === true) sawRunout = true;
    if (h.inputs.PE_ExitB === true) sawB = true;
  }
  assert.ok(sawA, "diverted carton passes Exit A");
  assert.equal(sawRunout, false, "diverted carton never passes runout");
  assert.equal(sawB, false, "diverted carton never passes Exit B");
});

test("home diverts send the carton straight to runout", async () => {
  const h = makeHarness();
  await freshWorld(h);
  await world.onControl(h.ctx, { id: "carton.introduce", payload: { id: "c5" }, cause: "test" });
  await setOutputs(h, { Motor_RunCmd: true });
  let sawRunout = false;
  let sawA = false;
  for (let i = 0; i < 160 && h.entities.has("c5"); i++) {
    await tickN(h, 1);
    if (h.inputs.PE_Runout === true) sawRunout = true;
    if (h.inputs.PE_ExitA === true) sawA = true;
  }
  assert.ok(sawRunout, "undiverted carton reaches runout");
  assert.equal(sawA, false);
});

test("drive feedback failure suppresses feedback and motion", async () => {
  const h = makeHarness();
  await freshWorld(h);
  await world.onControl(h.ctx, { id: "fault.setDriveFeedbackFailure", payload: { active: true }, cause: "test" });
  await world.onControl(h.ctx, { id: "carton.introduce", payload: { id: "c6" }, cause: "test" });
  await setOutputs(h, { Motor_RunCmd: true });
  await tickN(h, 20);
  assert.equal(h.inputs.Drive_RunningFB, false);
  const c = h.entities.get("c6");
  assert.ok(c);
  assert.equal(Number(c.positionM), 0, "no virtual motion when the drive does not run");
  await world.onControl(h.ctx, { id: "fault.clearAll", cause: "test" });
});
