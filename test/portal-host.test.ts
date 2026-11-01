// Live integration: portal HostedSession <-> HTTP/SSE host <-> M9 CampaignRuntime with the
// deterministic fake connector (fixtures until the M10 connector is available).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import test from "node:test";
import type { Decision } from "../src/campaign/contracts.ts";
import { CampaignLedger, replay } from "../src/campaign/ledger.ts";
import type { CampaignProjection } from "../src/campaign/ledger.ts";
import { FakeProvider } from "../src/campaign/provider.ts";
import type { AgentContext } from "../src/campaign/provider.ts";
import { fixtureCampaignFactory, loadCampaignFactory } from "../src/host/campaign-factory.ts";
import type { CampaignFactory } from "../src/host/campaign-factory.ts";
import { CampaignHost } from "../src/host/campaign-host.ts";
import type { HmiCaptureSource, HmiInputObservation } from "../src/host/hmi.ts";
import { HmiHub } from "../src/host/hmi.ts";
import { createPortalServer, listen } from "../src/host/http.ts";
import type { HostCommand, HostStreamMessage, ProjectionView } from "../src/host/protocol.ts";
import { HostedSession } from "../ui/src/adapters/host/hosted-session.ts";
import { hmiTileModel } from "../ui/src/model/hmi-tile.ts";
import { WorkspaceStore } from "../ui/src/model/workspace-store.ts";
import type { SignalDefinition } from "../ui/src/model/workspace-store.ts";

// Compile-time: the portal's projection mirror accepts the authoritative M9 projection.
const _projectionCompatible: (p: CampaignProjection) => ProjectionView = p => p;
void _projectionCompatible;

const manifest = JSON.parse(readFileSync(new URL("../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.manifest.json", import.meta.url), "utf8")) as { signals: SignalDefinition[] };
const signals: SignalDefinition[] = manifest.signals.map(s => ({ id: s.id, direction: s.direction, dataType: s.dataType, role: s.role, description: s.description }));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

class FakeHmiSource implements HmiCaptureSource {
  readonly id = "webvisu:test-plc:8080"; readonly kind = "webvisu" as const; readonly url: string;
  fail = false; captures = 0; onInput?: (input: HmiInputObservation) => void;
  constructor(url: string) { this.url = url; }
  async open(onInput: (input: HmiInputObservation) => void) { this.onInput = onInput; return { sessionId: "hmi-test-session", browser: "fake test browser · not a real page" }; }
  async capture() {
    if (this.fail) throw new Error("page unreachable");
    this.captures++;
    const requestedAtIso = new Date().toISOString();
    return { bytes: Buffer.concat([PNG, Buffer.from([this.captures])]), contentType: "image/png", requestedAtIso, capturedAtIso: new Date().toISOString(), pageUrl: this.url };
  }
  async close() {}
}

interface Harness { host: CampaignHost; server: Server; url: string; session: HostedSession; store: WorkspaceStore; messages: HostStreamMessage[]; close(): Promise<void>; post(command: unknown, headers?: Record<string, string>): Promise<Response>; hmi?: FakeHmiSource; ackOrderViolations: string[] }

async function openStream(url: string, onMessage: (m: HostStreamMessage) => void, headers: Record<string, string> = {}): Promise<{ close(): void }> {
  const controller = new AbortController();
  const response = await fetch(`${url}/api/stream`, { headers, signal: controller.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
          const data = block.split("\n").filter(l => l.startsWith("data: ")).map(l => l.slice(6)).join("\n");
          if (data) onMessage(JSON.parse(data) as HostStreamMessage);
        }
      }
    } catch { /* aborted */ }
  })();
  return { close: () => controller.abort() };
}

async function start(factory: CampaignFactory): Promise<Harness> {
  let hmi: FakeHmiSource | undefined;
  const host = new CampaignHost({ factory, commandTimeoutMs: 10_000, hmi: new HmiHub({ captureIntervalMs: 100, staleAfterMs: 400 }), hmiSourceFactory: url => (hmi = new FakeHmiSource(url)) });
  const server = createPortalServer({ host, heartbeatMs: 200 });
  const { url } = await listen(server, 0);
  const post = (command: unknown, headers: Record<string, string> = {}) => fetch(`${url}/api/commands`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(command) });
  const store = new WorkspaceStore("live", signals);
  const session = new HostedSession(store, { transport: { async send(command: HostCommand) { const r = await post(command); if (r.status !== 202) throw new Error(`HTTP ${r.status}`); } } });
  const messages: HostStreamMessage[] = [];
  const ackOrderViolations: string[] = [];
  const stream = await openStream(url, m => {
    messages.push(m);
    void session.receive(m).then(() => {
      // Acknowledgement ordering: every cited campaign event was accepted before the ack applied.
      if (m.type === "ack") for (const ref of m.ack.evidenceRefs) if (!ref.startsWith("hmi-") && !session.getEnvelope(ref)) ackOrderViolations.push(`${m.ack.requestId}:${ref}`);
    });
  });
  const harness: Harness = { host, server, url, session, store, messages, post, ackOrderViolations, get hmi() { return hmi; },
    async close() { stream.close(); await host.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); } } as Harness;
  await until(() => store.state.host?.state === "connected", "hello");
  return harness;
}

