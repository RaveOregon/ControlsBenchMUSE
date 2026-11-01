import { recordedM10Runtime } from "../campaign/m10-recorded.ts";
import { acceptedBudgetLimits } from "../campaign/budget.ts";
import type { CampaignFactory } from "./campaign-factory.ts";
import type { CampaignProvider } from "../campaign/provider.ts";

/** Read-only, zero-cost W2 mode. A deterministic provider fixture, visibly labeled. */
export function createCampaignFactory(options: { provider?: () => CampaignProvider } = {}): CampaignFactory {
  return { id: "wonder-recorded-stub", label: "Recorded M10 · offline multi-turn provider fixture", evidenceClass: "preserved_live_plc",
    claimBoundary: "Recorded historical M10 PLC evidence, deterministic stub decisions; no new PLC or paid Wonder calls.",
    connectorId: "recorded-m10-read-only", outputIds: ["Motor_RunCmd", "D1_ExtendCmd", "D2_ExtendCmd", "StackLight_Red", "StackLight_Green"],
    limits: { ...acceptedBudgetLimits }, supportsExitSimulation: false,
    async create({ ledger, scope }) {
      if (Object.values(scope).some(v => v !== true)) throw new Error("Recorded review fixture requires its full evidence/adaptive review scope");
      const provider = options.provider?.();
      if (provider?.paid) throw new Error("Offline recorded factory cannot spend; use the bounded Wonder checkpoint");
      return { runtime: recordedM10Runtime({ ledger, provider }).runtime };
    } };
}
