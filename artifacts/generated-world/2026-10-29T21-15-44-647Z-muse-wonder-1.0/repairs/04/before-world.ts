import type { GeneratedWorldModule, PlcOutputFrame, RawValue, WorldContext, WorldControl, WorldManifest, WorldTick } from "../../../src/proof/contracts.ts";

// Conveyor demo baseline world. External physical process only:
// no PLC routing, state-machine, alarm, counting, or acceptance logic.

const CONFIG = {
  cartonLengthM: 0.3,
  beltSpeedMps: 0.5,
  beltAccelMps2: 2.0,
  divertTravelMs: 350,
  driveStartDelayMs: 200,
  driveStopDelayMs: 150,
  minEntrySpacingM: 0.8,
  encoderCountsPerM: 1000,
  encoderModulus: 4294967296,
  peEntryM: 0.5,
  peD1ApproachM: 1.2,
  divert1M: 1.6,
  peExitAM: 2.1,
  exitAEndM: 2.7,
  peD2ApproachM: 2.4,
  divert2M: 2.8,
  peExitBM: 3.3,
  exitBEndM: 3.9,
  peRunoutM: 3.6,
  runoutEndM: 4.2,
} as const;

type Path = "main" | "exitA" | "exitB" | "runout";

interface Carton {
  id: string;
  itemId: string;
  requestedRoute: string | null;
  positionM: number;
  velocityMps: number;
  lengthM: number;
  path: Path;
  passedD1: boolean;
  passedD2: boolean;
  jammed: boolean;
}

interface DivertState { position: number; jammed: boolean; contradictory: boolean; lastLimit: string; }
interface Completed { id: string; itemId: string; requestedRoute: string | null; actualExit: string; }

interface WorldState {
  cartons: Carton[];
  completed: Completed[];
  counter: number;
  beltSpeedMps: number;
  beltTravelM: number;
  driveRunning: boolean;
  drivePhase: "stopped" | "starting" | "running" | "stopping";
  drivePhaseSinceMs: number;
  divert1: DivertState;
  divert2: DivertState;
  readyA: boolean; readyB: boolean; readyRunout: boolean;
  overload: boolean;
  driveFeedbackFailure: boolean;
  sensorStuck: Record<string, boolean>;
  sensorBounceUntil: Record<string, number>;
  lastWritten: Record<string, RawValue>;
  lastDriveRunning: boolean;
}

function freshState(): WorldState {
  return {
    cartons: [], completed: [], counter: 0, beltSpeedMps: 0, beltTravelM: 0,
    driveRunning: false, drivePhase: "stopped", drivePhaseSinceMs: 0,
    divert1: { position: 0, jammed: false, contradictory: false, lastLimit: "home" },
    divert2: { position: 0, jammed: false, contradictory: false, lastLimit: "home" },
    readyA: true, readyB: true, readyRunout: true, overload: false, driveFeedbackFailure: false,
    sensorStuck: {}, sensorBounceUntil: {}, lastWritten: {}, lastDriveRunning: false,
  };
}

let state: WorldState = freshState();
let worldVersion = "0.5.0";

function write(ctx: WorldContext, signalId: string, value: RawValue, cause: string): void {
  if (state.lastWritten[signalId] === value) return;
  state.lastWritten[signalId] = value;
  ctx.plc.writeRawInput({ signalId, value, cause });
}
function forceWrite(ctx: WorldContext, signalId: string, value: RawValue, cause: string): void {
  state.lastWritten[signalId] = value;
  ctx.plc.writeRawInput({ signalId, value, cause });
}
function boolOut(ctx: WorldContext, id: string): boolean { return ctx.plc.readRawOutput(id) === true; }

