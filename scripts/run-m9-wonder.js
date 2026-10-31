import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, fsyncSync } from "node:fs";
import { CampaignLedger } from "../src/campaign/ledger.ts";
import { preservedM7Runtime } from "../src/campaign/m7-replay.ts";
import { WonderProvider } from "../src/campaign/wonder-provider.ts";

if (!process.argv.includes("--authorize-paid-wonder-checkpoint")) throw new Error("No paid call: explicit --authorize-paid-wonder-checkpoint required after user authorization");
if (!process.env.MODEL_API_KEY) throw new Error("MODEL_API_KEY is required; never print or persist it");
// Run all deterministic checks immediately before spending; no stale proof marker bypass.
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"], { stdio: "inherit" });
execFileSync(process.execPath, ["--test", "test/proof-chassis.test.ts", "test/budget-guard.test.ts", "test/live-coordinator.test.ts", "test/campaign.test.ts"], { stdio: "inherit" });
execFileSync(process.execPath, ["scripts/run-m9.js"], { stdio: "inherit" });
const directory = `artifacts/m9/wonder-${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(directory, { recursive: true });
const ledger = new CampaignLedger("m9-wonder-checkpoint", { file: `${directory}/events.jsonl` });
const runtime = preservedM7Runtime(ledger, new WonderProvider({ apiKey: process.env.MODEL_API_KEY, explicitlyAuthorized: true }), true);
// Durable session accounting prevents repeated checkpoint commands resetting the $15 session cap.
const sessionFile = "artifacts/m9/wonder-session.json";
const lockFile = "artifacts/m9/wonder-session.lock";
const lock = openSync(lockFile, "wx"); // Concurrent invocations cannot spend the same session reservation.
try {
const session = existsSync(sessionFile) ? JSON.parse(readFileSync(sessionFile, "utf8")) : { spentUsd: 0 };
if (!Number.isFinite(session.spentUsd) || session.spentUsd < 0) throw new Error("Invalid session account");
runtime.budget.guard.sessionSpentUsd = session.spentUsd;
if (session.spentUsd + 1 > runtime.budget.guard.limits.sessionHardUsd) throw new Error("Session hard budget reached");
// Reserve durably before networking. A crash remains charged; manual reconciliation is explicit.
writeFileSync(sessionFile, JSON.stringify({ spentUsd: session.spentUsd + 1, accounting: "conservative reservation", lastCheckpoint: directory }, null, 2) + "\n");
const sessionFd = openSync(sessionFile, "r+"); fsyncSync(sessionFd); closeSync(sessionFd);
try {
  await runtime.start(false); await runtime.runAgent(); await runtime.stop("One-call Wonder preserved-evidence checkpoint finished");
  writeFileSync(`${directory}/report.json`, JSON.stringify(runtime.getReport(), null, 2) + "\n");
  console.log(`One-call checkpoint preserved at ${directory}; no new live PLC run.`);
} finally { ledger.close(); }
} finally { closeSync(lock); unlinkSync(lockFile); }
