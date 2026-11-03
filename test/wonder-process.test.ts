// controlsbench.wonder-process.v1: every test runs the real isolated child process
// (scripts/wonder-process-child.js) with the injected fake M8 transport. The fixture models
// protocol acknowledgements only; no assertion uses it as an oracle for M8 conveyor behavior.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CampaignLedger, readLedger, replay } from "../src/campaign/ledger.ts";
import { CampaignRuntime } from "../src/campaign/runtime.ts";
import { FakeProvider } from "../src/campaign/provider.ts";
import type { CampaignEvent, Decision, DecisionLease } from "../src/campaign/contracts.ts";
import type { AgentContext } from "../src/campaign/provider.ts";
import { ToolFailure } from "../src/campaign/driver.ts";
import { createCampaignFactory } from "../src/host/wonder-campaign-factory.ts";
import { createWonderSession, openOfflineWonderSession } from "../src/live/wonder-process/index.ts";
import type { OfflineSessionOptions, WonderProcessSession } from "../src/live/wonder-process/index.ts";
import { commonWonderPaths } from "../src/campaign/wonder-paths.ts";

const transportModule = fileURLToPath(new URL("./fixtures/wonder-process-transport.ts", import.meta.url));
const parentScript = fileURLToPath(new URL("./fixtures/wonder-process-parent.ts", import.meta.url));
const worldFile = fileURLToPath(new URL("../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts", import.meta.url));
const hmi = { async perform(): Promise<never> { throw new Error("Offline HMI unavailable"); } };
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const busy = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) { /* deliberate parent event-loop stall */ } };
const jsonl = (path: string): any[] => existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
async function until(predicate: () => boolean | Promise<boolean>, label: string, timeoutMs = 8000): Promise<void> {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) { if (await predicate()) return; await sleep(20); }
  throw new Error(`Timed out waiting for ${label}`);
}
// Optional evidence capture for scripts/run-wonder-process-proof.js; tests never depend on it.
const evidenceDir = process.env.WONDER_PROCESS_EVIDENCE;
function measure(name: string, data: Record<string, unknown>): void {
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  appendFileSync(join(evidenceDir, "measurements.jsonl"), JSON.stringify({ test: name, ...data }) + "\n");
}
// Journals and ledger only: a sampled session's temporary lock file is not evidence.
function keepSample(name: string, dir: string): void { if (evidenceDir) cpSync(dir, join(evidenceDir, "samples", name), { recursive: true, filter: source => !source.endsWith("live.lock") }); }
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

