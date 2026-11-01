import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CampaignLedger, readLedger, replay, report } from "../src/campaign/ledger.ts";
import { createHarness, driveHarness, flushMicrotasks, initialExperiment } from "../src/campaign/harness.ts";
import { FakeProvider } from "../src/campaign/provider.ts";
import { CampaignBudget, acceptedBudgetLimits } from "../src/campaign/budget.ts";
import { ModelBudgetGuard } from "../src/proof/budget-guard.ts";
import { toolSchemas, eventSchemas, outcomes, validate, validateDecision } from "../src/campaign/contracts.ts";
import type { Decision, ToolCall, ToolName } from "../src/campaign/contracts.ts";
import { appendCoordinatorEvent } from "../src/campaign/live-evidence.ts";
import { preservedM7Runtime } from "../src/campaign/m7-replay.ts";
import { fileURLToPath } from "node:url";
import { CoordinatorCampaignDriver } from "../src/campaign/driver.ts";
import { preservedConveyorBindings } from "../src/campaign/conveyor-bindings.ts";
import { WonderProvider } from "../src/campaign/wonder-provider.ts";

const noWork: Decision = { summary: "Fixture decision", calls: [] };
const inert = () => new FakeProvider(() => noWork);
async function started() {
  const h = await createHarness({ provider: inert() }); await h.runtime.start(false);
  await h.runtime.applyDecision({ summary: "Prepare fixture check", plan: { objective: "Fixture", experiments: [initialExperiment] }, calls: [] }, h.ledger.state.revision);
  return h;
}
const call = (id: string, name: ToolName, args: Record<string, unknown> = {}): ToolCall => ({ id, name, arguments: args });

test("M9-B: actual coordinator + preserved generated world + fake provider acknowledge every action", async () => {
  const h = await createHarness(); await driveHarness(h);
  assert.equal(h.runtime.status, "completed");
  assert.equal(h.ledger.state.experiments.baseline.status, "completed");
  assert(Object.values(h.ledger.state.actions).every(a => a.status === "applied"));
  const source = h.ledger.events.find(e => e.type === "coordinator.event" && (e.data.source as any).data.action === "commit.acknowledged")!;
  assert(!("receipt" in (source.data.source as any).data));
  assert((source.data.source as any).data.outputs);
  const action = h.ledger.state.actions["carton-1"];
  assert(action.evidenceRefs.some(id => h.ledger.events.find(e => e.id === id)?.type === "plc.acknowledged"));
  assert.equal(h.ledger.state.budget.campaignUsd, 0);
  assert.equal(h.connector.closed, false, "Stop must not close a connector that might restore passthrough");
  assert.deepEqual(replay(h.ledger.events), h.ledger.state);
});

test("M9-C: provider creates a genuinely new evidence-dependent follow-up and runs it", async () => {
  const h = await createHarness({ adaptive: true }); await driveHarness(h);
  assert.equal(h.runtime.status, "completed");
  const e = h.ledger.events;
  const initialPlan = e.find(x => x.type === "plan.created")!;
  assert.equal((initialPlan.data.experiments as unknown[]).length, 1);
  const discrepancy = e.find(x => x.type === "discrepancy")!;
  const followup = e.find(x => x.type === "followup.added")!;
  assert(followup.sequence > discrepancy.sequence);
  assert.deepEqual(followup.data.evidenceRefs, [discrepancy.id]);
  assert.match(h.ledger.state.experiments["persistence-probe"].objective, /StackLight_Green=false/);
  assert.equal(h.ledger.state.experiments["persistence-probe"].status, "completed");
  assert.equal(h.ledger.state.actions["await-green"].status, "timed_out");
});

