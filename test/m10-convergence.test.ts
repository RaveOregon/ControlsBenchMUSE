import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CampaignLedger, readLedger, replay } from "../src/campaign/ledger.ts";
import type { M10Session } from "../src/campaign/m10-rehearsal.ts";
import type { ToolName } from "../src/campaign/contracts.ts";
import { CampaignHost } from "../src/host/campaign-host.ts";
import { HmiHub } from "../src/host/hmi.ts";
import { createCampaignFactory, m8Preflight } from "../src/host/m8-campaign-factory.ts";
import type { HostCommand, HostStreamMessage } from "../src/host/protocol.ts";
import { HostedSession } from "../ui/src/adapters/host/hosted-session.ts";
import { WorkspaceStore } from "../ui/src/model/workspace-store.ts";
import { hmiTileModel } from "../ui/src/model/hmi-tile.ts";
import { ProtocolTransport } from "./fixtures/m8-protocol-transport.ts";

const manifest = JSON.parse(readFileSync(new URL("../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.manifest.json", import.meta.url), "utf8"));
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(predicate: () => boolean, label: string) {
  const end = Date.now() + 8000;
  while (!predicate()) { if (Date.now() > end) throw new Error(`Timeout: ${label}`); await delay(20); }
}
async function command(host: CampaignHost, type: HostCommand["type"], requestId = `${type}-${crypto.randomUUID()}`, payload?: HostCommand["payload"]) {
  let ack: Extract<HostStreamMessage, { type: "ack" }> | undefined;
  const off = host.subscribe(m => { if (m.type === "ack" && m.ack.requestId === requestId) ack = m; });
  try { host.submit({ contractVersion: 1, type, requestId, ...(payload ? { payload } : {}) }); await host.idle(); assert(ack); return ack.ack; }
  finally { off(); }
}

