import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { LiveWorldCoordinator } from "../live/coordinator.ts";
import type { GeneratedWorldModule } from "../proof/contracts.ts";
import { CampaignLedger } from "./ledger.ts";
import { ManualClock } from "./clock.ts";
import { CoordinatorCampaignDriver } from "./driver.ts";
import { preservedConveyorBindings } from "./conveyor-bindings.ts";
import { FakeConnector } from "./fake-connector.ts";
import { FakeProvider } from "./provider.ts";
import type { AgentContext, CampaignProvider } from "./provider.ts";
import { CampaignRuntime } from "./runtime.ts";
import type { Decision, Experiment, Provenance } from "./contracts.ts";

const packageUrl = new URL("../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/", import.meta.url);
// src/campaign -> repository root is two levels above src, i.e. ../../ from src/campaign.
const root = new URL("../../", import.meta.url);
export function fileHash(url: URL): string { return createHash("sha256").update(readFileSync(url)).digest("hex"); }
export function fixtureProvenance(model: string): Provenance {
  return { spec: `sha256:${fileHash(new URL("docs/conveyor-machine-spec.md", root))}`,
    ioMap: `sha256:${fileHash(new URL("world.manifest.json", packageUrl))}`, plcBuild: "fake-measurement-fixture-v1",
    worldModule: `sha256:${fileHash(new URL("world.ts", packageUrl))}`, model, connector: "deterministic-fake-connector-v1" };
}
export const initialExperiment: Experiment = { id: "baseline", objective: "Introduce an unassigned carton and observe the measurement fixture at rest", category: "normal", requirements: [] };
const outputEvidence = (context: AgentContext) => context.evidence.filter(e => e.type === "plc.output");

export function normalPolicy(context: AgentContext, turn: number): Decision {
  if (turn === 1) return { summary: "Plan a bounded nominal fixture experiment", plan: { objective: "Exercise campaign causality", experiments: [initialExperiment] }, calls: [
    { id: "carton-1", name: "introduce_carton", arguments: { itemId: "M9-1", requestedRoute: null } },
    { id: "observe-1", name: "observe_for_duration", arguments: { durationMs: 300 } }
  ] };
  const evidence = outputEvidence(context).at(-1)!;
  return { summary: "Record observed output without claiming conveyor routing coverage", completeExperiment: { id: "baseline", evidenceRefs: [evidence.id], conclusion: "observed" }, calls: [
    { id: "finding-1", name: "record_finding", arguments: { id: "fixture-rest", title: "Measurement fixture remained stopped", experimentId: "baseline",
      claims: [{ evidenceId: evidence.id, signal: "Motor_RunCmd", equals: false }], injectedTruthRefs: [],
      inference: "This bounded fixture observation establishes no conveyor routing result.", assumptions: ["Fake connector measurement behavior"], uncertainty: "Production conveyor controller not exercised" } },
    { id: "finish-1", name: "finish_campaign", arguments: { summary: "Nominal fixture experiment evidenced" } }
  ] };
}

