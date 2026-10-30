// Workspace state folded from MuseEvents plus engineer commands.
//
// The store is source-agnostic: replay and live sources push the same events. It refuses
// events whose provenance mode differs from the workspace mode so recorded evidence can
// never be shown as live (or the reverse).

import type { ActivityPhase, BudgetLimits, CheckStatus, EngineerCommand, MuseEvent, MuseEventBody, Provenance, RawValue, RuntimeFlagState, SourceClock, SourceMode, WorldRunInfo } from "./events.ts";
import { isMeaningful } from "./events.ts";
import { allPlannedChecks, defaultScope, type PlanCheck } from "./plan.ts";

export type CampaignPhase = "ready" | "running" | "paused" | "stopped" | "completed" | "budget_hold";

export interface CheckState extends PlanCheck {
  status: CheckStatus;
  summary?: string;
  evidence?: Record<string, unknown>;
  verdictEventId?: string;
  addedAtMs?: number;
}

export interface SignalDefinition {
  id: string;
  direction: "plc_to_world" | "world_to_plc";
  dataType: string;
  role: string;
  description: string;
}

export interface SignalValue {
  value: RawValue | undefined;
  atMs?: number;
  cause?: string;
  eventId?: string;
  run?: string;
  source?: string;
}

export interface FaultState {
  faultId: string;
  target: string;
  detail: string;
  sealed: boolean;
  atMs: number;
}

export interface WaitState {
  condition: string;
  startedAtMs: number;
  timeoutMs: number | null;
  checkId?: string;
}

export interface ModelCallState {
  requestId: string;
  purpose: string;
  model: string;
  startedAtMs: number;
  reservedUsd: number;
  timeoutMs: number;
  repairEpisode?: string;
  checkId?: string;
  endedAtMs?: number;
  status?: string;
  failed?: boolean;
  durationMs?: number;
  costUsd?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  note?: string;
}

export interface ConnectionState {
  transport?: string;
  endpoint?: string;
  securityMode?: string;
  securityPolicy?: string;
  identity?: string;
  serverProduct?: string;
  requestedPublishingIntervalMs?: number;
  publishingIntervalMs?: number;
  requestedSamplingIntervalMs?: number;
  samplingIntervalMs?: number;
  link: "none" | "up" | "lost" | "reconnecting" | "closed";
  linkDetail?: string;
  linkChangedAtMs?: number;
  epoch?: string;
  workstationSequence?: string;
  appliedSequence?: string;
  commits: number;
  acks: number;
  lastAckLatencyMs?: number | null;
  latencies: number[];
  bootIdentity?: string;
  previousBootIdentity?: string;
  bootChangedAtMs?: number;
  plcCycle?: string;
  lastPlcHeartbeatAtMs?: number;
  plcRestarting: boolean;
  plcRestartAtMs?: number;
  simulationRequested: boolean;
  simulationApplied: boolean | null;
  simulationDetail: string;
  cases: Array<{ name: string; accepted: boolean; expectedAccepted: boolean; detail: string; atMs: number }>;
  provenance?: Provenance;
}

export interface EpisodeState {
  episodeId: string;
  title: string;
  checkIds: string[];
  world?: WorldRunInfo;
  connectorExpected: boolean;
  plcExpected: boolean;
  worldExpected: boolean;
  timeScale: number;
  note?: string;
  startedAtMs: number;
  clock: SourceClock;
  source: string;
  eventId: string;
}

