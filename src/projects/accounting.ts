// Conservative reservations for paid preparation requests, kept in their own append-only durable
// account beside the campaign session account. Campaign history and its totals are untouched;
// reservations are admission accounting, not spend.
import { join } from "node:path";
import { DurableSessionAccount } from "../campaign/session-account.ts";
import { commonWonderPaths } from "../campaign/wonder-paths.ts";
import type { PreparationAccount } from "./preparation.ts";

export const preparationAccountPath = () => join(commonWonderPaths().root, "artifacts/wonder/preparation-session.jsonl");

export function durablePreparationAccount(path = preparationAccountPath(), hardUsd = 60): (jobId: string) => PreparationAccount {
  return jobId => {
    const account = new DurableSessionAccount(path, jobId, hardUsd);
    return { reserve: (requestId, usd) => account.charge(requestId, usd), close: () => account.close() };
  };
}
/** Fixture author: nothing to reserve. */
export const noAccount = (): PreparationAccount => ({ reserve() { throw new Error("A zero-cost fixture author must not reserve paid requests"); }, close() {} });
