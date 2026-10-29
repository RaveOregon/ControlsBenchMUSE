import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error("MODEL_API_KEY is not set");
const model = process.env.META_MODEL?.trim() || "muse-wonder-1.0";
const baseUrl = (process.env.META_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/$/, "");
const latest = JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8"));
const packageDirectory = resolve(latest.relativeDirectory);
const outputDirectory = resolve(packageDirectory, "gate-d");
const retry = process.argv.includes("--retry");
const outputPath = resolve(outputDirectory, retry ? "muse-adversarial-review-02.json" : "muse-adversarial-review.json");
const force = process.argv.includes("--force");
if (!force) {
  try {
    await readFile(outputPath, "utf8");
    throw new Error(`Review already exists at ${outputPath}; refusing to spend twice without --force`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const audit = JSON.parse(await readFile(resolve(packageDirectory, "gate-d-result.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(packageDirectory, "world.manifest.json"), "utf8"));
const gateC = JSON.parse(await readFile(resolve(packageDirectory, "gate-c-result.json"), "utf8"));
const measurementPlan = await readFile(resolve("docs/codesys-opcua-measurement-plan.md"), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const estimatedCostUsd = 0.5;

const auditDigest = {
  status: audit.status,
  readiness: audit.readiness,
  checks: audit.checkpoint.checks.map((entry) => ({ name: entry.name, passed: entry.passed, severity: entry.severity, evidence: entry.evidence })),
  criticalGaps: audit.checkpoint.criticalGaps,
  warnings: audit.checkpoint.warnings,
  evidenceSummary: audit.evidenceSummary,
  claimBoundary: audit.claimBoundary
};
const gateCDigest = {
  status: gateC.status,
  checkpoints: gateC.checkpoints.map((entry) => ({ id: entry.id, status: entry.status, evidence: entry.evidence })),
  budget: gateC.budget,
  modelCalls: gateC.modelCalls.map((entry) => ({ purpose: entry.purpose, status: entry.status, estimatedCostUsd: entry.estimatedCostUsd, responseIdPresent: Boolean(entry.responseId) }))
};
const cp8 = gateC.checkpoints.find((entry) => entry.id === "CP-8").evidence;
const cp9 = gateC.checkpoints.find((entry) => entry.id === "CP-9").evidence;
const cp10 = gateC.checkpoints.find((entry) => entry.id === "CP-10").evidence;
const cp11 = gateC.checkpoints.find((entry) => entry.id === "CP-11").evidence;
const explicitAdjudication = {
  cp8: { verdict: cp8.scoring.outcome, sealedDiagnosisHash: cp8.sealedDiagnosisHash, truthCommittedBeforeSeal: cp8.truthRevealedAfterSeal, targetMatch: cp8.scoring.targetMatch, exactTaxonomyMatch: cp8.scoring.exactTaxonomyMatch, evidenceRefs: cp8.evidenceRefs },
  cp9: { objective: cp9.objective, modelAuthoredActions: cp9.actions, initialConfidence: cp9.initialConfidence, finalConfidence: cp9.finalConfidence, exposedDiscrepancy: cp9.exposedDiscrepancy },
  cp10: { compiled: cp10.compiled, migratedStateHash: cp10.migratedStateHash, activatedVersion: cp10.activatedVersion, revisionEvidenceObserved: cp10.revisionEvidenceObserved, failingCandidateDisposition: cp10.failingCandidateDisposition, preservedVersionAfterRollback: cp10.preservedVersionAfterRollback, transitions: cp10.history.map((entry) => ({ candidateVersion: entry.candidateVersion, previousVersion: entry.previousVersion, disposition: entry.disposition, reason: entry.reason })) },
  cp11
};
const manifestDigest = {
  packageVersion: manifest.packageVersion,
  stateSchemaVersion: manifest.stateSchemaVersion,
  tickMs: manifest.tickMs,
  signals: manifest.signals.map((entry) => ({ id: entry.id, role: entry.role, direction: entry.direction, dataType: entry.dataType, normalValue: entry.normalValue })),
  controls: manifest.controls,
  faultCapabilities: manifest.faultCapabilities,
  evidenceTypes: manifest.evidenceTypes,
  capabilities: manifest.capabilities
};

const prompt = `Act as an adversarial controls-engineering and evidence reviewer for ControlsBench Muse. Do not reward ambition or presentation. Look for a reason the Gate D readiness claim is invalid, an experiment that cannot distinguish its intended failure mode, an OPC UA/CODESYS coherence mistake, a threshold that could pass a bad connector, or a provenance gap that undermines the claim.

Important boundaries:
- This gate claims only readiness to begin a real CODESYS/OPC UA connector spike, not that live integration has passed.
- The deterministic audit is primary. Your review is independent challenge evidence, not authority to rewrite passing physics.
- Treat disclosed missing rejected artifacts differently from missing accepted source or verdict evidence.
- The PLC must receive raw signal images, while the workstation retains world/runtime/campaign ownership.
- Return a strict verdict and concrete required changes. Do not propose product UI or unrelated scope.
- CP-8 through CP-11 adjudication is explicitly supplied below. Do not claim it is unavailable. The audit's claim is readiness to begin a connector spike, not a new world-plausibility claim.
- A not_ready verdict requires at least one critical or major finding with supplied evidence and a required change. ready_with_changes requires at least one major or minor finding. If no concrete issue is supported, return ready.

DETERMINISTIC AUDIT
${JSON.stringify(auditDigest, null, 2)}

GENERATED WORLD MANIFEST DIGEST
${JSON.stringify(manifestDigest, null, 2)}

GATE C DIGEST
${JSON.stringify(gateCDigest, null, 2)}

EXPLICIT INDIVIDUAL CP-8 THROUGH CP-11 ADJUDICATION
${JSON.stringify(explicitAdjudication, null, 2)}

PROPOSED CONNECTOR MEASUREMENT PLAN
${measurementPlan}`;

const finding = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    area: { type: "string", enum: ["audit_provenance", "handshake_coherence", "timing", "fault_recovery", "raw_io_fidelity", "evidence", "scope_claim"] },
    severity: { type: "string", enum: ["critical", "major", "minor"] },
    finding: { type: "string" },
    evidence: { type: "string" },
    requiredChange: { type: "string" }
  },
  required: ["id", "area", "severity", "finding", "evidence", "requiredChange"]
};
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["ready", "ready_with_changes", "not_ready"] },
    verdictRationale: { type: "string" },
    criticalOrMajorFindings: { type: "array", items: finding },
    minorFindings: { type: "array", items: finding },
    missingExperiments: { type: "array", items: { type: "string" } },
    strongestEvidence: { type: "array", items: { type: "string" } },
    claimBoundaryAssessment: { type: "string" }
  },
  required: ["verdict", "verdictRationale", "criticalOrMajorFindings", "minorFindings", "missingExperiments", "strongestEvidence", "claimBoundaryAssessment"]
};

function extractText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text" || item.type === "text").map((item) => item.text || "").join("");
}

const began = Date.now();
console.log(`[gate-d-review] one bounded ${model} request started`);
const response = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  body: JSON.stringify({
    model,
    reasoning: { effort: "high", summary: "auto" },
    max_output_tokens: 8000,
    input: [
      { role: "developer", content: "Adversarially review industrial test evidence and a connector measurement plan. Be concrete, skeptical, and bounded to the supplied readiness claim." },
      { role: "user", content: prompt }
    ],
    text: { format: { type: "json_schema", name: "controlsbench_gate_d_adversarial_review", description: "Adversarial Gate D review", strict: true, schema } }
  }),
  signal: AbortSignal.timeout(300_000)
});
const raw = await response.text();
if (!response.ok) throw new Error(`Meta Model API returned ${response.status}: ${raw.slice(0, 2000)}`);
const payload = JSON.parse(raw);
const review = JSON.parse(extractText(payload));
if (review.verdict === "not_ready" && review.criticalOrMajorFindings.length === 0) throw new Error("Rejected inconsistent review: not_ready requires a critical or major finding");
if (review.verdict === "ready_with_changes" && review.criticalOrMajorFindings.length + review.minorFindings.length === 0) throw new Error("Rejected inconsistent review: ready_with_changes requires a finding");
const artifact = {
  review,
  metadata: {
    purpose: "gate_d_adversarial_review",
    responseId: payload.id || null,
    model: payload.model || model,
    status: payload.status || null,
    durationMs: Date.now() - began,
    usage: payload.usage || null,
    estimatedCostUsd,
    promptHash: sha256(prompt),
    responseHash: sha256(JSON.stringify(review))
  },
  reviewedArtifacts: {
    auditHash: sha256(JSON.stringify(auditDigest)),
    manifestHash: sha256(JSON.stringify(manifestDigest)),
    gateCHash: sha256(JSON.stringify(gateCDigest)),
    measurementPlanHash: sha256(measurementPlan)
  }
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ verdict: review.verdict, criticalOrMajorFindings: review.criticalOrMajorFindings.length, minorFindings: review.minorFindings.length, missingExperiments: review.missingExperiments.length, metadata: artifact.metadata, outputPath }, null, 2));