function sensorPhysical(signalId: string): boolean {
  const at = (c: Carton, x: number): boolean => Math.abs(c.positionM - x) <= c.lengthM / 2;
  switch (signalId) {
    case "PE_Entry": return state.cartons.some((c) => c.path === "main" && at(c, CONFIG.peEntryM));
    case "PE_D1Approach": return state.cartons.some((c) => c.path === "main" && at(c, CONFIG.peD1ApproachM));
    case "PE_D2Approach": return state.cartons.some((c) => c.path === "main" && at(c, CONFIG.peD2ApproachM));
    case "PE_ExitA": return state.cartons.some((c) => c.path === "exitA" && at(c, CONFIG.peExitAM));
    case "PE_ExitB": return state.cartons.some((c) => c.path === "exitB" && at(c, CONFIG.peExitBM));
    case "PE_Runout": return state.cartons.some((c) => (c.path === "main" || c.path === "runout") && at(c, CONFIG.peRunoutM));
    default: return false;
  }
}
function sensorCause(signalId: string): string {
  const hit = state.cartons.find((c) => sensorPhysical(signalId));
  return hit ? `carton ${hit.id} geometrically blocks ${signalId}` : `no carton geometrically blocks ${signalId}`;
}
function rawSensor(ctx: WorldContext, signalId: string): boolean {
  if (Object.prototype.hasOwnProperty.call(state.sensorStuck, signalId)) return state.sensorStuck[signalId]!;
  const physical = sensorPhysical(signalId);
  const until = state.sensorBounceUntil[signalId];
  if (until !== undefined && ctx.time.nowMs < until) {
    const phase = Math.floor(ctx.time.nowMs / 40) % 2 === 0;
    return phase ? physical : !physical;
  }
  return physical;
}

function updateDivert(ctx: WorldContext, d: DivertState, extendCmd: boolean, dtS: number, label: string): void {
  if (!d.jammed && dtS > 0) {
    const step = dtS / (CONFIG.divertTravelMs / 1000);
    d.position = extendCmd ? Math.min(1, d.position + step) : Math.max(0, d.position - step);
  }
  const limit = d.position >= 1 ? "extended" : d.position <= 0 ? "home" : "travel";
  if (limit !== d.lastLimit && limit !== "travel") {
    ctx.evidence.append({ type: "divert.limitReached", summary: `${label} reached ${limit} limit`, data: { divert: label, limit } });
  }
  d.lastLimit = limit;
}

function publishCartons(ctx: WorldContext): void {
  for (const c of state.cartons) {
    ctx.entities.publish({ id: c.id, type: "carton", state: { positionM: c.positionM, velocityMps: c.velocityMps, path: c.path, requestedRoute: c.requestedRoute, itemId: c.itemId, lengthM: c.lengthM, jammed: c.jammed } });
  }
}

