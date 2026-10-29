import { cloneDemoModel } from "../core/demo-model.js";

const META_ENDPOINT = "https://api.meta.ai/v1/responses";

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" || item.type === "text")
    .map((item) => item.text || "")
    .join("");
}

function validateModel(candidate) {
  const process = candidate?.process;
  if (!candidate?.name || !process || !Array.isArray(candidate.signals)) {
    throw new Error("Muse returned an incomplete process model.");
  }
  for (const key of ["beltTravelMs", "packageIntervalMs", "entryWindow", "exitWindow"]) {
    if (process[key] === undefined) throw new Error(`Muse model is missing process.${key}.`);
  }
  candidate.schemaVersion = 1;
  candidate.tickMs = Math.max(50, Math.min(500, Number(candidate.tickMs) || 100));
  return candidate;
}

export async function compileModel(specification, { apiKey = process.env.MODEL_API_KEY, model = process.env.META_MODEL?.trim() || "muse-spark-1.3" } = {}) {
  if (!apiKey) {
    return {
      model: cloneDemoModel(),
      source: "bundled-fallback",
      note: "No MODEL_API_KEY is configured; loaded the inspectable competition demo model."
    };
  }

  const template = cloneDemoModel();
  const response = await fetch(META_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "high" },
      input: [
        {
          role: "developer",
          content: `You are ControlsBench's industrial process-model compiler. Convert the engineer's functional specification into a safe, declarative JSON model for a deterministic closed-loop simulator. Return JSON only, with no markdown. Preserve the exact schema shape of this example: ${JSON.stringify(template)}. Keep tickMs between 50 and 500. Do not generate executable code. Include at least one nominal and two abnormal experiments grounded in the specification.`
        },
        { role: "user", content: specification }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Meta Model API returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const payload = await response.json();
  const text = extractOutputText(payload).replace(/^```json\s*|\s*```$/g, "");
  const compiled = validateModel(JSON.parse(text));
  return {
    model: compiled,
    source: model,
    responseId: payload.id,
    note: `Compiled by ${model} from the supplied functional specification.`
  };
}
