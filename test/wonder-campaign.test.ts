import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WonderResponsesProvider } from "../src/campaign/wonder-responses.ts";
import { adaptivePolicy, createHarness, driveHarness, flushMicrotasks, initialExperiment } from "../src/campaign/harness.ts";
import type { AgentContext } from "../src/campaign/provider.ts";
import type { Decision, DecisionLease } from "../src/campaign/contracts.ts";
import { validateDecision } from "../src/campaign/contracts.ts";
import { CampaignBudget, acceptedBudgetLimits } from "../src/campaign/budget.ts";
import { CampaignLedger, readLedger, replay } from "../src/campaign/ledger.ts";
import { ModelBudgetGuard } from "../src/proof/budget-guard.ts";
import { DurableSessionAccount } from "../src/campaign/session-account.ts";
import { recordedM10Runtime } from "../src/campaign/m10-recorded.ts";
import type { DecisionLeaseReceipt } from "../src/campaign/process-port.ts";
import { contextResults } from "../src/campaign/model-context.ts";

const idle: Decision = { summary: "Bounded fixture decision", calls: [] };
function transport(policy: (context: AgentContext, turn: number) => unknown | Promise<unknown>, options: { inputTokens?: number; payload?: (decision: unknown, turn: number) => unknown; status?: number } = {}) {
  const requests: { url: string; body: any }[] = [], contexts: AgentContext[] = [], journal: Record<string, unknown>[] = [];
  let generations = 0;
  const provider = new WonderResponsesProvider({ apiKey: "fixture-key-never-persist", explicitlyAuthorized: true, maxCalls: 5,
    journal: { append(record) { journal.push(structuredClone(record)); } }, fetch: (async (url: any, init: any) => {
      assert(init.signal); const body = JSON.parse(init.body); requests.push({ url: String(url), body });
      if (String(url).endsWith("input_tokens")) return Response.json({ input_tokens: options.inputTokens ?? 2000 });
      const context = JSON.parse(body.input.at(-1).content[0].text) as AgentContext;
      if (body.input[0]?.type === "function_call_output") context.results = JSON.parse(body.input[0].output).results;
      contexts.push(context); const turn = ++generations; const decision = await policy(context, turn);
      return Response.json(options.payload?.(decision, turn) ?? { id: `response-${turn}`, status: "completed", usage: { input_tokens: 2000, output_tokens: 300, output_tokens_details: { reasoning_tokens: 100 }, input_tokens_details: { cached_tokens: 500 } },
        output: [{ type: "function_call", name: "campaign_decision", call_id: `call-${turn}`, status: "completed", arguments: JSON.stringify(decision) }] }, { status: options.status ?? 200 });
    }) as typeof fetch });
  return { provider, requests, contexts, journal, get generations() { return generations; } };
}

test("W1: native multi-turn Responses decisions cause tools, exact observations, novel follow-up and shared report", async () => {
  const stub = transport(adaptivePolicy), h = await createHarness({ adaptive: true, provider: stub.provider, paidAuthorized: true });
  await driveHarness(h);
  assert.equal(h.runtime.status, "completed"); assert.equal(stub.generations, 4);
  const contexts = stub.contexts;
  assert.equal(contexts[0].state.plan, undefined);
  assert.equal(contexts[1].results[0].status, "timed_out");
  const discrepancy = contexts[1].evidence.find(e => e.type === "discrepancy")!;
  const followup = h.ledger.events.find(e => e.type === "followup.added")!;
  assert.deepEqual(followup.data.evidenceRefs, [discrepancy.id]);
  assert.match(h.ledger.state.experiments["persistence-probe"].objective, /StackLight_Green=false/);
  for (const context of contexts) for (const event of context.evidence) assert.deepEqual(event, h.ledger.getEvent(event.id));
  const calls = stub.requests.filter(r => r.url.endsWith("/responses"));
  assert.equal(calls[0].body.previous_response_id, undefined);
  assert.equal(calls[1].body.previous_response_id, "response-1");
  assert.equal(calls[1].body.input[0].call_id, "call-1");
  assert.deepEqual(JSON.parse(calls[1].body.input[0].output).results, contexts[1].results);
  const report = h.runtime.getReport(); assert.equal(report.findings.length, 1); assert.equal(report.budget.campaignUsd, 4);
  assert(h.ledger.events.some(e => e.type === "budget.warning"));
  assert(stub.journal.some(r => r.phase === "response" && r.endpoint === "responses"));
  assert(!JSON.stringify(stub.journal).includes("fixture-key-never-persist"));
  assert.deepEqual(replay(h.ledger.events), h.ledger.state);
});

