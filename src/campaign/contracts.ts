import type { RawValue } from "../proof/contracts.ts";

export const CAMPAIGN_VERSION = "controlsbench.campaign.v1" as const;
export const states = ["preparing", "running", "paused", "stopped", "completed", "failed"] as const;
export type CampaignStatus = typeof states[number];
export const outcomes = ["requested", "applied", "rejected", "timed_out", "stale", "inconclusive"] as const;
export type Outcome = typeof outcomes[number];
export type EvidenceClass = "fake_connector" | "preserved_live_plc" | "live_plc";

// One small JSON Schema vocabulary, shared by validation, provider prompts and UI exports.
export interface Schema {
  type?: string | string[]; enum?: readonly unknown[]; const?: unknown;
  properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean | Schema;
  items?: Schema; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number;
  minimum?: number; maximum?: number; anyOf?: Schema[];
}
export const str: Schema = { type: "string", minLength: 1, maxLength: 8000 };
const num: Schema = { type: "number", minimum: 0 };
const integer: Schema = { type: "integer", minimum: 0 };
const bool: Schema = { type: "boolean" };
export const raw: Schema = { type: ["boolean", "number", "string", "null"] };
export const obj = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
  type: "object", properties, required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: false
});
const list = (items: Schema, minItems = 0, maxItems = 200): Schema => ({ type: "array", items, minItems, maxItems });
const choice = (values: readonly unknown[]): Schema => ({ enum: values });
const record: Schema = { type: "object", additionalProperties: true };
const image: Schema = { type: "object", additionalProperties: raw };
const refs = list(str);
const duration: Schema = { type: "integer", minimum: 1, maximum: 300_000 };

export interface Provenance {
  spec: string; ioMap: string; plcBuild: string; worldModule: string; model: string; connector: string;
}
export interface Experiment {
  id: string; objective: string; category: string; requirements: string[];
}
export const experimentSchema = obj({ id: str, objective: str, category: str, requirements: refs });
export interface Claim { evidenceId: string; signal: string; equals: RawValue }
export interface Finding {
  id: string; title: string; experimentId: string; claims: Claim[];
  injectedTruthRefs: string[]; inference: string; assumptions: string[]; uncertainty: string;
}
export const findingSchema = obj({ id: str, title: str, experimentId: str,
  claims: list(obj({ evidenceId: str, signal: str, equals: raw }), 1), injectedTruthRefs: refs,
  inference: str, assumptions: refs, uncertainty: str });

export const toolSchemas = {
  inspect_spec: obj({}),
  inspect_signal_contract: obj({}),
  inspect_recent_evidence: obj({ limit: { type: "integer", minimum: 1, maximum: 100 } }),
  introduce_carton: obj({ itemId: str, requestedRoute: choice(["A", "B", "Unknown", null]) }),
  assign_route: obj({ itemId: str, route: choice(["A", "B", "Unknown"]) }),
  operator_action: obj({ action: choice(["start", "stop", "reset"]) }),
  acknowledge_completion: obj({ sequence: { type: "integer", minimum: 0, maximum: 4294967295 } }),
  set_downstream_readiness: obj({ destination: choice(["A", "B", "runout"]), ready: bool }),
  inject_fault: obj({ controlId: str, parameters: record }),
  clear_fault: obj({ controlId: str, parameters: record }),
  wait_for_condition: obj({ signal: str, equals: raw, timeoutMs: duration }),
  observe_for_duration: obj({ durationMs: duration }),
  branch_or_reset_world: obj({ mode: choice(["branch", "reset"]), label: str }),
  request_hmi_action: obj({ action: str }),
  capture_hmi_evidence: obj({ kind: choice(["frame", "clip"]), durationMs: duration }),
  create_followup_experiment: obj({ experiment: experimentSchema, evidenceRefs: list(str, 1), rationale: str }),
  record_finding: findingSchema,
  finish_campaign: obj({ summary: str })
} satisfies Record<string, Schema>;
export type ToolName = keyof typeof toolSchemas;
export interface ToolCall { id: string; name: ToolName; arguments: Record<string, unknown> }
export interface ToolResult { actionId: string; status: Outcome; message: string; evidenceRefs: string[]; value?: unknown }
const toolCallSchema = obj({ id: str, name: choice(Object.keys(toolSchemas)), arguments: record });
export interface Decision {
  summary: string;
  plan?: { objective: string; experiments: Experiment[] };
  completeExperiment?: { id: string; evidenceRefs: string[]; conclusion: "observed" | "inconclusive" };
  calls: ToolCall[];
}
export const decisionSchema = obj({ summary: str,
  plan: obj({ objective: str, experiments: list(experimentSchema, 1, 40) }),
  completeExperiment: obj({ id: str, evidenceRefs: list(str, 1), conclusion: choice(["observed", "inconclusive"]) }),
  calls: list(toolCallSchema, 0, 8)
}, ["plan", "completeExperiment"]);