interface Harness {
  dir: string; ledger: CampaignLedger; s: WonderProcessSession; lock: string;
  fixture(command: Record<string, unknown>): Promise<any>;
  stream(mode: string, kind?: string): Promise<unknown>;
  status(): Promise<any>;
  childStream(): any[]; lifecycle(): any[]; boundary(): any[];
  cleanup(): Promise<void>;
}
async function harness(name: string, options: Partial<OfflineSessionOptions> = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), `wonder-process-${name}-`));
  const ledger = new CampaignLedger(`wp-${name}`, { file: join(dir, "campaign.jsonl") });
  const lock = join(dir, "live.lock");
  const s = await openOfflineWonderSession({ ledger, hmi, scope: {}, artifactDirectory: dir }, { transportModule, ownershipPath: lock, ...options });
  const journal = join(dir, "wonder-process");
  return { dir, ledger, s, lock,
    fixture: command => s.process.channel.request("fixture", { transport: command }, 5000).then(r => r.value),
    stream: (mode, kind) => s.process.channel.request("fixture", { stream: mode, ...(kind ? { kind } : {}) }, 5000).then(r => r.value),
    status: () => s.process.channel.request("status", {}, 5000).then(r => r.value),
    childStream: () => jsonl(join(journal, "child-stream.jsonl")), lifecycle: () => jsonl(join(journal, "child-lifecycle.jsonl")), boundary: () => jsonl(join(journal, "parent-boundary.jsonl")),
    async cleanup() { await s.dispose(); ledger.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function runtimeFor(h: Harness, policy: (context: AgentContext, turn: number) => Decision | Promise<Decision>) {
  const provider = new FakeProvider(policy);
  const signals = [...h.s.process.loaded.worldToPlc.map(s => ({ id: s.id, direction: "world_to_plc" })), ...h.s.process.loaded.observedOutputIds.map(id => ({ id, direction: "plc_to_world" }))];
  const runtime = new CampaignRuntime({ ledger: h.ledger, provider, driver: h.s.driver, controller: h.s.controller, hmi, provenance: { ...h.s.provenance, model: provider.id },
    evidenceClass: "fake_connector", claimBoundary: "Offline isolated-process fixture; no PLC or model contact", spec: "Offline isolated-process fixture specification",
    signals, categories: ["normal", "adaptive", "faults"], requireDecisionLeases: true });
  return { runtime, provider };
}
const responses = (ledger: CampaignLedger, phase: string) => ledger.events.filter(e => e.type === "agent.response" && (e.data.response as any).phase === phase).map(e => (e.data.response as any).receipt);
const commits = (records: any[]) => records.filter(r => r.record.kind === "source" && r.record.event.data.action === "commit.acknowledged");
const latestOutput = (context: AgentContext) => context.evidence.filter(e => e.type === "plc.output").at(-1)!;
const plan = (id = "baseline"): Decision["plan"] => ({ objective: "Exercise the isolated process boundary", experiments: [{ id, objective: "Observe the fixture output at rest", category: "normal", requirements: [] }] });
const finding = (context: AgentContext, experimentId = "baseline") => {
  const output = latestOutput(context);
  return { id: `${experimentId}-observed`, name: "record_finding" as const, arguments: { id: `${experimentId}-finding`, title: "Fixture output observed through the isolated boundary", experimentId,
    claims: [{ evidenceId: output.id, signal: "Motor_RunCmd", equals: (output.data.values as Record<string, unknown>).Motor_RunCmd as boolean }],
    injectedTruthRefs: [], inference: "Boundary lineage only; fixture transport", assumptions: [], uncertainty: "No live PLC" } };
};

test("construction is read-only and reports the world bytes the child actually loaded", async () => {
  const h = await harness("construct");
  try {
    assert.equal(existsSync(h.lock), false, "no runtime ownership before Start");
    assert.equal(existsSync(join(h.dir, "wonder-process", "child-transport.jsonl")), false, "no transport created or opened before Start");
    const status = await h.status();
    assert.equal(status.initialized, undefined); assert.equal(status.ownershipHeld, false);
    const worldSha = createHash("sha256").update(readFileSync(worldFile)).digest("hex");
    assert(h.s.provenance.worldModule.startsWith(`sha256:${worldSha};`)); assert.equal(h.s.process.loaded.worldSha256, worldSha);
    assert.notEqual(h.s.process.identity.pid, process.pid);
    assert.equal(h.s.contract, "controlsbench.wonder-process.v1"); assert.equal(h.s.ledger, h.ledger);
    assert(h.s.driver.observedOutputIds!.includes("Motor_RunCmd") && h.s.driver.observedOutputIds!.includes("controller.CompletionSequence"));
    assert.match(h.s.handoff.evidenceRef, /offline fixture only/); assert.equal(h.ledger.events.length, 0);
    await h.s.driver.initialize();
    const lock = JSON.parse(readFileSync(h.lock, "utf8"));
    assert.equal(lock.owner, "wonder-process-v1"); assert.equal(lock.childPid, h.s.process.identity.pid); assert.equal(lock.campaignId, h.ledger.campaignId);
    await h.s.dispose();
    assert.equal(existsSync(h.lock), false, "drained session releases its own lock");
    assert.equal(h.lifecycle().at(-1).ownership, "released");
  } finally { await h.cleanup(); }
  await assert.rejects(openOfflineWonderSession({ ledger: new CampaignLedger("shared-lock"), hmi, scope: {} }, { transportModule, ownershipPath: commonWonderPaths().ownership }), /must not take the shared/);
  for (const file of ["scripts/wonder-process-child.js", "src/live/wonder-process/engine.ts", "src/live/wonder-process/write-gate.ts", "src/live/wonder-process/ownership.ts", "src/live/wonder-process/protocol.ts"]) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const specifiers = [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(m => m[1]);
    assert(specifiers.length && !specifiers.some(s => /campaign\/(ledger|runtime|driver|m10-rehearsal|harness)\.ts$|hmi-h2/.test(s)), `${file} must not import a campaign ledger/runtime or the H2 plan: ${specifiers.join(", ")}`);
  }
  const saved = process.env.CONTROLSBENCH_WONDER_PROCESS_COMMIT;
  delete process.env.CONTROLSBENCH_WONDER_PROCESS_COMMIT;
  try { await assert.rejects(createWonderSession({ ledger: new CampaignLedger("live-unready"), hmi, scope: {} }), /not ready/); }
  finally { if (saved !== undefined) process.env.CONTROLSBENCH_WONDER_PROCESS_COMMIT = saved; }
});

test("provider campaign through the Wonder factory: host ledger, original IDs/revisions and exact source lineage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wonder-process-factory-"));
  const ledger = new CampaignLedger("wp-factory", { file: join(dir, "campaign.jsonl") });
  let session: WonderProcessSession | undefined;
  const provider = new FakeProvider((context, turn) => {
    if (turn === 1) return { summary: "Plan a baseline; start the controller and introduce one carton", plan: plan(), reasoningLease: { mode: "continue", timeoutMs: 5000 }, calls: [
      { id: "op-start", name: "operator_action", arguments: { action: "start" } },
      { id: "carton-1", name: "introduce_carton", arguments: { itemId: "W4-1", requestedRoute: null } },
      { id: "observe-1", name: "observe_for_duration", arguments: { durationMs: 400 } }] };
    return { summary: "Record the observed output and finish", completeExperiment: { id: "baseline", evidenceRefs: [latestOutput(context).id], conclusion: "observed" },
      calls: [finding(context), { id: "finish", name: "finish_campaign", arguments: { summary: "Isolated boundary campaign complete" } }] };
  });
  try {
    const factory = createCampaignFactory({ provider: () => provider, openSession: async context => (session = await openOfflineWonderSession(context, { transportModule, ownershipPath: join(dir, "live.lock") })) });
    const hosted = await factory.create({ ledger, hmi, scope: { normal: true, adaptive: true }, artifactDirectory: dir });
    assert.equal(hosted.runtime.ledger, ledger); assert.equal(hosted.runtime.options.hmi, hmi); assert.equal(hosted.run, undefined);
    await hosted.runtime.start(true); await hosted.runtime.runAgent(); await hosted.runtime.stop();
    assert.equal(hosted.runtime.status, "completed", JSON.stringify(ledger.state.report));
    const events = ledger.events;
    // Original identities and revisions travel unchanged to the child.
    for (const id of ["op-start", "carton-1"]) {
      const requested = events.find(e => e.type === "action.requested" && e.data.actionId === id)!;
      const sent = jsonl(join(dir, "wonder-process", "parent-boundary.jsonl")).find(j => j.kind === "request" && j.actionId === id)!;
      assert.equal(sent.campaignRevision, requested.data.basedOnRevision, `${id} keeps its originating revision`);
      assert(Number.isInteger(sent.boundaryRevision));
      assert.equal(events.find(e => e.type === "action.applied" && e.data.actionId === id)?.data.status, "applied");
    }
    const stimulus = jsonl(join(dir, "wonder-process", "child-stream.jsonl")).find(r => r.record.kind === "stimulus")!;
    assert.equal(stimulus.record.actionId, "carton-1");
    assert.equal(events.find(e => e.type === "world.stimulus")!.data.actionId, "carton-1");
    const controller = events.find(e => e.type === "controller.action")!;
    assert.equal(controller.data.actionId, "op-start"); assert.equal((controller.data.observation as any).values["controller.StartAck"], 1);
    // Every original child record reached the one host ledger exactly once, in order.
    const childSources = jsonl(join(dir, "wonder-process", "child-stream.jsonl")).filter(r => r.record.kind === "source");
    const ledgerSources = events.filter(e => e.type === "coordinator.event");
    assert.equal(ledgerSources.length, childSources.length);
    childSources.forEach((r, i) => { assert.deepEqual(ledgerSources[i].data.source, r.record.event); assert.equal(ledgerSources[i].data.origin, r.record.origin); });
    for (const output of events.filter(e => e.type === "plc.output")) {
      const source = events.find(e => e.id === output.data.sourceId)!;
      assert.equal(source.type, "coordinator.event"); assert.deepEqual(output.data.values, (source.data.source as any).data.outputs);
      assert(Object.values((source.data.source as any).data.outputQuality).every(q => q === "good"));
    }
    assert(childSources.filter(r => r.record.origin === "live-coordinator").every((r, i) => r.record.event.sequence === i + 1), "coordinator source sequence is contiguous");
    const leases = responses(ledger, "decision_lease_finished");
    assert.equal(leases.length, 2); assert(leases.every(r => r.valid && r.boundary.state === "released" && r.boundary.plcScanContinues === true));
    assert.deepEqual(leases.map(r => r.boundary.policy.mode), ["hold", "continue"]);
    ledger.close(); assert.deepEqual(replay(readLedger(join(dir, "campaign.jsonl"))).status, "completed");
    await hosted.dispose!();
    assert.equal(existsSync(join(dir, "live.lock")), false);
    assert.equal(session!.process.channel.exit?.code, 0);
    measure("factory-campaign", { coordinatorSources: childSources.length, plcOutputs: events.filter(e => e.type === "plc.output").length, ledgerEvents: events.length,
      leaseStates: leases.map(r => r.boundary.state), childExit: session!.process.channel.exit });
    keepSample("factory-campaign", dir);
  } finally { await session?.dispose(); rmSync(dir, { recursive: true, force: true }); }
});

