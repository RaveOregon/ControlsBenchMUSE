// Second pass: one bounded Muse Wonder call that revises the incumbent view from its
// presentation audit. Sends the prior artifact, the deterministic findings and annotated
// screenshots (vision input); asks Muse to review the screenshots itself as well. The
// candidate is validated, browser-checked and re-audited, and replaces the incumbent only if
// it is valid and strictly better. Everything is preserved as repair lineage.
//
//   node --env-file=.env scripts/refine-machine-view.js [--allow-another-call]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ModelBudgetGuard } from "../src/proof/budget-guard.ts";
import { describeFindings } from "../src/machine-view/audit.ts";
import { assemblePackage, developerPrompt, extractOutputText, outputSchema } from "../src/machine-view/generation.ts";
import { jsonText, validatePackage } from "../src/machine-view/package.ts";

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error("MODEL_API_KEY is not set; run with node --env-file=<path to .env>");
const model = process.env.META_MODEL?.trim() || "muse-wonder-1.0";
const endpoint = `${(process.env.META_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/$/, "")}/responses`;
const REASONING = { effort: "max", summary: "auto" };
const MAX_OUTPUT_TOKENS = 48_000;
const RESERVATION_USD = 1.25;
const TIMEOUT_MS = 600_000;
const RATES = { inputPerM: 4, cachedInputPerM: 0.2, outputPerM: 20, source: "https://models.litellm.ai/models/muse-wonder-1.0 (checked 2026-10-31)" };
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const run = (args) => spawnSync(process.execPath, args, { encoding: "utf8", timeout: 600_000 });

// ---- incumbent and its current audit
const latest = JSON.parse(await readFile(resolve("artifacts/machine-view/latest.json"), "utf8"));
const parentRel = latest.relativeDirectory;
const parentDir = resolve(parentRel);
const parentFiles = {};
for (const name of ["view.manifest.json", "equipment.json", "view-bindings.json", "view.svg"]) parentFiles[name] = await readFile(join(parentDir, name), "utf8");
const audit = JSON.parse(await readFile(join(parentDir, "audit", "audit.json"), "utf8"));
if (audit.svgSha256 !== sha256(parentFiles["view.svg"])) throw new Error("Incumbent audit is stale; run scripts/audit-machine-view.js first");
const transient = audit.findings.filter(f => f.category === "transient_overlap").length;
if (audit.counts.error === 0 && transient === 0 && !process.argv.includes("--force")) { console.log("[refine] audit has no errors or transient overlaps; second pass not needed"); process.exit(0); }

// ---- single-call guard per parent
const root = resolve("artifacts/machine-view");
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.includes("-refine-")) continue;
  const rec = await readFile(join(root, entry.name, "generation.json"), "utf8").catch(() => null);
  const req = await readFile(join(root, entry.name, "generation", "request.json"), "utf8").catch(() => null);
  const parentOf = rec ? JSON.parse(rec).parent?.relativeDirectory : req ? JSON.parse(req).parent?.relativeDirectory : null;
  if (parentOf === parentRel && !process.argv.includes("--allow-another-call")) throw new Error(`A refinement of ${parentRel} already exists (${entry.name}); refusing to spend again without --allow-another-call`);
}

const contractText = await readFile(resolve("artifacts/machine-view/contract/binding-contract.json"), "utf8");
const contract = JSON.parse(contractText);
const equipmentText = parentFiles["equipment.json"];
const equipment = JSON.parse(equipmentText);
const worldDir = JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8")).relativeDirectory;
const assumptionsText = await readFile(resolve(worldDir, "assumptions.md"), "utf8");
const worldManifestText = await readFile(resolve(worldDir, "world.manifest.json"), "utf8");
const parentBindings = JSON.parse(parentFiles["view-bindings.json"]);
const parentManifest = JSON.parse(parentFiles["view.manifest.json"]);

const refineSchema = {
  ...outputSchema,
  properties: { ...outputSchema.properties, visualReview: { type: "array", items: { type: "object", additionalProperties: false, properties: { issue: { type: "string" }, fix: { type: "string" } }, required: ["issue", "fix"] } } },
  required: [...outputSchema.required, "visualReview"]
};

