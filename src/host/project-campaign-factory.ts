// Campaign factory for the engineer's selected project. At Start it freezes the active selection,
// re-verifies its hashes, launches the selected world in the real isolated child (which must report
// the same world hash), builds the campaign from that project's own specification and signals, and
// seeds the Muse-prepared, source-linked test plan with its provenance. Runs are linked back to the
// project version. Offline composition only: fixture M8 transport and a labelled fixture campaign
// provider; live use of a fresh project world needs its own commissioning (see docs).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CampaignBudget, acceptedBudgetLimits } from "../campaign/budget.ts";
import type { Decision } from "../campaign/contracts.ts";
import { digest } from "../campaign/ledger.ts";
import { FakeProvider, type AgentContext, type CampaignProvider } from "../campaign/provider.ts";
import { CampaignRuntime } from "../campaign/runtime.ts";
import { openOfflineWonderSession } from "../live/wonder-process/index.ts";
import { outputIds } from "../live/m8-map.ts";
import { M8_PROFILE } from "../projects/m8-compatibility.ts";
import { readReview, verifySelection } from "../projects/selection.ts";
import { EXAMPLE_PROJECT_ID, ProjectError, type ProjectStore } from "../projects/store.ts";
import type { CampaignFactory } from "./campaign-factory.ts";
import { selectWonderScope, wonderScope } from "./wonder-scope.ts";

export interface ProjectFactoryOptions {
  store: ProjectStore;
  /** Fixture M8 transport module for the isolated child (offline composition). */
  transportModule: string;
  /** Per-campaign lock files for offline sessions; never the shared live lock. */
  lockDirectory: string;
  provider?: () => CampaignProvider;
}

export const PROJECT_FACTORY_ID = "project-offline";

/** Deterministic plan executor for offline campaigns. It is not Muse and judges nothing. */
export function fixtureCampaignProvider(): CampaignProvider {
  return new FakeProvider((context: AgentContext, turn: number): Decision => {
    const latest = context.evidence.filter(e => e.type === "plc.output").at(-1);
    const experiments = Object.values(context.state.experiments);
    const active = context.state.activeExperiment;
    const lease = { mode: "hold" as const, timeoutMs: 30_000 };
    const categories = context.boundary?.categories ?? [];
    // A prepared project arrives with its plan; the prepared example plans one observation here.
    if (turn === 1) return { summary: "Fixture provider: observe the selected world at rest before the planned checks", reasoningLease: lease,
      ...(experiments.length ? {} : { plan: { objective: "Fixture observation of the selected world", experiments: [{ id: "FIXTURE-OBSERVE", objective: "Observe the selected world at rest through the isolated child", category: categories.find(c => c !== "adaptive") ?? categories[0]!, requirements: [] }] } }),
      calls: [{ id: "fixture-observe-0", name: "observe_for_duration", arguments: { durationMs: 500 } }] };
    const calls: Decision["calls"] = [];
    if (turn === 3 && categories.includes("adaptive") && latest && !experiments.some(e => e.id === "FOLLOWUP-fixture"))
      calls.push({ id: "fixture-followup", name: "create_followup_experiment", arguments: { experiment: { id: "FOLLOWUP-fixture", objective: "Fixture-added follow-up: repeat the rest observation after the first check", category: "adaptive", requirements: [] },
        evidenceRefs: [latest.id], rationale: "Offline fixture demonstrates a campaign-added follow-up; not a Muse decision" } });
    const remaining = experiments.filter(e => e.status !== "completed" && e.id !== active);
    if (!active && !remaining.length && latest) {
      const last = experiments.at(-1)!.id, values = latest.data.values as Record<string, boolean | number | string | null>;
      return { summary: "Fixture provider: all planned checks have recorded observations", reasoningLease: lease, calls: [
        { id: `fixture-finding-${turn}`, name: "record_finding", arguments: { id: "FIXTURE-REST", title: "Fixture observation: selected world loaded and observed at rest through the isolated child", experimentId: last,
          claims: ["Motor_RunCmd", "StackLight_Red"].filter(s => s in values).map(signal => ({ evidenceId: latest.id, signal, equals: values[signal]! })), injectedTruthRefs: [],
          inference: "Boundary lineage only: the fixture M8 transport supplied these outputs; no PLC behavior is evidenced", assumptions: ["Offline fixture transport and provider"], uncertainty: "No live PLC and no Muse judgement; not a requirement verdict" } },
        { id: `fixture-finish-${turn}`, name: "finish_campaign", arguments: { summary: "Offline fixture campaign: each check recorded an observation of the selected world through the isolated child; no PLC or Muse judgement and no requirement verdict." } }] };
    }
    calls.push({ id: `fixture-observe-${turn}`, name: "observe_for_duration", arguments: { durationMs: 300 } });
    return { summary: `Fixture provider: record an observation for ${active ?? "the next check"}`, reasoningLease: lease, calls,
      ...(active && latest ? { completeExperiment: { id: active, evidenceRefs: [latest.id], conclusion: "observed" as const } } : {}) };
  });
}

const claimBoundary = "Offline: the selected project's generated world in the real isolated child with a fixture M8 transport and a fixture campaign provider. No PLC, no paid model, no requirement verdict; not live qualification.";

