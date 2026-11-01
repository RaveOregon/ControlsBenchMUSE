import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CampaignLedger } from "../src/campaign/ledger.ts";
import { CampaignBudget } from "../src/campaign/budget.ts";
import { DurableSessionAccount } from "../src/campaign/session-account.ts";
import { commonWonderPaths } from "../src/campaign/wonder-paths.ts";
import { recordedM10Runtime } from "../src/campaign/m10-recorded.ts";
import { WonderResponsesProvider, fileExchangeJournal, wonderPricing } from "../src/campaign/wonder-responses.ts";

if (!process.argv.includes("--authorize-paid-wonder-checkpoint")) throw new Error("W3 not run: use --authorize-paid-wonder-checkpoint after integrator scheduling");
if (process.env.CONTROLSBENCH_WONDER_PRICING_REVIEWED !== wonderPricing.checkedOn) throw new Error("Verify current primary Meta pricing, then set CONTROLSBENCH_WONDER_PRICING_REVIEWED=2026-11-01. Update admission rates first if pricing changed.");
if (!process.env.MODEL_API_KEY) throw new Error("Set local MODEL_API_KEY without printing/persisting it");
// No stale marker can bypass offline validation before spending.
execFileSync(process.execPath, ["scripts/verify-wonder.js"], { stdio: "inherit", windowsHide: true });
const directory = `artifacts/wonder/checkpoint-${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(directory, { recursive: true });
const paths = commonWonderPaths(); mkdirSync(dirname(paths.session), { recursive: true });
const account = new DurableSessionAccount(paths.session, "wonder-recorded-checkpoint");
const ledger = new CampaignLedger("wonder-recorded-checkpoint", { file: join(directory, "campaign.jsonl") });
let runtime;
try {
  const provider = new WonderResponsesProvider({ apiKey: process.env.MODEL_API_KEY, explicitlyAuthorized: true, maxCalls: 4,
    journal: fileExchangeJournal(join(directory, "wonder-exchanges.jsonl")) });
  runtime = recordedM10Runtime({ ledger, provider, budget: new CampaignBudget(ledger, undefined, 5, account), paidAuthorized: true, maxTurns: 4 }).runtime;
  process.once("SIGINT", () => { void runtime.stop("Engineer cancelled bounded Wonder checkpoint"); });
  await runtime.start(false); await runtime.runAgent(); await runtime.stop("Bounded recorded Wonder checkpoint ended; inspect actual findings before claiming a gate pass");
  writeFileSync(join(directory, "report.json"), JSON.stringify(runtime.getReport(), null, 2) + "\n");
  writeFileSync(join(directory, "result.json"), JSON.stringify({ gate: "W3", status: runtime.status === "completed" ? "inspect-artifacts-before-pass" : "incomplete",
    model: provider.id, accountedDecisionAttempts: [...runtime.budget.guard.leases.values()].length,
    generationRequestsAttempted: readFileSync(join(directory, "wonder-exchanges.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(e => e.phase === "request" && e.endpoint === "responses").length,
    conservativeCampaignUsd: runtime.budget.guard.campaignSpentUsd,
    durableSessionUsd: account.spentUsd, maxGenerationAttempts: 4, maximumConservativeCampaignUsd: 4,
    perRequestAdmissionUsd: 1, pricing: wonderPricing, plcContacted: false, evidence: "recorded M10 only", liveCampaign: "not run" }, null, 2) + "\n");
  console.log(`Bounded Wonder checkpoint preserved at ${directory}; inspect response attribution and follow-up. No PLC connection.`);
} finally { if (runtime) await runtime.stop(); ledger.close(); account.close(); }
