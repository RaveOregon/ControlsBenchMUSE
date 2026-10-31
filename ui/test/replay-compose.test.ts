import assert from "node:assert/strict";
import test from "node:test";
import { composeReplay, type ReplayTimeline } from "../src/adapters/replay/compose.ts";
import { FIXTURE_PATHS } from "../src/adapters/replay/fixtures.ts";
import type { MuseEvent } from "../src/model/events.ts";
import { allPlannedChecks, defaultScope } from "../src/model/plan.ts";
import { loadRepoFixtures } from "./load-fixtures.ts";

const SOURCES = new Set<string>([...Object.values(FIXTURE_PATHS), "replay:composer"]);

async function full(): Promise<ReplayTimeline> {
  return composeReplay(await loadRepoFixtures(), defaultScope());
}

function within(timeline: ReplayTimeline, episodePrefix: string): MuseEvent[] {
  const ranges = timeline.episodes.filter((episode) => episode.id.startsWith(episodePrefix));
  return timeline.events.filter((event) => ranges.some((range) => event.atMs >= range.startMs && event.atMs <= range.endMs));
}

test("every replayed event is labeled replay and cites a preserved artifact", async () => {
  const timeline = await full();
  assert.ok(timeline.events.length > 20_000);
  for (const event of timeline.events) {
    assert.equal(event.provenance.mode, "replay", event.id);
    assert.notEqual(event.provenance.clock, "live_wall", event.id);
    assert.ok(SOURCES.has(event.provenance.source), `${event.id} cites ${event.provenance.source}`);
  }
  const sorted = timeline.events.every((event, index, all) => index === 0 || all[index - 1]!.atMs <= event.atMs);
  assert.ok(sorted, "timeline is ordered for playback");
});

test("surrogate world records never claim PLC evidence", async () => {
  const timeline = await full();
  const surrogate = [...within(timeline, "gate-a"), ...within(timeline, "gate-b")];
  assert.ok(surrogate.length > 3000);
  const plcKinds = new Set(["connector.ack", "connector.commit", "plc.identity", "plc.heartbeat", "simulation.state"]);
  assert.deepEqual(surrogate.filter((event) => plcKinds.has(event.kind)), []);
  for (const event of surrogate) {
    if (event.kind === "raw.input") assert.equal(event.provenance.evidenceClass, "surrogate_contract");
    if (event.kind === "plc.output") assert.equal(event.origin, "surrogate_driver");
    if (event.kind === "episode.start") assert.equal(event.plcExpected, false);
  }
});

test("raw inputs and PLC output frames match the preserved Gate A and B traces one-to-one", async () => {
  const bundle = await loadRepoFixtures();
  const timeline = composeReplay(bundle, defaultScope());
  const fromTrace = (source: string, run: string | undefined) => timeline.events.filter((event) => event.provenance.source === source && event.provenance.run === run);
  const expectRun = (events: MuseEvent[], recorded: Array<{ lane: string; data: Record<string, any> }>) => {
    const raw = events.filter((event) => event.kind === "raw.input").map((event) => (event.kind === "raw.input" ? [event.signalId, event.value] : null));
    assert.deepEqual(raw, recorded.filter((event) => event.lane === "raw_input").map((event) => [event.data.signalId, event.data.value]));
    const frames = events.filter((event) => event.kind === "plc.output").map((event) => (event.kind === "plc.output" ? event.values : null));
    assert.deepEqual(frames, recorded.filter((event) => event.lane === "plc_frame").map((event) => event.data.frame.values));
  };
  expectRun(fromTrace(FIXTURE_PATHS.gateATrace, "gate-a"), bundle.gateA.events);
  for (const run of bundle.gateB.runs) expectRun(fromTrace(FIXTURE_PATHS.gateBTrace, run.label), run.events);
});

test("the M2 stream replays every recorded commit, acknowledgement, and latency", async () => {
  const bundle = await loadRepoFixtures();
  const timeline = composeReplay(bundle, defaultScope());
  const acks = timeline.events.filter((event) => event.kind === "connector.ack" && event.provenance.source === FIXTURE_PATHS.m2Trace);
  assert.equal(acks.length, 10_000);
  assert.deepEqual(
    acks.map((event) => (event.kind === "connector.ack" ? [event.sequence, event.latencyMs, event.outputCaptureCycle] : null)),
    bundle.m2Rows.map((row) => [row.sequence, row.latencyMs, row.outputCaptureCycle])
  );
  const stream = timeline.episodes.find((episode) => episode.id === "m2-stream")!;
  assert.equal(stream.clock, "derived_latency");
  assert.ok(stream.timeScale > 1, "condensation is declared, not hidden");
  const identities = timeline.events.filter((event) => event.kind === "plc.identity" && event.provenance.source !== FIXTURE_PATHS.m7Trace).map((event) => (event.kind === "plc.identity" ? event.bootIdentity : ""));
  assert.deepEqual(identities, ["1414124232182", "1419486354154", "1419755446149"]);
});

