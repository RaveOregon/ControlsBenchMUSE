// Child-side owner of world time, the 10 Hz connector cadence, interventions and reasoning
// leases. It reuses the proven LiveWorldCoordinator/connector pair and the in-process driver's
// tick semantics (src/campaign/driver.ts), but keeps no campaign ledger: every original
// coordinator/world record is streamed, in order, to the host's single authoritative ledger.
// All deadlines use this process's monotonic clock, so a stalled parent cannot extend them.
import { LiveWorldCoordinator } from "../coordinator.ts";
import type { CommitReceipt, ConnectorObservation, RawSignalImage } from "../connector.ts";
import type { WorldSnapshot } from "../../proof/contracts.ts";
import type { DecisionLease } from "../../campaign/contracts.ts";
import { bounded, DeadlineError, systemClock } from "../../campaign/clock.ts";
import { CADENCE_MS, MAXIMUM_STEP_MS, epochNow } from "./protocol.ts";
import type { ApplyRequest, ControllerRequest, FailureOutcome, HoldCause, InterventionRequest, LeaseReceiptDetail, StreamRecord, TimingOptions, UncertainWrite } from "./protocol.ts";

export class ProcessRefusal extends Error {
  readonly outcome: FailureOutcome;
  constructor(outcome: FailureOutcome, message: string) { super(message); this.outcome = outcome; }
}
export interface ControllerPort {
  action(action: ControllerRequest["action"], parameters: Record<string, unknown>, actionId: string): Promise<ConnectorObservation>;
  exitSimulation(): Promise<ConnectorObservation>;
}
export interface EngineHooks {
  /** Sends one ordered stream record and returns its seq. */
  emit(record: StreamRecord): number;
  /** Called once, first thing, when the session quarantines: refuse every later write. */
  onQuarantine(reason: string): void;
  uncertainWrites(): UncertainWrite[];
  writesDrained(timeoutMs: number): Promise<boolean>;
  /** Close the raw transport without waiting for the connector queue (undrained work). */
  abandon(): Promise<void>;
}
interface Pending { request: ApplyRequest; resolve: (value: { appliedAtSeq: number }) => void; reject: (error: unknown) => void; cancelled: boolean; applied: boolean; done: boolean }
interface Lease { detail: LeaseReceiptDetail; beganAtMs: number; deadlineAtMs: number; timer?: ReturnType<typeof setTimeout>; finished: boolean }

const PLC_CONTINUES = "PLC scan and timers continue; the unchanged complete image is re-committed every 100 ms without advancing world time";
const clock = systemClock;

export class ProcessEngine {
  readonly coordinator: LiveWorldCoordinator;
  readonly controller?: ControllerPort;
  readonly timing: TimingOptions;
  readonly observedOutputIds: readonly string[];
  readonly hooks: EngineHooks;
  boundaryRevision = 0;
  running = false;
  quarantined = false;
  resetHeld = false;
  initialized = false;
  failure?: ProcessRefusal;
  #auto = false;
  #stopped = false;
  #timer?: ReturnType<typeof setTimeout>;
  #nextDeadline = 0;
  #busy?: Promise<void>;
  #pending: Pending[] = [];
  #inTick: Pending[] = [];
  #sourceCursor = 0; #worldCursor = 0; #syntheticSequence = 1_000_000_000;
  #lastImage: RawSignalImage = {};
  #lastValues: Record<string, unknown> = {};
  #lastSnapshot?: WorldSnapshot;
  #boot?: string; #epoch?: string; #sequence?: bigint;
  #lastConfirmedEpochMs = 0;
  #lastWorldStepAtMs = 0;
  #lastCommitSeq = 0;
  #hold?: HoldCause;
  #lease?: Lease;
  #leaseIds = new Set<string>();
  #actions = new Map<string, string>();
  #controllers = new Map<string, { cancelled: boolean }>();
  #maxCampaignRevision = 0;
  #lastParentAtMs = performance.now();

