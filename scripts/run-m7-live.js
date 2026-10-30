import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import world from "../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts";
import { LiveWorldCoordinator } from "../src/live/coordinator.ts";

const require = createRequire(import.meta.url);
const {
  OPCUAClient,
  DataType,
  MessageSecurityMode,
  SecurityPolicy,
  UserTokenType,
  boolFields,
  realFields,
  outputFields,
  activeNames,
  sleep,
  u64ToBigInt,
  browseWanted,
  readMany,
  writeMany,
  imageWrites,
  compareActive
} = require("../codesys/scripts/probe-m1.cjs");

const endpointUrl = process.env.OPC_ENDPOINT || "opc.tcp://127.0.0.1:4840";
const userName = process.env.OPC_USER;
const password = process.env.OPC_PASSWORD;
const artifactDirectory = resolve("artifacts/m7");
const resultPath = resolve(process.env.M7_OUTPUT || `${artifactDirectory}/m7-live-result.json`);
const tracePath = resolve(process.env.M7_TRACE || `${artifactDirectory}/m7-live-trace.json`);
const projectPath = resolve("codesys/gngnf.project");
const worldPath = resolve("artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts");

const controlNames = [
  "SimRequest", "SessionResetRequest", "RequestedSlot", "RequestedEpoch",
  "RequestedSequence", "WorkstationHeartbeat"
];
const statusNames = [
  "SimApplied", "ConnectorStale", "ActiveSlot", "AppliedEpoch", "AppliedSequence",
  "PlcBootIdentity", "PlcCycle", "PlcTimeUs", "OutputCaptureCycle", "OutputCaptureTimeUs",
  "SessionResetCount",
  ...outputFields
];
const slotNames = [];
for (const slot of [0, 1]) {
  slotNames.push(`Slot${slot}_Valid`, `Slot${slot}_Epoch`, `Slot${slot}_Sequence`);
  for (const field of boolFields) slotNames.push(`Slot${slot}_${field}`);
  for (const field of realFields) slotNames.push(`Slot${slot}_${field}`);
  slotNames.push(`Slot${slot}_Encoder_Count`);
}
const wantedNames = new Set([...controlNames, ...statusNames, ...slotNames, ...activeNames]);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function randomEpoch() {
  return (BigInt(Date.now()) << 16n) | BigInt(Math.floor(Math.random() * 0xffff));
}

function numericString(value) {
  return u64ToBigInt(value).toString();
}

class OpcUaM2Connector {
  id = "codesys-opcua-m2";
  #client;
  #session;
  #nodes;
  #epoch = randomEpoch();
  #sequence = 0n;
  #heartbeat = 0n;
  #activeSlot = 255;
  #bootIdentity = "0";

