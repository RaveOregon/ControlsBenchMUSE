// Preserved Gate A-D and M0-M2 artifacts used as replay fixtures.
//
// The loader is reader-agnostic: the browser fetches Vite asset URLs, tests read the
// same files from disk. Both keep the original text so provenance hashes can be checked.

import type { RawValue } from "../../model/events.ts";

export const WORLD_DIR = "artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0";

export const FIXTURE_PATHS = {
  manifest: `${WORLD_DIR}/world.manifest.json`,
  worldSource: `${WORLD_DIR}/world.ts`,
  gateATrace: `${WORLD_DIR}/gate-a-trace.json`,
  gateAResult: `${WORLD_DIR}/gate-a-result.json`,
  gateBTrace: `${WORLD_DIR}/gate-b-trace.json`,
  gateBResult: `${WORLD_DIR}/gate-b-result.json`,
  gateCResult: `${WORLD_DIR}/gate-c-result.json`,
  gateCInitialObservations: `${WORLD_DIR}/gate-c/initial-observations.json`,
  gateCInitialResponse: `${WORLD_DIR}/gate-c/initial-response.json`,
  gateCFollowupObservations: `${WORLD_DIR}/gate-c/followup-observations.json`,
  gateCSealedDiagnosis: `${WORLD_DIR}/gate-c/final-sealed-diagnosis.json`,
  gateCTruthReveal: `${WORLD_DIR}/gate-c/truth-reveal.json`,
  gateCHiddenTruthCommitment: `${WORLD_DIR}/gate-c/hidden-truth-commitment.json`,
  gateCCandidateGeneration: `${WORLD_DIR}/gate-c/candidate-generation.json`,
  gateDResult: `${WORLD_DIR}/gate-d-result.json`,
  m0Session: "codesys/artifacts/m0-opcua-session.json",
  samplingExperiment: "codesys/artifacts/opcua-sampling-experiment.json",
  m1Result: "codesys/artifacts/m1-opcua-result.json",
  m2Result: "codesys/artifacts/m2-opcua-result.json",
  m2Trace: "codesys/artifacts/m2-coherence-trace.jsonl"
} as const;

export type FixtureKey = keyof typeof FIXTURE_PATHS;

/**
 * SHA-256 values recorded at the time the evidence was produced, computed over
 * LF-normalized text. Sources: gate-d-result.json `acceptedPackageHashes` and
 * codesys/README.md (M1/M2 sections).
 */
export const RECORDED_SHA256: Partial<Record<FixtureKey, { sha256: string; recordedIn: string }>> = {
  manifest: { sha256: "5e94445e9cb45a81ef922e2584229c1fd18ba34aa2a337bd3bb7beb5bf829f7c", recordedIn: "gate-d-result.json" },
  worldSource: { sha256: "a467a4589850ba19bdb1caa80d30387b387b8861077013afb8974933c520b5d6", recordedIn: "gate-d-result.json" },
  m1Result: { sha256: "6a54c413d177cd77b23786d35d0772ef40777fa6af4ae736df37ebd1c60a6531", recordedIn: "codesys/README.md" },
  m2Result: { sha256: "acaf85fce770dfbd3a480bc717b2f75a801f43606ce9230780ac40e032364317", recordedIn: "codesys/README.md" },
  m2Trace: { sha256: "1d0cd4a604c767e2419c18512855ba6435d70d78833fc9b5b3d54d6b3a85241a", recordedIn: "codesys/README.md" }
};

export interface ManifestSignal {
  id: string;
  name: string;
  direction: "plc_to_world" | "world_to_plc";
  dataType: string;
  normalValue: RawValue;
  deviceId: string;
  role: string;
  description: string;
}

export interface WorldManifest {
  worldId: string;
  name: string;
  packageVersion: string;
  stateSchemaVersion: string;
  tickMs: number;
  signals: ManifestSignal[];
  assumptions: string[];
  faultCapabilities: string[];
}

export interface TraceEvent {
  sequence: number;
  atMs: number;
  tick: number;
  lane: "raw_input" | "evidence" | "activity" | "plc_frame" | "control" | "entity";
  worldVersion: string;
  data: Record<string, any>;
}

export interface TraceRun {
  label: string;
  seed: number;
  worldVersion: string;
  tickMs: number;
  finalTimeMs: number;
  events: TraceEvent[];
}

export interface GateATrace extends Omit<TraceRun, "label"> {
  gate: "A";
  evidenceClass: string;
}

export interface GateBTrace {
  gate: "B";
  evidenceClass: string;
  runs: TraceRun[];
}

export interface CheckpointResult {
  id: string;
  status: string;
  durationMs: number;
  evidence: Record<string, any>;
}

export interface GateResult {
  status: string;
  checkpoints: CheckpointResult[];
  [key: string]: any;
}