test("M8 factory preflight is read-only, scope is explicit and ownership is exclusive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m10-lease-")), ownershipPath = join(dir, "live.lock");
  const transports: ProtocolTransport[] = [];
  const factory = createCampaignFactory({ ownershipPath, transportFactory: () => { const t = new ProtocolTransport(); transports.push(t); return t; } });
  const hmi = new HmiHub().runtimeAdapter();
  const firstLedger = new CampaignLedger("lease-first"), secondLedger = new CampaignLedger("lease-second");
  try {
    const check = m8Preflight({ ownershipPath, modulePath: join(dir, "not-installed") });
    assert.equal(check.plcContacted, false); assert.equal(check.paidCalls, 0); assert.equal(check.projectUnchanged, true);
    assert.equal(check.nativeModuleAvailable, false); assert.equal(check.runtimeOwned, false); assert.equal(check.ready, false);
    assert(!("password" in check)); assert.equal(transports.length, 0);
    await assert.rejects(factory.create({ ledger: firstLedger, hmi, scope: { faults: false } }), /complete six-case scope/);
    assert(!existsSync(ownershipPath));
    const hosted = await factory.create({ ledger: firstLedger, hmi, scope: {} });
    assert.equal(hosted.runtime.ledger, firstLedger); assert.equal(hosted.runtime.options.hmi, hmi);
    assert.equal(transports[0].opens, 0, "factory construction never opens OPC");
    try { await assert.rejects(factory.create({ ledger: secondLedger, hmi, scope: {} }), /EEXIST/); }
    finally { await hosted.dispose!(); }
    assert.equal(existsSync(ownershipPath), false); assert.equal(transports[0].writes.length, 0);
  } finally { firstLedger.close(); secondLedger.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("real M8 connector/driver uses the host ledger and HMI; the portal receives one coherent campaign", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m10-host-")), t = new ProtocolTransport();
  let session: M10Session | undefined, execution: Promise<void> | undefined;
  const factory = createCampaignFactory({ ownershipPath: join(dir, "live.lock"), transportFactory: () => t, onSession: s => { session = s; },
    executor: s => execution = (async () => {
      const r = s.runtime, ledger = s.ledger;
      let id = 0;
      const tool = async (name: ToolName, args: Record<string, unknown>) => {
        const outcome = await r.executeTool({ id: `probe-${++id}`, name, arguments: args });
        assert.equal(outcome.status, "applied", outcome.message); return outcome;
      };
      await r.applyDecision({ summary: "Protocol wiring probe, not conveyor behavior", plan: { objective: "Connect host to M8 adapter", experiments: [{ id: "probe", objective: "Evidence wiring", category: "functional", requirements: [] }] }, calls: [] }, ledger.state.revision);
      await tool("operator_action", { action: "reset" }); await tool("operator_action", { action: "start" });
      await tool("introduce_carton", { itemId: "host-probe", requestedRoute: null });
      await tool("wait_for_condition", { signal: "Motor_RunCmd", equals: false, timeoutMs: 2000 });
      await tool("capture_hmi_evidence", { kind: "frame", durationMs: 1 });
      const output = ledger.events.filter(e => e.type === "plc.output").at(-1)!;
      await tool("record_finding", { id: "wiring", title: "Protocol fixture observed", experimentId: "probe", claims: [{ evidenceId: output.id, signal: "Motor_RunCmd", equals: false }], injectedTruthRefs: [], inference: "Host wiring preserves evidence", assumptions: ["Protocol fixture supplies receipts, not conveyor logic"], uncertainty: "No live controller or HMI behavior established" });
      await r.applyDecision({ summary: "Probe completed", completeExperiment: { id: "probe", evidenceRefs: [output.id], conclusion: "observed" }, calls: [] }, ledger.state.revision);
      await tool("finish_campaign", { summary: "Offline host wiring probe complete" }); await r.stop();
    })() });
  const host = new CampaignHost({ factory, artifactDir: dir, hmi: new HmiHub({ captureIntervalMs: 60_000 }), hmiSourceFactory: url => ({
    id: "offline-browser", kind: "webvisu", url,
    async open() { return { sessionId: "offline-hmi", browser: "injected capture; no live page" }; },
    async capture() { return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", requestedAtIso: new Date().toISOString(), capturedAtIso: new Date().toISOString(), pageUrl: url }; }, async close() {} }) });
  const store = new WorkspaceStore("live", manifest.signals), client = new HostedSession(store);
  let delivered = Promise.resolve();
  const messages: HostStreamMessage[] = [], orderErrors: string[] = [];
  const off = host.subscribe(m => { messages.push(m); delivered = delivered.then(() => client.receive(m)).then(() => {
    if (m.type === "ack") for (const ref of m.ack.evidenceRefs) if (!ref.startsWith("hmi-") && !client.getEnvelope(ref)) orderErrors.push(ref);
  }); });
  try {
    assert.equal((await command(host, "configure_hmi", "configure", { url: "http://localhost:9876/operator" })).outcome, "applied");
    const started = await command(host, "start", "start-once"); assert.equal(started.outcome, "applied", started.detail);
    await until(() => !!execution, "executor invoked"); await execution;
    await until(() => client.lastSequence === host.events.length, "stream drained"); await delivered;
    assert(session); assert.equal(host.runtime, session.runtime); assert.equal(session.ledger.campaignId, host.campaignId);
    assert.equal(session.ledger.events.length, host.events.length);
    assert.deepEqual(store.state.hosted!.projection, replay(host.events));
    assert.equal(store.state.hosted!.evidenceClass, "fake_connector");
    for (const [id, value] of Object.entries(host.projection!.outputs)) assert.equal(store.state.outputs[id]?.value, value, id);
    assert.equal(store.state.outputs["controller.Mode"].value, 0);
    assert(Object.values(store.state.entities).some(e => e.state.itemId === "host-probe"));
    for (const type of ["agent.activity", "experiment.started", "experiment.completed", "finding.created", "report.finalized", "controller.action", "world.raw_image", "plc.acknowledged"]) assert(host.events.some(e => e.type === type), type);
    const capture = host.events.find(e => e.type === "hmi.evidence")!;
    assert.equal(host.hmi.frame("offline-hmi", 2)?.ref.reference, capture.data.reference);
    assert.equal(host.report()!.findings.length, 1); assert.equal(host.report()!.provenance!.plcBuild, session.ledger.state.provenance!.plcBuild);
    assert(host.events.every(e => e.campaignId === host.campaignId)); assert.deepEqual(orderErrors, []);
    assert(messages.some(m => m.type === "events"));
    const id = host.campaignId; assert.equal(host.submit({ contractVersion: 1, type: "start", requestId: "start-once" }).duplicate, true);
    await host.idle(); assert.equal(host.campaignId, id); assert.equal(t.opens, 1);
    const campaignFile = join(dir, id!, "campaign.jsonl"); assert.deepEqual(readLedger(campaignFile), host.events);
    assert(existsSync(join(dir, id!, "m8-transport.jsonl")));
    assert.equal((await command(host, "reset_simulation")).outcome, "applied");
    assert(Object.values(session.driver.lastImage).every(v => v === false || v === 0 || v === ""));
    assert.equal(t.values["GVL_BenchRead.SimApplied"], true);
    assert.equal((await command(host, "exit_simulation")).outcome, "applied");
    assert.equal(t.values["GVL_BenchRead.SimApplied"], false);
  } finally { off(); await host.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("the actual six-case executor pauses in place, resumes once and drains promptly on Stop", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m10-pause-")), t = new ProtocolTransport();
  let session: M10Session | undefined;
  const host = new CampaignHost({ factory: createCampaignFactory({ ownershipPath: join(dir, "live.lock"), transportFactory: () => t, onSession: s => { session = s; } }) });
  try {
    assert.equal((await command(host, "start")).outcome, "applied");
    await until(() => host.events.filter(e => e.type === "controller.action").length === 2, "initial Reset and Start receipts");
    assert.equal((await command(host, "pause")).outcome, "applied"); assert(session);
    const image = structuredClone(session.driver.lastImage), snapshot = structuredClone(session.driver.lastSnapshot);
    await delay(250); assert.deepEqual(session.driver.lastImage, image); assert.deepEqual(session.driver.lastSnapshot, snapshot);
    assert.equal((await command(host, "resume")).outcome, "applied");
    await delay(250);
    assert.equal(t.writes.flat().filter(i => i.path === "GVL_DemoWrite.StartSequence").length, 1, "Resume cannot restart the six-case program");
    assert.equal(host.events.filter(e => e.type === "plan.created").length, 1);
    assert.equal((await command(host, "stop")).outcome, "applied");
    const began = performance.now(); await host.close(); assert(performance.now() - began < 1000);
    assert.equal(existsSync(join(dir, "live.lock")), false);
    assert.equal(host.projection!.status, "stopped"); assert(host.projection!.report);
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("all preserved M10 controller evidence replays through the portal without becoming a new live claim", async () => {
  const events = readLedger(fileURLToPath(new URL("../artifacts/m10/2026-11-01T00-58-43-185Z/campaign.jsonl", import.meta.url)));
  const projection = replay(events), client = new HostedSession(new WorkspaceStore("replay", manifest.signals));
  const mapped = await client.ingestEnvelopes(events[0].campaignId, events, projection, { evidenceClass: "preserved_live_plc" });
  assert.equal(events.filter(e => e.type === "plc.acknowledged").length, 302);
  assert.equal(mapped.filter(e => e.kind === "connector.ack").length, 302);
  assert.deepEqual(client.store.state.hosted!.projection, projection);
  assert.equal(client.store.state.hosted!.evidenceClass, "preserved_live_plc");
  assert.equal(Object.keys(projection.findings).length, 6); assert.equal(Object.keys(projection.experiments).length, 6);
  for (const finding of Object.values(projection.findings)) for (const claim of finding.claims) {
    const cited = client.store.findEvent(claim.evidenceId); assert(cited?.kind === "plc.output"); assert.equal(cited.values[claim.signal], claim.equals);
  }
  const acks = mapped.filter(e => e.kind === "connector.ack");
  for (const ack of events.filter(e => e.type === "plc.acknowledged")) {
    const ui = acks.find(e => e.id === ack.id); assert(ui?.kind === "connector.ack");
    assert.equal(ui.sequence, ack.data.sequence); assert.equal(ui.outputCaptureCycle, ack.data.outputCaptureCycle);
  }
  for (const [id, value] of Object.entries(projection.outputs)) assert.equal(client.store.state.outputs[id]?.value, value, id);
  assert(mapped.some(e => e.kind === "entity.publish"));
  assert.equal(hmiTileModel(client.store.state, Date.now()).headline, "HMI not observed/tested");
  assert(mapped.every(e => e.provenance.mode === "replay"));
});