const provenanceSchema = obj({ spec: str, ioMap: str, plcBuild: str, worldModule: str, model: str, connector: str });
const coordinatorSchema = obj({ sequence: integer, atIso: str, atMonotonicMs: num,
  lane: choice(["lifecycle", "control", "connector", "world"]), data: record });
const actionOutcome = obj({ actionId: str, status: choice(outcomes.slice(1)), message: str, evidenceRefs: refs, value: {} }, ["value"]);
export const eventSchemas = {
  "campaign.state": obj({ state: choice(states), reason: str }),
  "campaign.authorized": obj({ categories: list(str, 1), diagnosisMode: choice(["known", "blind"]) }),
  "provenance.recorded": obj({ provenance: provenanceSchema, evidenceClass: choice(["fake_connector", "preserved_live_plc", "live_plc"]), claimBoundary: str }),
  "plan.created": obj({ objective: str, experiments: list(experimentSchema, 1, 40) }),
  "plan.updated": obj({ objective: str, experiments: list(experimentSchema, 1, 40) }),
  "experiment.proposed": experimentSchema,
  "experiment.started": obj({ id: str }),
  "experiment.completed": obj({ id: str, evidenceRefs: list(str, 1), conclusion: choice(["observed", "inconclusive"]) }),
  "agent.activity": obj({ phase: str, summary: str, requestId: str }, ["requestId"]),
  "agent.request": obj({ requestId: str, phase: choice(["started", "completed", "failed", "timed_out", "cancelled"]), model: str,
    experimentId: str, elapsedMs: num, usage: record, responseId: str }, ["usage", "responseId"]),
  "agent.response": obj({ requestId: str, responseHash: str, response: record }),
  "action.requested": obj({ actionId: str, name: str, arguments: record, basedOnRevision: integer, experimentId: str }),
  "action.applied": actionOutcome,
  "action.rejected": actionOutcome,
  "action.timed_out": actionOutcome,
  "action.stale": actionOutcome,
  "action.inconclusive": actionOutcome,
  "connector.state": obj({ state: choice(["fresh", "stale", "quarantined", "passthrough"]), reason: str, ageMs: num }),
  "controller.action": obj({ actionId: str, action: str, observation: record }),
  "coordinator.event": obj({ origin: choice(["live-coordinator", "campaign-driver", "preserved-m7"]), source: coordinatorSchema }),
  "world.stimulus": obj({ actionId: str, control: record }),
  "world.raw_image": obj({ sourceId: str, image, epoch: str, sequence: str }),
  "world.evidence": obj({ source: record }),
  "world.branch": obj({ label: str, snapshot: record, rawImage: image }),
  "simulation.reset": obj({ sourceId: str, image }),
  "simulation.exited": obj({ reason: str }),
  "plc.acknowledged": obj({ sourceId: str, epoch: str, sequence: str, bootIdentity: str, plcCycle: str, outputCaptureCycle: str, latencyMs: num }),
  "plc.output": obj({ sourceId: str, values: image, plcCycle: str, outputCaptureCycle: str }),
  "hmi.action": obj({ actionId: str, action: str, reference: str, atIso: str }),
  "hmi.evidence": obj({ actionId: str, kind: choice(["frame", "clip"]), reference: str, atIso: str }),
  "observation": obj({ summary: str, evidenceRefs: list(str, 1) }),
  "discrepancy": obj({ summary: str, evidenceRefs: list(str, 1), expected: record, observed: record }),
  "followup.added": obj({ experiment: experimentSchema, evidenceRefs: list(str, 1), rationale: str }),
  "finding.created": findingSchema,
  "finding.accepted": obj({ id: str, reason: str }),
  "finding.rerun_requested": obj({ id: str, reason: str }),
  "fault.committed": obj({ commitment: str }),
  "fault.truth": obj({ commitment: str, truth: record, salt: str }),
  "budget.accounted": obj({ requestId: str, phase: choice(["reserved", "settled"]), costUsd: num,
    campaignUsd: num, sessionUsd: num, checkUsd: num, repairUsd: num, checkId: str, repairEpisode: str,
    basis: choice(["conservative_reservation", "provider_reported", "fake_zero"]) }),
  "budget.warning": obj({ code: str, message: str }),
  "budget.hard_stop": obj({ code: str, message: str }),
  "report.finalized": obj({ summary: str, throughSequence: integer })
} satisfies Record<string, Schema>;
export type EventType = keyof typeof eventSchemas;
export interface CampaignEvent {
  schemaVersion: typeof CAMPAIGN_VERSION; campaignId: string; id: string; sequence: number;
  atIso: string; type: EventType; visibility: "public" | "truth";
  data: Record<string, unknown>; previousHash: string; hash: string;
}
export const campaignEventSchema: Schema = { anyOf: Object.entries(eventSchemas).map(([type, data]) => obj({
  schemaVersion: { const: CAMPAIGN_VERSION }, campaignId: str, id: str,
  sequence: { type: "integer", minimum: 1 }, atIso: str, type: { const: type },
  visibility: choice(["public", "truth"]), data, previousHash: { type: "string" }, hash: str
})) };

