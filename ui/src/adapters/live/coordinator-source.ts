// Live coordinator attachment point.
//
// The live lane's coordinator (src/live on main, in progress) records CoordinatorEvents and
// returns ConnectorObservation / CommitReceipt objects. The shapes below mirror those
// structurally so this UI does not import uncommitted code. A transport (SSE, WebSocket,
// or Electron IPC) pushes them into LiveSession.ingest*; until one is attached, the live
// workspace shows nothing and cannot start.

import type { EvidenceClass, MuseEvent, MuseEventBody, EventLane, Provenance, RawValue } from "../../model/events.ts";
import type { CommandResult, WorkspaceStore } from "../../model/workspace-store.ts";
import { formatMs, formatRaw } from "../../model/format.ts";
import type { CampaignSource } from "../source.ts";

export interface CoordinatorEventLike {
  sequence: number;
  atIso: string;
  atMonotonicMs: number;
  lane: "lifecycle" | "control" | "connector" | "world";
  data: Record<string, unknown>;
}

export interface ConnectorObservationLike {
  observedAtIso: string;
  observedAtMonotonicMs: number;
  bootIdentity: string;
  appliedEpoch: string;
  appliedSequence: string;
  plcCycle: string;
  plcTimeUs: string;
  outputCaptureCycle: string;
  outputCaptureTimeUs: string;
  connectorStale: boolean;
  simulationApplied: boolean;
  values: Record<string, RawValue>;
}

export interface CommitReceiptLike extends ConnectorObservationLike {
  workstationEpoch: string;
  workstationSequence: string;
  slot: number;
  sentAtIso: string;
  sentAtMonotonicMs: number;
  acknowledgedAtIso: string;
  acknowledgedAtMonotonicMs: number;
  latencyMs: number;
  image: Record<string, RawValue>;
}

/** Commands the workspace sends to an attached coordinator. */
export interface CoordinatorTransport {
  send(command: { type: string; payload?: Record<string, unknown> }): void;
}

/** Maps coordinator/connector records onto MuseEvents labeled live. */
export class LiveEventMapper {
  readonly #outputIds: Set<string>;
  #origin: number | null = null;
  #sequence = 0;
  #bootIdentity: string | undefined;
  #stale = false;
  #image: Record<string, RawValue> = {};

  constructor(outputIds: Iterable<string>) {
    this.#outputIds = new Set(outputIds);
  }

  #at(monotonicMs: number): number {
    if (this.#origin === null) this.#origin = monotonicMs;
    return monotonicMs - this.#origin;
  }

  #event(monotonicMs: number, lane: EventLane, summary: string, body: MuseEventBody, evidenceClass: EvidenceClass, ref: string, recordedAt?: string): MuseEvent {
    const provenance: Provenance = { mode: "live", evidenceClass, source: "live:coordinator", clock: "live_wall", ref, recordedAt };
    return { ...body, id: `live-${++this.#sequence}`, atMs: this.#at(monotonicMs), lane, summary, provenance } as MuseEvent;
  }