test("agent is asynchronous: pending model decision never clocks raw I/O", async () => {
  let resolve!: (value: Decision) => void;
  const provider = new FakeProvider(() => new Promise<Decision>(r => { resolve = r; }));
  const h = await createHarness({ provider }); await h.runtime.start(false);
  const agent = h.runtime.runAgent(); await flushMicrotasks();
  const startTick = h.coordinator.context.time.tick;
  for (let i = 0; i < 10; i++) { h.clock.advance(100); await h.driver.tick(); }
  assert.equal(h.coordinator.context.time.tick - startTick, 10);
  assert.equal(provider.contexts.length, 1);
  await h.runtime.pause(); resolve(noWork); await agent; await h.runtime.stop();
});

test("automatic 10 Hz schedule remains independent of model latency", async () => {
  const h = await createHarness({ provider: new FakeProvider(() => new Promise(() => {})) });
  await h.runtime.start(true); const agent = h.runtime.runAgent(); await flushMicrotasks();
  for (let i = 0; i < 10; i++) { h.clock.advance(100); await flushMicrotasks(); }
  assert.equal(h.coordinator.context.time.tick, 10);
  await h.runtime.pause(); await agent; await h.runtime.stop();
});

test("elapsed live stepping follows wall time, excludes Pause, and holds before an excessive sensor-observation gap", async () => {
  const h = await createHarness({ provider: inert() });
  const driver = new CoordinatorCampaignDriver(h.coordinator, h.ledger, preservedConveyorBindings, { clock: h.clock, elapsedStep: true, maximumStepMs: 300 });
  await driver.initialize(); driver.start(false);
  h.clock.advance(180); await driver.tick(); assert.equal(h.coordinator.context.time.nowMs, 180);
  await driver.hold(); h.clock.advance(2000); driver.start(false);
  h.clock.advance(120); await driver.tick(); assert.equal(h.coordinator.context.time.nowMs, 300);
  const image = driver.lastImage, sequence = h.connector.sequence;
  h.clock.advance(301); await driver.tick(); assert(driver.quarantined);
  assert.equal(h.coordinator.context.time.nowMs, 300); assert.deepEqual(driver.lastImage, image); assert.equal(h.connector.sequence, sequence);
  assert.match(driver.failure!.message, /observation bound/);
});

test("M9-D: Pause freezes time and image; resume; Stop finalizes and holds; Reset zeros; Exit is separate", async () => {
  const h = await started();
  const action = h.runtime.executeTool(call("ready-off", "set_downstream_readiness", { destination: "A", ready: false }));
  await flushMicrotasks(); h.clock.advance(100); await h.driver.tick(); assert.equal((await action).status, "applied");
  await h.runtime.pause();
  const image = h.connector.image, tick = h.coordinator.context.time.tick;
  h.clock.advance(100); await h.driver.tick();
  assert.deepEqual(h.connector.image, image); assert.equal(h.coordinator.context.time.tick, tick);
  assert.equal(h.connector.simulation, true);
  h.runtime.resume(); h.clock.advance(100); await h.driver.tick(); assert.equal(h.coordinator.context.time.tick, tick + 1);
  await h.runtime.stop(); assert(h.ledger.state.report); const stopped = h.connector.image;
  h.clock.advance(500); assert.deepEqual(h.connector.image, stopped);
  await h.runtime.resetSimulation(); assert(Object.values(h.connector.image).every(v => v === false || v === 0 || v === ""));
  assert.equal(h.connector.simulation, true); assert.equal(h.connector.closed, false);
  await h.runtime.exitSimulation({ async exit() { h.connector.simulation = false; return h.connector.observe(); } });
  assert.equal(h.ledger.state.connector?.state, "passthrough");
});

test("stale connector rejects new application, cancels waits, holds last confirmed image", async () => {
  const h = await started(); const before = h.driver.lastImage;
  const waiting = h.runtime.executeTool(call("wait-stale", "wait_for_condition", { signal: "Motor_RunCmd", equals: true, timeoutMs: 1000 }));
  await flushMicrotasks(); h.connector.stale = true; h.clock.advance(100); await h.driver.tick();
  assert.equal((await waiting).status, "stale");
  assert.equal(h.runtime.status, "paused"); assert.deepEqual(h.driver.lastImage, before);
  const rejected = await h.runtime.executeTool(call("late-carton", "introduce_carton", { itemId: "late", requestedRoute: null }));
  assert.equal(rejected.status, "stale"); await h.runtime.stop();
});

