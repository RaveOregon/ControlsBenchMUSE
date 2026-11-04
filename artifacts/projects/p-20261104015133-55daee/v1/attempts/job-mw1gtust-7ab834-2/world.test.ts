import { test } from "node:test";
import assert from "node:assert/strict";
import { world } from "./world.ts";
import type { PlcOutputFrame, RawValue, WorldContext } from "./contracts.ts";

function makeHarness() {
  const inputs: Record<string, RawValue> = {};
  const entities = new Map<string, Record<string, unknown>>();
  const outputs: Record<string, RawValue> = {
    Motor_RunCmd: false, D1_ExtendCmd: false, D2_ExtendCmd: false,
    StackLight_Red: false, StackLight_Green: false,
  };
  let tickNo: number = 0;
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

function boolInput(h: Harness, id: string): boolean {
  const v: RawValue = h.inputs[id] ?? false;
  return v === true;
}
function numInput(h: Harness, id: string): number {
  const v: RawValue = h.inputs[id] ?? 0;
  return typeof v === "number" ? v : Number(v);
}
function entityNum(e: Record<string, unknown> | undefined, key: string): number {
  if (!e) return Number.NaN;
  const v: unknown = e[key];
  return typeof v === "number" ? v : Number(v);
}

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
  assert.equal(boolInput(h, "PE_Entry"), false);
  assert.equal(boolInput(h, "D1_HomeFB"), true);
  assert.equal(boolInput(h, "D1_ExtendedFB"), false);
  assert.equal(boolInput(h, "Drive_RunningFB"), false);
  assert.equal(boolInput(h, "Runout_Ready"), true);
  assert.equal(numInput(h, "Belt_SpeedActual"), 0);
});

test("no motion and no encoder travel while drive is stopped", async () => {
  const h = makeHarness();
  await freshWorld(h);
  await world.onControl(h.ctx, { id: "carton.introduce", payload: { id: "c1" }, cause: "test" });
  const enc0: number = numInput(h, "Encoder_Count");
  await tickN(h, 30);
  const c: Record<string, unknown> | undefined = h.entities.get("c1");
  assert.ok(c, "carton entity published");
  assert.equal(entityNum(c, "positionM"), 0, "carton must not move without drive");
  assert.equal(entityNum(c, "velocityMps"), 0);
  assert.equal(numInput(h, "Encoder_Count"), enc0, "encoder must not advance without belt travel");
});

test("motion only under drive, encoder follows travel, deceleration on stop", async () => {
  const h = makeHarness();
  await freshWorld(h);
  await world.onControl(h.ctx, { id: "carton.introduce", payload: { id: "c2" }, cause: "test" });
  await setOutputs(h, { Motor_RunCmd: true });
  await tickN(h, 20);
  const moving: Record<string, unknown> | undefined = h.entities.get("c2");
  assert.ok(moving);
  const posRun: number = entityNum(moving, "positionM");
  const velRun: number = entityNum(moving, "velocityMps");
  assert.ok(posRun > 0, "carton travels under drive");
  assert.ok(velRun > 0, "carton has positive velocity under drive");
  const encRun: number = numInput(h, "Encoder_Count");
  assert.ok(encRun > 0, "encoder counts from belt travel");
  assert.ok(Math.abs(encRun / 1000 - posRun) < 0.05, "encoder distance consistent with carton travel");
  await setOutputs(h, { Motor_RunCmd: false });
  await tickN(h, 1);
  const coasting: Record<string, unknown> | undefined = h.entities.get("c2");
  assert.ok(coasting);
  const velCoast: number = entityNum(coasting, "velocityMps");
  assert.ok(velCoast < velRun, "velocity decreases after stop command (coast, not instant halt)");
  await tickN(h, 30);
  const stopped: Record<string, unknown> | undefined = h.entities.get("c2");
  assert.ok(stopped);
  assert.equal(entityNum(stopped, "velocityMps"), 0, "carton settles to rest");
  const posSettled: number = entityNum(stopped, "positionM");
  const encSettled: number = numInput(h, "Encoder_Count");
  await tickN(h, 10);
  const later: Record<string, unknown> | undefined = h.entities.get("c2");
  assert.ok(later);
  assert.equal(entityNum(later, "positionM"), posSettled, "position holds after settling");
  assert.equal(numInput(h, "Encoder_Count"), encSettled, "encoder holds after settling");
});