export interface WorkspaceState {
  mode: SourceMode;
  phase: CampaignPhase;
  startedAtMs?: number;
  endedAtMs?: number;
  finalized: boolean;
  scope: Record<string, boolean>;
  checks: Record<string, CheckState>;
  checkOrder: string[];
  signals: SignalDefinition[];
  inputs: Record<string, SignalValue>;
  outputs: Record<string, SignalValue & { origin?: string }>;
  entities: Record<string, { type: string; state: Record<string, unknown>; atMs: number }>;
  faults: Record<string, FaultState>;
  connection: ConnectionState;
  episode?: EpisodeState;
  step?: { phase: ActivityPhase; message: string; awaiting?: string; atMs: number; checkId?: string; eventId: string };
  waits: Record<string, WaitState>;
  runtimeFlag?: { state: RuntimeFlagState; message: string; elapsedMs?: number; atMs: number; exercise: boolean };
  world: { run?: string; version?: string; lastHeartbeatAtMs?: number; tick?: number };
  agent: { active?: ModelCallState; calls: ModelCallState[]; assessment?: { text: string; confidence?: number; hypotheses?: Array<{ label: string; confidence: number }>; atMs: number }; observations: number };
  budget: { limits?: BudgetLimits; spentUsd: number; reservedUsd: number; repairSpentUsd: Record<string, number>; failedRepairs: Record<string, number>; level: "normal" | "warning" | "hard_stop" };
  blind: { commitment?: string; sealedHash?: string; revealed?: Record<string, unknown> };
  hotReload: { activeVersion?: string; history: Array<{ phase: string; version: string; detail: string; atMs: number }> };
  suppressedOutputs: Record<string, boolean>;
  steering: Array<{ id: string; atMs: number; text: string }>;
  /** Bounded trace of every non-heartbeat event, dense streams included. */
  timeline: MuseEvent[];
  /** Bounded list of meaningful events that dense streams cannot evict. */
  keyEvents: MuseEvent[];
  verdicts: MuseEvent[];
  lastMeaningful?: { atMs: number; summary: string; eventId: string };
  eventCount: number;
}

export type CommandResult = { ok: true } | { ok: false; reason: string };

export class ModeMismatchError extends Error {
  constructor(expected: SourceMode, event: MuseEvent) {
    super(`Workspace is in ${expected} mode but event ${event.id} is labeled ${event.provenance.mode}`);
    this.name = "ModeMismatchError";
  }
}

const TIMELINE_LIMIT = 12_000;
const KEY_EVENT_LIMIT = 3_000;

/** High-rate records that stay in the trace but not in the key-event list. */
export function isDense(event: MuseEvent): boolean {
  return event.kind === "connector.commit" || event.kind === "connector.ack" || event.kind === "plc.heartbeat" || (event.kind === "raw.input" && typeof event.value !== "boolean");
}

function pushBounded(list: MuseEvent[], event: MuseEvent, limit: number): void {
  list.push(event);
  if (list.length > limit) list.splice(0, list.length - limit);
}
const LATENCY_WINDOW = 500;

function zeroValue(dataType: string): RawValue {
  if (dataType === "BOOL") return false;
  if (dataType === "STRING") return "";
  return 0;
}

export function createWorkspaceState(mode: SourceMode, signals: SignalDefinition[], scope: Record<string, boolean> = defaultScope()): WorkspaceState {
  const checks = Object.fromEntries(allPlannedChecks().map((check) => [check.id, { ...check, status: scope[check.id] ? "planned" : "out_of_scope" } as CheckState]));
  return {
    mode,
    phase: "ready",
    finalized: false,
    scope: { ...scope },
    checks,
    checkOrder: allPlannedChecks().map((check) => check.id),
    signals,
    inputs: {},
    outputs: {},
    entities: {},
    faults: {},
    connection: { link: "none", commits: 0, acks: 0, latencies: [], plcRestarting: false, simulationRequested: true, simulationApplied: null, simulationDetail: "Not yet reported by a PLC", cases: [] },
    waits: {},
    world: {},
    agent: { calls: [], observations: 0 },
    budget: { spentUsd: 0, reservedUsd: 0, repairSpentUsd: {}, failedRepairs: {}, level: "normal" },
    blind: {},
    hotReload: { history: [] },
    suppressedOutputs: {},
    steering: [],
    timeline: [],
    keyEvents: [],
    verdicts: [],
    eventCount: 0
  };
}

export class WorkspaceStore {
  state: WorkspaceState;
  #version = 0;
  #snapshot: { version: number; state: WorkspaceState };
  #listeners = new Set<() => void>();
  #localSequence = 0;

