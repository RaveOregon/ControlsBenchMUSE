import { test } from "node:test";
import assert from "node:assert/strict";
import type { EntitySnapshot, EvidenceEvent, PlcOutputFrame, RawInputEffect, WorldContext } from "../../../src/proof/contracts.ts";
import { world } from "./world.ts";

class MockCtx implements WorldContext {
  now = 0;
  tickNo = 0;
  outputs: Record<string, boolean | number | string | null> = { Motor_RunCmd: false, D1_ExtendCmd: false, D2_ExtendCmd: false, StackLight_Red: false, StackLight_Green: false };
  inputs: Record<string, boolean | number | string | null> = {};
  entityMap = new Map<string, EntitySnapshot>();
  removed: string[] = [];
  events: EvidenceEvent[] = [];
  readonly time = { get nowMs() { return 0; }, deltaMs: 20, tick: 0 } as WorldContext["time"];
  // time is replaced per-instance below via Object.defineProperty
  readonly random = { next: () => 0.5, integer: (a: number, _b: number) => a };
  readonly plc = {
    readRawOutput: (id: string) => this.outputs[id] ?? false,
    writeRawInput: (e: RawInputEffect) => { this.inputs[e.signalId] = e.value; },
    currentOutputFrame: (): PlcOutputFrame => ({ sequence: this.tickNo, observedAtMs: this.now, values: { ...this.outputs } }),
    currentInputState: () => ({ ...this.inputs }),
  };
  readonly schedule = { at: () => "a1", cancel: () => undefined };
  readonly entities = {
    publish: (s: EntitySnapshot) => { this.entityMap.set(s.id, s); },
    remove: (id: string) => { this.entityMap.delete(id); this.removed.push(id); },
  };
  readonly evidence = { append: (e: EvidenceEvent) => { this.events.push(e); } };
  readonly status = { report: () => undefined };
  constructor() {
    const self = this;
    Object.defineProperty(this, "time", { value: { get nowMs() { return self.now; }, get deltaMs() { return 20; }, get tick() { return self.tickNo; } } });
  }
  asCtx(): WorldContext { return this as unknown as WorldContext; }
}

async function setup(): Promise<MockCtx> {
  const m = new MockCtx();
  await world.initialize(m.asCtx(), { seed: 42, worldVersion: "0.5.0" });
  return m;
}
async function run(m: MockCtx, ms: number): Promise<void> {
  const steps = Math.round(ms / 20);
  for (let i = 0; i < steps; i++) {
    m.now += 20; m.tickNo += 1;
    await world.tick(m.asCtx(), { nowMs: m.now, deltaMs: 20, tick: m.tickNo });
  }
}
function carton(m: MockCtx): EntitySnapshot {
  const list = [...m.entityMap.values()].filter((e) => e.type === "carton");
  assert.equal(list.length, 1);
  return list[0]!;
}

test("initialize establishes physically normal no-carton state", async () => {
  const m = await setup();
  assert.equal(m.inputs["PE_Entry"], false);
  assert.equal(m.inputs["PE_ExitA"], false);
  assert.equal(m.inputs["D1_HomeFB"], true);
  assert.equal(m.inputs["D1_ExtendedFB"], false);
  assert.equal(m.inputs["D2_HomeFB"], true);
  assert.equal(m.inputs["Drive_RunningFB"], false);
  assert.equal(m.inputs["Drive_Overload"], false);
  assert.equal(m.inputs["ExitA_Ready"], true);
  assert.equal(m.inputs["Runout_Ready"], true);
  assert.equal(m.inputs["Encoder_Count"], 0);
});

test("no motion and no encoder advance while drive is stopped", async () => {
  const m = await setup();
  await world.onControl(m.asCtx(), { id: "carton.introduce", payload: { itemId: "T1", requestedRoute: "A" }, cause: "test introduce" });
  const before = carton(m).state["positionM"] as number;
  await run(m, 1000);
  assert.equal(carton(m).state["positionM"], before);
  assert.equal(carton(m).state["velocityMps"], 0);
  assert.equal(m.inputs["Encoder_Count"], 0);
  assert.equal(m.inputs["Drive_RunningFB"], false);
});

