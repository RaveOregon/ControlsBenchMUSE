import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CampaignLedger, replay } from "../src/campaign/ledger.ts";
import { adaptivePolicy, createHarness, driveHarness } from "../src/campaign/harness.ts";
import { WonderResponsesProvider, fileExchangeJournal } from "../src/campaign/wonder-responses.ts";
import { recordedM10Runtime } from "../src/campaign/m10-recorded.ts";

const directory = `artifacts/wonder/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(directory, { recursive: true });
const write = (name, data) => writeFileSync(join(directory, name), JSON.stringify(data, null, 2) + "\n");
const contexts = [], decisions = []; let calls = 0;
const responses = new WonderResponsesProvider({ apiKey: "offline-placeholder", explicitlyAuthorized: true,
  journal: fileExchangeJournal(join(directory, "stub-exchanges.jsonl")),
  fetch: async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).endsWith("input_tokens")) return Response.json({ input_tokens: 2000 });
    const context = JSON.parse(body.input.at(-1).content[0].text);
    if (body.input[0].type === "function_call_output") context.results = JSON.parse(body.input[0].output).results;
    contexts.push(context); const turn = ++calls; const decision = adaptivePolicy(context, turn); decisions.push(decision);
    return Response.json({ id: `offline-response-${turn}`, status: "completed", usage: { input_tokens: 2000, output_tokens: 300 },
      output: [{ type: "function_call", name: "campaign_decision", call_id: `offline-call-${turn}`, arguments: JSON.stringify(decision), status: "completed" }] });
  } });
// Label and cost are explicitly offline. No fetch implementation can reach the network.
const provider = { id: "offline-Meta-Responses-stub-v1", paid: false, estimatedRequestUsd: 0,
  decide: (context, signal, audit) => responses.decide(context, signal, audit).then(reply => ({ ...reply, costUsd: 0 })) };
const h = await createHarness({ adaptive: true, provider, id: "wonder-offline", file: join(directory, "stub-campaign.jsonl") });
await driveHarness(h); write("stub-report.json", h.runtime.getReport());
write("representative-context.json", { evidenceClass: "fake_connector", actualModelCalls: 0, context: contexts[1], attributableDecision: decisions[1],
  originatingResponse: "offline-response-1", toolResults: contexts[1].results });
if (h.runtime.status !== "completed" || !h.ledger.state.experiments["persistence-probe"]) throw new Error("Offline multi-turn proof failed");
h.ledger.close();
const ledger = new CampaignLedger("wonder-recorded", { file: join(directory, "recorded-campaign.jsonl") });
const recorded = recordedM10Runtime({ ledger });
write("recorded-context.json", recorded.runtime.agentContext());
await recorded.runtime.start(false); await recorded.runtime.runAgent(); await recorded.runtime.stop();
write("recorded-report.json", recorded.runtime.getReport());
write("recorded-source-report.json", recorded.source.originalReport);
if (recorded.runtime.status !== "completed" || replay(ledger.events).evidenceClass !== "preserved_live_plc") throw new Error("Recorded proof failed");
ledger.close();
write("result.json", { status: "pass", base: "13c55b3", W0: "contract and representative-context.json", W1: "offline native Responses stub, four turns and adaptive investigation", W2: "302 recorded M10 acknowledgements and six original findings retained",
  actualModelCalls: 0, actualSpendUsd: 0, stubGenerationCalls: calls, sourceSha256: recorded.source.sha256, plcContacted: false,
  W3: "not executed by this offline runner; see artifacts/wonder/w3-latest.json for the separately scheduled checkpoint", W4: "not run; compatible Wonder process adapter and live qualification remain pending" });
writeFileSync("artifacts/wonder/latest.json", JSON.stringify({ directory, status: "pass", actualModelCalls: 0, actualSpendUsd: 0 }, null, 2) + "\n");
console.log(`Wonder offline proof: ${directory}; zero real model calls, $0 spend, no PLC contact.`);