  async open() {
    if (!userName) throw new Error("OPC_USER is required");
    this.#client = OPCUAClient.create({
      applicationName: "NodeOPCUA-Client",
      endpointMustExist: false,
      securityMode: MessageSecurityMode.SignAndEncrypt,
      securityPolicy: SecurityPolicy.Basic256Sha256,
      automaticallyAcceptUnknownCertificate: true,
      connectionStrategy: { initialDelay: 250, maxRetry: 0 }
    });
    await this.#client.connect(endpointUrl);
    this.#session = await this.#client.createSession({
      type: UserTokenType.UserName,
      userName,
      password: password || ""
    });
    this.#nodes = await browseWanted(this.#session, wantedNames);
    const initial = await readMany(this.#session, this.#nodes, [
      "WorkstationHeartbeat", "ActiveSlot", "PlcBootIdentity"
    ]);
    this.#heartbeat = u64ToBigInt(initial.WorkstationHeartbeat);
    this.#activeSlot = Number(initial.ActiveSlot);
    this.#bootIdentity = numericString(initial.PlcBootIdentity);
    return this.observe();
  }

  async resetSession() {
    await writeMany(this.#session, this.#nodes, [
      { name: "SessionResetRequest", dataType: DataType.Boolean, value: false }
    ]);
    await sleep(30);
    const before = await readMany(this.#session, this.#nodes, ["SessionResetCount"]);
    this.#heartbeat += 1n;
    await writeMany(this.#session, this.#nodes, [
      { name: "SimRequest", dataType: DataType.Boolean, value: true },
      { name: "WorkstationHeartbeat", dataType: DataType.UInt64, value: this.#heartbeat.toString() },
      { name: "SessionResetRequest", dataType: DataType.Boolean, value: true }
    ]);
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const values = await readMany(this.#session, this.#nodes, [
        "SessionResetCount", "AppliedEpoch", "AppliedSequence"
      ]);
      if (u64ToBigInt(values.SessionResetCount) > u64ToBigInt(before.SessionResetCount)
        && u64ToBigInt(values.AppliedEpoch) === 0n
        && u64ToBigInt(values.AppliedSequence) === 0n) {
        await writeMany(this.#session, this.#nodes, [
          { name: "SessionResetRequest", dataType: DataType.Boolean, value: false },
          { name: "RequestedEpoch", dataType: DataType.UInt64, value: "0" },
          { name: "RequestedSequence", dataType: DataType.UInt64, value: "0" }
        ]);
        await sleep(30);
        this.#activeSlot = 255;
        this.#sequence = 0n;
        this.#epoch = randomEpoch();
        return this.observe();
      }
      await sleep(5);
    }
    throw new Error("Timed out waiting for explicit bench session reset");
  }

  async commit(imageCandidate) {
    const image = this.#validateImage(imageCandidate);
    const slot = this.#activeSlot === 0 ? 1 : 0;
    const sequence = this.#sequence + 1n;
    const sentAtIso = new Date().toISOString();
    const sentAtMonotonicMs = performance.now();
    this.#heartbeat += 1n;
    await writeMany(this.#session, this.#nodes, [
      { name: `Slot${slot}_Valid`, dataType: DataType.Boolean, value: false },
      ...imageWrites(slot, image),
      { name: `Slot${slot}_Epoch`, dataType: DataType.UInt64, value: this.#epoch.toString() },
      { name: `Slot${slot}_Sequence`, dataType: DataType.UInt64, value: sequence.toString() },
      { name: `Slot${slot}_Valid`, dataType: DataType.Boolean, value: true },
      { name: "WorkstationHeartbeat", dataType: DataType.UInt64, value: this.#heartbeat.toString() },
      { name: "RequestedSlot", dataType: DataType.Byte, value: slot },
      { name: "RequestedEpoch", dataType: DataType.UInt64, value: this.#epoch.toString() },
      { name: "RequestedSequence", dataType: DataType.UInt64, value: sequence.toString() }
    ]);
    const observation = await this.#waitForCommit(sequence, image);
    const acknowledgedAtMonotonicMs = performance.now();
    const acknowledgedAtIso = new Date().toISOString();
    this.#sequence = sequence;
    this.#activeSlot = slot;
    return {
      ...observation,
      workstationEpoch: this.#epoch.toString(),
      workstationSequence: sequence.toString(),
      slot,
      sentAtIso,
      sentAtMonotonicMs,
      acknowledgedAtIso,
      acknowledgedAtMonotonicMs,
      latencyMs: Number((acknowledgedAtMonotonicMs - sentAtMonotonicMs).toFixed(3)),
      image
    };
  }

  async observe() {
    const values = await readMany(this.#session, this.#nodes, statusNames);
    const bootIdentity = numericString(values.PlcBootIdentity);
    if (this.#bootIdentity !== "0" && bootIdentity !== this.#bootIdentity) {
      throw new Error(`PLC boot identity changed during M7 (${this.#bootIdentity} -> ${bootIdentity})`);
    }
    this.#bootIdentity = bootIdentity;
    return this.#toObservation(values);
  }

  async close() {
    if (this.#session) {
      try { await this.#session.close(); } finally { this.#session = undefined; }
    }
    if (this.#client) {
      try { await this.#client.disconnect(); } finally { this.#client = undefined; }
    }
  }

  async #waitForCommit(sequence, image) {
    const fields = [...statusNames, ...activeNames];
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const values = await readMany(this.#session, this.#nodes, fields);
      if (u64ToBigInt(values.AppliedEpoch) === this.#epoch
        && u64ToBigInt(values.AppliedSequence) === sequence) {
        const mismatches = compareActive(image, values);
        if (mismatches.length) throw new Error(`Torn M7 image at ${sequence}: ${mismatches.join(", ")}`);
        if (u64ToBigInt(values.OutputCaptureCycle) === u64ToBigInt(values.PlcCycle)) {
          return this.#toObservation(values);
        }
      }
      await sleep(3);
    }
    throw new Error(`Timed out waiting for M7 commit (${this.#epoch}, ${sequence})`);
  }

  #toObservation(values) {
    return {
      observedAtIso: new Date().toISOString(),
      observedAtMonotonicMs: performance.now(),
      bootIdentity: numericString(values.PlcBootIdentity),
      appliedEpoch: numericString(values.AppliedEpoch),
      appliedSequence: numericString(values.AppliedSequence),
      plcCycle: numericString(values.PlcCycle),
      plcTimeUs: numericString(values.PlcTimeUs),
      outputCaptureCycle: numericString(values.OutputCaptureCycle),
      outputCaptureTimeUs: numericString(values.OutputCaptureTimeUs),
      connectorStale: Boolean(values.ConnectorStale),
      simulationApplied: Boolean(values.SimApplied),
      values: Object.fromEntries(outputFields.map((name) => [name, Boolean(values[name])]))
    };
  }

  #validateImage(candidate) {
    const image = {};
    for (const name of boolFields) {
      if (typeof candidate[name] !== "boolean") throw new Error(`M7 image ${name} is not BOOL`);
      image[name] = candidate[name];
    }
    for (const name of realFields) {
      if (typeof candidate[name] !== "number" || !Number.isFinite(candidate[name])) {
        throw new Error(`M7 image ${name} is not a finite REAL`);
      }
      image[name] = Math.fround(candidate[name]);
    }
    const encoder = candidate.Encoder_Count;
    if (!Number.isInteger(encoder) || encoder < 0 || encoder > 0xffffffff) {
      throw new Error("M7 image Encoder_Count is outside UDINT range");
    }
    image.Encoder_Count = encoder >>> 0;
    return image;
  }
}

const startedAtIso = new Date().toISOString();
const startedAtMonotonicMs = performance.now();
const checkpoints = [];
let coordinator;
let lastTickMonotonicMs = performance.now();
let lastProgressMs = 0;

function status(message) {
  const elapsed = ((performance.now() - startedAtMonotonicMs) / 1_000).toFixed(1);
  process.stderr.write(`[M7 +${elapsed}s] ${message}\n`);
}

async function checkpoint(id, exercise) {
  status(`${id} running`);
  const began = performance.now();
  try {
    const evidence = await exercise();
    const result = { id, status: "pass", durationMs: Number((performance.now() - began).toFixed(3)), evidence };
    checkpoints.push(result);
    status(`${id} passed`);
    return evidence;
  } catch (error) {
    checkpoints.push({ id, status: "fail", durationMs: Number((performance.now() - began).toFixed(3)), error: error instanceof Error ? error.stack : String(error) });
    throw error;
  }
}

async function pacedStep() {
  const beforeWait = performance.now();
  const remaining = world.manifest.tickMs - (beforeWait - lastTickMonotonicMs);
  if (remaining > 0) await sleep(remaining);
  const now = performance.now();
  const deltaMs = Math.max(1, now - lastTickMonotonicMs);
  lastTickMonotonicMs = now;
  const receipt = await coordinator.step(deltaMs);
  if (now - lastProgressMs >= 1_000) {
    lastProgressMs = now;
    status(`seq=${receipt.workstationSequence} ack=${receipt.appliedSequence} latency=${receipt.latencyMs.toFixed(1)}ms motor=${receipt.values.Motor_RunCmd} speed=${Number(receipt.image.Belt_SpeedActual).toFixed(3)} encoder=${receipt.image.Encoder_Count}`);
  }
  return receipt;
}

async function stepUntil(predicate, timeoutMs, label) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await pacedStep();
  }
  assert(predicate(), label);
}