test("slow I/O consumes its cadence period without an extra sleep, burst starts or relaxed observation bound",async()=>{
  const h=await harness('slow-io-cadence');
  try {
    await h.s.driver.initialize();
    await h.fixture({action:'delayNextWrite',ms:220,match:'GVL_BenchWrite.RequestedSequence'});
    h.s.driver.start(true);
    await until(()=>h.s.driver.quarantined||h.childStream().filter(r=>r.record.kind==='tick'&&r.record.advanced).length>=6,'six advancing ticks after delayed commit');
    await h.s.driver.hold(true);
    assert.equal(h.s.driver.quarantined,false,h.s.driver.failure?.message??'Child remained healthy');
    const ticks=h.childStream().filter(r=>r.record.kind==='tick'&&r.record.advanced);
    assert(ticks.some(r=>r.record.tickMs>=200),'The test exercised genuinely slow transport');
    assert(ticks.every(r=>r.record.stepMs<=300),'The existing 300 ms observation bound remains enforced');
    const starts=ticks.map(r=>r.atMonotonicMs-r.record.tickMs);
    assert(starts.slice(1).every((t,i)=>t-starts[i]>=90),'No catch-up burst: measured starts remain spaced by the 100 ms cadence (10 ms journal tolerance)');
    measure('slow-io-cadence',{ticks:ticks.length,maxTickMs:Math.max(...ticks.map(r=>r.record.tickMs)),maxStepMs:Math.max(...ticks.map(r=>r.record.stepMs)),minimumMeasuredStartGapMs:Math.min(...starts.slice(1).map((t,i)=>t-starts[i]))});
    keepSample('slow-io-cadence',h.dir);
  }finally{await h.cleanup();}
});

