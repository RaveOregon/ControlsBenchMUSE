import { BudgetLimitError, ModelBudgetGuard } from "../proof/budget-guard.ts";
import type { RequestLease } from "../proof/budget-guard.ts";
import { CampaignLedger } from "./ledger.ts";

export const acceptedBudgetLimits = Object.freeze({ perRequestUsd: 1, repairEpisodeUsd: 2, campaignWarningUsd: 3,
  campaignHardUsd: 5, sessionHardUsd: 15, requestTimeoutMs: 300_000,
  failedRepairWarning: 3, failedRepairHard: 5, worldHeartbeatStaleMs: 2000 });

export class CampaignBudget {
  readonly guard: ModelBudgetGuard;
  readonly ledger: CampaignLedger;
  readonly checkHardUsd: number;
  #checks = new Map<string, number>(); #repairs = new Map<string, number>();
  #reservations = new Map<string, { checkId: string; amount: number }>();
  constructor(ledger: CampaignLedger, guard = new ModelBudgetGuard({ ...acceptedBudgetLimits }), checkHardUsd = 5) {
    this.ledger = ledger; this.guard = guard; this.checkHardUsd = checkHardUsd;
  }
  reserve(estimate: number, checkId: string, nowMs: number, repairEpisode?: string): RequestLease {
    const pending = [...this.#reservations.values()].filter(r => r.checkId === checkId).reduce((sum, r) => sum + r.amount, 0);
    if ((this.#checks.get(checkId) ?? 0) + pending + estimate > this.checkHardUsd) throw new BudgetLimitError("check_limit", "Check budget would be exceeded");
    const lease = this.guard.reserve({ purpose: checkId, nowMs, estimatedCostUsd: estimate || 0.000001, repairEpisode });
    this.#reservations.set(lease.id, { checkId, amount: estimate });
    this.#record(lease, checkId, "reserved", estimate, estimate === 0 ? "fake_zero" : "conservative_reservation"); return lease;
  }
  settle(lease: RequestLease, checkId: string, amount: number, basis: "fake_zero" | "provider_reported" | "conservative_reservation", status: RequestLease["status"] = "settled"): void {
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid provider cost");
    // Charge even aborted, malformed and failed requests. Never free a possibly spent reservation.
    this.guard.settle(lease.id, Math.min(amount, this.guard.limits.perRequestUsd));
    const excess = Math.max(0, amount - this.guard.limits.perRequestUsd);
    this.guard.campaignSpentUsd += excess; this.guard.sessionSpentUsd += excess;
    this.guard.leases.get(lease.id)!.status = status;
    this.#reservations.delete(lease.id);
    this.#checks.set(checkId, (this.#checks.get(checkId) ?? 0) + amount);
    if (lease.repairEpisode) this.#repairs.set(lease.repairEpisode, (this.#repairs.get(lease.repairEpisode) ?? 0) + amount);
    this.#record(lease, checkId, "settled", amount, basis);
    if (this.guard.campaignLevel() === "warning") this.ledger.append("budget.warning", { code: "campaign_warning", message: "Campaign has reached $3" });
    if (amount > lease.estimatedCostUsd || this.guard.campaignLevel() === "hard_stop" || this.guard.sessionSpentUsd >= this.guard.limits.sessionHardUsd)
      throw new BudgetLimitError("budget_exhausted", "Cost boundary reached; preserve state and stop model calls");
  }
  #record(lease: RequestLease, checkId: string, phase: "reserved" | "settled", costUsd: number, basis: string) {
    this.ledger.append("budget.accounted", { requestId: lease.id, phase, costUsd, campaignUsd: this.guard.campaignSpentUsd,
      sessionUsd: this.guard.sessionSpentUsd, checkUsd: this.#checks.get(checkId) ?? 0, repairUsd: this.#repairs.get(lease.repairEpisode ?? "") ?? 0,
      checkId, repairEpisode: lease.repairEpisode ?? "none", basis });
  }
}
