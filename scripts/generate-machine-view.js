// One bounded Muse Wonder call that authors the machine view against the frozen contract.
// Preserves the exact request (before sending), the raw response, identity, timing, usage,
// conservative cost, hashes and the deterministic validation result. No retry, no repair.
//
//   node --env-file=.env scripts/generate-machine-view.js [--allow-another-call]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ModelBudgetGuard } from "../src/proof/budget-guard.ts";
import { deriveContract } from "../src/machine-view/contract-source.ts";
import { assemblePackage, buildGenerationRequest, extractOutputText } from "../src/machine-view/generation.ts";
import { jsonText, validatePackage } from "../src/machine-view/package.ts";

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error("MODEL_API_KEY is not set; run with node --env-file=<path to .env>");
const model = process.env.META_MODEL?.trim() || "muse-wonder-1.0";
const endpoint = `${(process.env.META_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/$/, "")}/responses`;
const RESERVATION_USD = 1;
const TIMEOUT_MS = 420_000;
const MAX_OUTPUT_TOKENS = 32_000;
// Published Standard-mode rates (third-party listings, consistent with this repo's earlier
// $0.4088 Wonder spike). Recorded as an estimate only; the accounted basis is the reservation.
const RATES = { inputPerM: 4, cachedInputPerM: 0.2, outputPerM: 20, source: "https://models.litellm.ai/models/muse-wonder-1.0 (checked 2026-10-31)" };
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// ---- single-call guard
const root = resolve("artifacts/machine-view");
const prior = [];
for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
  if (!entry.isDirectory()) continue;
  const record = await readFile(join(root, entry.name, "generation.json"), "utf8").catch(() => null);
  const request = await readFile(join(root, entry.name, "generation", "request.json"), "utf8").catch(() => null);
  if (record || request) prior.push(entry.name);
}
if (prior.length && !process.argv.includes("--allow-another-call")) throw new Error(`A machine-view generation call already exists (${prior.join(", ")}); refusing to spend again without --allow-another-call`);

// ---- frozen inputs, re-derived to prove they are current
const worldDir = JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8")).relativeDirectory;
const doc = async (path) => { const text = await readFile(resolve(path), "utf8"); return { path, text, sha256: sha256(text) }; };
const sources = {
  specification: await doc("docs/conveyor-machine-spec.md"),
  worldManifest: await doc(`${worldDir}/world.manifest.json`),
  worldSource: await doc(`${worldDir}/world.ts`),
  worldAssumptions: await doc(`${worldDir}/assumptions.md`),
  signalMap: await doc("codesys/demo/signal-map-v1.json")
};
const equipmentText = await readFile(resolve("artifacts/machine-view/contract/equipment.json"), "utf8");
const contractText = await readFile(resolve("artifacts/machine-view/contract/binding-contract.json"), "utf8");
const derived = deriveContract(sources);
if (jsonText(derived.equipment) !== equipmentText) throw new Error("Frozen equipment.json is stale; run scripts/build-machine-view-contract.js");
const contract = JSON.parse(contractText);
if (contract.equipmentSha256 !== sha256(equipmentText) || jsonText({ ...derived.contract, equipmentSha256: contract.equipmentSha256 }) !== contractText) throw new Error("Frozen binding contract is stale");
const equipment = JSON.parse(equipmentText);

// ---- request, preserved before sending
const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
const relativeDirectory = `artifacts/machine-view/${stamp}-${model}`;
const outDir = resolve(relativeDirectory);
await mkdir(join(outDir, "generation"), { recursive: true });
const request = await buildGenerationRequest({
  requestId: `machine-view-${stamp}`, createdAt: startedAt.toISOString(), endpoint, model, maxOutputTokens: MAX_OUTPUT_TOKENS,
  reservationUsd: RESERVATION_USD, perRequestHardUsd: RESERVATION_USD, timeoutMs: TIMEOUT_MS, equipment, contract,
  texts: { equipmentText, contractText, assumptionsText: sources.worldAssumptions.text, specificationText: sources.specification.text, worldManifestText: sources.worldManifest.text },
  paths: { equipment: "artifacts/machine-view/contract/equipment.json", contract: "artifacts/machine-view/contract/binding-contract.json", assumptions: sources.worldAssumptions.path, specification: sources.specification.path, worldManifest: sources.worldManifest.path }
});
await writeFile(join(outDir, "generation", "request.json"), jsonText(request));

// ---- budget: one conservative reservation, settled whatever happens
const guard = new ModelBudgetGuard({ perRequestUsd: RESERVATION_USD, repairEpisodeUsd: RESERVATION_USD, campaignWarningUsd: RESERVATION_USD, campaignHardUsd: RESERVATION_USD, sessionHardUsd: RESERVATION_USD, requestTimeoutMs: TIMEOUT_MS, failedRepairWarning: 1, failedRepairHard: 1, worldHeartbeatStaleMs: TIMEOUT_MS });
const lease = guard.reserve({ purpose: "machine_view_generation", estimatedCostUsd: RESERVATION_USD, nowMs: Date.now() });