test("parent event-loop stall: the child expires a continue lease on its own clock and keeps 10 Hz", async () => {
  const h = await harness("stall");
  let stall = { start: 0, end: 0 };
  try {
    const { runtime } = runtimeFor(h, (_context, turn) => {
      if (turn === 1) return { summary: "Plan; continue the world while reasoning next", plan: plan(), reasoningLease: { mode: "continue", timeoutMs: 400 }, calls: [] };
      stall.start = Date.now(); busy(1500); stall.end = Date.now();
      return { summary: "A decision that arrives after its lease", calls: [{ id: "late-carton", name: "introduce_carton", arguments: { itemId: "LATE", requestedRoute: null } }] };
    });
    await runtime.start(true); await runtime.runAgent();
    assert.equal(runtime.status, "paused");
    assert.equal(h.ledger.events.some(e => e.type === "action.requested" && e.data.actionId === "late-carton"), false, "late decision has no effect");
    assert.equal(h.ledger.events.some(e => e.type === "world.stimulus"), false);
    const receipt = responses(h.ledger, "decision_lease_finished").at(-1);
    assert.equal(receipt.valid, false); assert.equal(receipt.boundary.state, "expired"); assert.equal(receipt.boundary.worldHeld, true);
    assert(receipt.boundary.elapsedMs >= 390 && receipt.boundary.elapsedMs < 1000, `child expired at ${receipt.boundary.elapsedMs} ms, during the 1500 ms parent stall`);
    assert(Date.parse(receipt.boundary.terminalAtIso) < stall.end - 400, "expiry happened while the parent was stalled");
    assert.match(receipt.reason, /PLC scan and timers continue/);
    const during = commits(h.childStream()).map(r => Date.parse(r.record.event.atIso)).filter(t => t >= stall.start && t <= stall.end);
    assert(during.length >= 10, `child committed ${during.length} times during the stall`);
    const gaps = during.slice(1).map((t, i) => t - during[i]);
    assert(Math.max(...gaps) <= 300, `max commit gap during the stall ${Math.max(...gaps)} ms`);
    const held = h.childStream().filter(r => r.record.kind === "tick" && r.record.held === `lease.hold:${receipt.id}`);
    assert(held.length >= 5);
    assert.equal(new Set(held.map(r => r.record.worldTimeMs)).size, 1, "world time frozen after expiry");
    const heldCommits = commits(h.childStream()).filter(r => r.record.event.data.cause === `lease.hold:${receipt.id}`);
    assert(Number(heldCommits.at(-1).record.event.data.plcCycle) > Number(heldCommits[0].record.event.data.plcCycle), "PLC scan counter continued during the hold");
    await runtime.stop();
    // The child is still re-committing held inputs while paused. Compare the
    // complete journals only after Stop has drained that in-flight IPC stream.
    assert.equal(h.ledger.events.filter(e => e.type === "coordinator.event").length, h.childStream().filter(r => r.record.kind === "source").length, "stalled-period evidence ingested in order");
    measure("parent-stall", { parentStallMs: stall.end - stall.start, leaseMode: "continue", leaseTimeoutMs: 400, childExpiredAfterMs: receipt.boundary.elapsedMs,
      commitsDuringStall: during.length, maxCommitGapDuringStallMs: Math.max(...gaps), heldSamplesAfterExpiry: held.length,
      plcCycleDuringHold: [heldCommits[0].record.event.data.plcCycle, heldCommits.at(-1).record.event.data.plcCycle], lateDecisionEffects: 0 });
    keepSample("parent-stall", h.dir);
  } finally { await h.cleanup(); }
});

