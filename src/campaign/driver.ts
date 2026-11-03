import type { BenchConnector, CommitReceipt, ConnectorObservation, RawSignalImage } from "../live/connector.ts";
import { LiveWorldCoordinator } from "../live/coordinator.ts";
import type { WorldControl, WorldSnapshot } from "../proof/contracts.ts";
import type { Outcome, ToolCall } from "./contracts.ts";
import { CampaignLedger } from "./ledger.ts";
import { appendCoordinatorEvent } from "./live-evidence.ts";
import { bounded, DeadlineError, systemClock } from "./clock.ts";
import type { Clock } from "./clock.ts";

export class ToolFailure extends Error {
  readonly outcome: Exclude<Outcome, "requested" | "applied">;
  readonly evidence?: { evidenceRefs: string[]; value?: unknown };
  constructor(outcome: ToolFailure["outcome"], message: string, evidence?: { evidenceRefs: string[]; value?: unknown }) { super(message); this.outcome = outcome; this.evidence = evidence; }
}
export interface ControlBinding {
  describe: unknown;
  translate(call: ToolCall): WorldControl;
}
export interface HmiAdapter {
  perform(call: ToolCall, signal: AbortSignal): Promise<{ reference: string; atIso: string }>;
}
export interface SimulationExit {
  // Must explicitly select and observe hardware passthrough; connector.close is NOT this contract.
  exit(signal: AbortSignal): Promise<ConnectorObservation>;
}
interface PendingControl { call: ToolCall; control: WorldControl; signal: AbortSignal; resolve: (refs: string[]) => void; reject: (error: unknown) => void }

