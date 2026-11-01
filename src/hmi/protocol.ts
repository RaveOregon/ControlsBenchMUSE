// Operator HMI protocol v1: the wire contract between the HMI service (src/hmi/service.ts) and the
// browser HMI (src/hmi/web). Types and constants only, so the browser and Node both import it.
//
// Every value shown by the HMI is an observed PLC sample with its own quality and timestamps.
// Commands are sequenced M8 operator requests; a browser click is never a PLC acknowledgement.

export const HMI_PROTOCOL_VERSION = 1 as const;

export type Scalar = boolean | number | string | null;
export type SourceKind = "live_plc" | "fixture";

export interface SampleView {
  value: Scalar;
  /** OPC UA status code text, e.g. "Good (0x00000000)". */
  status: string;
  good: boolean;
  sourceTimestamp: string;
  serverTimestamp: string;
  /** HMI service receipt time of the read response. */
  receivedAtIso: string;
}

export interface SnapshotView {
  /** HMI poll sequence within this service session. */
  sequence: number;
  requestedAtIso: string;
  receivedAtIso: string;
  latencyMs: number;
  /** PlcCycle = OutputCaptureCycle inside this single read batch. Not a multi-read bracket. */
  sameScanBracket: boolean;
  values: Record<string, SampleView>;
}

export type LinkState = "connecting" | "connected" | "stale" | "reconnecting" | "disconnected" | "stopped";

export interface LinkView {
  state: LinkState;
  detail: string;
  endpoint: string;
  securityMode: string;
  securityPolicy: string;
  userConfigured: boolean;
  pollIntervalMs: number;
  staleAfterMs: number;
  sessionOpenedAtIso?: string;
  lastPollOkAtIso?: string;
  lastPollLatencyMs?: number;
  p95PollLatencyMs?: number;
  totalPolls: number;
  failedPolls: number;
  consecutiveFailures: number;
  reconnects: number;
  lastError?: string;
  /** PlcCycle advanced between the last two successful polls; null before two polls. */
  plcScanning: boolean | null;
  bootIdentity?: string;
  previousBootIdentity?: string;
  bootChangedAtIso?: string;
}

export interface IdentityView {
  protocolVersion: typeof HMI_PROTOCOL_VERSION;
  serviceSessionId: string;
  startedAtIso: string;
  source: { kind: SourceKind; label: string; fixtureId?: string; fixtureBasis?: string };
  machine: { id: string; name: string; description: string };
  mapVersion: string;
  expectedBuildId: number;
  expectedInterfaceVersion: number;
  url: string;
  journal?: string;
}

export type CommandAction = "start" | "stop" | "reset" | "auto_on" | "auto_off";
export type CommandOutcome = "pending" | "delivered" | "applied" | "rejected" | "timed_out" | "failed" | "refused";
export type CommandOrigin = "operator_browser" | "agent_seam" | "test";

export interface PreconditionView { id: string; label: string; met: boolean | null; observed: string }

export interface ResultingStateView {
  observedAtIso: string;
  mode: Scalar;
  modeText: Scalar;
  faultCode: Scalar;
  motorRunCmd: Scalar;
  driveRunningFb: Scalar;
  autoRequest: Scalar;
}

export interface CommandView {
  requestId: string;
  action: CommandAction;
  origin: CommandOrigin;
  clientSessionId?: string;
  target?: string;
  uiActionRef?: string;
  agentActionRef?: string;
  requestedAtIso: string;
  deliveredAtIso?: string;
  acknowledgedAtIso?: string;
  outcome: CommandOutcome;
  /** How PLC acceptance was established: sequence echo + accepted flag, or request-variable readback. */
  ackKind?: "plc_sequence_ack" | "plc_sequence_echo" | "readback";
  writes?: Array<{ path: string; value: Scalar; status: string }>;
  expectedSequence?: number;
  ackField?: string;
  acceptedField?: string;
  accepted?: boolean;
  detail: string;
  preconditions?: PreconditionView[];
  atAck?: ResultingStateView;
  resulting?: ResultingStateView & { settled: boolean };
  evidenceRefs: string[];
}

export type AlarmKind = "fault" | "exception";
export type AlarmState = "active" | "cleared" | "unresolved";

export interface AlarmView {
  id: string;
  kind: AlarmKind;
  code: number;
  plcText: string;
  cause: string;
  response: string;
  state: AlarmState;
  /** HMI receipt time of the first sample showing this code. */
  firstObservedAtIso: string;
  firstObservedBasis: "transition_observed" | "active_at_observation_start" | "observed_after_gap";
  /** Onset lies after this time (previous good poll), when known. */
  onsetAfterIso?: string;
  plcSourceTimestamp?: string;
  clearedObservedAtIso?: string;
  clearedAfterIso?: string;
  clearBasis?: "transition_observed" | "observed_after_gap";
  unresolvedReason?: string;
  bootIdentity: string;
  serviceSessionId: string;
  /** Periods without good observation while the alarm was open (link loss, HMI restart). */
  gaps?: Array<{ fromIso: string; toIso: string; reason: string }>;
  /** HMI-local operator review marker; never a PLC acknowledgement. */
  review?: { atIso: string; clientSessionId?: string };
  related: { operation: string[]; engineering: string[] };
}

export interface OwnershipView {
  commandsEnabled: boolean;
  policy: "auto" | "enabled" | "disabled";
  reasons: string[];
  owners: Array<{ id: string; file: string; detail: string }>;
}

export interface ClientView { clientSessionId: string; label: string; connectedAtIso: string; lastSeenAtIso: string; viewport?: { width: number; height: number } }

export interface TargetRect { id: string; label: string; x: number; y: number; width: number; height: number; enabled: boolean; route: string }

export interface AgentActionView {
  reference: string;
  requester: string;
  targetId: string;
  clientSessionId: string;
  requestedAtIso: string;
  targetRect?: TargetRect;
  status: "requested" | "delivered" | "observed" | "inconclusive";
  delivered?: { atIso: string; x: number; y: number; via: string; browserSession?: string };
  pageInput?: { reference: string; atIso: string; isTrusted: boolean; hitTarget: string };
  commandRequestId?: string;
  screen?: { frameRef: string; capturedAtIso: string; sha256?: string; renderedStatus?: string };
  detail: string;
}

export interface HmiStateView {
  identity: IdentityView;
  serverNowIso: string;
  link: LinkView;
  snapshot?: SnapshotView;
  ownership: OwnershipView;
  commands: CommandView[];
  /** HMI evaluation of the M8 Start/Reset rules over the latest observation; the PLC decides. */
  preconditions: { start: PreconditionView[]; reset: PreconditionView[] };
  alarms: { active: AlarmView[]; recent: AlarmView[]; total: number; persistence: string };
  clients: ClientView[];
}

export type HmiStreamMessage =
  | { type: "state"; state: HmiStateView }
  | { type: "heartbeat"; serverNowIso: string }
  /** Asks one page to republish its target rectangles as laid out now (before an agent click). */
  | { type: "targets-request"; requestId: string; clientSessionId: string };

/** Stable semantic target IDs for browser automation and vision agents. */
export const HMI_TARGETS = {
  navOperation: "nav.operation",
  navAlarms: "nav.alarms",
  navEngineering: "nav.engineering",
  start: "cmd.start",
  stop: "cmd.stop",
  reset: "cmd.reset",
  autoOn: "cmd.auto.on",
  autoOff: "cmd.auto.off",
  alarmSummary: "status.alarm-summary",
  activeFaultLink: "link.active-fault"
} as const;
