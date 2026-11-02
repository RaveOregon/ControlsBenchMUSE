// Portal host protocol v1: the wire contract between the ControlsBench host process and the
// browser portal. Types only (plus constants), no Node or DOM imports, so both the host and the
// strict UI build compile it.
//
// Campaign truth is the M9 ledger (`controlsbench.campaign.v1` envelopes) and its projection.
// This protocol only transports them; it never re-derives campaign state.

export const HOST_PROTOCOL_VERSION = 1 as const;

/** The subset of a `controlsbench.campaign.v1` envelope the portal relies on. */
export interface CampaignEnvelope {
  schemaVersion: "controlsbench.campaign.v1";
  campaignId: string;
  id: string;
  sequence: number;
  atIso: string;
  type: string;
  visibility: "public" | "truth";
  data: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

/** Mirrors `CampaignProjection` in src/campaign/ledger.ts (checked by test/portal-host.test.ts). */
export interface ProjectionView {
  campaignId: string;
  sequence: number;
  status: "preparing" | "running" | "paused" | "stopped" | "completed" | "failed";
  revision: number;
  provenance?: { spec: string; ioMap: string; plcBuild: string; worldModule: string; model: string; connector: string };
  evidenceClass?: string;
  claimBoundary?: string;
  plan?: { objective: string; experiments: Array<{ id: string; objective: string; category: string; requirements: string[] }> };
  experiments: Record<string, { id: string; objective: string; category: string; requirements: string[]; status: "proposed" | "running" | "completed"; conclusion?: string; evidenceRefs?: string[] }>;
  actions: Record<string, { name: string; status: string; evidenceRefs: string[]; message?: string }>;
  findings: Record<string, {
    id: string; title: string; experimentId: string;
    claims: Array<{ evidenceId: string; signal: string; equals: boolean | number | string | null }>;
    injectedTruthRefs: string[]; inference: string; assumptions: string[]; uncertainty: string;
    review: "unreviewed" | "accepted" | "rerun_requested";
  }>;
  activeExperiment?: string;
  connector?: Record<string, unknown>;
  rawImage: Record<string, unknown>;
  outputs: Record<string, unknown>;
  budget: { campaignUsd: number; sessionUsd: number; checks: Record<string, number>; repairs: Record<string, number>; requests: Record<string, unknown> };
  activity?: Record<string, unknown>;
  report?: Record<string, unknown>;
}

export type HostEvidenceClass = "fake_connector" | "preserved_live_plc" | "live_plc";

export interface HostBudgetLimits {
  perRequestUsd: number; repairEpisodeUsd: number; campaignWarningUsd: number; campaignHardUsd: number; sessionHardUsd: number;
  requestTimeoutMs: number; failedRepairWarning: number; failedRepairHard: number; worldHeartbeatStaleMs: number;
}

/** Static description of the host and the campaign factory it will use for Start Campaign. */
export interface HostScopeDefinition {
  mode: "categories";
  choices: Array<{ id: string; title: string }>;
  description: string;
}
export interface HostInfo {
  protocolVersion: typeof HOST_PROTOCOL_VERSION;
  hostId: string;
  factory: { id: string; label: string; evidenceClass: HostEvidenceClass; claimBoundary: string; connectorId: string; supportsExitSimulation: boolean; scope?: HostScopeDefinition };
  limits: HostBudgetLimits;
  commandTimeoutMs: number;
  outputIds: string[];
  serverNowIso: string;
}

export const HOST_COMMAND_TYPES = [
  "start", "pause", "resume", "stop", "reset_simulation", "exit_simulation", "enter_simulation",
  "set_output_suppression", "steer", "review_finding", "configure_hmi", "disconnect_hmi"
] as const;
export type HostCommandType = typeof HOST_COMMAND_TYPES[number];

/** Same shape as the portal's V1 coordinator command. */
export interface HostCommand { contractVersion: 1; requestId: string; type: string; payload?: Record<string, unknown> }

/**
 * Application acknowledgement. Delivered on the event stream only after every ledger event it
 * cites (`throughSequence`), so the portal never displays an outcome ahead of its evidence.
 */
export interface HostAcknowledgement {
  requestId: string;
  outcome: "applied" | "rejected";
  detail: string;
  /** Campaign event IDs (or HMI session references) that evidence the outcome. */
  evidenceRefs: string[];
  campaignId?: string;
  throughSequence?: number;
  atIso: string;
}

export type HmiSessionState = "not_configured" | "connecting" | "observing" | "stale" | "disconnected" | "error";

export interface HmiFrameRef {
  /** Stable evidence reference: `hmi-frame:<sessionId>:<seq>`. */
  reference: string;
  sessionId: string;
  frameSequence: number;
  /** Capture completed (host wall clock). */
  capturedAtIso: string;
  /** Capture requested (host wall clock); the pixels were rendered within [requestedAtIso, capturedAtIso]. */
  requestedAtIso: string;
  contentType: string;
  byteLength: number;
  sha256: string;
  /** Same-origin URL the portal can load the exact bytes from. */
  mediaUrl: string;
  /** Page URL actually rendered when the frame was captured. */
  pageUrl: string;
}

/**
 * An engineer input that reached the controlled WebVisu page (pointer position or the fact of a
 * key press; key values are never recorded). It proves delivery to the browser only: neither a
 * visible HMI result nor PLC acceptance.
 */
export interface HmiActionRef {
  reference: string;
  sessionId: string;
  actionSequence: number;
  origin: "engineer_browser";
  kind: "pointer" | "key";
  atIso: string;
  x?: number;
  y?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  pageUrl: string;
  /** First frame captured after the input, when known. */
  followingFrame?: string;
}

export interface HmiSessionView {
  state: HmiSessionState;
  sourceId?: string;
  sourceKind?: "webvisu";
  /** Configured WebVisu URL. Not proof of observation. */
  url?: string;
  sessionId?: string;
  /** Browser product/version and target identity of the controlled capture session. */
  browser?: string;
  startedAtIso?: string;
  recording: boolean;
  captureIntervalMs?: number;
  staleAfterMs?: number;
  frameCount: number;
  lastFrame?: HmiFrameRef;
  detail: string;
  changedAtIso: string;
}

export type HostStreamMessage =
  | { type: "hello"; info: HostInfo; campaignId: string | null; hmi: HmiSessionView }
  | { type: "campaign"; campaignId: string; evidenceClass: HostEvidenceClass; label: string; diagnosisMode: "known" | "blind" }
  | { type: "events"; campaignId: string; events: CampaignEnvelope[]; projection: ProjectionView; serverNowIso: string }
  | { type: "ack"; ack: HostAcknowledgement; serverNowIso: string }
  | { type: "hmi"; hmi: HmiSessionView; frame?: HmiFrameRef; action?: HmiActionRef; serverNowIso: string }
  | { type: "heartbeat"; serverNowIso: string };
