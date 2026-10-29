import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BudgetLimitError, ModelBudgetGuard } from "../src/proof/budget-guard.ts";
import { HotReloadCoordinator } from "../src/proof/hot-reload.ts";
import { validateManifest, signalByRole } from "../src/proof/manifest.ts";
import { InstrumentedWorldContext } from "../src/proof/world-context.ts";

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error("MODEL_API_KEY is not set. Gate C makes bounded Muse calls.");
const model = process.env.META_MODEL?.trim() || "muse-wonder-1.0";
const baseUrl = (process.env.META_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/$/, "");
const latest = process.argv[2]
  ? { relativeDirectory: process.argv[2] }
  : JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8"));
const packageDirectory = resolve(latest.relativeDirectory);
const gateDirectory = resolve(packageDirectory, "gate-c");
const resultPath = resolve(packageDirectory, "gate-c-result.json");
const worldPath = resolve(packageDirectory, "world.ts");
const manifest = validateManifest(JSON.parse(await readFile(resolve(packageDirectory, "world.manifest.json"), "utf8")));
const checkpoints = [];
const modelCalls = [];
const startedAt = Date.now();

const limits = {
  perRequestUsd: 1,
  repairEpisodeUsd: 2,
  campaignWarningUsd: 3,
  campaignHardUsd: 5,
  sessionHardUsd: 15,
  requestTimeoutMs: 300_000,
  failedRepairWarning: 3,
  failedRepairHard: 5,
  worldHeartbeatStaleMs: 2_000
};
const liveBudget = new ModelBudgetGuard(limits);

function status(message) {
  console.log(`[gate-c +${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${message}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

function adjudicateBlindDiagnosis(finalResponse, hiddenTruth) {
  const diagnosis = finalResponse.finalDiagnosis;
  const exact = diagnosis.faultFamily === hiddenTruth.faultFamily
    && diagnosis.targetRole === hiddenTruth.targetRole
    && diagnosis.failureMode === hiddenTruth.failureMode;
  if (exact) return { outcome: "correct", exactTaxonomyMatch: true, targetMatch: true, leadingMechanismMatch: true };
  const explanation = `${diagnosis.explanation || ""} ${finalResponse.uncertaintyReduction?.explanation || ""}`.toLowerCase();
  const targetMatch = diagnosis.targetRole === hiddenTruth.targetRole;
  const leadingMechanismMatch = explanation.includes("stuck") && explanation.includes("entry");
  const explicitlyUncertain = diagnosis.faultFamily === "unknown" || diagnosis.failureMode === "unknown";
  if (targetMatch && leadingMechanismMatch && explicitlyUncertain) {
    return { outcome: "insufficient_evidence", exactTaxonomyMatch: false, targetMatch, leadingMechanismMatch };
  }
  return { outcome: "incorrect", exactTaxonomyMatch: false, targetMatch, leadingMechanismMatch };
}

function extractText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" || item.type === "text")
    .map((item) => item.text || "")
    .join("");
}

async function callMuse({ purpose, prompt, schema, maxOutputTokens, estimatedCostUsd }) {
  const lease = liveBudget.reserve({ purpose, estimatedCostUsd, nowMs: Date.now() });
  const request = {
    model,
    reasoning: { effort: "high", summary: "auto" },
    max_output_tokens: maxOutputTokens,
    input: [
      { role: "developer", content: "You are the active controls commissioning intelligence inside ControlsBench. Use only supplied observations, cite evidence IDs, expose uncertainty, and never assume hidden fault truth." },
      { role: "user", content: prompt }
    ],
    text: { format: { type: "json_schema", name: purpose.replace(/[^a-z0-9_]/gi, "_"), description: purpose, strict: true, schema } }
  };
  status(`Muse request started: ${purpose}`);
  const callStartedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(limits.requestTimeoutMs)
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Meta Model API returned ${response.status}: ${raw.slice(0, 2000)}`);
    const payload = JSON.parse(raw);
    const parsed = JSON.parse(extractText(payload));
    liveBudget.settle(lease.id, estimatedCostUsd);
    const metadata = {
      purpose,
      responseId: payload.id || null,
      model: payload.model || model,
      status: payload.status || null,
      durationMs: Date.now() - callStartedAt,
      usage: payload.usage || null,
      estimatedCostUsd,
      promptHash: sha256(prompt),
      responseHash: sha256(JSON.stringify(parsed))
    };
    modelCalls.push(metadata);
    status(`Muse request completed: ${purpose}`);
    return { parsed, metadata };
  } catch (error) {
    try { liveBudget.fail(lease.id); } catch { /* preserve original error */ }
    throw error;
  }
}