test("hold lease: sampling ticks do not invalidate the turn; world time freezes while PLC scans continue", async () => {
  const h = await harness("hold");
  try {
    let reasoningRevision = -1;
    const { runtime } = runtimeFor(h, async (context, turn) => {
      if (turn === 1) { reasoningRevision = context.state.revision; await sleep(700); return { summary: "Plan under the default hold lease", plan: plan(), calls: [{ id: "carton-h", name: "introduce_carton", arguments: { itemId: "H-1", requestedRoute: null } }] }; }
      return { summary: "Finish", completeExperiment: { id: "baseline", evidenceRefs: [latestOutput(context).id], conclusion: "observed" }, calls: [finding(context), { id: "finish", name: "finish_campaign", arguments: { summary: "done" } }] };
    });
    await runtime.start(true); await runtime.runAgent(); await runtime.stop();
    assert.equal(runtime.status, "completed");
    const [first] = responses(h.ledger, "decision_lease_finished");
    assert.equal(first.valid, true); assert.equal(first.boundary.state, "released"); assert(first.boundary.elapsedMs >= 650);
    assert.equal(first.basedOnRevision, reasoningRevision);
    const holdTicks = h.childStream().filter(r => r.record.kind === "tick" && r.record.held === `lease.hold:${first.id}`);
    assert(holdTicks.length >= 5, `${holdTicks.length} held samples during reasoning`);
    assert.equal(new Set(holdTicks.map(r => r.record.worldTimeMs)).size, 1, "world time did not advance during the hold");
    const holdCommits = commits(h.childStream()).filter(r => r.record.event.data.cause === `lease.hold:${first.id}`);
    assert(Number(holdCommits.at(-1).record.event.data.plcCycle) > Number(holdCommits[0].record.event.data.plcCycle));
    const after = h.childStream().filter(r => r.record.kind === "tick" && r.record.advanced && r.seq > holdTicks.at(-1).seq);
    assert(after.length && after.at(-1).record.worldTimeMs > holdTicks[0].record.worldTimeMs, "world advanced after release");
    assert.equal(h.ledger.events.find(e => e.type === "action.applied" && e.data.actionId === "carton-h")?.data.status, "applied");
    measure("hold-lease", { reasoningMs: first.boundary.elapsedMs, heldSamples: holdTicks.length, worldTimeDuringHoldMs: holdTicks[0].record.worldTimeMs,
      plcCycleDuringHold: [holdCommits[0].record.event.data.plcCycle, holdCommits.at(-1).record.event.data.plcCycle], receiptValid: first.valid, campaignRevisionUnchanged: first.basedOnRevision === reasoningRevision });
  } finally { await h.cleanup(); }
});

test("condition/deadline lease: unmet releases on return; met holds at the matching PLC evidence", async () => {
  const h = await harness("condition");
  try {
    const condition: DecisionLease = { mode: "condition_deadline", timeoutMs: 4000, condition: { signal: "controller.Mode", equals: 1 } };
    const { runtime } = runtimeFor(h, async (_context, turn) => {
      if (turn === 1) return { summary: "Plan; wait on controller mode while reasoning", plan: plan(), reasoningLease: condition, calls: [] };
      if (turn === 2) { await sleep(300); return { summary: "Condition still unmet; keep the same lease", reasoningLease: condition, calls: [] }; }
      await h.fixture({ action: "set", signal: "controller.Mode", value: 1 }); await sleep(600);
      return { summary: "This decision was overtaken by the observed condition", calls: [{ id: "overtaken", name: "introduce_carton", arguments: { itemId: "C-1", requestedRoute: null } }] };
    });
    await runtime.start(true); await runtime.runAgent();
    assert.equal(runtime.status, "paused");
    const finished = responses(h.ledger, "decision_lease_finished");
    assert.equal(finished[1].valid, true); assert.equal(finished[1].boundary.state, "released"); assert.equal(finished[1].boundary.worldHeld, false);
    const met = finished[2];
    assert.equal(met.valid, false); assert.equal(met.boundary.state, "condition_met"); assert(met.boundary.elapsedMs < 4000);
    assert.equal(met.evidenceRefs.length, 1);
    const evidence = h.ledger.getEvent(met.evidenceRefs[0])!;
    assert.equal(evidence.type, "plc.output"); assert.equal((evidence.data.values as Record<string, unknown>)["controller.Mode"], 1);
    assert.equal(h.ledger.events.some(e => e.type === "action.requested" && e.data.actionId === "overtaken"), false);
    await runtime.stop();
    measure("condition-lease", { unmet: finished[1].boundary.state, met: met.boundary.state, metAfterMs: met.boundary.elapsedMs, evidence: evidence.type });
  } finally { await h.cleanup(); }
});