  constructor(coordinator: LiveWorldCoordinator, hooks: EngineHooks, options: { timing: TimingOptions; observedOutputIds: readonly string[]; controller?: ControllerPort }) {
    this.coordinator = coordinator; this.hooks = hooks; this.timing = options.timing;
    this.observedOutputIds = options.observedOutputIds; this.controller = options.controller;
  }
  get connector() { return this.coordinator.connector; }
  get held(): HoldCause | undefined { return this.running ? this.#hold : "campaign.hold"; }

  /** Any parent message: proves liveness and carries the newest campaign revision it has seen. */
  noteParent(knownCampaignRevision?: unknown): void {
    this.#lastParentAtMs = performance.now();
    if (Number.isSafeInteger(knownCampaignRevision) && (knownCampaignRevision as number) > this.#maxCampaignRevision) this.#maxCampaignRevision = knownCampaignRevision as number;
  }

  async initialize(): Promise<{ commitSeq: number; image: RawSignalImage; snapshot?: WorldSnapshot }> {
    if (this.#busy || this.initialized || this.#stopped) throw new ProcessRefusal("rejected", "Child session is already initializing, initialized or closed");
    this.#busy = (async () => {
      try {
        const receipt = await bounded(() => this.coordinator.initialize(), this.timing.initializeTimeoutMs, clock);
        this.#acceptReceipt(receipt); this.#flush();
        this.#lastSnapshot = await bounded(() => this.coordinator.world.snapshot(this.coordinator.context), this.timing.operationTimeoutMs, clock);
        this.initialized = true; this.boundaryRevision++;
      } catch (error) { throw this.#fault(error); }
    })();
    try { await this.#busy; } finally { this.#busy = undefined; }
    return { commitSeq: this.#lastCommitSeq, image: structuredClone(this.#lastImage), ...(this.#lastSnapshot ? { snapshot: structuredClone(this.#lastSnapshot) } : {}) };
  }

  start(automatic: boolean): { boundaryRevision: number } {
    if (this.quarantined || this.resetHeld || this.#stopped) throw new ProcessRefusal("stale", "Child session requires a new campaign after quarantine, reset, exit or close");
    if (!this.initialized) throw new ProcessRefusal("rejected", "Initialize before start");
    if (this.#lease && !this.#lease.finished) {
      if (this.#lease.detail.state === "active") this.#terminate(this.#lease, "interrupted", "Campaign start/resume superseded an open reasoning lease");
      this.#lease.finished = true;
    }
    this.running = true; this.#auto = automatic; this.#hold = undefined;
    this.#lastWorldStepAtMs = clock.now(); this.#lastParentAtMs = performance.now(); this.boundaryRevision++;
    if (automatic) { this.#nextDeadline = clock.now() + CADENCE_MS; this.#schedule(); }
    return { boundaryRevision: this.boundaryRevision };
  }

  async hold(stopClock = false): Promise<{ boundaryRevision: number }> {
    if (this.running) this.boundaryRevision++;
    this.running = false;
    for (const p of this.#pending.splice(0)) this.#reject(p, new ProcessRefusal("inconclusive", "Campaign held before control application"));
    if (this.#lease && !this.#lease.finished && this.#lease.detail.state === "active") this.#terminate(this.#lease, "interrupted", "Campaign hold during the reasoning lease");
    if (stopClock) { this.#auto = false; if (this.#timer !== undefined) clearTimeout(this.#timer); this.#timer = undefined; }
    try { await this.#busy; } catch { /* a failed tick is already recorded */ }
    return { boundaryRevision: this.boundaryRevision };
  }

  async tick(): Promise<void> {
    if (this.#busy || this.quarantined || this.#stopped) return;
    this.#busy = this.#tick();
    try { await this.#busy; } finally { this.#busy = undefined; }
  }

  async #tick(): Promise<void> {
    const began = clock.now();
    this.#watchParent();
    this.#checkDeadline();
    const selected = this.#advancing() ? this.#pending.splice(0) : [];
    this.#inTick = selected;
    let advanced = false, stepMs: number | undefined;
    try {
      await bounded(async () => {
        const observation = this.connector.inspectLink ? await this.connector.inspectLink() : await this.connector.observe();
        if (this.quarantined) throw new ProcessRefusal("stale", "Late connector response ignored after quarantine");
        this.#fresh(observation);
        for (const p of selected) {
          if (p.cancelled || !this.#advancing()) { this.#reject(p, new ProcessRefusal("inconclusive", "Cancelled or held before application")); continue; }
          this.hooks.emit({ kind: "stimulus", actionId: p.request.actionId, control: structuredClone(p.request.control), visibility: p.request.visibility,
            campaignRevision: p.request.campaignRevision, boundaryRevision: this.boundaryRevision });
          await this.coordinator.control(p.request.control);
          p.applied = true;
          if (this.quarantined) throw new ProcessRefusal("stale", "Late world control response ignored after quarantine");
        }
        advanced = this.#advancing();
        // Holding re-commits the unchanged complete image without advancing world time.
        const now = clock.now(), delta = now - this.#lastWorldStepAtMs;
        if (advanced && (!Number.isFinite(delta) || delta <= 0 || delta > MAXIMUM_STEP_MS))
          throw new ProcessRefusal("inconclusive", `World step gap ${Math.round(delta)} ms exceeds the declared ${MAXIMUM_STEP_MS} ms observation bound; world not advanced`);
        const receipt = advanced ? await this.coordinator.step(delta) : await this.connector.commit(this.#lastImage);
        if (advanced) { this.#lastWorldStepAtMs = now; stepMs = delta; }
        if (this.quarantined) throw new ProcessRefusal("stale", "Late commit ignored after quarantine; reconcile physical state");
        this.#acceptReceipt(receipt);
        if (advanced) this.#flush(); else this.#recordDirectCommit(receipt, this.held ?? "campaign.hold");
        if (advanced) this.#lastSnapshot = await this.coordinator.world.snapshot(this.coordinator.context);
      }, this.timing.operationTimeoutMs, clock);
    } catch (error) {
      this.#inTick = [];
      const failure = this.#fault(error);
      for (const p of selected) if (!p.done) this.#reject(p, failure);
      return;
    }
    this.#inTick = [];
    if (selected.some(p => p.applied)) this.boundaryRevision++;
    this.hooks.emit({ kind: "tick", advanced, ...(advanced ? {} : { held: this.held ?? "campaign.hold" }), boundaryRevision: this.boundaryRevision,
      image: structuredClone(this.#lastImage), ...(advanced && this.#lastSnapshot ? { snapshot: structuredClone(this.#lastSnapshot) } : {}),
      confirmedAtEpochMs: this.#lastConfirmedEpochMs, worldTimeMs: this.coordinator.context.time.nowMs,
      ...(stepMs !== undefined ? { stepMs: Math.round(stepMs * 1000) / 1000 } : {}), tickMs: Math.round((clock.now() - began) * 1000) / 1000, commitSeq: this.#lastCommitSeq });
    for (const p of selected) if (p.applied && !p.done) { p.done = true; p.resolve({ appliedAtSeq: this.#lastCommitSeq }); }
    this.#checkCondition();
    this.#checkDeadline();
  }

  #schedule(): void {
    if (!this.#auto || this.#timer !== undefined || this.#stopped) return;
    const due = this.#nextDeadline;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      const startedAt = clock.now();
      void this.tick().finally(() => {
        const finishedAt = clock.now(), elapsed = finishedAt - due;
        // Space actual starts by at least one period. A slow I/O tick already
        // consumed that period: do not add another idle period after it. There
        // is no queue of missed ticks or replay of stale frames to catch up.
        this.#nextDeadline = Math.max(startedAt + CADENCE_MS, finishedAt);
        if (finishedAt >= startedAt + CADENCE_MS) {
          if (!this.quarantined && !this.#stopped) this.hooks.emit({ kind: "delayed", elapsedMs: Math.round(elapsed) });
        }
        this.#schedule();
      });
    }, Math.max(0, due - clock.now()));
  }

  apply(request: ApplyRequest): Promise<{ appliedAtSeq: number }> {
    this.#admit(request, "apply");
    if (!this.coordinator.world.manifest.controls.some(c => c.id === request.control.id)) throw new ProcessRefusal("rejected", `World does not declare ${request.control.id}`);
    return new Promise((resolve, reject) => {
      this.#pending.push({ request: structuredClone(request), resolve, reject, cancelled: false, applied: false, done: false });
    });
  }

  /** Cancels a control that has not reached a tick. A control already applying is reported, never undone. */
  cancel(actionId: string): { actionId: string; state: string } {
    const pending = this.#pending.find(p => p.request.actionId === actionId);
    if (pending) {
      this.#pending = this.#pending.filter(p => p !== pending);
      this.#reject(pending, new ProcessRefusal("inconclusive", "Control cancelled before application; no world change"));
      return { actionId, state: "cancelled_before_application" };
    }
    const inTick = this.#inTick.find(p => p.request.actionId === actionId);
    if (inTick) {
      if (!inTick.applied) { inTick.cancelled = true; return { actionId, state: "cancel_requested_before_application" }; }
      return { actionId, state: "applied_before_cancellation" };
    }
    const controller = this.#controllers.get(actionId);
    if (controller) { controller.cancelled = true; return { actionId, state: "controller_in_flight_outcome_pending" }; }
    return { actionId, state: this.#actions.get(actionId) ?? "unknown" };
  }

  async controllerAction(request: ControllerRequest): Promise<{ recordSeq: number; boundaryRevision: number }> {
    this.#admit(request, "controller");
    if (!this.controller) throw new ProcessRefusal("rejected", "No sequenced controller adapter in this child");
    if (this.#controllers.size) throw new ProcessRefusal("rejected", "Another controller request is in flight");
    const entry = { cancelled: false };
    this.#controllers.set(request.actionId, entry);
    try {
      const observation = await bounded(() => this.controller!.action(request.action, request.parameters, request.actionId), this.timing.operationTimeoutMs, clock);
      this.#actions.set(request.actionId, "controller_applied");
      this.boundaryRevision++;
      const recordSeq = this.hooks.emit({ kind: "controller", actionId: request.actionId, action: request.action, outcome: "applied",
        observation: structuredClone(observation) as unknown as Record<string, unknown>, afterCancellation: entry.cancelled });
      return { recordSeq, boundaryRevision: this.boundaryRevision };
    } catch (error) {
      this.#actions.set(request.actionId, "controller_failed");
      const message = error instanceof Error ? error.message : String(error);
      this.hooks.emit({ kind: "controller", actionId: request.actionId, action: request.action, outcome: "failed", message, afterCancellation: entry.cancelled });
      // The M8 connector poisons itself on any failed request; make that quarantine explicit now.
      throw this.#fault(error instanceof DeadlineError ? error : new ProcessRefusal("inconclusive", `Controller ${request.action} failed: ${message}; connector quarantined, no retry`));
    } finally { this.#controllers.delete(request.actionId); }
  }

  leaseBegin(args: { leaseId: string; policy: DecisionLease; campaignRevision: number }): LeaseReceiptDetail {
    const { leaseId, policy, campaignRevision } = args;
    const refused = (reason: string): LeaseReceiptDetail => ({ leaseId, state: "refused", valid: false, reason, policy, campaignRevision,
      boundaryRevision: this.boundaryRevision, ...(this.#lastCommitSeq ? { basisSeq: this.#lastCommitSeq } : {}), worldHeld: !!this.held, plcScanContinues: true });
    if (typeof leaseId !== "string" || !leaseId || this.#leaseIds.has(leaseId)) return refused("Duplicate or missing lease ID; nothing re-applied");
    this.#leaseIds.add(leaseId);
    if (!policy || !["hold", "continue", "condition_deadline"].includes(policy.mode) || !Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 1 || policy.timeoutMs > 300_000
      || (policy.mode === "condition_deadline") !== !!policy.condition) return refused("Invalid lease policy");
    if (policy.condition && !this.observedOutputIds.includes(policy.condition.signal)) return refused(`Lease condition ${policy.condition.signal} is not a declared PLC observation`);
    if (this.quarantined) return refused(`Session quarantined: ${this.failure?.message}`);
    if (!this.running || this.resetHeld || this.#stopped) return refused("Campaign world is held; no reasoning lease");
    if (this.#hold) return refused(`World held by ${this.#hold}; resume before reasoning`);
    if (this.#lease && !this.#lease.finished) return refused(`Lease ${this.#lease.detail.leaseId} is still open`);
    if (!Number.isSafeInteger(campaignRevision) || campaignRevision < this.#maxCampaignRevision) return refused(`Campaign revision ${campaignRevision} is older than ${this.#maxCampaignRevision}`);
    this.#maxCampaignRevision = campaignRevision;
    const beganAtMs = clock.now();
    const lease: Lease = { beganAtMs, deadlineAtMs: beganAtMs + policy.timeoutMs, finished: false, detail: { leaseId, state: "active", valid: true,
      reason: policy.mode === "hold" ? `World/image held for reasoning (deadline ${policy.timeoutMs} ms); ${PLC_CONTINUES}`
        : policy.mode === "continue" ? `World continues during reasoning for at most ${policy.timeoutMs} ms, then holds`
          : `World continues until ${policy.condition!.signal} = ${JSON.stringify(policy.condition!.equals)} or ${policy.timeoutMs} ms, then holds`,
      policy: structuredClone(policy), campaignRevision, boundaryRevision: this.boundaryRevision, basisSeq: this.#lastCommitSeq,
      beganAtIso: new Date().toISOString(), worldHeld: policy.mode === "hold", plcScanContinues: true } };
    if (policy.mode === "hold") { this.#hold = `lease.hold:${leaseId}`; this.boundaryRevision++; lease.detail.boundaryRevision = this.boundaryRevision; }
    this.#lease = lease;
    this.#checkDeadline();
    this.#checkCondition();
    return structuredClone(lease.detail);
  }

  leaseInterrupt(args: { leaseId: string; reason?: string }): LeaseReceiptDetail | { leaseId: string; state: "unknown" } {
    const lease = this.#lease;
    if (!lease || lease.detail.leaseId !== args.leaseId) return { leaseId: args.leaseId, state: "unknown" };
    if (lease.detail.state === "active") this.#terminate(lease, "interrupted", `Interrupted: ${String(args.reason ?? "parent request cancelled")}`);
    return structuredClone(lease.detail);
  }

  leaseFinish(args: { leaseId: string }): LeaseReceiptDetail {
    const lease = this.#lease;
    if (!lease || lease.detail.leaseId !== args.leaseId) return { leaseId: String(args.leaseId), state: "refused", valid: false, reason: "Unknown or superseded lease",
      policy: { mode: "hold", timeoutMs: 1 }, campaignRevision: this.#maxCampaignRevision, boundaryRevision: this.boundaryRevision, worldHeld: !!this.held, plcScanContinues: true };
    if (lease.finished) return { ...structuredClone(lease.detail), valid: false, reason: `Lease already finished (${lease.detail.state}); not re-released` };
    this.#checkDeadline();
    if (lease.detail.state === "active" && (this.quarantined || !this.running)) this.#terminate(lease, "interrupted", "Campaign held or quarantined before the decision returned");
    lease.finished = true; if (lease.timer) clearTimeout(lease.timer);
    if (lease.detail.state === "active") {
      const d = lease.detail;
      d.state = "released"; d.terminalAtIso = new Date().toISOString(); d.elapsedMs = Math.round(clock.now() - lease.beganAtMs);
      d.basisSeq = this.#lastCommitSeq;
      if (this.#hold === `lease.hold:${d.leaseId}`) { this.#hold = undefined; this.#lastWorldStepAtMs = clock.now(); this.boundaryRevision++; }
      d.boundaryRevision = this.boundaryRevision; d.worldHeld = !!this.held;
      d.reason = `Decision returned within the ${d.policy.mode} lease after ${d.elapsedMs} ms; world ${d.policy.mode === "hold" ? "released from hold" : "still running"}`;
    }
    return structuredClone(lease.detail);
  }

  async reset(): Promise<{ commitSeq: number; image: RawSignalImage }> {
    await this.hold(true);
    if (this.quarantined) throw new ProcessRefusal("stale", "Cannot reset a quarantined connector; reconcile the outstanding operation first");
    if (!this.initialized) throw new ProcessRefusal("rejected", "Start simulation before resetting its image");
    const zero = Object.fromEntries(this.coordinator.world.manifest.signals.filter(s => s.direction === "world_to_plc")
      .map(s => [s.id, s.dataType === "BOOL" ? false : s.dataType === "STRING" ? "" : 0]));
    try {
      const receipt = await bounded(() => this.connector.commit(zero), this.timing.operationTimeoutMs, clock);
      this.#acceptReceipt(receipt); this.#recordDirectCommit(receipt, "campaign.reset");
      this.resetHeld = true; this.boundaryRevision++;
      return { commitSeq: this.#lastCommitSeq, image: structuredClone(receipt.image) };
    } catch (error) { throw this.#fault(error); }
  }

  async exit(): Promise<ConnectorObservation> {
    await this.hold(true);
    if (this.quarantined) throw new ProcessRefusal("stale", "Reconcile connector before selecting passthrough");
    if (!this.controller) throw new ProcessRefusal("rejected", "No passthrough adapter in this child");
    try {
      const observation = await bounded(() => this.controller!.exitSimulation(), this.timing.operationTimeoutMs, clock);
      this.resetHeld = true; this.boundaryRevision++;
      return observation;
    } catch (error) { throw this.#fault(error); }
  }

  /** Stop, drain bounded outstanding work, then close the session. Never resets or exits simulation. */
  async close(reason: string): Promise<{ drained: boolean; closed: boolean; uncertainWrites: UncertainWrite[] }> {
    const deadline = performance.now() + this.timing.drainMs;
    const remaining = () => Math.max(0, deadline - performance.now());
    this.#stopped = true; this.running = false; this.#auto = false;
    if (this.#timer !== undefined) clearTimeout(this.#timer); this.#timer = undefined;
    for (const p of this.#pending.splice(0)) this.#reject(p, new ProcessRefusal("inconclusive", "Session closing before control application"));
    if (this.#lease && this.#lease.detail.state === "active") this.#terminate(this.#lease, "interrupted", `Session closing: ${reason}`);
    const tickSettled = await Promise.race([Promise.resolve(this.#busy).then(() => true, () => true), new Promise<boolean>(r => setTimeout(() => r(false), remaining()))]);
    const writesDrained = await this.hooks.writesDrained(remaining());
    const uncertainWrites = this.hooks.uncertainWrites();
    let closed = false;
    if (tickSettled && writesDrained && !this.#controllers.size) {
      try { await bounded(() => this.coordinator.close(reason), Math.max(1, remaining()), clock); closed = true; this.#flush(); } catch { closed = false; }
    }
    if (!closed) { try { await this.hooks.abandon(); } catch { /* transport already gone */ } }
    return { drained: tickSettled && writesDrained && !this.#controllers.size, closed, uncertainWrites };
  }

  /** Parent-loss hold: freeze world time immediately; the launcher then drains and closes. */
  parentLost(): void {
    if (this.running && !this.#hold) { this.#hold = "parent.lost"; this.boundaryRevision++; }
    for (const p of this.#pending.splice(0)) this.#reject(p, new ProcessRefusal("inconclusive", "Parent lost before control application"));
    if (this.#lease && this.#lease.detail.state === "active") this.#terminate(this.#lease, "interrupted", "Parent process lost");
  }

  status() {
    return { boundaryRevision: this.boundaryRevision, running: this.running, held: this.held ?? null, quarantined: this.quarantined, resetHeld: this.resetHeld,
      initialized: this.initialized, pending: this.#pending.length, controllerInFlight: this.#controllers.size, maxCampaignRevision: this.#maxCampaignRevision,
      lease: this.#lease ? structuredClone(this.#lease.detail) : null, lastCommitSeq: this.#lastCommitSeq, worldTimeMs: this.coordinator.context.time.nowMs,
      failure: this.failure ? { outcome: this.failure.outcome, message: this.failure.message } : null };
  }

  #advancing(): boolean { return this.running && !this.#hold && !this.quarantined && !this.#stopped; }

  #admit(request: InterventionRequest, op: "apply" | "controller"): void {
    if (typeof request.actionId !== "string" || !request.actionId) throw new ProcessRefusal("rejected", "Intervention requires its original action ID");
    const previous = this.#actions.get(request.actionId);
    if (previous) throw new ProcessRefusal("rejected", `Duplicate action ID ${request.actionId} (${previous}); not replayed`);
    this.#actions.set(request.actionId, `${op}_received`);
    const stale = (message: string) => { this.#actions.set(request.actionId, `${op}_refused_stale`); return new ProcessRefusal("stale", message); };
    if (!Number.isSafeInteger(request.campaignRevision) || request.campaignRevision < this.#maxCampaignRevision)
      throw stale(`Campaign revision ${request.campaignRevision} is older than ${this.#maxCampaignRevision}; intervention not applied`);
    if (request.boundaryRevision !== this.boundaryRevision) throw stale(`Child boundary revision is ${this.boundaryRevision}, not ${request.boundaryRevision}; intervention not applied`);
    if (this.quarantined) throw stale(`Connector quarantined: ${this.failure?.message}`);
    if (this.resetHeld || this.#stopped) throw stale("Simulation reset, exited or closed; start a new campaign");
    if (!this.running) throw stale("World is held or connector is quarantined");
    if (this.#hold) throw stale(`World is held (${this.#hold})`);
    if (this.#lease && !this.#lease.finished) throw stale(`Reasoning lease ${this.#lease.detail.leaseId} is open; interventions wait for its receipt`);
    this.#maxCampaignRevision = request.campaignRevision;
  }

  #terminate(lease: Lease, state: "expired" | "condition_met" | "interrupted", reason: string): void {
    if (lease.detail.state !== "active") return;
    const d = lease.detail;
    d.state = state; d.valid = false; d.terminalAtIso = new Date().toISOString(); d.elapsedMs = Math.round(clock.now() - lease.beganAtMs);
    d.basisSeq = this.#lastCommitSeq;
    if (this.running && !this.#hold) { this.#hold = `lease.hold:${d.leaseId}`; }
    this.boundaryRevision++;
    d.boundaryRevision = this.boundaryRevision; d.worldHeld = true;
    d.reason = `${reason}; world/image held at child +${d.elapsedMs} ms; ${PLC_CONTINUES}`;
    if (lease.timer) clearTimeout(lease.timer);
    this.hooks.emit({ kind: "lease", detail: structuredClone(d) });
  }
  #checkDeadline(): void {
    const lease = this.#lease;
    if (lease && !lease.finished && lease.detail.state === "active" && clock.now() >= lease.deadlineAtMs)
      this.#terminate(lease, "expired", `Lease deadline ${lease.detail.policy.timeoutMs} ms reached before the decision returned`);
    else if (lease && !lease.finished && lease.detail.state === "active" && lease.timer === undefined)
      lease.timer = setTimeout(() => { lease.timer = undefined; this.#checkDeadline(); }, Math.max(1, Math.ceil(lease.deadlineAtMs - clock.now())));
  }
  #checkCondition(): void {
    const lease = this.#lease, condition = lease?.detail.policy.condition;
    if (!lease || lease.finished || lease.detail.state !== "active" || !condition || !this.#lastCommitSeq) return;
    if (Object.hasOwn(this.#lastValues, condition.signal) && this.#lastValues[condition.signal] === condition.equals)
      this.#terminate(lease, "condition_met", `Condition ${condition.signal} = ${JSON.stringify(condition.equals)} observed in the confirmed commit`);
  }
  #watchParent(): void {
    if (!this.running || this.#hold || performance.now() - this.#lastParentAtMs <= this.timing.parentSilenceMs) return;
    const silentMs = Math.round(performance.now() - this.#lastParentAtMs);
    this.#hold = "parent.silent"; this.boundaryRevision++;
    for (const p of this.#pending.splice(0)) this.#reject(p, new ProcessRefusal("inconclusive", "Parent unresponsive before control application"));
    if (this.#lease && !this.#lease.finished && this.#lease.detail.state === "active") this.#terminate(this.#lease, "interrupted", `Parent silent for ${silentMs} ms`);
    this.hooks.emit({ kind: "hold", cause: "parent.silent", reason: `No parent message for ${silentMs} ms (limit ${this.timing.parentSilenceMs} ms); world/image held; ${PLC_CONTINUES}. Engineer resume required.`, boundaryRevision: this.boundaryRevision });
  }
  #reject(p: Pending, error: unknown): void {
    if (p.done) return;
    p.done = true; this.#actions.set(p.request.actionId, "apply_not_applied"); p.reject(error);
  }
  #fresh(o: ConnectorObservation): void {
    const ageMs = clock.now() - o.observedAtMonotonicMs;
    if (o.connectorStale) throw new ProcessRefusal("stale", `PLC ConnectorStale=true at applied ${o.appliedEpoch}/${o.appliedSequence}`);
    if (!o.simulationApplied) throw new ProcessRefusal("stale", "PLC simulation is inactive");
    if (ageMs < 0 || ageMs > this.timing.operationTimeoutMs) throw new ProcessRefusal("stale", `Observation timestamp age ${ageMs} ms is invalid`);
    if (this.#boot && o.bootIdentity !== this.#boot) throw new ProcessRefusal("stale", "PLC boot identity changed");
    this.hooks.emit({ kind: "fresh", reason: "Observed simulation active under stable PLC boot", ageMs });
  }
  #acceptReceipt(receipt: CommitReceipt): void {
    this.#fresh(receipt);
    if (receipt.appliedEpoch !== receipt.workstationEpoch || receipt.appliedSequence !== receipt.workstationSequence
      || receipt.plcCycle !== receipt.outputCaptureCycle || (this.#epoch && receipt.workstationEpoch !== this.#epoch)
      || (this.#sequence !== undefined && BigInt(receipt.workstationSequence) <= this.#sequence)) throw new ProcessRefusal("stale", "PLC commit/capture correlation invalid");
    this.#boot = receipt.bootIdentity; this.#epoch = receipt.workstationEpoch; this.#sequence = BigInt(receipt.workstationSequence);
    this.#lastImage = structuredClone(receipt.image); this.#lastValues = structuredClone(receipt.values);
    this.#lastConfirmedEpochMs = epochNow();
  }
  #flush(): void {
    const events = this.coordinator.events;
    for (const event of events.slice(this.#sourceCursor)) {
      const seq = this.hooks.emit({ kind: "source", origin: "live-coordinator", event });
      if (event.lane === "connector" && event.data.action === "commit.acknowledged") this.#lastCommitSeq = seq;
    }
    this.#sourceCursor = events.length;
    const world = this.coordinator.context.events;
    for (const event of world.slice(this.#worldCursor)) this.hooks.emit({ kind: "world", event: event as unknown as Record<string, unknown> });
    this.#worldCursor = world.length;
  }
  #recordDirectCommit(r: CommitReceipt, cause: string): void {
    this.#lastCommitSeq = this.hooks.emit({ kind: "source", origin: "campaign-driver", event: { sequence: ++this.#syntheticSequence, atIso: r.acknowledgedAtIso,
      atMonotonicMs: r.acknowledgedAtMonotonicMs, lane: "connector", data: { action: "commit.acknowledged", cause,
        workstationEpoch: r.workstationEpoch, workstationSequence: r.workstationSequence, slot: r.slot, latencyMs: r.latencyMs,
        bootIdentity: r.bootIdentity, plcCycle: r.plcCycle, outputCaptureCycle: r.outputCaptureCycle, image: r.image, outputs: r.values,
        ...(r.outputQuality ? { outputQuality: r.outputQuality } : {}) } } });
  }
  #fault(error: unknown): ProcessRefusal {
    if (this.quarantined && this.failure) return this.failure;
    const failure = error instanceof ProcessRefusal ? error : new ProcessRefusal(error instanceof DeadlineError ? "timed_out" : "inconclusive", error instanceof Error ? error.message : String(error));
    this.quarantined = true; this.failure = failure;
    this.hooks.onQuarantine(failure.message);
    this.running = false; this.#auto = false;
    if (this.#timer !== undefined) clearTimeout(this.#timer); this.#timer = undefined;
    this.boundaryRevision++;
    for (const p of this.#pending.splice(0)) this.#reject(p, failure);
    if (this.#lease && !this.#lease.finished && this.#lease.detail.state === "active") this.#terminate(this.#lease, "interrupted", `Connector ${failure.outcome}: ${failure.message}`);
    this.hooks.emit({ kind: "fault", outcome: failure.outcome, message: failure.message, uncertainWrites: this.hooks.uncertainWrites(), boundaryRevision: this.boundaryRevision });
    return failure;
  }
}