test("hung connector is bounded, quarantined and never retried", async () => {
  const h = await started(); const before = h.driver.lastImage;
  h.connector.hang = true; const ticking = h.driver.tick(); await flushMicrotasks();
  h.clock.advance(501); await ticking;
  assert(h.driver.quarantined); assert.equal(h.runtime.status, "paused");
  assert.deepEqual(h.driver.lastImage, before); const seq = h.connector.sequence;
  await h.driver.tick(); assert.equal(h.connector.sequence, seq);
  await assert.rejects(h.runtime.resetSimulation(), /quarantined/); await h.runtime.stop();
});

test("model timeout settles reservation once, stops reasoning, and preserves world", async () => {
  const provider = { id: "hanging-fixture", paid: false, estimatedRequestUsd: 1, decide: async () => new Promise<any>(() => {}) };
  const h = await createHarness({ provider }); await h.runtime.start(false);
  h.runtime.budget.guard.limits.requestTimeoutMs = 500;
  const agent = h.runtime.runAgent(); await flushMicrotasks(); const before = h.driver.lastImage;
  h.clock.advance(500); await agent;
  assert.equal(h.runtime.status, "paused"); assert.equal(h.ledger.state.budget.campaignUsd, 1);
  assert.equal(h.runtime.budget.guard.leases.size, 1); assert.equal(h.runtime.budget.guard.leases.get("request-1")?.status, "timed_out");
  assert.deepEqual(h.driver.lastImage, before); await h.runtime.stop();
});

test("hard budget at $5 prevents a sixth call, warns at $3, holds state", async () => {
  let calls = 0;
  const provider = { id: "cost-fixture", paid: false, estimatedRequestUsd: 1,
    async decide() { calls++; return { costUsd: 1, decision: { summary: "Bounded inspection", calls: [call(`inspect-${calls}`, "inspect_recent_evidence", { limit: calls })] } }; } };
  const h = await createHarness({ provider }); await h.runtime.start(false); const before = h.driver.lastImage;
  await h.runtime.runAgent(); assert.equal(calls, 5); assert.equal(h.runtime.status, "paused");
  assert.equal(h.ledger.state.budget.campaignUsd, 5); assert.deepEqual(h.driver.lastImage, before);
  assert(h.ledger.events.some(e => e.type === "budget.warning")); assert(h.ledger.events.some(e => e.type === "budget.hard_stop"));
  assert.throws(() => h.runtime.resume(), /blocked/); await h.runtime.stop();
});

test("budget admission checks per request, check, repair, session; charged overrun is visible", () => {
  const ledger = new CampaignLedger("budget-test");
  const budget = new CampaignBudget(ledger, new ModelBudgetGuard({ ...acceptedBudgetLimits }), 2);
  assert.throws(() => budget.reserve(1.01, "check", 0), /per-request/);
  for (let i = 0; i < 2; i++) { const lease = budget.reserve(1, "check", i, "repair"); budget.settle(lease, "check", 1, "conservative_reservation"); }
  assert.throws(() => budget.reserve(0.1, "check", 2), /Check budget/);
  assert.throws(() => budget.reserve(0.1, "another", 2, "repair"), /Repair-episode/);
  budget.guard.sessionSpentUsd = 14.9;
  assert.throws(() => budget.reserve(1, "another", 3), /Session hard/);
  budget.guard.sessionSpentUsd = 2;
  const lease = budget.reserve(1, "overrun", 4);
  assert.throws(() => budget.settle(lease, "overrun", 1.5, "provider_reported"), /Cost boundary/);
  assert.equal(ledger.state.budget.campaignUsd, 3.5);
  assert.equal(ledger.state.budget.repairs.repair, 2);
});