async function checkpoint(id, exercise) {
  status(`${id} running`);
  const began = Date.now();
  try {
    const evidence = await exercise();
    checkpoints.push({ id, status: "pass", durationMs: Date.now() - began, evidence });
    status(`${id} passed`);
    return evidence;
  } catch (error) {
    checkpoints.push({ id, status: "fail", durationMs: Date.now() - began, error: error instanceof Error ? error.stack : String(error) });
    status(`${id} failed: ${error instanceof Error ? error.message : error}`);
    throw error;
  }
}

async function createHarness(label, modulePath = worldPath) {
  const imported = await import(`${pathToFileURL(modulePath).href}?gateC=${label}-${Date.now()}-${Math.random()}`);
  const world = imported.default || imported.world;
  assert(world, `World module missing for ${label}`);
  validateManifest(world.manifest);
  const seed = 20261029;
  const ctx = new InstrumentedWorldContext(world.manifest, { seed, worldVersion: world.manifest.packageVersion });
  let frameSequence = 0;
  await world.initialize(ctx, { seed, worldVersion: world.manifest.packageVersion });
  const signal = (role) => signalByRole(world.manifest, role);
  const input = (role) => ctx.plc.currentInputState()[signal(role).id];
  const output = (role) => ctx.plc.currentOutputFrame().values[signal(role).id];
  const send = async (roleValues) => {
    const values = Object.fromEntries(Object.entries(roleValues).map(([role, value]) => [signal(role).id, value]));
    const frame = { sequence: ++frameSequence, observedAtMs: ctx.time.nowMs, values };
    ctx.setPlcFrame(frame);
    await world.onPlcFrame(ctx, frame);
  };
  const control = async (id, payload, cause) => {
    const command = { id, payload, cause };
    ctx.recordControl(command);
    await world.onControl(ctx, command);
  };
  const tick = async () => {
    const worldTick = ctx.advance(world.manifest.tickMs);
    await world.tick(ctx, worldTick);
  };
  const ticksFor = async (durationMs) => {
    for (let index = 0; index < Math.ceil(durationMs / world.manifest.tickMs); index += 1) await tick();
  };
  return { world, ctx, signal, input, output, send, control, tick, ticksFor };
}

const observableRoles = [
  "sensor.entry", "sensor.d1Approach", "sensor.d2Approach", "sensor.exitA", "sensor.exitB", "sensor.runout",
  "drive.runningFeedback", "drive.overload", "motion.encoderCount", "diagnostic.beltSpeedActual",
  "divert1.homeFeedback", "divert1.extendedFeedback", "divert2.homeFeedback", "divert2.extendedFeedback"
];
const plcOutputRoles = ["drive.runCommand", "divert1.extendCommand", "divert2.extendCommand"];

function observation(harness, id, roles, note) {
  return {
    id,
    atMs: harness.ctx.time.nowMs,
    note,
    values: Object.fromEntries(roles.map((role) => [role, harness.signal(role).direction === "plc_to_world" ? harness.output(role) : harness.input(role)]))
  };
}

await mkdir(gateDirectory, { recursive: true });
let diagnosisState;
let coordinator;

