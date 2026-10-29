import assert from "node:assert/strict";
import test from "node:test";
import { BudgetLimitError, ModelBudgetGuard } from "../src/proof/budget-guard.ts";

const limits = {
  perRequestUsd: 1,
  repairEpisodeUsd: 2,
  campaignWarningUsd: 3,
  campaignHardUsd: 5,
  sessionHardUsd: 15,
  requestTimeoutMs: 300_000,
  failedRepairWarning: 3,
  failedRepairHard: 5,
  worldHeartbeatStaleMs: 2_000
};

test("budget guard reserves, settles, and rejects campaign overspend", () => {
  const guard = new ModelBudgetGuard(limits);
  const lease = guard.reserve({ purpose: "diagnosis", estimatedCostUsd: 0.8, nowMs: 0 });
  guard.settle(lease.id, 0.5);
  guard.campaignSpentUsd = 4.6;
  assert.throws(() => guard.reserve({ purpose: "too much", estimatedCostUsd: 0.5, nowMs: 1 }), (error) => error instanceof BudgetLimitError && error.code === "campaign_limit");
});

test("budget guard distinguishes timeout, repair warning/stop, heartbeat, and held wait", () => {
  const guard = new ModelBudgetGuard(limits);
  const lease = guard.reserve({ purpose: "slow request", estimatedCostUsd: 0.5, nowMs: 0 });
  assert.equal(guard.checkRequest(lease.id, 299_999), "active");
  assert.equal(guard.checkRequest(lease.id, 300_000), "timed_out");
  assert.deepEqual([1, 2, 3, 4, 5].map(() => guard.recordRepairFailure("episode")), ["continue", "continue", "warning", "warning", "hard_stop"]);
  assert.equal(guard.classifyRuntime({ nowMs: 4_000, lastWorldHeartbeatAtMs: 0 }).state, "world_stalled");
  assert.equal(guard.classifyRuntime({ nowMs: 1_000, lastWorldHeartbeatAtMs: 900, conditionWait: { description: "sensor clears", startedAtMs: 0, timeoutMs: 2_000 } }).state, "waiting_condition");
  assert.equal(guard.classifyRuntime({ nowMs: 2_100, lastWorldHeartbeatAtMs: 2_000, conditionWait: { description: "sensor clears", startedAtMs: 0, timeoutMs: 2_000 } }).state, "condition_timeout");
});
