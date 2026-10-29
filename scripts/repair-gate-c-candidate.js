import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ModelBudgetGuard } from "../src/proof/budget-guard.ts";

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error("MODEL_API_KEY is not set");
const model = process.env.META_MODEL?.trim() || "muse-wonder-1.0";
const baseUrl = (process.env.META_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/$/, "");
const latest = JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8"));
const packageDirectory = resolve(latest.relativeDirectory);
const gateDirectory = resolve(packageDirectory, "gate-c");
const candidatePath = resolve(gateDirectory, "candidate.ts");
const generationPath = resolve(gateDirectory, "candidate-generation.json");
const resultPath = resolve(packageDirectory, "gate-c-result.json");
const beforeSource = await readFile(candidatePath, "utf8");
const generation = JSON.parse(await readFile(generationPath, "utf8"));
const priorResultText = await readFile(resultPath, "utf8");
const priorResult = JSON.parse(priorResultText);
const repairNumber = (generation.repairAttempts?.length || 0) + 1;
const repairDirectory = resolve(gateDirectory, "repairs", String(repairNumber).padStart(2, "0"));
const estimatedCostUsd = 0.5;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const budget = new ModelBudgetGuard(priorResult.budget.limits);
budget.campaignSpentUsd = priorResult.budget.estimatedSpendUsd || 0;
budget.sessionSpentUsd = priorResult.budget.estimatedSpendUsd || 0;
const priorRepairSpendUsd = (generation.repairAttempts || []).reduce((sum, attempt) => sum + Number(attempt.metadata?.estimatedCostUsd || 0), 0);
if (priorRepairSpendUsd + estimatedCostUsd > priorResult.budget.limits.repairEpisodeUsd) {
  throw new Error(`Gate C candidate repair cap would be exceeded: $${priorRepairSpendUsd.toFixed(2)} already reserved/spent`);
}

function extractText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text" || item.type === "text").map((item) => item.text || "").join("");
}

const diagnostic = `The candidate now compiles, awaits snapshot correctly, preserves the migrated state hash, and passes the shadow snapshot health check. CP-10 then failed because no valid evidence-lane event of type world.revisionObserved was recorded. The generic tryAppendEvidence helper sees InstrumentedWorldContext.events (a public RecordedEvent array), pushes a raw RevisionEvidence object directly into that array, and returns before reaching ctx.evidence.append. This bypasses the WorldContext evidence contract and corrupts the event-log shape. Repair onControl to use its declared GeneratedWorldModule signature directly: await baseWorld.onControl(ctx, control), then call ctx.evidence.append with a valid EvidenceEvent containing type, summary, and a data object with controlId and revision/version fields. Read the control ID from control.id (the second argument), not from the context. Remove or stop using the generic sink probing. Keep the already-correct awaited snapshot behavior. Do not alter any physics, signals, controls, timing, fault behavior, or base-world source.`;
const prompt = `Repair this complete TypeScript hot-reload wrapper from the concrete independent runtime diagnostic below.

DIAGNOSTIC
${diagnostic}

REQUIREMENTS
- Return the complete corrected candidate.ts, not a patch or markdown fence.
- Preserve manifest packageVersion "0.5.1-gate-c" and evidence type "world.revisionObserved".
- The returned candidateTs must contain the exact literal strings 0.5.1-gate-c and world.revisionObserved; local validation rejects the artifact otherwise.
- Preserve all base-world behavior by delegation.
- snapshot must await the base snapshot, preserve state and stateSchemaVersion, and override only worldVersion.
- onControl must await the base control handler, then append through ctx.evidence.append using the declared (ctx, control) arguments; never mutate ctx.events directly.
- Keep the existing import paths and named/default exports.
- Do not add filesystem, network, eval, process execution, or dynamic code-generation capability.

CURRENT SOURCE
${beforeSource}`;
const schema = {
  type: "object",
  additionalProperties: false,
  properties: { diagnosis: { type: "string" }, candidateTs: { type: "string" } },
  required: ["diagnosis", "candidateTs"]
};

