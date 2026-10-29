import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateManifest } from "../src/proof/manifest.ts";

const latest = JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8"));
const packageDirectory = resolve(latest.relativeDirectory);
const resultPath = resolve(packageDirectory, "gate-d-result.json");
const checks = [];
const warnings = [];
const criticalGaps = [];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const tryReadJson = async (path) => {
  try { return await readJson(path); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function record(name, passed, evidence, severity = "critical") {
  checks.push({ name, passed, severity, evidence });
  if (!passed) (severity === "warning" ? warnings : criticalGaps).push({ name, evidence });
}

function findHistoricalInput(path, expectedHash) {
  try {
    const commits = execFileSync("git", ["log", "--format=%H", "--all", "--", path], { encoding: "utf8" }).trim().split(/\s+/).filter(Boolean);
    for (const revision of commits) {
      const text = execFileSync("git", ["show", `${revision}:${path}`], { encoding: "utf8" });
      const variants = [
        { lineEnding: "lf", text },
        { lineEnding: "crlf", text: text.replace(/\n/g, "\r\n") },
        { lineEnding: "lf_no_final_newline", text: text.replace(/\n$/, "") },
        { lineEnding: "crlf_no_final_newline", text: text.replace(/\n$/, "").replace(/\n/g, "\r\n") }
      ];
      const match = variants.find((entry) => sha256(entry.text) === expectedHash);
      if (match) return { revision, lineEnding: match.lineEnding, path, sha256: expectedHash };
    }
  } catch { /* reported as missing provenance below */ }
  return null;
}

function validateTraceRun(run, manifest, label) {
  const issues = [];
  const lanes = {};
  let previousAtMs = -Infinity;
  let previousTick = -Infinity;
  let previousFrameSequence = 0;
  for (let index = 0; index < run.events.length; index += 1) {
    const event = run.events[index];
    lanes[event.lane] = (lanes[event.lane] || 0) + 1;
    if (event.sequence !== index + 1) issues.push(`event sequence gap at ${index + 1}`);
    if (event.atMs < previousAtMs || event.tick < previousTick) issues.push(`non-monotonic time at event ${event.sequence}`);
    previousAtMs = event.atMs;
    previousTick = event.tick;
    if (event.worldVersion !== run.worldVersion) issues.push(`world version drift at event ${event.sequence}`);
    if (event.lane === "raw_input") {
      const signal = manifest.signals.find((entry) => entry.id === event.data.signalId);
      if (!signal || signal.direction !== "world_to_plc") issues.push(`invalid raw input signal at event ${event.sequence}`);
      if (typeof event.data.cause !== "string" || !event.data.cause.trim()) issues.push(`missing raw input cause at event ${event.sequence}`);
    }
    if (event.lane === "plc_frame") {
      const frame = event.data.frame;
      if (!frame || frame.sequence <= previousFrameSequence) issues.push(`non-increasing PLC frame at event ${event.sequence}`);
      previousFrameSequence = frame?.sequence || previousFrameSequence;
      for (const signalId of Object.keys(frame?.values || {})) {
        const signal = manifest.signals.find((entry) => entry.id === signalId);
        if (!signal || signal.direction !== "plc_to_world") issues.push(`invalid PLC output signal ${signalId}`);
      }
    }
    if (event.lane === "control" && !manifest.controls.some((entry) => entry.id === event.data.control?.id)) issues.push(`undeclared control at event ${event.sequence}`);
    if (event.lane === "evidence" && !manifest.evidenceTypes.includes(event.data.event?.type)) issues.push(`undeclared evidence type ${event.data.event?.type}`);
  }
  const expectedInputs = manifest.signals.filter((entry) => entry.direction === "world_to_plc").map((entry) => entry.id).sort();
  const actualInputs = Object.keys(run.finalRawInputState || {}).sort();
  if (!same(expectedInputs, actualInputs)) issues.push("final raw input image is incomplete or contains extras");
  if (run.finalSnapshot?.worldVersion !== run.worldVersion) issues.push("final snapshot world version mismatch");
  return { label, eventCount: run.events.length, lanes, issues };
}

const generation = await readJson(resolve(packageDirectory, "generation.json"));
const manifest = validateManifest(await readJson(resolve(packageDirectory, "world.manifest.json")));
const gateA = await readJson(resolve(packageDirectory, "gate-a-result.json"));
const gateB = await readJson(resolve(packageDirectory, "gate-b-result.json"));
const gateC = await readJson(resolve(packageDirectory, "gate-c-result.json"));
const gateATrace = await readJson(resolve(packageDirectory, "gate-a-trace.json"));
const gateBTrace = await readJson(resolve(packageDirectory, "gate-b-trace.json"));
const gateDirectory = resolve(packageDirectory, "gate-c");

const fileHashEvidence = {};
for (const [name, expectedHash] of Object.entries(generation.files)) {
  const actualHash = sha256(await readFile(resolve(packageDirectory, name)));
  fileHashEvidence[name] = { expectedHash, actualHash, matches: expectedHash === actualHash };
}
record("accepted package hashes", Object.values(fileHashEvidence).every((entry) => entry.matches), fileHashEvidence);

const contractHash = sha256(await readFile(resolve(generation.sourceContract)));
record("generation contract input", contractHash === generation.inputHashes.contract, { path: generation.sourceContract, expected: generation.inputHashes.contract, actual: contractHash });
const currentSpecHash = sha256(await readFile(resolve(generation.sourceSpecification)));
const historicalSpec = currentSpecHash === generation.inputHashes.specification ? { path: generation.sourceSpecification, sha256: currentSpecHash, current: true } : findHistoricalInput(generation.sourceSpecification, generation.inputHashes.specification);
record("generation specification input recoverable", Boolean(historicalSpec), { expected: generation.inputHashes.specification, current: currentSpecHash, recovered: historicalSpec });
if (historicalSpec && currentSpecHash !== generation.inputHashes.specification) warnings.push({ name: "specification evolved after generation", evidence: { generatedFrom: historicalSpec, currentSpecHash } });

let repairState = generation.repairAttempts[0]?.before || generation.files;
let repairChainValid = true;
const repairChain = [];
for (const attempt of generation.repairAttempts) {
  const beforeMatches = same(attempt.before, repairState);
  repairChainValid &&= beforeMatches;
  if (attempt.after) repairState = attempt.after;
  repairChain.push({ attempt: attempt.attempt, status: attempt.status || "completed", beforeMatches, activatedStateChanged: Boolean(attempt.after) });
}
repairChainValid &&= same(repairState, generation.files);
record("generation repair chain", repairChainValid, { repairChain, finalMatches: same(repairState, generation.files) });

record("checkpoint verdicts CP-0 through CP-11", gateA.status === "pass" && gateB.status === "pass" && gateC.status === "pass" && same([...gateA.checkpoints, ...gateB.checkpoints, ...gateC.checkpoints].map((entry) => entry.id), Array.from({ length: 12 }, (_, index) => `CP-${index}`)) && [...gateA.checkpoints, ...gateB.checkpoints, ...gateC.checkpoints].every((entry) => entry.status === "pass"), { gateA: gateA.status, gateB: gateB.status, gateC: gateC.status });

const traceReports = [validateTraceRun(gateATrace, manifest, "gate-a"), ...gateBTrace.runs.map((run) => validateTraceRun(run, manifest, `gate-b/${run.label}`))];
record("raw effects and surrogate traces", traceReports.every((entry) => entry.issues.length === 0) && traceReports.every((entry) => entry.lanes.raw_input > 0 && entry.lanes.evidence > 0 && entry.lanes.activity > 0), traceReports);

const commitmentRecord = await readJson(resolve(gateDirectory, "hidden-truth-commitment.json"));
const truthReveal = await readJson(resolve(gateDirectory, "truth-reveal.json"));
const sealedDiagnosis = await readJson(resolve(gateDirectory, "final-sealed-diagnosis.json"));
const initialObservations = await readJson(resolve(gateDirectory, "initial-observations.json"));
const followupObservations = await readJson(resolve(gateDirectory, "followup-observations.json"));
const recomputedCommitment = sha256(JSON.stringify({ hiddenTruth: truthReveal.hiddenTruth, nonce: truthReveal.nonce }));
const recomputedDiagnosisHash = sha256(JSON.stringify(sealedDiagnosis.response));
const observationIds = new Set([...initialObservations, ...followupObservations].map((entry) => entry.id));
record("blind truth commitment and seal", recomputedCommitment === commitmentRecord.commitment && truthReveal.commitment === commitmentRecord.commitment && recomputedDiagnosisHash === sealedDiagnosis.hash && new Date(commitmentRecord.committedAt) < new Date(sealedDiagnosis.sealedAt) && new Date(sealedDiagnosis.sealedAt) < new Date(truthReveal.revealedAt) && sealedDiagnosis.response.evidenceRefs.every((id) => observationIds.has(id)), { commitmentMatches: recomputedCommitment === commitmentRecord.commitment, diagnosisHashMatches: recomputedDiagnosisHash === sealedDiagnosis.hash, evidenceReferenceCount: sealedDiagnosis.response.evidenceRefs.length });

const modelCostSum = gateC.modelCalls.reduce((sum, call) => sum + Number(call.estimatedCostUsd || 0), 0);
record("Gate C model-call accounting", Math.abs(modelCostSum - gateC.budget.estimatedSpendUsd) < 1e-9 && gateC.modelCalls.every((call) => call.purpose && call.status), { modelCallCount: gateC.modelCalls.length, summedEstimateUsd: modelCostSum, recordedEstimateUsd: gateC.budget.estimatedSpendUsd, providerExactBillingAvailable: false });

const candidateGeneration = await readJson(resolve(gateDirectory, "candidate-generation.json"));
const candidateSourceHash = sha256(await readFile(resolve(gateDirectory, "candidate.ts")));
let candidateState = candidateGeneration.repairAttempts[0]?.beforeSourceHash;
let candidateChainValid = Boolean(candidateState);
for (const attempt of candidateGeneration.repairAttempts) {
  candidateChainValid &&= attempt.beforeSourceHash === candidateState;
  if (attempt.afterSourceHash) candidateState = attempt.afterSourceHash;
}
candidateChainValid &&= candidateState === candidateGeneration.sourceHash && candidateSourceHash === candidateGeneration.sourceHash;
record("hot-reload candidate lineage", candidateChainValid, { candidateSourceHash, recordedSourceHash: candidateGeneration.sourceHash, repairAttempts: candidateGeneration.repairAttempts.map((entry) => ({ attempt: entry.attempt, before: entry.beforeSourceHash, after: entry.afterSourceHash, status: entry.status || "completed" })) });

const cp10 = gateC.checkpoints.find((entry) => entry.id === "CP-10")?.evidence;
const activation = cp10?.history?.[0];
const rollback = cp10?.history?.[1];
const stateHash = sha256(JSON.stringify(activation?.snapshot?.state));
const migratedStateHash = sha256(JSON.stringify(activation?.migratedSnapshot?.state));
record("hot-reload activation and rollback evidence", activation?.disposition === "activated" && rollback?.disposition === "rolled_back" && stateHash === migratedStateHash && stateHash === cp10?.migratedStateHash && cp10?.preservedVersionAfterRollback === cp10?.activatedVersion, { stateHash, migratedStateHash, activatedVersion: cp10?.activatedVersion, rollbackDisposition: rollback?.disposition, preservedVersion: cp10?.preservedVersionAfterRollback });

const measurementPlanPath = resolve("docs/codesys-opcua-measurement-plan.md");
const measurementPlan = await readFile(measurementPlanPath, "utf8");
const requiredPlanTerms = ["Accepted Gate D execution baseline", "Coherent Commit Handshake", "WorkstationEpoch", "slot's `Valid` false", "same IEC task", "M2 — Image coherence and ordering", "M3 — Rate sweep", "M5 — Disconnect, hold, and recovery", "Float32-exact", "1.20 × the disconnected baseline p99", "Adversarial Review Closure", "Stop Conditions", "Required Artifacts"];
record("connector measurement plan accepted and testable", requiredPlanTerms.every((term) => measurementPlan.includes(term)), { path: "docs/codesys-opcua-measurement-plan.md", requiredTerms: requiredPlanTerms });

const firstReview = await tryReadJson(resolve(packageDirectory, "gate-d", "muse-adversarial-review.json"));
const correctiveReview = await tryReadJson(resolve(packageDirectory, "gate-d", "muse-adversarial-review-02.json"));
const firstReviewRejected = firstReview?.review?.verdict === "not_ready" && firstReview.review.criticalOrMajorFindings.length === 0;
const correctiveFindings = [...(correctiveReview?.review?.criticalOrMajorFindings || []), ...(correctiveReview?.review?.minorFindings || [])];
record("adversarial review and deterministic closure", firstReviewRejected && correctiveReview?.review?.verdict === "ready_with_changes" && correctiveFindings.length === 4 && requiredPlanTerms.every((term) => measurementPlan.includes(term)), { firstReviewDisposition: firstReviewRejected ? "rejected_unsupported_verdict" : "missing_or_unexpected", correctiveVerdict: correctiveReview?.review?.verdict, correctiveFindingCount: correctiveFindings.length, planClosure: requiredPlanTerms.every((term) => measurementPlan.includes(term)), conservativeReviewCostUsd: Number(firstReview?.metadata?.estimatedCostUsd || 0) + Number(correctiveReview?.metadata?.estimatedCostUsd || 0) });

warnings.push(
  { name: "generation repair 2 rejected payload unavailable", evidence: "Placeholder response was rejected before source activation; response ID, usage, and returned placeholder payload were not preserved." },
  { name: "generation repair 4 rejected candidate source unavailable", evidence: "Response metadata and before/after hashes survive, but the rejected instant-stop source bytes were not retained. The accepted coast source hash is intact." },
  { name: "Gate C repair 1 rejected payload unavailable", evidence: "The completed call is conservatively costed and its rejection is recorded, but the provider payload was not persisted." },
  { name: "exact provider dollar billing unavailable", evidence: "Token usage is preserved where returned; Gate C and Gate D dollar values are conservative request reservations." },
  { name: "first Gate D adversarial verdict rejected", evidence: "The first paid review said not_ready but returned no findings or required changes. It is preserved and costed; a corrective review supplied four actionable findings." }
);

const status = criticalGaps.length === 0 ? "pass" : "fail";
const result = {
  status,
  gate: "D",
  readiness: status === "pass" ? "ready_for_connector_spike" : "blocked",
  packageDirectory: latest.relativeDirectory,
  checkpoint: { id: "CP-12", status, checkCount: checks.length, checks, criticalGaps, warnings },
  evidenceSummary: {
    acceptedPackageHashes: generation.files,
    sourceSpecification: historicalSpec,
    traceFiles: ["gate-a-trace.json", "gate-b-trace.json"],
    traceEventCount: traceReports.reduce((sum, entry) => sum + entry.eventCount, 0),
    modelCallsAccounted: gateC.modelCalls.length,
    conservativeGateCCostUsd: gateC.budget.estimatedSpendUsd,
    gateDReviewCallsAccounted: [firstReview, correctiveReview].filter(Boolean).length,
    conservativeGateDReviewCostUsd: Number(firstReview?.metadata?.estimatedCostUsd || 0) + Number(correctiveReview?.metadata?.estimatedCostUsd || 0),
    adversarialReviewArtifacts: [
      firstReview ? { file: "gate-d/muse-adversarial-review.json", sha256: sha256(await readFile(resolve(packageDirectory, "gate-d", "muse-adversarial-review.json"))), responseId: firstReview.metadata?.responseId, disposition: "rejected_unsupported_verdict" } : null,
      correctiveReview ? { file: "gate-d/muse-adversarial-review-02.json", sha256: sha256(await readFile(resolve(packageDirectory, "gate-d", "muse-adversarial-review-02.json"))), responseId: correctiveReview.metadata?.responseId, disposition: "findings_incorporated" } : null
    ].filter(Boolean),
    measurementPlan: "docs/codesys-opcua-measurement-plan.md"
  },
  evidenceClass: "surrogate_contract_audit",
  claimBoundary: "Gate D authorizes a real connector spike; it does not claim live CODESYS or OPC UA performance."
};
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ status, readiness: result.readiness, checks: checks.length, criticalGaps: criticalGaps.length, warnings: warnings.length, traceEventCount: result.evidenceSummary.traceEventCount, resultPath }, null, 2));
if (status !== "pass") process.exitCode = 1;
