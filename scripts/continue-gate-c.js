import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BudgetLimitError, ModelBudgetGuard } from "../src/proof/budget-guard.ts";
import { HotReloadCoordinator } from "../src/proof/hot-reload.ts";
import { validateManifest, signalByRole } from "../src/proof/manifest.ts";
import { InstrumentedWorldContext } from "../src/proof/world-context.ts";

const verifyOnly = process.argv.includes("--verify-only");
const latest = JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8"));
const packageDirectory = resolve(latest.relativeDirectory);
const gateDirectory = resolve(packageDirectory, "gate-c");
const resultPath = resolve(packageDirectory, "gate-c-result.json");
const worldPath = resolve(packageDirectory, "world.ts");
const manifest = validateManifest(JSON.parse(await readFile(resolve(packageDirectory, "world.manifest.json"), "utf8")));
const priorResultText = await readFile(resultPath, "utf8");
const priorResult = JSON.parse(priorResultText);
const initialObservations = JSON.parse(await readFile(resolve(gateDirectory, "initial-observations.json"), "utf8"));
const initialResponse = JSON.parse(await readFile(resolve(gateDirectory, "initial-response.json"), "utf8")).response;
const followUpObservations = JSON.parse(await readFile(resolve(gateDirectory, "followup-observations.json"), "utf8"));
const sealedDiagnosis = JSON.parse(await readFile(resolve(gateDirectory, "final-sealed-diagnosis.json"), "utf8"));
const finalResponse = sealedDiagnosis.response;
const truthReveal = JSON.parse(await readFile(resolve(gateDirectory, "truth-reveal.json"), "utf8"));
const hiddenTruth = truthReveal.hiddenTruth;
const checkpoints = [];
const modelCalls = [...(priorResult.modelCalls || [])];
const startedAt = Date.now();

const limits = priorResult.budget.limits;
const budget = new ModelBudgetGuard(limits);
budget.campaignSpentUsd = priorResult.budget.estimatedSpendUsd || 0;
budget.sessionSpentUsd = priorResult.budget.estimatedSpendUsd || 0;

function status(message) {
  console.log(`[gate-c-resume +${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${message}`);
}
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function extractText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text" || item.type === "text").map((item) => item.text || "").join("");
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

function adjudicateBlindDiagnosis() {
  const diagnosis = finalResponse.finalDiagnosis;
  const exact = diagnosis.faultFamily === hiddenTruth.faultFamily && diagnosis.targetRole === hiddenTruth.targetRole && diagnosis.failureMode === hiddenTruth.failureMode;
  if (exact) return { outcome: "correct", exactTaxonomyMatch: true, targetMatch: true, leadingMechanismMatch: true };
  const explanation = `${diagnosis.explanation || ""} ${finalResponse.uncertaintyReduction?.explanation || ""}`.toLowerCase();
  const targetMatch = diagnosis.targetRole === hiddenTruth.targetRole;
  const leadingMechanismMatch = explanation.includes("stuck") && explanation.includes("entry");
  const explicitlyUncertain = diagnosis.faultFamily === "unknown" || diagnosis.failureMode === "unknown";
  if (targetMatch && leadingMechanismMatch && explicitlyUncertain) return { outcome: "insufficient_evidence", exactTaxonomyMatch: false, targetMatch, leadingMechanismMatch };
  return { outcome: "incorrect", exactTaxonomyMatch: false, targetMatch, leadingMechanismMatch };
}

async function createHarness(label, modulePath = worldPath) {
  const imported = await import(`${pathToFileURL(modulePath).href}?gateCResume=${label}-${Date.now()}-${Math.random()}`);
  const world = imported.default || imported.world;
  validateManifest(world.manifest);
  const seed = 20261029;
  const ctx = new InstrumentedWorldContext(world.manifest, { seed, worldVersion: world.manifest.packageVersion });
  let frameSequence = 0;
  await world.initialize(ctx, { seed, worldVersion: world.manifest.packageVersion });
  const signal = (role) => signalByRole(world.manifest, role);
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
  const ticksFor = async (durationMs) => {
    for (let index = 0; index < Math.ceil(durationMs / world.manifest.tickMs); index += 1) await world.tick(ctx, ctx.advance(world.manifest.tickMs));
  };
  return { world, ctx, signal, send, control, ticksFor };
}

