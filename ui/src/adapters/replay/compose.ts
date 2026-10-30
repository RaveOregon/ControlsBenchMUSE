// Composes preserved Gate A-D and M0-M2 records into one replayable campaign timeline.
//
// Every emitted event is derived from a field in a preserved artifact. Where a record has
// no timing, events are spaced for presentation and their clock is marked "discrete".
// Nothing here claims to be live, and nothing here simulates the conveyor.

import type { BudgetLimits, CheckStatus, EventLane, EvidenceClass, MuseEvent, MuseEventBody, Provenance, RawValue, RuntimeFlagState, SourceClock } from "../../model/events.ts";
import { allPlannedChecks, MUSE_ADDED_CHECKS, type PlanCheck } from "../../model/plan.ts";
import { firstSentence, formatMs, formatRaw, percentile, shortHash } from "../../model/format.ts";
import { FIXTURE_PATHS, type FixtureBundle, type Observation, type TraceEvent, type TraceRun } from "./fixtures.ts";

export interface ReplayEpisode {
  id: string;
  title: string;
  checkIds: string[];
  startMs: number;
  endMs: number;
  clock: SourceClock;
  timeScale: number;
  source: string;
}

export interface ReplayTimeline {
  events: MuseEvent[];
  episodes: ReplayEpisode[];
  durationMs: number;
  scope: Record<string, boolean>;
}

const EPISODE_GAP_MS = 900;
const DISCRETE_STEP_MS = 550;
const WORLD_HEARTBEAT_MS = 100;
const M2_STREAM_TARGET_MS = 14_000;
const RESTART_CONDENSE = 10;

const GATE_B_CHECKS: Record<string, string> = {
  "cp5-routed-a": "FN-1",
  "cp5-missed-a": "FN-2",
  "cp6-routed-b": "FN-3",
  "cp6-runout": "FN-4",
  "cp7-sensor": "FR-1",
  "cp7-drive": "FR-2",
  "cp7-divert": "FR-3"
};

const P = FIXTURE_PATHS;

class TimelineBuilder {
  readonly events: MuseEvent[] = [];
  readonly episodes: ReplayEpisode[] = [];
  cursor = 0;
  #next = 0;
  #open: ReplayEpisode | null = null;

  add(atMs: number, lane: EventLane, summary: string, body: MuseEventBody, provenance: Provenance, checkId?: string): void {
    this.events.push({ ...body, id: `replay-${String(++this.#next).padStart(6, "0")}`, atMs: Math.round(atMs * 1000) / 1000, lane, summary, checkId, provenance } as MuseEvent);
  }

