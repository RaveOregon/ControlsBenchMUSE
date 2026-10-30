import assert from "node:assert/strict";
import test from "node:test";
import world from "../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts";
import type {
  BenchConnector,
  CommitReceipt,
  ConnectorObservation,
  RawSignalImage
} from "../src/live/connector.ts";
import { LiveWorldCoordinator } from "../src/live/coordinator.ts";

const outputIds = ["Motor_RunCmd", "D1_ExtendCmd", "D2_ExtendCmd", "StackLight_Red", "StackLight_Green"];

class MeasurementFixtureConnector implements BenchConnector {
  readonly id = "measurement-fixture";
  #epoch = "20261030";
  #sequence = 0;
  #cycle = 0;
  #activeSlot = 1;
  #image: RawSignalImage = {};
  #opened = false;

  async open(): Promise<ConnectorObservation> {
    this.#opened = true;
    return this.#observation();
  }

  async resetSession(): Promise<ConnectorObservation> {
    if (!this.#opened) throw new Error("connector is not open");
    this.#sequence = 0;
    this.#cycle += 1;
    return this.#observation();
  }

  async commit(image: Readonly<RawSignalImage>): Promise<CommitReceipt> {
    if (!this.#opened) throw new Error("connector is not open");
    const sentAt = performance.now();
    this.#image = structuredClone(image);
    this.#sequence += 1;
    this.#cycle += 1;
    this.#activeSlot = this.#activeSlot === 0 ? 1 : 0;
    const observation = this.#observation();
    return {
      ...observation,
      workstationEpoch: this.#epoch,
      workstationSequence: String(this.#sequence),
      slot: this.#activeSlot,
      sentAtIso: new Date().toISOString(),
      sentAtMonotonicMs: sentAt,
      acknowledgedAtIso: new Date().toISOString(),
      acknowledgedAtMonotonicMs: performance.now(),
      latencyMs: 0,
      image: structuredClone(this.#image)
    };
  }

  async observe(): Promise<ConnectorObservation> {
    return this.#observation();
  }

  async close(): Promise<void> {
    this.#opened = false;
  }

  #observation(): ConnectorObservation {
    const overloaded = this.#image.Drive_Overload === true;
    const outputs = {
      Motor_RunCmd: this.#image.PE_Entry === true && !overloaded,
      D1_ExtendCmd: this.#image.PE_D1Approach === true,
      D2_ExtendCmd: this.#image.PE_D2Approach === true,
      StackLight_Red: overloaded,
      StackLight_Green: !overloaded
    };
    assert.deepEqual(Object.keys(outputs), outputIds);
    return {
      observedAtIso: new Date().toISOString(),
      observedAtMonotonicMs: performance.now(),
      bootIdentity: "fixture-boot-1",
      appliedEpoch: this.#epoch,
      appliedSequence: String(this.#sequence),
      plcCycle: String(this.#cycle),
      plcTimeUs: String(this.#cycle * 20_000),
      outputCaptureCycle: String(this.#cycle),
      outputCaptureTimeUs: String(this.#cycle * 20_000),
      connectorStale: false,
      simulationApplied: true,
      values: outputs
    };
  }
}

async function stepUntil(
  coordinator: LiveWorldCoordinator,
  predicate: () => boolean,
  maximumTicks: number,
  message: string
): Promise<void> {
  for (let index = 0; index < maximumTicks; index += 1) {
    if (predicate()) return;
    await coordinator.step(world.manifest.tickMs);
  }
  assert(predicate(), message);
}

test("M7 coordinator closes the generated world around the measurement PLC fixture", async () => {
  const connector = new MeasurementFixtureConnector();
  const coordinator = new LiveWorldCoordinator(world, connector, {
    seed: 20261030,
    worldVersion: world.manifest.packageVersion
  });

  try {
    await coordinator.initialize();
    assert.equal(coordinator.context.plc.currentOutputFrame().values.Motor_RunCmd, false);

    await coordinator.control({
      id: "fault.setSensorStuck",
      payload: { signalId: "PE_Entry", active: true, value: true },
      cause: "M7 explicit start stimulus for the measurement DUT"
    });
    await stepUntil(
      coordinator,
      () => coordinator.context.plc.currentOutputFrame().values.Motor_RunCmd === true,
      10,
      "PLC fixture never commanded the motor"
    );
    await stepUntil(
      coordinator,
      () => coordinator.context.plc.currentInputState().Drive_RunningFB === true,
      40,
      "generated drive never reached running feedback"
    );

    const encoderBefore = Number(coordinator.context.plc.currentInputState().Encoder_Count);
    await coordinator.control({
      id: "carton.introduce",
      payload: { itemId: "M7-CARTON-1", requestedRoute: null },
      cause: "M7 live closed-loop carton exercise"
    });
    const carton = () => [...coordinator.context.entityState.values()]
      .find((entity) => entity.type === "carton" && entity.state.itemId === "M7-CARTON-1");
    await stepUntil(
      coordinator,
      () => Number(carton()?.state.positionM ?? 0) >= 0.5,
      200,
      "carton never reached the physical entry photoeye"
    );
    const encoderAtPhotoeye = Number(coordinator.context.plc.currentInputState().Encoder_Count);
    assert(encoderAtPhotoeye > encoderBefore, "encoder did not advance before the carton reached the photoeye");

    await coordinator.control({
      id: "fault.setSensorStuck",
      payload: { signalId: "PE_Entry", active: false },
      cause: "M7 handoff from explicit start stimulus to physical carton occupancy"
    });
    await stepUntil(
      coordinator,
      () => coordinator.context.plc.currentInputState().PE_Entry === false,
      80,
      "entry photoeye never cleared after the carton"
    );
    await stepUntil(
      coordinator,
      () => coordinator.context.plc.currentOutputFrame().values.Motor_RunCmd === false,
      10,
      "PLC fixture did not remove the motor command after the photoeye cleared"
    );
    const positionAtStopCommand = Number(carton()?.state.positionM);
    await stepUntil(
      coordinator,
      () => coordinator.context.plc.currentInputState().Drive_RunningFB === false
        && Number(coordinator.context.plc.currentInputState().Belt_SpeedActual) === 0,
      80,
      "generated belt never decelerated to rest"
    );
    const stoppedPosition = Number(carton()?.state.positionM);
    const stoppedEncoder = Number(coordinator.context.plc.currentInputState().Encoder_Count);
    assert(stoppedPosition > positionAtStopCommand, "belt did not physically coast after stop command");

    for (let index = 0; index < 25; index += 1) await coordinator.step(world.manifest.tickMs);
    assert.equal(Number(carton()?.state.positionM), stoppedPosition, "carton moved during stationary hold");
    assert.equal(Number(coordinator.context.plc.currentInputState().Encoder_Count), stoppedEncoder, "encoder moved during stationary hold");
    assert(coordinator.events.some((event) => event.lane === "connector"), "coordinator recorded no connector evidence");
    assert(coordinator.context.events.some((event) => event.lane === "raw_input"), "world recorded no raw effects");
  } finally {
    await coordinator.close("M7 fixture test complete");
  }
});
