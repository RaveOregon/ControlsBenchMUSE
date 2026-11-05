// Replay integration: preserved M9 ledgers (fake-connector campaigns and the 88 real M7 PLC
// acknowledgements) through the client envelope validator and M9 adapter into the portal store.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { CampaignEnvelope, HmiSessionView, ProjectionView } from "../../src/host/protocol.ts";
import { canonical, EnvelopeLog, parseLedgerJsonl } from "../src/adapters/host/envelope.ts";
import { HostedSession } from "../src/adapters/host/hosted-session.ts";
import { evidenceTag } from "../src/components/labels.ts";
import { HMI_NOT_OBSERVED, hmiTileModel } from "../src/model/hmi-tile.ts";
import { WorkspaceStore } from "../src/model/workspace-store.ts";
import { SIGNALS } from "./helpers.ts";
import { classifyActivity } from "../src/model/activity.ts";
import { loadRepoFixtures } from "./load-fixtures.ts";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const ledger = async (path: string) => parseLedgerJsonl(await readFile(repo + path, "utf8"));
const M9 = "artifacts/m9/2026-10-31T19-12-51-652Z/";

async function replaySession(path: string, evidenceClass: "fake_connector" | "preserved_live_plc") {
  const b = await loadRepoFixtures();
  const events = await ledger(path);
  const session = new HostedSession(new WorkspaceStore("replay", b.manifest.signals));
  const mapped = await session.ingestEnvelopes(events[0]!.campaignId, events, undefined, { evidenceClass });
  return { session, store: session.store, events, mapped };
}

/** Independent hash (node:crypto) of the same canonical body, to build test chains. */
function chain(campaignId: string, bodies: Array<{ type: string; data: Record<string, unknown>; visibility?: "public" | "truth" }>): CampaignEnvelope[] {
  const out: CampaignEnvelope[] = [];
  for (const [i, b] of bodies.entries()) {
    const body = { schemaVersion: "controlsbench.campaign.v1" as const, campaignId, id: `${campaignId}:${i + 1}`, sequence: i + 1, atIso: new Date(Date.UTC(2026, 9, 31, 0, 0, i)).toISOString(),
      type: b.type, visibility: b.visibility ?? "public", data: b.data, previousHash: out.at(-1)?.hash ?? "" };
    out.push({ ...body, hash: createHash("sha256").update(canonical(body)).digest("hex") });
  }
  return out;
}

test("routine timing diagnostics retain exact evidence without replacing the test headline or activity clock", async () => {
  const raw = "Coordinator overrun 104.31929999997374 ms; no catch-up burst";
  const events = chain("timing-presentation", [
    { type: "campaign.state", data: { state: "running", reason: "Test running" } },
    { type: "experiment.proposed", data: { id: "sort-b", objective: "Sort carton to Exit B", category: "functional", requirements: [] } },
    { type: "experiment.started", data: { id: "sort-b" } },
    { type: "agent.activity", data: { phase: "coordinator_delayed", summary: raw } }
  ]);
  const session = new HostedSession(new WorkspaceStore("replay", SIGNALS));
  const mapped = await session.ingestEnvelopes(events[0]!.campaignId, events, undefined, { evidenceClass: "fake_connector" });
  const diagnostic = mapped.find(e => e.id === events.at(-1)!.id)!;
  assert.equal(diagnostic.kind, "campaign.record");
  assert.equal(diagnostic.summary, "I/O update took 104 ms; no catch-up burst");
  assert.equal((diagnostic as Extract<typeof diagnostic, { kind: "campaign.record" }>).data?.summary, raw);
  assert.match(session.store.state.step!.message, /Sort carton to Exit B/);
  assert.equal(session.store.state.lastMeaningful!.eventId, events[2]!.id);
  const activity = classifyActivity(session.store.state, 4000);
  assert.doesNotMatch(activity.headline, /overrun/);
  assert.equal(activity.diagnostic, diagnostic.summary);
  assert.equal(session.getEnvelope(events.at(-1)!.id)!.data.summary, raw);
});

test("client hash chain matches every hash the M9 ledger recorded (golden, normal, adaptive, M7)", async () => {
  for (const path of ["test/fixtures/campaign-golden.jsonl", `${M9}normal.jsonl`, `${M9}adaptive.jsonl`, `${M9}m7.jsonl`]) {
    const events = await ledger(path);
    const log = new EnvelopeLog(events[0]!.campaignId);
    assert.equal((await log.accept(events)).length, events.length, path);
  }
});

