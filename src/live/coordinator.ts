import type { GeneratedWorldModule, PlcOutputFrame, WorldControl } from "../proof/contracts.ts";
import { InstrumentedWorldContext } from "../proof/world-context.ts";
import type { BenchConnector, CommitReceipt, ConnectorObservation } from "./connector.ts";

export interface CoordinatorEvent {
  sequence: number;
  atIso: string;
  atMonotonicMs: number;
  lane: "lifecycle" | "control" | "connector" | "world";
  data: Record<string, unknown>;
}

export interface LiveWorldCoordinatorOptions {
  seed: number;
  worldVersion: string;
}

export class LiveWorldCoordinator {
  readonly world: GeneratedWorldModule;
  readonly connector: BenchConnector;
  readonly context: InstrumentedWorldContext;
  readonly events: CoordinatorEvent[] = [];

  #eventSequence = 0;
  #frameSequence = 0;
  #opened = false;
  #initialized = false;
  #closed = false;
  #latestObservation: ConnectorObservation | null = null;
  #latestReceipt: CommitReceipt | null = null;
  #seed: number;

  constructor(world: GeneratedWorldModule, connector: BenchConnector, options: LiveWorldCoordinatorOptions) {
    this.world = world;
    this.connector = connector;
    this.context = new InstrumentedWorldContext(world.manifest, options);
    this.#seed = options.seed;
  }

  get latestObservation(): ConnectorObservation | null {
    return this.#latestObservation === null ? null : structuredClone(this.#latestObservation);
  }

  get latestReceipt(): CommitReceipt | null {
    return this.#latestReceipt === null ? null : structuredClone(this.#latestReceipt);
  }

  async initialize(): Promise<CommitReceipt> {
    if (this.#initialized) throw new Error("Coordinator is already initialized");
    if (this.#closed) throw new Error("Coordinator is closed");
    const opened = await this.connector.open();
    this.#opened = true;
    this.#record("lifecycle", { action: "connector.open", connectorId: this.connector.id, observation: opened });
    const reset = await this.connector.resetSession();
    this.#latestObservation = structuredClone(reset);
    this.#record("lifecycle", { action: "connector.resetSession", observation: reset });
    await this.world.initialize(this.context, {
      seed: this.#seed,
      worldVersion: this.context.worldVersion
    });
    this.#record("world", { action: "initialize", worldVersion: this.context.worldVersion });
    const receipt = await this.#commit("world.initialize");
    this.#initialized = true;
    return receipt;
  }

  async control(control: WorldControl): Promise<void> {
    this.#assertReady();
    this.context.recordControl(control);
    await this.world.onControl(this.context, control);
    this.#record("control", { control: structuredClone(control) });
  }

  async step(deltaMs: number): Promise<CommitReceipt> {
    this.#assertReady();
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) throw new Error("Live step delta must be positive");
    const tick = this.context.advance(deltaMs);
    for (const due of this.context.takeDueControls()) {
      this.context.recordControl(due);
      await this.world.onControl(this.context, due);
      this.#record("control", { control: due, scheduled: true });
    }
    await this.world.tick(this.context, tick);
    this.#record("world", { action: "tick", tick });
    return this.#commit(`world.tick:${tick.tick}`);
  }

  async close(reason = "live coordinator completed"): Promise<void> {
    if (this.#closed) return;
    try {
      if (this.#initialized) await this.world.dispose(this.context, reason);
    } finally {
      if (this.#opened) await this.connector.close();
      this.#closed = true;
      this.#record("lifecycle", { action: "close", reason });
    }
  }

  async #commit(cause: string): Promise<CommitReceipt> {
    const image = { ...this.context.plc.currentInputState() };
    const receipt = await this.connector.commit(image);
    this.#latestReceipt = structuredClone(receipt);
    this.#latestObservation = structuredClone(receipt);
    await this.#acceptObservation(receipt);
    this.#record("connector", {
      action: "commit.acknowledged",
      cause,
      workstationEpoch: receipt.workstationEpoch,
      workstationSequence: receipt.workstationSequence,
      slot: receipt.slot,
      latencyMs: receipt.latencyMs,
      bootIdentity: receipt.bootIdentity,
      plcCycle: receipt.plcCycle,
      outputCaptureCycle: receipt.outputCaptureCycle,
      image: receipt.image,
      outputs: receipt.values,
      ...(receipt.outputQuality ? { outputQuality: receipt.outputQuality } : {})
    });
    return receipt;
  }

  async #acceptObservation(observation: ConnectorObservation): Promise<void> {
    const frame: PlcOutputFrame = {
      sequence: ++this.#frameSequence,
      observedAtMs: this.context.time.nowMs,
      values: observation.values
    };
    this.context.setPlcFrame(frame);
    await this.world.onPlcFrame(this.context, frame);
  }

  #assertReady(): void {
    if (!this.#initialized) throw new Error("Coordinator is not initialized");
    if (this.#closed) throw new Error("Coordinator is closed");
  }

  #record(lane: CoordinatorEvent["lane"], data: Record<string, unknown>): void {
    this.events.push({
      sequence: ++this.#eventSequence,
      atIso: new Date().toISOString(),
      atMonotonicMs: performance.now(),
      lane,
      data: structuredClone(data)
    });
  }
}