const refineRules = `
SECOND PASS: REVISE YOUR OWN VIEW
You authored the incumbent view below. It is valid and safe, but a presentation audit in a real browser found problems, listed with IDs. The images are the incumbent rendered from recorded snapshots at 1280x600; red/amber boxes mark audit findings. Return a complete revised artifact under the same rules and schema, plus visualReview: every problem you see in the screenshots yourself (including any the audit missed, such as lines through labels) and the fix you made.

Engineers will watch this view live, so it must read instantly and move smoothly:
- No label may overlap another label or a state indicator, at any value. Bound text can show "unknown" (7 characters) or values up to 10 digits; reserve that width.
- Keep every label and lamp OFF the carton travel bands (the belt and both chutes, plus about 22 user units either side of their centrelines), so a passing carton never covers text. Put per-device lamp clusters in a clear row or callout away from the belt, with one short label per lamp, and leader lines where helpful.
- Font sizes at least 12 user units for labels and 11 for fine print (the view scales about 1.0x at 1280 px).
- Do not draw decorative lines through text.
- Make the exit chutes curve away from the main lane: give each branch path at least 5 points over its first 0.35 m, so the carton heading changes gradually (about 6-8 degrees per 0.05 m) instead of snapping 35 degrees. The first point must still sit exactly on the main path at the divert station, and the drawn chute must follow the same polyline.
- Style [data-cb-source="plc"] distinctly from [data-cb-source="world"] (the incumbent relied on shape alone).
- Preserve what worked: the caption saying it is not the PLC HMI, the side panel for unlocated devices, the selectable equipment groups, a common px-per-metre scale, and binding coverage. You may rename ids; bindings must match the new SVG.
`.trim();

const images = [];
for (const name of ["a-diverted.png", "b-diverted.png", "no-data.png", "a-diverted.clean.png"]) {
  const bytes = await readFile(join(parentDir, "audit", name));
  images.push({ name, sha256: sha256(bytes), bytes: bytes.length, dataUrl: `data:image/png;base64,${bytes.toString("base64")}` });
}
const userText = [
  "PRESENTATION AUDIT FINDINGS (deterministic, measured in Chrome):", describeFindings(audit),
  `Motion summary: ${JSON.stringify(audit.motion)}`,
  "INCUMBENT view.svg:", parentFiles["view.svg"],
  "INCUMBENT entityPaths:", JSON.stringify(parentBindings.entityPaths),
  "INCUMBENT bindings:", JSON.stringify(parentBindings.bindings),
  "INCUMBENT layoutAssumptions:", JSON.stringify(parentManifest.layoutAssumptions),
  "EQUIPMENT GRAPH (equipment.json, frozen):", equipmentText,
  "BINDING CONTRACT (frozen):", contractText,
  "GENERATED WORLD ASSUMPTIONS:", assumptionsText,
  "Screenshots follow, in order: " + images.map(i => i.name).join(", ")
].join("\n\n");
const developer = `${developerPrompt(equipment, contract)}\n\n${refineRules}`;
const body = {
  model,
  reasoning: REASONING,
  max_output_tokens: MAX_OUTPUT_TOKENS,
  input: [
    { role: "developer", content: developer },
    { type: "message", role: "user", content: [{ type: "input_text", text: userText }, ...images.map(i => ({ type: "input_image", image_url: i.dataUrl }))] }
  ],
  text: { format: { type: "json_schema", name: "controlsbench_machine_view_refinement_v1", description: "Revised ControlsBench machine view with visual self-review.", strict: true, schema: refineSchema } }
};