  observation(observation: ConnectorObservationLike, ref = "observation"): MuseEvent[] {
    const at = observation.observedAtMonotonicMs;
    const events: MuseEvent[] = [];
    if (observation.bootIdentity !== this.#bootIdentity) {
      events.push(this.#event(at, "plc_ack", `PLC boot identity ${observation.bootIdentity}`, { kind: "plc.identity", bootIdentity: observation.bootIdentity, previousBootIdentity: this.#bootIdentity }, "plc_measurement", ref, observation.observedAtIso));
      this.#bootIdentity = observation.bootIdentity;
    }
    events.push(this.#event(at, "system", `PLC cycle ${observation.plcCycle}`, { kind: "plc.heartbeat", plcCycle: observation.plcCycle }, "plc_measurement", ref, observation.observedAtIso));
    events.push(this.#event(at, "system", `SimulationApplied = ${observation.simulationApplied}`, { kind: "simulation.state", applied: observation.simulationApplied, detail: "Reported by the PLC interceptor" }, "plc_measurement", ref, observation.observedAtIso));
    if (observation.connectorStale !== this.#stale) {
      this.#stale = observation.connectorStale;
      events.push(this.#event(at, "fault", observation.connectorStale ? "PLC reports BenchLinkStale" : "Bench link fresh", { kind: "connector.link", state: observation.connectorStale ? "lost" : "up", detail: observation.connectorStale ? "PLC interceptor reports BenchLinkStale; last simulated image held" : "PLC interceptor reports a fresh bench link" }, "plc_measurement", ref, observation.observedAtIso));
    }
    const outputs = Object.fromEntries(Object.entries(observation.values).filter(([id]) => this.#outputIds.has(id)));
    if (Object.keys(outputs).length > 0) events.push(this.#event(at, "plc_output", `PLC outputs @ cycle ${observation.outputCaptureCycle}`, { kind: "plc.output", values: outputs, origin: "plc" }, "plc_measurement", ref, observation.observedAtIso));
    return events;
  }

  receipt(receipt: CommitReceiptLike, ref = "receipt"): MuseEvent[] {
    const events: MuseEvent[] = [];
    for (const [signalId, value] of Object.entries(receipt.image)) {
      if (this.#image[signalId] === value) continue;
      events.push(this.#event(receipt.sentAtMonotonicMs, "raw_input", `${signalId} = ${formatRaw(value)}`, { kind: "raw.input", signalId, value, cause: `committed in seq ${receipt.workstationSequence}` }, "world_model", ref, receipt.sentAtIso));
    }
    this.#image = { ...receipt.image };
    events.push(this.#event(receipt.sentAtMonotonicMs, "raw_input", `Commit seq ${receipt.workstationSequence} → slot ${receipt.slot}`, { kind: "connector.commit", epoch: receipt.workstationEpoch, sequence: receipt.workstationSequence, slot: receipt.slot }, "plc_measurement", ref, receipt.sentAtIso));
    events.push(this.#event(receipt.acknowledgedAtMonotonicMs, "plc_ack", `PLC applied seq ${receipt.appliedSequence} in ${formatMs(receipt.latencyMs)}`, { kind: "connector.ack", epoch: receipt.appliedEpoch, sequence: receipt.appliedSequence, slot: receipt.slot, latencyMs: receipt.latencyMs, outputCaptureCycle: receipt.outputCaptureCycle }, "plc_measurement", ref, receipt.acknowledgedAtIso));
    return [...events, ...this.observation({ ...receipt, observedAtMonotonicMs: receipt.acknowledgedAtMonotonicMs, observedAtIso: receipt.acknowledgedAtIso }, ref)];
  }

  coordinator(event: CoordinatorEventLike): MuseEvent[] {
    const ref = `coordinator event #${event.sequence}`;
    const data = event.data;
    if (event.lane === "connector" || data.receipt || data.observation) {
      if (data.receipt) return this.receipt(data.receipt as CommitReceiptLike, ref);
      if (data.observation) return this.observation(data.observation as ConnectorObservationLike, ref);
    }
    if (event.lane === "control") {
      const control = (data.control ?? data) as { id?: string; payload?: Record<string, unknown>; cause?: string };
      return [this.#event(event.atMonotonicMs, "world", `${control.id ?? "control"}`, { kind: "world.control", controlId: String(control.id ?? "control"), payload: control.payload ?? {}, cause: String(control.cause ?? "") }, "world_model", ref, event.atIso)];
    }
    if (event.lane === "lifecycle") {
      return [this.#event(event.atMonotonicMs, "system", String(data.action ?? "lifecycle"), { kind: "step", phase: "preparing", message: String(data.action ?? "Coordinator lifecycle") }, "world_model", ref, event.atIso)];
    }
    return [this.#event(event.atMonotonicMs, "world", String(data.type ?? "world event"), { kind: "world.evidence", type: String(data.type ?? "world"), data }, "world_model", ref, event.atIso)];
  }
}

export class LiveSession implements CampaignSource {
  readonly mode = "live" as const;
  readonly label = "Live coordinator";
  readonly store: WorkspaceStore;
  readonly mapper: LiveEventMapper;
  transport: CoordinatorTransport | null = null;
  #originWallMs = performance.now();

  constructor(store: WorkspaceStore, outputIds: Iterable<string>) {
    this.store = store;
    this.mapper = new LiveEventMapper(outputIds);
  }

  get unavailableReason(): string | undefined {
    return this.transport ? undefined : "No live coordinator is attached. Nothing in this view is live until one is.";
  }

  attach(transport: CoordinatorTransport): void {
    this.transport = transport;
  }

  ingestCoordinatorEvents(events: readonly CoordinatorEventLike[]): void {
    this.store.applyEvents(events.flatMap((event) => this.mapper.coordinator(event)));
  }

  nowMs(): number {
    return performance.now() - this.#originWallMs;
  }

  advance(): void {
    // Live time is the wall clock; events arrive from the transport.
  }

  #forward(type: string, apply: () => CommandResult, payload?: Record<string, unknown>): CommandResult {
    if (!this.transport) return { ok: false, reason: this.unavailableReason! };
    const result = apply();
    if (result.ok) this.transport.send({ type, payload });
    return result;
  }

  start(): CommandResult {
    return this.#forward("start", () => this.store.start(this.nowMs()), { scope: this.store.state.scope });
  }
  pause(): CommandResult {
    return this.#forward("pause", () => this.store.pause(this.nowMs()));
  }
  resume(): CommandResult {
    return this.#forward("resume", () => this.store.resume(this.nowMs()));
  }
  stop(): CommandResult {
    return this.#forward("stop", () => this.store.stop(this.nowMs()));
  }
  resetSimulation(): CommandResult {
    return this.#forward("reset_simulation", () => this.store.resetSimulation(this.nowMs()));
  }
  exitSimulation(): CommandResult {
    return this.#forward("exit_simulation", () => this.store.exitSimulation(this.nowMs()));
  }
  enterSimulation(): CommandResult {
    return this.#forward("enter_simulation", () => this.store.enterSimulation(this.nowMs()));
  }
  setSuppression(outputId: string, suppressed: boolean): CommandResult {
    return this.#forward("set_output_suppression", () => this.store.setSuppression(outputId, suppressed, this.nowMs()), { outputId, suppressed });
  }
  steer(text: string): CommandResult {
    return this.#forward("steer", () => this.store.steer(text, this.nowMs()), { text });
  }
}
