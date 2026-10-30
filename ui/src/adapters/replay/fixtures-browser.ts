// Browser loader for the preserved artifacts. `?raw` keeps the exact file text (no JSON or
// TypeScript transform) so the replay parses — and hashes — the same bytes the tests read.
// Loaded lazily so the workspace shell paints before ~2.6 MB of evidence is parsed.

import gateATrace from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-a-trace.json?raw";
import gateAResult from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-a-result.json?raw";
import gateBTrace from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-b-trace.json?raw";
import gateBResult from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-b-result.json?raw";
import gateCResult from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-c-result.json?raw";
import gateCCandidateGeneration from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-c/candidate-generation.json?raw";
import gateCFollowupObservations from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-c/followup-observations.json?raw";
import gateCHiddenTruthCommitment from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-c/hidden-truth-commitment.json?raw";
import gateCInitialObservations from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-c/initial-observations.json?raw";
import gateCInitialResponse from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-c/initial-response.json?raw";
import gateCSealedDiagnosis from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-c/final-sealed-diagnosis.json?raw";
import gateCTruthReveal from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-c/truth-reveal.json?raw";
import gateDResult from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-d-result.json?raw";
import manifest from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.manifest.json?raw";
import worldSource from "../../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts?raw";
import m0Session from "../../../../codesys/artifacts/m0-opcua-session.json?raw";
import m1Result from "../../../../codesys/artifacts/m1-opcua-result.json?raw";
import m2Trace from "../../../../codesys/artifacts/m2-coherence-trace.jsonl?raw";
import m2Result from "../../../../codesys/artifacts/m2-opcua-result.json?raw";
import samplingExperiment from "../../../../codesys/artifacts/opcua-sampling-experiment.json?raw";
import { loadFixtureBundle, type FixtureBundle, type FixtureKey } from "./fixtures.ts";

const RAW: Record<FixtureKey, string> = {
  manifest,
  worldSource,
  gateATrace,
  gateAResult,
  gateBTrace,
  gateBResult,
  gateCResult,
  gateCInitialObservations,
  gateCInitialResponse,
  gateCFollowupObservations,
  gateCSealedDiagnosis,
  gateCTruthReveal,
  gateCHiddenTruthCommitment,
  gateCCandidateGeneration,
  gateDResult,
  m0Session,
  samplingExperiment,
  m1Result,
  m2Result,
  m2Trace
};

export function loadBrowserFixtures(): Promise<FixtureBundle> {
  return loadFixtureBundle(async (key) => RAW[key]);
}
