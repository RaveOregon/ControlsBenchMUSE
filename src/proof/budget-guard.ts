export interface BudgetLimits {
  perRequestUsd: number;
  repairEpisodeUsd: number;
  campaignWarningUsd: number;
  campaignHardUsd: number;
  sessionHardUsd: number;
  requestTimeoutMs: number;
  failedRepairWarning: number;
  failedRepairHard: number;
  worldHeartbeatStaleMs: number;
}

export interface RequestLease {
  id: string;
  purpose: string;
  repairEpisode?: string;
  estimatedCostUsd: number;
  reservedAtMs: number;
  deadlineAtMs: number;
  lastActivityAtMs: number;
  status: "active" | "settled" | "timed_out" | "failed";
}

export class BudgetLimitError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BudgetLimitError";
    this.code = code;
  }
}

export class ModelBudgetGuard {
  readonly leases = new Map<string, RequestLease>();
  readonly repairFailures = new Map<string, number>();
  campaignSpentUsd = 0;
  sessionSpentUsd = 0;
  #sequence = 0;
  #repairSpent = new Map<string, number>();
  readonly limits: BudgetLimits;

  constructor(limits: BudgetLimits) {
    this.limits = limits;
  }

  reserve(request: { purpose: string; estimatedCostUsd: number; nowMs: number; repairEpisode?: string }): RequestLease {
    const { purpose, estimatedCostUsd, nowMs, repairEpisode } = request;
    if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd <= 0) throw new BudgetLimitError("invalid_estimate", "Request cost estimate must be positive");
    if (estimatedCostUsd > this.limits.perRequestUsd) throw new BudgetLimitError("request_limit", `Estimated request cost $${estimatedCostUsd.toFixed(2)} exceeds per-request hard limit`);
    const reserved = [...this.leases.values()].filter((lease) => lease.status === "active").reduce((sum, lease) => sum + lease.estimatedCostUsd, 0);
    if (this.campaignSpentUsd + reserved + estimatedCostUsd > this.limits.campaignHardUsd) throw new BudgetLimitError("campaign_limit", "Campaign hard cost limit would be exceeded");
    if (this.sessionSpentUsd + reserved + estimatedCostUsd > this.limits.sessionHardUsd) throw new BudgetLimitError("session_limit", "Session hard cost limit would be exceeded");
    if (repairEpisode) {
      const repairSpent = this.#repairSpent.get(repairEpisode) || 0;
      const repairReserved = [...this.leases.values()].filter((lease) => lease.status === "active" && lease.repairEpisode === repairEpisode).reduce((sum, lease) => sum + lease.estimatedCostUsd, 0);
      if (repairSpent + repairReserved + estimatedCostUsd > this.limits.repairEpisodeUsd) throw new BudgetLimitError("repair_limit", "Repair-episode hard cost limit would be exceeded");
    }
    const lease: RequestLease = {
      id: `request-${++this.#sequence}`,
      purpose,
      repairEpisode,
      estimatedCostUsd,
      reservedAtMs: nowMs,
      deadlineAtMs: nowMs + this.limits.requestTimeoutMs,
      lastActivityAtMs: nowMs,
      status: "active"
    };
    this.leases.set(lease.id, lease);
    return structuredClone(lease);
  }

  recordActivity(id: string, nowMs: number): void {
    const lease = this.#activeLease(id);
    lease.lastActivityAtMs = nowMs;
  }

  checkRequest(id: string, nowMs: number): "active" | "timed_out" {
    const lease = this.#activeLease(id);
    if (nowMs >= lease.deadlineAtMs) {
      lease.status = "timed_out";
      return "timed_out";
    }
    return "active";
  }

  settle(id: string, actualCostUsd: number): void {
    const lease = this.#activeLease(id);
    if (!Number.isFinite(actualCostUsd) || actualCostUsd < 0) throw new BudgetLimitError("invalid_actual", "Actual request cost must be non-negative");
    if (actualCostUsd > this.limits.perRequestUsd) throw new BudgetLimitError("request_actual_limit", "Provider-reported request cost exceeded hard limit");
    this.campaignSpentUsd += actualCostUsd;
    this.sessionSpentUsd += actualCostUsd;
    if (lease.repairEpisode) this.#repairSpent.set(lease.repairEpisode, (this.#repairSpent.get(lease.repairEpisode) || 0) + actualCostUsd);
    lease.status = "settled";
  }

  fail(id: string): void {
    this.#activeLease(id).status = "failed";
  }

  recordRepairFailure(episode: string): "continue" | "warning" | "hard_stop" {
    const count = (this.repairFailures.get(episode) || 0) + 1;
    this.repairFailures.set(episode, count);
    if (count >= this.limits.failedRepairHard) return "hard_stop";
    if (count >= this.limits.failedRepairWarning) return "warning";
    return "continue";
  }

  campaignLevel(): "normal" | "warning" | "hard_stop" {
    if (this.campaignSpentUsd >= this.limits.campaignHardUsd) return "hard_stop";
    if (this.campaignSpentUsd >= this.limits.campaignWarningUsd) return "warning";
    return "normal";
  }

  classifyRuntime(input: {
    nowMs: number;
    lastWorldHeartbeatAtMs: number;
    conditionWait?: { description: string; startedAtMs: number; timeoutMs: number };
  }): { state: "healthy" | "world_stalled" | "waiting_condition" | "condition_timeout"; message: string; elapsedMs?: number } {
    const heartbeatAge = input.nowMs - input.lastWorldHeartbeatAtMs;
    if (heartbeatAge > this.limits.worldHeartbeatStaleMs) return { state: "world_stalled", message: `World heartbeat stale for ${heartbeatAge} ms`, elapsedMs: heartbeatAge };
    if (input.conditionWait) {
      const elapsedMs = input.nowMs - input.conditionWait.startedAtMs;
      if (elapsedMs >= input.conditionWait.timeoutMs) return { state: "condition_timeout", message: `Condition timed out: ${input.conditionWait.description}`, elapsedMs };
      return { state: "waiting_condition", message: `Waiting for ${input.conditionWait.description}`, elapsedMs };
    }
    return { state: "healthy", message: "World and coordinator active" };
  }

  #activeLease(id: string): RequestLease {
    const lease = this.leases.get(id);
    if (!lease) throw new BudgetLimitError("unknown_lease", `Unknown request lease ${id}`);
    if (lease.status !== "active") throw new BudgetLimitError("inactive_lease", `Request lease ${id} is ${lease.status}`);
    return lease;
  }
}