const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
const relativeDirectory = `artifacts/machine-view/${stamp}-${model}-refine-01`;
const outDir = resolve(relativeDirectory);
await mkdir(join(outDir, "generation"), { recursive: true });
const parent = { relativeDirectory: parentRel, packageId: parentManifest.packageId, svgSha256: audit.svgSha256, audit: { errors: audit.counts.error, warnings: audit.counts.warning, transientOverlaps: transient, file: `${parentRel}/audit/audit.json` } };
const request = {
  schemaVersion: "controlsbench.machine-view.generation-request.v1",
  requestId: `machine-view-refine-${stamp}`,
  createdAt: startedAt.toISOString(),
  purpose: "machine_view_refinement",
  parent,
  endpoint,
  model: { id: model, reasoning: REASONING, maxOutputTokens: MAX_OUTPUT_TOKENS },
  budget: { reservationUsd: RESERVATION_USD, perRequestHardUsd: RESERVATION_USD, timeoutMs: TIMEOUT_MS, maxCalls: 1, automaticRetries: 0, repairCalls: 0 },
  inputs: [
    { role: "incumbent_view", path: `${parentRel}/view.svg`, sha256: sha256(parentFiles["view.svg"]), bytes: parentFiles["view.svg"].length },
    { role: "incumbent_bindings", path: `${parentRel}/view-bindings.json`, sha256: sha256(parentFiles["view-bindings.json"]), bytes: parentFiles["view-bindings.json"].length },
    { role: "audit", path: `${parentRel}/audit/audit.json`, sha256: sha256(await readFile(join(parentDir, "audit", "audit.json"))), bytes: 0 },
    { role: "equipment", path: "artifacts/machine-view/contract/equipment.json", sha256: sha256(equipmentText), bytes: equipmentText.length },
    { role: "binding_contract", path: "artifacts/machine-view/contract/binding-contract.json", sha256: sha256(contractText), bytes: contractText.length },
    { role: "world_assumptions", path: `${worldDir}/assumptions.md`, sha256: sha256(assumptionsText), bytes: assumptionsText.length },
    ...images.map(i => ({ role: "screenshot", path: `${parentRel}/audit/${i.name}`, sha256: i.sha256, bytes: i.bytes }))
  ],
  promptVersion: "machine-view-refine-prompt-v1",
  promptSha256: sha256(`${developer}\n\n${userText}`),
  outputSchemaName: "controlsbench_machine_view_refinement_v1",
  outputSchemaSha256: sha256(jsonText(refineSchema)),
  body,
  bodySha256: sha256(JSON.stringify(body))
};
await writeFile(join(outDir, "generation", "request.json"), jsonText(request));

const guard = new ModelBudgetGuard({ perRequestUsd: RESERVATION_USD, repairEpisodeUsd: RESERVATION_USD, campaignWarningUsd: RESERVATION_USD, campaignHardUsd: RESERVATION_USD, sessionHardUsd: RESERVATION_USD, requestTimeoutMs: TIMEOUT_MS, failedRepairWarning: 1, failedRepairHard: 1, worldHeartbeatStaleMs: TIMEOUT_MS });
const lease = guard.reserve({ purpose: "machine_view_refinement", estimatedCostUsd: RESERVATION_USD, nowMs: Date.now(), repairEpisode: `refine:${parentManifest.packageId}` });
console.log(`[refine] one bounded ${model} request, reasoning ${REASONING.effort}, ${images.length} screenshots, ${audit.counts.error} audit errors; timeout ${TIMEOUT_MS / 1000} s, max output ${MAX_OUTPUT_TOKENS}, reservation $${RESERVATION_USD.toFixed(2)}`);
let httpStatus = null, rawBody = "", headers = {}, transportError = null;
const sentAt = Date.now();
try {
  const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  httpStatus = response.status;
  for (const [k, v] of response.headers) if (/^(x-request-id|request-id|x-ratelimit-|retry-after|date|x-meta-)/i.test(k)) headers[k] = v;
  rawBody = await response.text();
} catch (error) { transportError = `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`; }
const completedAt = new Date();
guard.settle(lease.id, RESERVATION_USD);
let payload = null;
try { payload = rawBody ? JSON.parse(rawBody) : null; } catch { /* preserved as text */ }
await writeFile(join(outDir, "generation", "response.json"), jsonText({ httpStatus, headers, transportError, receivedAt: completedAt.toISOString(), body: payload ?? undefined, bodyText: payload ? undefined : rawBody }));

let status = transportError ? "transport_error" : httpStatus !== 200 ? "http_error" : payload?.status && payload.status !== "completed" ? `response_${payload.status}` : "completed";
let generated = null, outputText = "", parseError = null;
if (status === "completed") {
  outputText = extractOutputText(payload ?? {});
  await writeFile(join(outDir, "generation", "output.json"), outputText);
  try { generated = JSON.parse(outputText); } catch (error) { parseError = error.message; status = "unparseable_output"; }
  if (generated && (typeof generated.svg !== "string" || !Array.isArray(generated.bindings) || !Array.isArray(generated.entityPaths))) { status = "schema_mismatch"; generated = null; }
}
const assembled = await assemblePackage({ equipmentText, contract, generated, provenance: { model: payload?.model ?? model, responseId: payload?.id ?? null, generatedAt: completedAt.toISOString() } });
for (const [name, text] of Object.entries(assembled.files)) await writeFile(join(outDir, name), text);
const { report } = await validatePackage({ files: assembled.files, contract, worldManifestText });
await writeFile(join(outDir, "validation.json"), jsonText(report));

