import type { GeneratedWorldModule, PlcOutputFrame, RawValue, WorldContext, WorldControl, WorldManifest, WorldSnapshot, WorldTick } from "./contracts.ts";

// Slow-belt conveyor — external physical world only.
// No PLC sequencing, routing, counting, alarm or acceptance logic lives here.
// Physics: belt drive with accel/decel, cartons carried by the belt, geometric
// photoeyes, two two-position divert actuators, downstream readiness, faults.

const BELT_SPEED_MPS = 0.3; // specified, spec section 2 (slow-belt variant)
const CARTON_LENGTH_M = 0.3; // suggested starting value, spec section 2
const DIVERT_TRAVEL_S = 0.35; // suggested starting value per divert, spec section 2
const DRIVE_ACCEL_MPS2 = 0.6; // inferred
const DRIVE_DECEL_MPS2 = 0.6; // inferred
const ENCODER_COUNTS_PER_M = 1000; // inferred; PLC owns scaling
const DRIVE_FB_DELAY_S = 0.1; // inferred
const DIVERT_DECISION_PCT = 80; // inferred actual-position threshold at decision point
const UINT32_MOD = 4294967296;

const PE_ENTRY_M = 0.3; // inferred geometry (order specified in section 2)
const PE_D1_APPROACH_M = 1.0;
const D1_DECISION_M = 1.4;
const PE_D2_APPROACH_M = 2.0;
const D2_DECISION_M = 2.4;
const PE_EXIT_A_M = 2.0; // on A branch, 0.6 m past D1 decision
const PE_EXIT_B_M = 3.0; // on B branch, 0.6 m past D2 decision
const PE_RUNOUT_M = 3.2; // main lane
const REMOVE_PAST_SENSOR_M = 0.5;

type Branch = "main" | "A" | "B";

interface CartonState {
  id: string;
  positionM: number;
  velocityMps: number;
  lengthM: number;
  branch: Branch;
  passedD1: boolean;
  passedD2: boolean;
}

interface FaultState {
  driveFeedbackFailure: boolean;
  overload: boolean;
  divertJamD1: boolean;
  divertJamD2: boolean;
  contradictoryD1: boolean;
  contradictoryD2: boolean;
  cartonJam: boolean;
  stuckSignals: Record<string, boolean>;
  bounceSignals: string[];
}

interface WorldState {
  timeMs: number;
  tickCount: number;
  beltSpeedMps: number;
  totalTravelM: number;
  driveFbTimerS: number;
  d1PositionPct: number;
  d2PositionPct: number;
  cartons: CartonState[];
  nextCartonSeq: number;
  downstreamReady: { A: boolean; B: boolean; Runout: boolean };
  faults: FaultState;
  plcOutputs: Record<string, RawValue>;
}

function defaultFaults(): FaultState {
  return {
    driveFeedbackFailure: false,
    overload: false,
    divertJamD1: false,
    divertJamD2: false,
    contradictoryD1: false,
    contradictoryD2: false,
    cartonJam: false,
    stuckSignals: {},
    bounceSignals: [],
  };
}

function defaultState(): WorldState {
  return {
    timeMs: 0,
    tickCount: 0,
    beltSpeedMps: 0,
    totalTravelM: 0,
    driveFbTimerS: 0,
    d1PositionPct: 0,
    d2PositionPct: 0,
    cartons: [],
    nextCartonSeq: 1,
    downstreamReady: { A: true, B: true, Runout: true },
    faults: defaultFaults(),
    plcOutputs: {
      Motor_RunCmd: false,
      D1_ExtendCmd: false,
      D2_ExtendCmd: false,
      StackLight_Red: false,
      StackLight_Green: false,
    },
  };
}

let state: WorldState = defaultState();

function outBool(id: string): boolean {
  return state.plcOutputs[id] === true;
}

function payloadBool(payload: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
  if (payload && typeof payload[key] === "boolean") return payload[key] as boolean;
  return fallback;
}