test("all 88 preserved M7 PLC acknowledgements map with exact sequence, latency, cycle, image and outputs", async () => {
  const { store, events, mapped } = await replaySession(`${M9}m7.jsonl`, "preserved_live_plc");
  const acks = events.filter(e => e.type === "plc.acknowledged");
  assert.equal(acks.length, 88);
  for (const ack of acks) {
    const event = mapped.find(e => e.id === ack.id);
    assert.ok(event?.kind === "connector.ack", ack.id);
    if (event.kind !== "connector.ack") continue;
    assert.equal(event.sequence, ack.data.sequence);
    assert.equal(event.epoch, ack.data.epoch);
    assert.equal(event.latencyMs, ack.data.latencyMs);
    assert.equal(event.outputCaptureCycle, ack.data.outputCaptureCycle);
    const source = events.find(e => e.id === ack.data.sourceId)!;
    assert.equal(event.provenance.recordedAt, (source.data.source as { atIso: string }).atIso, "source timestamp retained separately from ingestion");
  }
  const lastOutput = events.filter(e => e.type === "plc.output").at(-1)!;
  const lastImage = events.filter(e => e.type === "world.raw_image").at(-1)!;
  assert.deepEqual(Object.fromEntries(Object.entries(store.state.outputs).map(([k, v]) => [k, v.value])), lastOutput.data.values);
  assert.deepEqual(Object.fromEntries(Object.entries(store.state.inputs).map(([k, v]) => [k, v.value])), lastImage.data.image);
  assert.equal(store.state.connection.appliedSequence, "88");
  assert.ok(mapped.every(e => e.provenance.mode === "replay"));
  const output = mapped.find(e => e.kind === "plc.output")!;
  assert.equal(evidenceTag(output.provenance.evidenceClass, "replay").text, "PLC · recorded", "historical PLC evidence is never labeled live");
  assert.equal(store.state.phase, "completed");
});

test("findings, actions and experiments cite exact campaign IDs that open the mapped evidence", async () => {
  for (const [path, cls] of [[`${M9}normal.jsonl`, "fake_connector"], [`${M9}adaptive.jsonl`, "fake_connector"], [`${M9}m7.jsonl`, "preserved_live_plc"]] as const) {
    const { store, events } = await replaySession(path, cls);
    const findings = events.filter(e => e.type === "finding.created");
    assert.ok(findings.length, path);
    for (const f of findings) for (const claim of f.data.claims as Array<{ evidenceId: string; signal: string; equals: unknown }>) {
      const cited = store.findEvent(claim.evidenceId);
      assert.ok(cited?.kind === "plc.output", `${path} ${claim.evidenceId}`);
      if (cited.kind === "plc.output") assert.equal(cited.values[claim.signal], claim.equals);
    }
    for (const outcome of events.filter(e => e.type === "action.applied")) for (const ref of outcome.data.evidenceRefs as string[]) assert.ok(events.some(e => e.id === ref), ref);
    assert.ok(store.state.timeline.every(e => e.kind !== "verdict"), "no requirement verdict is inferred from M9 states");
  }
});

test("fake-connector evidence is labeled surrogate, never PLC", async () => {
  const { mapped } = await replaySession(`${M9}normal.jsonl`, "fake_connector");
  const plc = mapped.filter(e => e.kind === "plc.output" || e.kind === "connector.ack" || e.kind === "raw.input");
  assert.ok(plc.length);
  for (const e of plc) assert.equal(evidenceTag(e.provenance.evidenceClass, "replay").text, "surrogate", e.id);
  const outputs = mapped.filter(e => e.kind === "plc.output");
  assert.ok(outputs.every(e => e.kind === "plc.output" && e.origin === "surrogate_driver"));
});

test("golden fake campaign reproduces the golden projection's outputs, raw image and terminal status", async () => {
  const golden = JSON.parse(await readFile(repo + "test/fixtures/campaign-golden-projection.json", "utf8")) as ProjectionView;
  const { store } = await replaySession("test/fixtures/campaign-golden.jsonl", "fake_connector");
  assert.equal(golden.status, "completed");
  assert.equal(store.state.phase, "completed");
  assert.deepEqual(Object.fromEntries(Object.entries(store.state.outputs).map(([k, v]) => [k, v.value])), golden.outputs);
  for (const [id, value] of Object.entries(golden.rawImage)) assert.equal(store.state.inputs[id]?.value, value, id);
});

