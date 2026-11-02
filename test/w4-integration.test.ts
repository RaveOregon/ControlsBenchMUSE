import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CampaignLedger } from "../src/campaign/ledger.ts";
import { WonderResponsesProvider, fileExchangeJournal } from "../src/campaign/wonder-responses.ts";
import type { AgentContext } from "../src/campaign/provider.ts";
import type { Decision } from "../src/campaign/contracts.ts";
import { createCampaignFactory } from "../src/host/wonder-campaign-factory.ts";
import { openOfflineWonderSession } from "../src/live/wonder-process/index.ts";
import type { WonderProcessSession } from "../src/live/wonder-process/index.ts";

test("W4 integration: native provider framing, real child, host ledger/HMI, tools, leases and observation-dependent fixture investigation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "w4-integrated-"));
  const ledger = new CampaignLedger("w4-offline-integration", { file: join(dir, "campaign.jsonl") });
  const hmi = { async perform(): Promise<never> { throw new Error("HMI operation unsupported in this offline fixture"); } };
  let session: WonderProcessSession | undefined, generations = 0;
  const contexts: AgentContext[] = [];
  // Fixture policy belongs only to this test. Production Wonder still chooses its own decisions.
  const policy = (context: AgentContext, turn: number): Decision => {
    const output = context.evidence.filter(e => e.type === "plc.output").at(-1)!;
    if (turn === 1) return { summary: "Exercise boundary tools with no claim about conveyor correctness", plan: { objective: "Offline source lineage", experiments: [
      { id: "baseline", objective: "Observe the configured protocol transport", category: "normal", requirements: [] }
    ] }, reasoningLease: { mode: "continue", timeoutMs: 8000 }, calls: [
      { id: "stop", name: "operator_action", arguments: { action: "stop" } },
      { id: "carton", name: "introduce_carton", arguments: { itemId: "301", requestedRoute: null } },
      { id: "offer", name: "assign_route", arguments: { itemId: "301", route: "A" } },
      { id: "readiness", name: "set_downstream_readiness", arguments: { destination: "B", ready: false } },
      { id: "observe-baseline", name: "observe_for_duration", arguments: { durationMs: 300 } }
    ] };
    if (turn === 2) {
      assert(context.results.every(r => r.status === "applied"));
      return { summary: "Select a new fixture investigation from the actual returned output", completeExperiment: { id: "baseline", evidenceRefs: [output.id], conclusion: "observed" }, calls: [
        { id: "followup", name: "create_followup_experiment", arguments: {
          experiment: { id: "after-observation", objective: `Inspect persistence of observed Motor_RunCmd=${String((output.data.values as any).Motor_RunCmd)}`, category: "adaptive", requirements: [] },
          evidenceRefs: [output.id], rationale: "The actual returned value selects the fixture hypothesis" } }
      ] };
    }
    if (turn === 3) return { summary: "Execute the newly selected observation", calls: [
      { id: "observe-followup", name: "observe_for_duration", arguments: { durationMs: 300 } }
    ] };
    return { summary: "Record exact fixture evidence without a live verdict", completeExperiment: { id: "after-observation", evidenceRefs: [output.id], conclusion: "observed" }, calls: [
      { id: "finding", name: "record_finding", arguments: { id: "boundary", title: "Output observed through isolated child", experimentId: "after-observation",
        claims: [{ evidenceId: output.id, signal: "Motor_RunCmd", equals: (output.data.values as any).Motor_RunCmd }], injectedTruthRefs: [],
        inference: "Source/tool lineage only", assumptions: ["Scripted M8 protocol transport"], uncertainty: "Not an M8 behavior oracle or real Wonder/live proof" } },
      { id: "finish", name: "finish_campaign", arguments: { summary: "Offline native-provider/process integration complete" } }
    ] };
  };
  const framed = new WonderResponsesProvider({ apiKey: "offline-only", explicitlyAuthorized: true, maxCalls: 4,
    journal: fileExchangeJournal(join(dir, "wonder-exchanges.jsonl")), fetch: (async (url: any, init: any) => {
      const body = JSON.parse(init.body);
      if (String(url).endsWith("input_tokens")) return Response.json({ input_tokens: 1000 });
      const context = JSON.parse(body.input.at(-1).content[0].text) as AgentContext;
      if (generations) {
        assert.equal(body.previous_response_id, `offline-response-${generations}`);
        assert.equal(body.input[0].call_id, `offline-call-${generations}`);
        context.results = JSON.parse(body.input[0].output).results;
      }
      contexts.push(context); const turn = ++generations;
      return Response.json({ id: `offline-response-${turn}`, status: "completed", output: [
        { type: "function_call", name: "campaign_decision", call_id: `offline-call-${turn}`, status: "completed", arguments: JSON.stringify(policy(context, turn)) }
      ] });
    }) as typeof fetch });
  const provider = { id: "offline-native-framing-process-fixture", paid: false, estimatedRequestUsd: 0,
    async decide(...args: Parameters<typeof framed.decide>) { return { ...await framed.decide(...args), costUsd: 0 }; } };
  try {
    const factory = createCampaignFactory({ provider: () => provider, openSession: async context => {
      assert.equal(context.ledger, ledger); assert.equal(context.hmi, hmi);
      return session = await openOfflineWonderSession(context, { transportModule: fileURLToPath(new URL("./fixtures/wonder-process-transport.ts", import.meta.url)), ownershipPath: join(dir, "offline.lock") });
    } });
    const hosted = await factory.create({ ledger, hmi, scope: { normal: true, adaptive: true }, artifactDirectory: dir });
    await hosted.runtime.start(true); await hosted.runtime.runAgent(); await hosted.runtime.stop();
    assert.equal(hosted.runtime.status, "completed", JSON.stringify(ledger.events.filter(e => e.type === "campaign.state")));
    assert.equal(generations, 4); assert.equal(hosted.runtime.getReport().budget.campaignUsd, 0);
    assert(Object.values(ledger.state.actions).every(a => a.status === "applied"));
    assert.equal(ledger.events.filter(e => e.type === "followup.added").length, 1);
    assert.match(ledger.state.experiments["after-observation"].objective, new RegExp(`Motor_RunCmd=${String((contexts[1].evidence.filter(e => e.type === "plc.output").at(-1)!.data.values as any).Motor_RunCmd)}$`));
    for (const context of contexts.slice(1)) for (const result of context.results) {
      assert.deepEqual(result, ledger.events.find(e => e.type === "action.applied" && e.data.actionId === result.actionId)!.data);
    }
    const journal = readFileSync(join(dir, "wonder-process", "parent-boundary.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    for (const id of ["stop", "carton", "offer", "readiness"]) {
      const intent = ledger.events.find(e => e.type === "action.requested" && e.data.actionId === id)!;
      assert.equal(journal.find(e => e.kind === "request" && e.actionId === id).campaignRevision, intent.data.basedOnRevision);
    }
    assert.equal(ledger.events.filter(e => e.type === "agent.response" && (e.data.response as any).phase === "decision_lease_finished").length, 4);
    writeFileSync(join(dir, "report.json"), JSON.stringify(hosted.runtime.getReport(), null, 2) + "\n");
    await hosted.dispose!(); assert.equal(session!.process.channel.exit?.code, 0);
    assert.equal(existsSync(join(dir, "offline.lock")), false);
    if (process.env.W4_INTEGRATION_EVIDENCE) cpSync(dir, process.env.W4_INTEGRATION_EVIDENCE, { recursive: true });
  } finally { await session?.dispose(); ledger.close(); rmSync(dir, { recursive: true, force: true }); }
});