  openEpisode(spec: Omit<ReplayEpisode, "startMs" | "endMs">, body: Extract<MuseEventBody, { kind: "episode.start" }>, provenance: Provenance): number {
    if (this.#open) throw new Error(`Episode ${this.#open.id} still open`);
    this.#open = { ...spec, startMs: this.cursor, endMs: this.cursor };
    // The episode's declared clock governs elapsed-time and staleness judgements downstream.
    this.add(this.cursor, "system", body.title, body, { ...provenance, clock: spec.clock });
    return this.cursor;
  }

  closeEpisode(endMs: number, provenance: Provenance): void {
    const open = this.#open;
    if (!open) throw new Error("No open episode");
    open.endMs = endMs;
    this.add(endMs, "system", `End: ${open.title}`, { kind: "episode.end", episodeId: open.id }, provenance);
    this.episodes.push(open);
    this.#open = null;
    this.cursor = endMs + EPISODE_GAP_MS;
  }
}

function prov(source: string, evidenceClass: EvidenceClass, clock: SourceClock, extra: Partial<Provenance> = {}): Provenance {
  return { mode: "replay", evidenceClass, source, clock, ...extra };
}

function checksFor(ids: string[], scope: Record<string, boolean>): string[] {
  return ids.filter((id) => scope[id]);
}

export function composeReplay(bundle: FixtureBundle, scopeInput: Record<string, boolean>): ReplayTimeline {
  const scope = { ...scopeInput };
  const b = new TimelineBuilder();
  const manifest = bundle.manifest;
  const roleToSignal = new Map(manifest.signals.map((signal) => [signal.role, signal.id]));
  const outputIds = new Set(manifest.signals.filter((signal) => signal.direction === "plc_to_world").map((signal) => signal.id));
  const inScope = (id: string) => scope[id] === true;
  const limits = bundle.gateC.budget.limits as unknown as BudgetLimits;

  // Campaign opening: budget limits come from the recorded Gate C guard configuration.
  const scoped = allPlannedChecks().filter((check) => inScope(check.id));
  b.add(0, "system", "Budget limits loaded", { kind: "budget.limits", limits }, prov(P.gateCResult, "audit", "discrete", { ref: "budget.limits" }));
  const groups = new Set(scoped.map((check) => check.group).filter((group) => group !== "evidence")).size;
  const recorded = scoped.filter((check) => check.availability === "recorded").length;
  b.add(0, "system", `Preparing campaign: ${scoped.length} checks in scope`, { kind: "step", phase: "preparing", message: `Preparing campaign: ${scoped.length} checks across ${groups} groups — ${recorded} backed by preserved records, ${scoped.length - recorded} awaiting the live connector` }, prov("replay:composer", "audit", "discrete"));
  b.cursor = 1200;

  if (inScope("IO-1")) composeM0(b, bundle);
  if (inScope("IO-2") || inScope("ES-1")) composeM1(b, bundle, scope);
  if (["SM-1", "SM-2", "RT-1", "NO-1"].some(inScope)) composeGateA(b, bundle, scope);
  for (const run of bundle.gateB.runs) {
    const checkId = GATE_B_CHECKS[run.label];
    if (checkId && inScope(checkId)) composeGateBRun(b, bundle, run, checkId);
  }
  if (["RT-2", "ES-2", "FR-4"].some(inScope)) composeM2(b, bundle, scope);
  if (inScope("AI-1")) composeBlindDiagnosis(b, bundle, roleToSignal, outputIds, scope);
  if (inScope("AI-3")) composeHotReload(b, bundle, limits);
  if (inScope("RT-5")) composeGuards(b, bundle);
  if (inScope("EV-1")) composeAudit(b, bundle);
  composeClosing(b, scoped);

  const events = b.events.slice().sort((left, right) => left.atMs - right.atMs);
  return { events, episodes: b.episodes, durationMs: events.at(-1)?.atMs ?? 0, scope };
}

// ---------------------------------------------------------------- M0 / M1 / M2

function sessionBody(bundle: FixtureBundle, source: Record<string, any>) {
  const negotiated = bundle.m0Session.sessionProbe?.negotiatedSubscription ?? {};
  const endpoint = bundle.m0Session.endpoints?.[0] ?? {};
  return {
    kind: "connector.session" as const,
    transport: "OPC UA",
    endpoint: String(source.endpointUrl ?? bundle.m0Session.endpointUrl),
    securityMode: String(source.securityMode ?? bundle.m0Session.secureConnect?.securityMode),
    securityPolicy: String(source.securityPolicy ?? bundle.m0Session.secureConnect?.securityPolicy),
    identity: String(bundle.m0Session.sessionProbe?.identity ?? "unknown"),
    serverProduct: endpoint.serverProductUri ? decodeURIComponent(String(endpoint.serverProductUri).replace(/^urn:/, "")) : undefined,
    requestedPublishingIntervalMs: negotiated.requestedPublishingInterval,
    publishingIntervalMs: negotiated.revisedPublishingInterval,
    requestedSamplingIntervalMs: negotiated.requestedSamplingInterval,
    samplingIntervalMs: negotiated.revisedSamplingInterval
  };
}

function composeM0(b: TimelineBuilder, bundle: FixtureBundle): void {
  const m0 = bundle.m0Session;
  const probe = m0.sessionProbe ?? {};
  const pv = (ref: string, source: string = P.m0Session) => prov(source, "plc_measurement", "discrete", { ref, recordedAt: bundle.samplingExperiment.date });
  let t = b.openEpisode(
    { id: "m0", title: "M0 · OPC UA session and access rights", checkIds: ["IO-1"], clock: "discrete", timeScale: 1, source: P.m0Session },
    { kind: "episode.start", episodeId: "m0", checkIds: ["IO-1"], title: "M0 · OPC UA session and access rights", connectorExpected: true, plcExpected: true, worldExpected: false, timeScale: 1, note: "M0 stored results without timestamps; spacing is presentation only." },
    pv("(file)")
  );
  const step = () => (t += DISCRETE_STEP_MS);
  b.add(step(), "system", "Opening authenticated OPC UA session", { kind: "step", phase: "connecting", message: "Opening authenticated OPC UA session to CODESYS Control Win", awaiting: "secure channel and user token" }, pv("secureConnect"), "IO-1");
  const session = sessionBody(bundle, { endpointUrl: m0.endpointUrl, securityMode: m0.secureConnect?.securityMode, securityPolicy: m0.secureConnect?.securityPolicy });
  b.add(step(), "system", `${session.securityMode} / ${session.securityPolicy} session to ${session.endpoint}`, session, pv("secureConnect, sessionProbe.negotiatedSubscription"), "IO-1");
  b.add(t, "system", "Connector session up", { kind: "connector.link", state: "up", detail: `connected=${m0.secureConnect?.connected}` }, pv("secureConnect.connected"), "IO-1");
  const before = (probe.before ?? []) as Array<Record<string, any>>;
  const after = (probe.after ?? []) as Array<Record<string, any>>;
  const cycleBefore = before.find((row) => row.name === "PlcCycle")?.value;
  const cycleAfter = after.find((row) => row.name === "PlcCycle")?.value;
  if (cycleBefore !== undefined) b.add(step(), "plc_ack", `PlcCycle = ${cycleBefore}`, { kind: "plc.heartbeat", plcCycle: String(cycleBefore) }, pv("sessionProbe.before[PlcCycle]"), "IO-1");
  for (const [name, status] of Object.entries((probe.writeResults ?? {}) as Record<string, string>)) {
    const accepted = status.startsWith("Good");
    const expectedAccepted = before.find((row) => row.name === name)?.userAccessLevel === 3;
    b.add(step(), accepted === expectedAccepted ? "conclusion" : "fault", `Write ${name}: ${status}`, { kind: "connector.case", name: `write ${name}`, accepted, expectedAccepted, detail: status }, pv(`sessionProbe.writeResults.${name}`), "IO-1");
  }
  if (cycleAfter !== undefined) b.add(step(), "plc_ack", `PlcCycle = ${cycleAfter}`, { kind: "plc.heartbeat", plcCycle: String(cycleAfter) }, pv("sessionProbe.after[PlcCycle]"), "IO-1");
  const exp = bundle.samplingExperiment;
  b.add(step(), "system", "Sampling negotiation", { kind: "step", phase: "connecting", message: `Default floor revised ${exp.baseline?.requestedSamplingIntervalMs} ms sampling to ${exp.baseline?.revisedSamplingIntervalMs} ms; with ItemMinSamplingRate=20 the server accepted ${exp.tuned20msMatchedCadence?.revisedPublishingIntervalMs} ms publish / ${exp.tuned20msMatchedCadence?.revisedSamplingIntervalMs} ms sampling (negotiation only, not an M3 rate verdict)` }, pv("baseline, tuned20msMatchedCadence", P.samplingExperiment), "IO-1");
  const pass = probe.echoMatched === true && probe.plcCycleAdvanced === true;
  b.add(step(), "conclusion", `IO-1 ${pass ? "pass" : "fail"}`, { kind: "verdict", status: pass ? "pass" : "fail", summary: `Echo matched, PLC cycle ${cycleBefore}→${cycleAfter}, read-only symbols rejected writes.`, evidence: { echoMatched: probe.echoMatched, plcCycleAdvanced: probe.plcCycleAdvanced, writeResults: probe.writeResults } }, pv("sessionProbe"), "IO-1");
  b.closeEpisode(step(), pv("(file)"));
}

function composeM1(b: TimelineBuilder, bundle: FixtureBundle, scope: Record<string, boolean>): void {
  const m1 = bundle.m1Result;
  const result = m1.result ?? {};
  const pv = (ref: string) => prov(P.m1Result, "plc_measurement", "discrete", { ref, recordedAt: m1.measuredAt });
  const checkIds = checksFor(["IO-2", "ES-1"], scope);
  let t = b.openEpisode(
    { id: "m1", title: "M1 · Typed raw scalar correctness", checkIds, clock: "discrete", timeScale: 1, source: P.m1Result },
    { kind: "episode.start", episodeId: "m1", checkIds, title: "M1 · Typed raw scalar correctness", connectorExpected: true, plcExpected: true, worldExpected: false, timeScale: 1, note: "M1 stored per-case outcomes without per-case timing; spacing is presentation only." },
    pv("(file)")
  );
  const step = () => (t += DISCRETE_STEP_MS);
  b.add(step(), "system", "OPC UA session", sessionBody(bundle, m1), pv("endpointUrl, securityMode, securityPolicy"));
  b.add(t, "system", "Connector session up", { kind: "connector.link", state: "up", detail: `${m1.publishedNodeCount} published nodes resolved` }, pv("publishedNodeCount"));
  b.add(step(), "plc_ack", `PLC boot identity ${result.bootIdentity}`, { kind: "plc.identity", bootIdentity: String(result.bootIdentity) }, pv("result.bootIdentity"));
  b.add(t, "system", "Simulation applied state not recorded", { kind: "simulation.state", applied: null, detail: "M1 does not store SimulationActive; it read back the application-visible active image." }, pv("(absent field)"));
  const epoch = String(result.epoch);
  for (const testCase of (result.cases ?? []) as Array<Record<string, any>>) {
    const rejectionCase = testCase.accepted === false;
    const checkId = rejectionCase ? "ES-1" : "IO-2";
    if (!scope[checkId]) continue;
    if (testCase.slot !== undefined) {
      b.add(step(), "raw_input", `Commit ${testCase.name}: seq ${testCase.sequence} → slot ${testCase.slot}`, { kind: "connector.commit", epoch, sequence: String(testCase.sequence), slot: testCase.slot }, pv(`result.cases[${testCase.name}]`), checkId);
      b.add(t + 120, "plc_ack", `PLC applied seq ${testCase.sequence} (${testCase.name})`, { kind: "connector.ack", epoch, sequence: String(testCase.sequence), slot: testCase.slot, latencyMs: null }, pv(`result.cases[${testCase.name}].accepted`), checkId);
    } else {
      const detail = rejectionCase ? `Rejected${testCase.attributed ? " and attributed" : ""}; active image unchanged` : `${testCase.commits ?? 1} commits accepted`;
      b.add(step(), rejectionCase ? "fault" : "plc_ack", `${testCase.name}: ${detail}`, { kind: "connector.case", name: testCase.name, accepted: testCase.accepted === true, expectedAccepted: !rejectionCase, detail }, pv(`result.cases[${testCase.name}]`), checkId);
    }
  }
  const counts = result.signalCounts ?? {};
  const outputs = Object.entries((result.outputTypes ?? {}) as Record<string, string>).map(([id, type]) => `${id}:${type}`).join(", ");
  b.add(step(), "plc_output", "PLC output types", { kind: "step", phase: "observing", message: `PLC outputs exposed as ${outputs}` }, pv("result.outputTypes"));
  if (scope["IO-2"]) {
    const pass = m1.result && result.pass === true;
    b.add(step(), "conclusion", `IO-2 ${pass ? "pass" : "fail"}`, { kind: "verdict", status: pass ? "pass" : "fail", summary: `${counts.bool} BOOL, ${counts.real} REAL, ${counts.udint} UDINT round-tripped; final applied sequence ${result.finalAppliedSequence}; PLC time advanced.`, evidence: { signalCounts: counts, finalAppliedSequence: result.finalAppliedSequence, plcTimeAdvanced: result.plcTimeAdvanced } }, pv("result"), "IO-2");
  }
  if (scope["ES-1"]) {
    const rejected = ((result.cases ?? []) as Array<Record<string, any>>).filter((testCase) => testCase.accepted === false);
    const pass = rejected.length > 0 && rejected.every((testCase) => testCase.attributed === true);
    b.add(step(), "conclusion", `ES-1 ${pass ? "pass" : "fail"}`, { kind: "verdict", status: pass ? "pass" : "fail", summary: `${rejected.length} invalid payloads rejected and attributed without changing the active image.`, evidence: { rejected: rejected.map((testCase) => testCase.name) } }, pv("result.cases"), "ES-1");
  }
  b.closeEpisode(step(), pv("(file)"));
}

function composeM2(b: TimelineBuilder, bundle: FixtureBundle, scope: Record<string, boolean>): void {
  const m2 = bundle.m2Result;
  const epoch = String(m2.stressEpoch);
  const rows = bundle.m2Rows;
  const recorded = { recordedAt: m2.measuredAt };

  if (scope["RT-2"]) {
    const totalLatency = rows.reduce((sum, row) => sum + row.latencyMs, 0);
    const timeScale = Math.max(1, totalLatency / M2_STREAM_TARGET_MS);
    const pv = (ref: string, sourceAtMs?: number) => prov(P.m2Trace, "plc_measurement", "derived_latency", { ref, sourceAtMs, ...recorded });
    const title = `M2 · 10,000-image coherence stream (condensed ×${timeScale.toFixed(1)})`;
    const t0 = b.openEpisode(
      { id: "m2-stream", title, checkIds: ["RT-2"], clock: "derived_latency", timeScale, source: P.m2Trace },
      { kind: "episode.start", episodeId: "m2-stream", checkIds: ["RT-2"], title, connectorExpected: true, plcExpected: true, worldExpected: false, timeScale, note: "Trace rows record per-commit acknowledgement latency but no wall timestamps; spacing is reconstructed from latency and condensed." },
      prov(P.m2Result, "plc_measurement", "discrete", { ref: "(file)", ...recorded })
    );
    b.add(t0, "system", "OPC UA session", sessionBody(bundle, m2), prov(P.m2Result, "plc_measurement", "discrete", { ref: "endpointUrl, securityMode, securityPolicy", ...recorded }), "RT-2");
    b.add(t0, "system", "Connector session up", { kind: "connector.link", state: "up", detail: "M2 stress phase" }, prov(P.m2Result, "plc_measurement", "discrete", { ref: "phase", ...recorded }), "RT-2");
    b.add(t0, "plc_ack", `PLC boot identity ${m2.bootIdentity}`, { kind: "plc.identity", bootIdentity: String(m2.bootIdentity) }, prov(P.m2Result, "plc_measurement", "discrete", { ref: "bootIdentity", ...recorded }), "RT-2");
    b.add(t0, "system", "Streaming alternating images", { kind: "step", phase: "applying_stimulus", message: `Streaming ${rows.length.toLocaleString("en-US")} alternating images; each commit waits for the PLC echo before reusing its slot`, awaiting: "PLC applied-sequence echo" }, prov(P.m2Result, "plc_measurement", "discrete", { ref: "cases[0]", ...recorded }), "RT-2");
    let sourceMs = 0;
    rows.forEach((row, index) => {
      const commitAt = t0 + sourceMs / timeScale;
      b.add(commitAt, "raw_input", `Commit seq ${row.sequence} → slot ${row.slot}`, { kind: "connector.commit", epoch, sequence: row.sequence, slot: row.slot }, pv(`line ${index + 1}`, sourceMs), "RT-2");
      sourceMs += row.latencyMs;
      b.add(t0 + sourceMs / timeScale, "plc_ack", `PLC applied seq ${row.sequence} in ${formatMs(row.latencyMs)} (cycle ${row.outputCaptureCycle})`, { kind: "connector.ack", epoch, sequence: row.sequence, slot: row.slot, latencyMs: row.latencyMs, outputCaptureCycle: row.outputCaptureCycle }, pv(`line ${index + 1}`, sourceMs), "RT-2");
    });
    const end = t0 + sourceMs / timeScale;
    const sorted = rows.map((row) => row.latencyMs).sort((left, right) => left - right);
    const recomputed = { p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), max: sorted.at(-1) };
    const contiguous = rows.every((row, index) => Number(row.sequence) === index + 1);
    const pass = m2.pass === true && m2.tornImages === 0 && rows.length === m2.imageCount && contiguous;
    b.add(end + 200, "conclusion", `RT-2 ${pass ? "pass" : "fail"}`, { kind: "verdict", status: pass ? "pass" : "fail", summary: `${rows.length.toLocaleString("en-US")} images applied, ${m2.tornImages} torn, sequences 1–${rows.length} contiguous. Ack latency p50 ${formatMs(recomputed.p50)}, p99 ${formatMs(recomputed.p99)} (recomputed from trace). Not an M3 rate-tier verdict.`, evidence: { recordedLatencyMs: m2.latencyMs, recomputedFromTrace: recomputed, tornImages: m2.tornImages, imageCount: m2.imageCount } }, prov(P.m2Result, "plc_measurement", "discrete", { ref: "pass, tornImages, latencyMs", ...recorded }), "RT-2");
    b.closeEpisode(end + 400, prov(P.m2Trace, "plc_measurement", "derived_latency", { ref: "(file)", ...recorded }));
  }