function emitInputs(ctx: WorldContext, initial: boolean): void {
  const sensors = ["PE_Entry", "PE_D1Approach", "PE_D2Approach", "PE_ExitA", "PE_ExitB", "PE_Runout"];
  for (const s of sensors) {
    const v = rawSensor(ctx, s);
    const cause = Object.prototype.hasOwnProperty.call(state.sensorStuck, s) ? `injected stuck fault holds ${s}` : (state.sensorBounceUntil[s] !== undefined && ctx.time.nowMs < state.sensorBounceUntil[s]!) ? `injected bounce on ${s}` : sensorCause(s);
    if (initial) forceWrite(ctx, s, v, `initialize: ${cause}`); else write(ctx, s, v, cause);
  }
  const d1HomePhys = state.divert1.position <= 0;
  const d1ExtPhys = state.divert1.position >= 1;
  const d2HomePhys = state.divert2.position <= 0;
  const d2ExtPhys = state.divert2.position >= 1;
  const d1Home = state.divert1.contradictory ? true : d1HomePhys;
  const d1Ext = state.divert1.contradictory ? true : d1ExtPhys;
  const d2Home = state.divert2.contradictory ? true : d2HomePhys;
  const d2Ext = state.divert2.contradictory ? true : d2ExtPhys;
  const pairs: Array<[string, boolean, string]> = [
    ["D1_HomeFB", d1Home, state.divert1.contradictory ? "injected contradictory limits on divert 1" : "divert 1 physical home limit"],
    ["D1_ExtendedFB", d1Ext, state.divert1.contradictory ? "injected contradictory limits on divert 1" : "divert 1 physical extended limit"],
    ["D2_HomeFB", d2Home, state.divert2.contradictory ? "injected contradictory limits on divert 2" : "divert 2 physical home limit"],
    ["D2_ExtendedFB", d2Ext, state.divert2.contradictory ? "injected contradictory limits on divert 2" : "divert 2 physical extended limit"],
    ["Drive_RunningFB", state.driveRunning, state.driveFeedbackFailure ? "injected drive feedback failure suppresses running feedback" : "actual drive running state after modeled delay"],
    ["Drive_Overload", state.overload, state.overload ? "injected drive overload/trip" : "no overload present"],
    ["ExitA_Ready", state.readyA, "downstream exit A readiness"],
    ["ExitB_Ready", state.readyB, "downstream exit B readiness"],
    ["Runout_Ready", state.readyRunout, "downstream runout readiness"],
  ];
  for (const [id, v, cause] of pairs) { if (initial) forceWrite(ctx, id, v, `initialize: ${cause}`); else write(ctx, id, v, cause); }
  const enc = Math.floor(state.beltTravelM * CONFIG.encoderCountsPerM) % CONFIG.encoderModulus;
  const diags: Array<[string, number, string]> = [
    ["Belt_SpeedActual", state.beltSpeedMps, "actual belt speed from drive dynamics"],
    ["Drive_Current", state.driveRunning ? 4.2 + state.beltSpeedMps : 0, "modeled drive current while running"],
    ["D1_Position", state.divert1.position * 100, "divert 1 physical position"],
    ["D2_Position", state.divert2.position * 100, "divert 2 physical position"],
    ["Encoder_Count", enc, "quantized encoder count from physical belt travel, wrapping modulo 2^32"],
  ];
  for (const [id, v, cause] of diags) { if (initial) forceWrite(ctx, id, v, `initialize: ${cause}`); else write(ctx, id, v, cause); }
}

interface SnapshotShape { cartons: Carton[]; completed: Completed[]; counter: number; beltTravelM: number; divert1Pos: number; divert2Pos: number; }

function restore(shape: SnapshotShape): void {
  const s = freshState();
  s.cartons = shape.cartons; s.completed = shape.completed; s.counter = shape.counter; s.beltTravelM = shape.beltTravelM;
  s.divert1.position = shape.divert1Pos; s.divert2.position = shape.divert2Pos;
  state = s;
}