function payloadText(payload: Record<string, unknown> | undefined, keys: string[]): string {
  if (!payload) return "";
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

function divertSelector(text: string): "D1" | "D2" | "both" {
  const t = text.toLowerCase();
  if (t.includes("d2") || t === "2" || t.includes("second")) return "D2";
  if (t.includes("d1") || t === "1" || t.includes("first")) return "D1";
  return "both";
}

const KNOWN_BOOL_INPUTS: string[] = [
  "PE_Entry", "PE_D1Approach", "PE_D2Approach", "PE_ExitA", "PE_ExitB", "PE_Runout",
  "D1_HomeFB", "D1_ExtendedFB", "D2_HomeFB", "D2_ExtendedFB",
  "Drive_RunningFB", "Drive_Overload", "ExitA_Ready", "ExitB_Ready", "Runout_Ready",
];

function normaliseSignalId(text: string): string {
  if (KNOWN_BOOL_INPUTS.includes(text)) return text;
  const t = text.toLowerCase();
  if (t.includes("d1") && t.includes("approach")) return "PE_D1Approach";
  if (t.includes("d2") && t.includes("approach")) return "PE_D2Approach";
  if (t.includes("entry")) return "PE_Entry";
  if (t.includes("exita") || t.endsWith("a")) return "PE_ExitA";
  if (t.includes("exitb") || t.endsWith("b")) return "PE_ExitB";
  if (t.includes("runout")) return "PE_Runout";
  if (t.includes("d1") && t.includes("extended")) return "D1_ExtendedFB";
  if (t.includes("d1") && t.includes("home")) return "D1_HomeFB";
  if (t.includes("d2") && t.includes("extended")) return "D2_ExtendedFB";
  if (t.includes("d2") && t.includes("home")) return "D2_HomeFB";
  if (t.includes("running")) return "Drive_RunningFB";
  if (t.includes("overload")) return "Drive_Overload";
  return text;
}

function sensorBlocked(carton: CartonState, sensorM: number): boolean {
  // positionM is the leading edge; the carton body spans [pos-length, pos].
  return carton.positionM >= sensorM && carton.positionM - carton.lengthM <= sensorM;
}

function anyCartonAt(sensorM: number, branch: Branch | "any"): boolean {
  return state.cartons.some((c) => (branch === "any" || c.branch === branch) && sensorBlocked(c, sensorM));
}

function encoderCount(): number {
  const raw = Math.floor(state.totalTravelM * ENCODER_COUNTS_PER_M);
  return ((raw % UINT32_MOD) + UINT32_MOD) % UINT32_MOD;
}

function writeAllInputs(ctx: WorldContext, causePrefix: string): void {
  const f = state.faults;
  const physical: Record<string, RawValue> = {};
  physical["PE_Entry"] = anyCartonAt(PE_ENTRY_M, "any");
  physical["PE_D1Approach"] = anyCartonAt(PE_D1_APPROACH_M, "any");
  physical["PE_D2Approach"] = anyCartonAt(PE_D2_APPROACH_M, "main");
  physical["PE_ExitA"] = anyCartonAt(PE_EXIT_A_M, "A");
  physical["PE_ExitB"] = anyCartonAt(PE_EXIT_B_M, "B");
  physical["PE_Runout"] = anyCartonAt(PE_RUNOUT_M, "main");
  physical["D1_HomeFB"] = state.d1PositionPct <= 0;
  physical["D1_ExtendedFB"] = state.d1PositionPct >= 100;
  physical["D2_HomeFB"] = state.d2PositionPct <= 0;
  physical["D2_ExtendedFB"] = state.d2PositionPct >= 100;
  const driveEnergised = outBool("Motor_RunCmd") && !f.overload && !f.driveFeedbackFailure;
  physical["Drive_RunningFB"] = !f.driveFeedbackFailure && driveEnergised && state.driveFbTimerS >= DRIVE_FB_DELAY_S;
  physical["Drive_Overload"] = f.overload;
  physical["ExitA_Ready"] = state.downstreamReady.A;
  physical["ExitB_Ready"] = state.downstreamReady.B;
  physical["Runout_Ready"] = state.downstreamReady.Runout;
  if (f.contradictoryD1) { physical["D1_HomeFB"] = true; physical["D1_ExtendedFB"] = true; }
  if (f.contradictoryD2) { physical["D2_HomeFB"] = true; physical["D2_ExtendedFB"] = true; }

  for (const id of KNOWN_BOOL_INPUTS) {
    let value = physical[id] === true;
    let cause = causePrefix + ":physical-state";
    if (Object.prototype.hasOwnProperty.call(f.stuckSignals, id)) {
      value = f.stuckSignals[id] === true;
      cause = causePrefix + ":fault-sensor-stuck:" + id;
    } else if (f.bounceSignals.includes(id)) {
      value = state.tickCount % 2 === 0 ? value : !value;
      cause = causePrefix + ":fault-sensor-bounce:" + id;
    }
    ctx.plc.writeRawInput({ signalId: id, value, cause });
  }
  ctx.plc.writeRawInput({ signalId: "Belt_SpeedActual", value: state.beltSpeedMps, cause: causePrefix + ":belt-dynamics" });
  const current = f.overload ? 8 : (BELT_SPEED_MPS > 0 ? 2 * (state.beltSpeedMps / BELT_SPEED_MPS) : 0);
  ctx.plc.writeRawInput({ signalId: "Drive_Current", value: current, cause: causePrefix + ":drive-load-model" });
  ctx.plc.writeRawInput({ signalId: "D1_Position", value: state.d1PositionPct, cause: causePrefix + ":divert1-actuator-position" });
  ctx.plc.writeRawInput({ signalId: "D2_Position", value: state.d2PositionPct, cause: causePrefix + ":divert2-actuator-position" });
  ctx.plc.writeRawInput({ signalId: "Encoder_Count", value: encoderCount(), cause: causePrefix + ":encoder-from-belt-travel" });
}

function publishCartons(ctx: WorldContext): void {
  for (const c of state.cartons) {
    ctx.entities.publish({
      id: c.id,
      type: "carton",
      state: {
        positionM: c.positionM,
        velocityMps: c.velocityMps,
        lengthM: c.lengthM,
        branch: c.branch,
        passedD1: c.passedD1,
        passedD2: c.passedD2,
      },
    });
  }
}

function stepActuator(currentPct: number, extendCmd: boolean, jammed: boolean, dtS: number): number {
  if (jammed) return currentPct;
  const rate = 100 / DIVERT_TRAVEL_S;
  if (extendCmd) return Math.min(100, currentPct + rate * dtS);
  return Math.max(0, currentPct - rate * dtS);
}

function removalLimitM(c: CartonState): number {
  if (c.branch === "A") return PE_EXIT_A_M + REMOVE_PAST_SENSOR_M;
  if (c.branch === "B") return PE_EXIT_B_M + REMOVE_PAST_SENSOR_M;
  return PE_RUNOUT_M + REMOVE_PAST_SENSOR_M;
}

const manifest: WorldManifest = {
  packageVersion: "1.0.2",
  stateSchemaVersion: "1.0.0",
  worldId: "m8-conveyor-1.0.2",
  name: "Slow-belt conveyor variant (M8)",
  tickMs: 100,
  signals: [
    { id: "PE_Entry", name: "PE_Entry", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "conveyor", role: "sensor.entry", description: "Carton blocks the entry beam; derived from carton position and length." },
    { id: "PE_D1Approach", name: "PE_D1Approach", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "conveyor", role: "sensor.d1Approach", description: "Carton in the decision window before divert 1." },
    { id: "PE_D2Approach", name: "PE_D2Approach", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "conveyor", role: "sensor.d2Approach", description: "Carton on the main lane toward divert 2." },
    { id: "PE_ExitA", name: "PE_ExitA", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "conveyor", role: "sensor.exitA", description: "Carton passes diverted exit A." },
    { id: "PE_ExitB", name: "PE_ExitB", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "conveyor", role: "sensor.exitB", description: "Carton passes diverted exit B." },
    { id: "PE_Runout", name: "PE_Runout", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "conveyor", role: "sensor.runout", description: "Carton passes the straight runout." },
    { id: "D1_HomeFB", name: "D1_HomeFB", direction: "world_to_plc", dataType: "BOOL", normalValue: true, deviceId: "divert1", role: "divert1.homeFeedback", description: "Divert 1 fully home; false during travel or failure." },
    { id: "D1_ExtendedFB", name: "D1_ExtendedFB", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "divert1", role: "divert1.extendedFeedback", description: "Divert 1 fully extended." },
    { id: "D2_HomeFB", name: "D2_HomeFB", direction: "world_to_plc", dataType: "BOOL", normalValue: true, deviceId: "divert2", role: "divert2.homeFeedback", description: "Divert 2 fully home." },
    { id: "D2_ExtendedFB", name: "D2_ExtendedFB", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "divert2", role: "divert2.extendedFeedback", description: "Divert 2 fully extended." },
    { id: "Drive_RunningFB", name: "Drive_RunningFB", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "drive", role: "drive.runningFeedback", description: "Actual drive-running feedback, delayed after Motor_RunCmd and suppressible on failure." },
    { id: "Drive_Overload", name: "Drive_Overload", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "drive", role: "drive.overload", description: "Simulated overload/trip input; normally false." },
    { id: "ExitA_Ready", name: "ExitA_Ready", direction: "world_to_plc", dataType: "BOOL", normalValue: true, deviceId: "downstream", role: "downstream.exitAReady", description: "Destination A can accept a carton." },
    { id: "ExitB_Ready", name: "ExitB_Ready", direction: "world_to_plc", dataType: "BOOL", normalValue: true, deviceId: "downstream", role: "downstream.exitBReady", description: "Destination B can accept a carton." },
    { id: "Runout_Ready", name: "Runout_Ready", direction: "world_to_plc", dataType: "BOOL", normalValue: true, deviceId: "downstream", role: "downstream.runoutReady", description: "Runout can accept a carton; normally true." },
    { id: "Belt_SpeedActual", name: "Belt_SpeedActual", direction: "world_to_plc", dataType: "REAL", normalValue: 0, deviceId: "drive", role: "drive.speedActual", description: "Actual belt speed in m/s." },
    { id: "Drive_Current", name: "Drive_Current", direction: "world_to_plc", dataType: "REAL", normalValue: 0, deviceId: "drive", role: "drive.current", description: "Simulated drive current in A (diagnostic)." },
    { id: "D1_Position", name: "D1_Position", direction: "world_to_plc", dataType: "REAL", normalValue: 0, deviceId: "divert1", role: "divert1.position", description: "Divert 1 actual position, 0-100 percent." },
    { id: "D2_Position", name: "D2_Position", direction: "world_to_plc", dataType: "REAL", normalValue: 0, deviceId: "divert2", role: "divert2.position", description: "Divert 2 actual position, 0-100 percent." },
    { id: "Encoder_Count", name: "Encoder_Count", direction: "world_to_plc", dataType: "UDINT", normalValue: 0, deviceId: "drive", role: "motion.encoderCount", description: "Encoder counts from belt travel, quantised, UDINT wrap; PLC owns scaling." },
    { id: "Motor_RunCmd", name: "Motor_RunCmd", direction: "plc_to_world", dataType: "BOOL", normalValue: false, deviceId: "drive", role: "drive.runCommand", description: "PLC command to the belt drive. Cartons move only if the simulated drive actually runs." },
    { id: "D1_ExtendCmd", name: "D1_ExtendCmd", direction: "plc_to_world", dataType: "BOOL", normalValue: false, deviceId: "divert1", role: "divert1.extendCommand", description: "Extend divert 1 to exit A; deassert returns home." },
    { id: "D2_ExtendCmd", name: "D2_ExtendCmd", direction: "plc_to_world", dataType: "BOOL", normalValue: false, deviceId: "divert2", role: "divert2.extendCommand", description: "Extend divert 2 to exit B; deassert returns home." },
    { id: "StackLight_Red", name: "StackLight_Red", direction: "plc_to_world", dataType: "BOOL", normalValue: false, deviceId: "stacklight", role: "indication.stackRed", description: "Optional visible machine-fault indication." },
    { id: "StackLight_Green", name: "StackLight_Green", direction: "plc_to_world", dataType: "BOOL", normalValue: false, deviceId: "stacklight", role: "indication.stackGreen", description: "Optional visible running/ready indication." },
  ],
  controls: [
    { id: "carton.introduce", description: "Introduce a physical carton at the entry (position 0). Payload may carry id/itemId; route is ignored by the physics." },
    { id: "downstream.setReady", description: "Set downstream readiness. Payload: exit/destination/signalId (A, B or Runout) and ready/value boolean." },
    { id: "fault.setDriveFeedbackFailure", description: "Drive produces no running state/feedback while active; belt does not move. Payload: active/value boolean." },
    { id: "fault.setOverload", description: "Assert Drive_Overload and trip the physical drive while active. Payload: active/value boolean." },
    { id: "fault.setDivertJam", description: "Freeze a divert actuator (D1, D2, or both if unspecified). Payload: divert/divertId, active/value." },
    { id: "fault.setContradictoryLimits", description: "Force home and extended feedback simultaneously on D1, D2, or both. Payload: divert/divertId, active/value." },
    { id: "fault.setSensorStuck", description: "Hold a boolean input at a fixed value despite physics. Payload: signalId/sensor, value, active." },
    { id: "fault.setSensorBounce", description: "Toggle a boolean input on alternate ticks. Payload: signalId/sensor, active." },
    { id: "fault.setCartonJam", description: "Hold cartons stationary while the belt runs. Payload: active/value boolean." },
    { id: "fault.clearAll", description: "Clear all injected faults (drive, overload, jams, contradictory limits, stuck/bounce sensors)." },
  ],
  inspectableState: ["cartons", "beltSpeedMps", "totalTravelM", "encoderCount", "d1PositionPct", "d2PositionPct", "downstreamReady", "faults"],
  assumptions: [
    "Belt speed 0.30 m/s is specified in spec section 2; geometry, acceleration, encoder density and feedback delay are inferred and labelled in assumptions.md.",
    "Cartons follow the actual divert position at the decision point; route assignment, counting and misroute judgement are PLC logic and are not modelled.",
  ],
  faultCapabilities: ["fault.setDriveFeedbackFailure", "fault.setOverload", "fault.setDivertJam", "fault.setContradictoryLimits", "fault.setSensorStuck", "fault.setSensorBounce", "fault.setCartonJam", "fault.clearAll"],
  evidenceTypes: ["world-event", "carton-introduced", "carton-removed", "control-applied", "fault-cleared"],
  capabilities: { snapshot: true, migrate: true, seededRandom: true },
};

const world: GeneratedWorldModule = {
  manifest,
  async initialize(ctx: WorldContext, _request): Promise<void> {
    state = defaultState();
    writeAllInputs(ctx, "initialize:normal-no-carton-state");
    ctx.status.report({ phase: "ready", message: "Slow-belt conveyor world initialised: no carton, diverts home, drive stopped, all destinations ready." });
  },
  async onPlcFrame(_ctx: WorldContext, frame: PlcOutputFrame): Promise<void> {
    for (const id of Object.keys(frame.values)) {
      state.plcOutputs[id] = frame.values[id] ?? false;
    }
  },
  async onControl(ctx: WorldContext, control: WorldControl): Promise<void> {
    const p: Record<string, unknown> | undefined = control.payload;
    const f = state.faults;
    if (control.id === "carton.introduce") {
      const requested = payloadText(p, ["id", "itemId", "cartonId"]);
      const id = requested.length > 0 ? requested : "carton-" + String(state.nextCartonSeq);
      state.nextCartonSeq += 1;
      const carton: CartonState = { id, positionM: 0, velocityMps: 0, lengthM: CARTON_LENGTH_M, branch: "main", passedD1: false, passedD2: false };
      state.cartons.push(carton);
      ctx.entities.publish({ id: carton.id, type: "carton", state: { positionM: carton.positionM, velocityMps: carton.velocityMps, lengthM: carton.lengthM, branch: carton.branch, passedD1: false, passedD2: false } });
      ctx.evidence.append({ type: "carton-introduced", summary: "Carton introduced at entry", data: { cartonId: id, positionM: 0 } });
      writeAllInputs(ctx, "control:carton.introduce");
      return;
    }
    if (control.id === "downstream.setReady") {
      const target = payloadText(p, ["exit", "destination", "signalId", "target", "id"]).toLowerCase();
      const ready = payloadBool(p, "ready", payloadBool(p, "value", payloadBool(p, "enabled", true)));
      if (target.includes("runout")) state.downstreamReady.Runout = ready;
      else if (target === "b" || target.includes("exitb") || target.includes("exit_b")) state.downstreamReady.B = ready;
      else state.downstreamReady.A = ready;
      ctx.evidence.append({ type: "control-applied", summary: "Downstream readiness changed", data: { target, ready } });
      writeAllInputs(ctx, "control:downstream.setReady");
      return;
    }
    if (control.id === "fault.setDriveFeedbackFailure") {
      f.driveFeedbackFailure = payloadBool(p, "active", payloadBool(p, "value", payloadBool(p, "enabled", true)));
      ctx.evidence.append({ type: "control-applied", summary: "Drive feedback failure fault set", data: { active: f.driveFeedbackFailure } });
      writeAllInputs(ctx, "control:fault.setDriveFeedbackFailure");
      return;
    }
    if (control.id === "fault.setOverload") {
      f.overload = payloadBool(p, "active", payloadBool(p, "value", payloadBool(p, "enabled", true)));
      ctx.evidence.append({ type: "control-applied", summary: "Drive overload fault set", data: { active: f.overload } });
      writeAllInputs(ctx, "control:fault.setOverload");
      return;
    }
    if (control.id === "fault.setDivertJam") {
      const active = payloadBool(p, "active", payloadBool(p, "value", payloadBool(p, "enabled", true)));
      const sel = divertSelector(payloadText(p, ["divert", "divertId", "target", "id"]));
      if (sel === "D1" || sel === "both") f.divertJamD1 = active;
      if (sel === "D2" || sel === "both") f.divertJamD2 = active;
      ctx.evidence.append({ type: "control-applied", summary: "Divert jam fault set", data: { divert: sel, active } });
      writeAllInputs(ctx, "control:fault.setDivertJam");
      return;
    }
    if (control.id === "fault.setContradictoryLimits") {
      const active = payloadBool(p, "active", payloadBool(p, "value", payloadBool(p, "enabled", true)));
      const sel = divertSelector(payloadText(p, ["divert", "divertId", "target", "id"]));
      if (sel === "D1" || sel === "both") f.contradictoryD1 = active;
      if (sel === "D2" || sel === "both") f.contradictoryD2 = active;
      ctx.evidence.append({ type: "control-applied", summary: "Contradictory limits fault set", data: { divert: sel, active } });
      writeAllInputs(ctx, "control:fault.setContradictoryLimits");
      return;
    }
    if (control.id === "fault.setSensorStuck") {
      const signalId = normaliseSignalId(payloadText(p, ["signalId", "sensor", "id", "target"]));
      const active = payloadBool(p, "active", payloadBool(p, "enabled", true));
      if (signalId.length > 0) {
        if (active) f.stuckSignals[signalId] = payloadBool(p, "value", payloadBool(p, "stuckValue", true));
        else delete f.stuckSignals[signalId];
      }
      ctx.evidence.append({ type: "control-applied", summary: "Sensor stuck fault set", data: { signalId, active } });
      writeAllInputs(ctx, "control:fault.setSensorStuck");
      return;
    }
    if (control.id === "fault.setSensorBounce") {
      const signalId = normaliseSignalId(payloadText(p, ["signalId", "sensor", "id", "target"]));
      const active = payloadBool(p, "active", payloadBool(p, "value", payloadBool(p, "enabled", true)));
      if (signalId.length > 0) {
        const has = f.bounceSignals.includes(signalId);
        if (active && !has) f.bounceSignals.push(signalId);
        if (!active && has) f.bounceSignals = f.bounceSignals.filter((s) => s !== signalId);
      }
      ctx.evidence.append({ type: "control-applied", summary: "Sensor bounce fault set", data: { signalId, active } });
      writeAllInputs(ctx, "control:fault.setSensorBounce");
      return;
    }
    if (control.id === "fault.setCartonJam") {
      f.cartonJam = payloadBool(p, "active", payloadBool(p, "value", payloadBool(p, "enabled", true)));
      ctx.evidence.append({ type: "control-applied", summary: "Carton jam fault set", data: { active: f.cartonJam } });
      writeAllInputs(ctx, "control:fault.setCartonJam");
      return;
    }
    if (control.id === "fault.clearAll") {
      state.faults = defaultFaults();
      ctx.evidence.append({ type: "fault-cleared", summary: "All injected faults cleared", data: {} });
      writeAllInputs(ctx, "control:fault.clearAll");
      return;
    }
    ctx.evidence.append({ type: "world-event", summary: "Unknown control ignored", data: { controlId: control.id } });
  },
  async tick(ctx: WorldContext, tick: WorldTick): Promise<void> {
    const dtS = Math.max(0, tick.deltaMs) / 1000;
    state.timeMs = tick.nowMs;
    state.tickCount += 1;
    // Keep observed PLC outputs fresh from the context as well as onPlcFrame.
    for (const id of ["Motor_RunCmd", "D1_ExtendCmd", "D2_ExtendCmd", "StackLight_Red", "StackLight_Green"]) {
      const v = ctx.plc.readRawOutput(id);
      if (v !== null && v !== undefined) state.plcOutputs[id] = v;
    }
    const f = state.faults;
    // Drive dynamics: energised only with a real run command and no trip/failure.
    const driveEnergised = outBool("Motor_RunCmd") && !f.overload && !f.driveFeedbackFailure;
    if (driveEnergised) state.driveFbTimerS += dtS; else state.driveFbTimerS = 0;
    const targetSpeed = driveEnergised ? BELT_SPEED_MPS : 0;
    if (targetSpeed > state.beltSpeedMps) state.beltSpeedMps = Math.min(targetSpeed, state.beltSpeedMps + DRIVE_ACCEL_MPS2 * dtS);
    else if (targetSpeed < state.beltSpeedMps) state.beltSpeedMps = Math.max(targetSpeed, state.beltSpeedMps - DRIVE_DECEL_MPS2 * dtS);
    state.totalTravelM += state.beltSpeedMps * dtS;
    // Divert actuators follow their commands through actual travel.
    state.d1PositionPct = stepActuator(state.d1PositionPct, outBool("D1_ExtendCmd"), f.divertJamD1, dtS);
    state.d2PositionPct = stepActuator(state.d2PositionPct, outBool("D2_ExtendCmd"), f.divertJamD2, dtS);
    // Cartons are carried by the belt; a jammed carton holds while the belt runs.
    const survivors: CartonState[] = [];
    for (const c of state.cartons) {
      const prev = c.positionM;
      c.velocityMps = f.cartonJam ? 0 : state.beltSpeedMps;
      c.positionM += c.velocityMps * dtS;
      if (c.branch === "main" && !c.passedD1 && prev < D1_DECISION_M && c.positionM >= D1_DECISION_M) {
        c.passedD1 = true;
        if (state.d1PositionPct >= DIVERT_DECISION_PCT) c.branch = "A";
      }
      if (c.branch === "main" && c.passedD1 && !c.passedD2 && prev < D2_DECISION_M && c.positionM >= D2_DECISION_M) {
        c.passedD2 = true;
        if (state.d2PositionPct >= DIVERT_DECISION_PCT) c.branch = "B";
      }
      if (c.positionM >= removalLimitM(c)) {
        ctx.entities.remove(c.id, "carton taken by downstream at " + c.branch);
        ctx.evidence.append({ type: "carton-removed", summary: "Carton left the machine", data: { cartonId: c.id, branch: c.branch, positionM: c.positionM } });
      } else {
        survivors.push(c);
      }
    }
    state.cartons = survivors;
    publishCartons(ctx);
    writeAllInputs(ctx, "tick");
  },
  async snapshot(_ctx: WorldContext): Promise<WorldSnapshot> {
    const copy = JSON.parse(JSON.stringify(state)) as WorldState;
    return { stateSchemaVersion: manifest.stateSchemaVersion, worldVersion: manifest.packageVersion, state: copy };
  },
  async migrate(_ctx: WorldContext, previous: WorldSnapshot, _request): Promise<WorldSnapshot> {
    if (previous && previous.stateSchemaVersion === manifest.stateSchemaVersion && previous.state) {
      state = previous.state as WorldState;
      return { stateSchemaVersion: manifest.stateSchemaVersion, worldVersion: manifest.packageVersion, state: previous.state };
    }
    state = defaultState();
    return { stateSchemaVersion: manifest.stateSchemaVersion, worldVersion: manifest.packageVersion, state: JSON.parse(JSON.stringify(state)) as WorldState };
  },
  async dispose(_ctx: WorldContext, _reason: string): Promise<void> {
    state = defaultState();
  },
};

export { world };
export default world;
