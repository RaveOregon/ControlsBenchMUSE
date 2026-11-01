// Generated machine-view package contract (M10 lane C).
//
// The view shows simulated physical truth and observed PLC outputs taken from snapshots the
// host supplies. It is not the PLC HMI. It owns no physics, holds no credentials, opens no
// network connection and has no command authority. All schemas here are JSON-serialisable so
// the portal, scripts and Muse prompts share one vocabulary.

export const VIEW_PACKAGE_VERSION = "controlsbench.machine-view.package.v1" as const;
export const VIEW_EQUIPMENT_VERSION = "controlsbench.machine-view.equipment.v1" as const;
export const VIEW_BINDINGS_VERSION = "controlsbench.machine-view.bindings.v1" as const;
export const VIEW_SNAPSHOT_VERSION = "controlsbench.machine-view.snapshot.v1" as const;
export const VIEW_PROTOCOL_VERSION = "controlsbench.machine-view.protocol.v1" as const;
export const VIEW_GENERATION_REQUEST_VERSION = "controlsbench.machine-view.generation-request.v1" as const;
export const VIEW_VALIDATION_VERSION = "controlsbench.machine-view.validation.v1" as const;

export type ScalarValue = boolean | number | string | null;

/** Per-value display health. Only `good` is shown as current. */
export const healthStates = ["good", "stale", "held", "bad", "unknown"] as const;
export type Health = typeof healthStates[number];

/** Host link state for the whole snapshot. */
export const linkStates = ["fresh", "stale", "held", "quarantined", "passthrough", "disconnected", "not_connected"] as const;
export type LinkState = typeof linkStates[number];

export const evidenceClasses = ["surrogate_contract", "fake_connector", "preserved_live_plc", "live_plc"] as const;
export type ViewEvidenceClass = typeof evidenceClasses[number];

export type ChannelSource = "world_raw" | "plc_output";
export type TruthClass = "simulated_physical_truth" | "observed_plc_output";

export interface SourceRef {
  document: string;
  sha256: string;
  locator: string;
}

export interface EquipmentGeometry {
  /** Entity path on which this equipment sits. */
  path: string;
  /** Point equipment (sensor, divert pivot). */
  stationM?: number;
  /** Span equipment (lane, chute). */
  fromM?: number;
  toM?: number;
}

export type EquipmentKind = "conveyor_lane" | "photoeye" | "divert" | "drive" | "encoder" | "destination" | "indicator";

export interface Equipment {
  id: string;
  kind: EquipmentKind;
  label: string;
  description: string;
  channels: string[];
  geometry: EquipmentGeometry | null;
  sources: SourceRef[];
  assumptions: string[];
}

export interface EntityPathDefinition {
  id: string;
  fromM: number;
  toM: number;
  /** Branch paths start at a station on their parent path; drawings must join there. */
  branchFrom: { path: string; atM: number } | null;
}

export interface EntityTypeDefinition {
  type: string;
  fields: string[];
  paths: EntityPathDefinition[];
  /** Path values that are drawn on another path (for example `runout` on `main`). */
  pathAliases: Record<string, string>;
  nominalLengthM: number;
}

export interface EquipmentFile {
  schemaVersion: typeof VIEW_EQUIPMENT_VERSION;
  machineId: string;
  name: string;
  specification: SourceRef;
  world: { worldId: string; packageVersion: string; stateSchemaVersion: string; manifest: SourceRef; source: SourceRef; assumptions: SourceRef };
  signalMap: SourceRef & { mapVersion: string };
  units: Record<string, string>;
  equipment: Equipment[];
  entityTypes: EntityTypeDefinition[];
  /** Raw encoder scale used to turn counts into belt travel for display. */
  encoder: { channel: string; countsPerM: number; modulus: number } | null;
  assumptions: string[];
}