export interface ModelCallRecord {
  purpose: string;
  responseId: string | null;
  model: string;
  status: string;
  durationMs: number;
  usage: { output_tokens?: number; total_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } } | null;
  estimatedCostUsd: number;
  auditNote?: string;
}

export interface Observation {
  id: string;
  atMs: number;
  note: string;
  values: Record<string, RawValue>;
}

export interface FollowUpAction {
  kind: "set_plc_output" | "wait_observe";
  role: string;
  booleanValue: boolean;
  durationMs: number;
  observeRoles: string[];
  rationale: string;
}

export interface M2TraceRow {
  sequence: string;
  slot: number;
  latencyMs: number;
  outputCaptureCycle: string;
}

export interface FixtureBundle {
  texts: Record<FixtureKey, string>;
  manifest: WorldManifest;
  worldSource: string;
  gateA: GateATrace;
  gateAResult: GateResult;
  gateB: GateBTrace;
  gateBResult: GateResult;
  gateC: GateResult & { modelCalls: ModelCallRecord[]; budget: { estimatedSpendUsd: number; limits: Record<string, number> } };
  gateCInitialObservations: Observation[];
  gateCInitialResponse: { response: { assessment: string; currentConfidence: number; hypotheses: Array<Record<string, any>>; followUp: { objective: string; actions: FollowUpAction[] } }; metadata: ModelCallRecord };
  gateCFollowupObservations: Observation[];
  gateCSealedDiagnosis: { sealedAt: string; hash: string; response: Record<string, any> };
  gateCTruthReveal: { revealedAt: string; hiddenTruth: Record<string, unknown>; commitment: string; verified: boolean };
  gateCHiddenTruthCommitment: { committedAt: string; commitment: string; algorithm: string };
  gateCCandidateGeneration: { rationale: string; repairAttempts: Array<{ attempt: number; status?: string; diagnosis?: string; diagnostic?: string }> };
  gateD: { status: string; checkpoint: { checks: Array<{ name: string; passed: boolean; severity: string }>; warnings: Array<{ name: string }>; criticalGaps: unknown[] }; evidenceSummary: Record<string, any> };
  m0Session: Record<string, any>;
  samplingExperiment: Record<string, any>;
  m1Result: Record<string, any>;
  m2Result: Record<string, any>;
  m2Rows: M2TraceRow[];
}

export type TextReader = (key: FixtureKey, repoPath: string) => Promise<string>;

export async function loadFixtureBundle(read: TextReader): Promise<FixtureBundle> {
  const keys = Object.keys(FIXTURE_PATHS) as FixtureKey[];
  const loaded = await Promise.all(keys.map(async (key) => [key, await read(key, FIXTURE_PATHS[key])] as const));
  const texts = Object.fromEntries(loaded) as Record<FixtureKey, string>;
  const json = <T>(key: FixtureKey): T => JSON.parse(texts[key]) as T;
  return {
    texts,
    manifest: json("manifest"),
    worldSource: texts.worldSource,
    gateA: json("gateATrace"),
    gateAResult: json("gateAResult"),
    gateB: json("gateBTrace"),
    gateBResult: json("gateBResult"),
    gateC: json("gateCResult"),
    gateCInitialObservations: json("gateCInitialObservations"),
    gateCInitialResponse: json("gateCInitialResponse"),
    gateCFollowupObservations: json("gateCFollowupObservations"),
    gateCSealedDiagnosis: json("gateCSealedDiagnosis"),
    gateCTruthReveal: json("gateCTruthReveal"),
    gateCHiddenTruthCommitment: json("gateCHiddenTruthCommitment"),
    gateCCandidateGeneration: json("gateCCandidateGeneration"),
    gateD: json("gateDResult"),
    m0Session: json("m0Session"),
    samplingExperiment: json("samplingExperiment"),
    m1Result: json("m1Result"),
    m2Result: json("m2Result"),
    m2Rows: texts.m2Trace
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as M2TraceRow)
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface ProvenanceCheck {
  key: FixtureKey;
  path: string;
  recorded?: string;
  recordedIn?: string;
  actual: string;
  status: "verified" | "mismatch" | "no_recorded_hash";
}

/**
 * Hashes are compared over LF-normalized text because the checkout may convert line
 * endings (core.autocrlf); the recorded values were computed over LF files.
 */
export async function verifyProvenance(bundle: FixtureBundle): Promise<ProvenanceCheck[]> {
  const keys = Object.keys(FIXTURE_PATHS) as FixtureKey[];
  return Promise.all(
    keys.map(async (key) => {
      const actual = await sha256Hex(bundle.texts[key].replace(/\r\n/g, "\n"));
      const recorded = RECORDED_SHA256[key];
      const status: ProvenanceCheck["status"] = !recorded ? "no_recorded_hash" : recorded.sha256 === actual ? "verified" : "mismatch";
      return { key, path: FIXTURE_PATHS[key], recorded: recorded?.sha256, recordedIn: recorded?.recordedIn, actual, status };
    })
  );
}