test("W1: evidence-dependent choice changes when the actual observation changes", async () => {
  const policy = (context: AgentContext, turn: number): Decision => {
    if (turn === 1) return { summary: "Observe before selecting a hypothesis", plan: { objective: "Probe", experiments: [initialExperiment] }, calls: [{ id: "observe", name: "observe_for_duration", arguments: { durationMs: 200 } }] };
    const output = context.evidence.filter(e => e.type === "plc.output").at(-1)!;
    return { summary: "Choose only from returned evidence", calls: [{ id: "add", name: "create_followup_experiment", arguments: {
      experiment: { id: "new", objective: `Investigate green ${String((output.data.values as any).StackLight_Green)}`, category: "adaptive", requirements: [] }, evidenceRefs: [output.id], rationale: "Actual observed value selects the hypothesis" } }] };
  };
  const objectives: string[] = [];
  for (const adaptive of [false, true]) {
    const stub = transport(policy), h = await createHarness({ adaptive, provider: stub.provider, paidAuthorized: true }); h.runtime.options.maxTurns = 2;
    await driveHarness(h); objectives.push(h.ledger.state.experiments.new.objective); await h.runtime.stop();
  }
  assert.deepEqual(objectives, ["Investigate green true", "Investigate green false"]);
});

test("W1: malformed, incomplete, text, unsupported and repeated model responses preserve raw data before rejecting", async () => {
  const payloads = [
    () => ({ id: "r", status: "completed", output_text: "All requirements passed" }),
    () => ({ id: "r", status: "incomplete", output: [] }),
    () => ({ id: "r", status: "completed", output: [{ type: "function_call", name: "campaign_decision", call_id: "c", arguments: "{bad" }] }),
    () => ({ id: "r", status: "completed", output: [{ type: "function_call", name: "write_plc", call_id: "c", arguments: "{}" }] }),
    () => ({ id: "same-response", status: "completed", output: [{ type: "function_call", name: "campaign_decision", call_id: "same-call", arguments: JSON.stringify(idle) }] })
  ];
  for (const payload of payloads) {
    const stub = transport(() => idle, { payload }), h = await createHarness({ provider: stub.provider, paidAuthorized: true });
    await h.runtime.start(false); await h.runtime.runAgent();
    assert.equal(h.runtime.status, "paused"); assert.equal(Object.keys(h.ledger.state.actions).length, 0);
    assert(stub.journal.some(e => e.phase === "response" && e.endpoint === "responses"));
    assert.equal(h.ledger.state.budget.campaignUsd, stub.generations);
    await h.runtime.stop();
  }
});

test("W1: request admission counts stored history and forbids generation over $1", async () => {
  const stub = transport(() => idle, { inputTokens: 300_000 }), h = await createHarness({ provider: stub.provider, paidAuthorized: true });
  await h.runtime.start(false); await h.runtime.runAgent();
  assert.equal(stub.generations, 0); assert.equal(stub.requests.length, 1);
  assert.equal(h.ledger.state.budget.campaignUsd, 1); assert.equal(h.runtime.status, "paused");
  assert(stub.journal.some(e => e.phase === "admission" && Number(e.maximumUsd) > 1)); await h.runtime.stop();
});

test("W1: stale decisions and duplicate actions cause no repeated effect", async () => {
  let release!: (d: Decision) => void;
  const stub = transport(() => new Promise(r => { release = r; })), h = await createHarness({ provider: stub.provider, paidAuthorized: true });
  await h.runtime.start(false); const agent = h.runtime.runAgent(); await flushMicrotasks();
  await h.runtime.applyDecision({ summary: "An operator changed state", plan: { objective: "Another state", experiments: [initialExperiment] }, calls: [] }, h.ledger.state.revision);
  release({ summary: "Obsolete plan", calls: [{ id: "never", name: "introduce_carton", arguments: { itemId: "9", requestedRoute: null } }] });
  await agent; assert.equal(h.runtime.status, "paused"); assert(!h.ledger.state.actions.never); assert.equal(h.ledger.state.budget.campaignUsd, 1);
  await h.runtime.stop();
  assert.throws(() => validateDecision({ summary: "Duplicated", calls: [{ id: "once", name: "inspect_spec", arguments: {} }, { id: "once", name: "inspect_spec", arguments: {} }] }), /Duplicate/);
});