  if (scope["ES-2"]) {
    const pv = (ref: string) => prov(P.m2Result, "plc_measurement", "discrete", { ref, ...recorded });
    let t = b.openEpisode(
      { id: "m2-cases", title: "M2 · Adversarial sequencing cases", checkIds: ["ES-2"], clock: "discrete", timeScale: 1, source: P.m2Result },
      { kind: "episode.start", episodeId: "m2-cases", checkIds: ["ES-2"], title: "M2 · Adversarial sequencing cases", connectorExpected: true, plcExpected: true, worldExpected: false, timeScale: 1, note: "M2 lists the cases and aggregate counter deltas, not per-case timing; spacing is presentation only." },
      pv("(file)")
    );
    const step = () => (t += DISCRETE_STEP_MS);
    for (const name of (m2.cases ?? []) as string[]) {
      if (name === "10000-alternating-images") continue;
      const accepted = name === "workstation-restart-new-epoch";
      if (name.startsWith("reconnect")) {
        b.add(step(), "system", "Client session dropped for reconnect case", { kind: "connector.link", state: "lost", detail: "M2 reconnect case (duration not recorded)" }, pv(`cases[${name}]`), "ES-2");
        b.add(step(), "system", "Client reconnected; staging ignored until explicit commit", { kind: "connector.link", state: "up", detail: "reconnected in the same workstation epoch" }, pv(`cases[${name}]`), "ES-2");
      }
      const detail = accepted ? `New epoch ${m2.workstationRestartEpoch} accepted with a complete image` : "Active image unchanged; diagnostic counter incremented as contracted";
      b.add(step(), accepted ? "plc_ack" : "fault", `${name}: ${accepted ? "accepted" : "rejected"}`, { kind: "connector.case", name, accepted, expectedAccepted: accepted, detail }, pv(`cases[${name}]`), "ES-2");
    }
    const deltas = (m2.counterDeltas ?? {}) as Record<string, string>;
    const singles = ["DuplicateCommitCount", "StaleCommitCount", "SkippedSequenceCount", "InvalidSlotCount", "InvalidPayloadCount", "SlotMetadataMismatchCount", "EpochRejectedCount"];
    const pass = m2.pass === true && singles.every((key) => deltas[key] === "1");
    b.add(step(), "conclusion", `ES-2 ${pass ? "pass" : "fail"}`, { kind: "verdict", status: pass ? "pass" : "fail", summary: `Each rejection counter moved exactly once; ${deltas.AppliedCommitCount} applied commits; ${deltas.SessionResetCount} session resets.`, evidence: { counterDeltas: deltas } }, pv("counterDeltas"), "ES-2");
    b.closeEpisode(step(), pv("(file)"));
  }

  if (scope["FR-4"] && m2.postRestart) {
    const post = m2.postRestart;
    const gapMs = Date.parse(m2.measuredCompleteAt) - Date.parse(m2.measuredAt);
    const timeScale = RESTART_CONDENSE;
    const pv = (ref: string, clock: SourceClock = "discrete") => prov(P.m2Result, "plc_measurement", clock, { ref, recordedAt: m2.measuredCompleteAt });
    const title = `M2 · PLC cold restart and new epoch (condensed ×${timeScale})`;
    const t0 = b.openEpisode(
      { id: "m2-restart", title, checkIds: ["FR-4"], clock: "recorded_wall", timeScale, source: P.m2Result },
      { kind: "episode.start", episodeId: "m2-restart", checkIds: ["FR-4"], title, connectorExpected: true, plcExpected: true, worldExpected: false, timeScale, note: `Interval from measuredAt to measuredCompleteAt (${(gapMs / 1000).toFixed(1)} s) includes the operator's cold reset and the post-restart probe.` },
      pv("measuredAt, measuredCompleteAt", "recorded_wall")
    );
    b.add(t0, "fault", "Operator cold reset", { kind: "plc.restart", detail: "Operator performed an explicit CODESYS cold reset between M2 phases" }, pv("postRestart"), "FR-4");
    b.add(t0, "system", "Awaiting new PLC boot identity", { kind: "step", phase: "connecting", message: "PLC cold reset in progress; workstation must observe a new boot identity before opening a fresh epoch", awaiting: "new PLC boot identity" }, pv("postRestart"), "FR-4");
    // Only the overall interval and the first commit latency are recorded; the identity,
    // reset check, and commit sit back-to-back at the end of that interval.
    const commit = post.commit ?? {};
    const ackAt = t0 + gapMs / timeScale;
    const identityAt = ackAt - commit.latencyMs / timeScale;
    b.add(identityAt, "plc_ack", `Boot identity ${post.oldBootIdentity} → ${post.newBootIdentity}`, { kind: "plc.identity", bootIdentity: String(post.newBootIdentity), previousBootIdentity: String(post.oldBootIdentity) }, pv("postRestart.newBootIdentity", "recorded_wall"), "FR-4");
    b.add(identityAt, "system", "New boot identity observed", { kind: "step", phase: "connecting", message: `New boot identity ${post.newBootIdentity}; opening fresh epoch and committing a complete image`, awaiting: "applied-sequence echo" }, pv("postRestart.newBootIdentity"), "FR-4");
    b.add(identityAt, "plc_ack", "Reset state observed", { kind: "connector.case", name: "post-restart reset state", accepted: post.resetStateObserved === true, expectedAccepted: true, detail: "Epoch/sequence state cleared after restart" }, pv("postRestart.resetStateObserved"), "FR-4");
    b.add(identityAt, "raw_input", `Commit seq ${commit.sequence} → slot ${commit.slot} (new epoch)`, { kind: "connector.commit", epoch: String(post.acceptedEpoch), sequence: String(commit.sequence), slot: commit.slot }, pv("postRestart.commit"), "FR-4");
    b.add(ackAt, "plc_ack", `PLC applied seq ${commit.sequence} in ${formatMs(commit.latencyMs)} (cycle ${commit.outputCaptureCycle})`, { kind: "connector.ack", epoch: String(post.acceptedEpoch), sequence: String(commit.sequence), slot: commit.slot, latencyMs: commit.latencyMs, outputCaptureCycle: String(commit.outputCaptureCycle) }, pv("postRestart.commit", "recorded_wall"), "FR-4");
    const pass = post.pass === true && post.oldBootIdentity !== post.newBootIdentity;
    b.add(ackAt, "conclusion", `FR-4 ${pass ? "pass" : "fail"}`, { kind: "verdict", status: pass ? "pass" : "fail", summary: `New boot identity observed; sequence ${post.acceptedSequence} accepted in fresh epoch ${post.acceptedEpoch}. Old continuity was not inferred.`, evidence: post }, pv("postRestart"), "FR-4");
    b.closeEpisode(ackAt, pv("(file)"));
  }
}

// ---------------------------------------------------------------- Gate A / B surrogate world traces

interface PendingWait {
  condition: string;
  openedAt: number;
  satisfied: (signalId: string, value: RawValue) => boolean;
}

