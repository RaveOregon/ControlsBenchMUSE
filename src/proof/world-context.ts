import type {
  ActivityUpdate,
  EntitySnapshot,
  EvidenceEvent,
  PlcOutputFrame,
  RawInputEffect,
  RawValue,
  ScheduledAction,
  WorldControl,
  WorldContext,
  WorldManifest,
  WorldTick
} from "./contracts.ts";
import { validateManifest } from "./manifest.ts";

export interface RecordedEvent {
  sequence: number;
  atMs: number;
  tick: number;
  lane: "raw_input" | "plc_frame" | "control" | "entity" | "evidence" | "activity" | "schedule";
  worldVersion: string;
  data: Record<string, unknown>;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function zeroValue(type: WorldManifest["signals"][number]["dataType"]): RawValue {
  if (type === "BOOL") return false;
  if (type === "STRING") return "";
  return 0;
}

export class InstrumentedWorldContext implements WorldContext {
  readonly manifest: WorldManifest;
  readonly worldVersion: string;
  readonly events: RecordedEvent[] = [];
  readonly entityState = new Map<string, EntitySnapshot>();
  readonly activities: ActivityUpdate[] = [];
  readonly time: WorldContext["time"];

  #nowMs = 0;
  #deltaMs = 0;
  #tick = 0;
  #eventSequence = 0;
  #scheduleSequence = 0;
  #frame: PlcOutputFrame = { sequence: 0, observedAtMs: 0, values: {} };
  #inputs: Record<string, RawValue> = {};
  #scheduled = new Map<string, ScheduledAction>();
  #random: () => number;

  constructor(manifestCandidate: unknown, { seed, worldVersion }: { seed: number; worldVersion: string }) {
    this.manifest = validateManifest(manifestCandidate);
    this.worldVersion = worldVersion;
    this.#random = mulberry32(seed);
    for (const signal of this.manifest.signals) {
      if (signal.direction === "world_to_plc") this.#inputs[signal.id] = zeroValue(signal.dataType);
      if (signal.direction === "plc_to_world") this.#frame.values[signal.id] = signal.normalValue;
    }
    const owner = this;
    this.time = {
      get nowMs() { return owner.#nowMs; },
      get deltaMs() { return owner.#deltaMs; },
      get tick() { return owner.#tick; }
    };
  }

  readonly random = {
    next: (): number => this.#random(),
    integer: (minInclusive: number, maxInclusive: number): number => {
      if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive) || maxInclusive < minInclusive) {
        throw new Error("Invalid seeded random integer range");
      }
      return Math.floor(this.#random() * (maxInclusive - minInclusive + 1)) + minInclusive;
    }
  };

  readonly plc = {
    readRawOutput: (signalId: string): RawValue => {
      this.#assertDirection(signalId, "plc_to_world");
      return this.#frame.values[signalId];
    },
    writeRawInput: (effect: RawInputEffect): void => {
      this.#assertDirection(effect.signalId, "world_to_plc");
      if (!effect.cause?.trim()) throw new Error(`Raw input effect ${effect.signalId} is missing a cause`);
      this.#inputs[effect.signalId] = effect.value;
      this.#record("raw_input", { ...effect, stateRevision: this.#eventSequence + 1 });
    },
    currentOutputFrame: (): PlcOutputFrame => structuredClone(this.#frame),
    currentInputState: (): Readonly<Record<string, RawValue>> => Object.freeze({ ...this.#inputs })
  };

  readonly schedule = {
    at: (request: ScheduledAction): string => {
      if (!Number.isFinite(request.dueAtMs) || request.dueAtMs < this.#nowMs) throw new Error("Scheduled action must be in the present or future");
      const id = `scheduled-${++this.#scheduleSequence}`;
      this.#scheduled.set(id, structuredClone(request));
      this.#record("schedule", { action: "at", actionId: id, request });
      return id;
    },
    cancel: (actionId: string): void => {
      const existed = this.#scheduled.delete(actionId);
      this.#record("schedule", { action: "cancel", actionId, existed });
    }
  };

  readonly entities = {
    publish: (snapshot: EntitySnapshot): void => {
      if (!snapshot.id || !snapshot.type) throw new Error("Published entities require id and type");
      this.entityState.set(snapshot.id, structuredClone(snapshot));
      this.#record("entity", { action: "publish", snapshot });
    },
    remove: (entityId: string, reason: string): void => {
      const existed = this.entityState.delete(entityId);
      this.#record("entity", { action: "remove", entityId, reason, existed });
    }
  };

  readonly evidence = {
    append: (event: EvidenceEvent): void => {
      if (!event.type || !event.summary) throw new Error("Evidence requires type and summary");
      this.#record("evidence", { event });
    }
  };

  readonly status = {
    report: (update: ActivityUpdate): void => {
      if (!update.phase || !update.message) throw new Error("Activity updates require phase and message");
      this.activities.push(structuredClone(update));
      this.#record("activity", { update });
    }
  };

  setPlcFrame(frame: PlcOutputFrame): void {
    if (!Number.isInteger(frame.sequence) || frame.sequence <= this.#frame.sequence) throw new Error("PLC frame sequence must increase");
    const next = { ...this.#frame.values };
    for (const [signalId, value] of Object.entries(frame.values)) {
      this.#assertDirection(signalId, "plc_to_world");
      next[signalId] = value;
    }
    this.#frame = { sequence: frame.sequence, observedAtMs: frame.observedAtMs, values: next };
    this.#record("plc_frame", { frame: this.#frame });
  }

  recordControl(control: WorldControl): void {
    if (!control.id || !control.cause) throw new Error("World controls require id and cause");
    if (!this.manifest.controls.some((entry) => entry.id === control.id)) throw new Error(`Undeclared world control ${control.id}`);
    this.#record("control", { control });
  }

  advance(deltaMs: number): WorldTick {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) throw new Error("World time must advance by a positive duration");
    this.#deltaMs = deltaMs;
    this.#nowMs += deltaMs;
    this.#tick += 1;
    return { nowMs: this.#nowMs, deltaMs, tick: this.#tick };
  }

  takeDueControls(): WorldControl[] {
    const due: WorldControl[] = [];
    for (const [id, request] of this.#scheduled) {
      if (request.dueAtMs <= this.#nowMs) {
        this.#scheduled.delete(id);
        due.push(structuredClone(request.control));
        this.#record("schedule", { action: "due", actionId: id, control: request.control });
      }
    }
    return due;
  }

  #assertDirection(signalId: string, expected: "plc_to_world" | "world_to_plc"): void {
    const signal = this.manifest.signals.find((entry) => entry.id === signalId);
    if (!signal) throw new Error(`Unknown raw signal ${signalId}`);
    if (signal.direction !== expected) throw new Error(`Signal ${signalId} is ${signal.direction}, expected ${expected}`);
  }

  #record(lane: RecordedEvent["lane"], data: Record<string, unknown>): void {
    this.events.push({
      sequence: ++this.#eventSequence,
      atMs: this.#nowMs,
      tick: this.#tick,
      lane,
      worldVersion: this.worldVersion,
      data: structuredClone(data)
    });
  }
}