test("W1: timeout/cancelled/failed calls retain a full conservative charge and ignore late effects", async () => {
  for (const mode of ["timeout", "stop", "http", "network"] as const) {
    let release: ((d: Decision) => void) | undefined;
    const stub = transport(() => mode === "http" ? idle : new Promise(r => { release = r; }), { status: mode === "http" ? 503 : 200 });
    const h = await createHarness({ provider: mode === "network" ? { ...stub.provider, id: "network", paid: true, estimatedRequestUsd: 1, async decide() { throw new Error("offline network"); } } : stub.provider, paidAuthorized: true });
    h.runtime.options.budget = h.runtime.budget;
    h.runtime.budget.guard.limits.requestTimeoutMs = 200;
    await h.runtime.start(false); const agent = h.runtime.runAgent(); await flushMicrotasks();
    if (mode === "timeout") h.clock.advance(201);
    if (mode === "stop") await h.runtime.stop();
    await agent; assert.equal(h.ledger.state.budget.campaignUsd, 1);
    const before = Object.keys(h.ledger.state.actions).length;
    release?.({ summary: "Too late", calls: [{ id: "late-effect", name: "inspect_spec", arguments: {} }] }); await flushMicrotasks();
    assert.equal(Object.keys(h.ledger.state.actions).length, before);
    if (release) assert(stub.journal.some(e => e.phase === "response" && e.endpoint === "responses"), "Late raw response retained independently of stopped runtime");
    await h.runtime.stop();
  }
});

test("W1: warning/hard-stop refuses a sixth call and retains valid evidence", async () => {
  const stub = transport((_c, turn) => ({ summary: `Distinct bounded inspection ${turn}`, calls: [{ id: `read-${turn}`, name: turn % 2 ? "inspect_spec" : "inspect_signal_contract", arguments: {} }] }));
  const h = await createHarness({ provider: stub.provider, paidAuthorized: true });
  await h.runtime.start(false); await h.runtime.runAgent();
  assert.equal(stub.generations, 5, JSON.stringify(h.ledger.events.filter(e => e.type === "campaign.state").at(-1)?.data)); assert.equal(h.runtime.status, "paused"); assert.equal(h.ledger.state.budget.campaignUsd, 5);
  assert(h.ledger.events.some(e => e.type === "budget.hard_stop"));
  assert(h.ledger.events.some(e => e.type === "plc.output")); assert.throws(() => h.runtime.resume(), /cannot resume/); await h.runtime.stop();
});