export class CoordinatorCampaignDriver {
  readonly coordinator: LiveWorldCoordinator;
  readonly ledger: CampaignLedger;
  readonly binding: ControlBinding;
  readonly clock: Clock;
  readonly cadenceMs = 100;
  readonly operationTimeoutMs: number;
  readonly initializeTimeoutMs: number;
  readonly elapsedStep: boolean;
  readonly maximumStepMs: number;
  running = false;
  quarantined = false;
  failure?: ToolFailure;
  resetHeld = false;
  onFault?: (error: ToolFailure) => void;
  #pending: PendingControl[] = [];
  #busy?: Promise<void>;
  #timer?: unknown;
  #auto = false;
  #nextDeadline = 0;
  #sourceCursor = 0; #worldCursor = 0; #syntheticSequence = 1_000_000_000;
  #lastImage: RawSignalImage = {};
  #lastSnapshot?: WorldSnapshot;
  #boot?: string;
  #epoch?: string;
  #sequence?: bigint;
  #lastRefs: string[] = [];
  #lastConfirmedAtMs = 0;
  #listeners = new Set<() => void>();
  #initialized = false;
  #lastWorldStepAtMs = 0;
  constructor(coordinator: LiveWorldCoordinator, ledger: CampaignLedger, binding: ControlBinding, options: { clock?: Clock; operationTimeoutMs?: number; initializeTimeoutMs?: number; elapsedStep?: boolean; maximumStepMs?: number } = {}) {
    this.coordinator = coordinator; this.ledger = ledger; this.binding = binding;
    this.clock = options.clock ?? systemClock; this.operationTimeoutMs = options.operationTimeoutMs ?? 2000;
    this.initializeTimeoutMs = options.initializeTimeoutMs ?? this.operationTimeoutMs;
    this.elapsedStep = options.elapsedStep ?? false; this.maximumStepMs = options.maximumStepMs ?? 300;
  }
  get connector(): BenchConnector { return this.coordinator.connector; }
  get lastImage(): RawSignalImage { return structuredClone(this.#lastImage); }
  get lastEvidenceRefs(): string[] { return [...this.#lastRefs]; }
  get evidenceAgeMs(): number { return Math.max(0, this.clock.now() - this.#lastConfirmedAtMs); }
  get lastSnapshot(): WorldSnapshot | undefined { return structuredClone(this.#lastSnapshot); }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }

  async initialize(): Promise<void> {
    if (this.#busy || this.#initialized) throw new Error("Driver is already initializing/initialized");
    this.#busy = (async () => { try {
      const receipt = await bounded(() => this.coordinator.initialize(), this.initializeTimeoutMs, this.clock);
      this.#acceptReceipt(receipt); this.#flush();
      this.#lastSnapshot = await bounded(() => this.coordinator.world.snapshot(this.coordinator.context), this.operationTimeoutMs, this.clock);
      this.#initialized = true;
    } catch (error) { this.#fault(error); throw error; } })();
    try { await this.#busy; } finally { this.#busy = undefined; }
  }
  start(automatic = true): void {
    if (this.quarantined || this.resetHeld) throw new ToolFailure("stale", "Driver requires a new campaign after quarantine/reset");
    this.running = true; this.#auto = automatic;
    this.#lastWorldStepAtMs = this.clock.now();
    if (automatic) { this.#nextDeadline = this.clock.now() + this.cadenceMs; this.#schedule(); }
  }
  async hold(stopClock = false): Promise<void> {
    this.running = false;
    for (const p of this.#pending.splice(0)) p.reject(new ToolFailure("inconclusive", "Campaign held before control application"));
    if (stopClock) { this.#auto = false; if (this.#timer !== undefined) this.clock.clearTimer(this.#timer); this.#timer = undefined; }
    try { await this.#busy; } catch { /* initialization fault is already recorded; finalization still drains */ }
  }
  async tick(): Promise<void> {
    if (this.#busy || this.quarantined) return;
    this.#busy = this.#tick();
    try { await this.#busy; } finally { this.#busy = undefined; }
  }
  async #tick(): Promise<void> {
    const selected = this.running ? this.#pending.splice(0) : [];
    try {
      await bounded(async () => {
        const observation = this.connector.inspectLink ? await this.connector.inspectLink() : await this.connector.observe();
        if (this.quarantined) throw new ToolFailure("stale", "Late connector response ignored after quarantine");
        this.#fresh(observation);
        for (const p of selected) {
          if (p.signal.aborted || !this.running) { p.reject(new ToolFailure("inconclusive", "Cancelled before application")); continue; }
          this.ledger.append("world.stimulus", { actionId: p.call.id, control: p.control }, p.call.name.includes("fault") ? "truth" : "public");
          await this.coordinator.control(p.control);
          if (this.quarantined) throw new ToolFailure("stale", "Late world control response ignored after quarantine");
        }
        // Holding refreshes the unchanged complete image without advancing world time.
        const now = this.clock.now(), delta = this.elapsedStep ? now - this.#lastWorldStepAtMs : this.cadenceMs;
        if (this.running && this.elapsedStep && (!Number.isFinite(delta) || delta <= 0 || delta > this.maximumStepMs))
          throw new ToolFailure("inconclusive", `World step gap ${delta} ms exceeds the declared ${this.maximumStepMs} ms observation bound; world not advanced`);
        const receipt = this.running ? await this.coordinator.step(delta) : await this.connector.commit(this.#lastImage);
        if (this.running) this.#lastWorldStepAtMs = now;
        if (this.quarantined) throw new ToolFailure("stale", "Late commit ignored after quarantine; reconcile physical state");
        this.#acceptReceipt(receipt);
        if (this.running) this.#flush(); else this.#recordDirectCommit(receipt, "campaign.hold");
        if (this.running) this.#lastSnapshot = await this.coordinator.world.snapshot(this.coordinator.context);
      }, this.operationTimeoutMs, this.clock);
      for (const p of selected) if (!p.signal.aborted) p.resolve(this.lastEvidenceRefs);
      for (const listener of this.#listeners) listener();
    } catch (error) {
      const failure = this.#fault(error);
      for (const p of selected) p.reject(failure);
    }
  }
  #schedule(): void {
    if (!this.#auto || this.#timer !== undefined) return;
    const due = this.#nextDeadline;
    this.#timer = this.clock.setTimer(() => {
      this.#timer = undefined;
      void this.tick().finally(() => {
        const elapsed = this.clock.now() - due;
        this.#nextDeadline = due + this.cadenceMs;
        if (this.#nextDeadline <= this.clock.now()) {
          this.#nextDeadline = this.clock.now() + this.cadenceMs;
          if (!this.quarantined) this.ledger.append("agent.activity", { phase: "coordinator_delayed", summary: `Coordinator overrun ${elapsed} ms; no catch-up burst` });
        }
        this.#schedule();
      });
    }, Math.max(0, due - this.clock.now()));
  }
  apply(call: ToolCall, signal: AbortSignal): Promise<string[]> {
    if (!this.running || this.quarantined) return Promise.reject(new ToolFailure("stale", "World is held or connector is quarantined"));
    const control = this.binding.translate(call);
    if (!this.coordinator.world.manifest.controls.some(c => c.id === control.id)) return Promise.reject(new ToolFailure("rejected", `World does not declare ${control.id}`));
    return new Promise((resolve, reject) => {
      const pending = { call, control, signal, resolve: (refs: string[]) => { cleanup(); resolve(refs); }, reject: (error: unknown) => { cleanup(); reject(error); } };
      const abort = () => { this.#pending = this.#pending.filter(p => p !== pending); pending.reject(new ToolFailure("inconclusive", "Control cancelled; inspect ledger before retrying")); };
      const cleanup = () => signal.removeEventListener("abort", abort);
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true }); this.#pending.push(pending);
    });
  }
  async reset(): Promise<string[]> {
    await this.hold(true);
    if (this.quarantined) throw new ToolFailure("stale", "Cannot reset a quarantined connector; reconcile the outstanding operation first");
    if (!this.#initialized) throw new ToolFailure("rejected", "Start simulation before resetting its image");
    const zero = Object.fromEntries(this.coordinator.world.manifest.signals.filter(s => s.direction === "world_to_plc")
      .map(s => [s.id, s.dataType === "BOOL" ? false : s.dataType === "STRING" ? "" : 0]));
    try {
      const receipt = await bounded(() => this.connector.commit(zero), this.operationTimeoutMs, this.clock);
      this.#acceptReceipt(receipt); this.#recordDirectCommit(receipt, "campaign.reset"); this.resetHeld = true;
      this.ledger.append("simulation.reset", { sourceId: this.#lastRefs[0], image: receipt.image }); return this.lastEvidenceRefs;
    } catch (error) { throw this.#fault(error); }
  }
  async exit(adapter: SimulationExit): Promise<void> {
    await this.hold(true);
    if (this.quarantined) throw new ToolFailure("stale", "Reconcile connector before selecting passthrough");
    const observation = await bounded(signal => adapter.exit(signal), this.operationTimeoutMs, this.clock);
    if (observation.simulationApplied) throw new ToolFailure("inconclusive", "Passthrough not confirmed");
    this.ledger.append("simulation.exited", { reason: "Explicit Exit Simulation; passthrough observed" });
    this.ledger.append("connector.state", { state: "passthrough", reason: "Simulation deselected", ageMs: 0 });
    this.resetHeld = true;
  }
  #fresh(o: ConnectorObservation): void {
    const ageMs = this.clock.now() - o.observedAtMonotonicMs;
    if (o.connectorStale) throw new ToolFailure("stale", `PLC ConnectorStale=true at applied ${o.appliedEpoch}/${o.appliedSequence}`);
    if (!o.simulationApplied) throw new ToolFailure("stale", "PLC simulation is inactive");
    if (ageMs < 0 || ageMs > this.operationTimeoutMs) throw new ToolFailure("stale", `Observation timestamp age ${ageMs} ms is invalid`);
    if (this.#boot && o.bootIdentity !== this.#boot) throw new ToolFailure("stale", "PLC boot identity changed");
    this.ledger.append("connector.state", { state: "fresh", reason: "Observed simulation active under stable PLC boot", ageMs });
  }
  #acceptReceipt(receipt: CommitReceipt): void {
    this.#fresh(receipt);
    if (receipt.appliedEpoch !== receipt.workstationEpoch || receipt.appliedSequence !== receipt.workstationSequence
      || receipt.plcCycle !== receipt.outputCaptureCycle || (this.#epoch && receipt.workstationEpoch !== this.#epoch)
      || (this.#sequence !== undefined && BigInt(receipt.workstationSequence) <= this.#sequence)) throw new ToolFailure("stale", "PLC commit/capture correlation invalid");
    this.#boot = receipt.bootIdentity; this.#epoch = receipt.workstationEpoch; this.#sequence = BigInt(receipt.workstationSequence);
    this.#lastImage = structuredClone(receipt.image);
    this.#lastConfirmedAtMs = this.clock.now();
  }
  #flush(): void {
    for (const source of this.coordinator.events.slice(this.#sourceCursor)) this.#lastRefs = appendCoordinatorEvent(this.ledger, source);
    this.#sourceCursor = this.coordinator.events.length;
    for (const source of this.coordinator.context.events.slice(this.#worldCursor)) this.ledger.append("world.evidence", { source }, "truth");
    this.#worldCursor = this.coordinator.context.events.length;
  }
  #recordDirectCommit(r: CommitReceipt, cause: string): void {
    this.#lastRefs = appendCoordinatorEvent(this.ledger, { sequence: ++this.#syntheticSequence, atIso: r.acknowledgedAtIso,
      atMonotonicMs: r.acknowledgedAtMonotonicMs, lane: "connector", data: { action: "commit.acknowledged", cause,
        workstationEpoch: r.workstationEpoch, workstationSequence: r.workstationSequence, slot: r.slot, latencyMs: r.latencyMs,
        bootIdentity: r.bootIdentity, plcCycle: r.plcCycle, outputCaptureCycle: r.outputCaptureCycle, image: r.image, outputs: r.values,
        ...(r.outputQuality ? { outputQuality: r.outputQuality } : {}) } }, "campaign-driver");
  }
  #fault(error: unknown): ToolFailure {
    this.quarantined = true; this.running = false; this.#auto = false;
    if (this.#timer !== undefined) this.clock.clearTimer(this.#timer); this.#timer = undefined;
    const failure = error instanceof ToolFailure ? error : new ToolFailure(error instanceof DeadlineError ? "timed_out" : "inconclusive", error instanceof Error ? error.message : String(error));
    this.failure = failure;
    this.ledger.append("connector.state", { state: failure.outcome === "stale" ? "stale" : "quarantined",
      reason: `${failure.message}; last confirmed image retained. An outstanding transport operation may still complete; reconcile before reuse.`, ageMs: this.operationTimeoutMs });
    for (const p of this.#pending.splice(0)) p.reject(failure);
    for (const listener of this.#listeners) listener();
    this.onFault?.(failure); return failure;
  }
}
