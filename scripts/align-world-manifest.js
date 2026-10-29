import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateManifest } from "../src/proof/manifest.ts";

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error("MODEL_API_KEY is not set");
const model = process.env.META_MODEL?.trim() || "muse-wonder-1.0";
const baseUrl = (process.env.META_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/$/, "");
const latest = JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8"));
const packageDirectory = resolve(process.argv[2] || latest.relativeDirectory);
const manifestPath = resolve(packageDirectory, "world.manifest.json");
const generationPath = resolve(packageDirectory, "generation.json");
const [externalText, generationText] = await Promise.all([
  readFile(manifestPath, "utf8"),
  readFile(generationPath, "utf8")
]);
const imported = await import(`${pathToFileURL(resolve(packageDirectory, "world.ts")).href}?align=${Date.now()}`);
const embedded = validateManifest((imported.default || imported.world).manifest);
const external = validateManifest(JSON.parse(externalText));
const generation = JSON.parse(generationText);
const attemptNumber = generation.repairAttempts.length + 1;

const stringArray = { type: "array", items: { type: "string" } };
const manifestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    packageVersion: { type: "string" }, stateSchemaVersion: { type: "string" }, worldId: { type: "string" }, name: { type: "string" },
    tickMs: { type: "integer" },
    signals: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      id: { type: "string" }, name: { type: "string" }, direction: { type: "string", enum: ["plc_to_world", "world_to_plc"] },
      dataType: { type: "string", enum: ["BOOL", "SINT", "USINT", "INT", "UINT", "DINT", "UDINT", "REAL", "STRING"] },
      normalValue: { type: ["boolean", "number", "string"] }, deviceId: { type: "string" }, role: { type: "string" }, description: { type: "string" }
    }, required: ["id", "name", "direction", "dataType", "normalValue", "deviceId", "role", "description"] } },
    controls: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, description: { type: "string" } }, required: ["id", "description"] } },
    inspectableState: stringArray, assumptions: stringArray, faultCapabilities: stringArray, evidenceTypes: stringArray,
    capabilities: { type: "object", additionalProperties: false, properties: { snapshot: { type: "boolean" }, migrate: { type: "boolean" }, seededRandom: { type: "boolean" } }, required: ["snapshot", "migrate", "seededRandom"] }
  },
  required: ["packageVersion", "stateSchemaVersion", "worldId", "name", "tickMs", "signals", "controls", "inspectableState", "assumptions", "faultCapabilities", "evidenceTypes", "capabilities"]
};
const schema = {
  type: "object", additionalProperties: false,
  properties: { diagnosis: { type: "string" }, canonicalManifest: manifestSchema },
  required: ["diagnosis", "canonicalManifest"]
};

const request = {
  model,
  reasoning: { effort: "high", summary: "auto" },
  max_output_tokens: 8000,
  input: [
    { role: "developer", content: "Repair generated package provenance. Return actual complete structured data; placeholders are invalid." },
    { role: "user", content: `The executable world exports the first manifest below, while the separately delivered file contains the second. The independent contract requires them to be identical. The executable behavior and tests pass, so make the embedded exported manifest canonical without changing any field or wording. Return it exactly as canonicalManifest.\n\nEMBEDDED EXPORTED MANIFEST:\n${JSON.stringify(embedded, null, 2)}\n\nDRIFTED EXTERNAL MANIFEST:\n${JSON.stringify(external, null, 2)}` }
  ],
  text: { format: { type: "json_schema", name: "controlsbench_manifest_alignment", description: "Canonical manifest aligned to executable world export.", strict: true, schema } }
};

function extractText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text" || item.type === "text").map((item) => item.text || "").join("");
}
const hash = (value) => createHash("sha256").update(value).digest("hex");

console.log(`[align] repair attempt ${attemptNumber} with ${model}; max output 8,000 tokens`);
const startedAt = Date.now();
const response = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(300_000)
});
const raw = await response.text();
if (!response.ok) throw new Error(`Meta Model API returned ${response.status}: ${raw.slice(0, 2000)}`);
const payload = JSON.parse(raw);
const repaired = JSON.parse(extractText(payload));
const canonical = validateManifest(repaired.canonicalManifest);
assert.deepEqual(canonical, embedded, "Muse did not return the executable world's exact embedded manifest");

const repairDirectory = resolve(packageDirectory, "repairs", String(attemptNumber).padStart(2, "0"));
await mkdir(repairDirectory, { recursive: true });
const canonicalText = `${JSON.stringify(canonical, null, 2)}\n`;
const attempt = {
  attempt: attemptNumber, generatedAt: new Date().toISOString(), durationMs: Date.now() - startedAt,
  status: "completed", responseId: payload.id || null, model: payload.model || model, usage: payload.usage || null,
  diagnosis: repaired.diagnosis, before: generation.files,
  after: { ...generation.files, "world.manifest.json": hash(canonicalText) }
};
generation.repairAttempts.push(attempt);
generation.files = attempt.after;
await Promise.all([
  writeFile(resolve(repairDirectory, "before-world.manifest.json"), externalText),
  writeFile(resolve(repairDirectory, "diagnosis.md"), `${repaired.diagnosis}\n`),
  writeFile(resolve(repairDirectory, "response.json"), `${JSON.stringify(attempt, null, 2)}\n`),
  writeFile(manifestPath, canonicalText),
  writeFile(generationPath, `${JSON.stringify(generation, null, 2)}\n`)
]);
console.log(JSON.stringify({ packageDirectory, repair: attempt }, null, 2));