try {
  const blindHarness = await createHarness("blind-diagnosis");
  const hiddenTruth = {
    faultFamily: "sensor_fault",
    targetRole: "sensor.entry",
    failureMode: "stuck_high",
    injectedControl: "fault.setSensorStuck"
  };
  const nonce = randomBytes(16).toString("hex");
  const commitment = sha256(JSON.stringify({ hiddenTruth, nonce }));
  const commitmentRecord = { committedAt: new Date().toISOString(), algorithm: "sha256", commitment, truthSchema: "controlsbench-hidden-fault-v1" };
  await writeFile(resolve(gateDirectory, "hidden-truth-commitment.json"), `${JSON.stringify(commitmentRecord, null, 2)}\n`);

  const entrySignalId = blindHarness.signal("sensor.entry").id;
  await blindHarness.control("fault.setSensorStuck", { signalId: entrySignalId, active: true, value: true }, "hidden committed Gate C fault");
  const initialObservations = [];
  const initialRoles = ["drive.runCommand", "drive.runningFeedback", "motion.encoderCount", "sensor.entry", "sensor.d1Approach", "sensor.d2Approach", "sensor.exitA", "sensor.exitB", "sensor.runout"];
  initialObservations.push(observation(blindHarness, "OBS-001", initialRoles, "Initial stopped-state sample"));
  await blindHarness.ticksFor(250);
  initialObservations.push(observation(blindHarness, "OBS-002", initialRoles, "Repeated stopped-state sample"));
  await blindHarness.ticksFor(250);
  initialObservations.push(observation(blindHarness, "OBS-003", initialRoles, "Third stopped-state sample"));
  await writeFile(resolve(gateDirectory, "initial-observations.json"), `${JSON.stringify(initialObservations, null, 2)}\n`);

  const hypothesisSchema = {
    type: "object", additionalProperties: false,
    properties: {
      hypothesis: { type: "string" },
      faultFamily: { type: "string", enum: ["sensor_fault", "physical_process", "drive_fault", "control_logic", "unknown"] },
      targetRole: { type: "string" },
      failureMode: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      evidenceRefs: { type: "array", items: { type: "string" } }
    },
    required: ["hypothesis", "faultFamily", "targetRole", "failureMode", "confidence", "evidenceRefs"]
  };
  const actionSchema = {
    type: "object", additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["set_plc_output", "wait_observe"] },
      role: { type: "string" },
      booleanValue: { type: "boolean" },
      durationMs: { type: "integer", minimum: 0, maximum: 5000 },
      observeRoles: { type: "array", items: { type: "string" } },
      rationale: { type: "string" }
    },
    required: ["kind", "role", "booleanValue", "durationMs", "observeRoles", "rationale"]
  };
  const initialSchema = {
    type: "object", additionalProperties: false,
    properties: {
      assessment: { type: "string" },
      hypotheses: { type: "array", minItems: 2, items: hypothesisSchema },
      currentConfidence: { type: "number", minimum: 0, maximum: 1 },
      followUp: {
        type: "object", additionalProperties: false,
        properties: {
          objective: { type: "string" },
          actions: { type: "array", minItems: 1, items: actionSchema },
          expectedDiscrimination: { type: "string" }
        },
        required: ["objective", "actions", "expectedDiscrimination"]
      }
    },
    required: ["assessment", "hypotheses", "currentConfidence", "followUp"]
  };

  const initialPrompt = `
You are diagnosing an executing conveyor bench from filtered raw observations. The hidden fault was committed before this request, but you are not given its truth. A true entry photoeye can mean a stationary carton or a sensor/device problem. Design a bounded follow-up using only ordinary PLC outputs and raw observations; you may not use fault controls, entity truth, source code, or hidden ledgers.

Available PLC output roles: ${JSON.stringify(plcOutputRoles)}
Observable raw roles: ${JSON.stringify(observableRoles)}

For each action, populate every field. For set_plc_output, set role and booleanValue; use durationMs=0 and observeRoles=[]. For wait_observe, use role="", booleanValue=false, a positive durationMs, and the raw roles to sample. Keep total waiting at or below 8 seconds. Cite only observation IDs that exist.

Initial observations:
${JSON.stringify(initialObservations, null, 2)}
`.trim();
  const initialCall = await callMuse({ purpose: "gate_c_initial_diagnosis_and_followup", prompt: initialPrompt, schema: initialSchema, maxOutputTokens: 5000, estimatedCostUsd: 0.5 });
  const initialResponse = initialCall.parsed;
  await writeFile(resolve(gateDirectory, "initial-response.json"), `${JSON.stringify({ response: initialResponse, metadata: initialCall.metadata }, null, 2)}\n`);

  const validInitialRefs = new Set(initialObservations.map((item) => item.id));
  for (const hypothesis of initialResponse.hypotheses) {
    for (const ref of hypothesis.evidenceRefs) assert(validInitialRefs.has(ref), `Initial diagnosis cited unknown evidence ${ref}`);
  }
  assert(initialResponse.followUp.actions.length > 0, "Muse proposed no follow-up actions");

  const followUpObservations = [];
  let observationSequence = 4;
  let outputActionCount = 0;
  let waitActionCount = 0;
  for (const action of initialResponse.followUp.actions) {
    if (action.kind === "set_plc_output") {
      assert(plcOutputRoles.includes(action.role), `Muse requested unavailable PLC output role ${action.role}`);
      await blindHarness.send({ [action.role]: action.booleanValue });
      outputActionCount += 1;
      continue;
    }
    assert.equal(action.kind, "wait_observe");
    assert(action.durationMs > 0, "wait_observe duration must be positive");
    assert(action.observeRoles.length > 0, "wait_observe must request raw roles");
    for (const role of action.observeRoles) assert(observableRoles.includes(role), `Muse requested unavailable observation role ${role}`);
    const sampleEveryMs = Math.max(100, blindHarness.world.manifest.tickMs);
    for (let elapsed = 0; elapsed <= action.durationMs; elapsed += sampleEveryMs) {
      followUpObservations.push(observation(blindHarness, `OBS-${String(observationSequence++).padStart(3, "0")}`, action.observeRoles, action.rationale));
      if (elapsed < action.durationMs) await blindHarness.ticksFor(Math.min(sampleEveryMs, action.durationMs - elapsed));
    }
    waitActionCount += 1;
  }
  assert(outputActionCount > 0, "Muse follow-up did not manipulate any PLC output");
  assert(waitActionCount > 0, "Muse follow-up did not observe the result over time");
  await writeFile(resolve(gateDirectory, "followup-observations.json"), `${JSON.stringify(followUpObservations, null, 2)}\n`);

  const finalSchema = {
    type: "object", additionalProperties: false,
    properties: {
      finalDiagnosis: {
        type: "object", additionalProperties: false,
        properties: {
          faultFamily: { type: "string", enum: ["sensor_fault", "physical_process", "drive_fault", "control_logic", "unknown"] },
          targetRole: { type: "string" },
          failureMode: { type: "string", enum: ["stuck_high", "stuck_low", "bounce", "physical_carton_present", "unknown"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          explanation: { type: "string" }
        },
        required: ["faultFamily", "targetRole", "failureMode", "confidence", "explanation"]
      },
      evidenceRefs: { type: "array", minItems: 1, items: { type: "string" } },
      alternatives: { type: "array", items: { type: "string" } },
      uncertaintyReduction: {
        type: "object", additionalProperties: false,
        properties: {
          beforeConfidence: { type: "number", minimum: 0, maximum: 1 },
          afterConfidence: { type: "number", minimum: 0, maximum: 1 },
          explanation: { type: "string" }
        },
        required: ["beforeConfidence", "afterConfidence", "explanation"]
      }
    },
    required: ["finalDiagnosis", "evidenceRefs", "alternatives", "uncertaintyReduction"]
  };
  const finalPrompt = `
Update the diagnosis after the follow-up you designed was executed against the same live world. The hidden fault is still withheld. Cite exact evidence IDs. Do not claim certainty beyond the observations.

Initial observations:
${JSON.stringify(initialObservations, null, 2)}

Your sealed initial response:
${JSON.stringify(initialResponse, null, 2)}

Follow-up observations:
${JSON.stringify(followUpObservations, null, 2)}
`.trim();
  const finalCall = await callMuse({ purpose: "gate_c_final_blind_diagnosis", prompt: finalPrompt, schema: finalSchema, maxOutputTokens: 4000, estimatedCostUsd: 0.5 });
  const finalResponse = finalCall.parsed;
  const sealedDiagnosis = { sealedAt: new Date().toISOString(), hash: sha256(JSON.stringify(finalResponse)), response: finalResponse, metadata: finalCall.metadata };
  await writeFile(resolve(gateDirectory, "final-sealed-diagnosis.json"), `${JSON.stringify(sealedDiagnosis, null, 2)}\n`);

  const allObservationIds = new Set([...initialObservations, ...followUpObservations].map((item) => item.id));
  for (const ref of finalResponse.evidenceRefs) assert(allObservationIds.has(ref), `Final diagnosis cited unknown evidence ${ref}`);
  const revealedCommitment = sha256(JSON.stringify({ hiddenTruth, nonce }));
  assert.equal(revealedCommitment, commitment, "Hidden truth reveal does not match pre-run commitment");
  const truthReveal = { revealedAt: new Date().toISOString(), hiddenTruth, nonce, commitment, verified: true };
  await writeFile(resolve(gateDirectory, "truth-reveal.json"), `${JSON.stringify(truthReveal, null, 2)}\n`);
  diagnosisState = { blindHarness, initialObservations, initialResponse, followUpObservations, finalResponse, hiddenTruth, commitment };

  await checkpoint("CP-8", async () => {
    const scoring = adjudicateBlindDiagnosis(finalResponse, hiddenTruth);
    assert.notEqual(scoring.outcome, "incorrect", "blind diagnosis was neither correct nor appropriately inconclusive");
    assert(finalResponse.evidenceRefs.length > 0, "blind diagnosis cited no evidence");
    return {
      commitment,
      sealedDiagnosisHash: sealedDiagnosis.hash,
      diagnosis: finalResponse.finalDiagnosis,
      scoring,
      evidenceRefs: finalResponse.evidenceRefs,
      truthRevealedAfterSeal: true
    };
  });

  await checkpoint("CP-9", async () => {
    const before = initialResponse.currentConfidence;
    const after = finalResponse.finalDiagnosis.confidence;
    const encoderValues = followUpObservations.map((item) => Number(item.values["motion.encoderCount"])).filter(Number.isFinite);
    const entryValues = followUpObservations.map((item) => item.values["sensor.entry"]);
    const downstreamRoles = ["sensor.d1Approach", "sensor.d2Approach", "sensor.exitA", "sensor.exitB", "sensor.runout"];
    const exposedDiscrepancy = encoderValues.length > 1 && Math.max(...encoderValues) > Math.min(...encoderValues)
      && entryValues.length > 1 && entryValues.every((value) => value === true)
      && followUpObservations.every((item) => downstreamRoles.every((role) => item.values[role] === undefined || item.values[role] === false));
    const confidenceGain = after - before;
    assert(confidenceGain >= 0.15 || exposedDiscrepancy, "Muse follow-up did not materially reduce uncertainty or expose a useful discrepancy");
    return {
      objective: initialResponse.followUp.objective,
      actions: initialResponse.followUp.actions,
      initialConfidence: before,
      finalConfidence: after,
      confidenceGain,
      exposedDiscrepancy,
      sameWorldFinalTimeMs: blindHarness.ctx.time.nowMs
    };
  });

  await checkpoint("CP-10", async () => {
    const candidateSchema = {
      type: "object", additionalProperties: false,
      properties: { rationale: { type: "string" }, candidateTs: { type: "string" } },
      required: ["rationale", "candidateTs"]
    };
    const candidatePrompt = `
Create a complete TypeScript hot-reload candidate wrapper for the existing generated world. This is an evidence-only revision for validating state migration; do not alter physics, raw signals, controls, timing, or fault behavior.

Requirements:
- File location is gate-c/candidate.ts inside the generated package.
- Import type GeneratedWorldModule from "../../../../src/proof/contracts.ts".
- Import the existing default world from "../world.ts".
- Clone its manifest, change only packageVersion to "0.5.1-gate-c", and append evidence type "world.revisionObserved".
- Delegate initialize, onPlcFrame, tick, migrate, and dispose to the base world.
- Implement snapshot as async, await the base snapshot, preserve its state and stateSchemaVersion, and override only worldVersion with "0.5.1-gate-c".
- Implement onControl with the declared (ctx, control) signature: await the base handler, then call ctx.evidence.append with a valid EvidenceEvent whose data contains control.id and the revision. Never mutate ctx.events directly or probe generic sinks.
- Export named const world and default world.
- Return complete source, not a patch or markdown fence.

Existing manifest:
${JSON.stringify(manifest, null, 2)}
`.trim();
    const candidateCall = await callMuse({ purpose: "gate_c_hot_reload_candidate", prompt: candidatePrompt, schema: candidateSchema, maxOutputTokens: 8000, estimatedCostUsd: 0.75 });
    const candidateSource = candidateCall.parsed.candidateTs;
    assert(candidateSource.includes("0.5.1-gate-c"), "Muse candidate omitted required version");
    assert(candidateSource.includes("world.revisionObserved"), "Muse candidate omitted revision evidence behavior");
    assert(!/\bfetch\s*\(|node:fs|\beval\s*\(|new\s+Function\s*\(/.test(candidateSource), "Muse candidate used forbidden capability");
    const candidatePath = resolve(gateDirectory, "candidate.ts");
    const candidateTsConfig = {
      extends: "../../../../tsconfig.json",
      compilerOptions: { noEmit: true, allowImportingTsExtensions: true },
      include: ["candidate.ts", "../world.ts"]
    };
    await Promise.all([
      writeFile(candidatePath, candidateSource),
      writeFile(resolve(gateDirectory, "candidate-generation.json"), `${JSON.stringify({ rationale: candidateCall.parsed.rationale, metadata: candidateCall.metadata, sourceHash: sha256(candidateSource) }, null, 2)}\n`),
      writeFile(resolve(gateDirectory, "tsconfig.json"), `${JSON.stringify(candidateTsConfig, null, 2)}\n`)
    ]);
    execFileSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", resolve(gateDirectory, "tsconfig.json")], { cwd: resolve("."), stdio: "pipe" });

    const incumbent = await createHarness("hot-reload-incumbent");
    await incumbent.send({ "drive.runCommand": true });
    await incumbent.ticksFor(500);
    await incumbent.control("carton.introduce", { itemId: "HOT-RELOAD-CARTON", requestedRoute: null }, "Gate C state migration fixture");
    await incumbent.ticksFor(400);
    const beforeSnapshot = await incumbent.world.snapshot(incumbent.ctx);
    const beforeStateHash = sha256(JSON.stringify(beforeSnapshot.state));
    coordinator = new HotReloadCoordinator({ versionId: incumbent.world.manifest.packageVersion, module: incumbent.world, context: incumbent.ctx });

    const candidateHarness = await createHarness("hot-reload-candidate", candidatePath);
    const incumbentFrame = incumbent.ctx.plc.currentOutputFrame();
    const activation = await coordinator.attemptActivation({
      candidateVersion: "0.5.1-gate-c",
      candidate: candidateHarness.world,
      candidateContext: candidateHarness.ctx,
      healthCheck: async (candidate, context, migrated) => {
        assert.equal(sha256(JSON.stringify(migrated.state)), beforeStateHash, "candidate migration changed incumbent state");
        const frame = { ...incumbentFrame, sequence: Math.max(1, incumbentFrame.sequence) };
        context.setPlcFrame(frame);
        await candidate.onPlcFrame(context, frame);
        const snapshot = await candidate.snapshot(context);
        assert(snapshot.state !== undefined, "candidate shadow snapshot missing state");
      }
    });
    assert.equal(activation.activated, true, `valid candidate did not activate: ${activation.record.reason}`);
    const activeControl = { id: "carton.introduce", payload: { itemId: "POST-RELOAD", requestedRoute: null }, cause: "Gate C verifies candidate evidence behavior" };
    coordinator.active.context.recordControl(activeControl);
    await coordinator.active.module.onControl(coordinator.active.context, activeControl);
    const revisionEvent = coordinator.active.context.events.find((event) => event.lane === "evidence" && event.data.event?.type === "world.revisionObserved");
    assert(revisionEvent, "activated Muse candidate did not emit its revised evidence behavior");

    const failingBase = await createHarness("hot-reload-failing-base");
    const failingCandidate = {
      ...failingBase.world,
      manifest: { ...failingBase.world.manifest, packageVersion: "0.5.2-failing" },
      async migrate() { throw new Error("deliberate Gate C migration failure"); }
    };
    const activeBeforeFailure = coordinator.active.versionId;
    const failedActivation = await coordinator.attemptActivation({
      candidateVersion: "0.5.2-failing",
      candidate: failingCandidate,
      candidateContext: failingBase.ctx,
      healthCheck: async () => { throw new Error("failing candidate must not reach health check"); }
    });
    assert.equal(failedActivation.activated, false, "deliberately failing candidate activated");
    assert.equal(coordinator.active.versionId, activeBeforeFailure, "rollback did not preserve last healthy candidate");
    assert.equal(failedActivation.record.disposition, "rolled_back");
    return {
      candidateSourceHash: sha256(candidateSource),
      compiled: true,
      migratedStateHash: beforeStateHash,
      activatedVersion: activation.record.candidateVersion,
      revisionEvidenceObserved: true,
      failingCandidateDisposition: failedActivation.record.disposition,
      preservedVersionAfterRollback: coordinator.active.versionId,
      history: coordinator.history
    };
  });

  await checkpoint("CP-11", async () => {
    const guard = new ModelBudgetGuard(limits);
    const slow = guard.reserve({ purpose: "simulated slow request", estimatedCostUsd: 0.5, nowMs: 0 });
    const beforeTimeout = guard.checkRequest(slow.id, limits.requestTimeoutMs - 1);
    const atTimeout = guard.checkRequest(slow.id, limits.requestTimeoutMs);
    const repairs = [1, 2, 3, 4, 5].map(() => guard.recordRepairFailure("gate-c-simulated-repair"));
    const exhausted = new ModelBudgetGuard(limits);
    exhausted.campaignSpentUsd = 4.6;
    let budgetStopCode = "";
    try {
      exhausted.reserve({ purpose: "would exceed campaign", estimatedCostUsd: 0.5, nowMs: 0 });
    } catch (error) {
      assert(error instanceof BudgetLimitError);
      budgetStopCode = error.code;
    }
    const stalled = guard.classifyRuntime({ nowMs: 5_000, lastWorldHeartbeatAtMs: 0 });
    const heldWait = guard.classifyRuntime({ nowMs: 1_000, lastWorldHeartbeatAtMs: 900, conditionWait: { description: "PE_Entry clears", startedAtMs: 0, timeoutMs: 2_000 } });
    const waitTimeout = guard.classifyRuntime({ nowMs: 2_100, lastWorldHeartbeatAtMs: 2_000, conditionWait: { description: "PE_Entry clears", startedAtMs: 0, timeoutMs: 2_000 } });
    assert.equal(beforeTimeout, "active");
    assert.equal(atTimeout, "timed_out");
    assert.deepEqual(repairs, ["continue", "continue", "warning", "warning", "hard_stop"]);
    assert.equal(budgetStopCode, "campaign_limit");
    assert.equal(stalled.state, "world_stalled");
    assert.equal(heldWait.state, "waiting_condition");
    assert.equal(waitTimeout.state, "condition_timeout");
    assert(coordinator, "hot reload coordinator was not available for preservation check");
    return {
      requestStates: { beforeTimeout, atTimeout },
      repairFailureStates: repairs,
      budgetStopCode,
      runtimeStates: { stalled, heldWait, waitTimeout },
      preservedWorldVersion: coordinator.active.versionId,
      liveCallEstimatedSpendUsd: liveBudget.campaignSpentUsd,
      providerBillingNote: "Model API response did not include dollar cost; conservative request reservations are recorded separately from provider token usage."
    };
  });

  const result = {
    status: "pass",
    packageDirectory: latest.relativeDirectory,
    durationMs: Date.now() - startedAt,
    checkpoints,
    modelCalls,
    budget: {
      estimatedSpendUsd: liveBudget.campaignSpentUsd,
      campaignLevel: liveBudget.campaignLevel(),
      limits
    },
    hiddenTruthCommitment: diagnosisState.commitment
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  status(`Gate C passed; result written to ${resultPath}`);
} catch (error) {
  const result = {
    status: "fail",
    packageDirectory: latest.relativeDirectory,
    durationMs: Date.now() - startedAt,
    checkpoints,
    modelCalls,
    budget: { estimatedSpendUsd: liveBudget.campaignSpentUsd, campaignLevel: liveBudget.campaignLevel(), limits },
    error: error instanceof Error ? error.stack : String(error)
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 1;
}
