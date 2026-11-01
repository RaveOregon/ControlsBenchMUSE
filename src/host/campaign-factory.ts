// The host integration seam. A CampaignFactory builds one M9 CampaignRuntime against a
// host-owned ledger. The fixture factory below uses the deterministic fake connector; the M10
// live lane supplies a factory that builds the same runtime around its M8 connector, controller
// actions and passthrough adapter. The host, protocol and portal do not change.

import { readFileSync } from "node:fs";
import { LiveWorldCoordinator } from "../live/coordinator.ts";
import type { GeneratedWorldModule } from "../proof/contracts.ts";
import { acceptedBudgetLimits } from "../campaign/budget.ts";
import { systemClock } from "../campaign/clock.ts";
import { preservedConveyorBindings } from "../campaign/conveyor-bindings.ts";
import { CoordinatorCampaignDriver } from "../campaign/driver.ts";
import type { HmiAdapter, SimulationExit } from "../campaign/driver.ts";
import { FakeConnector } from "../campaign/fake-connector.ts";
import { adaptivePolicy, fixtureProvenance, normalPolicy } from "../campaign/harness.ts";
import type { CampaignLedger } from "../campaign/ledger.ts";
import { FakeProvider } from "../campaign/provider.ts";
import type { CampaignProvider } from "../campaign/provider.ts";
import { CampaignRuntime } from "../campaign/runtime.ts";
import type { HostBudgetLimits, HostEvidenceClass } from "./protocol.ts";

export interface CampaignFactoryContext {
  /** Host-owned ledger. The runtime must append to exactly this ledger. */
  ledger: CampaignLedger;
  /** Delegates to the host HMI session; inconclusive whenever no WebVisu session is observing. */
  hmi: HmiAdapter;
  /** Portal plan selection sent with Start, for factories that map it to categories. */
  scope: Record<string, boolean>;
}

export interface HostedCampaign {
  runtime: CampaignRuntime;
  /** Explicit hardware-passthrough selection and observation. Omit when unsupported. */
  simulationExit?: SimulationExit;
  /** Release connector/session resources after the campaign is terminal and the host replaces it. */
  dispose?(): Promise<void>;
}

export interface CampaignFactory {
  id: string;
  label: string;
  evidenceClass: HostEvidenceClass;
  claimBoundary: string;
  connectorId: string;
  outputIds: string[];
  limits?: HostBudgetLimits;
  supportsExitSimulation: boolean;
  create(context: CampaignFactoryContext): Promise<HostedCampaign>;
}

const root = new URL("../../", import.meta.url);
const packageUrl = new URL("artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/", root);
let instance = 0;

/**
 * Deterministic fixture campaign on the wall clock: preserved world 0.5.0, fake PLC connector,
 * zero-cost fixture provider. Evidence class `fake_connector`; never a PLC claim.
 */
export function fixtureCampaignFactory(options: { adaptive?: boolean; provider?: () => CampaignProvider } = {}): CampaignFactory {
  const adaptive = options.adaptive === true;
  const claimBoundary = "Deterministic fake PLC connector and fixture provider; no live PLC, no Muse call, no final conveyor coverage.";
  return {
    id: adaptive ? "fixture-adaptive" : "fixture-normal",
    label: adaptive ? "Fixture campaign · adaptive follow-up (fake connector)" : "Fixture campaign · nominal (fake connector)",
    evidenceClass: "fake_connector", claimBoundary, connectorId: "deterministic-fake-connector-v1",
    outputIds: ["Motor_RunCmd", "D1_ExtendCmd", "D2_ExtendCmd", "StackLight_Red", "StackLight_Green"],
    limits: { ...acceptedBudgetLimits }, supportsExitSimulation: true,
    async create({ ledger, hmi }) {
      const world = (await import(`${new URL("world.ts", packageUrl).href}?portal=${++instance}`)).default as GeneratedWorldModule;
      const connector = new FakeConnector(image => ({ Motor_RunCmd: image.PE_Entry === true && image.Drive_Overload !== true,
        D1_ExtendCmd: false, D2_ExtendCmd: false, StackLight_Red: image.Drive_Overload === true,
        StackLight_Green: adaptive ? false : image.Drive_Overload !== true }), systemClock);
      const coordinator = new LiveWorldCoordinator(world, connector, { seed: 20261031, worldVersion: world.manifest.packageVersion });
      const driver = new CoordinatorCampaignDriver(coordinator, ledger, preservedConveyorBindings, { clock: systemClock, operationTimeoutMs: 2000 });
      const provider = options.provider?.() ?? new FakeProvider(adaptive ? adaptivePolicy : normalPolicy);
      if (provider.paid) throw new Error("The fixture factory never authorizes a paid provider");
      const runtime = new CampaignRuntime({ ledger, provider, driver, clock: systemClock, hmi, provenance: fixtureProvenance(provider.id),
        evidenceClass: "fake_connector", claimBoundary,
        spec: readFileSync(new URL("docs/conveyor-machine-spec.md", root), "utf8"), signals: world.manifest.signals,
        categories: ["normal", "adaptive"] });
      // Fixture passthrough: the fake connector reports simulation deselected on its next observation.
      const simulationExit: SimulationExit = { async exit() { connector.simulation = false; return connector.observe(); } };
      return { runtime, simulationExit, dispose: () => connector.close() };
    }
  };
}

/** Loads an external factory module, e.g. the M10 live M8 factory: `export function createCampaignFactory(options)`. */
export async function loadCampaignFactory(modulePath: string, options: Record<string, unknown> = {}): Promise<CampaignFactory> {
  const module = await import(new URL(modulePath, `file:///${process.cwd().replaceAll("\\", "/")}/`).href) as { createCampaignFactory?: (o: Record<string, unknown>) => CampaignFactory | Promise<CampaignFactory> };
  if (typeof module.createCampaignFactory !== "function") throw new Error(`${modulePath} does not export createCampaignFactory(options)`);
  const factory = await module.createCampaignFactory(options);
  for (const key of ["id", "label", "evidenceClass", "claimBoundary", "connectorId"] as const) if (typeof factory[key] !== "string") throw new Error(`Campaign factory is missing ${key}`);
  if (!["fake_connector", "preserved_live_plc", "live_plc"].includes(factory.evidenceClass)) throw new Error("Unsupported factory evidence class");
  if (typeof factory.create !== "function") throw new Error("Campaign factory is missing create(context)");
  return factory;
}
