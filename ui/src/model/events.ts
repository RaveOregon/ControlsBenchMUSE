// UI-facing campaign event contract.
//
// Every source (recorded fixtures today, the live coordinator later) is translated
// into these events before any component sees it. Components never read OPC UA node
// IDs, trace files, or coordinator internals directly.

export type RawValue = boolean | number | string | null;

/** Whether the event is happening now (live) or is being re-presented from a preserved record (replay). */
export type SourceMode = "replay" | "live";

/** What produced the evidence, independent of whether it is being replayed. */
export type EvidenceClass =
  | "surrogate_contract" // generated world against the surrogate PLC-output driver; no PLC involved
  | "world_model" // generated world driving a real PLC through the coordinator
  | "plc_measurement" // measured against the CODESYS Control Win runtime
  | "agent_record" // Muse model calls, assessments, authored actions
  | "audit" // deterministic verdicts and audits over preserved artifacts
  | "engineer_local"; // commands, steering, and configuration made in this workspace

/** The clock an event's source timing came from. */
export type SourceClock =
  | "world_virtual" // generated-world tick time recorded in a surrogate trace
  | "recorded_wall" // wall-clock durations recorded when the evidence was produced
  | "derived_latency" // spacing reconstructed from recorded per-row acknowledgement latency
  | "discrete" // untimed records; campaign spacing is presentation only
  | "live_wall"; // wall clock observed now

export interface Provenance {
  mode: SourceMode;
  evidenceClass: EvidenceClass;
  /** Repo-relative artifact path, `replay:composer`, `workspace`, or `live:coordinator`. */
  source: string;
  /** Location inside the source, e.g. `events[23]`, `line 4512`, `modelCalls[2]`. */
  ref?: string;
  clock: SourceClock;
  /** Position on the source's own clock, when it has one. */
  sourceAtMs?: number;
  recordedAt?: string;
  run?: string;
  seed?: number;
  worldVersion?: string;
}

export type TimelineLane = "world" | "raw_input" | "plc_ack" | "plc_output" | "fault" | "agent" | "conclusion";
export type EventLane = TimelineLane | "system";

export const TIMELINE_LANES: readonly TimelineLane[] = ["world", "raw_input", "plc_ack", "plc_output", "fault", "agent", "conclusion"];

export type CheckStatus = "planned" | "out_of_scope" | "running" | "pass" | "fail" | "inconclusive" | "not_run";

export type ActivityPhase =
  | "preparing"
  | "connecting"
  | "applying_stimulus"
  | "observing"
  | "investigating"
  | "reasoning"
  | "compiling"
  | "migrating"
  | "writing_evidence"
  | "auditing";

export interface WorldRunInfo {
  worldId: string;
  worldVersion: string;
  run: string;
  seed?: number;
  tickMs?: number;
  finalTimeMs?: number;
  /** True when physical entities were withheld from Muse (blind diagnosis). */
  blindView?: boolean;
}

export interface BudgetLimits {
  perRequestUsd: number;
  repairEpisodeUsd: number;
  campaignWarningUsd: number;
  campaignHardUsd: number;
  sessionHardUsd: number;
  requestTimeoutMs: number;
  failedRepairWarning: number;
  failedRepairHard: number;
  worldHeartbeatStaleMs: number;
}

export interface PlanCheckAddition {
  id: string;
  group: string;
  title: string;
  manipulate: string;
  observe: string;
  oracle: string;
}

export type EngineerCommand =
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "reset_simulation"
  | "exit_simulation"
  | "enter_simulation"
  | "suppress_output"
  | "release_output"
  | "complete";

export type RuntimeFlagState = "world_stalled" | "request_timed_out" | "condition_timeout" | "waiting_condition" | "budget_stop" | "repair_continue" | "repair_warning" | "repair_hard_stop" | "clear";

