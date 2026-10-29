import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const apiKey = process.env.MODEL_API_KEY;
if (!apiKey) {
  throw new Error("MODEL_API_KEY is not set. Run with: node --env-file=.env scripts/run-model-spike.js");
}

const model = process.env.META_MODEL?.trim() || "muse-wonder-1.0";
const baseUrl = (process.env.META_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/$/, "");
const specificationPath = resolve("docs/conveyor-machine-spec.md");
const specification = await readFile(specificationPath, "utf8");

const stringArray = {
  type: "array",
  items: { type: "string" }
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    artifactVersion: { type: "string" },
    name: { type: "string" },
    sourceSpecVersion: { type: "string" },
    objective: { type: "string" },
    executiveAssessment: { type: "string" },
    assumptions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          statement: { type: "string" },
          basis: { type: "string", enum: ["specified", "inferred", "proposed"] },
          consequence: { type: "string" },
          mustConfirmBeforeScoring: { type: "boolean" }
        },
        required: ["id", "statement", "basis", "consequence", "mustConfirmBeforeScoring"]
      }
    },
    signals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          dataType: { type: "string" },
          flow: {
            type: "string",
            enum: [
              "world_to_plc",
              "plc_to_world",
              "operator_to_plc",
              "plc_to_observer",
              "wcs_to_plc",
              "plc_to_wcs",
              "bench_instrumentation"
            ]
          },
          meaning: { type: "string" },
          normalValue: { type: "string" },
          requiredForFirstProof: { type: "boolean" }
        },
        required: ["id", "name", "dataType", "flow", "meaning", "normalValue", "requiredForFirstProof"]
      }
    },
    parameters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          value: { type: "string" },
          unit: { type: "string" },
          basis: { type: "string", enum: ["specified", "suggested", "assumed", "to_measure"] },
          rationale: { type: "string" }
        },
        required: ["id", "value", "unit", "basis", "rationale"]
      }
    },
    stateVariables: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          dataType: { type: "string" },
          initialValue: { type: "string" },
          owner: { type: "string", enum: ["world", "plc_observation", "wcs", "campaign"] },
          meaning: { type: "string" }
        },
        required: ["id", "dataType", "initialValue", "owner", "meaning"]
      }
    },
    reactiveBehaviors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          purpose: { type: "string" },
          trigger: { type: "string" },
          reads: stringArray,
          condition: { type: "string" },
          stateChanges: stringArray,
          emissions: stringArray,
          timing: { type: "string" },
          evidenceToRecord: stringArray
        },
        required: ["id", "purpose", "trigger", "reads", "condition", "stateChanges", "emissions", "timing", "evidenceToRecord"]
      }
    },
    faults: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          injectedGroundTruth: { type: "string" },
          affectedSignalsOrState: stringArray,
          activation: { type: "string" },
          clearing: { type: "string" },
          hiddenFromPlcDiagnosis: { type: "boolean" },
          safetyBoundary: { type: "string" }
        },
        required: ["id", "injectedGroundTruth", "affectedSignalsOrState", "activation", "clearing", "hiddenFromPlcDiagnosis", "safetyBoundary"]
      }
    },
    invariants: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          statement: { type: "string" },
          validation: { type: "string" },
          failureMeaning: { type: "string" }
        },
        required: ["id", "statement", "validation", "failureMeaning"]
      }
    },
    experiments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          requirementIds: stringArray,
          hypothesis: { type: "string" },
          preconditions: stringArray,
          actions: stringArray,
          observations: stringArray,
          decisionLogic: { type: "string" },
          possibleFollowUps: stringArray,
          verdictLimits: { type: "string" }
        },
        required: ["id", "requirementIds", "hypothesis", "preconditions", "actions", "observations", "decisionLogic", "possibleFollowUps", "verdictLimits"]
      }
    },
    ambiguities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          issue: { type: "string" },
          whyItMatters: { type: "string" },
          safeTemporaryTreatment: { type: "string" }
        },
        required: ["id", "issue", "whyItMatters", "safeTemporaryTreatment"]
      }
    },
    firstProofPlan: {
      type: "object",
      additionalProperties: false,
      properties: {
        surrogateScope: { type: "string" },
        successCriteria: stringArray,
        failureCriteria: stringArray,
        evidenceArtifacts: stringArray,
        whatThisDoesNotProve: stringArray
      },
      required: ["surrogateScope", "successCriteria", "failureCriteria", "evidenceArtifacts", "whatThisDoesNotProve"]
    }
  },
  required: [
    "artifactVersion",
    "name",
    "sourceSpecVersion",
    "objective",
    "executiveAssessment",
    "assumptions",
    "signals",
    "parameters",
    "stateVariables",
    "reactiveBehaviors",
    "faults",
    "invariants",
    "experiments",
    "ambiguities",
    "firstProofPlan"
  ]
};