function carton() {
  return [...coordinator.context.entityState.values()]
    .find((entity) => entity.type === "carton" && entity.state.itemId === "M7-CARTON-1");
}

async function persist(statusValue, error) {
  const [project, worldSource] = await Promise.all([readFile(projectPath), readFile(worldPath)]);
  const finalSnapshot = coordinator ? await world.snapshot(coordinator.context) : null;
  const payload = {
    schemaVersion: 1,
    status: statusValue,
    evidenceClass: "live_plc_closed_loop",
    startedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    durationMs: Number((performance.now() - startedAtMonotonicMs).toFixed(3)),
    endpointUrl,
    securityMode: "SignAndEncrypt",
    securityPolicy: "Basic256Sha256",
    worldVersion: world.manifest.packageVersion,
    worldSha256: sha256(worldSource),
    plcProjectSha256: sha256(project),
    checkpoints,
    finalSnapshot,
    finalInputImage: coordinator ? coordinator.context.plc.currentInputState() : null,
    finalOutputFrame: coordinator ? coordinator.context.plc.currentOutputFrame() : null,
    coordinatorEventCount: coordinator?.events.length ?? 0,
    worldEventCount: coordinator?.context.events.length ?? 0,
    traceFile: tracePath,
    error: error instanceof Error ? error.stack : error ? String(error) : null
  };
  const trace = coordinator ? {
    traceVersion: "controlsbench-live-m7-v1",
    evidenceClass: "live_plc_closed_loop",
    worldVersion: world.manifest.packageVersion,
    connectorId: coordinator.connector.id,
    coordinatorEvents: coordinator.events,
    worldEvents: coordinator.context.events
  } : null;
  await mkdir(dirname(resultPath), { recursive: true });
  await Promise.all([
    writeFile(resultPath, `${JSON.stringify(payload, null, 2)}\n`),
    writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`)
  ]);
  return payload;
}

async function main() {
  const connector = new OpcUaM2Connector();
  coordinator = new LiveWorldCoordinator(world, connector, {
    seed: 20261030,
    worldVersion: world.manifest.packageVersion
  });
  try {
    const initialReceipt = await coordinator.initialize();
    lastTickMonotonicMs = performance.now();
    await checkpoint("M7-0-initial-image", async () => {
      assert.equal(initialReceipt.simulationApplied, true, "simulation was not applied");
      assert.equal(initialReceipt.connectorStale, false, "connector was stale at initialization");
      assert.equal(initialReceipt.values.Motor_RunCmd, false, "motor command was active in the normal initial image");
      assert.equal(initialReceipt.image.Encoder_Count, 0, "encoder was not zero in the initial world image");
      return {
        bootIdentity: initialReceipt.bootIdentity,
        epoch: initialReceipt.workstationEpoch,
        sequence: initialReceipt.workstationSequence,
        plcCycle: initialReceipt.plcCycle,
        latencyMs: initialReceipt.latencyMs
      };
    });

    await checkpoint("M7-1-plc-start-and-acceleration", async () => {
      await coordinator.control({
        id: "fault.setSensorStuck",
        payload: { signalId: "PE_Entry", active: true, value: true },
        cause: "M7 explicit start stimulus for the measurement DUT"
      });
      await stepUntil(
        () => coordinator.context.plc.currentOutputFrame().values.Motor_RunCmd === true,
        3_000,
        "PLC did not command the motor from the explicit entry stimulus"
      );
      const startCommandAtMs = coordinator.context.time.nowMs;
      await stepUntil(
        () => coordinator.context.plc.currentInputState().Drive_RunningFB === true,
        5_000,
        "generated drive did not produce running feedback"
      );
      await stepUntil(
        () => Number(coordinator.context.plc.currentInputState().Belt_SpeedActual) >= 0.49,
        5_000,
        "generated belt did not physically accelerate"
      );
      const receipt = coordinator.latestReceipt;
      assert(receipt, "missing start receipt");
      assert(Number(receipt.image.Encoder_Count) > 0, "encoder did not advance during acceleration");
      return {
        startCommandAtWorldMs: startCommandAtMs,
        fullSpeedAtWorldMs: coordinator.context.time.nowMs,
        speedMps: receipt.image.Belt_SpeedActual,
        encoderCount: receipt.image.Encoder_Count,
        appliedSequence: receipt.appliedSequence,
        plcCycle: receipt.plcCycle
      };
    });

    await checkpoint("M7-2-carton-photoeye-and-plc-stop", async () => {
      await coordinator.control({
        id: "carton.introduce",
        payload: { itemId: "M7-CARTON-1", requestedRoute: null },
        cause: "M7 live carton and photoeye exercise"
      });
      await stepUntil(
        () => Number(carton()?.state.positionM ?? 0) >= 0.5,
        8_000,
        "modeled carton did not reach the physical entry photoeye"
      );
      const handoffPositionM = Number(carton()?.state.positionM);
      const handoffEncoder = Number(coordinator.context.plc.currentInputState().Encoder_Count);
      await coordinator.control({
        id: "fault.setSensorStuck",
        payload: { signalId: "PE_Entry", active: false },
        cause: "M7 handoff from explicit start stimulus to physical carton occupancy"
      });
      await stepUntil(
        () => coordinator.context.plc.currentInputState().PE_Entry === false,
        5_000,
        "entry photoeye did not clear behind the modeled carton"
      );
      const clearedAtWorldMs = coordinator.context.time.nowMs;
      await stepUntil(
        () => coordinator.context.plc.currentOutputFrame().values.Motor_RunCmd === false,
        3_000,
        "PLC did not remove the motor command after the photoeye cleared"
      );
      return {
        handoffPositionM,
        handoffEncoder,
        photoeyeClearedAtWorldMs: clearedAtWorldMs,
        motorCommand: coordinator.context.plc.currentOutputFrame().values.Motor_RunCmd,
        appliedSequence: coordinator.latestReceipt?.appliedSequence,
        plcCycle: coordinator.latestReceipt?.plcCycle
      };
    });

    await checkpoint("M7-3-deceleration-and-stationary-hold", async () => {
      const positionAtStopCommand = Number(carton()?.state.positionM);
      const encoderAtStopCommand = Number(coordinator.context.plc.currentInputState().Encoder_Count);
      const speedAtStopCommand = Number(coordinator.context.plc.currentInputState().Belt_SpeedActual);
      assert(speedAtStopCommand > 0, "belt was already stopped when the PLC removed command");
      await stepUntil(
        () => coordinator.context.plc.currentInputState().Drive_RunningFB === false
          && Number(coordinator.context.plc.currentInputState().Belt_SpeedActual) === 0,
        5_000,
        "generated belt did not decelerate to rest"
      );
      const stoppedPosition = Number(carton()?.state.positionM);
      const stoppedEncoder = Number(coordinator.context.plc.currentInputState().Encoder_Count);
      assert(stoppedPosition > positionAtStopCommand, "carton did not coast after stop command");
      assert(stoppedEncoder > encoderAtStopCommand, "encoder did not record coast after stop command");
      const holdStarted = coordinator.context.time.nowMs;
      while (coordinator.context.time.nowMs - holdStarted < 500) await pacedStep();
      assert.equal(Number(carton()?.state.positionM), stoppedPosition, "carton moved during stationary hold");
      assert.equal(Number(coordinator.context.plc.currentInputState().Encoder_Count), stoppedEncoder, "encoder moved during stationary hold");
      return {
        speedAtStopCommand,
        positionAtStopCommand,
        stoppedPosition,
        coastDistanceM: stoppedPosition - positionAtStopCommand,
        encoderAtStopCommand,
        stoppedEncoder,
        holdDurationMs: coordinator.context.time.nowMs - holdStarted,
        finalAppliedSequence: coordinator.latestReceipt?.appliedSequence,
        finalPlcCycle: coordinator.latestReceipt?.plcCycle
      };
    });

    const payload = await persist("pass", null);
    status(`M7 passed; result=${resultPath}`);
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } catch (error) {
    const payload = await persist("fail", error);
    process.stderr.write(`M7 failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.stderr.write(`Failure evidence saved to ${resultPath}\n`);
    process.exitCode = 1;
    return payload;
  } finally {
    await coordinator.close("M7 live run complete");
  }
}

await main();