function assertJson(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  if (depth > 64) throw new Error("JSON nesting limit exceeded");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") throw new Error("Only finite JSON data is allowed");
  if (ancestors.has(value)) throw new Error("Cyclic JSON data");
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Only plain JSON objects are allowed");
  ancestors.add(value); for (const v of Object.values(value)) assertJson(v, ancestors, depth + 1); ancestors.delete(value);
}
export function validate(schema: Schema, value: unknown, path = "$"): void {
  if (path === "$") assertJson(value);
  if (schema.anyOf) {
    if (!schema.anyOf.some(s => { try { validate(s, value); return true; } catch { return false; } })) throw new Error(`${path}: no matching schema`);
    return;
  }
  if (schema.const !== undefined && value !== schema.const) throw new Error(`${path}: wrong constant`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: invalid enum`);
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.includes(type) && !(allowed.includes("integer") && Number.isInteger(value))) throw new Error(`${path}: wrong type`);
  }
  if (typeof value === "number" && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw new Error(`${path}: number out of bounds`);
  if (typeof value === "string" && (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity))) throw new Error(`${path}: string out of bounds`);
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) throw new Error(`${path}: array out of bounds`);
    value.forEach((v, i) => { if (schema.items) validate(schema.items, v, `${path}[${i}]`); });
  } else if (value !== null && typeof value === "object") {
    const data = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!(k in data)) throw new Error(`${path}.${k}: required`);
    for (const [k, v] of Object.entries(data)) {
      const s = schema.properties && Object.hasOwn(schema.properties, k) ? schema.properties[k] : undefined;
      if (s) validate(s, v, `${path}.${k}`);
      else if (schema.additionalProperties === false) throw new Error(`${path}.${k}: unknown property`);
      else if (typeof schema.additionalProperties === "object") validate(schema.additionalProperties, v, `${path}.${k}`);
    }
  }
}

export function validateDecision(value: unknown): Decision {
  validate(decisionSchema, value);
  const decision = value as Decision;
  for (const call of decision.calls) validate(toolSchemas[call.name], call.arguments);
  return structuredClone(decision);
}