const developerPrompt = `
You are the model-authoring intelligence inside ControlsBench, an autonomous PLC bench-testing product.

Your task is to transform the supplied accepted engineering specification into an inspectable reactive-world design artifact. The PLC application is the system under test. You must model the external physical process, WCS peer, fault controls, and evidence needs. Do not replace or reimplement the PLC decision logic.

This is an evaluation of whether you can author a coherent dynamic world, not whether you can repeat the specification. Be concrete about state, time evolution, observed PLC outputs, emitted PLC inputs, actuator travel, carton identity and routing, faults, invariants, and adaptive experiments.

Rules:
- Treat the specification as authoritative and distinguish specified facts from proposed or inferred assumptions.
- Preserve direction relative to the PLC application.
- Carton motion must depend on observed actual drive behavior, not an internal always-moving clock.
- Actual divert position at the physical decision point determines the exit, not the requested route.
- An unassigned carton reaching runout is normal; an A/B-assigned carton reaching runout is a misroute.
- Operator Stop freezes cartons and inhibits new feed; Reset does not restart.
- Do not invent acceptance thresholds where the specification says TBD. Mark those verdicts inconclusive or exploratory.
- Keep injected ground truth separate from what the PLC can observe.
- The seed test matrix is not a fixed campaign. Include follow-up choices driven by possible observed results.
- The first proof uses a clearly labeled surrogate connector only to validate the generated world's execution contract. It does not prove real PLC integration.
- Return only the structured artifact required by the response schema.
`.trim();

const request = {
  model,
  reasoning: { effort: "high", summary: "auto" },
  max_output_tokens: 30000,
  input: [
    { role: "developer", content: developerPrompt },
    {
      role: "user",
      content: `Create the reactive-world design artifact from this accepted specification:\n\n${specification}`
    }
  ],
  text: {
    format: {
      type: "json_schema",
      name: "controlsbench_reactive_world_design",
      description: "An inspectable design artifact for a Muse-authored reactive PLC bench environment.",
      strict: true,
      schema
    }
  }
};

const startedAt = new Date();
const response = await fetch(`${baseUrl}/responses`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json"
  },
  body: JSON.stringify(request)
});

const rawText = await response.text();
if (!response.ok) {
  throw new Error(`Meta Model API returned ${response.status}: ${rawText.slice(0, 2000)}`);
}

const payload = JSON.parse(rawText);
const outputText = typeof payload.output_text === "string"
  ? payload.output_text
  : (payload.output || [])
      .flatMap((item) => item.content || [])
      .filter((item) => item.type === "output_text" || item.type === "text")
      .map((item) => item.text || "")
      .join("");

if (!outputText) {
  throw new Error(`Meta response ${payload.id || "(unknown)"} contained no output text.`);
}

const artifact = JSON.parse(outputText);
const reasoningSummary = (payload.output || [])
  .filter((item) => item.type === "reasoning")
  .flatMap((item) => item.summary || item.content || [])
  .map((item) => item.text || "")
  .filter(Boolean)
  .join("\n\n");

const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
const outputDirectory = resolve("artifacts", "model-spikes", `${stamp}-${model}`);
await mkdir(outputDirectory, { recursive: true });

const metadata = {
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  responseId: payload.id,
  status: payload.status,
  model: payload.model || model,
  requestedReasoning: request.reasoning,
  sourceSpecification: "docs/conveyor-machine-spec.md",
  usage: payload.usage || null,
  counts: {
    assumptions: artifact.assumptions?.length || 0,
    signals: artifact.signals?.length || 0,
    stateVariables: artifact.stateVariables?.length || 0,
    reactiveBehaviors: artifact.reactiveBehaviors?.length || 0,
    faults: artifact.faults?.length || 0,
    invariants: artifact.invariants?.length || 0,
    experiments: artifact.experiments?.length || 0,
    ambiguities: artifact.ambiguities?.length || 0
  }
};

await Promise.all([
  writeFile(resolve(outputDirectory, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`),
  writeFile(resolve(outputDirectory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`),
  writeFile(resolve(outputDirectory, "reasoning-summary.md"), reasoningSummary ? `${reasoningSummary}\n` : "No reasoning summary was returned.\n")
]);

console.log(JSON.stringify({ outputDirectory, ...metadata }, null, 2));