test("photoeyes are derived from carton position", async () => {
  const h = makeHarness();
  await freshWorld(h);
  await world.onControl(h.ctx, { id: "carton.introduce", payload: { id: "c3" }, cause: "test" });
  const entryAtStart: boolean = boolInput(h, "PE_Entry");
  assert.equal(entryAtStart, false);
  await setOutputs(h, { Motor_RunCmd: true });
  let sawEntry: boolean = false;
  let sawD1Approach: boolean = false;
  for (let i = 0; i < 60; i++) {
    await tickN(h, 1);
    const entryNow: boolean = boolInput(h, "PE_Entry");
    const d1Now: boolean = boolInput(h, "PE_D1Approach");
    if (entryNow) sawEntry = true;
    if (sawEntry && d1Now) sawD1Approach = true;
  }
  assert.ok(sawEntry, "entry photoeye trips as the carton passes it");
  assert.ok(sawD1Approach, "D1 approach trips later, in geometric order");
});

test("divert actuator travels with feedback following actual position", async () => {
  const h = makeHarness();
  await freshWorld(h);
  await setOutputs(h, { D1_ExtendCmd: true });
  await tickN(h, 1);
  const midPos: number = numInput(h, "D1_Position");
  assert.ok(midPos > 0 && midPos < 100, "divert is mid-travel after one tick");
  assert.equal(boolInput(h, "D1_HomeFB"), false, "neither limit asserted mid-travel");
  assert.equal(boolInput(h, "D1_ExtendedFB"), false);
  await tickN(h, 10);
  assert.equal(numInput(h, "D1_Position"), 100);
  assert.equal(boolInput(h, "D1_ExtendedFB"), true);
  assert.equal(boolInput(h, "D1_HomeFB"), false);
  await setOutputs(h, { D1_ExtendCmd: false });
  await tickN(h, 10);
  assert.equal(numInput(h, "D1_Position"), 0);
  assert.equal(boolInput(h, "D1_HomeFB"), true);
  assert.equal(boolInput(h, "D1_ExtendedFB"), false);
});

test("extended D1 sends the carton to Exit A only (actual position governs)", async () => {
  const h = makeHarness();
  await freshWorld(h);
  await world.onControl(h.ctx, { id: "carton.introduce", payload: { id: "c4" }, cause: "test" });
  await setOutputs(h, { Motor_RunCmd: true, D1_ExtendCmd: true });
  let sawA: boolean = false;
  let sawRunout: boolean = false;
  let sawB: boolean = false;
  for (let i = 0; i < 120 && h.entities.has("c4"); i++) {
    await tickN(h, 1);
    if (boolInput(h, "PE_ExitA")) sawA = true;
    if (boolInput(h, "PE_Runout")) sawRunout = true;
    if (boolInput(h, "PE_ExitB")) sawB = true;
  }
  const sawABool: boolean = sawA;
  const sawRunoutBool: boolean = sawRunout;
  const sawBBool: boolean = sawB;
  assert.ok(sawABool, "diverted carton passes Exit A");
  assert.equal(sawRunoutBool, false, "diverted carton never passes runout");
  assert.equal(sawBBool, false, "diverted carton never passes Exit B");
});

test("home diverts send the carton straight to runout", async () => {
  const h = makeHarness();
  await freshWorld(h);
  await world.onControl(h.ctx, { id: "carton.introduce", payload: { id: "c5" }, cause: "test" });
  await setOutputs(h, { Motor_RunCmd: true });
  let sawRunout: boolean = false;
  let sawA: boolean = false;
  for (let i = 0; i < 160 && h.entities.has("c5"); i++) {
    await tickN(h, 1);
    if (boolInput(h, "PE_Runout")) sawRunout = true;
    if (boolInput(h, "PE_ExitA")) sawA = true;
  }
  const sawRunoutBool: boolean = sawRunout;
  const sawABool: boolean = sawA;
  assert.ok(sawRunoutBool, "undiverted carton reaches runout");
  assert.equal(sawABool, false);
});

test("drive feedback failure suppresses feedback and motion", async () => {
  const h = makeHarness();
  await freshWorld(h);
  await world.onControl(h.ctx, { id: "fault.setDriveFeedbackFailure", payload: { active: true }, cause: "test" });
  await world.onControl(h.ctx, { id: "carton.introduce", payload: { id: "c6" }, cause: "test" });
  await setOutputs(h, { Motor_RunCmd: true });
  await tickN(h, 20);
  assert.equal(boolInput(h, "Drive_RunningFB"), false);
  const c: Record<string, unknown> | undefined = h.entities.get("c6");
  assert.ok(c);
  assert.equal(entityNum(c, "positionM"), 0, "no virtual motion when the drive does not run");
  await world.onControl(h.ctx, { id: "fault.clearAll", cause: "test" });
});
