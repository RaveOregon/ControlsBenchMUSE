// Parent-side CampaignDriver for controlsbench.wonder-process.v1 (src/campaign/process-port.ts).
// The child owns timing; this driver owns nothing physical. It forwards original action IDs with
// their originating campaign revision and the child boundary revision it last received, and
// derives all public evidence from the child's original ordered records through the existing
// appendCoordinatorEvent machinery, into the host's ledger only.
import type { CampaignLedger } from "../../campaign/ledger.ts";
import type { DecisionLease, ToolCall } from "../../campaign/contracts.ts";
import { ToolFailure } from "../../campaign/driver.ts";
import type { ControlBinding, SimulationExit } from "../../campaign/driver.ts";
import type { DecisionLeaseControl, DecisionLeaseReceipt } from "../../campaign/process-port.ts";
import { appendCoordinatorEvent } from "../../campaign/live-evidence.ts";
import { bounded, systemClock } from "../../campaign/clock.ts";
import type { ConnectorObservation, RawSignalImage } from "../connector.ts";
import type { CoordinatorEvent } from "../coordinator.ts";
import type { WorldSnapshot } from "../../proof/contracts.ts";
import { ChannelFailure, WonderProcessChannel } from "./channel.ts";
import type { Reply } from "./channel.ts";
import { CONTRACT, epochNow } from "./protocol.ts";
import type { LeaseReceiptDetail, StreamRecord, TimingOptions, UncertainWrite } from "./protocol.ts";

/** The frozen receipt plus this adapter's boundary detail (preserved in agent.response). */
export interface IsolatedLeaseReceipt extends DecisionLeaseReceipt {
  boundary: Omit<LeaseReceiptDetail, "leaseId" | "valid" | "reason" | "campaignRevision"> & { contract: typeof CONTRACT; childNonce?: string };
}
export interface DriverConfig {
  ledger: CampaignLedger;
  binding: ControlBinding;
  timing: TimingOptions;
  initialize: Record<string, unknown>;
}
const toFailure = (error: unknown, fallback: ToolFailure["outcome"] = "inconclusive"): ToolFailure =>
  error instanceof ToolFailure ? error : error instanceof ChannelFailure ? new ToolFailure(error.outcome, error.message)
    : new ToolFailure(fallback, error instanceof Error ? error.message : String(error));

export class IsolatedProcessDriver {
  readonly ledger: CampaignLedger;
  readonly binding: ControlBinding;
  readonly timing: TimingOptions;
  readonly operationTimeoutMs: number;
  readonly decisionLeases: DecisionLeaseControl;
  readonly controller: { execute(call: ToolCall, signal: AbortSignal, basedOnRevision?: number): Promise<{ message: string; evidenceRefs: string[]; value?: unknown }> };
  readonly simulationExit: SimulationExit;
  onFault?: (error: ToolFailure) => void;
  quarantined = false;
  failure?: ToolFailure;
  resetHeld = false;
  channel!: WonderProcessChannel;
  #config: DriverConfig;
  #listeners = new Set<() => void>();
  #lastImage: RawSignalImage = {};
  #lastSnapshot?: WorldSnapshot;
  #lastRefs: string[] = [];
  #lastConfirmedEpochMs = 0;
  #boundaryRevision = 0;
  #initialized = false;
  #initializing = false;
  #outputs: { seq: number; refs: string[] }[] = [];
  #coordinatorSequence = 0;
  #directSequence = 0;
  #boot?: string; #epoch?: string; #workstationSequence?: bigint;
  #actionIds = new Set<string>();
  #controllerEvents = new Map<string, { id: string; values: unknown }>();
  #leaseCount = 0;
  #leaseSignals = new Map<string, () => void>();
  #disposal?: Promise<unknown>;
  #observed?: readonly string[];