  constructor(mode: SourceMode, signals: SignalDefinition[], scope?: Record<string, boolean>) {
    this.state = createWorkspaceState(mode, signals, scope);
    this.#snapshot = { version: 0, state: this.state };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): { version: number; state: WorkspaceState } => this.#snapshot;

  #emit(): void {
    this.#version += 1;
    this.#snapshot = { version: this.#version, state: this.state };
    for (const listener of this.#listeners) listener();
  }

  /** Replace state for a fresh campaign while keeping scope, suppression, and simulation authority. */
  resetForNewCampaign(): void {
    const previous = this.state;
    const next = createWorkspaceState(previous.mode, previous.signals, previous.scope);
    next.suppressedOutputs = { ...previous.suppressedOutputs };
    next.connection.simulationRequested = previous.connection.simulationRequested;
    next.inputs = previous.inputs;
    this.state = next;
    this.#emit();
  }

  applyEvents(events: readonly MuseEvent[]): void {
    if (events.length === 0) return;
    for (const event of events) {
      if (event.provenance.mode !== this.state.mode) throw new ModeMismatchError(this.state.mode, event);
      this.#apply(event);
    }
    this.#emit();
  }

  // ------------------------------------------------------------ engineer commands

  can(command: EngineerCommand): CommandResult {
    const { phase } = this.state;
    const simulated = this.state.connection.simulationRequested;
    const deny = (reason: string): CommandResult => ({ ok: false, reason });
    switch (command) {
      case "start":
        if (phase === "running" || phase === "paused" || phase === "budget_hold") return deny("A campaign is already active.");
        if (!simulated) return deny("Enter simulation before starting a campaign.");
        if (!Object.values(this.state.scope).some(Boolean)) return deny("Select at least one check.");
        return { ok: true };
      case "pause":
        return phase === "running" ? { ok: true } : deny("Only a running campaign can pause.");
      case "resume":
        return phase === "paused" ? { ok: true } : deny("Only a paused campaign can resume.");
      case "stop":
        return phase === "running" || phase === "paused" || phase === "budget_hold" ? { ok: true } : deny("No active campaign to stop.");
      case "complete":
        return phase === "running" ? { ok: true } : deny("Only a running campaign can complete.");
      case "reset_simulation":
        if (!simulated) return deny("Reset applies to the simulated image; enter simulation first.");
        return phase === "running" || phase === "paused" || phase === "budget_hold" ? deny("Stop the campaign before resetting the simulated image.") : { ok: true };
      case "exit_simulation":
        if (!simulated) return deny("Already on hardware passthrough.");
        return phase === "running" || phase === "paused" || phase === "budget_hold" ? deny("Stop the campaign before returning authority to hardware.") : { ok: true };
      case "enter_simulation":
        return simulated ? deny("Simulation is already requested.") : { ok: true };
      case "suppress_output":
      case "release_output":
        return { ok: true };
    }
  }

  start(nowMs: number): CommandResult {
    const allowed = this.can("start");
    if (!allowed.ok) return allowed;
    if (this.state.phase !== "ready") this.resetForNewCampaign();
    const scoped = Object.entries(this.state.scope).filter(([, included]) => included).length;
    this.state.phase = "running";
    this.state.startedAtMs = nowMs;
    this.#local(nowMs, "start", `Start Campaign authorized ${scoped} checks. Muse may execute, inject simulated faults, and add investigations without per-check approval.`);
    return { ok: true };
  }

  pause(nowMs: number): CommandResult {
    return this.#transition("pause", "paused", nowMs, "Paused: world evolution frozen, current raw input image held. The PLC keeps scanning.");
  }

  resume(nowMs: number): CommandResult {
    return this.#transition("resume", "running", nowMs, "Resumed from held image.");
  }

  stop(nowMs: number): CommandResult {
    const allowed = this.can("stop");
    if (!allowed.ok) return allowed;
    this.state.phase = "stopped";
    this.#finalize(nowMs, "Stopped by engineer before a verdict");
    this.#local(nowMs, "stop", "Stopped: campaign activity ended, run record finalized, final raw image held for inspection.");
    return { ok: true };
  }

  complete(nowMs: number): CommandResult {
    const allowed = this.can("complete");
    if (!allowed.ok) return allowed;
    this.state.phase = "completed";
    this.#finalize(nowMs, "Campaign ended before a verdict");
    this.#local(nowMs, "complete", "Campaign complete: run record finalized and held for inspection.");
    return { ok: true };
  }

  resetSimulation(nowMs: number): CommandResult {
    const allowed = this.can("reset_simulation");
    if (!allowed.ok) return allowed;
    for (const signal of this.state.signals.filter((candidate) => candidate.direction === "world_to_plc")) {
      this.state.inputs[signal.id] = { value: zeroValue(signal.dataType), atMs: nowMs, cause: "Reset Simulation: zero raw image" };
    }
    this.state.entities = {};
    this.state.faults = {};
    this.state.waits = {};
    const target = this.state.mode === "replay" ? "replay: local image only, nothing sent to a PLC" : "sent to coordinator";
    this.#local(nowMs, "reset_simulation", `Reset Simulation: complete DI/AI image set to false/zero; simulation remains selected (${target}).`);
    return { ok: true };
  }

  exitSimulation(nowMs: number): CommandResult {
    const allowed = this.can("exit_simulation");
    if (!allowed.ok) return allowed;
    this.state.connection.simulationRequested = false;
    if (this.state.mode === "replay") {
      this.state.connection.simulationApplied = null;
      this.state.connection.simulationDetail = "Replay has no PLC to confirm hardware passthrough";
    }
    this.#local(nowMs, "exit_simulation", `Exit Simulation: interceptor authority requested back to hardware passthrough${this.state.mode === "replay" ? " (replay: recorded locally only)" : ""}.`);
    return { ok: true };
  }

  enterSimulation(nowMs: number): CommandResult {
    const allowed = this.can("enter_simulation");
    if (!allowed.ok) return allowed;
    this.state.connection.simulationRequested = true;
    for (const signal of this.state.signals.filter((candidate) => candidate.direction === "world_to_plc")) {
      this.state.inputs[signal.id] = { value: zeroValue(signal.dataType), atMs: nowMs, cause: "Simulation activation: zero raw image" };
    }
    this.#local(nowMs, "enter_simulation", `Enter Simulation: simulated DI/AI image initialized to false/zero${this.state.mode === "replay" ? " (replay: recorded locally only)" : ""}.`);
    return { ok: true };
  }

  setSuppression(outputId: string, suppressed: boolean, nowMs: number): CommandResult {
    this.state.suppressedOutputs = { ...this.state.suppressedOutputs, [outputId]: suppressed };
    this.#local(nowMs, suppressed ? "suppress_output" : "release_output", `${suppressed ? "Suppress" : "Release"} physical sink for ${outputId}. The PLC command is still observed and traced.`);
    return { ok: true };
  }

  setScope(ids: readonly string[], included: boolean): CommandResult {
    if (this.state.phase === "running" || this.state.phase === "paused" || this.state.phase === "budget_hold") return { ok: false, reason: "Scope is locked once the campaign starts; steer Muse instead." };
    const scope = { ...this.state.scope };
    for (const id of ids) if (id in scope) scope[id] = included;
    this.state.scope = scope;
    for (const id of ids) {
      const check = this.state.checks[id];
      if (check && (check.status === "planned" || check.status === "out_of_scope")) check.status = included ? "planned" : "out_of_scope";
    }
    this.#emit();
    return { ok: true };
  }

  steer(text: string, nowMs: number): CommandResult {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, reason: "Write a direction for Muse first." };
    const event = this.#localEvent(nowMs, { kind: "engineer.steer", text: trimmed }, `Steering: ${trimmed}`);
    this.state.steering = [...this.state.steering, { id: event.id, atMs: nowMs, text: trimmed }];
    this.#record(event);
    this.#emit();
    return { ok: true };
  }