async function until(predicate: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
}

const lastCommand = (store: WorkspaceStore) => Object.values(store.state.commands).at(-1)!;
async function command(h: Harness, issue: () => { ok: boolean }, what: string) {
  const result = issue();
  assert.equal(result.ok, true, `${what} was refused locally: ${JSON.stringify(result)}`);
  const pending = lastCommand(h.store);
  assert.equal(pending.outcome, "pending", `${what} starts pending; displayed state is not changed by intent`);
  await until(() => h.store.state.commands[pending.requestId]?.outcome !== "pending", `${what} acknowledgement`);
  return h.store.state.commands[pending.requestId]!;
}

test("live: Start → M9 campaign runs on the fake connector; the portal follows the authoritative projection and evidence", async () => {
  const h = await start(fixtureCampaignFactory());
  try {
    assert.equal(h.store.state.phase, "ready");
    const started = await command(h, () => h.session.start(), "start");
    assert.equal(started.outcome, "applied", started.detail ?? "");
    const running = started.evidenceRefs!.map(id => h.session.getEnvelope(id)).find(e => e?.type === "campaign.state");
    assert.equal(running?.data.state, "running", "start ack cites the ledger's running transition");
    await until(() => h.store.state.hosted?.projection?.status === "completed" && Boolean(h.store.state.hosted.projection.report), "fixture campaign completion");
    await h.host.idle();
    await until(() => h.session.lastSequence === h.host.events.length, "all events streamed");
    const authoritative = replay(h.host.events);
    assert.deepEqual(h.store.state.hosted!.projection, authoritative, "portal shows the host projection verbatim");
    assert.deepEqual(h.store.state.hosted!.projection, h.host.projection);
    assert.equal(h.store.state.phase, "completed");
    assert.equal(h.store.state.hosted!.evidenceClass, "fake_connector");
    assert.deepEqual(Object.fromEntries(Object.entries(h.store.state.outputs).map(([k, v]) => [k, v.value])), authoritative.outputs);
    for (const [id, value] of Object.entries(authoritative.rawImage)) assert.equal(h.store.state.inputs[id]?.value, value, id);
    for (const finding of Object.values(authoritative.findings)) for (const claim of finding.claims) assert.equal(h.store.findEvent(claim.evidenceId)?.kind, "plc.output");
    assert.ok(h.store.state.entities !== undefined && h.store.state.timeline.some(e => e.kind === "entity.publish" || e.kind === "entity.remove" || e.kind === "world.evidence"), "simulated world evidence reaches the world view");
    assert.ok(h.store.state.timeline.every(e => e.lane !== "hmi"), "no HMI evidence exists without an HMI source");
    assert.equal(hmiTileModel(h.store.state, Date.now()).headline, "HMI not observed/tested");
    assert.equal(h.store.state.episode?.plcExpected, false, "a completed campaign no longer ages PLC liveness");

    const report = await (await fetch(`${h.url}/api/campaign/report`)).json() as { findings: unknown[]; evidenceClass: string };
    assert.equal(report.evidenceClass, "fake_connector");
    assert.equal(report.findings.length, 1);
    const jsonl = await (await fetch(`${h.url}/api/campaign/ledger`)).text();
    assert.deepEqual(replay(jsonl.trim().split("\n").map(l => JSON.parse(l))), authoritative);

    // Request IDs execute at most once.
    const campaignId = h.host.campaignId;
    const again = await h.post({ contractVersion: 1, requestId: started.requestId, type: "start" });
    assert.deepEqual(await again.json(), { received: true, duplicate: true });
    await h.host.idle();
    assert.equal(h.host.campaignId, campaignId);
    // Transport hardening.
    assert.equal((await h.post({ contractVersion: 1, requestId: "x-1", type: "stop" }, { origin: "http://evil.example" })).status, 403);
    assert.equal((await h.post({ contractVersion: 1, requestId: "x-2", type: "format_disk" })).status, 400);
    assert.equal((await fetch(`${h.url}/api/commands`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })).status, 415);

    // Unsupported runtime capabilities are refused honestly, never acknowledged.
    const steer = await command(h, () => h.session.steer("check divert B"), "steer");
    assert.equal(steer.outcome, "rejected"); assert.match(steer.detail!, /no steering channel/);
    const suppress = await command(h, () => h.session.setSuppression("Motor_RunCmd", true), "suppression");
    assert.equal(suppress.outcome, "rejected");
    assert.equal(h.store.state.suppressedOutputs.Motor_RunCmd, undefined);

    const reset = await command(h, () => h.session.resetSimulation(), "reset");
    assert.equal(reset.outcome, "applied", reset.detail ?? "");
    assert.ok(reset.evidenceRefs!.some(id => h.session.getEnvelope(id)?.type === "simulation.reset"));
    await until(() => h.store.state.hosted?.projection?.sequence === h.host.events.length, "reset evidence");
    for (const [id, value] of Object.entries(h.store.state.hosted!.projection!.rawImage)) {
      assert.ok(value === false || value === 0 || value === "", `${id} zeroed by acknowledged commit`);
      assert.equal(h.store.state.inputs[id]?.value, value, `${id} displayed from the acknowledged image`);
    }
    const exit = await command(h, () => h.session.exitSimulation(), "exit");
    assert.equal(exit.outcome, "applied", exit.detail ?? "");
    assert.equal(h.store.state.connection.simulationRequested, false);
    await until(() => h.store.state.connection.simulationApplied === false, "passthrough observation");
    assert.equal(h.session.start().ok, false, "cannot start on hardware passthrough");
    const enter = await command(h, () => h.session.enterSimulation(), "enter");
    assert.equal(enter.outcome, "applied");
    assert.equal(h.store.state.connection.simulationRequested, true);
    assert.deepEqual(h.ackOrderViolations, []);
  } finally { await h.close(); }
});