export interface Channel {
  id: string;
  source: ChannelSource;
  signal: string;
  dataType: string;
  equipmentId: string;
  truthClass: TruthClass;
  unit: string;
  normalValue: ScalarValue;
  description: string;
}

export interface BindingContract {
  schemaVersion: "controlsbench.machine-view.binding-contract.v1";
  equipmentSha256: string;
  channels: Channel[];
  /** Equipment that must be positioned from equipment geometry by an anchor binding. */
  anchoredEquipment: string[];
  /** Channels that must drive a rotate binding (actuator motion from actual position). */
  rotateChannels: string[];
  /** Channels that must drive a belt-motion binding. */
  beltChannels: string[];
  entityTypes: string[];
}

export interface PathPoint { m: number; x: number; y: number }
export interface EntityPathDrawing { path: string; points: PathPoint[] }

export type Binding =
  | { id: string; kind: "anchor"; element: string; equipmentId: string; rotateWithPath: boolean }
  | { id: string; kind: "state"; element: string; channel: string }
  | { id: string; kind: "text"; element: string; channel: string; decimals: number | null }
  | { id: string; kind: "rotate"; element: string; channel: string; inputMin: number; inputMax: number; angleMin: number; angleMax: number; pivotX: number; pivotY: number }
  | { id: string; kind: "belt"; element: string; channel: string; periodPx: number }
  | { id: string; kind: "entities"; element: string; container: string; entityType: string };

export type BindingKind = Binding["kind"];
export const bindingKinds: readonly BindingKind[] = ["anchor", "state", "text", "rotate", "belt", "entities"];

export interface ViewBindingsFile {
  schemaVersion: typeof VIEW_BINDINGS_VERSION;
  contractSha256: string;
  channels: Channel[];
  entityPaths: EntityPathDrawing[];
  bindings: Binding[];
}

export interface ViewManifest {
  schemaVersion: typeof VIEW_PACKAGE_VERSION;
  packageId: string;
  name: string;
  status: "generated" | "not_generated";
  entry: { file: "view.svg"; mediaType: "image/svg+xml"; sha256: string } | null;
  files: Record<string, string>;
  compatibility: {
    machineId: string;
    worldId: string;
    worldPackageVersion: string;
    stateSchemaVersion: string;
    worldManifestSha256: string;
    worldSourceSha256: string;
    specificationSha256: string;
    signalMapVersion: string;
    snapshotSchema: typeof VIEW_SNAPSHOT_VERSION;
    protocol: typeof VIEW_PROTOCOL_VERSION;
  };
  selectableEquipment: string[];
  units: Record<string, string>;
  truthBoundary: string;
  authority: { plcCommands: false; credentials: false; network: false; scripts: "host_runtime_only" };
  provenance: { generation: string; validation: string; model: string | null; responseId: string | null; generatedAt: string | null };
  layoutAssumptions: string[];
}

// ---------------------------------------------------------------------------------------------
// Snapshot supplied by the host. Narrow by design: only declared channels and entity fields.

export interface ChannelSample {
  value: ScalarValue;
  health: Health;
  observedAtMs?: number | null;
  evidenceRef?: string | null;
}

export interface EntitySample {
  id: string;
  type: string;
  state: Record<string, ScalarValue>;
  evidenceRef?: string | null;
}

export interface ViewSnapshot {
  schemaVersion: typeof VIEW_SNAPSHOT_VERSION;
  packageId: string;
  mode: "replay" | "live";
  evidenceClass: ViewEvidenceClass;
  frame: { sequence: number; campaignSequence: number | null; sourceTimeMs: number | null; label: string | null };
  link: { state: LinkState; ageMs: number | null; reason: string | null };
  channels: Record<string, ChannelSample>;
  /** `supplied: false` means the host has no entity source; positions are then unknown. */
  entities: { supplied: boolean; health: Health; items: EntitySample[] };
  selection: { equipmentId: string | null; entityId: string | null };
}