function faultBody(controlId: string, payload: Record<string, any>): { faultId: string; target: string; active: boolean; detail: string } | null {
  const active = payload.active !== false;
  switch (controlId) {
    case "fault.setSensorStuck":
      return { faultId: `sensor.stuck:${payload.signalId}`, target: String(payload.signalId), active, detail: `${payload.signalId} stuck ${payload.value === false ? "low" : "high"}` };
    case "fault.setSensorBounce":
      return { faultId: `sensor.bounce:${payload.signalId}`, target: String(payload.signalId), active: true, detail: `${payload.signalId} bounce for ${payload.durationMs ?? 1000} ms` };
    case "fault.setDriveFeedbackFailure":
      return { faultId: "drive.feedbackFailure", target: "Drive_RunningFB", active, detail: "Drive running feedback suppressed" };
    case "fault.setOverload":
      return { faultId: "drive.overload", target: "Drive_Overload", active, detail: "Drive overload asserted" };
    case "fault.setDivertJam":
      return { faultId: `divert${payload.divert}.jam`, target: `D${payload.divert}`, active, detail: `Divert ${payload.divert} mechanically jammed` };
    case "fault.setContradictoryLimits":
      return { faultId: `divert${payload.divert}.contradictoryLimits`, target: `D${payload.divert}`, active, detail: `Divert ${payload.divert} home and extended both true` };
    case "fault.setCartonJam":
      return { faultId: "carton.jam", target: String(payload.cartonId ?? "carton"), active, detail: "Carton held in place" };
    default:
      return null;
  }
}

function emitTraceRun(b: TimelineBuilder, run: TraceRun, source: string, refPrefix: string, t0: number, checkId: string | undefined): number {
  const pv = (index: number, event: TraceEvent) => prov(source, "surrogate_contract", "world_virtual", { ref: `${refPrefix}events[${index}]`, sourceAtMs: event.atMs, run: run.label, seed: run.seed, worldVersion: event.worldVersion });
  for (let ms = 0; ms <= run.finalTimeMs; ms += WORLD_HEARTBEAT_MS) {
    const tick = Math.floor(ms / run.tickMs);
    b.add(t0 + ms, "system", `World tick ${tick}`, { kind: "world.heartbeat", tick }, prov(source, "surrogate_contract", "world_virtual", { ref: `${refPrefix}finalTimeMs=${run.finalTimeMs}, tickMs=${run.tickMs} (derived)`, sourceAtMs: ms, run: run.label, seed: run.seed, worldVersion: run.worldVersion }), checkId);
  }
  let previous: Record<string, RawValue> | null = null;
  const waits: PendingWait[] = [];
  const openWait = (at: number, condition: string, satisfied: PendingWait["satisfied"], provenance: Provenance) => {
    if (waits.some((wait) => wait.condition === condition)) return;
    waits.push({ condition, openedAt: at, satisfied });
    b.add(at, "system", `Awaiting ${condition}`, { kind: "wait.start", condition, timeoutMs: null }, provenance, checkId);
  };
  const closeWait = (at: number, condition: string, outcome: "satisfied" | "cancelled" | "unresolved", provenance: Provenance) => {
    const index = waits.findIndex((wait) => wait.condition === condition);
    if (index < 0) return;
    const [wait] = waits.splice(index, 1);
    b.add(at, "system", `${condition}: ${outcome}`, { kind: "wait.end", condition, outcome }, provenance, checkId);
    if (outcome === "satisfied") b.add(at, "system", `${condition} reached`, { kind: "step", phase: "observing", message: `${condition} reached ${Math.round(at - wait!.openedAt)} ms after the command` }, provenance, checkId);
  };

  run.events.forEach((event, index) => {
    const at = t0 + event.atMs;
    const provenance = pv(index, event);
    const data = event.data;
    switch (event.lane) {
      case "raw_input": {
        const value = data.value as RawValue;
        b.add(at, "raw_input", `${data.signalId} = ${formatRaw(value)}`, { kind: "raw.input", signalId: data.signalId, value, cause: data.cause, revision: data.stateRevision }, provenance, checkId);
        for (const wait of waits.slice()) if (wait.satisfied(data.signalId, value)) closeWait(at, wait.condition, "satisfied", provenance);
        break;
      }
      case "plc_frame": {
        const values = data.frame.values as Record<string, RawValue>;
        const changed = Object.keys(values).filter((key) => previous === null || values[key] !== previous[key]);
        const summary = previous === null ? `Surrogate driver initial frame: ${changed.map((key) => `${key}=${formatRaw(values[key])}`).join(", ")}` : `Surrogate driver: ${changed.map((key) => `${key}→${formatRaw(values[key])}`).join(", ") || "no change"}`;
        b.add(at, "plc_output", summary, { kind: "plc.output", frameSequence: data.frame.sequence, values, origin: "surrogate_driver" }, provenance, checkId);
        const rose = (key: string) => values[key] === true && (previous === null || previous[key] !== true);
        const fell = (key: string) => previous !== null && previous[key] === true && values[key] === false;
        if (rose("Motor_RunCmd")) {
          closeWait(at, "belt at rest (Belt_SpeedActual = 0)", "cancelled", provenance);
          b.add(at, "system", "Motor_RunCmd asserted", { kind: "step", phase: "applying_stimulus", message: "Surrogate PLC asserted Motor_RunCmd; awaiting drive running feedback", awaiting: "Drive_RunningFB = 1" }, provenance, checkId);
          openWait(at, "Drive_RunningFB = 1", (signal, value) => signal === "Drive_RunningFB" && value === true, provenance);
        }
        if (fell("Motor_RunCmd")) {
          closeWait(at, "Drive_RunningFB = 1", "cancelled", provenance);
          b.add(at, "system", "Motor_RunCmd removed", { kind: "step", phase: "observing", message: "Motor_RunCmd removed; observing deceleration and coast before hold", awaiting: "Belt_SpeedActual = 0" }, provenance, checkId);
          openWait(at, "belt at rest (Belt_SpeedActual = 0)", (signal, value) => signal === "Belt_SpeedActual" && value === 0, provenance);
        }
        for (const n of [1, 2]) {
          if (rose(`D${n}_ExtendCmd`)) openWait(at, `D${n}_ExtendedFB = 1`, (signal, value) => signal === `D${n}_ExtendedFB` && value === true, provenance);
          if (fell(`D${n}_ExtendCmd`)) openWait(at, `D${n}_HomeFB = 1`, (signal, value) => signal === `D${n}_HomeFB` && value === true, provenance);
        }
        previous = values;
        break;
      }
      case "control": {
        const control = data.control as { id: string; payload?: Record<string, any>; cause: string };
        const payload = control.payload ?? {};
        if (control.id === "fault.clearAll") {
          b.add(at, "fault", "All injected faults cleared", { kind: "fault.clear_all", detail: control.cause }, provenance, checkId);
          b.add(at, "system", "Clearing faults", { kind: "step", phase: "applying_stimulus", message: `Clearing injected faults: ${control.cause}` }, provenance, checkId);
          break;
        }
        const fault = faultBody(control.id, payload);
        if (fault) {
          b.add(at, "fault", `Inject ${fault.detail}`, { kind: "fault.set", ...fault }, provenance, checkId);
          b.add(at, "system", "Injecting fault", { kind: "step", phase: "applying_stimulus", message: `Injecting fault: ${fault.detail}` }, provenance, checkId);
          if (control.id === "fault.setSensorBounce") {
            const end = at + Number(payload.durationMs ?? 1000);
            b.add(end, "fault", `Bounce window ends on ${payload.signalId}`, { kind: "fault.set", ...fault, active: false, detail: `${fault.detail} (window from payload durationMs)` }, provenance, checkId);
          }
          break;
        }
        const summary = control.id === "carton.introduce" ? `Introduce carton ${payload.itemId} (requested ${payload.requestedRoute ?? "none"})` : `${control.id} ${JSON.stringify(payload)}`;
        b.add(at, "world", summary, { kind: "world.control", controlId: control.id, payload, cause: control.cause }, provenance, checkId);
        b.add(at, "system", summary, { kind: "step", phase: "applying_stimulus", message: summary }, provenance, checkId);
        break;
      }
      case "entity": {
        if (data.action === "publish") {
          const snapshot = data.snapshot as { id: string; type: string; state: Record<string, unknown> };
          b.add(at, "system", `${snapshot.id} at ${Number(snapshot.state.positionM).toFixed(3)} m`, { kind: "entity.publish", entityId: snapshot.id, entityType: snapshot.type, state: snapshot.state }, provenance, checkId);
        } else {
          b.add(at, "world", `${data.entityId} removed: ${data.reason}`, { kind: "entity.remove", entityId: data.entityId, reason: data.reason }, provenance, checkId);
        }
        break;
      }
      case "evidence": {
        const evidence = data.event as { type: string; summary: string; data?: Record<string, unknown> };
        b.add(at, evidence.type.startsWith("fault.") ? "fault" : "world", evidence.summary, { kind: "world.evidence", type: evidence.type, data: evidence.data }, provenance, checkId);
        if (evidence.type === "carton.introduced") {
          b.add(at, "system", "Tracking carton", { kind: "step", phase: "observing", message: `Tracking ${evidence.data?.itemId ?? "carton"}: position, photoeye edges, and divert interaction until it exits`, awaiting: "exit evidence" }, provenance, checkId);
        } else if (evidence.type === "carton.diverted" || evidence.type === "carton.exited") {
          b.add(at, "system", evidence.summary, { kind: "step", phase: "observing", message: evidence.summary }, provenance, checkId);
        }
        break;
      }
      case "activity": {
        const update = data.update as { phase: string; message: string };
        b.add(at, "system", update.message, { kind: "step", phase: "observing", message: update.message }, provenance, checkId);
        break;
      }
    }
  });
  const end = t0 + run.finalTimeMs;
  for (const wait of waits.slice()) closeWait(end, wait.condition, "unresolved", prov(source, "surrogate_contract", "world_virtual", { ref: `${refPrefix}finalTimeMs`, sourceAtMs: run.finalTimeMs, run: run.label }));
  return end;
}