test("Stop during a hung request settles costs and finalizes without hanging or applying late output", async () => {
  let release!: (value: any) => void;
  const provider = { id: "slow-fixture", paid: false, estimatedRequestUsd: 1, decide: () => new Promise<any>(r => { release = r; }) };
  const h = await createHarness({ provider }); await h.runtime.start(false);
  const agent = h.runtime.runAgent(); await flushMicrotasks(); await h.runtime.stop(); await agent;
  const sequence = h.ledger.state.sequence;
  release({ decision: { summary: "late", calls: [call("late", "introduce_carton", { itemId: "late", requestedRoute: null })] } });
  await flushMicrotasks(); assert.equal(h.ledger.state.sequence, sequence); assert(h.ledger.state.report); assert.equal(h.ledger.state.budget.campaignUsd, 1);
});

test("Stop drains bounded initialization before finalizing and never starts the campaign afterward", async () => {
  const h = await createHarness(); let release!: () => void;
  h.connector.open = async () => { await new Promise<void>(r => { release = r; }); return h.connector.observe(); };
  const starting = h.runtime.start(false); await flushMicrotasks();
  const stopping = h.runtime.stop("Stop while preparing"); await flushMicrotasks();
  release(); await starting; await stopping;
  assert.equal(h.runtime.status, "stopped"); assert.equal(h.driver.running, false); assert(h.ledger.state.report);
  assert(!h.ledger.events.some(e => e.type === "campaign.state" && e.data.state === "running"));
});

test("every bounded tool validates its envelope; unsupported capabilities are explicit", async () => {
  const h = await started();
  const inputs: Record<ToolName, Record<string, unknown>> = {
    inspect_spec: {}, inspect_signal_contract: {}, inspect_recent_evidence: { limit: 3 },
    introduce_carton: { itemId: "test", requestedRoute: null }, assign_route: { itemId: "test", route: "A" },
    operator_action: { action: "start" }, acknowledge_completion: { sequence: 0 },
    set_downstream_readiness: { destination: "B", ready: false }, inject_fault: { controlId: "fault.setOverload", parameters: { active: true } },
    clear_fault: { controlId: "fault.clearAll", parameters: {} }, wait_for_condition: { signal: "Motor_RunCmd", equals: true, timeoutMs: 100 },
    observe_for_duration: { durationMs: 100 }, branch_or_reset_world: { mode: "branch", label: "branch" },
    request_hmi_action: { action: "Start" }, capture_hmi_evidence: { kind: "frame", durationMs: 100 },
    create_followup_experiment: { experiment: { ...initialExperiment, id: "other", objective: "Another hypothesis" }, evidenceRefs: ["placeholder"], rationale: "Evidence" },
    record_finding: { id: "f", title: "t", experimentId: "baseline", claims: [{ evidenceId: "placeholder", signal: "Motor_RunCmd", equals: false }], injectedTruthRefs: [], inference: "Unverified", assumptions: [], uncertainty: "Unknown" },
    finish_campaign: { summary: "done" }
  };
  assert.deepEqual(Object.keys(inputs).sort(), Object.keys(toolSchemas).sort());
  for (const [name, args] of Object.entries(inputs)) {
    validate(toolSchemas[name as ToolName], args);
    const result = await h.runtime.executeTool(call(`bad-${name}`, name as ToolName, { ...args, forbidden: true }));
    assert.equal(result.status, "rejected", name);
  }
  assert.equal((await h.runtime.executeTool(call("route", "assign_route", inputs.assign_route))).status, "rejected");
  assert.equal((await h.runtime.executeTool(call("hmi", "capture_hmi_evidence", inputs.capture_hmi_evidence))).status, "inconclusive");
  assert.equal((await h.runtime.executeTool(call("early-finish", "finish_campaign", inputs.finish_campaign))).status, "rejected");
  await h.runtime.stop();
});