let browserCheck = null, candidateAudit = null;
if (report.viewValid) {
  const check = run(["scripts/check-machine-view-browser.js", "--package", relativeDirectory]);
  const summary = await readFile(join(outDir, "browser-check", "browser-check.json"), "utf8").catch(() => null);
  browserCheck = { exitCode: check.status, passed: summary ? JSON.parse(summary).passed : false, file: "browser-check/browser-check.json" };
  run(["scripts/audit-machine-view.js", "--package", relativeDirectory]);
  const a = await readFile(join(outDir, "audit", "audit.json"), "utf8").catch(() => null);
  if (a) { const parsed = JSON.parse(a); candidateAudit = { errors: parsed.counts.error, warnings: parsed.counts.warning, transientOverlaps: parsed.findings.filter(f => f.category === "transient_overlap").length, passed: parsed.passed, file: "audit/audit.json" }; }
}
const better = Boolean(report.viewValid && browserCheck?.passed && candidateAudit && (candidateAudit.errors < parent.audit.errors || (candidateAudit.errors === parent.audit.errors && candidateAudit.transientOverlaps + candidateAudit.warnings < parent.audit.transientOverlaps + parent.audit.warnings)));
const disposition = better ? "promoted" : report.viewValid ? "retained_incumbent_not_better" : "rejected_invalid";

const usage = payload?.usage ?? null;
const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
const estimateUsd = usage ? Number((((usage.input_tokens - cached) * RATES.inputPerM + cached * RATES.cachedInputPerM + usage.output_tokens * RATES.outputPerM) / 1e6).toFixed(4)) : null;
const record = {
  schemaVersion: "controlsbench.machine-view.generation.v1",
  purpose: "machine_view_refinement",
  status,
  parent,
  request: { file: "generation/request.json", requestId: request.requestId, bodySha256: request.bodySha256, promptSha256: request.promptSha256, promptVersion: request.promptVersion, outputSchemaSha256: request.outputSchemaSha256, inputs: request.inputs },
  identity: { endpoint, requestedModel: model, reportedModel: payload?.model ?? null, responseId: payload?.id ?? null, responseStatus: payload?.status ?? null, httpStatus, headers, reasoning: REASONING },
  timing: { startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), requestDurationMs: completedAt.getTime() - sentAt },
  usage,
  cost: { accountedBasis: "conservative_reservation", reservedUsd: RESERVATION_USD, settledUsd: RESERVATION_USD, providerReportedUsd: null, publishedRateEstimateUsd: estimateUsd, publishedRates: RATES, note: "The reservation is charged even on failure. The estimate applies published token rates to reported usage; it is not a billing record." },
  hashes: { requestBody: request.bodySha256, responseBody: rawBody ? sha256(rawBody) : null, outputText: outputText ? sha256(outputText) : null, files: assembled.manifest.files, manifest: sha256(assembled.files["view.manifest.json"]) },
  transportError, parseError,
  normalizationProblems: assembled.normalizationProblems,
  visualReview: generated?.visualReview ?? null,
  validation: { file: "validation.json", contractValid: report.contractValid, viewValid: report.viewValid, errors: report.errors, warnings: report.warnings },
  browserCheck,
  audit: candidateAudit,
  disposition,
  repairLineage: [{ attempt: 1, kind: "presentation_refinement", parent: parentRel, disposition }],
  policy: "One bounded call. No retry. The candidate replaces the incumbent only if it is view-valid, passes the browser check and has fewer audit errors (or equal errors and fewer warnings).",
  packageId: assembled.manifest.packageId
};
await writeFile(join(outDir, "generation.json"), jsonText(record));
if (better) await writeFile(resolve("artifacts/machine-view/latest.json"), jsonText({ relativeDirectory, packageId: assembled.manifest.packageId, viewValid: true, contractValid: true, browserCheckPassed: true, parent: parentRel }));
console.log(JSON.stringify({ relativeDirectory, status, disposition, responseId: record.identity.responseId, durationMs: record.timing.requestDurationMs, usage, cost: { settledUsd: RESERVATION_USD, publishedRateEstimateUsd: estimateUsd }, validation: record.validation, browserCheck, audit: { before: parent.audit, after: candidateAudit }, visualReview: record.visualReview }, null, 2));