/** Holds the campaign in long observation windows so lifecycle commands land mid-experiment. */
function holdingPolicy(context: AgentContext, turn: number): Decision {
  if (turn === 1) return { summary: "Observe the fixture with HMI evidence", plan: { objective: "Lifecycle and HMI evidence through the portal", experiments: [{ id: "hold", objective: "Hold an observation window", category: "normal", requirements: [] }] }, calls: [
    { id: "hmi-1", name: "capture_hmi_evidence", arguments: { kind: "frame", durationMs: 1 } },
    { id: "carton-1", name: "introduce_carton", arguments: { itemId: "P-1", requestedRoute: null } },
    { id: "observe-1", name: "observe_for_duration", arguments: { durationMs: 5000 } }
  ] };
  return { summary: "Keep observing", calls: [{ id: `observe-${turn}`, name: "observe_for_duration", arguments: { durationMs: 5000 } }] };
}

test("live: Pause/Resume/Stop acknowledge only after the ledger transition; HMI frames, inputs and Muse capture are timestamped evidence", async () => {
  const h = await start(fixtureCampaignFactory({ provider: () => new FakeProvider(holdingPolicy) }));
  try {
    const configured = await command(h, () => h.session.configureHmi("http://test-plc:8080/webvisu.htm"), "configure_hmi");
    assert.equal(configured.outcome, "applied", configured.detail ?? "");
    assert.match(configured.evidenceRefs![0]!, /^hmi-frame:hmi-test-session:1$/);
    await until(() => h.store.state.hmi.lastFrame !== undefined, "first frame");
    const tile = hmiTileModel(h.store.state, Date.now());
    assert.equal(tile.observed, true);
    const displayed = h.store.state.hmi.lastFrame!;
    const media = await fetch(`${h.url}${tile.frame!.src}`);
    const bytes = Buffer.from(await media.arrayBuffer());
    assert.equal(media.headers.get("content-type"), "image/png");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), displayed.sha256, "displayed pixels are the exact captured bytes");
    assert.equal(media.headers.get("x-controlsbench-sha256"), displayed.sha256);

    // Engineer input on the controlled page becomes an HMI action observation, then a later frame.
    h.hmi!.onInput!({ kind: "pointer", atIso: new Date().toISOString(), x: 120, y: 48, viewportWidth: 1280, viewportHeight: 800, pageUrl: h.hmi!.url });
    await until(() => h.store.state.timeline.some(e => e.kind === "hmi.observation" && e.origin === "engineer_browser"), "HMI input observation");

    const started = await command(h, () => h.session.start(), "start");
    assert.equal(started.outcome, "applied", started.detail ?? "");
    await until(() => h.store.state.timeline.some(e => e.kind === "hmi.observation" && e.origin === "muse_tool"), "Muse HMI capture evidence");
    const capture = h.store.state.timeline.find(e => e.kind === "hmi.observation" && e.origin === "muse_tool")!;
    assert.ok(capture.kind === "hmi.observation" && capture.mediaUrl && /^hmi-frame:hmi-test-session:\d+$/.test(capture.reference!));
    assert.equal(h.session.getEnvelope(capture.id)?.type, "hmi.evidence", "Muse capture is ledger evidence with its campaign ID");
    assert.equal((await fetch(`${h.url}${capture.mediaUrl}`)).status, 200);
    await until(() => h.store.state.hosted?.projection?.activity?.phase === "observing", "observation window");

    const paused = await command(h, () => h.session.pause(), "pause");
    assert.equal(paused.outcome, "applied", paused.detail ?? "");
    assert.equal(h.session.getEnvelope(paused.evidenceRefs![0]!)?.data.state, "paused");
    assert.equal(h.store.state.phase, "paused");
    const resumed = await command(h, () => h.session.resume(), "resume");
    assert.equal(resumed.outcome, "applied", resumed.detail ?? "");
    assert.equal(h.store.state.phase, "running");
    const stopped = await command(h, () => h.session.stop(), "stop");
    assert.equal(stopped.outcome, "applied", stopped.detail ?? "");
    assert.ok(stopped.evidenceRefs!.some(id => h.session.getEnvelope(id)?.type === "report.finalized"));
    assert.equal(h.store.state.phase, "stopped");
    await until(() => h.session.lastSequence === h.host.events.length, "final events");
    const projection = replay(h.host.events);
    assert.deepEqual(h.store.state.hosted!.projection, projection);
    assert.ok(Object.values(projection.actions).every(a => a.status !== "requested"), "no unresolved action after finalization");
    assert.equal(h.session.pause().ok, false, "nothing to pause after stop");

    // Capture loss: the last frame stays, under a stale overlay.
    const beforeLoss = h.host.hmi.view.lastFrame!;
    h.hmi!.fail = true;
    await until(() => h.store.state.hmi.state === "stale", "stale HMI session");
    // A valid capture or SSE message already in flight may arrive after fail=true.
    // Hold the authoritative last valid capture, never an earlier client-side frame.
    const held = h.host.hmi.view.lastFrame!;
    await new Promise(r => setTimeout(r, 300));
    const stale = hmiTileModel(h.store.state, Date.now());
    assert.equal(stale.overlay?.kind, "stale");
    assert.equal(stale.frame?.reference, held.reference);
    assert(held.frameSequence >= beforeLoss.frameSequence);
    const off = await command(h, () => h.session.disconnectHmi(), "disconnect_hmi");
    assert.equal(off.outcome, "applied");
    await until(() => h.store.state.hmi.state === "disconnected", "disconnected");
    assert.equal(hmiTileModel(h.store.state, Date.now()).overlay?.kind, "disconnected");
    assert.deepEqual(h.ackOrderViolations, []);
  } finally { await h.close(); }
});