test("requested, applied, rejected, timed_out, stale, inconclusive action contract and pairing", () => {
  assert.deepEqual(outcomes, ["requested", "applied", "rejected", "timed_out", "stale", "inconclusive"]);
  const ledger = new CampaignLedger("outcomes");
  for (const status of outcomes.slice(1)) {
    ledger.append("action.requested", { actionId: status, name: "inspect_spec", arguments: {}, basedOnRevision: 0, experimentId: "campaign" });
    ledger.append(`action.${status}` as "action.applied", { actionId: status, status, message: "contract fixture", evidenceRefs: [] });
    assert.throws(() => ledger.append(`action.${status}` as "action.applied", { actionId: status, status, message: "duplicate", evidenceRefs: [] }), /Unpaired/);
  }
  assert.deepEqual(replay(ledger.events), ledger.state);
});

test("every event schema rejects missing fields and unknown event data", () => {
  // Valid payload examples are UI contract fixtures; negative cases prevent loose event envelopes.
  const samples = JSON.parse(readFileSync(new URL("./fixtures/campaign-contract-examples.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(samples).sort(), Object.keys(eventSchemas).sort());
  for (const [type, schema] of Object.entries(eventSchemas)) {
    validate(schema, samples[type]);
    for (const required of schema.required!) {
      const invalid = structuredClone(samples[type]); delete invalid[required];
      assert.throws(() => validate(schema, invalid), /required/, `${type}.${required}`);
    }
    assert.throws(() => validate(schema, { ...samples[type], extra: true }), /unknown property/, type);
  }
  assert.throws(() => validateDecision({ summary: "bad", calls: [call("bad", "observe_for_duration", { durationMs: 300001 })] }), /bounds/);
  assert.throws(() => validateDecision({ summary: "bad", calls: [call("bad", "observe_for_duration", { durationMs: NaN })] }));
});

test("append-only persisted ledger: golden replay, tampering/gaps/truncation rejected, returned copies isolated", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m9-"));
  try {
    const file = join(dir, "events.jsonl"), h = await createHarness({ file }); await driveHarness(h); h.ledger.close();
    assert.deepEqual(replay(readLedger(file)), h.ledger.state);
    assert.throws(() => new CampaignLedger("m9-fixture", { file }), /EEXIST/);
    const copy = h.ledger.events; copy[0].data.state = "failed"; assert.equal(h.ledger.events[0].data.state, "preparing");
    assert.throws(() => replay(copy), /hash chain/);
    assert.throws(() => replay(h.ledger.events.slice(1)), /hash chain/);
    writeFileSync(join(dir, "partial.jsonl"), readFileSync(file, "utf8").trimEnd());
    assert.throws(() => readLedger(join(dir, "partial.jsonl")), /Incomplete/);
    const golden = readLedger(fileURLToPath(new URL("./fixtures/campaign-golden.jsonl", import.meta.url)));
    const expected = JSON.parse(readFileSync(new URL("./fixtures/campaign-golden-projection.json", import.meta.url), "utf8"));
    assert.deepEqual(replay(golden), expected);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("blind context excludes injector truth, source controls, raw-effect causes, and prior author history", async () => {
  const h = await createHarness({ diagnosisMode: "blind", provider: inert() }); await h.runtime.start(false);
  const injection = h.runtime.injectHiddenFault(call("secret", "inject_fault", { controlId: "fault.setSensorStuck", parameters: { signalId: "PE_Entry", active: true, value: true } }));
  await flushMicrotasks(); h.clock.advance(100); await h.driver.tick(); await injection;
  const context = JSON.stringify(h.runtime.agentContext());
  assert(!context.includes("fault.truth")); assert(!context.includes("secret")); assert(!context.includes("sensorStuck"));
  const recent = await h.runtime.executeTool(call("recent", "inspect_recent_evidence", { limit: 100 }));
  assert(!JSON.stringify(recent).includes("fault.setSensorStuck"));
  assert(h.ledger.events.some(e => e.type === "fault.truth"));
  assert.equal((await h.runtime.executeTool(call("blind-inject", "inject_fault", { controlId: "fault.setOverload", parameters: { active: true } }))).status, "rejected");
  await h.runtime.stop();
});

test("finding evidence is exact PLC observation, never simulator truth or invented IDs", async () => {
  const h = await started(); const output = h.ledger.events.find(e => e.type === "plc.output")!;
  const finding = { id: "finding", title: "Claim", experimentId: "baseline", claims: [{ evidenceId: output.id, signal: "Motor_RunCmd", equals: true }], injectedTruthRefs: [], inference: "Hypothesis", assumptions: [], uncertainty: "Unknown cause" };
  assert.equal((await h.runtime.executeTool(call("false-claim", "record_finding", finding))).status, "rejected");
  finding.claims[0].equals = false;
  assert.equal((await h.runtime.executeTool(call("valid-claim", "record_finding", finding))).status, "applied");
  h.runtime.reviewFinding("finding", "accepted", "Reviewed exact observation");
  h.runtime.reviewFinding("finding", "rerun_requested", "Confirm with demo DUT");
  assert.equal(h.ledger.state.findings.finding.review, "rerun_requested"); await h.runtime.stop();
});

test("M9-E: same ledger and runtime consume all 88 preserved flattened M7 acknowledgements", async () => {
  const ledger = new CampaignLedger("m7-import");
  const runtime = preservedM7Runtime(ledger);
  await runtime.start(false); await runtime.runAgent(); await runtime.stop();
  assert.equal(runtime.status, "completed");
  assert.equal(ledger.events.filter(e => e.type === "plc.acknowledged").length, 88);
  assert.equal(ledger.events.filter(e => e.type === "coordinator.event").length, 181);
  assert.equal(ledger.state.outputs.Motor_RunCmd, false);
  assert.equal(report(ledger.events).coverage.includes("no final conveyor-controller"), true);
  assert.equal(runtime.getReport().evidenceClass, "preserved_live_plc");
});

test("flattened event adapter rejects a nested receipt and forged derived output", async () => {
  const h = await started();
  const source = h.coordinator.events.find(e => e.data.action === "commit.acknowledged")!;
  const ledger = new CampaignLedger("adapter-test");
  assert.throws(() => appendCoordinatorEvent(ledger, { ...source, data: { action: "commit.acknowledged", receipt: source.data } }), /required/);
  assert.equal(ledger.events.length, 0);
  const refs = appendCoordinatorEvent(ledger, source);
  assert.throws(() => ledger.append("plc.output", { sourceId: refs[0], values: { Motor_RunCmd: true }, plcCycle: source.data.plcCycle, outputCaptureCycle: source.data.outputCaptureCycle }), /differs from source/);
  await h.runtime.stop();
});

test("valid tools: inspect, known fault/clear, branch, HMI references, wait, reset", async () => {
  const h = await started();
  for (const name of ["inspect_spec", "inspect_signal_contract"] as const) assert.equal((await h.runtime.executeTool(call(name, name))).status, "applied");
  for (const [id, name, args] of [
    ["inject", "inject_fault", { controlId: "fault.setOverload", parameters: { active: true } }],
    ["clear", "clear_fault", { controlId: "fault.clearAll", parameters: {} }]
  ] as const) {
    const work = h.runtime.executeTool(call(id, name, args)); await flushMicrotasks(); h.clock.advance(100); await h.driver.tick();
    const result = await work; assert.equal(result.status, "applied");
    if (name === "inject_fault") assert((result.value as any).injectedTruthRef);
  }
  assert.equal((await h.runtime.executeTool(call("branch", "branch_or_reset_world", { mode: "branch", label: "inspectable-checkpoint" }))).status, "applied");
  h.runtime.options.hmi = { async perform(action) { return { reference: `fixture://hmi/${action.id}`, atIso: h.clock.iso() }; } };
  assert.equal((await h.runtime.executeTool(call("hmi-action", "request_hmi_action", { action: "Start" }))).status, "applied");
  assert.equal((await h.runtime.executeTool(call("hmi-clip", "capture_hmi_evidence", { kind: "clip", durationMs: 100 }))).status, "applied");
  const wait = h.runtime.executeTool(call("condition", "wait_for_condition", { signal: "Motor_RunCmd", equals: false, timeoutMs: 500 }));
  await flushMicrotasks(); h.clock.advance(100); await h.driver.tick(); assert.equal((await wait).status, "applied");
  const reset = await h.runtime.executeTool(call("reset", "branch_or_reset_world", { mode: "reset", label: "zero" }));
  assert.equal(reset.status, "applied"); assert.equal(h.runtime.status, "paused"); assert(h.connector.simulation);
  assert(Object.values(h.connector.image).every(v => v === false || v === 0)); await h.runtime.stop();
});

test("operator Stop interrupts a pending world action and finalizes exactly one outcome", async () => {
  const h = await started();
  const work = h.runtime.executeTool(call("queued", "introduce_carton", { itemId: "queued", requestedRoute: null }));
  await flushMicrotasks(); await h.runtime.stop();
  assert.equal((await work).status, "inconclusive"); assert(h.ledger.state.report);
  assert.equal(h.coordinator.context.entityState.size, 0);
  assert.equal(h.ledger.events.filter(e => e.type.startsWith("action.") && e.type !== "action.requested" && e.data.actionId === "queued").length, 1);
});

test("stale decision, duplicate action, malformed/repeating provider and failed startup cannot spend/retry silently", async () => {
  const h = await started(), revision = h.ledger.state.revision;
  assert.equal((await h.runtime.executeTool(call("once", "inspect_spec"))).status, "applied");
  assert.equal((await h.runtime.executeTool(call("old-revision", "inspect_spec"), revision)).status, "stale");
  await assert.rejects(h.runtime.executeTool(call("once", "inspect_spec")), /already journaled/);
  await h.runtime.stop();
  const malformed = await createHarness({ provider: { id: "bad", paid: false, estimatedRequestUsd: 0, async decide() { return { decision: "plain text", rawResponse: { output: "plain text" } }; } } });
  await malformed.runtime.start(false); await malformed.runtime.runAgent(); assert.equal(malformed.runtime.status, "paused");
  assert(malformed.ledger.events.some(e => e.type === "agent.response")); assert.equal(malformed.runtime.budget.guard.leases.size, 1); await malformed.runtime.stop();
  const repeating = await createHarness({ provider: inert() }); await repeating.runtime.start(false); await repeating.runtime.runAgent();
  assert.equal(repeating.runtime.budget.guard.leases.size, 3); assert.equal(repeating.runtime.status, "paused"); await repeating.runtime.stop();
  const failed = await createHarness(); failed.connector.stale = true; await failed.runtime.start(false);
  assert.equal(failed.runtime.status, "failed"); assert(failed.ledger.state.report);
});

test("Wonder is opt-in, single-call and bounded; stub transport only", async () => {
  assert.throws(() => new WonderProvider({ apiKey: "fixture-only", explicitlyAuthorized: false }), /authorization/);
  let count = 0;
  const h = await createHarness();
  const provider = new WonderProvider({ apiKey: "fixture-only", explicitlyAuthorized: true,
    fetch: (async (_url: any, options: any) => { count++; assert(options.signal); const body = JSON.parse(options.body); assert.equal(body.max_output_tokens, 3000);
      return new Response(JSON.stringify({ id: "stub", output_text: JSON.stringify(noWork), usage: { output_tokens: 4 } })); }) as typeof fetch });
  const reply = await provider.decide(h.runtime.agentContext(), new AbortController().signal); assert.deepEqual(reply.decision, noWork);
  await assert.rejects(provider.decide(h.runtime.agentContext(), new AbortController().signal), /exhausted/); assert.equal(count, 1);
});
