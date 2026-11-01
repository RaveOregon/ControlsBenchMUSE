import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { CoordinatorEvent } from "../live/coordinator.ts";
import type { AgentContext, CampaignProvider } from "./provider.ts";
import type { Decision } from "./contracts.ts";
import { FakeProvider } from "./provider.ts";
import { CampaignLedger, digest, readLedger, replay, report } from "./ledger.ts";
import { appendCoordinatorEvent } from "./live-evidence.ts";
import { CampaignRuntime } from "./runtime.ts";
import type { CampaignBudget } from "./budget.ts";

const root = new URL("../../", import.meta.url);
export const recordedM10Path = fileURLToPath(new URL("artifacts/m10/2026-11-01T00-58-43-185Z/campaign.jsonl", root));
export function loadRecordedM10() {
  const events = readLedger(recordedM10Path), projection = replay(events);
  if (projection.evidenceClass !== "live_plc" || projection.status !== "completed" || events.filter(e => e.type === "plc.output").length !== 302)
    throw new Error("Unexpected preserved M10 source; inspect provenance before replay");
  return { events, projection, originalReport: report(events), sha256: createHash("sha256").update(readFileSync(recordedM10Path)).digest("hex") };
}

/** Imports evidence, never old action intents/plans/findings as new campaign effects. */
export function recordedM10Runtime(options: { ledger: CampaignLedger; provider?: CampaignProvider; budget?: CampaignBudget; paidAuthorized?: boolean; maxTurns?: number }) {
  const source = loadRecordedM10(), { ledger } = options;
  const provider = options.provider ?? new FakeProvider(recordedReviewPolicy);
  const runtime = new CampaignRuntime({ ledger, provider, budget: options.budget, paidAuthorized: options.paidAuthorized,
    maxTurns: options.maxTurns ?? 12, evidenceClass: "preserved_live_plc",
    provenance: { ...source.projection.provenance!, model: provider.id, connector: `${source.projection.provenance!.connector}/recorded-m10/sha256:${source.sha256}` },
    claimBoundary: "RECORDED M10 evidence review. 302 historical M8 acknowledgements; zero new PLC actions. Proposed physical tools cannot run. No HMI or new live campaign verdict.",
    spec: readFileSync(new URL("docs/conveyor-machine-spec.md", root), "utf8"),
    signals: JSON.parse(readFileSync(new URL("artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.manifest.json", root), "utf8")).signals,
    capabilities: { recorded: true, readOnly: true, evidenceRetrieval: "inspect_evidence_window", physicalActions: false, leases: false,
      hmi: "unsupported; historical M10 has no HMI pixels", branch: "unsupported", rewrite: "unsupported" },
    categories: ["evidence", "adaptive"] });
  const mappings: Record<string, string> = {};
  for (const event of source.events) {
    if (event.type === "coordinator.event") {
      const refs = appendCoordinatorEvent(ledger, event.data.source as unknown as CoordinatorEvent, "preserved-m10");
      mappings[event.id] = refs[0];
    } else if (["world.raw_image", "plc.acknowledged", "plc.output"].includes(event.type)) {
      const sourceId = mappings[String(event.data.sourceId)];
      const derived = ledger.recentEvents(4, e => e.type === event.type).find(e => e.data.sourceId === sourceId);
      if (!derived) throw new Error("Recorded evidence source mapping missing"); mappings[event.id] = derived.id;
    } else if (event.type === "world.evidence") {
      mappings[event.id] = ledger.append("world.evidence", event.data, "truth").id;
    }
  }
  ledger.append("world.evidence", { source: {
    kind: "recorded_evidence_lineage", sourcePath: "artifacts/m10/2026-11-01T00-58-43-185Z/campaign.jsonl",
    sourceSha256: source.sha256, sourceCampaignId: source.projection.campaignId, mappingHash: digest(mappings), originalToReviewIds: mappings } }, "truth");
  ledger.append("agent.activity", { phase: "recorded_evidence", summary: "Loaded 302 recorded M10 acknowledgements; no PLC/model connection or new intervention" });
  return { runtime, source, mappings };
}

/** Explicit offline provider fixture. This policy is not used by Wonder or the live factory. */
export function recordedReviewPolicy(context: AgentContext, turn: number): Decision {
  const latest = context.evidence.filter(e => e.type === "plc.output").at(-1)!;
  if (turn === 1) return { summary: "Plan a recorded evidence review, with no live interventions", plan: { objective: "Review historical M10 output evidence", experiments: [
    { id: "recorded-baseline", category: "evidence", objective: "Inspect final recorded M8 outputs", requirements: [] }
  ] }, calls: [{ id: "read-final", name: "inspect_evidence_window", arguments: { ids: [latest.id], afterSequence: 0, throughSequence: context.evidenceWindow!.throughSequence, limit: 1 } }] };
  const exact = context.results.flatMap(r => Array.isArray(r.value) ? r.value : []).filter(e => e.type === "plc.output").at(-1) ?? latest;
  const fault = (exact.data.values as Record<string, unknown>)["controller.FaultCode"];
  if (turn === 2) return { summary: `Recorded fault ${fault} requires an earlier evidence comparison`, calls: [
    { id: "add-recorded-followup", name: "create_followup_experiment", arguments: { experiment: { id: "recorded-comparison", category: "adaptive",
      objective: `Compare earlier recorded outputs against final controller.FaultCode=${fault}`, requirements: [] }, evidenceRefs: [exact.id], rationale: "Check recorded evidence for a changed controller state; do not imply a new PLC trial" } },
    { id: "read-earlier", name: "inspect_evidence_window", arguments: { ids: [], afterSequence: 0, throughSequence: exact.sequence - 1, limit: 20 } }
  ] };
  if (turn === 3) return { summary: "Complete baseline and inspect the recorded comparison", completeExperiment: { id: "recorded-baseline", evidenceRefs: [latest.id], conclusion: "observed" }, calls: [
    { id: "read-comparison-final", name: "inspect_evidence_window", arguments: { ids: [latest.id], afterSequence: 0, throughSequence: latest.sequence, limit: 1 } }
  ] };
  return { summary: "Record exact historical observations and their limitations", completeExperiment: { id: "recorded-comparison", evidenceRefs: [latest.id], conclusion: "observed" }, calls: [
    { id: "record-historical", name: "record_finding", arguments: { id: "recorded-final-state", title: "Recorded M10 final outputs", experimentId: "recorded-comparison",
      claims: [{ evidenceId: latest.id, signal: "Motor_RunCmd", equals: latest.data.values && (latest.data.values as any).Motor_RunCmd }], injectedTruthRefs: [],
      inference: "Recorded output is consistent with the historical faulted hold. This review performed no new fault trial.", assumptions: ["Recorded M10 provenance and original six-case audit apply"], uncertainty: "No current PLC state, fault recovery, HMI or Wonder quality claim." } },
    { id: "finish-recorded", name: "finish_campaign", arguments: { summary: "Recorded M10 review completed; original evidence remains historical" } }
  ] };
}
