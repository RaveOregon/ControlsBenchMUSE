import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateManifest } from "../src/proof/manifest.ts";

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) throw new Error("MODEL_API_KEY is not set. Run with: npm run proof:generate");

const model = process.env.META_MODEL?.trim() || "muse-wonder-1.0";
const baseUrl = (process.env.META_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/$/, "");
const specificationPath = resolve("docs/conveyor-machine-spec.md");
const contractPath = resolve("src/proof/contracts.ts");
const [specification, contract] = await Promise.all([
  readFile(specificationPath, "utf8"),
  readFile(contractPath, "utf8")
]);

const stringArray = { type: "array", items: { type: "string" } };
const signalSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    direction: { type: "string", enum: ["plc_to_world", "world_to_plc"] },
    dataType: { type: "string", enum: ["BOOL", "SINT", "USINT", "INT", "UINT", "DINT", "UDINT", "REAL", "STRING"] },
    normalValue: { type: ["boolean", "number", "string"] },
    deviceId: { type: "string" },
    role: { type: "string" },
    description: { type: "string" }
  },
  required: ["id", "name", "direction", "dataType", "normalValue", "deviceId", "role", "description"]
};
const packageSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    manifest: {
      type: "object",
      additionalProperties: false,
      properties: {
        packageVersion: { type: "string" },
        stateSchemaVersion: { type: "string" },
        worldId: { type: "string" },
        name: { type: "string" },
        tickMs: { type: "integer", minimum: 10, maximum: 1000 },
        signals: { type: "array", items: signalSchema },
        controls: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { id: { type: "string" }, description: { type: "string" } },
            required: ["id", "description"]
          }
        },
        inspectableState: stringArray,
        assumptions: stringArray,
        faultCapabilities: stringArray,
        evidenceTypes: stringArray,
        capabilities: {
          type: "object",
          additionalProperties: false,
          properties: {
            snapshot: { type: "boolean" },
            migrate: { type: "boolean" },
            seededRandom: { type: "boolean" }
          },
          required: ["snapshot", "migrate", "seededRandom"]
        }
      },
      required: [
        "packageVersion", "stateSchemaVersion", "worldId", "name", "tickMs", "signals", "controls",
        "inspectableState", "assumptions", "faultCapabilities", "evidenceTypes", "capabilities"
      ]
    },
    worldTs: { type: "string" },
    worldTestTs: { type: "string" },
    assumptionsMd: { type: "string" }
  },
  required: ["manifest", "worldTs", "worldTestTs", "assumptionsMd"]
};

const developerPrompt = `
You are Muse Wonder acting as the world-authoring intelligence inside ControlsBench.

Generate a complete executable TypeScript behavioral world for the accepted conveyor specification. The PLC application is the system under test. Model only the external physical process, devices, raw feedback, WCS/environment behavior, and faultable world. Never implement PLC routing, state-machine, alarm, counting, or acceptance logic on the PLC's behalf.

This is not a design summary. Return the complete package required by the response schema: manifest, world.ts source, world.test.ts source, and assumptions.md.

Hard boundaries:
- TypeScript is the behavioral source of truth. Do not return pseudocode, TODO behavior, ellipses, or a static timeline.
- Import contract types with: import type { ... } from "../../../src/proof/contracts.ts".
- Export both a named and default module: export const world: GeneratedWorldModule = ...; export default world.
- Use only standard JavaScript/TypeScript and the supplied WorldContext. No dependencies, filesystem, network, process, eval, Function constructor, or dynamic import.
- Keep all PLC-facing reads/writes, entities, evidence, and activity through WorldContext.
- All raw input writes require a concrete cause. Preserve physical truth separately from raw signals.
- Motion must be continuous and caused by observed PLC outputs. A scenario timer cannot move cartons while the drive is stopped.
- Actual divert position at carton intersection decides the physical path. A requested route does not decide physical truth.
- Implement raw encoder counts from physical belt motion, including explicit quantization/wrap behavior.
- Implement initialize, onPlcFrame, onControl, tick, snapshot, migrate, and dispose.
- onControl is the generic workstation intervention surface. Declare and implement at least carton.introduce; later fault controls may also be declared. The chassis records commands but contains no conveyor semantics.
- Publish each carton as entity type carton with at least numeric positionM, numeric velocityMps, string path, and nullable/string requestedRoute in state.
- Include the full conveyor with drive, one main lane, two sequential diverts, exits A/B, runout, sensor geometry, actuator travel, raw limits, readiness, and the specification's required first-proof faults. Gate A will exercise only the drive, encoder, entry/carton slice.
- Declare unique semantic signal roles. Gate A requires exactly one signal for each role: drive.runCommand, drive.runningFeedback, motion.encoderCount, and sensor.entry. Use additional clear roles for all other signals.
- Initial world-to-PLC image is provided as false/zero by the chassis. initialize must establish the physically correct normal state and explain effects.
- world.test.ts must use node:test, be self-contained apart from importing world.ts and the contract types, and test physical invariants rather than merely checking constants.
- Assumptions must distinguish specified facts from inferred configuration. Never invent a PLC acceptance threshold where the spec says TBD.
- The implementation must typecheck under strict TypeScript and run under Node 24 native TypeScript support.

The platform contract follows:

${contract}
`.trim();

