import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignLedger } from "../src/campaign/ledger.ts";
import { recordedM10Runtime } from "../src/campaign/m10-recorded.ts";
import { WonderResponsesProvider } from "../src/campaign/wonder-responses.ts";

const checkpoint = new URL("../artifacts/wonder/checkpoint-2026-11-01T22-14-56-275Z/", import.meta.url);
function semanticResults(results: any) {
  // A replay has new review timestamps/hashes/provider provenance and finding-event IDs.
  // Compare exact historical physical data and inspection refs, plus every terminal outcome.
  return results.map(({ evidenceRefs, value, ...result }: any) => ({ ...result, ...(value ? {
    evidenceRefs, observations: value.filter((e: any) => ["world.raw_image", "plc.acknowledged", "plc.output"].includes(e.type))
      .map(({ id, type, data }: any) => ({ id, type, data }))
  } : {}) }));
}

test("recorded real-Wonder replies replay offline through native lineage, semantic tools and exact-claim report", async () => {
  const exchanges = readFileSync(new URL("wonder-exchanges.jsonl", checkpoint), "utf8").trim().split("\n").map(line => JSON.parse(line));
  const original = JSON.parse(readFileSync(new URL("report.json", checkpoint), "utf8"));
  const responses = exchanges.filter(e => e.phase === "response"); let cursor = 0;
  const delivered: { actual: unknown; original: unknown }[] = [];
  const framed = new WonderResponsesProvider({ apiKey: "offline-replay-placeholder", explicitlyAuthorized: true, maxCalls: 3,
    journal: { append() {} }, fetch: (async (url: any, options: any) => {
      const recorded = responses[cursor++]; assert(recorded, "No additional model call is allowed");
      assert(String(url).endsWith(recorded.endpoint === "responses" ? "/responses" : "/responses/input_tokens"));
      const request = JSON.parse(options.body);
      const originalRequest = exchanges.find(e => e.phase === "request" && e.endpoint === recorded.endpoint && e.turn === recorded.turn);
      const originalBody = JSON.parse(originalRequest.requestText);
      assert.equal(request.previous_response_id, originalBody.previous_response_id);
      assert.equal(request.input[0]?.call_id, originalBody.input[0]?.call_id);
      if (recorded.endpoint === "responses" && request.input[0]?.type === "function_call_output") {
        delivered.push({ actual: JSON.parse(request.input[0].output).results, original: JSON.parse(originalBody.input[0].output).results });
      }
      return new Response(recorded.responseText, { status: recorded.httpStatus });
    }) as typeof fetch });
  const provider = { id: "offline-replay-of-real-Wonder-W3", paid: false, estimatedRequestUsd: 0,
    async decide(context: Parameters<typeof framed.decide>[0], signal: AbortSignal, audit?: Parameters<typeof framed.decide>[2]) {
      return { ...await framed.decide(context, signal, audit), costUsd: 0 };
    } };
  // Keep source event IDs so the actual model's exact claims resolve; no new model/network/PLC.
  const ledger = new CampaignLedger(original.campaignId);
  const { runtime } = recordedM10Runtime({ ledger, provider, maxTurns: 3 });
  await runtime.start(false); await runtime.runAgent(); await runtime.stop();
  const result = runtime.getReport();
  assert.equal(cursor, 6); assert.equal(result.status, "completed");
  assert.equal(delivered.length, 2);
  for (const pair of delivered) assert.deepEqual(semanticResults(pair.actual), semanticResults(pair.original));
  assert.deepEqual(result.findings, original.findings);
  assert.deepEqual(result.experiments, original.experiments);
  assert.equal(result.findings.flatMap(f => f.claims).length, 30);
  assert.equal(result.budget.campaignUsd, 0, "Recorded token usage is not new spending");
  assert(Object.values(ledger.state.actions).every(a => a.status === "applied"));
  assert.equal(ledger.events.filter(e => e.type === "followup.added").length, 0, "This observed checkpoint did not prove a novel adaptive follow-up");
});