test("stale campaign/boundary revisions and duplicate action IDs are refused without replay", async () => {
  const h = await harness("stale");
  try {
    const { driver, controller } = h.s;
    await driver.initialize(); driver.start(true); await sleep(300);
    h.ledger.append("campaign.state", { state: "running", reason: "Offline revision fixture" });
    const signal = new AbortController().signal, revision = h.ledger.state.revision;
    const refs = await driver.apply({ id: "c1", name: "introduce_carton", arguments: { itemId: "S-1", requestedRoute: null } }, signal, revision);
    assert.equal(h.ledger.getEvent(refs[3])!.type, "plc.output");
    await assert.rejects(driver.apply({ id: "c1", name: "introduce_carton", arguments: { itemId: "S-1", requestedRoute: null } }, signal, revision), /Duplicate action ID c1/);
    const raw = (args: Record<string, unknown>) => h.s.process.channel.request("apply", { name: "introduce_carton", control: { id: "carton.introduce", payload: { itemId: "S-2", requestedRoute: null }, cause: args.actionId },
      visibility: "public", campaignRevision: h.ledger.state.revision, boundaryRevision: driver.boundaryRevision, ...args }, 5000);
    await assert.rejects(raw({ actionId: "c1" }), /Duplicate action ID c1 .*not replayed/, "child refuses a duplicate that bypassed the parent");
    await assert.rejects(raw({ actionId: "old-campaign", campaignRevision: revision - 1 }), /older than/);
    await assert.rejects(raw({ actionId: "old-boundary", boundaryRevision: driver.boundaryRevision - 1 }), /boundary revision/);
    await assert.rejects(driver.apply({ id: "parent-stale", name: "introduce_carton", arguments: { itemId: "S-3", requestedRoute: null } }, signal, revision - 1), /revision changed/);
    await controller.execute({ id: "op-1", name: "operator_action", arguments: { action: "start" } }, signal, h.ledger.state.revision);
    await assert.rejects(controller.execute({ id: "op-1", name: "operator_action", arguments: { action: "start" } }, signal, h.ledger.state.revision), /Duplicate action ID op-1/);
    await assert.rejects(h.s.process.channel.request("controller", { actionId: "op-1", action: "stop", parameters: {}, campaignRevision: h.ledger.state.revision, boundaryRevision: driver.boundaryRevision }, 5000), /Duplicate/);
    // A lease that expired in the child invalidates the boundary the parent last relied on.
    const lease = await driver.decisionLeases!.begin({ mode: "continue", timeoutMs: 200 }, h.ledger.state.revision, new AbortController().signal);
    const boundaryAtBegin = (lease as any).boundary.boundaryRevision;
    await sleep(450);
    await assert.rejects(raw({ actionId: "after-expiry", boundaryRevision: boundaryAtBegin }), /boundary revision|held|lease/);
    const finished = await driver.decisionLeases!.finish(lease, new AbortController().signal);
    assert.equal(finished.valid, false); assert.equal((finished as any).boundary.state, "expired");
    assert.equal(h.ledger.events.filter(e => e.type === "world.stimulus").length, 1, "only the first c1 reached the world");
    assert.equal(h.ledger.events.filter(e => e.type === "controller.action").length, 1);
  } finally { await h.cleanup(); }
});

test("cancellation: a pending control is withdrawn before any world change; a controller already in flight is reported, never undone", async () => {
  const h = await harness("cancel");
  try {
    const { driver, controller } = h.s;
    await driver.initialize(); driver.start(false); // manual cadence: a control waits for an explicit tick
    await sleep(100);
    const first = new AbortController();
    const pending = driver.apply({ id: "withdrawn", name: "introduce_carton", arguments: { itemId: "W-1", requestedRoute: null } }, first.signal, h.ledger.state.revision);
    await sleep(100); first.abort();
    await assert.rejects(pending, /cancelled/);
    await until(() => h.boundary().some(j => j.kind === "cancel.result" && j.actionId === "withdrawn"), "cancel result");
    assert.equal(h.boundary().find(j => j.kind === "cancel.result" && j.actionId === "withdrawn").state, "cancelled_before_application");
    await driver.tick();
    assert.equal(h.ledger.events.some(e => e.type === "world.stimulus"), false, "withdrawn control never reached the world");
    await h.fixture({ action: "hangNextWrite", match: "StartSequence" });
    const second = new AbortController();
    const op = controller.execute({ id: "op-cancel", name: "operator_action", arguments: { action: "start" } }, second.signal, h.ledger.state.revision);
    await until(async () => (await h.fixture({ action: "stats" })).hangActive, "controller write in flight");
    second.abort();
    await assert.rejects(op, /may have applied request/);
    await until(() => h.boundary().some(j => j.kind === "cancel.result" && j.actionId === "op-cancel"), "controller cancel result");
    assert.equal(h.boundary().find(j => j.kind === "cancel.result" && j.actionId === "op-cancel").state, "controller_in_flight_outcome_pending");
    await h.fixture({ action: "releaseHang" });
    await until(() => h.ledger.events.some(e => e.type === "controller.action" && e.data.actionId === "op-cancel"), "late acknowledgement evidence");
    assert.equal(h.childStream().find(r => r.record.kind === "controller" && r.record.actionId === "op-cancel").record.afterCancellation, true);
    assert.equal(h.ledger.events.some(e => e.type === "world.stimulus"), false);
  } finally { await h.cleanup(); }
});

test("source stream: duplicates are dropped; missing, reordered or conflicting records quarantine without ingestion", async () => {
  const dup = await harness("dup");
  try {
    await dup.s.driver.initialize(); dup.s.driver.start(true); await sleep(200);
    await dup.stream("duplicate", "tick"); await sleep(400);
    assert(dup.s.process.channel.duplicates >= 1); assert.equal(dup.s.driver.quarantined, false);
    assert(dup.boundary().some(j => j.kind === "stream.duplicate_dropped"));
  } finally { await dup.cleanup(); }
  for (const [mode, pattern] of [["drop", /gap or reorder/], ["swap", /gap or reorder|overtook/], ["conflict", /Conflicting/]] as const) {
    const h = await harness(mode);
    try {
      await h.s.driver.initialize(); h.s.driver.start(true); await sleep(200);
      await h.stream(mode, mode === "conflict" ? "tick" : "source");
      await until(() => h.s.driver.quarantined, `${mode} integrity fault`);
      assert.equal(h.s.driver.failure!.outcome, "stale"); assert.match(h.s.driver.failure!.message, pattern);
      const fault = h.lifecycle().find(j => j.kind === "fixture.stream_fault")!;
      const ingested = h.ledger.events.filter(e => e.type === "coordinator.event").length;
      const before = h.childStream().filter(r => r.record.kind === "source" && r.seq < fault.seq).length;
      assert.equal(ingested, before, `${mode}: nothing after the fault was ingested`);
      await until(async () => (await h.status()).running === false, "parent stopped the child's loop after the fault");
      await assert.rejects(h.s.driver.apply({ id: "after-fault", name: "introduce_carton", arguments: { itemId: "F", requestedRoute: null } }, new AbortController().signal), /quarantined/);
    } finally { await h.cleanup(); }
  }
});