test("model calls replay with exactly the recorded durations and conservative costs", async () => {
  const bundle = await loadRepoFixtures();
  const timeline = composeReplay(bundle, defaultScope());
  const ends = timeline.events.filter((event) => event.kind === "agent.request.end");
  assert.deepEqual(ends.map((event) => (event.kind === "agent.request.end" ? event.durationMs : 0)), bundle.gateC.modelCalls.map((call) => call.durationMs));
  const starts = new Map(timeline.events.filter((event) => event.kind === "agent.request.start").map((event) => [event.kind === "agent.request.start" ? event.requestId : "", event.atMs]));
  for (const end of ends) if (end.kind === "agent.request.end") assert.equal(Math.round(end.atMs - starts.get(end.requestId)!), end.durationMs);
  const total = ends.reduce((sum, event) => sum + (event.kind === "agent.request.end" ? event.costUsd : 0), 0);
  assert.equal(Number(total.toFixed(2)), bundle.gateC.budget.estimatedSpendUsd);
  assert.equal(ends.filter((event) => event.kind === "agent.request.end" && event.failed).length, 1, "the rejected repair artifact stays visible");
});

test("Muse adds the follow-up investigation only after its first assessment", async () => {
  const timeline = await full();
  const added = timeline.events.find((event) => event.kind === "plan.added")!;
  const firstAssessment = timeline.events.find((event) => event.kind === "agent.assessment")!;
  const firstResponse = timeline.events.find((event) => event.kind === "agent.request.end")!;
  assert.ok(added.atMs >= firstAssessment.atMs && added.atMs >= firstResponse.atMs);
  assert.equal(added.kind === "plan.added" && added.check.id, "AI-2");
  const followUpActions = timeline.events.filter((event) => event.kind === "agent.action");
  assert.ok(followUpActions.length > 0 && followUpActions.every((event) => event.atMs > added.atMs));
});

test("hidden fault truth stays sealed until after the diagnosis is sealed", async () => {
  const timeline = await full();
  const seal = timeline.events.find((event) => event.kind === "blind" && event.phase === "seal")!;
  const reveal = timeline.events.find((event) => event.kind === "blind" && event.phase === "reveal")!;
  assert.ok(reveal.atMs > seal.atMs);
  const beforeSeal = timeline.events.filter((event) => event.atMs <= seal.atMs && event.checkId?.startsWith("AI-"));
  assert.ok(beforeSeal.length > 50);
  assert.doesNotMatch(JSON.stringify(beforeSeal), /stuck_high|sensor_fault|fault\.setSensorStuck/);
  const sealedFault = timeline.events.find((event) => event.kind === "fault.set" && event.sealed === true);
  assert.equal(sealedFault?.kind === "fault.set" && sealedFault.target, "sealed");
});

test("verdicts come from recorded results; checks awaiting the live connector finish as not run", async () => {
  const timeline = await full();
  const verdicts = new Map(timeline.events.filter((event) => event.kind === "verdict").map((event) => [event.checkId, event.kind === "verdict" ? event.status : ""]));
  for (const check of allPlannedChecks()) {
    assert.ok(verdicts.has(check.id), `${check.id} has a verdict event`);
    if (check.availability === "awaiting_live") assert.equal(verdicts.get(check.id), "not_run", check.id);
  }
  assert.equal(verdicts.get("AI-1"), "inconclusive");
  assert.equal(verdicts.get("AI-2"), "pass");
});

test("engineer scope narrows the composed campaign and its dependencies", async () => {
  const bundle = await loadRepoFixtures();
  const scope = Object.fromEntries(Object.keys(defaultScope()).map((id) => [id, id === "FN-1"]));
  const timeline = composeReplay(bundle, scope);
  assert.deepEqual(timeline.episodes.map((episode) => episode.id), ["gate-b-cp5-routed-a"]);
  assert.deepEqual([...new Set(timeline.events.map((event) => event.checkId).filter(Boolean))], ["FN-1"]);
  const withoutBlind = composeReplay(bundle, { ...defaultScope(), "AI-1": false });
  assert.equal(withoutBlind.events.some((event) => event.kind === "plan.added"), false, "AI-2 depends on AI-1");
  assert.equal(withoutBlind.events.some((event) => event.checkId === "AI-1" || event.checkId === "AI-2"), false);
});