// ---------------------------------------------------------------------------------------------
// Host <-> isolated view protocol. Frames contain resolved presentation operations only.

export const reservedAttributes = ["data-cb-value", "data-cb-health", "data-cb-source", "data-cb-selected", "data-cb-clone", "data-cb-entity", "data-cb-path", "data-cb-route", "data-cb-jammed", "data-cb-outside", "data-cb-template"] as const;
export const writableAttributes: readonly string[] = [...reservedAttributes, "transform", "aria-label"];
export const entityFields = ["itemId", "requestedRoute", "path", "positionM", "velocityMps", "jammed"] as const;

/**
 * Numeric form of a good-health transform, so the trusted runtime can ease between two
 * consecutive recorded snapshots. It never extrapolates past the latest snapshot; the exact
 * `transform` attribute is always the end state. Absent for non-good health (snap).
 */
export type Motion =
  | { kind: "pose"; x: number; y: number; angle: number }
  | { kind: "rotate"; angle: number; px: number; py: number }
  | { kind: "belt"; offset: number; period: number };

export type FrameOp =
  | { op: "attrs"; id: string; attrs: Record<string, string>; motion?: Motion }
  | { op: "text"; id: string; text: string }
  | { op: "entities"; template: string; container: string; items: Array<{ key: string; attrs: Record<string, string>; fields: Record<string, string>; motion?: Motion }> }
  | { op: "selected"; equipmentId: string | null; entityId: string | null }
  | { op: "banner"; level: "info" | "warn" | "bad"; text: string };

/** `tweenMs` > 0 only when this frame directly follows the previous one on the recorded clock. */
export interface HostFrameMessage { protocol: typeof VIEW_PROTOCOL_VERSION; token: string; type: "frame"; sequence: number; tweenMs: number; ops: FrameOp[] }

export type ViewMessage =
  | { protocol: typeof VIEW_PROTOCOL_VERSION; token: string; type: "ready"; elementIds: string[] }
  | { protocol: typeof VIEW_PROTOCOL_VERSION; token: string; type: "applied"; sequence: number; missing: string[] }
  | { protocol: typeof VIEW_PROTOCOL_VERSION; token: string; type: "select"; equipmentId: string | null; entityId: string | null }
  | { protocol: typeof VIEW_PROTOCOL_VERSION; token: string; type: "error"; message: string };

// ---------------------------------------------------------------------------------------------
// Validation report.

export interface ValidationCheck {
  id: string;
  passed: boolean;
  severity: "error" | "warning";
  detail: string;
}

export interface ValidationReport {
  schemaVersion: typeof VIEW_VALIDATION_VERSION;
  /** Equipment and channel contract usable: fallback can be shown. */
  contractValid: boolean;
  /** Generated view usable: may be mounted in the isolated host. */
  viewValid: boolean;
  packageId: string | null;
  hashes: Record<string, string>;
  checks: ValidationCheck[];
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------------------------
// Preserved generation request format.

export interface GenerationInputRef {
  role: "specification" | "equipment" | "binding_contract" | "world_manifest" | "world_assumptions" | "view_protocol";
  path: string;
  sha256: string;
  bytes: number;
}

export interface GenerationRequestRecord {
  schemaVersion: typeof VIEW_GENERATION_REQUEST_VERSION;
  requestId: string;
  createdAt: string;
  purpose: "machine_view_generation";
  endpoint: string;
  model: { id: string; reasoning: { effort: string; summary: string }; maxOutputTokens: number };
  budget: { reservationUsd: number; perRequestHardUsd: number; timeoutMs: number; maxCalls: 1; automaticRetries: 0; repairCalls: 0 };
  inputs: GenerationInputRef[];
  promptVersion: string;
  promptSha256: string;
  outputSchemaName: string;
  outputSchemaSha256: string;
  /** Exact JSON body sent to the Responses API. The authorization header is never stored. */
  body: Record<string, unknown>;
  bodySha256: string;
}