const lease = budget.reserve({ purpose: "gate_c_hot_reload_candidate_repair", estimatedCostUsd, nowMs: Date.now(), repairEpisode: "gate-c-candidate" });
const began = Date.now();
console.log(`[gate-c-repair] attempt ${repairNumber} started with ${model}`);
try {
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: "high", summary: "auto" },
      max_output_tokens: 7000,
      input: [
        { role: "developer", content: "Repair only the demonstrated asynchronous wrapper-contract defect. Return complete executable source." },
        { role: "user", content: prompt }
      ],
      text: { format: { type: "json_schema", name: "gate_c_hot_reload_candidate_repair", description: "Corrected Gate C candidate wrapper", strict: true, schema } }
    }),
    signal: AbortSignal.timeout(priorResult.budget.limits.requestTimeoutMs)
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Meta Model API returned ${response.status}: ${raw.slice(0, 2000)}`);
  const payload = JSON.parse(raw);
  const repaired = JSON.parse(extractText(payload));
  const candidateSource = repaired.candidateTs;
  budget.settle(lease.id, estimatedCostUsd);
  const metadata = {
    purpose: "gate_c_hot_reload_candidate_repair",
    responseId: payload.id || null,
    model: payload.model || model,
    status: payload.status || null,
    durationMs: Date.now() - began,
    usage: payload.usage || null,
    estimatedCostUsd,
    promptHash: sha256(prompt),
    responseHash: sha256(JSON.stringify(repaired))
  };
  await mkdir(repairDirectory, { recursive: true });
  await Promise.all([
    writeFile(resolve(repairDirectory, "provider-response.json"), `${JSON.stringify({ metadata, diagnosis: repaired.diagnosis }, null, 2)}\n`),
    writeFile(resolve(repairDirectory, "proposed-candidate.ts"), candidateSource)
  ]);
  if (!candidateSource.includes("0.5.1-gate-c") || !candidateSource.includes("world.revisionObserved")) throw new Error("Repair removed required revision markers");
  if (/\bfetch\s*\(|node:fs|\beval\s*\(|new\s+Function\s*\(|node:child_process/.test(candidateSource)) throw new Error("Repair introduced a forbidden capability");
  if (!/await\s+\(?\s*baseWorld|await\s+\(?\s*\(baseWorld/.test(candidateSource)) throw new Error("Repair does not visibly await base-world delegation");

  await writeFile(resolve(repairDirectory, "before-candidate.ts"), beforeSource);
  await writeFile(resolve(repairDirectory, "diagnostic.txt"), `${diagnostic}\n`);
  await writeFile(candidatePath, candidateSource);
  try {
    execFileSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", resolve(gateDirectory, "tsconfig.json")], { cwd: resolve("."), stdio: "pipe" });
  } catch (error) {
    await writeFile(candidatePath, beforeSource);
    throw error;
  }

  const attempt = {
    attempt: repairNumber,
    diagnosis: repaired.diagnosis,
    diagnostic,
    metadata,
    beforeSourceHash: sha256(beforeSource),
    afterSourceHash: sha256(candidateSource),
    compiled: true
  };
  generation.repairAttempts = [...(generation.repairAttempts || []), attempt];
  generation.sourceHash = attempt.afterSourceHash;
  priorResult.modelCalls = [...(priorResult.modelCalls || []), metadata];
  priorResult.budget.estimatedSpendUsd = budget.campaignSpentUsd;
  priorResult.budget.campaignLevel = budget.campaignLevel();
  await Promise.all([
    writeFile(resolve(gateDirectory, `pre-repair-${repairNumber}-result.json`), priorResultText),
    writeFile(resolve(repairDirectory, "after-candidate.ts"), candidateSource),
    writeFile(resolve(repairDirectory, "response.json"), `${JSON.stringify(attempt, null, 2)}\n`),
    writeFile(generationPath, `${JSON.stringify(generation, null, 2)}\n`),
    writeFile(resultPath, `${JSON.stringify(priorResult, null, 2)}\n`)
  ]);
  console.log(JSON.stringify({ repair: attempt, estimatedCampaignSpendUsd: budget.campaignSpentUsd }, null, 2));
} catch (error) {
  try { budget.fail(lease.id); } catch { /* preserve original failure */ }
  throw error;
}