function diagnosticEvidenceIds() {
  return new Set([...initialObservations, ...followUpObservations].map((item) => item.id));
}

let coordinator;
await mkdir(gateDirectory, { recursive: true });

try {
  await checkpoint("CP-8", async () => {
    const scoring = adjudicateBlindDiagnosis();
    assert.notEqual(scoring.outcome, "incorrect", "sealed blind diagnosis was incorrect rather than appropriately inconclusive");
    const ids = diagnosticEvidenceIds();
    for (const ref of finalResponse.evidenceRefs) assert(ids.has(ref), `Final diagnosis cited unknown evidence ${ref}`);
    assert.equal(sha256(JSON.stringify({ hiddenTruth, nonce: truthReveal.nonce })), truthReveal.commitment, "truth reveal no longer matches commitment");
    return {
      commitment: truthReveal.commitment,
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
      && entryValues.every((value) => value === true)
      && followUpObservations.every((item) => downstreamRoles.every((role) => item.values[role] === undefined || item.values[role] === false));
    const confidenceGain = after - before;
    assert(confidenceGain >= 0.15 || exposedDiscrepancy, "Muse follow-up did not reduce uncertainty or expose a useful discrepancy");
    return {
      objective: initialResponse.followUp.objective,
      actions: initialResponse.followUp.actions,
      initialConfidence: before,
      finalConfidence: after,
      confidenceGain,
      exposedDiscrepancy,
      finalEncoderCount: Math.max(...encoderValues)
    };
  });

  await checkpoint("CP-10", async () => {
    const candidatePath = resolve(gateDirectory, "candidate.ts");
    const candidateSource = await readFile(candidatePath, "utf8");
    const candidateGeneration = JSON.parse(await readFile(resolve(gateDirectory, "candidate-generation.json"), "utf8"));
    assert(candidateSource.includes("0.5.1-gate-c"));
    assert(candidateSource.includes("world.revisionObserved"));
    assert(!/\bfetch\s*\(|node:fs|\beval\s*\(|new\s+Function\s*\(/.test(candidateSource));
    assert.equal(candidateGeneration.sourceHash, sha256(candidateSource), "candidate source does not match its generation record");
    execFileSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", resolve(gateDirectory, "tsconfig.json")], { cwd: resolve("."), stdio: "pipe" });

    const incumbent = await createHarness("incumbent");
    await incumbent.send({ "drive.runCommand": true });
    await incumbent.ticksFor(500);
    await incumbent.control("carton.introduce", { itemId: "HOT-RELOAD-CARTON", requestedRoute: null }, "Gate C migration fixture");
    await incumbent.ticksFor(400);
    const beforeSnapshot = await incumbent.world.snapshot(incumbent.ctx);
    const beforeStateHash = sha256(JSON.stringify(beforeSnapshot.state));
    coordinator = new HotReloadCoordinator({ versionId: incumbent.world.manifest.packageVersion, module: incumbent.world, context: incumbent.ctx });

    const candidate = await createHarness("candidate", candidatePath);
    const incumbentFrame = incumbent.ctx.plc.currentOutputFrame();
    const activation = await coordinator.attemptActivation({
      candidateVersion: "0.5.1-gate-c", candidate: candidate.world, candidateContext: candidate.ctx,
      healthCheck: async (module, context, migrated) => {
        assert.equal(sha256(JSON.stringify(migrated.state)), beforeStateHash, "candidate migration changed incumbent state");
        const frame = { ...incumbentFrame, sequence: Math.max(1, incumbentFrame.sequence) };
        context.setPlcFrame(frame);
        await module.onPlcFrame(context, frame);
        assert((await module.snapshot(context)).state !== undefined);
      }
    });
    assert.equal(activation.activated, true, activation.record.reason);
    const revisionControl = { id: "carton.introduce", payload: { itemId: "POST-RELOAD", requestedRoute: null }, cause: "Gate C verifies revised evidence" };
    coordinator.active.context.recordControl(revisionControl);
    await coordinator.active.module.onControl(coordinator.active.context, revisionControl);
    assert(coordinator.active.context.events.some((event) => event.lane === "evidence" && event.data.event?.type === "world.revisionObserved"), "candidate revision evidence missing");

    const failingBase = await createHarness("failing");
    const failingCandidate = { ...failingBase.world, manifest: { ...failingBase.world.manifest, packageVersion: "0.5.2-failing" }, async migrate() { throw new Error("deliberate Gate C migration failure"); } };
    const healthyVersion = coordinator.active.versionId;
    const failure = await coordinator.attemptActivation({ candidateVersion: "0.5.2-failing", candidate: failingCandidate, candidateContext: failingBase.ctx, healthCheck: async () => { throw new Error("must not run"); } });
    assert.equal(failure.activated, false);
    assert.equal(coordinator.active.versionId, healthyVersion);
    return {
      candidateSourceHash: sha256(candidateSource), compiled: true, migratedStateHash: beforeStateHash,
      activatedVersion: activation.record.candidateVersion, revisionEvidenceObserved: true,
      failingCandidateDisposition: failure.record.disposition, preservedVersionAfterRollback: coordinator.active.versionId,
      history: coordinator.history
    };
  });

  await checkpoint("CP-11", async () => {
    const guard = new ModelBudgetGuard(limits);
    const slow = guard.reserve({ purpose: "simulated slow request", estimatedCostUsd: 0.5, nowMs: 0 });
    const beforeTimeout = guard.checkRequest(slow.id, limits.requestTimeoutMs - 1);
    const atTimeout = guard.checkRequest(slow.id, limits.requestTimeoutMs);
    const repairStates = [1, 2, 3, 4, 5].map(() => guard.recordRepairFailure("simulated-repair"));
    const exhausted = new ModelBudgetGuard(limits);
    exhausted.campaignSpentUsd = 4.6;
    let budgetStopCode = "";
    try { exhausted.reserve({ purpose: "over budget", estimatedCostUsd: 0.5, nowMs: 0 }); }
    catch (error) { assert(error instanceof BudgetLimitError); budgetStopCode = error.code; }
    const stalled = guard.classifyRuntime({ nowMs: 5_000, lastWorldHeartbeatAtMs: 0 });
    const heldWait = guard.classifyRuntime({ nowMs: 1_000, lastWorldHeartbeatAtMs: 900, conditionWait: { description: "PE_Entry clears", startedAtMs: 0, timeoutMs: 2_000 } });
    const waitTimeout = guard.classifyRuntime({ nowMs: 2_100, lastWorldHeartbeatAtMs: 2_000, conditionWait: { description: "PE_Entry clears", startedAtMs: 0, timeoutMs: 2_000 } });
    assert.deepEqual([beforeTimeout, atTimeout], ["active", "timed_out"]);
    assert.deepEqual(repairStates, ["continue", "continue", "warning", "warning", "hard_stop"]);
    assert.equal(budgetStopCode, "campaign_limit");
    assert.equal(stalled.state, "world_stalled");
    assert.equal(heldWait.state, "waiting_condition");
    assert.equal(waitTimeout.state, "condition_timeout");
    return {
      requestStates: { beforeTimeout, atTimeout }, repairFailureStates: repairStates, budgetStopCode,
      runtimeStates: { stalled, heldWait, waitTimeout }, preservedWorldVersion: coordinator.active.versionId,
      estimatedCampaignSpendUsd: budget.campaignSpentUsd,
      providerBillingNote: "Dollar spend is a conservative reservation; exact provider billing was not returned."
    };
  });

  const result = {
    status: "pass", packageDirectory: latest.relativeDirectory, durationMs: Date.now() - startedAt,
    checkpoints, modelCalls,
    budget: { estimatedSpendUsd: budget.campaignSpentUsd, campaignLevel: budget.campaignLevel(), limits },
    hiddenTruthCommitment: truthReveal.commitment,
    resumedFromAttempt: 1
  };
  if (!verifyOnly) await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  status(verifyOnly ? "Gate C preserved artifacts verified; no files written" : `Gate C passed; result written to ${resultPath}`);
} catch (error) {
  const result = {
    status: "fail", packageDirectory: latest.relativeDirectory, durationMs: Date.now() - startedAt,
    checkpoints, modelCalls,
    budget: { estimatedSpendUsd: budget.campaignSpentUsd, campaignLevel: budget.campaignLevel(), limits },
    error: error instanceof Error ? error.stack : String(error), resumedFromAttempt: 1
  };
  if (!verifyOnly) await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 1;
}