export function adaptivePolicy(context: AgentContext, turn: number): Decision {
  if (turn === 1) return { summary: "Probe a declared expected output under a bounded wait", plan: { objective: "Investigate an unexpected fixture output", experiments: [initialExperiment] }, calls: [
    { id: "await-green", name: "wait_for_condition", arguments: { signal: "StackLight_Green", equals: true, timeoutMs: 300 } }
  ] };
  const outputs = outputEvidence(context), evidence = outputs.at(-1)!;
  if (turn === 2) {
    const discrepancy = context.evidence.find(e => e.type === "discrepancy");
    if (!discrepancy) throw new Error("Adaptive fixture requires an actual unexpected observation");
    // New objective is synthesized from the observed signal/value; no runtime investigator selects it.
    const signal = String((discrepancy.data.expected as Record<string, unknown>).signal);
    return { summary: "Unexpected output warrants a new observation-duration investigation", calls: [
      { id: "add-investigation", name: "create_followup_experiment", arguments: { experiment: { id: "persistence-probe",
        objective: `Determine whether observed ${signal}=${(evidence.data.values as Record<string, unknown>)[signal]} persists for a longer window`, category: "adaptive", requirements: [] },
        evidenceRefs: [discrepancy.id], rationale: "Distinguish a transient observation from sustained output disagreement" } }
    ] };
  }
  if (turn === 3) return { summary: "Run the newly added investigation", completeExperiment: { id: "baseline", evidenceRefs: [evidence.id], conclusion: "inconclusive" }, calls: [
    { id: "longer-window", name: "observe_for_duration", arguments: { durationMs: 600 } }
  ] };
  return { summary: "Preserve the observed disagreement and its uncertainty", completeExperiment: { id: "persistence-probe", evidenceRefs: [evidence.id], conclusion: "observed" }, calls: [
    { id: "record-disagreement", name: "record_finding", arguments: { id: "persistent-output", title: "Green indication absent in both observation windows", experimentId: "persistence-probe",
      claims: [{ evidenceId: evidence.id, signal: "StackLight_Green", equals: false }], injectedTruthRefs: [], inference: "A longer observation did not resolve the output disagreement.",
      assumptions: ["Expected green indication is a fixture hypothesis"], uncertainty: "This is not a specified conveyor requirement failure or a diagnosed physical fault." } },
    { id: "finish-adaptive", name: "finish_campaign", arguments: { summary: "Adaptive fixture investigation completed with grounded evidence" } }
  ] };
}

let instance = 0;
export async function createHarness(options: { adaptive?: boolean; provider?: CampaignProvider; file?: string; id?: string; diagnosisMode?: "known" | "blind" } = {}) {
  const clock = new ManualClock();
  const provider = options.provider ?? new FakeProvider(options.adaptive ? adaptivePolicy : normalPolicy);
  const ledger = new CampaignLedger(options.id ?? "m9-fixture", { nowIso: () => clock.iso(), file: options.file });
  const world = (await import(`${new URL("world.ts", packageUrl).href}?m9=${++instance}`)).default as GeneratedWorldModule;
  const connector = new FakeConnector(image => ({ Motor_RunCmd: image.PE_Entry === true && image.Drive_Overload !== true,
    D1_ExtendCmd: false, D2_ExtendCmd: false, StackLight_Red: image.Drive_Overload === true,
    StackLight_Green: options.adaptive ? false : image.Drive_Overload !== true }), clock);
  const coordinator = new LiveWorldCoordinator(world, connector, { seed: 20261031, worldVersion: world.manifest.packageVersion });
  const driver = new CoordinatorCampaignDriver(coordinator, ledger, preservedConveyorBindings, { clock, operationTimeoutMs: 500 });
  const runtime = new CampaignRuntime({ ledger, provider, driver, clock, provenance: fixtureProvenance(provider.id),
    evidenceClass: "fake_connector", claimBoundary: "Deterministic fake PLC connector; no live PLC or final conveyor coverage.",
    spec: readFileSync(new URL("docs/conveyor-machine-spec.md", root), "utf8"), signals: world.manifest.signals,
    categories: ["normal", "adaptive"], diagnosisMode: options.diagnosisMode });
  return { runtime, clock, ledger, connector, coordinator, driver, provider };
}
export async function flushMicrotasks(): Promise<void> { for (let i = 0; i < 30; i++) await Promise.resolve(); }
export async function driveHarness(h: Awaited<ReturnType<typeof createHarness>>, maximumTicks = 200): Promise<void> {
  await h.runtime.start(false);
  const agent = h.runtime.runAgent();
  for (let i = 0; i < maximumTicks && h.runtime.status === "running"; i++) {
    await flushMicrotasks(); h.clock.advance(100); await h.driver.tick(); await flushMicrotasks();
  }
  await agent;
  if (h.runtime.status === "running") throw new Error("Deterministic harness exceeded tick bound");
  if (h.runtime.status === "completed") await h.runtime.stop();
}