test("W1: durable session charges span campaigns, lock concurrency, and retain crash reservations", () => {
  const dir = mkdtempSync(join(tmpdir(), "wonder-session-")), path = join(dir, "session.jsonl");
  try {
    const account = new DurableSessionAccount(path, "first");
    assert.throws(() => new DurableSessionAccount(path, "concurrent"), /EEXIST/);
    const budget = new CampaignBudget(new CampaignLedger("account"), new ModelBudgetGuard({ ...acceptedBudgetLimits }), 5, account);
    budget.reserve(1, "planning", 0); // Crash before settlement remains charged in the durable account.
    assert.equal(account.spentUsd, 1); account.close();
    const next = new DurableSessionAccount(path, "next"); assert.equal(next.spentUsd, 1);
    for (let i = 0; i < 14; i++) next.charge(`r-${i}`);
    assert.throws(() => next.charge("sixteenth"), /hard stop/); next.close();
    assert.equal(readFileSync(path, "utf8").trim().split("\n").length, 15);
    writeFileSync(path, "{partial"); assert.throws(() => new DurableSessionAccount(path, "crash"), /Incomplete/);
    assert(existsSync(path + ".lock"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("W1: unsupported claims, hidden truth and opaque endpoints cannot enter model authority", async () => {
  const h = await createHarness({ diagnosisMode: "blind" }); await h.runtime.start(false);
  const hidden = h.ledger.append("fault.truth", { commitment: "hidden", truth: { secret: "BLIND_SENTINEL" }, salt: "hidden" }, "truth");
  await h.runtime.applyDecision({ summary: "Inspect only observations", plan: { objective: "Blind", experiments: [initialExperiment] }, calls: [{ id: "visible", name: "inspect_recent_evidence", arguments: { limit: 10 } }] }, h.ledger.state.revision);
  const context = h.runtime.agentContext(); assert(!JSON.stringify(context).includes("BLIND_SENTINEL"));
  const inspect = await h.runtime.executeTool({ id: "hidden-window", name: "inspect_evidence_window", arguments: { ids: [hidden.id], afterSequence: 0, throughSequence: 1000, limit: 1 } });
  assert.equal(inspect.status, "rejected");
  const output = context.evidence.find(e => e.type === "plc.output")!;
  const filteredResult = contextResults([{ actionId: "adapter-result", status: "applied", message: "BLIND_SENTINEL", evidenceRefs: [hidden.id, output.id], value: { truth: "BLIND_SENTINEL" } }], h.ledger, true);
  assert(!JSON.stringify(filteredResult).includes("BLIND_SENTINEL")); assert.deepEqual(filteredResult[0].evidenceRefs, [output.id]);
  const finding = await h.runtime.executeTool({ id: "unsupported", name: "record_finding", arguments: { id: "wrong", experimentId: "baseline", title: "Invented output", claims: [{ evidenceId: output.id, signal: "Motor_RunCmd", equals: true }], injectedTruthRefs: [], inference: "Claim", assumptions: [], uncertainty: "None" } });
  assert.equal(finding.status, "rejected"); assert.equal(Object.keys(h.ledger.state.findings).length, 0);
  h.runtime.options.signals = [{ id: "PE", endpoint: "opc.tcp://opaque" }]; assert.throws(() => h.runtime.agentContext(), /logical capabilities/);
  await h.runtime.stop();
});

test("W1: explicit hold/continue/condition-deadline lease contracts, revision checks and expiry", async () => {
  for (const policy of [{ mode: "hold", timeoutMs: 300 }, { mode: "continue", timeoutMs: 300 },
    { mode: "condition_deadline", timeoutMs: 300, condition: { signal: "Motor_RunCmd", equals: true } }] as DecisionLease[]) {
    const stub = transport((_c, turn) => turn === 1 ? { ...idle, reasoningLease: policy } : idle);
    const h = await createHarness({ provider: stub.provider, paidAuthorized: true }); h.runtime.options.maxTurns = 2;
    const policies: DecisionLease[] = []; let tickAtBegin = 0;
    const driver = h.driver as typeof h.driver & { decisionLeases: any };
    driver.decisionLeases = {
      async begin(p: DecisionLease, revision: number): Promise<DecisionLeaseReceipt> { policies.push(p); tickAtBegin = h.clock.now(); return { id: `lease-${policies.length}`, basedOnRevision: revision, valid: true, reason: "offline process boundary", evidenceRefs: [] }; },
      async finish(r: DecisionLeaseReceipt) { assert(h.clock.now() >= tickAtBegin); return r; }
    };
    await driveHarness(h); assert.equal(policies[0].mode, "hold"); assert.deepEqual(policies[1], policy); await h.runtime.stop();
  }
  const stub = transport(() => ({ ...idle, calls: [{ id: "never", name: "inspect_spec", arguments: {} }] })), h = await createHarness({ provider: stub.provider, paidAuthorized: true });
  (h.driver as any).decisionLeases = { async begin(_p: DecisionLease, revision: number) { return { id: "expiring", basedOnRevision: revision, valid: true, reason: "begin", evidenceRefs: [] }; },
    async finish(r: DecisionLeaseReceipt) { return { ...r, valid: false, reason: "Child-enforced deadline/condition returned control and held" }; } };
  await h.runtime.start(false); await h.runtime.runAgent(); assert.equal(h.runtime.status, "paused"); assert(!h.ledger.state.actions.never); await h.runtime.stop();
});

test("W2: import all recorded M10 acknowledgements, exact lineage, compact context, report and no physical effects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wonder-recorded-"));
  try {
    const ledger = new CampaignLedger("recorded-review", { file: join(dir, "events.jsonl") });
    const { runtime, source, mappings } = recordedM10Runtime({ ledger });
    const context = runtime.agentContext(); assert.equal(context.boundary!.recorded, true);
    assert.equal(ledger.events.filter(e => e.type === "plc.output").length, 302);
    assert.equal(source.originalReport.findings.length, 6); assert.equal(source.originalReport.budget.campaignUsd, 0);
    assert(context.evidence.length < 40); assert(JSON.stringify(context).length < 80_000);
    assert(Object.values(context.evidenceWindow!.quality).every((q: any) => q.recorded && String(q.outputQuality).includes("unknown")));
    for (const original of source.events.filter(e => e.type === "plc.output")) assert.deepEqual(ledger.getEvent(mappings[original.id])!.data.values, original.data.values);
    await runtime.start(false);
    await runtime.applyDecision({ summary: "Open a recorded review", plan: { objective: "Review historical M10 output evidence", experiments: [
      { id: "recorded-baseline", category: "evidence", objective: "Inspect final recorded M8 outputs", requirements: [] }
    ] }, calls: [] }, ledger.state.revision);
    const proposed = await runtime.executeTool({ id: "proposed-only", name: "introduce_carton", arguments: { itemId: "99", requestedRoute: "A" } });
    assert.equal(proposed.status, "inconclusive"); await runtime.runAgent(); await runtime.stop();
    assert.equal(runtime.status, "completed"); assert.equal(runtime.getReport().evidenceClass, "preserved_live_plc");
    assert.equal(runtime.getReport().modelResponseRefs.length, 0, "Import provenance must not masquerade as a model response");
    assert.equal(ledger.state.budget.campaignUsd, 0); assert(ledger.state.experiments["recorded-comparison"].objective.includes("23"));
    assert(!ledger.events.some(e => e.type === "world.stimulus" || e.type === "controller.action"));
    ledger.close(); assert.deepEqual(replay(readLedger(join(dir, "events.jsonl"))), ledger.state);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