export const world: GeneratedWorldModule = {
  manifest: null as unknown as WorldManifest, // replaced below
  async initialize(ctx, request) {
    worldVersion = request.worldVersion;
    state = freshState();
    emitInputs(ctx, true);
    ctx.evidence.append({ type: "world.initialized", summary: "Normal no-carton state established: photoeyes false, diverts home, drive stopped, exits ready, encoder zero", data: { seed: request.seed, worldVersion } });
    ctx.status.report({ phase: "initialized", message: "Conveyor world initialized in normal stopped state; cartons move only with actual drive running feedback." });
  },
  async onPlcFrame(ctx, frame: PlcOutputFrame) {
    // Observe only; physical reaction occurs in tick from current outputs.
    void ctx; void frame;
  },
  async onControl(ctx, control: WorldControl) {
    const p: Record<string, unknown> = control.payload ?? {};
    switch (control.id) {
      case "carton.introduce": {
        const itemId = typeof p["itemId"] === "string" ? p["itemId"] : `ITEM-${state.counter + 1}`;
        const rrRaw = p["requestedRoute"];
        const requestedRoute = rrRaw === "A" || rrRaw === "B" ? rrRaw : null;
        const blocked = state.cartons.some((c) => c.positionM < CONFIG.minEntrySpacingM);
        if (blocked) { ctx.evidence.append({ type: "carton.introductionRejected", summary: "Entry spacing unavailable; carton not introduced", data: { itemId } }); return; }
        state.counter += 1;
        const carton: Carton = { id: `carton-${state.counter}`, itemId, requestedRoute, positionM: 0, velocityMps: 0, lengthM: CONFIG.cartonLengthM, path: "main", passedD1: false, passedD2: false, jammed: false };
        state.cartons.push(carton);
        ctx.entities.publish({ id: carton.id, type: "carton", state: { positionM: 0, velocityMps: 0, path: "main", requestedRoute, itemId, lengthM: carton.lengthM, jammed: false } });
        ctx.evidence.append({ type: "carton.introduced", summary: `Carton ${itemId} placed at entry`, data: { cartonId: carton.id, itemId, requestedRoute, cause: control.cause } });
        return;
      }
      case "downstream.setReady": {
        const dest = p["destination"]; const ready = p["ready"] !== false;
        if (dest === "A") state.readyA = ready; else if (dest === "B") state.readyB = ready; else if (dest === "runout") state.readyRunout = ready; else return;
        ctx.evidence.append({ type: "downstream.readinessChanged", summary: `Downstream ${String(dest)} ready=${ready}`, data: { destination: dest, ready, cause: control.cause } });
        emitInputs(ctx, false); return;
      }
      case "fault.setDriveFeedbackFailure": state.driveFeedbackFailure = p["active"] !== false; break;
      case "fault.setOverload": state.overload = p["active"] !== false; break;
      case "fault.setDivertJam": { const d = p["divert"] === 2 ? state.divert2 : state.divert1; d.jammed = p["active"] !== false; break; }
      case "fault.setContradictoryLimits": { const d = p["divert"] === 2 ? state.divert2 : state.divert1; d.contradictory = p["active"] !== false; break; }
      case "fault.setSensorStuck": { const id = typeof p["signalId"] === "string" ? p["signalId"] : "PE_Entry"; if (p["active"] === false) delete state.sensorStuck[id]; else state.sensorStuck[id] = p["value"] !== false; break; }
      case "fault.setSensorBounce": { const id = typeof p["signalId"] === "string" ? p["signalId"] : "PE_Entry"; const dur = typeof p["durationMs"] === "number" ? p["durationMs"] : 1000; state.sensorBounceUntil[id] = ctx.time.nowMs + dur + ctx.random.next() * 0; break; }
      case "fault.setCartonJam": { const id = typeof p["cartonId"] === "string" ? p["cartonId"] : state.cartons[0]?.id; const c = state.cartons.find((x) => x.id === id); if (c) c.jammed = p["active"] !== false; break; }
      case "fault.clearAll": {
        state.driveFeedbackFailure = false; state.overload = false; state.sensorStuck = {}; state.sensorBounceUntil = {};
        state.divert1.jammed = false; state.divert2.jammed = false; state.divert1.contradictory = false; state.divert2.contradictory = false;
        for (const c of state.cartons) c.jammed = false; state.readyA = true; state.readyB = true; state.readyRunout = true;
        ctx.evidence.append({ type: "fault.cleared", summary: "All injected faults cleared", data: { cause: control.cause } });
        emitInputs(ctx, false); return;
      }
      default: return;
    }
    ctx.evidence.append({ type: "fault.injected", summary: `Fault control applied: ${control.id}`, data: { control: control.id, cause: control.cause } });
    emitInputs(ctx, false);
  },
  async tick(ctx, tick: WorldTick) {
    const dtS = Math.max(0, tick.deltaMs) / 1000;
    const runCmd = boolOut(ctx, "Motor_RunCmd");
    const d1Cmd = boolOut(ctx, "D1_ExtendCmd");
    const d2Cmd = boolOut(ctx, "D2_ExtendCmd");
    // Drive dynamics with explicit start/stop delay; overload or feedback failure means the drive does not actually run.
    const inhibited = state.overload || state.driveFeedbackFailure;
    if (runCmd && !inhibited) {
      if (state.drivePhase === "stopped" || state.drivePhase === "stopping") { state.drivePhase = "starting"; state.drivePhaseSinceMs = tick.nowMs; }
      if (state.drivePhase === "starting" && tick.nowMs - state.drivePhaseSinceMs >= CONFIG.driveStartDelayMs) state.drivePhase = "running";
    } else {
      if (state.drivePhase === "running" || state.drivePhase === "starting") { state.drivePhase = "stopping"; state.drivePhaseSinceMs = tick.nowMs; }
      if (state.drivePhase === "stopping" && tick.nowMs - state.drivePhaseSinceMs >= CONFIG.driveStopDelayMs) state.drivePhase = "stopped";
    }
    const wasRunning = state.driveRunning;
    state.driveRunning = state.drivePhase === "running";
    if (state.driveRunning !== wasRunning) ctx.evidence.append({ type: "drive.stateChanged", summary: `Drive running feedback now ${state.driveRunning}`, data: { running: state.driveRunning, runCmd } });
    const target = state.driveRunning ? CONFIG.beltSpeedMps : 0;
    const maxDelta = CONFIG.beltAccelMps2 * dtS;
    state.beltSpeedMps = state.beltSpeedMps < target ? Math.min(target, state.beltSpeedMps + maxDelta) : Math.max(target, state.beltSpeedMps - maxDelta);
    const beltDeltaM = state.beltSpeedMps * dtS;
    state.beltTravelM += beltDeltaM;
    updateDivert(ctx, state.divert1, d1Cmd, dtS, "divert1");
    updateDivert(ctx, state.divert2, d2Cmd, dtS, "divert2");
    // Carton motion caused solely by actual belt motion.
    const exited: Carton[] = [];
    for (const c of state.cartons) {
      const prev = c.positionM;
      c.velocityMps = c.jammed ? 0 : state.beltSpeedMps;
      c.positionM += c.jammed ? 0 : beltDeltaM;
      if (c.path === "main" && !c.passedD1 && prev < CONFIG.divert1M && c.positionM >= CONFIG.divert1M) {
        c.passedD1 = true;
        if (state.divert1.position >= 1) { c.path = "exitA"; ctx.evidence.append({ type: "carton.diverted", summary: `Carton ${c.itemId} diverted at divert 1 by actual extended position`, data: { cartonId: c.id, divert: 1, actualExit: "A" } }); }
      }
      if (c.path === "main" && !c.passedD2 && prev < CONFIG.divert2M && c.positionM >= CONFIG.divert2M) {
        c.passedD2 = true;
        if (state.divert2.position >= 1) { c.path = "exitB"; ctx.evidence.append({ type: "carton.diverted", summary: `Carton ${c.itemId} diverted at divert 2 by actual extended position`, data: { cartonId: c.id, divert: 2, actualExit: "B" } }); }
      }
      if ((c.path === "exitA" && c.positionM >= CONFIG.exitAEndM) || (c.path === "exitB" && c.positionM >= CONFIG.exitBEndM) || (c.path === "main" && c.positionM >= CONFIG.runoutEndM)) exited.push(c);
    }
    for (const c of exited) {
      const actualExit = c.path === "exitA" ? "A" : c.path === "exitB" ? "B" : "runout";
      if (actualExit === "runout") c.path = "runout";
      state.completed.push({ id: c.id, itemId: c.itemId, requestedRoute: c.requestedRoute, actualExit });
      ctx.evidence.append({ type: "carton.exited", summary: `Carton ${c.itemId} physically exited via ${actualExit}`, data: { cartonId: c.id, itemId: c.itemId, requestedRoute: c.requestedRoute, actualExit } });
      ctx.entities.remove(c.id, `carton exited via ${actualExit}`);
    }
    if (exited.length) state.cartons = state.cartons.filter((c) => !exited.includes(c));
    publishCartons(ctx);
    emitInputs(ctx, false);
  },
  async snapshot(ctx) {
    void ctx;
    const shape: SnapshotShape = { cartons: state.cartons, completed: state.completed, counter: state.counter, beltTravelM: state.beltTravelM, divert1Pos: state.divert1.position, divert2Pos: state.divert2.position };
    return { stateSchemaVersion: "1.0.0", worldVersion, state: JSON.parse(JSON.stringify(shape)) as unknown };
  },
  async migrate(ctx, previous, request) {
    void ctx; void request;
    if (previous.stateSchemaVersion === "1.0.0" && previous.state !== null && typeof previous.state === "object") {
      try { restore(previous.state as SnapshotShape); } catch { state = freshState(); }
    } else state = freshState();
    return { stateSchemaVersion: "1.0.0", worldVersion, state: previous.state };
  },
  async dispose(ctx, reason) {
    ctx.evidence.append({ type: "world.disposed", summary: `World disposed: ${reason}`, data: { reason } });
    state = freshState();
  },
};