const request = {
  model,
  reasoning: { effort: "high", summary: "auto" },
  max_output_tokens: 26000,
  input: [
    { role: "developer", content: developerPrompt },
    { role: "user", content: `Generate the complete ControlsBench world package from this accepted specification:\n\n${specification}` }
  ],
  text: {
    format: {
      type: "json_schema",
      name: "controlsbench_generated_world_package",
      description: "A complete executable generated-world package for the ControlsBench proof.",
      strict: true,
      schema: packageSchema
    }
  }
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function extractText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" || item.type === "text")
    .map((item) => item.text || "")
    .join("");
}

console.log(`[generate] requesting ${model}; hard request timeout 5 minutes, max output 26,000 tokens`);
const startedAt = new Date();
const response = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(300_000)
});
const raw = await response.text();
if (!response.ok) throw new Error(`Meta Model API returned ${response.status}: ${raw.slice(0, 2000)}`);

const payload = JSON.parse(raw);
const outputText = extractText(payload);
if (!outputText) throw new Error(`Meta response ${payload.id || "(unknown)"} contained no output text`);
const generated = JSON.parse(outputText);
const manifest = validateManifest(generated.manifest);

for (const requiredRole of ["drive.runCommand", "drive.runningFeedback", "motion.encoderCount", "sensor.entry"]) {
  if (!manifest.signals.some((signal) => signal.role === requiredRole)) throw new Error(`Generated manifest omitted required Gate A role ${requiredRole}`);
}
if (!manifest.controls.some((control) => control.id === "carton.introduce")) throw new Error("Generated manifest omitted carton.introduce control");

const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
const relativeDirectory = `artifacts/generated-world/${stamp}-${model}`;
const outputDirectory = resolve(relativeDirectory);
const generation = {
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  responseId: payload.id || null,
  status: payload.status || null,
  model: payload.model || model,
  requestedReasoning: request.reasoning,
  maxOutputTokens: request.max_output_tokens,
  sourceSpecification: "docs/conveyor-machine-spec.md",
  sourceContract: "src/proof/contracts.ts",
  inputHashes: { specification: sha256(specification), contract: sha256(contract) },
  usage: payload.usage || null,
  repairAttempts: [],
  files: {
    "world.manifest.json": sha256(`${JSON.stringify(manifest, null, 2)}\n`),
    "world.ts": sha256(generated.worldTs),
    "world.test.ts": sha256(generated.worldTestTs),
    "assumptions.md": sha256(generated.assumptionsMd)
  }
};
const generatedTsConfig = {
  extends: "../../../tsconfig.json",
  compilerOptions: { noEmit: true, allowImportingTsExtensions: true },
  include: ["world.ts", "world.test.ts"]
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "world.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(resolve(outputDirectory, "world.ts"), generated.worldTs),
  writeFile(resolve(outputDirectory, "world.test.ts"), generated.worldTestTs),
  writeFile(resolve(outputDirectory, "assumptions.md"), generated.assumptionsMd),
  writeFile(resolve(outputDirectory, "generation.json"), `${JSON.stringify(generation, null, 2)}\n`),
  writeFile(resolve(outputDirectory, "tsconfig.json"), `${JSON.stringify(generatedTsConfig, null, 2)}\n`)
]);
await writeFile(resolve("artifacts/generated-world/latest.json"), `${JSON.stringify({ relativeDirectory }, null, 2)}\n`);

console.log(JSON.stringify({ outputDirectory, ...generation }, null, 2));