console.log(`[machine-view] one bounded ${model} request; timeout ${TIMEOUT_MS / 1000} s, max output ${MAX_OUTPUT_TOKENS} tokens, reservation $${RESERVATION_USD.toFixed(2)}`);
let httpStatus = null, rawBody = "", headers = {}, transportError = null;
const sentAt = Date.now();
try {
  const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify(request.body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  httpStatus = response.status;
  for (const [k, v] of response.headers) if (/^(x-request-id|request-id|x-ratelimit-|retry-after|date|openai-processing-ms|x-meta-)/i.test(k)) headers[k] = v;
  rawBody = await response.text();
} catch (error) {
  transportError = `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`;
}
const completedAt = new Date();
guard.settle(lease.id, RESERVATION_USD);
let payload = null;
try { payload = rawBody ? JSON.parse(rawBody) : null; } catch { /* preserved as text */ }
await writeFile(join(outDir, "generation", "response.json"), jsonText({ httpStatus, headers, transportError, receivedAt: completedAt.toISOString(), body: payload ?? undefined, bodyText: payload ? undefined : rawBody }));

let status = transportError ? "transport_error" : httpStatus !== 200 ? "http_error" : "completed";
let generated = null, outputText = "", parseError = null;
if (status === "completed") {
  outputText = extractOutputText(payload ?? {});
  await writeFile(join(outDir, "generation", "output.json"), outputText);
  try { generated = JSON.parse(outputText); } catch (error) { parseError = error.message; status = "unparseable_output"; }
  if (generated && (typeof generated.svg !== "string" || !Array.isArray(generated.bindings) || !Array.isArray(generated.entityPaths))) { status = "schema_mismatch"; generated = null; }
}

const responseModel = payload?.model ?? null;
const assembled = await assemblePackage({ equipmentText, contract, generated, provenance: { model: responseModel ?? model, responseId: payload?.id ?? null, generatedAt: completedAt.toISOString() } });
for (const [name, text] of Object.entries(assembled.files)) await writeFile(join(outDir, name), text);
const { report } = await validatePackage({ files: assembled.files, contract, worldManifestText: sources.worldManifest.text });
await writeFile(join(outDir, "validation.json"), jsonText(report));

const usage = payload?.usage ?? null;
const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
const estimateUsd = usage ? Number((((usage.input_tokens - cached) * RATES.inputPerM + cached * RATES.cachedInputPerM + usage.output_tokens * RATES.outputPerM) / 1e6).toFixed(4)) : null;

let browserCheck = null;
if (report.viewValid) {
  const check = spawnSync(process.execPath, ["scripts/check-machine-view-browser.js", "--package", relativeDirectory], { encoding: "utf8", timeout: 300_000 });
  const summary = await readFile(join(outDir, "browser-check", "browser-check.json"), "utf8").catch(() => null);
  browserCheck = { exitCode: check.status, passed: summary ? JSON.parse(summary).passed : false, file: "browser-check/browser-check.json" };
}

const record = {
  schemaVersion: "controlsbench.machine-view.generation.v1",
  purpose: "machine_view_generation",
  status,
  request: { file: "generation/request.json", requestId: request.requestId, bodySha256: request.bodySha256, promptSha256: request.promptSha256, promptVersion: request.promptVersion, outputSchemaSha256: request.outputSchemaSha256, inputs: request.inputs },
  identity: { endpoint, requestedModel: model, reportedModel: responseModel, responseId: payload?.id ?? null, responseStatus: payload?.status ?? null, httpStatus, headers },
  timing: { startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), requestDurationMs: completedAt.getTime() - sentAt },
  usage,
  cost: {
    accountedBasis: "conservative_reservation",
    reservedUsd: RESERVATION_USD,
    settledUsd: RESERVATION_USD,
    providerReportedUsd: null,
    publishedRateEstimateUsd: estimateUsd,
    publishedRates: RATES,
    note: "The reservation is charged even on failure. The estimate applies published token rates to reported usage; it is not a billing record."
  },
  hashes: {
    requestBody: request.bodySha256,
    responseBody: rawBody ? sha256(rawBody) : null,
    outputText: outputText ? sha256(outputText) : null,
    files: assembled.manifest.files,
    manifest: sha256(assembled.files["view.manifest.json"])
  },
  transportError,
  parseError,
  normalizationProblems: assembled.normalizationProblems,
  validation: { file: "validation.json", contractValid: report.contractValid, viewValid: report.viewValid, errors: report.errors, warnings: report.warnings },
  browserCheck,
  repairLineage: [],
  policy: "One bounded call. No automatic retry and no repair call; a failed view leaves the package in contract-fallback state for engineer review.",
  packageId: assembled.manifest.packageId
};
await writeFile(join(outDir, "generation.json"), jsonText(record));
await writeFile(resolve("artifacts/machine-view/latest.json"), jsonText({ relativeDirectory, packageId: assembled.manifest.packageId, viewValid: report.viewValid, contractValid: report.contractValid, browserCheckPassed: browserCheck?.passed ?? false }));
console.log(JSON.stringify({ relativeDirectory, status, responseId: record.identity.responseId, model: responseModel, durationMs: record.timing.requestDurationMs, usage, cost: record.cost, validation: record.validation, normalizationProblems: assembled.normalizationProblems.slice(0, 10), browserCheck }, null, 2));