export type MuseEventBody =
  | {
      kind: "episode.start";
      episodeId: string;
      checkIds: string[];
      title: string;
      world?: WorldRunInfo;
      connectorExpected: boolean;
      plcExpected: boolean;
      worldExpected: boolean;
      /** Source milliseconds represented by one campaign millisecond (1 = not condensed). */
      timeScale: number;
      note?: string;
    }
  | { kind: "episode.end"; episodeId: string }
  | { kind: "step"; phase: ActivityPhase; message: string; awaiting?: string }
  | { kind: "world.heartbeat"; tick: number }
  | { kind: "world.control"; controlId: string; payload: Record<string, unknown>; cause: string }
  | { kind: "world.evidence"; type: string; data?: Record<string, unknown> }
  | { kind: "entity.publish"; entityId: string; entityType: string; state: Record<string, unknown> }
  | { kind: "entity.remove"; entityId: string; reason: string }
  | { kind: "raw.input"; signalId: string; value: RawValue; cause: string; revision?: number }
  | { kind: "plc.output"; frameSequence?: number; values: Record<string, RawValue>; origin: "surrogate_driver" | "muse_surrogate" | "plc" }
  | { kind: "fault.set"; faultId: string; target: string; active: boolean; detail: string; sealed?: boolean }
  | { kind: "fault.clear_all"; detail: string }
  | {
      kind: "connector.session";
      transport: string;
      endpoint: string;
      securityMode: string;
      securityPolicy: string;
      identity: string;
      serverProduct?: string;
      requestedPublishingIntervalMs?: number;
      publishingIntervalMs?: number;
      requestedSamplingIntervalMs?: number;
      samplingIntervalMs?: number;
    }
  | { kind: "connector.link"; state: "up" | "lost" | "reconnecting" | "closed"; detail: string }
  | { kind: "connector.commit"; epoch: string; sequence: string; slot: number | null }
  | { kind: "connector.ack"; epoch: string; sequence: string; slot: number | null; latencyMs: number | null; outputCaptureCycle?: string }
  | { kind: "connector.case"; name: string; accepted: boolean; expectedAccepted: boolean; detail: string; counter?: string }
  | { kind: "plc.identity"; bootIdentity: string; previousBootIdentity?: string }
  | { kind: "plc.restart"; detail: string }
  | { kind: "plc.heartbeat"; plcCycle: string }
  | { kind: "simulation.state"; applied: boolean | null; detail: string }
  | { kind: "agent.request.start"; requestId: string; purpose: string; model: string; reservedUsd: number; timeoutMs: number; repairEpisode?: string }
  | {
      kind: "agent.request.end";
      requestId: string;
      status: string;
      failed: boolean;
      durationMs: number;
      costUsd: number;
      outputTokens?: number;
      reasoningTokens?: number;
      totalTokens?: number;
      note?: string;
    }
  | { kind: "agent.assessment"; text: string; confidence?: number; hypotheses?: Array<{ label: string; confidence: number }> }
  | { kind: "agent.action"; action: string; role?: string; signalId?: string; value?: RawValue; durationMs?: number; rationale: string }
  | { kind: "agent.observation"; observationId: string; note: string; values: Record<string, RawValue> }
  | { kind: "plan.added"; check: PlanCheckAddition; reason: string }
  /** timeoutMs is null when no deadline has been declared (the spec leaves many PLC deadlines TBD). */
  | { kind: "wait.start"; condition: string; timeoutMs: number | null }
  | { kind: "wait.end"; condition: string; outcome: "satisfied" | "timeout" | "completed" | "cancelled" | "unresolved" }
  | { kind: "runtime.flag"; state: RuntimeFlagState; message: string; elapsedMs?: number; exercise: boolean }
  | { kind: "budget.limits"; limits: BudgetLimits }
  | { kind: "hotreload"; phase: "prepare" | "check" | "migrate" | "activate" | "rollback"; version: string; detail: string }
  | { kind: "blind"; phase: "commit" | "seal" | "reveal"; hash: string; detail: string; truth?: Record<string, unknown> }
  | { kind: "audit.check"; name: string; passed: boolean; severity: string; warning?: boolean }
  | { kind: "verdict"; status: CheckStatus; summary: string; evidence?: Record<string, unknown> }
  | { kind: "engineer.command"; command: EngineerCommand; detail: string }
  | { kind: "engineer.steer"; text: string };

export type MuseEvent = MuseEventBody & {
  id: string;
  /** Campaign clock, milliseconds since the campaign started. */
  atMs: number;
  lane: EventLane;
  summary: string;
  checkId?: string;
  provenance: Provenance;
};

export type MuseEventKind = MuseEvent["kind"];
export type EventOf<K extends MuseEventKind> = Extract<MuseEvent, { kind: K }>;

/** Events that move the "last meaningful activity" marker; heartbeats and dense ack streams do not. */
export function isMeaningful(event: MuseEvent): boolean {
  switch (event.kind) {
    case "world.heartbeat":
    case "plc.heartbeat":
    case "entity.publish":
    case "connector.commit":
    case "connector.ack":
      return false;
    case "raw.input":
      // Continuous diagnostics change every tick; edges on discrete inputs are meaningful.
      return typeof event.value === "boolean";
    default:
      return true;
  }
}
