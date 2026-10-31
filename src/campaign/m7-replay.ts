import { readFileSync } from "node:fs";
import { CampaignRuntime } from "./runtime.ts";
import { CampaignLedger } from "./ledger.ts";
import { FakeProvider } from "./provider.ts";
import type { CampaignProvider } from "./provider.ts";
import { importPreservedM7 } from "./live-evidence.ts";
import { fileHash, fixtureProvenance } from "./harness.ts";

const root = new URL("../../", import.meta.url);
export function preservedM7Runtime(ledger: CampaignLedger, provider?: CampaignProvider, paidAuthorized = false): CampaignRuntime {
  const trace = JSON.parse(readFileSync(new URL("artifacts/m7/m7-live-trace.json", root), "utf8"));
  const result = JSON.parse(readFileSync(new URL("artifacts/m7/m7-live-result.json", root), "utf8"));
  const reviewer = provider ?? new FakeProvider(context => {
    const evidence = context.evidence.filter(e => e.type === "plc.output").at(-1)!;
    const id = "preserved-m7-observation";
    if (!context.state.plan) return { summary: "Plan a review of preserved M7 observations", plan: { objective: "Review measurement DUT evidence without contacting a PLC", experiments: [
      { id, objective: "Inspect recorded PLC motor output after the M7 stationary hold", category: "evidence", requirements: [] }
    ] }, calls: [{ id: "inspect", name: "inspect_recent_evidence", arguments: { limit: 20 } }] };
    return { summary: "Record preserved observed motor state with its original trace reference", completeExperiment: { id, evidenceRefs: [evidence.id], conclusion: "observed" }, calls: [
      { id: "record", name: "record_finding", arguments: { id: "m7-final-output", title: "Preserved M7 ended with motor command false", experimentId: id,
        claims: [{ evidenceId: evidence.id, signal: "Motor_RunCmd", equals: false }], injectedTruthRefs: [], inference: "Consistent with the measurement DUT's recorded entry-to-motor behavior.",
        assumptions: ["Original M7 audit and provenance apply; no new execution"], uncertainty: "No final conveyor controller routing, WCS, alarm, HMI or sustained-rate coverage." } },
      { id: "finish", name: "finish_campaign", arguments: { summary: "M7 preserved evidence reviewed; no live action taken" } }
    ] };
  });
  const runtime = new CampaignRuntime({ ledger, provider: reviewer, paidAuthorized, maxTurns: paidAuthorized ? 1 : 10,
    provenance: { ...fixtureProvenance(reviewer.id), plcBuild: `sha256:${result.plcProjectSha256.toLowerCase()}`,
      worldModule: `sha256:${result.worldSha256.toLowerCase()}`, connector: `${trace.connectorId}/preserved-m7-v1;trace-sha256:${fileHash(new URL("artifacts/m7/m7-live-trace.json", root))}` },
    evidenceClass: "preserved_live_plc", claimBoundary: "Offline review of historical M7 measurement DUT evidence. No new PLC run and no final conveyor-controller coverage.",
    spec: readFileSync(new URL("docs/conveyor-machine-spec.md", root), "utf8"),
    signals: JSON.parse(readFileSync(new URL("artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.manifest.json", root), "utf8")).signals,
    categories: ["evidence", "adaptive"] });
  importPreservedM7(ledger, trace); return runtime;
}
