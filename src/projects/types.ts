// Shared project-onboarding shapes. Types only, so the browser build can import them without
// pulling in host modules.

import type { WorldManifest } from "../proof/contracts.ts";

export type VersionStatus = "draft" | "queued" | "preparing" | "validating" | "repairing" | "needs_information" | "ready" | "failed" | "cancelled";
export interface InputFile { name: string; file: string; sha256: string; byteLength: number; mediaType: string; source: "upload" | "paste" | "revision" | "example" }
export interface JobActivity { atIso: string; phase: string; message: string }
export interface JobRecord {
  id: string; provider: { id: string; label: string; paid: boolean; fixture: boolean };
  state: VersionStatus; queuedAtIso: string; startedAtIso?: string; endedAtIso?: string; lastActivity?: JobActivity; activities: JobActivity[];
  requests: number; repairs: number; maxRequests: number;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number };
  reservationsUsd: number; estimatedUsd: number; error?: string; cancelledBy?: string;
}
export interface VersionRecord {
  schema: "controlsbench.project.v1"; projectId: string; version: string; createdAtIso: string; basedOn?: string; revisionNote?: string;
  inputs: { spec: InputFile; io?: InputFile; ioSource: "separate" | "embedded" | "missing" };
  target: "m8-conveyor";
  status: VersionStatus; job?: JobRecord;
  /** Accepted package files (relative to the version directory) with SHA-256, once validated. */
  package?: { directory: string; files: Record<string, string>; worldSha256: string; manifestSha256: string; attempt: number };
}
export interface ProjectRecord { schema: "controlsbench.project.v1"; id: string; name: string; createdAtIso: string; kind: "uploaded" | "example"; versions: string[] }
export interface ActiveSelection {
  schema: "controlsbench.project.v1"; projectId: string; version: string; kind: "uploaded" | "example"; selectedAtIso: string;
  specSha256: string; ioSha256?: string; worldSha256: string; manifestSha256: string; worldPath: string; specPath: string; manifestPath: string; planPath?: string;
}

export type IoDirection = "world_to_plc" | "plc_to_world" | "unknown";
export interface IoRow { name: string; direction: IoDirection; nativeType?: string; unit?: string; normal?: string; description?: string; source: string }

export const PLAN_GROUPS = ["io", "startup", "normal", "functional", "faults", "edge", "runtime"] as const;
export interface PlannedCheck {
  id: string; group: typeof PLAN_GROUPS[number]; title: string; objective: string; requirementRefs: string[]; sourceRefs: string[];
  stimulus: string; expectedObservation: string; expectedBasis: "specified" | "unspecified"; observeSignals: string[]; worldControls: string[]; needsHmi: boolean;
}
export interface Question { id: string; question: string; blocking: boolean; relatesTo: string }
export interface WorldPackage {
  manifest: WorldManifest; worldTs: string; worldTestTs: string; assumptionsMd: string;
  summary: string; physicalParameters: Array<{ name: string; value: string; unit: string; basis: "specified" | "inferred"; source: string }>;
  questions: Question[]; testPlan: { objective: string; checks: PlannedCheck[] };
}

export interface BenchProfile { id: string; interface: string; endpoint: string; platform: string; cadenceHz: number; note: string }
export interface CompatibilityIssue { severity: "blocking" | "warning"; code: string; message: string; signal?: string }
export interface SignalMapping { id: string; direction: string; dataType: string; role: string; m8?: { iecPath: string; iecType: string }; status: "mapped" | "missing" | "extra" | "type_mismatch" | "direction_mismatch" | "unobservable" }
export interface UploadedMapping { name: string; direction: string; nativeType?: string; status: "mapped" | "type_differs" | "direction_differs" | "not_on_interface"; m8Type?: string; source: string }
export interface Compatibility {
  profile: BenchProfile; compatible: boolean; liveReady: false; liveReadyReason: string;
  issues: CompatibilityIssue[]; signals: SignalMapping[]; controls: { declared: string[]; bound: string[]; unbound: string[]; missingRequired: string[] };
  uploaded: UploadedMapping[]; missingFromUpload: string[];
}

export type CheckGroup = "compile" | "structure" | "runtime" | "physics" | "generated_tests";
export type Classification = "compiler" | "structural" | "behavioral" | "test_defect";
export interface ValidationCheck { id: string; group: CheckGroup; title: string; status: "pass" | "fail" | "skipped"; detail: string; classification?: Classification }
export interface ValidationResult {
  schema: "controlsbench.world-validation.v1"; ok: boolean; startedAtIso: string; durationMs: number; profile: string;
  worldSha256?: string; manifestSha256?: string; checks: ValidationCheck[]; measured: Record<string, number | string>;
  generatedTests?: { pass: number; fail: number; durationMs: number };
}

export interface Review {
  schema: "controlsbench.project-review.v1"; projectId: string; version: string; jobId: string; preparedAtIso: string; author: JobRecord["provider"];
  summary: string; physicalParameters: WorldPackage["physicalParameters"]; questions: Question[];
  io: { source: VersionRecord["inputs"]["ioSource"]; rows: IoRow[] };
  plan: { objective: string; checks: Array<PlannedCheck & { available: boolean; unavailableReason?: string }> };
  compatibility?: Compatibility; validation?: ValidationResult; measured?: Record<string, number | string>;
  lineage: Array<{ attempt: number; purpose: "generate" | "repair"; directory: string; responseId: string | null; model: string; requestHash: string; durationMs: number;
    usage?: Record<string, unknown>; validationOk?: boolean; files?: Record<string, string> }>;
}
