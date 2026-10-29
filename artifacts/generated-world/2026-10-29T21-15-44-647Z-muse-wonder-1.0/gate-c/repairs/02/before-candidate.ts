import type { GeneratedWorldModule } from "../../../../src/proof/contracts.ts";
import baseWorld from "../world.ts";

const REVISION = "0.5.1-gate-c";
const EVIDENCE_TYPE = "world.revisionObserved";

const clonedManifest = JSON.parse(
  JSON.stringify(baseWorld.manifest),
) as GeneratedWorldModule["manifest"];

const manifest: GeneratedWorldModule["manifest"] = {
  ...clonedManifest,
  packageVersion: REVISION,
  evidenceTypes: [
    ...(clonedManifest.evidenceTypes ?? []),
    EVIDENCE_TYPE,
  ],
};

type RevisionEvidence = {
  type: typeof EVIDENCE_TYPE;
  controlId: string;
  summary: string;
  worldVersion: typeof REVISION;
  packageVersion: typeof REVISION;
};

function extractControlId(args: readonly unknown[]): string {
  const primary = args[0] as Record<string, unknown> | string | undefined;
  if (typeof primary === "string" && primary.length > 0) {
    return primary;
  }
  if (primary && typeof primary === "object") {
    const value =
      primary.controlId ?? primary.id ?? primary.control ?? primary.type ?? primary.name;
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return "unknown";
}

function callEvidenceSink(
  sink: (...args: never[]) => unknown,
  owner: unknown,
  evidence: RevisionEvidence,
): void {
  if (sink.length >= 2) {
    (sink as (...args: unknown[]) => unknown).call(owner, evidence.type, evidence);
  } else {
    (sink as (...args: unknown[]) => unknown).call(owner, evidence);
  }
}

function tryAppendEvidence(
  candidate: unknown,
  evidence: RevisionEvidence,
  depth = 0,
): boolean {
  if (candidate === null || candidate === undefined || depth > 2) {
    return false;
  }
  if (Array.isArray(candidate)) {
    candidate.push(evidence);
    return true;
  }
  if (typeof candidate === "function") {
    callEvidenceSink(candidate as (...args: never[]) => unknown, undefined, evidence);
    return true;
  }
  if (typeof candidate !== "object") {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  const sinkKeys = [
    "appendEvidence",
    "emitEvidence",
    "recordEvidence",
    "addEvidence",
    "appendEvent",
    "emitEvent",
    "recordEvent",
    "append",
    "emit",
    "record",
    "push",
  ] as const;
  for (const key of sinkKeys) {
    const sink = record[key];
    if (typeof sink === "function") {
      callEvidenceSink(sink as (...args: never[]) => unknown, candidate, evidence);
      return true;
    }
  }
  for (const key of ["evidence", "events", "evidenceEvents"] as const) {
    if (Array.isArray(record[key])) {
      (record[key] as unknown[]).push(evidence);
      return true;
    }
  }
  for (const key of [
    "evidence",
    "events",
    "evidenceSink",
    "sink",
    "host",
    "context",
    "ctx",
    "recorder",
    "evidenceRecorder",
  ] as const) {
    const nested = record[key];
    if (nested !== candidate && tryAppendEvidence(nested, evidence, depth + 1)) {
      return true;
    }
  }
  return false;
}

function appendRevisionEvidence(args: readonly unknown[], result: unknown, controlId: string): void {
  const evidence: RevisionEvidence = {
    type: EVIDENCE_TYPE,
    controlId,
    summary: `Revision ${REVISION} observed control ${controlId}.`,
    worldVersion: REVISION,
    packageVersion: REVISION,
  };
  try {
    for (const arg of args) {
      if (tryAppendEvidence(arg, evidence)) {
        return;
      }
    }
    tryAppendEvidence(result, evidence);
  } catch {
    // Evidence-only revision: never alter control behavior if a sink rejects evidence.
  }
}

export const world: GeneratedWorldModule = {
  ...(baseWorld as GeneratedWorldModule),
  manifest,
  initialize: (...args: any[]) => (baseWorld as any).initialize?.(...args),
  onPlcFrame: (...args: any[]) => (baseWorld as any).onPlcFrame?.(...args),
  onControl: (...args: any[]) => {
    const result = (baseWorld as any).onControl?.(...args);
    appendRevisionEvidence(args, result, extractControlId(args));
    return result;
  },
  tick: (...args: any[]) => (baseWorld as any).tick?.(...args),
  snapshot: (...args: any[]) => {
    const snapshot = (baseWorld as any).snapshot?.(...args);
    if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
      return { ...snapshot, worldVersion: REVISION };
    }
    return snapshot;
  },
  migrate: (...args: any[]) => (baseWorld as any).migrate?.(...args),
  dispose: (...args: any[]) => (baseWorld as any).dispose?.(...args),
};

export default world;
