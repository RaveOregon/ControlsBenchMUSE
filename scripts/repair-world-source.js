import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error("MODEL_API_KEY is not set");
const model = process.env.META_MODEL?.trim() || "muse-wonder-1.0";
const baseUrl = (process.env.META_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/$/, "");
const latest = JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8"));
const packageDirectory = resolve(process.argv[2] || latest.relativeDirectory);
const worldPath = resolve(packageDirectory, "world.ts");
const generationPath = resolve(packageDirectory, "generation.json");
const [worldTs, manifestText, generationText, gateResult, contract] = await Promise.all([
  readFile(worldPath, "utf8"),
  readFile(resolve(packageDirectory, "world.manifest.json"), "utf8"),
  readFile(generationPath, "utf8"),
  readFile(resolve(packageDirectory, "gate-a-result.json"), "utf8"),
  readFile(resolve("src/proof/contracts.ts"), "utf8")
]);
const generation = JSON.parse(generationText);
const attemptNumber = generation.repairAttempts.length + 1;
if (attemptNumber > 5) throw new Error("Repair hard stop reached (5 attempts)");

const schema = {
  type: "object", additionalProperties: false,
  properties: { diagnosis: { type: "string" }, worldTs: { type: "string" } },
  required: ["diagnosis", "worldTs"]
};
const prompt = `
Repair the complete TypeScript source below from the independent Gate A failure. Return the entire corrected world.ts and a concise diagnosis. Do not return a patch, placeholder, ellipsis, or markdown fence. Preserve the exported manifest exactly, preserve all passing behavior and public identifiers, and do not weaken or bypass tests.

Accepted physical requirement:
- A belt stop freezes carton position.
- Stop removes motor run command; cartons halt with Drive_RunningFB off.
- Raw encoder progression must also stop when the belt is stopped.
- Physical motion and Drive_RunningFB must not contradict one another during stop behavior. If modeling coast, feedback must truthfully remain active until motion ends; immediate halt is also allowed by this demo specification.

Independent Gate A result:
${gateResult}

External manifest that must remain identical to the source export:
${manifestText}

Platform contract:
${contract}

Current complete world.ts:
${worldTs}
`.trim();
const request = {
  model,
  reasoning: { effort: "high", summary: "auto" },
  max_output_tokens: 12000,
  input: [
    { role: "developer", content: "Repair executable causal simulation code from a concrete failing invariant. Return complete compilable source." },
    { role: "user", content: prompt }
  ],
  text: { format: { type: "json_schema", name: "controlsbench_world_source_repair", description: "Complete corrected world source.", strict: true, schema } }
};

function extractText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text" || item.type === "text").map((item) => item.text || "").join("");
}
const hash = (value) => createHash("sha256").update(value).digest("hex");

console.log(`[repair-world] attempt ${attemptNumber} with ${model}; max output 12,000 tokens`);
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
if (repaired.worldTs.length < worldTs.length * 0.8 || !repaired.worldTs.includes("GeneratedWorldModule") || !repaired.worldTs.includes("export default world")) {
  throw new Error("Wonder returned incomplete world.ts source; package was not changed");
}

const repairDirectory = resolve(packageDirectory, "repairs", String(attemptNumber).padStart(2, "0"));
await mkdir(repairDirectory, { recursive: true });
const attempt = {
  attempt: attemptNumber, generatedAt: new Date().toISOString(), durationMs: Date.now() - startedAt,
  status: "completed_pending_gate", responseId: payload.id || null, model: payload.model || model, usage: payload.usage || null,
  diagnosis: repaired.diagnosis, before: generation.files,
  after: { ...generation.files, "world.ts": hash(repaired.worldTs) }
};
generation.repairAttempts.push(attempt);
generation.files = attempt.after;
await Promise.all([
  writeFile(resolve(repairDirectory, "before-world.ts"), worldTs),
  writeFile(resolve(repairDirectory, "diagnosis.md"), `${repaired.diagnosis}\n`),
  writeFile(resolve(repairDirectory, "response.json"), `${JSON.stringify(attempt, null, 2)}\n`),
  writeFile(worldPath, repaired.worldTs),
  writeFile(generationPath, `${JSON.stringify(generation, null, 2)}\n`)
]);
console.log(JSON.stringify({ packageDirectory, repair: attempt }, null, 2));