export function createProjectCampaignFactory(options: ProjectFactoryOptions): CampaignFactory {
  return { id: PROJECT_FACTORY_ID, label: "Selected project · isolated world child · fixture M8 transport (offline)", evidenceClass: "fake_connector", claimBoundary,
    connectorId: "isolated-m8-process-v1", outputIds, limits: { ...acceptedBudgetLimits }, supportsExitSimulation: true, scope: wonderScope,
    async create(context) {
      const store = options.store, selection = store.readActive();
      if (!selection) throw new ProjectError(409, "Select a validated project, or Load example conveyor, before Start");
      const files = verifySelection(store, selection);
      const scope = selectWonderScope(context.scope, wonderScope);
      const review = readReview(store, selection.projectId, selection.version);
      if (selection.kind === "uploaded" && !review?.plan.checks.length) throw new ProjectError(409, "Prepare the project's test plan before Start");
      const project = store.project(selection.projectId), version = store.version(selection.projectId, selection.version);
      mkdirSync(options.lockDirectory, { recursive: true });
      const session = await openOfflineWonderSession(context, { transportModule: options.transportModule, ownershipPath: join(options.lockDirectory, `${context.ledger.campaignId}.lock`),
        world: { worldPath: files.world, specPath: files.spec, expectedWorldSha256: selection.worldSha256, label: `${project.name} ${selection.version}` } });
      try {
        const provider = options.provider?.() ?? fixtureCampaignProvider();
        if (provider.paid) throw new Error("The offline project composition accepts only a zero-cost fixture provider");
        const manifest = JSON.parse(readFileSync(files.manifest, "utf8"));
        const signals = [...manifest.signals, ...session.driver.observedOutputIds!.filter(id => !manifest.signals.some((s: { id: string }) => s.id === id))
          .map(id => ({ id, direction: "plc_to_world", description: "Observed M8 controller diagnostic" }))];
        const plan = review?.plan.checks.filter(c => c.available && scope.includes(c.group)) ?? [];
        const notRun = review?.plan.checks.filter(c => !plan.includes(c)).map(c => ({ id: c.id, reason: c.available ? `Category ${c.group} not selected for this campaign` : c.unavailableReason })) ?? [];
        const runtime = new CampaignRuntime({ ledger: context.ledger, provider, budget: new CampaignBudget(context.ledger), driver: session.driver, controller: session.controller, hmi: context.hmi,
          paidAuthorized: false, requireDecisionLeases: true, evidenceClass: "fake_connector", claimBoundary, categories: scope,
          provenance: { ...session.provenance, model: provider.id, ioMap: `${session.provenance.ioMap};world-signals:${digest(signals)}` },
          spec: readFileSync(files.spec, "utf8"), signals,
          capabilities: { world: `${project.name} ${selection.version} · generated world sha256:${selection.worldSha256}`, semantic: session.driver.binding.describe,
            benchProfile: { id: M8_PROFILE.id, interface: M8_PROFILE.interface, platform: M8_PROFILE.platform, cadenceHz: M8_PROFILE.cadenceHz, note: M8_PROFILE.note }, preparedPlan: plan.map(c => ({ id: c.id, objective: c.objective, stimulus: c.stimulus, expected: c.expectedObservation, basis: c.expectedBasis, sourceRefs: c.sourceRefs })),
            hmi: "not operated in this composition; HMI checks are unavailable", steering: "no natural-language steering channel" } });
        const loaded = session.process.loaded;
        context.ledger.append("world.evidence", { source: { kind: "selected_project", projectId: project.id, projectName: project.name, version: selection.version, projectKind: selection.kind,
          specSha256: selection.specSha256, ...(selection.ioSha256 ? { ioSha256: selection.ioSha256 } : {}), worldSha256: selection.worldSha256, manifestSha256: selection.manifestSha256,
          loadedWorldSha256: loaded.worldSha256, loadedWorldVersion: loaded.worldVersion, childPid: session.process.identity.pid, benchProfile: M8_PROFILE.interface,
          preparation: version.job ? { jobId: version.job.id, author: version.job.provider.label, requests: version.job.requests, repairs: version.job.repairs,
            responseIds: review?.lineage.map(l => l.responseId).filter(Boolean) ?? [] } : { note: "Prepared example; historical generation evidence under artifacts/generated-world" } } }, "truth");
        if (plan.length) {
          // The Muse-prepared plan is the campaign's starting plan; its full criteria travel with it.
          context.ledger.append("world.evidence", { source: { kind: "prepared_plan", projectId: project.id, version: selection.version, author: version.job?.provider.label ?? "prepared example",
            objective: review!.plan.objective, checks: plan, notRun } }, "truth");
          context.ledger.append("plan.created", { objective: review!.plan.objective, experiments: plan.map(c => ({ id: c.id, objective: c.objective, category: c.group, requirements: c.requirementRefs })) });
          for (const c of plan) context.ledger.append("experiment.proposed", { id: c.id, objective: c.objective, category: c.group, requirements: c.requirementRefs });
        }
        if (selection.kind === "uploaded") {
          const runs = join(store.versionDir(project.id, selection.version), "runs");
          mkdirSync(runs, { recursive: true });
          writeFileSync(join(runs, `${context.ledger.campaignId}.json`), JSON.stringify({ campaignId: context.ledger.campaignId, startedAtIso: new Date().toISOString(), factory: PROJECT_FACTORY_ID,
            worldSha256: loaded.worldSha256, specSha256: selection.specSha256, plannedChecks: plan.map(c => c.id) }, null, 2) + "\n", { flag: "wx" });
        }
        return { runtime, simulationExit: session.simulationExit, dispose: () => session.dispose() };
      } catch (error) { await session.dispose(); throw error; }
    } };
}
export { EXAMPLE_PROJECT_ID };