  constructor(config: DriverConfig) {
    this.#config = config; this.ledger = config.ledger; this.binding = config.binding; this.timing = config.timing;
    this.operationTimeoutMs = config.timing.operationTimeoutMs;
    this.decisionLeases = { begin: (policy, revision, signal) => this.#leaseBegin(policy, revision, signal), finish: receipt => this.#leaseFinish(receipt) };
    this.controller = { execute: (call, signal, revision) => this.#controller(call, signal, revision) };
    this.simulationExit = { exit: async signal => {
      if (signal.aborted) throw new Error("Exit cancelled before request");
      const reply = await this.channel.request<ConnectorObservation>("exit", {}, this.operationTimeoutMs * 2);
      if (signal.aborted) throw new Error("Exit completed after cancellation; inspect actual passthrough state");
      return reply.value;
    } };
  }
  /** Attach the channel; stream records start arriving immediately afterwards. */
  attach(channel: WonderProcessChannel): void { this.channel = channel; }
  /** PLC observations the loaded child world declares (plc_to_world). Set once from the child's load. */
  get observedOutputIds(): readonly string[] | undefined { return this.#observed; }
  declareObservedOutputs(ids: readonly string[]): void {
    if (this.#observed) throw new Error("Observed outputs are declared once by the loaded child");
    this.#observed = Object.freeze([...ids]);
  }
  get boundaryRevision(): number { return this.#boundaryRevision; }
  get lastImage(): RawSignalImage { return structuredClone(this.#lastImage); }
  get lastEvidenceRefs(): string[] { return [...this.#lastRefs]; }
  get evidenceAgeMs(): number { return Math.max(0, epochNow() - this.#lastConfirmedEpochMs); }
  get lastSnapshot(): WorldSnapshot | undefined { return structuredClone(this.#lastSnapshot); }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }

  async initialize(): Promise<void> {
    if (this.#initializing || this.#initialized) throw new Error("Driver is already initializing/initialized");
    this.#initializing = true;
    try {
      const reply = await this.channel.request<{ commitSeq: number; image: RawSignalImage; snapshot?: WorldSnapshot }>("initialize", this.#config.initialize, this.timing.initializeTimeoutMs + 5000);
      this.#lastImage = reply.value.image; this.#lastSnapshot = reply.value.snapshot; this.#lastConfirmedEpochMs = epochNow();
      this.#initialized = true;
    } catch (error) { const failure = toFailure(error); this.#quarantine(failure); throw failure; }
    finally { this.#initializing = false; }
  }
  start(automatic = true): void {
    if (this.quarantined || this.resetHeld) throw new ToolFailure("stale", "Driver requires a new campaign after quarantine/reset");
    this.channel.request("start", { automatic }, this.operationTimeoutMs).catch(error => this.#quarantine(toFailure(error, "stale")));
  }
  async hold(stopClock = false): Promise<void> {
    if (this.channel.exited) return;
    try { await this.channel.request("hold", { stopClock }, this.operationTimeoutMs * 2); }
    catch (error) { if (!this.channel.exited) this.#quarantine(toFailure(error)); }
  }
  /** Manual cadence (start(false)); the automatic child clock is the normal path. */
  async tick(): Promise<void> { await this.channel.request("tick", {}, this.operationTimeoutMs * 2); }

  apply(call: ToolCall, signal: AbortSignal, basedOnRevision?: number): Promise<string[]> {
    const refusal = this.#refuse(call, basedOnRevision);
    if (refusal) return Promise.reject(refusal);
    let control;
    try { control = this.binding.translate(call); } catch (error) { return Promise.reject(error); }
    const revision = basedOnRevision ?? this.ledger.state.revision;
    this.#actionIds.add(call.id);
    if (signal.aborted) return Promise.reject(new ToolFailure("inconclusive", "Control cancelled before it was sent; no world change"));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => { if (settled) return; settled = true; signal.removeEventListener("abort", abort); action(); };
      const abort = () => {
        this.channel.request<{ state: string }>("cancel", { actionId: call.id }, 5000).then(r => this.channel.journal({ kind: "cancel.result", actionId: call.id, state: r.value.state }), () => {});
        finish(() => reject(new ToolFailure("inconclusive", "Control cancelled; inspect ledger before retrying")));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.channel.request<{ appliedAtSeq: number }>("apply", { actionId: call.id, name: call.name, control, visibility: call.name.includes("fault") ? "truth" : "public",
        campaignRevision: revision, boundaryRevision: this.#boundaryRevision }, this.operationTimeoutMs * 3)
        .then(reply => finish(() => resolve(this.#refsAt(reply.value.appliedAtSeq))),
          error => { if (error instanceof ChannelFailure && error.outcome === "timed_out") this.#quarantine(toFailure(error)); finish(() => reject(toFailure(error))); });
    });
  }

  async reset(): Promise<string[]> {
    await this.hold(true);
    if (this.quarantined) throw new ToolFailure("stale", "Cannot reset a quarantined connector; reconcile the outstanding operation first");
    if (!this.#initialized) throw new ToolFailure("rejected", "Start simulation before resetting its image");
    let reply: Reply<{ commitSeq: number; image: RawSignalImage }>;
    try { reply = await this.channel.request("reset", {}, this.operationTimeoutMs * 3); }
    catch (error) { const failure = toFailure(error); if (failure.outcome === "timed_out") this.#quarantine(failure); throw failure; }
    const refs = this.#refsAt(reply.value.commitSeq);
    this.resetHeld = true;
    this.ledger.append("simulation.reset", { sourceId: refs[0], image: reply.value.image });
    return refs;
  }
  async exit(adapter: SimulationExit): Promise<void> {
    await this.hold(true);
    if (this.quarantined) throw new ToolFailure("stale", "Reconcile connector before selecting passthrough");
    const observation = await bounded(signal => adapter.exit(signal), this.operationTimeoutMs * 2, systemClock);
    if (observation.simulationApplied) throw new ToolFailure("inconclusive", "Passthrough not confirmed");
    this.ledger.append("simulation.exited", { reason: "Explicit Exit Simulation; passthrough observed" });
    this.ledger.append("connector.state", { state: "passthrough", reason: "Simulation deselected", ageMs: 0 });
    this.resetHeld = true;
  }

  dispose(reason = "Campaign session disposed"): Promise<unknown> {
    this.#disposal ??= (async () => {
      for (const off of this.#leaseSignals.values()) off();
      this.#leaseSignals.clear();
      return this.channel.close(reason, this.timing.drainMs + 10_000);
    })();
    return this.#disposal;
  }

  /** Ingest one ordered child record. Throwing marks a boundary integrity fault. */
  ingest(record: StreamRecord, seq: number): void {
    switch (record.kind) {
      case "source": {
        this.#checkSource(record.origin, record.event);
        const refs = appendCoordinatorEvent(this.ledger, record.event, record.origin);
        this.#lastRefs = refs;
        if (refs.length === 4) { this.#outputs.push({ seq, refs }); if (this.#outputs.length > 512) this.#outputs.shift(); }
        return;
      }
      case "world": this.ledger.append("world.evidence", { source: record.event }, "truth"); return;
      case "stimulus": this.ledger.append("world.stimulus", { actionId: record.actionId, control: record.control as unknown as Record<string, unknown> }, record.visibility); return;
      case "fresh": this.ledger.append("connector.state", { state: "fresh", reason: record.reason, ageMs: Math.max(0, record.ageMs) }); return;
      case "tick":
        this.#lastImage = record.image; if (record.snapshot) this.#lastSnapshot = record.snapshot;
        this.#lastConfirmedEpochMs = record.confirmedAtEpochMs;
        for (const listener of this.#listeners) listener();
        return;
      case "delayed": this.ledger.append("agent.activity", { phase: "coordinator_delayed", summary: `Coordinator overrun ${record.elapsedMs} ms; no catch-up burst` }); return;
      case "lease": this.channel?.journal({ kind: "lease.terminal", detail: record.detail }); return;
      case "hold":
        this.ledger.append("agent.activity", { phase: "isolated_hold", summary: record.reason });
        for (const listener of this.#listeners) listener();
        this.onFault?.(new ToolFailure("inconclusive", record.reason));
        return;
      case "fault": this.#quarantine(new ToolFailure(record.outcome, record.message), record.uncertainWrites); return;
      case "write":
        this.ledger.append("connector.state", { state: "quarantined", ageMs: record.heldMs,
          reason: `Timed-out write to ${record.paths.join(", ")} settled (${record.outcome}${record.message ? `: ${record.message}` : ""}) after ${record.heldMs} ms. Session stays quarantined; reconcile the physical state before any reuse`.slice(0, 8000) });
        return;
      case "controller":
        if (record.outcome === "applied") {
          const e = this.ledger.append("controller.action", { actionId: record.actionId, action: record.action, observation: record.observation! });
          this.#controllerEvents.set(record.actionId, { id: e.id, values: (record.observation as { values?: unknown }).values });
        }
        return;
    }
  }
  /** Boundary revision the child last reported (reply or record). */
  noteBoundary(revision: number): void { if (revision > this.#boundaryRevision) this.#boundaryRevision = revision; }
  integrityFault(message: string): void {
    this.#quarantine(new ToolFailure("stale", `Process boundary integrity fault: ${message}`));
    // Stop the child's world/connector loop: evidence can no longer be trusted end to end.
    this.channel.request("hold", { stopClock: true }, this.operationTimeoutMs * 2).catch(() => {});
  }
  childExited(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.#disposal) return;
    this.#quarantine(new ToolFailure("inconclusive", `Isolated child exited (${code ?? signal}); outstanding work and PLC write outcome are unknown. Runtime ownership stays held until explicitly reconciled`));
  }

  #refuse(call: ToolCall, basedOnRevision?: number): ToolFailure | undefined {
    if (this.quarantined || this.failure) return new ToolFailure("stale", "World is held or connector is quarantined");
    if (this.resetHeld) return new ToolFailure("stale", "Simulation reset or exited; start a new campaign");
    if (basedOnRevision !== undefined && basedOnRevision !== this.ledger.state.revision) return new ToolFailure("stale", "Campaign revision changed before the request was sent");
    if (this.#actionIds.has(call.id)) return new ToolFailure("rejected", `Duplicate action ID ${call.id}; not replayed`);
    return undefined;
  }
  async #controller(call: ToolCall, signal: AbortSignal, basedOnRevision?: number) {
    if (signal.aborted) throw new ToolFailure("inconclusive", "Cancelled before controller request");
    const refusal = this.#refuse(call, basedOnRevision);
    if (refusal) throw refusal;
    let action: "start" | "stop" | "reset" | "offer" | "completion_ack", parameters: Record<string, unknown> = {};
    if (call.name === "assign_route") {
      if (!/^[1-9][0-9]*$/.test(String(call.arguments.itemId)) || Number(call.arguments.itemId) > 0xffffffff) throw new ToolFailure("rejected", "M8 WCS item ID requires nonzero decimal UDINT");
      parameters = { itemId: Number(call.arguments.itemId), route: call.arguments.route === "A" ? 1 : call.arguments.route === "B" ? 2 : 0 }; action = "offer";
    } else if (call.name === "acknowledge_completion") { parameters = { sequence: call.arguments.sequence }; action = "completion_ack"; }
    else if (call.name === "operator_action" && ["start", "stop", "reset"].includes(String(call.arguments.action))) action = call.arguments.action as "start" | "stop" | "reset";
    else throw new ToolFailure("rejected", `No sequenced controller mapping for ${call.name}`);
    this.#actionIds.add(call.id);
    const revision = basedOnRevision ?? this.ledger.state.revision;
    const request = this.channel.request<{ recordSeq: number }>("controller", { actionId: call.id, name: call.name, action, parameters,
      campaignRevision: revision, boundaryRevision: this.#boundaryRevision }, this.operationTimeoutMs * 3);
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => {
        this.channel.request<{ state: string }>("cancel", { actionId: call.id }, 5000).then(r => this.channel.journal({ kind: "cancel.result", actionId: call.id, state: r.value.state }), () => {});
        reject(new ToolFailure("inconclusive", "Controller may have applied request; inspect acknowledgement before retrying"));
      };
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      await Promise.race([request, cancelled]);
      const event = this.#controllerEvents.get(call.id);
      if (!event) throw new ToolFailure("inconclusive", "Controller reply without its streamed acknowledgement; inspect the boundary journal");
      return { message: "PLC acknowledged sequenced operator/WCS request; world reacts to observed PLC commands on its next tick", evidenceRefs: [event.id], value: event.values };
    } catch (error) {
      if (error instanceof ChannelFailure && error.outcome === "timed_out") this.#quarantine(toFailure(error));
      throw toFailure(error);
    } finally { signal.removeEventListener("abort", abort); request.catch(() => {}); cancelled.catch(() => {}); }
  }

  async #leaseBegin(policy: DecisionLease, basedOnRevision: number, signal: AbortSignal): Promise<IsolatedLeaseReceipt> {
    const leaseId = `${this.ledger.campaignId}:lease:${++this.#leaseCount}`;
    if (this.quarantined) return this.#refused(leaseId, policy, basedOnRevision, `Session quarantined: ${this.failure?.message}`);
    try {
      const reply = await this.channel.request<LeaseReceiptDetail>("leaseBegin", { leaseId, policy, campaignRevision: basedOnRevision }, this.operationTimeoutMs);
      const receipt = this.#receipt(reply.value);
      if (receipt.valid) {
        // Model cancellation/timeout in this process interrupts the lease; the child then holds.
        const interrupt = () => { this.channel.request("leaseInterrupt", { leaseId, reason: "Model request cancelled or timed out in the parent" }, 5000).catch(() => {}); };
        signal.addEventListener("abort", interrupt, { once: true });
        this.#leaseSignals.set(leaseId, () => signal.removeEventListener("abort", interrupt));
        if (signal.aborted) interrupt();
      }
      return receipt;
    } catch (error) { return this.#refused(leaseId, policy, basedOnRevision, `Lease not established by the child: ${toFailure(error).message}`); }
  }
  async #leaseFinish(receipt: DecisionLeaseReceipt): Promise<IsolatedLeaseReceipt> {
    this.#leaseSignals.get(receipt.id)?.(); this.#leaseSignals.delete(receipt.id);
    try { return this.#receipt((await this.channel.request<LeaseReceiptDetail>("leaseFinish", { leaseId: receipt.id }, this.operationTimeoutMs)).value); }
    catch (error) {
      const base = receipt as Partial<IsolatedLeaseReceipt>;
      return { ...receipt, valid: false, evidenceRefs: [], reason: `Lease finish not confirmed by the child (${toFailure(error).message}); inspect the held world before any reuse`,
        boundary: { ...(base.boundary ?? { contract: CONTRACT, policy: { mode: "hold", timeoutMs: 1 }, boundaryRevision: this.#boundaryRevision, worldHeld: true, plcScanContinues: true }), state: "interrupted" } };
    }
  }
  #receipt(d: LeaseReceiptDetail): IsolatedLeaseReceipt {
    const output = d.basisSeq ? this.#refsAt(d.basisSeq)[3] : undefined;
    return { id: d.leaseId, basedOnRevision: d.campaignRevision, valid: d.valid, reason: d.reason, evidenceRefs: output ? [output] : [],
      boundary: { contract: CONTRACT, childNonce: this.channel.identity?.nonce, state: d.state, policy: d.policy, boundaryRevision: d.boundaryRevision,
        ...(d.basisSeq ? { basisSeq: d.basisSeq } : {}), ...(d.beganAtIso ? { beganAtIso: d.beganAtIso } : {}), ...(d.terminalAtIso ? { terminalAtIso: d.terminalAtIso } : {}),
        ...(d.elapsedMs !== undefined ? { elapsedMs: d.elapsedMs } : {}), worldHeld: d.worldHeld, plcScanContinues: true } };
  }
  #refused(leaseId: string, policy: DecisionLease, revision: number, reason: string): IsolatedLeaseReceipt {
    return { id: leaseId, basedOnRevision: revision, valid: false, reason, evidenceRefs: [],
      boundary: { contract: CONTRACT, childNonce: this.channel?.identity?.nonce, state: "refused", policy, boundaryRevision: this.#boundaryRevision, worldHeld: true, plcScanContinues: true } };
  }
  /** Evidence chain [source, image, ack, output] of the confirmed commit at or before seq. */
  #refsAt(seq: number): string[] {
    for (let i = this.#outputs.length - 1; i >= 0; i--) if (this.#outputs[i].seq <= seq) return [...this.#outputs[i].refs];
    return [...this.#lastRefs];
  }
  #checkSource(origin: string, e: CoordinatorEvent): void {
    if (origin === "live-coordinator") {
      if (e.sequence !== this.#coordinatorSequence + 1) throw new Error(`Coordinator source sequence gap: expected ${this.#coordinatorSequence + 1}, received ${e.sequence}`);
      this.#coordinatorSequence = e.sequence;
    } else {
      if (!(e.sequence > this.#directSequence)) throw new Error(`Direct commit sequence did not advance (${e.sequence})`);
      this.#directSequence = e.sequence;
    }
    if (e.lane !== "connector" || e.data.action !== "commit.acknowledged") return;
    const boot = String(e.data.bootIdentity), epoch = String(e.data.workstationEpoch), sequence = BigInt(String(e.data.workstationSequence));
    if (this.#boot !== undefined && boot !== this.#boot) throw new Error("PLC boot identity changed in the source stream");
    if (this.#epoch !== undefined && epoch !== this.#epoch) throw new Error("Workstation epoch changed within the session");
    if (this.#workstationSequence !== undefined && sequence <= this.#workstationSequence) throw new Error("Workstation commit sequence did not advance");
    this.#boot = boot; this.#epoch = epoch; this.#workstationSequence = sequence;
  }
  #quarantine(failure: ToolFailure, uncertain: UncertainWrite[] = []): void {
    if (this.quarantined) return;
    this.quarantined = true; this.failure = failure;
    const writes = uncertain.length ? ` Uncertain writes: ${uncertain.map(w => `${w.paths.join("+")} (${w.ageMs} ms)`).join("; ")}.` : "";
    try {
      this.ledger.append("connector.state", { state: failure.outcome === "stale" ? "stale" : "quarantined", ageMs: this.operationTimeoutMs,
        reason: `${failure.message}; last confirmed image retained. An outstanding transport operation may still complete; reconcile before reuse.${writes}`.slice(0, 8000) });
    } catch { /* ledger closed by the host */ }
    for (const listener of this.#listeners) listener();
    this.onFault?.(failure);
  }
}