test("integrity: gaps, tampering and conflicting duplicates quarantine the campaign; identical duplicates are ignored; additive types stay visible", async () => {
  const id = "integrity-1";
  const events = chain(id, [
    { type: "campaign.state", data: { state: "preparing", reason: "configured" } },
    { type: "controller.action", data: { actionId: "op-1", action: "start", observation: {} } },
    { type: "campaign.state", data: { state: "running", reason: "authorized" } },
    { type: "campaign.state", data: { state: "paused", reason: "held" } }
  ]);
  const session = new HostedSession(new WorkspaceStore("replay", SIGNALS));
  await session.ingestEnvelopes(id, events.slice(0, 2), undefined, { evidenceClass: "fake_connector" });
  assert.equal(session.store.findEvent(`${id}:2`)?.kind, "campaign.record", "M10 additive type remains visible");
  await session.ingestEnvelopes(id, events.slice(0, 3));
  assert.equal(session.lastSequence, 3, "identical duplicates deduplicated");
  assert.equal(session.store.state.phase, "running");
  const forged = { ...events[1]!, data: { ...events[1]!.data, action: "stop" } };
  await session.ingestEnvelopes(id, [forged]);
  assert.match(session.store.state.hosted?.integrityError ?? "", /differs/);
  await session.ingestEnvelopes(id, [events[3]!]);
  assert.equal(session.store.state.phase, "running", "nothing applies after an integrity failure");

  for (const [name, batch] of [
    ["gap", [events[0]!, events[2]!]],
    ["hash", [events[0]!, { ...events[1]!, data: { actionId: "op-1", action: "stop", observation: {} } }]],
    ["version", [{ ...events[0]!, schemaVersion: "controlsbench.campaign.v2" as "controlsbench.campaign.v1" }]]
  ] as const) {
    const s = new HostedSession(new WorkspaceStore("replay", SIGNALS));
    await s.ingestEnvelopes(id, batch as readonly CampaignEnvelope[], undefined, { evidenceClass: "fake_connector" });
    assert.ok(s.store.state.hosted?.integrityError, name);
  }
});

test("replayed hosted campaigns are read-only", async () => {
  const { session } = await replaySession("test/fixtures/campaign-golden.jsonl", "fake_connector");
  assert.equal(session.start().ok, false);
  assert.equal(session.reviewFinding("x", "accepted").ok, false);
});

const hmiView = (patch: Partial<HmiSessionView>): HmiSessionView => ({ state: "observing", recording: true, frameCount: 1, detail: "Observing", changedAtIso: "2026-10-31T00:00:00.000Z", staleAfterMs: 3000, captureIntervalMs: 1000,
  sourceId: "webvisu:plc:8080", url: "http://plc:8080/webvisu.htm", sessionId: "hmi-s1", ...patch });
const frame = { reference: "hmi-frame:hmi-s1:1", sessionId: "hmi-s1", frameSequence: 1, capturedAtIso: "2026-10-31T00:00:10.000Z", requestedAtIso: "2026-10-31T00:00:09.950Z",
  contentType: "image/jpeg", byteLength: 10, sha256: "a".repeat(64), mediaUrl: "/api/hmi/frames/hmi-s1/1", pageUrl: "http://plc:8080/webvisu.htm" };

test("HMI tile: no frame means exactly 'HMI not observed/tested', even with a configured or connecting source", () => {
  const store = new WorkspaceStore("live", SIGNALS);
  assert.equal(hmiTileModel(store.state, Date.now()).headline, HMI_NOT_OBSERVED);
  for (const state of ["connecting", "error", "disconnected", "observing"] as const) {
    store.setHmiSession(hmiView({ state, lastFrame: undefined, frameCount: 0 }));
    const model = hmiTileModel(store.state, Date.now());
    assert.equal(model.headline, HMI_NOT_OBSERVED, state);
    assert.equal(model.frame, undefined);
  }
});

test("HMI tile: actual frames show identity and timestamps; loss holds the last frame under a stale/disconnected overlay", () => {
  const store = new WorkspaceStore("live", SIGNALS);
  const t = Date.parse(frame.capturedAtIso);
  store.setHmiSession(hmiView({ lastFrame: frame }));
  let model = hmiTileModel(store.state, t + 500);
  assert.equal(model.observed, true);
  assert.equal(model.overlay, undefined);
  assert.equal(model.frame?.src, frame.mediaUrl);
  assert.equal(model.frame?.ageMs, 500);
  assert.ok(model.identity.some(([k, v]) => k === "Session" && v === "hmi-s1"));
  model = hmiTileModel(store.state, t + 3500);
  assert.equal(model.overlay?.kind, "stale", "age beyond threshold is stale even before the host says so");
  store.setHmiSession(hmiView({ state: "disconnected", recording: false, lastFrame: frame }));
  model = hmiTileModel(store.state, t + 600);
  assert.equal(model.overlay?.kind, "disconnected");
  assert.equal(model.frame?.reference, frame.reference, "last frame held");
  store.setHmiSession(hmiView({ lastFrame: frame }));
  store.setHostLink({ state: "reconnecting", detail: "lost" });
  assert.equal(hmiTileModel(store.state, t + 100).overlay?.kind, "host_lost");
});