test("child exit: the driver quarantines, the runtime holds and ownership stays held for reconciliation", async () => {
  const h = await harness("child-exit");
  try {
    const { runtime } = runtimeFor(h, () => new Promise<Decision>(() => {}));
    await runtime.start(true); void runtime.runAgent();
    await sleep(300);
    h.s.process.channel.child.kill();
    await until(() => h.s.driver.quarantined, "child-exit quarantine");
    assert.match(h.s.driver.failure!.message, /Isolated child exited/);
    await until(() => runtime.status === "paused", "runtime hold");
    assert.equal(existsSync(h.lock), true, "a killed child cannot prove drained work; its lock is retained");
    assert.equal(JSON.parse(readFileSync(h.lock, "utf8")).childPid, h.s.process.identity.pid);
    await assert.rejects(h.s.driver.apply({ id: "after-exit", name: "introduce_carton", arguments: { itemId: "X", requestedRoute: null } }, new AbortController().signal), /quarantined/);
    await runtime.stop();
  } finally { await h.cleanup(); }
});

for (const mode of ["steady", "hang"] as const) test(`parent loss (${mode}): the child freezes world time, drains, closes${mode === "hang" ? " and retains ownership for an uncertain write" : " and releases ownership"}`, async () => {
  const dir = mkdtempSync(join(tmpdir(), `wonder-process-parent-${mode}-`));
  const parent = spawn(process.execPath, [parentScript, dir, mode], { stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
  try {
    const line = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("parent not ready")), 20_000);
      let text = ""; parent.stdout.on("data", chunk => { text += chunk; if (text.includes("\n")) { clearTimeout(timer); resolve(text.split("\n")[0]); } });
      parent.on("exit", code => { clearTimeout(timer); reject(new Error(`parent exited early (${code})`)); });
    });
    const { childPid } = JSON.parse(line);
    assert(alive(childPid));
    parent.kill();
    await until(() => !alive(childPid), "child exit after parent loss", 15_000);
    const lifecycle = jsonl(join(dir, "wonder-process", "child-lifecycle.jsonl"));
    assert(lifecycle.some(j => j.kind === "parent.lost"));
    const closed = lifecycle.find(j => j.kind === "closed")!;
    measure(`parent-loss-${mode}`, { drained: closed.drained, closed: closed.closed, ownership: closed.ownership, uncertainWrites: closed.uncertainWrites.length });
    if (mode === "steady") {
      assert.equal(closed.drained, true); assert.equal(closed.closed, true); assert.equal(closed.ownership, "released");
      assert.equal(existsSync(join(dir, "live.lock")), false);
    } else {
      assert.equal(closed.drained, false); assert.equal(closed.ownership, "retained_uncertain");
      assert(closed.uncertainWrites.length >= 1, "the hanging write is reported as uncertain");
      assert.equal(existsSync(join(dir, "live.lock")), true, "uncertain write keeps runtime ownership");
    }
    const stream = jsonl(join(dir, "wonder-process", "child-stream.jsonl"));
    const lost = lifecycle.find(j => j.kind === "parent.lost")!;
    const advancedAfter = stream.filter(r => r.record.kind === "tick" && r.record.advanced && Date.parse(r.atIso) > Date.parse(lost.atIso));
    // A step already committing when the disconnect arrived may complete; no later step starts.
    assert(advancedAfter.length <= 1, `${advancedAfter.length} world steps after parent loss`);
  } finally { if (parent.exitCode === null) parent.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test("delayed write: timeout quarantines with the write uncertain, no later write, settlement recorded, then drained release", async () => {
  const h = await harness("delayed", { timing: { operationTimeoutMs: 1500 } });
  try {
    await h.s.driver.initialize(); h.s.driver.start(true); await sleep(300);
    await h.fixture({ action: "delayNextWrite", ms: 2600, match: "Valid" });
    await until(() => h.s.driver.quarantined, "write timeout quarantine", 5000);
    const atFault = await h.fixture({ action: "stats" });
    assert.equal(h.s.driver.failure!.outcome, "timed_out");
    const fault = h.childStream().find(r => r.record.kind === "fault")!.record;
    assert(fault.uncertainWrites.some((w: any) => w.paths.some((p: string) => p.includes("Valid"))), "the delayed write is reported uncertain");
    assert(h.ledger.events.some(e => e.type === "connector.state" && String(e.data.reason).includes("Uncertain writes")));
    await assert.rejects(h.s.driver.apply({ id: "after-timeout", name: "introduce_carton", arguments: { itemId: "D", requestedRoute: null } }, new AbortController().signal), /quarantined/);
    await until(() => h.childStream().some(r => r.record.kind === "write"), "late settlement record", 5000);
    await sleep(300);
    const after = await h.fixture({ action: "stats" });
    assert.equal(after.started, atFault.started, "no write started after the uncertain one");
    assert.equal(after.settled, atFault.settled + 1, "only the delayed write itself settled");
    assert(h.ledger.events.some(e => e.type === "connector.state" && String(e.data.reason).includes("settled (completed)")));
    await h.s.dispose();
    const closed = h.lifecycle().find(j => j.kind === "closed")!;
    assert.equal(closed.drained, true); assert.equal(closed.ownership, "released");
    const settledRecord = h.childStream().find(r => r.record.kind === "write")!.record;
    measure("delayed-write", { operationTimeoutMs: 1500, writeDelayMs: 2600, faultOutcome: fault.outcome, uncertainPaths: fault.uncertainWrites.flatMap((w: any) => w.paths),
      settledAfterMs: settledRecord.heldMs, writesStartedAfterFault: after.started - atFault.started, drained: closed.drained, ownership: closed.ownership });
  } finally { await h.cleanup(); }
});

test("stop drains and closes; reset commits a zero image with simulation held; exit selects observed passthrough", async () => {
  const stop = await harness("stop");
  try {
    const { runtime } = runtimeFor(stop, () => new Promise<Decision>(() => {}));
    await runtime.start(true); void runtime.runAgent(); await sleep(400);
    await runtime.stop("Engineer stop");
    const settled = (await stop.fixture({ action: "stats" })).settled; await sleep(400);
    assert.equal((await stop.fixture({ action: "stats" })).settled, settled, "no commit after the drained stop");
    assert.equal((await stop.fixture({ action: "stats" })).simRequest, true, "stop is not passthrough");
    await stop.s.dispose();
    const closed = stop.lifecycle().find(j => j.kind === "closed")!;
    assert.equal(closed.drained, true); assert.equal(closed.closed, true); assert.equal(closed.ownership, "released");
  } finally { await stop.cleanup(); }
  const reset = await harness("reset");
  try {
    const { runtime } = runtimeFor(reset, () => new Promise<Decision>(() => {}));
    await runtime.start(true); void runtime.runAgent(); await sleep(300);
    await runtime.resetSimulation();
    const event = reset.ledger.events.find(e => e.type === "simulation.reset")!;
    const source = reset.ledger.getEvent(String(event.data.sourceId))!;
    assert.equal((source.data.source as any).data.cause, "campaign.reset");
    assert(Object.values(event.data.image as Record<string, unknown>).every(v => v === false || v === 0));
    const stats = await reset.fixture({ action: "stats" });
    assert.equal(stats.simRequest, true); assert.equal(stats.simApplied, true, "reset keeps simulation selected");
    await runtime.runAgent();
    assert.throws(() => runtime.resume(), (e: unknown) => e instanceof ToolFailure && /new campaign/.test(e.message));
    await runtime.stop();
  } finally { await reset.cleanup(); }
  const exit = await harness("exit");
  try {
    const { runtime } = runtimeFor(exit, () => new Promise<Decision>(() => {}));
    await runtime.start(true); void runtime.runAgent(); await sleep(300);
    await runtime.exitSimulation(exit.s.simulationExit);
    assert(exit.ledger.events.some(e => e.type === "simulation.exited"));
    assert.equal(exit.ledger.events.filter(e => e.type === "connector.state").at(-1)!.data.state, "passthrough");
    const stats = await exit.fixture({ action: "stats" });
    assert.equal(stats.simRequest, false); assert.equal(stats.simApplied, false);
    assert.equal(exit.ledger.events.some(e => e.type === "simulation.reset"), false, "exit is not a reset");
  } finally { await exit.cleanup(); }
});

test("parent silence: the child holds the world on its own and the engineer resume continues it", async () => {
  const h = await harness("silence", { timing: { parentSilenceMs: 600 } });
  try {
    const faults: ToolFailure[] = [];
    await h.s.driver.initialize(); h.s.driver.onFault = f => faults.push(f); h.s.driver.start(true);
    await sleep(300);
    busy(1400);
    await until(() => faults.length > 0, "silence hold notice");
    assert.match(faults[0].message, /No parent message/); assert.equal(h.s.driver.quarantined, false);
    const hold = h.childStream().find(r => r.record.kind === "hold")!;
    const heldTicks = h.childStream().filter(r => r.record.kind === "tick" && r.record.held === "parent.silent");
    assert(heldTicks.length >= 3); assert.equal(new Set(heldTicks.map(r => r.record.worldTimeMs)).size, 1);
    assert(h.ledger.events.some(e => e.type === "agent.activity" && e.data.phase === "isolated_hold"));
    h.s.driver.start(true);
    await until(() => h.childStream().some(r => r.record.kind === "tick" && r.record.advanced && r.seq > hold.seq), "world advances after resume");
  } finally { await h.cleanup(); }
});