function composeGateA(b: TimelineBuilder, bundle: FixtureBundle, scope: Record<string, boolean>): void {
  const trace = bundle.gateA;
  const run: TraceRun = { label: "gate-a", seed: trace.seed, worldVersion: trace.worldVersion, tickMs: trace.tickMs, finalTimeMs: trace.finalTimeMs, events: trace.events };
  const checkIds = checksFor(["SM-1", "SM-2", "RT-1", "NO-1"], scope);
  const title = "Gate A · Startup, drive causality, encoder, carton geometry";
  const t0 = b.openEpisode(
    { id: "gate-a", title, checkIds, clock: "world_virtual", timeScale: 1, source: P.gateATrace },
    { kind: "episode.start", episodeId: "gate-a", checkIds, title, world: { worldId: bundle.manifest.worldId, worldVersion: trace.worldVersion, run: "gate-a", seed: trace.seed, tickMs: trace.tickMs, finalTimeMs: trace.finalTimeMs }, connectorExpected: false, plcExpected: false, worldExpected: true, timeScale: 1, note: "Surrogate PLC-output driver; no PLC or connector. Virtual world time replayed at 1×." },
    prov(P.gateATrace, "surrogate_contract", "world_virtual", { ref: "(file)", run: "gate-a", seed: trace.seed, worldVersion: trace.worldVersion })
  );
  const end = emitTraceRun(b, run, P.gateATrace, "", t0, undefined);
  const results = new Map(bundle.gateAResult.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  const verdictFor: Array<[string, string, (evidence: Record<string, any>) => string]> = [
    ["SM-1", "CP-1", (e) => `${e.events} startup events, ${e.activities} activity update, snapshot schema ${e.snapshotSchema}.`],
    ["SM-2", "CP-2", (e) => `Feedback followed command: start delay ${e.startDelayMs} ms, stop delay ${e.stopDelayMs} ms.`],
    ["RT-1", "CP-3", (e) => `Encoder ${e.before} → ${e.after} (Δ${e.delta} counts) from physical travel.`],
    ["NO-1", "CP-4", (e) => `Coasted ${(Number(e.coastDistanceM) * 1000).toFixed(1)} mm over ${e.settleTimeMs} ms, then held at ${Number(e.stoppedPosition).toFixed(4)} m with PE_Entry held.`]
  ];
  let at = end + 150;
  for (const [checkId, checkpointId, describe] of verdictFor) {
    if (!scope[checkId]) continue;
    const checkpoint = results.get(checkpointId);
    const status: CheckStatus = checkpoint?.status === "pass" ? "pass" : "fail";
    b.add(at, "conclusion", `${checkId} ${status}`, { kind: "verdict", status, summary: checkpoint ? `${checkpointId}: ${describe(checkpoint.evidence)}` : `${checkpointId} missing from record`, evidence: checkpoint?.evidence }, prov(P.gateAResult, "audit", "discrete", { ref: `checkpoints[${checkpointId}]` }), checkId);
    at += 150;
  }
  b.closeEpisode(at, prov(P.gateATrace, "surrogate_contract", "world_virtual", { ref: "(file)" }));
}

function composeGateBRun(b: TimelineBuilder, bundle: FixtureBundle, run: TraceRun, checkId: string): void {
  const index = bundle.gateB.runs.indexOf(run);
  const title = `Gate B · ${run.label}`;
  const t0 = b.openEpisode(
    { id: `gate-b-${run.label}`, title, checkIds: [checkId], clock: "world_virtual", timeScale: 1, source: P.gateBTrace },
    { kind: "episode.start", episodeId: `gate-b-${run.label}`, checkIds: [checkId], title, world: { worldId: bundle.manifest.worldId, worldVersion: run.worldVersion, run: run.label, seed: run.seed, tickMs: run.tickMs, finalTimeMs: run.finalTimeMs }, connectorExpected: false, plcExpected: false, worldExpected: true, timeScale: 1, note: "Surrogate PLC-output driver; no PLC or connector. Virtual world time replayed at 1×." },
    prov(P.gateBTrace, "surrogate_contract", "world_virtual", { ref: `runs[${index}]`, run: run.label, seed: run.seed, worldVersion: run.worldVersion })
  );
  const end = emitTraceRun(b, run, P.gateBTrace, `runs[${index}].`, t0, checkId);
  const checkpoints = new Map(bundle.gateBResult.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  const recordedCount = (bundle.gateBResult.traceRuns as Array<{ label: string; eventCount: number }> | undefined)?.find((entry) => entry.label === run.label)?.eventCount;
  const countNote = recordedCount === run.events.length ? `${run.events.length} trace events match the Gate B record.` : `Trace has ${run.events.length} events; Gate B recorded ${recordedCount}.`;
  const judge = (): { checkpoint: string; ok: boolean; summary: string } => {
    const e5 = checkpoints.get("CP-5")?.evidence ?? {};
    const e6 = checkpoints.get("CP-6")?.evidence ?? {};
    const e7 = checkpoints.get("CP-7")?.evidence ?? {};
    switch (checkId) {
      case "FN-1":
        return { checkpoint: "CP-5", ok: e5.actualPositionRoute === "A", summary: `Exited ${e5.actualPositionRoute} by actual D1 position (${e5.routedElapsedMs} ms).` };
      case "FN-2":
        return { checkpoint: "CP-5", ok: e5.requestedRouteWithoutActuation === "runout", summary: `Requested A without D1 actuation physically reached ${e5.requestedRouteWithoutActuation} (${e5.missedElapsedMs} ms) — a misroute for the PLC to report.` };
      case "FN-3":
        return { checkpoint: "CP-6", ok: e6.routedB === "B", summary: `Exited ${e6.routedB} by actual D2 position.` };
      case "FN-4":
        return { checkpoint: "CP-6", ok: e6.unassigned === "runout", summary: `Unassigned carton reached ${e6.unassigned}.` };
      case "FR-1":
        return { checkpoint: "CP-7", ok: e7.sensorStuckSeparatedFromPhysicalTruth === true, summary: `Stuck fault separated raw from physical truth; bounce states ${JSON.stringify(e7.sensorBounceStates)}.` };
      case "FR-2":
        return { checkpoint: "CP-7", ok: e7.driveFailureHeldEncoderAt === 0 && e7.driveRecovered === true, summary: `Encoder held at ${e7.driveFailureHeldEncoderAt} without feedback; drive recovered after cleanup.` };
      case "FR-3":
        return { checkpoint: "CP-7", ok: e7.divertJamHeldHome === true && e7.divertRecovered === true, summary: "D1 held home under command while jammed; recovered after cleanup." };
      default:
        return { checkpoint: "?", ok: false, summary: "No mapping" };
    }
  };
  const verdict = judge();
  const status: CheckStatus = verdict.ok && checkpoints.get(verdict.checkpoint)?.status === "pass" ? "pass" : "fail";
  b.add(end + 150, "conclusion", `${checkId} ${status}`, { kind: "verdict", status, summary: `${verdict.checkpoint}: ${verdict.summary} ${countNote}`, evidence: checkpoints.get(verdict.checkpoint)?.evidence }, prov(P.gateBResult, "audit", "discrete", { ref: `checkpoints[${verdict.checkpoint}]` }), checkId);
  b.closeEpisode(end + 300, prov(P.gateBTrace, "surrogate_contract", "world_virtual", { ref: `runs[${index}]` }));
}

// ---------------------------------------------------------------- Gate C agentic records

function emitObservation(b: TimelineBuilder, at: number, observation: Observation, source: string, roleToSignal: Map<string, string>, outputIds: Set<string>, checkId: string, sourceAtMs: number): void {
  const provenance = prov(source, "agent_record", "world_virtual", { ref: observation.id, sourceAtMs, run: "gate-c blind", worldVersion: "0.5.0" });
  b.add(at, "agent", `${observation.id}: ${observation.note}`, { kind: "agent.observation", observationId: observation.id, note: observation.note, values: observation.values }, provenance, checkId);
  b.add(at, "system", "World sample", { kind: "world.heartbeat", tick: Math.floor(sourceAtMs / 20) }, provenance, checkId);
  const outputs: Record<string, RawValue> = {};
  for (const [role, value] of Object.entries(observation.values)) {
    const signalId = roleToSignal.get(role);
    if (!signalId) continue;
    if (outputIds.has(signalId)) outputs[signalId] = value;
    else b.add(at, "raw_input", `${signalId} = ${formatRaw(value)} (${observation.id})`, { kind: "raw.input", signalId, value, cause: `observed in ${observation.id} (blind view)` }, provenance, checkId);
  }
  if (Object.keys(outputs).length > 0) b.add(at, "plc_output", `Surrogate outputs in ${observation.id}`, { kind: "plc.output", values: outputs, origin: "surrogate_driver" }, provenance, checkId);
}

function emitModelCall(b: TimelineBuilder, at: number, call: FixtureBundle["gateC"]["modelCalls"][number], index: number, timeoutMs: number, checkId: string, repairEpisode?: string): number {
  const requestId = call.responseId ?? `gate-c-call-${index + 1}`;
  const provenance = prov(P.gateCResult, "agent_record", "recorded_wall", { ref: `modelCalls[${index}]` });
  b.add(at, "agent", `Muse request: ${call.purpose}`, { kind: "agent.request.start", requestId, purpose: call.purpose, model: call.model, reservedUsd: call.estimatedCostUsd, timeoutMs, repairEpisode }, provenance, checkId);
  const end = at + call.durationMs;
  const failed = call.status !== "completed";
  b.add(end, "agent", `Muse response ${failed ? "rejected" : "received"} after ${(call.durationMs / 1000).toFixed(1)} s`, {
    kind: "agent.request.end",
    requestId,
    status: call.status,
    failed,
    durationMs: call.durationMs,
    costUsd: call.estimatedCostUsd,
    outputTokens: call.usage?.output_tokens,
    reasoningTokens: call.usage?.output_tokens_details?.reasoning_tokens,
    totalTokens: call.usage?.total_tokens,
    note: call.auditNote ?? "Conservative reservation; exact provider billing unavailable."
  }, provenance, checkId);
  return end;
}

function composeBlindDiagnosis(b: TimelineBuilder, bundle: FixtureBundle, roleToSignal: Map<string, string>, outputIds: Set<string>, scope: Record<string, boolean>): void {
  const timeoutMs = Number(bundle.gateC.budget.limits.requestTimeoutMs);
  const calls = bundle.gateC.modelCalls;
  const commitment = bundle.gateCHiddenTruthCommitment;
  const world = { worldId: bundle.manifest.worldId, worldVersion: "0.5.0", run: "gate-c blind", blindView: true };

  // CP-8 initial blind observations.
  let t0 = b.openEpisode(
    { id: "gate-c-observe", title: "Gate C · Blind observation", checkIds: ["AI-1"], clock: "world_virtual", timeScale: 1, source: P.gateCInitialObservations },
    { kind: "episode.start", episodeId: "gate-c-observe", checkIds: ["AI-1"], title: "Gate C · Blind observation", world, connectorExpected: false, plcExpected: false, worldExpected: true, timeScale: 1, note: "Fresh filtered Muse context. Physical entities and fault truth withheld; only permitted role observations." },
    prov(P.gateCInitialObservations, "agent_record", "world_virtual", { ref: "(file)" })
  );
  b.add(t0, "fault", `Hidden fault committed (${shortHash(commitment.commitment)})`, { kind: "blind", phase: "commit", hash: commitment.commitment, detail: `${commitment.algorithm} commitment at ${commitment.committedAt}; truth withheld until seal` }, prov(P.gateCHiddenTruthCommitment, "audit", "discrete", { ref: "commitment", recordedAt: commitment.committedAt }), "AI-1");
  b.add(t0, "fault", "Sealed fault active (identity hidden)", { kind: "fault.set", faultId: "hidden", target: "sealed", active: true, detail: "Hidden committed fault — identity withheld from Muse and this view until reveal", sealed: true }, prov(P.gateCHiddenTruthCommitment, "audit", "discrete", { ref: "commitment" }), "AI-1");
  b.add(t0, "system", "Observing", { kind: "step", phase: "observing", message: "Muse sampling the stopped bench in a blind context" }, prov(P.gateCInitialObservations, "agent_record", "world_virtual"), "AI-1");
  for (const observation of bundle.gateCInitialObservations) emitObservation(b, t0 + observation.atMs, observation, P.gateCInitialObservations, roleToSignal, outputIds, "AI-1", observation.atMs);
  const lastInitial = bundle.gateCInitialObservations.at(-1)?.atMs ?? 0;
  b.closeEpisode(t0 + lastInitial + 200, prov(P.gateCInitialObservations, "agent_record", "world_virtual"));

  // First model call: assessment and Muse-authored follow-up.
  const response = bundle.gateCInitialResponse.response;
  t0 = b.openEpisode(
    { id: "gate-c-reason-1", title: "Gate C · Muse assesses ambiguous evidence", checkIds: ["AI-1"], clock: "recorded_wall", timeScale: 1, source: P.gateCResult },
    { kind: "episode.start", episodeId: "gate-c-reason-1", checkIds: ["AI-1"], title: "Gate C · Muse assesses ambiguous evidence", world, connectorExpected: false, plcExpected: false, worldExpected: false, timeScale: 1, note: "Recorded model-call duration replayed at 1×." },
    prov(P.gateCResult, "agent_record", "recorded_wall", { ref: "modelCalls[0]" })
  );
  b.add(t0, "system", "Reasoning", { kind: "step", phase: "reasoning", message: "Muse assessing three stopped-state samples where entry is blocked but nothing moves", awaiting: "model response" }, prov(P.gateCResult, "agent_record", "recorded_wall", { ref: "modelCalls[0].purpose" }), "AI-1");
  let end = emitModelCall(b, t0, calls[0]!, 0, timeoutMs, "AI-1");
  const hypotheses = response.hypotheses.map((hypothesis) => ({ label: String(hypothesis.failureMode), confidence: Number(hypothesis.confidence) }));
  b.add(end, "agent", `Assessment: confidence ${response.currentConfidence}`, { kind: "agent.assessment", text: response.assessment, confidence: response.currentConfidence, hypotheses }, prov(P.gateCInitialResponse, "agent_record", "recorded_wall", { ref: "response.assessment" }), "AI-1");
  b.add(end, "system", "Assessment received", { kind: "step", phase: "investigating", message: `Inconclusive at confidence ${response.currentConfidence}: ${hypotheses.length} competing hypotheses. Muse is authoring a bounded follow-up experiment.` }, prov(P.gateCInitialResponse, "agent_record", "recorded_wall", { ref: "response.hypotheses" }), "AI-1");
  const addFollowUp = scope["AI-1"] === true;
  if (addFollowUp) {
    const check = MUSE_ADDED_CHECKS["AI-2"]!;
    b.add(end + 300, "agent", "Muse added investigation AI-2", { kind: "plan.added", check: { id: check.id, group: check.group, title: check.title, manipulate: check.manipulate, observe: check.observe, oracle: response.followUp.objective }, reason: `Initial evidence ambiguous (confidence ${response.currentConfidence}). Covered by the Start Campaign authorization; no approval gate.` }, prov(P.gateCInitialResponse, "agent_record", "recorded_wall", { ref: "response.followUp.objective" }), "AI-2");
  }
  b.closeEpisode(end + 600, prov(P.gateCResult, "agent_record", "recorded_wall"));
  if (!addFollowUp) return;

  // CP-9 Muse-authored follow-up executed through the same world.
  const followUps = bundle.gateCFollowupObservations;
  const startAt = followUps[0]?.atMs ?? 0;
  t0 = b.openEpisode(
    { id: "gate-c-followup", title: "Gate C · Muse-authored belt-motion experiment", checkIds: ["AI-2"], clock: "world_virtual", timeScale: 1, source: P.gateCFollowupObservations },
    { kind: "episode.start", episodeId: "gate-c-followup", checkIds: ["AI-2"], title: "Gate C · Muse-authored belt-motion experiment", world, connectorExpected: false, plcExpected: false, worldExpected: true, timeScale: 1, note: "Actions authored by Muse; surrogate PLC outputs; blind view (entities withheld)." },
    prov(P.gateCFollowupObservations, "agent_record", "world_virtual", { ref: "(file)" })
  ) - startAt;
  let cursor = startAt;
  let emitted = 0;
  const actionRef = (index: number) => prov(P.gateCInitialResponse, "agent_record", "world_virtual", { ref: `response.followUp.actions[${index}]`, sourceAtMs: cursor });
  response.followUp.actions.forEach((action, index) => {
    if (action.kind === "set_plc_output") {
      const signalId = roleToSignal.get(action.role);
      b.add(t0 + cursor, "agent", `Muse sets ${signalId ?? action.role} = ${formatRaw(action.booleanValue)}`, { kind: "agent.action", action: action.kind, role: action.role, signalId, value: action.booleanValue, rationale: action.rationale }, actionRef(index), "AI-2");
      if (signalId) b.add(t0 + cursor, "plc_output", `Surrogate output ${signalId} → ${formatRaw(action.booleanValue)} (Muse-authored)`, { kind: "plc.output", values: { [signalId]: action.booleanValue }, origin: "muse_surrogate" }, actionRef(index), "AI-2");
      b.add(t0 + cursor, "system", "Applying Muse action", { kind: "step", phase: "applying_stimulus", message: `${signalId ?? action.role} → ${formatRaw(action.booleanValue)}: ${firstSentence(action.rationale, 140)}` }, actionRef(index), "AI-2");
      return;
    }
    const condition = `Muse's ${(action.durationMs / 1000).toFixed(1)} s observation window (${action.observeRoles.length} roles)`;
    b.add(t0 + cursor, "agent", `Muse waits: ${condition}`, { kind: "agent.action", action: action.kind, durationMs: action.durationMs, rationale: action.rationale }, actionRef(index), "AI-2");
    b.add(t0 + cursor, "system", condition, { kind: "wait.start", condition, timeoutMs: action.durationMs }, actionRef(index), "AI-2");
    b.add(t0 + cursor, "system", "Observing", { kind: "step", phase: "observing", message: firstSentence(action.rationale, 160), awaiting: condition }, actionRef(index), "AI-2");
    const until = cursor + action.durationMs;
    while (emitted < followUps.length && followUps[emitted]!.atMs <= until) {
      const observation = followUps[emitted]!;
      emitObservation(b, t0 + observation.atMs, observation, P.gateCFollowupObservations, roleToSignal, outputIds, "AI-2", observation.atMs);
      emitted += 1;
    }
    cursor = until;
    b.add(t0 + cursor, "system", `${condition}: completed`, { kind: "wait.end", condition, outcome: "completed" }, actionRef(index), "AI-2");
  });
  b.closeEpisode(t0 + cursor + 200, prov(P.gateCFollowupObservations, "agent_record", "world_virtual"));

  // Final sealed blind diagnosis, then truth reveal.
  const sealed = bundle.gateCSealedDiagnosis;
  const reveal = bundle.gateCTruthReveal;
  const cp8 = bundle.gateC.checkpoints.find((checkpoint) => checkpoint.id === "CP-8");
  const cp9 = bundle.gateC.checkpoints.find((checkpoint) => checkpoint.id === "CP-9");
  t0 = b.openEpisode(
    { id: "gate-c-reason-2", title: "Gate C · Sealed blind diagnosis", checkIds: ["AI-1", "AI-2"], clock: "recorded_wall", timeScale: 1, source: P.gateCSealedDiagnosis },
    { kind: "episode.start", episodeId: "gate-c-reason-2", checkIds: ["AI-1", "AI-2"], title: "Gate C · Sealed blind diagnosis", world, connectorExpected: false, plcExpected: false, worldExpected: false, timeScale: 1, note: "Recorded model-call duration replayed at 1×." },
    prov(P.gateCSealedDiagnosis, "agent_record", "recorded_wall", { ref: "(file)" })
  );
  b.add(t0, "system", "Reasoning", { kind: "step", phase: "reasoning", message: `Muse diagnosing from ${bundle.gateCInitialObservations.length + followUps.length} blind observations`, awaiting: "sealed diagnosis" }, prov(P.gateCResult, "agent_record", "recorded_wall", { ref: "modelCalls[1].purpose" }), "AI-1");
  end = emitModelCall(b, t0, calls[1]!, 1, timeoutMs, "AI-1");
  const diagnosis = (cp8?.evidence.diagnosis ?? {}) as Record<string, any>;
  b.add(end, "system", "Sealing diagnosis", { kind: "step", phase: "writing_evidence", message: `Diagnosis returned (confidence ${diagnosis.confidence}); sealing it before the committed truth is revealed`, awaiting: "seal, then truth reveal" }, prov(P.gateCSealedDiagnosis, "agent_record", "discrete", { ref: "sealedAt" }), "AI-1");
  b.add(end + 200, "conclusion", `Diagnosis sealed (${shortHash(sealed.hash)})`, { kind: "blind", phase: "seal", hash: sealed.hash, detail: `Sealed at ${sealed.sealedAt}, before truth reveal` }, prov(P.gateCSealedDiagnosis, "audit", "discrete", { ref: "hash, sealedAt", recordedAt: sealed.sealedAt }), "AI-1");
  b.add(end + 400, "agent", `Diagnosis: ${diagnosis.targetRole} (confidence ${diagnosis.confidence})`, { kind: "agent.assessment", text: String(diagnosis.explanation ?? ""), confidence: Number(diagnosis.confidence) }, prov(P.gateCSealedDiagnosis, "agent_record", "discrete", { ref: "response" }), "AI-1");
  b.add(end + 1400, "fault", "Truth revealed after seal", { kind: "blind", phase: "reveal", hash: reveal.commitment, detail: `Revealed at ${reveal.revealedAt}; commitment verified=${reveal.verified}`, truth: reveal.hiddenTruth }, prov(P.gateCTruthReveal, "audit", "discrete", { ref: "hiddenTruth", recordedAt: reveal.revealedAt }), "AI-1");
  const truth = reveal.hiddenTruth as Record<string, string>;
  const truthSignal = roleToSignal.get(truth.targetRole ?? "") ?? String(truth.targetRole);
  b.add(end + 1400, "fault", `Revealed: ${truth.failureMode} on ${truthSignal}`, { kind: "fault.set", faultId: "hidden", target: truthSignal, active: true, detail: `Revealed ${truth.faultFamily} / ${truth.failureMode} via ${truth.injectedControl}`, sealed: false }, prov(P.gateCTruthReveal, "audit", "discrete", { ref: "hiddenTruth" }), "AI-1");
  const scoring = (cp8?.evidence.scoring ?? {}) as Record<string, any>;
  const outcome = String(scoring.outcome);
  const aiStatus: CheckStatus = cp8?.status !== "pass" ? "fail" : outcome === "correct" ? "pass" : outcome === "insufficient_evidence" ? "inconclusive" : "fail";
  b.add(end + 1800, "conclusion", `AI-1 ${aiStatus}`, { kind: "verdict", status: aiStatus, summary: `Scored ${outcome}: target ${scoring.targetMatch ? "matched" : "missed"}, leading mechanism ${scoring.leadingMechanismMatch ? "matched" : "missed"}; Muse would not exclude a physically held object without physical evidence. CP-8 ${cp8?.status}.`, evidence: { scoring, evidenceRefs: cp8?.evidence.evidenceRefs } }, prov(P.gateCResult, "audit", "discrete", { ref: "checkpoints[CP-8]" }), "AI-1");
  const e9 = (cp9?.evidence ?? {}) as Record<string, any>;
  const ok9 = cp9?.status === "pass" && e9.finalConfidence > e9.initialConfidence;
  b.add(end + 2000, "conclusion", `AI-2 ${ok9 ? "pass" : "fail"}`, { kind: "verdict", status: ok9 ? "pass" : "fail", summary: `Confidence ${e9.initialConfidence} → ${e9.finalConfidence}; belt motion proven (encoder ${e9.finalEncoderCount}) while entry stayed true — discrepancy exposed.`, evidence: { initialConfidence: e9.initialConfidence, finalConfidence: e9.finalConfidence, exposedDiscrepancy: e9.exposedDiscrepancy, finalEncoderCount: e9.finalEncoderCount } }, prov(P.gateCResult, "audit", "discrete", { ref: "checkpoints[CP-9]" }), "AI-2");
  b.closeEpisode(end + 2300, prov(P.gateCSealedDiagnosis, "agent_record", "recorded_wall"));
}

function composeHotReload(b: TimelineBuilder, bundle: FixtureBundle, limits: { requestTimeoutMs: number }): void {
  const calls = bundle.gateC.modelCalls;
  const cp10 = bundle.gateC.checkpoints.find((checkpoint) => checkpoint.id === "CP-10");
  const evidence = (cp10?.evidence ?? {}) as Record<string, any>;
  const history = (evidence.history ?? []) as Array<Record<string, any>>;
  const attempts = bundle.gateCCandidateGeneration.repairAttempts;
  const pv = (ref: string, source: string = P.gateCResult) => prov(source, "agent_record", "recorded_wall", { ref });
  const t0 = b.openEpisode(
    { id: "gate-c-hot-reload", title: "Gate C · World revision, hot reload, rollback", checkIds: ["AI-3"], clock: "recorded_wall", timeScale: 1, source: P.gateCResult },
    { kind: "episode.start", episodeId: "gate-c-hot-reload", checkIds: ["AI-3"], title: "Gate C · World revision, hot reload, rollback", connectorExpected: false, plcExpected: false, worldExpected: false, timeScale: 1, note: "Recorded model-call durations replayed at 1×; incumbent world 0.5.0 continues while candidates are prepared." },
    pv("checkpoints[CP-10]")
  );
  const candidate = history[0]?.candidateVersion ?? "candidate";
  b.add(t0, "agent", `Preparing candidate ${candidate}`, { kind: "hotreload", phase: "prepare", version: candidate, detail: firstSentence(bundle.gateCCandidateGeneration.rationale, 200) }, pv("rationale", P.gateCCandidateGeneration), "AI-3");
  b.add(t0, "system", "Reasoning", { kind: "step", phase: "reasoning", message: `Muse drafting world revision ${candidate} while the incumbent runs`, awaiting: "candidate source" }, pv("modelCalls[2].purpose"), "AI-3");
  let at = emitModelCall(b, t0, calls[2]!, 2, limits.requestTimeoutMs, "AI-3");
  attempts.forEach((attempt, index) => {
    const callIndex = 3 + index;
    const call = calls[callIndex];
    if (!call) return;
    const why = attempt.diagnostic ? firstSentence(attempt.diagnostic, 240) : "Candidate failed local checks; structural repair requested.";
    b.add(at + 300, "agent", `Candidate check failed (attempt ${attempt.attempt})`, { kind: "hotreload", phase: "check", version: candidate, detail: why }, pv(`repairAttempts[${index}]`, P.gateCCandidateGeneration), "AI-3");
    b.add(at + 300, "system", "Repairing", { kind: "step", phase: "compiling", message: `Structural repair ${attempt.attempt}: ${why}`, awaiting: "repaired candidate" }, pv(`repairAttempts[${index}]`, P.gateCCandidateGeneration), "AI-3");
    at = emitModelCall(b, at + 600, call, callIndex, limits.requestTimeoutMs, "AI-3", "gate-c-hot-reload");
    if (attempt.status === "artifact_rejected") b.add(at + 100, "fault", "Repair artifact rejected", { kind: "hotreload", phase: "check", version: candidate, detail: attempt.diagnosis ?? "Returned artifact rejected before persistence" }, pv(`repairAttempts[${index}].diagnosis`, P.gateCCandidateGeneration), "AI-3");
  });
  b.add(at, "system", "Checking repaired candidate", { kind: "step", phase: "compiling", message: `Compiling and shadow-checking repaired ${candidate} against an incumbent snapshot` }, pv("checkpoints[CP-10].evidence.compiled"), "AI-3");
  at += 600;
  b.add(at, "agent", `Candidate ${candidate} compiled and passed shadow health`, { kind: "hotreload", phase: "migrate", version: candidate, detail: `State migrated; hash ${shortHash(evidence.migratedStateHash)}; source ${shortHash(evidence.candidateSourceHash)}` }, pv("checkpoints[CP-10].evidence.migratedStateHash"), "AI-3");
  b.add(at, "system", "Migrating", { kind: "step", phase: "migrating", message: `Snapshot migrated into ${candidate}; shadow health passed` }, pv("checkpoints[CP-10].evidence"), "AI-3");
  at += 900;
  b.add(at, "world", `Activated ${evidence.activatedVersion}`, { kind: "hotreload", phase: "activate", version: String(evidence.activatedVersion), detail: String(history[0]?.reason ?? "") }, pv("checkpoints[CP-10].evidence.history[0]"), "AI-3");
  const failing = history[1];
  if (failing) {
    at += 900;
    b.add(at, "agent", `Preparing ${failing.candidateVersion}`, { kind: "hotreload", phase: "prepare", version: String(failing.candidateVersion), detail: String(failing.reason) }, pv("checkpoints[CP-10].evidence.history[1]"), "AI-3");
    at += 900;
    b.add(at, "fault", `Rolled back ${failing.candidateVersion}`, { kind: "hotreload", phase: "rollback", version: String(evidence.preservedVersionAfterRollback), detail: `${failing.reason}; preserved ${evidence.preservedVersionAfterRollback}` }, pv("checkpoints[CP-10].evidence.history[1].disposition"), "AI-3");
  }
  const pass = cp10?.status === "pass" && evidence.failingCandidateDisposition === "rolled_back";
  at += 400;
  b.add(at, "conclusion", `AI-3 ${pass ? "pass" : "fail"}`, { kind: "verdict", status: pass ? "pass" : "fail", summary: `${evidence.activatedVersion} activated with preserved state; ${failing?.candidateVersion ?? "failing candidate"} ${evidence.failingCandidateDisposition}. No conveyor physics changed.`, evidence: { activatedVersion: evidence.activatedVersion, failingCandidateDisposition: evidence.failingCandidateDisposition, migratedStateHash: evidence.migratedStateHash } }, pv("checkpoints[CP-10]"), "AI-3");
  b.closeEpisode(at + 200, pv("checkpoints[CP-10]"));
}

function composeGuards(b: TimelineBuilder, bundle: FixtureBundle): void {
  const cp11 = bundle.gateC.checkpoints.find((checkpoint) => checkpoint.id === "CP-11");
  const evidence = (cp11?.evidence ?? {}) as Record<string, any>;
  const pv = (ref: string) => prov(P.gateCResult, "audit", "discrete", { ref: `checkpoints[CP-11].evidence.${ref}` });
  let t = b.openEpisode(
    { id: "gate-c-guards", title: "Gate C · Not-hung and budget guard exercise", checkIds: ["RT-5"], clock: "discrete", timeScale: 1, source: P.gateCResult },
    { kind: "episode.start", episodeId: "gate-c-guards", checkIds: ["RT-5"], title: "Gate C · Not-hung and budget guard exercise", connectorExpected: false, plcExpected: false, worldExpected: false, timeScale: 1, note: "CP-11 drove the guard with synthetic clocks. Elapsed values are the recorded guard inputs; spacing is presentation only." },
    pv("(checkpoint)")
  );
  const flag = (state: RuntimeFlagState, message: string, ref: string, elapsedMs?: number) => {
    t += 1600;
    b.add(t, state === "clear" ? "agent" : "fault", message, { kind: "runtime.flag", state, message, elapsedMs, exercise: true }, pv(ref), "RT-5");
  };
  flag("request_timed_out", `Request lease ${evidence.requestStates?.beforeTimeout} before deadline, ${evidence.requestStates?.atTimeout} at the 5:00 limit — call aborted`, "requestStates", 300_000);
  (evidence.repairFailureStates as string[] | undefined)?.forEach((state, index) => {
    const mapped = state === "warning" ? "repair_warning" : state === "hard_stop" ? "repair_hard_stop" : "repair_continue";
    flag(mapped, `Failed repair ${index + 1}/5 → ${state}`, `repairFailureStates[${index}]`);
  });
  flag("budget_stop", `Reservation refused: ${evidence.budgetStopCode} (campaign hard limit would be exceeded)`, "budgetStopCode");
  const runtime = (evidence.runtimeStates ?? {}) as Record<string, { state: string; message: string; elapsedMs: number }>;
  if (runtime.stalled) flag("world_stalled", runtime.stalled.message, "runtimeStates.stalled", runtime.stalled.elapsedMs);
  if (runtime.heldWait) flag("waiting_condition", runtime.heldWait.message, "runtimeStates.heldWait", runtime.heldWait.elapsedMs);
  if (runtime.waitTimeout) flag("condition_timeout", runtime.waitTimeout.message, "runtimeStates.waitTimeout", runtime.waitTimeout.elapsedMs);
  flag("clear", `Guard exercise complete; active world ${evidence.preservedWorldVersion} preserved`, "preservedWorldVersion");
  const pass = cp11?.status === "pass";
  t += 400;
  b.add(t, "conclusion", `RT-5 ${pass ? "pass" : "fail"}`, { kind: "verdict", status: pass ? "pass" : "fail", summary: `Timeout, repair warning/hard stop, campaign limit, stalled heartbeat, held wait, and wait timeout each distinguished. ${evidence.providerBillingNote ?? ""}`, evidence }, pv("(checkpoint)"), "RT-5");
  b.closeEpisode(t + 200, pv("(checkpoint)"));
}

function composeAudit(b: TimelineBuilder, bundle: FixtureBundle): void {
  const gateD = bundle.gateD;
  const pv = (ref: string) => prov(P.gateDResult, "audit", "discrete", { ref });
  let t = b.openEpisode(
    { id: "gate-d", title: "Gate D · Evidence package audit", checkIds: ["EV-1"], clock: "discrete", timeScale: 1, source: P.gateDResult },
    { kind: "episode.start", episodeId: "gate-d", checkIds: ["EV-1"], title: "Gate D · Evidence package audit", connectorExpected: false, plcExpected: false, worldExpected: false, timeScale: 1, note: "Deterministic audit results; spacing is presentation only." },
    pv("(file)")
  );
  b.add(t, "system", "Auditing evidence", { kind: "step", phase: "auditing", message: `Re-checking package hashes, lineage, ${gateD.evidenceSummary.traceEventCount} trace events, model-call accounting, and verdicts` }, pv("evidenceSummary"), "EV-1");
  gateD.checkpoint.checks.forEach((check, index) => {
    t += 260;
    b.add(t, check.passed ? "conclusion" : "fault", `Audit: ${check.name}`, { kind: "audit.check", name: check.name, passed: check.passed, severity: check.severity }, pv(`checkpoint.checks[${index}]`), "EV-1");
  });
  gateD.checkpoint.warnings.forEach((warning, index) => {
    t += 260;
    b.add(t, "fault", `Disclosed warning: ${warning.name}`, { kind: "audit.check", name: warning.name, passed: true, severity: "warning", warning: true }, pv(`checkpoint.warnings[${index}]`), "EV-1");
  });
  const critical = gateD.checkpoint.criticalGaps.length;
  const passed = gateD.checkpoint.checks.filter((check) => check.passed).length;
  const pass = gateD.status === "pass" && critical === 0;
  t += 400;
  b.add(t, "conclusion", `EV-1 ${pass ? "pass" : "fail"}`, { kind: "verdict", status: pass ? "pass" : "fail", summary: `${passed}/${gateD.checkpoint.checks.length} audit checks pass, ${critical} critical gaps, ${gateD.checkpoint.warnings.length} warnings disclosed. Gate D review calls ($${gateD.evidenceSummary.conservativeGateDReviewCostUsd}) were accounted separately.`, evidence: { checkCount: gateD.checkpoint.checks.length, warnings: gateD.checkpoint.warnings.map((warning) => warning.name), traceEventCount: gateD.evidenceSummary.traceEventCount } }, pv("status, checkpoint"), "EV-1");
  b.closeEpisode(t + 200, pv("(file)"));
}

function composeClosing(b: TimelineBuilder, scoped: PlanCheck[]): void {
  let t = b.cursor;
  const pv = prov("replay:composer", "audit", "discrete", { ref: "plan availability" });
  b.add(t, "system", "Writing evidence", { kind: "step", phase: "writing_evidence", message: "Finalizing run record; checks that need the live connector are recorded as not run" }, pv);
  for (const check of scoped.filter((candidate) => candidate.availability === "awaiting_live")) {
    t += 250;
    b.add(t, "conclusion", `${check.id} not run`, { kind: "verdict", status: "not_run", summary: `Not run in replay — ${check.evidenceSource}. No live connector is attached.` }, pv, check.id);
  }
  b.cursor = t + 400;
}

