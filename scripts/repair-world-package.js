import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateManifest } from "../src/proof/manifest.ts";

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error("MODEL_API_KEY is not set");
const model = process.env.META_MODEL?.trim() || "muse-wonder-1.0";
const baseUrl = (process.env.META_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/$/, "");
const latest = JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8"));
const packageDirectory = resolve(process.argv[2] || latest.relativeDirectory);

const paths = {
  manifest: resolve(packageDirectory, "world.manifest.json"),
  world: resolve(packageDirectory, "world.ts"),
  test: resolve(packageDirectory, "world.test.ts"),
  assumptions: resolve(packageDirectory, "assumptions.md"),
  generation: resolve(packageDirectory, "generation.json")
};
const [manifestText, worldTs, worldTestTs, assumptionsMd, generationText, contract] = await Promise.all([
  readFile(paths.manifest, "utf8"),
  readFile(paths.world, "utf8"),
  readFile(paths.test, "utf8"),
  readFile(paths.assumptions, "utf8"),
  readFile(paths.generation, "utf8"),
  readFile(resolve("src/proof/contracts.ts"), "utf8")
]);
const generation = JSON.parse(generationText);
const attemptNumber = (generation.repairAttempts?.length || 0) + 1;
if (attemptNumber > 5) throw new Error("Repair hard stop reached (5 attempts)");

let diagnostics = "";
try {
  execFileSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", resolve(packageDirectory, "tsconfig.json")], {
    cwd: resolve("."),
    encoding: "utf8",
    stdio: "pipe"
  });
  execFileSync(process.execPath, ["--test", paths.test], { cwd: resolve("."), encoding: "utf8", stdio: "pipe" });
  diagnostics = await readFile(resolve(packageDirectory, "gate-a-result.json"), "utf8").catch(() => "No compiler/test failure reproduced; inspect Gate A result.");
} catch (error) {
  diagnostics = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n");
}
if (diagnostics.length > 20000) diagnostics = diagnostics.slice(0, 20000);

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    diagnosis: { type: "string" },
    manifestJson: { type: "string" },
    worldTs: { type: "string" },
    worldTestTs: { type: "string" },
    assumptionsMd: { type: "string" }
  },
  required: ["diagnosis", "manifestJson", "worldTs", "worldTestTs", "assumptionsMd"]
};

const prompt = `
You are repairing your generated ControlsBench world package after independent compiler or contract diagnostics.

Return the complete corrected package, even when only one file changes. Fix the root cause without weakening tests, deleting required behavior, changing the platform contract, hiding diagnostics, or replacing causal behavior with scripted results. Preserve correct behavior and public manifest identifiers unless the diagnostic proves they are invalid. Do not return markdown fences around source file strings.

The platform contract is:
${contract}

Independent diagnostics:
${diagnostics}

Current world.manifest.json:
${manifestText}

Current world.ts:
${worldTs}

Current world.test.ts:
${worldTestTs}

Current assumptions.md:
${assumptionsMd}
`.trim();

const request = {
  model,
  reasoning: { effort: "high", summary: "auto" },
  max_output_tokens: 22000,
  input: [
    { role: "developer", content: "Repair executable industrial simulation code from concrete independent diagnostics. Do not merely explain the repair." },
    { role: "user", content: prompt }
  ],
  text: {
    format: {
      type: "json_schema",
      name: "controlsbench_world_repair",
      description: "A complete corrected ControlsBench generated-world package.",
      strict: true,
      schema: responseSchema
    }
  }
};

function extractText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output || []).flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" || item.type === "text")
    .map((item) => item.text || "").join("");
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

console.log(`[repair] attempt ${attemptNumber} with ${model}; timeout 5 minutes, max output 22,000 tokens`);
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
const repairedManifest = validateManifest(JSON.parse(repaired.manifestJson));
for (const role of ["drive.runCommand", "drive.runningFeedback", "motion.encoderCount", "sensor.entry"]) {
  if (!repairedManifest.signals.some((signal) => signal.role === role)) throw new Error(`Repair removed required role ${role}`);
}
if (!repairedManifest.controls.some((control) => control.id === "carton.introduce")) throw new Error("Repair removed carton.introduce");

const repairDirectory = resolve(packageDirectory, "repairs", String(attemptNumber).padStart(2, "0"));
await mkdir(repairDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(repairDirectory, "diagnostics.txt"), diagnostics),
  writeFile(resolve(repairDirectory, "before-world.manifest.json"), manifestText),
  writeFile(resolve(repairDirectory, "before-world.ts"), worldTs),
  writeFile(resolve(repairDirectory, "before-world.test.ts"), worldTestTs),
  writeFile(resolve(repairDirectory, "before-assumptions.md"), assumptionsMd),
  writeFile(resolve(repairDirectory, "diagnosis.md"), `${repaired.diagnosis}\n`)
]);

const nextManifestText = `${JSON.stringify(repairedManifest, null, 2)}\n`;
const attempt = {
  attempt: attemptNumber,
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  responseId: payload.id || null,
  model: payload.model || model,
  usage: payload.usage || null,
  diagnosis: repaired.diagnosis,
  diagnosticsHash: sha256(diagnostics),
  before: generation.files,
  after: {
    "world.manifest.json": sha256(nextManifestText),
    "world.ts": sha256(repaired.worldTs),
    "world.test.ts": sha256(repaired.worldTestTs),
    "assumptions.md": sha256(repaired.assumptionsMd)
  }
};
generation.repairAttempts = [...(generation.repairAttempts || []), attempt];
generation.files = attempt.after;

await Promise.all([
  writeFile(paths.manifest, nextManifestText),
  writeFile(paths.world, repaired.worldTs),
  writeFile(paths.test, repaired.worldTestTs),
  writeFile(paths.assumptions, repaired.assumptionsMd),
  writeFile(paths.generation, `${JSON.stringify(generation, null, 2)}\n`),
  writeFile(resolve(repairDirectory, "response.json"), `${JSON.stringify({ ...attempt, status: payload.status || null }, null, 2)}\n`)
]);

console.log(JSON.stringify({ packageDirectory, repair: attempt }, null, 2));