test("carton moves only after drive running feedback, encoder quantizes and increases", async () => {
  const m = await setup();
  await world.onControl(m.asCtx(), { id: "carton.introduce", payload: { itemId: "T2" }, cause: "test introduce" });
  m.outputs["Motor_RunCmd"] = true;
  await run(m, 100); // inside start delay: feedback not yet true
  assert.equal(m.inputs["Drive_RunningFB"], false);
  await run(m, 1500);
  assert.equal(m.inputs["Drive_RunningFB"], true);
  const pos = carton(m).state["positionM"] as number;
  assert.ok(pos > 0.2, `expected motion, got ${pos}`);
  const enc = m.inputs["Encoder_Count"] as number;
  assert.ok(Number.isInteger(enc) && enc > 100, `encoder ${enc}`);
  // entry sensor must have been physically derived: carton passes 0.5 m
  assert.ok(pos > 0.5);
});

test("drive feedback failure prevents motion despite run command", async () => {
  const m = await setup();
  await world.onControl(m.asCtx(), { id: "fault.setDriveFeedbackFailure", payload: { active: true }, cause: "test fault" });
  await world.onControl(m.asCtx(), { id: "carton.introduce", payload: { itemId: "T3" }, cause: "test introduce" });
  m.outputs["Motor_RunCmd"] = true;
  await run(m, 1500);
  assert.equal(m.inputs["Drive_RunningFB"], false);
  assert.equal(carton(m).state["positionM"], 0);
  assert.equal(m.inputs["Encoder_Count"], 0);
});

test("divert takes travel time and actual position decides path to A", async () => {
  const m = await setup();
  await world.onControl(m.asCtx(), { id: "carton.introduce", payload: { itemId: "T4", requestedRoute: "A" }, cause: "test introduce" });
  m.outputs["Motor_RunCmd"] = true;
  m.outputs["D1_ExtendCmd"] = true;
  await run(m, 100);
  assert.equal(m.inputs["D1_ExtendedFB"], false); // still travelling
  assert.equal(m.inputs["D1_HomeFB"], false);
  await run(m, 6000);
  assert.equal(m.removed.length, 1);
  assert.ok(m.events.some((e) => e.type === "carton.exited" && e.data?.["actualExit"] === "A"));
});

test("requested A without divert actuation physically reaches runout", async () => {
  const m = await setup();
  await world.onControl(m.asCtx(), { id: "carton.introduce", payload: { itemId: "T5", requestedRoute: "A" }, cause: "test introduce" });
  m.outputs["Motor_RunCmd"] = true;
  await run(m, 10000);
  assert.ok(m.events.some((e) => e.type === "carton.exited" && e.data?.["actualExit"] === "runout"));
  assert.ok(!m.events.some((e) => e.type === "carton.exited" && e.data?.["actualExit"] === "A"));
});

test("contradictory limits fault makes both raw limits true while physical position stays home", async () => {
  const m = await setup();
  await world.onControl(m.asCtx(), { id: "fault.setContradictoryLimits", payload: { divert: 1, active: true }, cause: "test fault" });
  await run(m, 40);
  assert.equal(m.inputs["D1_HomeFB"], true);
  assert.equal(m.inputs["D1_ExtendedFB"], true);
  assert.equal(m.inputs["D1_Position"], 0);
});

test("snapshot restores carton state through migrate-shaped data", async () => {
  const m = await setup();
  await world.onControl(m.asCtx(), { id: "carton.introduce", payload: { itemId: "T6", requestedRoute: "B" }, cause: "test introduce" });
  const snap = await world.snapshot(m.asCtx());
  const st = snap.state as { cartons: Array<{ itemId: string; requestedRoute: string | null }> };
  assert.equal(st.cartons[0]?.itemId, "T6");
  assert.equal(st.cartons[0]?.requestedRoute, "B");
});