// Manifest is attached after the object literal to keep signal declarations readable at runtime via a separate constant.
const manifest: WorldManifest = {
  packageVersion: "0.5.0", stateSchemaVersion: "1.0.0", worldId: "conveyor-demo-baseline", name: "Conveyor Bench — Demo Baseline", tickMs: 20,
  signals: [
    { id: "Motor_RunCmd", name: "Motor_RunCmd", direction: "plc_to_world", dataType: "BOOL", normalValue: false, deviceId: "drive", role: "drive.runCommand", description: "PLC command to belt drive." },
    { id: "D1_ExtendCmd", name: "D1_ExtendCmd", direction: "plc_to_world", dataType: "BOOL", normalValue: false, deviceId: "divert1", role: "divert1.extendCommand", description: "Extend divert 1 to exit A; deassert returns home." },
    { id: "D2_ExtendCmd", name: "D2_ExtendCmd", direction: "plc_to_world", dataType: "BOOL", normalValue: false, deviceId: "divert2", role: "divert2.extendCommand", description: "Extend divert 2 to exit B; deassert returns home." },
    { id: "StackLight_Red", name: "StackLight_Red", direction: "plc_to_world", dataType: "BOOL", normalValue: false, deviceId: "stackLight", role: "indication.stackRed", description: "Optional fault indication; observed only." },
    { id: "StackLight_Green", name: "StackLight_Green", direction: "plc_to_world", dataType: "BOOL", normalValue: false, deviceId: "stackLight", role: "indication.stackGreen", description: "Optional running/ready indication; observed only." },
    { id: "PE_Entry", name: "PE_Entry", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "peEntry", role: "sensor.entry", description: "Carton blocks entry beam." },
    { id: "PE_D1Approach", name: "PE_D1Approach", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "peD1Approach", role: "sensor.d1Approach", description: "Carton in divert 1 decision window." },
    { id: "PE_D2Approach", name: "PE_D2Approach", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "peD2Approach", role: "sensor.d2Approach", description: "Carton on main lane toward divert 2." },
    { id: "PE_ExitA", name: "PE_ExitA", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "peExitA", role: "sensor.exitA", description: "Carton passes exit A." },
    { id: "PE_ExitB", name: "PE_ExitB", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "peExitB", role: "sensor.exitB", description: "Carton passes exit B." },
    { id: "PE_Runout", name: "PE_Runout", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "peRunout", role: "sensor.runout", description: "Carton passes runout." },
    { id: "D1_HomeFB", name: "D1_HomeFB", direction: "world_to_plc", dataType: "BOOL", normalValue: true, deviceId: "divert1", role: "divert1.homeFeedback", description: "Divert 1 fully home." },
    { id: "D1_ExtendedFB", name: "D1_ExtendedFB", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "divert1", role: "divert1.extendedFeedback", description: "Divert 1 fully extended." },
    { id: "D2_HomeFB", name: "D2_HomeFB", direction: "world_to_plc", dataType: "BOOL", normalValue: true, deviceId: "divert2", role: "divert2.homeFeedback", description: "Divert 2 fully home." },
    { id: "D2_ExtendedFB", name: "D2_ExtendedFB", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "divert2", role: "divert2.extendedFeedback", description: "Divert 2 fully extended." },
    { id: "Drive_RunningFB", name: "Drive_RunningFB", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "drive", role: "drive.runningFeedback", description: "Actual drive-running feedback, delayed and suppressible." },
    { id: "Drive_Overload", name: "Drive_Overload", direction: "world_to_plc", dataType: "BOOL", normalValue: false, deviceId: "drive", role: "drive.overload", description: "Simulated overload/trip; normally false." },
    { id: "ExitA_Ready", name: "ExitA_Ready", direction: "world_to_plc", dataType: "BOOL", normalValue: true, deviceId: "exitA", role: "destination.exitAReady", description: "Destination A can accept a carton." },
    { id: "ExitB_Ready", name: "ExitB_Ready", direction: "world_to_plc", dataType: "BOOL", normalValue: true, deviceId: "exitB", role: "destination.exitBReady", description: "Destination B can accept a carton." },
    { id: "Runout_Ready", name: "Runout_Ready", direction: "world_to_plc", dataType: "BOOL", normalValue: true, deviceId: "runout", role: "destination.runoutReady", description: "Runout can accept a carton." },
    { id: "Belt_SpeedActual", name: "Belt_SpeedActual", direction: "world_to_plc", dataType: "REAL", normalValue: 0, deviceId: "drive", role: "diagnostic.beltSpeedActual", description: "Diagnostic belt speed m/s." },
    { id: "Drive_Current", name: "Drive_Current", direction: "world_to_plc", dataType: "REAL", normalValue: 0, deviceId: "drive", role: "diagnostic.driveCurrent", description: "Diagnostic drive current A." },
    { id: "D1_Position", name: "D1_Position", direction: "world_to_plc", dataType: "REAL", normalValue: 0, deviceId: "divert1", role: "diagnostic.divert1Position", description: "Divert 1 position 0-100%." },
    { id: "D2_Position", name: "D2_Position", direction: "world_to_plc", dataType: "REAL", normalValue: 0, deviceId: "divert2", role: "diagnostic.divert2Position", description: "Divert 2 position 0-100%." },
    { id: "Encoder_Count", name: "Encoder_Count", direction: "world_to_plc", dataType: "UDINT", normalValue: 0, deviceId: "encoder", role: "motion.encoderCount", description: "Encoder count from physical belt motion; 1000/m, floored, wraps modulo 2^32." },
  ],
  controls: [
    { id: "carton.introduce", description: "Introduce a carton at entry. Payload { itemId?, requestedRoute?: 'A'|'B'|'Unknown'|null }." },
    { id: "downstream.setReady", description: "Set downstream readiness { destination: 'A'|'B'|'runout', ready: boolean }." },
    { id: "fault.setDriveFeedbackFailure", description: "Suppress actual drive running feedback { active }." },
    { id: "fault.setOverload", description: "Assert/clear drive overload { active }." },
    { id: "fault.setDivertJam", description: "Jam/free a divert { divert: 1|2, active }." },
    { id: "fault.setContradictoryLimits", description: "Force both limits true { divert: 1|2, active }." },
    { id: "fault.setSensorStuck", description: "Hold a photoeye stuck { signalId, active, value? }." },
    { id: "fault.setSensorBounce", description: "Bounce a photoeye { signalId, durationMs? }." },
    { id: "fault.setCartonJam", description: "Jam a carton in place { cartonId?, active }." },
    { id: "fault.clearAll", description: "Clear all faults and restore readiness." },
  ],
  inspectableState: ["cartons", "drive", "divert1", "divert2", "encoder", "downstream", "faults", "completedCartons"],
  assumptions: ["Geometry, drive delays, ramp, encoder counts/m are inferred demo configuration, not PLC thresholds.", "No PLC detection/jam/debounce deadlines are assumed; they remain TBD."],
  faultCapabilities: ["drive.feedbackFailure", "drive.overloadTrip", "divert1.jam", "divert2.jam", "divert1.contradictoryLimits", "divert2.contradictoryLimits", "sensor.stuck", "sensor.bounce", "carton.jam", "downstream.blocked"],
  evidenceTypes: ["world.initialized", "world.disposed", "carton.introduced", "carton.introductionRejected", "carton.diverted", "carton.exited", "fault.injected", "fault.cleared", "downstream.readinessChanged", "drive.stateChanged", "divert.limitReached"],
  capabilities: { snapshot: true, migrate: true, seededRandom: true },
};
Object.defineProperty(world, "manifest", { value: manifest, enumerable: true });
export default world;