  #transition(command: EngineerCommand, phase: CampaignPhase, nowMs: number, detail: string): CommandResult {
    const allowed = this.can(command);
    if (!allowed.ok) return allowed;
    this.state.phase = phase;
    this.#local(nowMs, command, detail);
    return { ok: true };
  }

  #finalize(nowMs: number, reason: string): void {
    this.state.endedAtMs = nowMs;
    this.state.finalized = true;
    for (const check of Object.values(this.state.checks)) {
      if (check.status === "planned" || check.status === "running") {
        check.status = "not_run";
        check.summary = check.summary ?? reason;
      }
    }
    if (this.state.agent.active) {
      this.state.agent.active = { ...this.state.agent.active, endedAtMs: nowMs, status: "abandoned_at_finalize" };
      this.state.budget.reservedUsd = 0;
    }
    this.state.waits = {};
  }

  #localEvent(nowMs: number, body: MuseEventBody, summary: string): MuseEvent {
    const provenance: Provenance = { mode: this.state.mode, evidenceClass: "engineer_local", source: "workspace", clock: this.state.mode === "live" ? "live_wall" : "discrete" };
    return { ...body, id: `local-${++this.#localSequence}`, atMs: nowMs, lane: "agent", summary, provenance } as MuseEvent;
  }

  #local(nowMs: number, command: EngineerCommand, detail: string): void {
    const event = this.#localEvent(nowMs, { kind: "engineer.command", command, detail }, detail);
    this.#record(event);
    this.state.lastMeaningful = { atMs: nowMs, summary: detail, eventId: event.id };
    this.#emit();
  }

  #record(event: MuseEvent): void {
    this.state.eventCount += 1;
    if (event.kind === "world.heartbeat" || event.kind === "entity.publish") return;
    pushBounded(this.state.timeline, event, TIMELINE_LIMIT);
    // Dense streams (10,000 M2 commit/ack pairs) must not evict the events engineers inspect.
    if (!isDense(event)) pushBounded(this.state.keyEvents, event, KEY_EVENT_LIMIT);
    if (event.kind === "verdict" || event.kind === "plan.added") this.state.verdicts.push(event);
  }

  findEvent(id: string): MuseEvent | undefined {
    return this.state.keyEvents.find((event) => event.id === id) ?? this.state.timeline.find((event) => event.id === id) ?? this.state.verdicts.find((event) => event.id === id);
  }

  // ------------------------------------------------------------ event folding

  #apply(event: MuseEvent): void {
    const s = this.state;
    this.#record(event);
    if (isMeaningful(event)) s.lastMeaningful = { atMs: event.atMs, summary: event.summary, eventId: event.id };
    switch (event.kind) {
      case "episode.start": {
        const worldRun = event.world?.run;
        if (worldRun !== s.world.run) {
          s.entities = {};
          s.faults = {};
          s.waits = {};
        }
        s.world = { ...s.world, run: worldRun, version: event.world?.worldVersion ?? s.world.version };
        s.episode = { episodeId: event.episodeId, title: event.title, checkIds: event.checkIds, world: event.world, connectorExpected: event.connectorExpected, plcExpected: event.plcExpected, worldExpected: event.worldExpected, timeScale: event.timeScale, note: event.note, startedAtMs: event.atMs, clock: event.provenance.clock, source: event.provenance.source, eventId: event.id };
        s.step = undefined;
        s.runtimeFlag = undefined;
        if (!event.connectorExpected && s.connection.link !== "none") s.connection.link = "closed";
        if (!event.plcExpected) s.connection.plcRestarting = false;
        for (const id of event.checkIds) {
          const check = s.checks[id];
          if (check && check.status === "planned") check.status = "running";
        }
        break;
      }
      case "episode.end":
        if (s.episode?.episodeId === event.episodeId) s.episode = { ...s.episode, connectorExpected: false, plcExpected: false, worldExpected: false };
        s.waits = {};
        break;
      case "step":
        s.step = { phase: event.phase, message: event.message, awaiting: event.awaiting, atMs: event.atMs, checkId: event.checkId, eventId: event.id };
        break;
      case "world.heartbeat":
        s.world.lastHeartbeatAtMs = event.atMs;
        s.world.tick = event.tick;
        break;
      case "world.control":
      case "world.evidence":
        s.world.lastHeartbeatAtMs = event.atMs;
        break;
      case "entity.publish":
        s.entities[event.entityId] = { type: event.entityType, state: event.state, atMs: event.atMs };
        break;
      case "entity.remove":
        delete s.entities[event.entityId];
        break;
      case "raw.input":
        s.inputs[event.signalId] = { value: event.value, atMs: event.atMs, cause: event.cause, eventId: event.id, run: event.provenance.run, source: event.provenance.source };
        break;
      case "plc.output":
        for (const [id, value] of Object.entries(event.values)) s.outputs[id] = { value, atMs: event.atMs, cause: event.summary, eventId: event.id, origin: event.origin, run: event.provenance.run, source: event.provenance.source };
        break;
      case "fault.set":
        if (event.active) s.faults[event.faultId] = { faultId: event.faultId, target: event.target, detail: event.detail, sealed: event.sealed === true, atMs: event.atMs };
        else delete s.faults[event.faultId];
        break;
      case "fault.clear_all":
        for (const [id, fault] of Object.entries(s.faults)) if (!fault.sealed) delete s.faults[id];
        break;
      case "connector.session":
        Object.assign(s.connection, {
          transport: event.transport,
          endpoint: event.endpoint,
          securityMode: event.securityMode,
          securityPolicy: event.securityPolicy,
          identity: event.identity,
          serverProduct: event.serverProduct ?? s.connection.serverProduct,
          requestedPublishingIntervalMs: event.requestedPublishingIntervalMs ?? s.connection.requestedPublishingIntervalMs,
          publishingIntervalMs: event.publishingIntervalMs ?? s.connection.publishingIntervalMs,
          requestedSamplingIntervalMs: event.requestedSamplingIntervalMs ?? s.connection.requestedSamplingIntervalMs,
          samplingIntervalMs: event.samplingIntervalMs ?? s.connection.samplingIntervalMs,
          provenance: event.provenance
        });
        break;
      case "connector.link":
        s.connection.link = event.state;
        s.connection.linkDetail = event.detail;
        s.connection.linkChangedAtMs = event.atMs;
        s.connection.provenance = event.provenance;
        break;
      case "connector.commit":
        s.connection.epoch = event.epoch;
        s.connection.workstationSequence = event.sequence;
        s.connection.commits += 1;
        break;
      case "connector.ack":
        s.connection.epoch = event.epoch;
        s.connection.appliedSequence = event.sequence;
        s.connection.acks += 1;
        s.connection.lastAckLatencyMs = event.latencyMs;
        if (event.latencyMs !== null) {
          s.connection.latencies.push(event.latencyMs);
          if (s.connection.latencies.length > LATENCY_WINDOW) s.connection.latencies.splice(0, s.connection.latencies.length - LATENCY_WINDOW);
        }
        if (event.outputCaptureCycle) s.connection.plcCycle = event.outputCaptureCycle;
        s.connection.lastPlcHeartbeatAtMs = event.atMs;
        s.connection.plcRestarting = false;
        s.connection.provenance = event.provenance;
        break;
      case "connector.case":
        s.connection.cases = [...s.connection.cases.slice(-40), { name: event.name, accepted: event.accepted, expectedAccepted: event.expectedAccepted, detail: event.detail, atMs: event.atMs }];
        break;
      case "plc.identity":
        if (s.connection.bootIdentity && s.connection.bootIdentity !== event.bootIdentity) {
          s.connection.previousBootIdentity = s.connection.bootIdentity;
          s.connection.bootChangedAtMs = event.atMs;
        }
        if (event.previousBootIdentity) {
          s.connection.previousBootIdentity = event.previousBootIdentity;
          s.connection.bootChangedAtMs = event.atMs;
        }
        s.connection.bootIdentity = event.bootIdentity;
        s.connection.lastPlcHeartbeatAtMs = event.atMs;
        s.connection.plcRestarting = false;
        s.connection.provenance = event.provenance;
        break;
      case "plc.restart":
        s.connection.plcRestarting = true;
        s.connection.plcRestartAtMs = event.atMs;
        break;
      case "plc.heartbeat":
        s.connection.plcCycle = event.plcCycle;
        s.connection.lastPlcHeartbeatAtMs = event.atMs;
        break;
      case "simulation.state":
        s.connection.simulationApplied = event.applied;
        s.connection.simulationDetail = event.detail;
        break;
      case "agent.request.start": {
        const call: ModelCallState = { requestId: event.requestId, purpose: event.purpose, model: event.model, startedAtMs: event.atMs, reservedUsd: event.reservedUsd, timeoutMs: event.timeoutMs, repairEpisode: event.repairEpisode, checkId: event.checkId };
        s.agent.active = call;
        s.budget.reservedUsd += event.reservedUsd;
        break;
      }
      case "agent.request.end": {
        const active = s.agent.active?.requestId === event.requestId ? s.agent.active : undefined;
        const finished: ModelCallState = {
          ...(active ?? { requestId: event.requestId, purpose: "unknown", model: "unknown", startedAtMs: event.atMs - event.durationMs, reservedUsd: 0, timeoutMs: 0 }),
          endedAtMs: event.atMs,
          status: event.status,
          failed: event.failed,
          durationMs: event.durationMs,
          costUsd: event.costUsd,
          outputTokens: event.outputTokens,
          reasoningTokens: event.reasoningTokens,
          note: event.note
        };
        s.agent.calls = [...s.agent.calls, finished];
        if (active) {
          s.agent.active = undefined;
          s.budget.reservedUsd = Math.max(0, s.budget.reservedUsd - active.reservedUsd);
        }
        s.budget.spentUsd += event.costUsd;
        if (finished.repairEpisode) {
          s.budget.repairSpentUsd[finished.repairEpisode] = (s.budget.repairSpentUsd[finished.repairEpisode] ?? 0) + event.costUsd;
          if (event.failed) s.budget.failedRepairs[finished.repairEpisode] = (s.budget.failedRepairs[finished.repairEpisode] ?? 0) + 1;
        }
        s.budget.level = budgetLevel(s.budget.spentUsd, s.budget.limits);
        if (s.budget.level === "hard_stop" && s.phase === "running") s.phase = "budget_hold";
        break;
      }
      case "agent.assessment":
        s.agent.assessment = { text: event.text, confidence: event.confidence, hypotheses: event.hypotheses, atMs: event.atMs };
        break;
      case "agent.observation":
        s.agent.observations += 1;
        break;
      case "plan.added": {
        const addition = event.check;
        if (!s.checks[addition.id]) {
          s.checks[addition.id] = {
            id: addition.id,
            group: addition.group as CheckState["group"],
            title: addition.title,
            manipulate: addition.manipulate,
            observe: addition.observe,
            oracle: addition.oracle,
            evidenceClass: "agent_record",
            availability: "recorded",
            evidenceSource: event.provenance.source,
            addedBy: "muse",
            status: "running",
            summary: event.reason,
            addedAtMs: event.atMs
          };
          s.checkOrder = [...s.checkOrder, addition.id];
          s.scope = { ...s.scope, [addition.id]: true };
        }
        break;
      }
      case "wait.start":
        s.waits[event.condition] = { condition: event.condition, startedAtMs: event.atMs, timeoutMs: event.timeoutMs, checkId: event.checkId };
        break;
      case "wait.end":
        delete s.waits[event.condition];
        break;
      case "runtime.flag":
        s.runtimeFlag = event.state === "clear" ? undefined : { state: event.state, message: event.message, elapsedMs: event.elapsedMs, atMs: event.atMs, exercise: event.exercise };
        break;
      case "budget.limits":
        s.budget.limits = event.limits;
        s.budget.level = budgetLevel(s.budget.spentUsd, event.limits);
        break;
      case "hotreload":
        s.hotReload.history = [...s.hotReload.history, { phase: event.phase, version: event.version, detail: event.detail, atMs: event.atMs }];
        if (event.phase === "activate" || event.phase === "rollback") s.hotReload.activeVersion = event.version;
        if (event.phase === "activate") s.world.version = event.version;
        break;
      case "blind":
        if (event.phase === "commit") s.blind = { commitment: event.hash };
        if (event.phase === "seal") s.blind = { ...s.blind, sealedHash: event.hash };
        if (event.phase === "reveal") s.blind = { ...s.blind, revealed: event.truth };
        break;
      case "verdict": {
        const check = event.checkId ? s.checks[event.checkId] : undefined;
        if (check && s.scope[check.id] !== false) {
          check.status = event.status;
          check.summary = event.summary;
          check.evidence = event.evidence;
          check.verdictEventId = event.id;
        }
        break;
      }
      case "audit.check":
      case "agent.action":
      case "engineer.command":
      case "engineer.steer":
        break;
    }
  }
}

export function budgetLevel(spentUsd: number, limits: BudgetLimits | undefined): "normal" | "warning" | "hard_stop" {
  if (!limits) return "normal";
  if (spentUsd >= limits.campaignHardUsd) return "hard_stop";
  if (spentUsd >= limits.campaignWarningUsd) return "warning";
  return "normal";
}

export function scopedChecks(state: WorkspaceState): CheckState[] {
  return state.checkOrder.map((id) => state.checks[id]!).filter(Boolean);
}