test("live: a reconnecting client resumes after Last-Event-ID; replays of already-accepted events are deduplicated", async () => {
  const h = await start(fixtureCampaignFactory());
  try {
    await command(h, () => h.session.start(), "start");
    await until(() => h.store.state.hosted?.projection?.status === "completed" && Boolean(h.store.state.hosted.projection.report), "completion");
    await h.host.idle();
    const id = h.host.campaignId!;
    const resumed: HostStreamMessage[] = [];
    const stream = await openStream(h.url, m => resumed.push(m), { "last-event-id": `${id}|10` });
    await until(() => resumed.some(m => m.type === "events"), "resumed events");
    stream.close();
    const first = resumed.find(m => m.type === "events");
    assert.ok(first?.type === "events" && first.events[0]!.sequence === 11);
    // Re-deliver the complete stream to the same portal session.
    const before = h.store.state.timeline.length;
    for (const m of resumed) await h.session.receive(m);
    const all = await new Promise<HostStreamMessage[]>(resolve => { const list: HostStreamMessage[] = []; void openStream(h.url, m => { list.push(m); if (m.type === "events") { resolve(list); } }); });
    for (const m of all) await h.session.receive(m);
    assert.equal(h.store.state.hosted?.integrityError, undefined);
    assert.equal(h.store.state.timeline.length, before, "no duplicate evidence");
  } finally { await h.close(); }
});

test("seam: an external factory module loads without host or portal changes, and must use the host ledger", async () => {
  const loaded = await loadCampaignFactory("test/fixtures/portal-factory.ts");
  assert.equal(loaded.evidenceClass, "fake_connector");
  const rogue: CampaignFactory = { ...fixtureCampaignFactory(), async create(context) { const own = await fixtureCampaignFactory().create({ ...context, ledger: new CampaignLedger("rogue") }); return own; } };
  const h = await start(rogue);
  try {
    const started = await command(h, () => h.session.start(), "start");
    assert.equal(started.outcome, "rejected");
    assert.match(started.detail!, /host-provided ledger/);
    assert.equal(h.host.campaignId, null);
  } finally { await h.close(); }
});
