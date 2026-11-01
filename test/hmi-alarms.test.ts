import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AlarmRecorder } from "../src/hmi/alarms.ts";
import { HmiJournal } from "../src/hmi/journal.ts";
import type { SampleView, SnapshotView } from "../src/hmi/protocol.ts";

let clock = Date.parse("2026-11-01T10:00:00.000Z"), seq = 0;
function snap(values: Record<string, unknown>, opts: { boot?: string; bad?: string[] } = {}): SnapshotView {
  clock += 250;
  const at = new Date(clock).toISOString();
  const base: Record<string, unknown> = { "GVL_BenchRead.PlcBootIdentity": opts.boot ?? "boot-1", "GVL_DemoRead.Status.FaultCode": 0, "GVL_DemoRead.Status.FaultText": "",
    "GVL_DemoRead.Status.ExceptionCode": 0, "GVL_DemoRead.Status.ExceptionText": "", "GVL_BenchRead.ConnectorStale": false, ...values };
  const v: Record<string, SampleView> = {};
  for (const [p, value] of Object.entries(base)) v[p] = { value: value as SampleView["value"], status: opts.bad?.includes(p) ? "BadCommunicationError" : "Good (0x00000000)", good: !opts.bad?.includes(p), sourceTimestamp: at, serverTimestamp: at, receivedAtIso: at };
  return { sequence: ++seq, requestedAtIso: at, receivedAtIso: at, latencyMs: 3, sameScanBracket: true, values: v };
}
const fault = (code: number, text = `fault ${code}`) => ({ "GVL_DemoRead.Status.FaultCode": code, "GVL_DemoRead.Status.FaultText": text });
const recorder = (historyFile?: string) => new AlarmRecorder({ journal: new HmiJournal(), serviceSessionId: "svc-test", historyFile });

test("a fault already latched when observation starts has unknown onset, never an invented one", () => {
  const r = recorder();
  r.observe(snap(fault(23, "D1 extend feedback timeout")));
  const [a] = r.active();
  assert.equal(a.code, 23); assert.equal(a.plcText, "D1 extend feedback timeout");
  assert.equal(a.firstObservedBasis, "active_at_observation_start");
  assert.equal(a.onsetAfterIso, undefined);
  assert.match(a.cause, /1200 ms/);
});

test("observed raise and clear transitions carry their HMI receipt times and onset/clear windows", () => {
  const r = recorder();
  const s0 = snap({}); r.observe(s0);
  const s1 = snap(fault(10, "Drive overload")); r.observe(s1);
  const [a] = r.active();
  assert.equal(a.firstObservedBasis, "transition_observed");
  assert.equal(a.firstObservedAtIso, s1.receivedAtIso);
  assert.equal(a.onsetAfterIso, s0.receivedAtIso);
  r.observe(snap(fault(10, "Drive overload")));
  const s3 = snap({}); r.observe(s3);
  assert.equal(r.active().length, 0);
  const [cleared] = r.query({ state: "cleared" }).alarms;
  assert.equal(cleared.clearedObservedAtIso, s3.receivedAtIso);
  assert.equal(cleared.clearBasis, "transition_observed");
  assert.equal(r.size, 1, "one continuous fault is one instance");
});

test("ConnectorStale and bad-quality samples never create machine alarms", () => {
  const r = recorder();
  r.observe(snap({ "GVL_BenchRead.ConnectorStale": true }));
  r.observe(snap({ ...fault(33) }, { bad: ["GVL_DemoRead.Status.FaultCode"] }));
  assert.equal(r.size, 0);
});

test("exceptions are recorded separately from the latched fault", () => {
  const r = recorder();
  r.observe(snap({}));
  r.observe(snap({ "GVL_DemoRead.Status.ExceptionCode": 2, "GVL_DemoRead.Status.ExceptionText": "Misroute: observed exit differs from requested route" }));
  const [x] = r.active();
  assert.equal(x.kind, "exception"); assert.equal(x.code, 2);
  assert.equal(r.query({ kind: "fault" }).total, 0);
});

test("the review marker is HMI-local: it records time and client but changes no alarm state", () => {
  const r = recorder();
  r.observe(snap(fault(23)));
  const [a] = r.active();
  const reviewed = r.review(a.id, "hmi-client-1");
  assert.equal(reviewed.state, "active");
  assert.equal(reviewed.review?.clientSessionId, "hmi-client-1");
  assert.equal(r.active().length, 1);
});

test("history persists; an HMI restart continues the same instance with an observation gap", () => {
  const dir = mkdtempSync(join(tmpdir(), "hmi-alarm-"));
  try {
    const file = join(dir, "alarm-history.jsonl");
    const first = recorder(file);
    first.observe(snap({})); first.observe(snap(fault(23)));
    const id = first.active()[0].id;
    const second = recorder(file);
    assert.equal(second.loadedFromHistory, 1);
    second.observe(snap(fault(23)));
    assert.equal(second.size, 1, "no duplicate instance after restart");
    const [a] = second.active();
    assert.equal(a.id, id);
    assert.equal(a.gaps?.length, 1);
    assert.equal(a.gaps?.[0].reason, "HMI service not running");
    const third = recorder(file);
    const s = snap({}); third.observe(s);
    const [cleared] = third.query({ state: "cleared" }).alarms;
    assert.equal(cleared.clearBasis, "observed_after_gap", "clear seen only after a gap is labelled as such");
    assert.ok(readFileSync(file, "utf8").split("\n").filter(Boolean).every(l => JSON.parse(l).type.startsWith("alarm.")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a PLC restart leaves the previous boot's alarm unresolved instead of inventing a clear", () => {
  const r = recorder();
  r.observe(snap(fault(23), { boot: "boot-1" }));
  r.bootChanged("boot-1", "boot-2", new Date(clock).toISOString());
  r.observe(snap({}, { boot: "boot-2" }));
  const [a] = r.query({ state: "unresolved" }).alarms;
  assert.equal(a.code, 23);
  assert.match(a.unresolvedReason!, /boot changed/);
  assert.equal(a.clearedObservedAtIso, undefined);
});

test("history filters by state, type, code and text", () => {
  const r = recorder();
  r.observe(snap({})); r.observe(snap(fault(10, "Drive overload"))); r.observe(snap({})); r.observe(snap(fault(23, "D1 extend feedback timeout")));
  assert.equal(r.query({ state: "active" }).total, 1);
  assert.equal(r.query({ state: "cleared" }).total, 1);
  assert.equal(r.query({ code: 10 }).alarms[0].plcText, "Drive overload");
  assert.equal(r.query({ text: "extend" }).total, 1);
});
