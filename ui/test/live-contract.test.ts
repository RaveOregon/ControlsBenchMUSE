import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveEventMapper, LiveSession, type CoordinatorCommand } from '../src/adapters/live/coordinator-source.ts';
import { ingestHmiObservation } from '../src/adapters/live/hmi-source.ts';
import { composeReplay } from '../src/adapters/replay/compose.ts';
import { ReplaySession } from '../src/adapters/replay/replay-session.ts';
import { WorkspaceStore } from '../src/model/workspace-store.ts';
import { classifyActivity } from '../src/model/activity.ts';
import { signalHealth } from '../src/model/signal-health.ts';
import { defaultScope } from '../src/model/plan.ts';
import { loadRepoFixtures } from './load-fixtures.ts';
import { SIGNALS, ev, episode } from './helpers.ts';

function live() {
  let time = 50000;
  const sent: CoordinatorCommand[] = [];
  const session = new LiveSession(new WorkspaceStore('live', SIGNALS), ['Motor_RunCmd'], () => time);
  session.attach({ send: c => sent.push(c) });
  return { session, store: session.store, sent, advance: (ms: number) => { time += ms; session.advance(); }, ack: (outcome: 'applied' | 'rejected' = 'applied') => session.acknowledge({ requestId: sent.at(-1)!.requestId, outcome }) };
}

test('the real preserved M7 trace maps every complete image, commit, ack, output, revision, cycle and latency', async () => {
  const b = await loadRepoFixtures();
  const outputs = b.manifest.signals.filter(s => s.direction === 'plc_to_world').map(s => s.id);
  const mapper = new LiveEventMapper(outputs);
  const mapped = b.m7Trace.coordinatorEvents.flatMap(record => {
    const result = mapper.coordinator(record);
    if (record.data.action === 'commit.acknowledged') {
      const d = record.data;
      const inputs = Object.fromEntries(result.filter(e => e.kind === 'raw.input').map(e => e.kind === 'raw.input' ? [e.signalId, e.value] : []));
      assert.deepEqual(inputs, d.image);
      assert.deepEqual(result.find(e => e.kind === 'plc.output')?.values, d.outputs);
      const ack = result.find(e => e.kind === 'connector.ack')!;
      assert.equal(ack.sequence, d.workstationSequence);
      assert.equal(ack.epoch, d.workstationEpoch);
      assert.equal(ack.outputCaptureCycle, d.outputCaptureCycle);
      assert.equal(ack.latencyMs, d.latencyMs);
      assert.equal(result.find(e => e.kind === 'plc.heartbeat')?.plcCycle, d.plcCycle);
      assert.match(ack.provenance.ref!, /derived from latency/);
      assert.equal(ack.provenance.recordedAt, record.atIso);
    }
    return result;
  });
  assert.equal(mapped.filter(e => e.kind === 'connector.commit').length, 88);
  assert.equal(mapped.filter(e => e.kind === 'connector.ack').length, 88);
  assert.ok(mapped.every(e => e.provenance.mode === 'live'));
  const store = new WorkspaceStore('live', b.manifest.signals);
  store.applyEvents(mapped);
  assert.deepEqual(Object.fromEntries(Object.entries(store.state.inputs).map(([id, v]) => [id, v.value])), b.qualification.m7.finalInputImage);
  assert.deepEqual(Object.fromEntries(Object.entries(store.state.outputs).map(([id, v]) => [id, v.value])), b.qualification.m7.finalOutputFrame.values);
  assert.equal(store.state.connection.appliedSequence, '88');
  assert.equal(store.state.connection.plcCycle, '44077');
  assert.equal(store.state.episode?.plcExpected, true, 'preserved trace ends before coordinator close');
  const last = b.m7Trace.coordinatorEvents.at(-1)!;
  store.applyEvents(mapper.coordinator({ ...last, sequence: last.sequence + 1, atMonotonicMs: last.atMonotonicMs + 100, data: { action: 'close', reason: 'test close' }, lane: 'lifecycle' }));
  assert.equal(store.state.episode?.plcExpected, false, 'explicit close ends health expectations');
  assert.equal(store.state.outputs.Motor_RunCmd?.quality, 'unknown', 'M7 has no OPC UA per-value status');
});

test('Start and Pause separate engineer intent from applied state; rejected Pause keeps running', () => {
  const l = live();
  assert.deepEqual(l.session.start(), { ok: true });
  assert.equal(l.store.state.phase, 'ready');
  assert.equal(l.store.state.commands[l.sent[0]!.requestId]?.outcome, 'pending');
  assert.equal(l.sent[0]?.contractVersion, 1);
  l.ack(); assert.equal(l.store.state.phase, 'running');
  l.session.pause(); assert.equal(l.store.state.phase, 'running');
  l.ack('rejected'); assert.equal(l.store.state.phase, 'running');
  assert.equal(l.store.state.commands[l.sent.at(-1)!.requestId]?.outcome, 'rejected');
  l.session.pause(); l.ack(); assert.equal(l.store.state.phase, 'paused');
});

test('Reset never zeros a displayed applied input until a connector observation confirms it', () => {
  const l = live();
  l.store.applyEvents([ev(0, { kind: 'raw.input', signalId: 'PE_Entry', value: true, cause: 'observed' }, { mode: 'live' })]);
  l.session.resetSimulation(); assert.equal(l.store.state.inputs.PE_Entry?.value, true);
  l.ack('rejected'); assert.equal(l.store.state.inputs.PE_Entry?.value, true);
  l.session.resetSimulation(); l.ack(); assert.equal(l.store.state.inputs.PE_Entry?.value, true, 'command ack is not a fabricated raw image');
});

test('suppression waits for acknowledgement and preserves prior state on timeout or transport failure', () => {
  const l = live();
  l.session.setSuppression('Motor_RunCmd', true);
  const firstId = l.sent.at(-1)!.requestId;
  assert.equal(l.store.state.suppressedOutputs.Motor_RunCmd, undefined);
  l.advance(5001);
  assert.equal(l.store.state.commands[firstId]?.outcome, 'timed_out');
  l.session.acknowledge({ requestId: firstId, outcome: 'applied' });
  assert.equal(l.store.state.suppressedOutputs.Motor_RunCmd, undefined, 'late ack cannot silently change confirmed state');
  l.session.setSuppression('Motor_RunCmd', true); l.ack();
  assert.equal(l.store.state.suppressedOutputs.Motor_RunCmd, true);
  l.session.attach({ send() { throw new Error('connection failed'); } });
  assert.equal(l.session.setSuppression('Motor_RunCmd', false).ok, false);
  assert.equal(l.store.state.suppressedOutputs.Motor_RunCmd, true);
  assert.equal(Object.values(l.store.state.commands).at(-1)?.outcome, 'rejected');
});

test('unmatched acknowledgements, duplicate acknowledgements and disconnect do not invent state', () => {
  const l = live(); l.session.start();
  l.session.acknowledge({ requestId: 'unrelated', outcome: 'applied' });
  assert.equal(l.store.state.phase, 'ready');
  assert.equal(l.session.start().ok, false, 'one pending mutation at a time');
  l.session.detach(); assert.equal(l.store.state.phase, 'ready');
  assert.equal(Object.values(l.store.state.commands)[0]?.outcome, 'rejected');
});

test('live time starts at attachment projection and advances with the same clock as source events', async () => {
  const b = await loadRepoFixtures(); const l = live();
  l.advance(12000);
  l.session.ingestCoordinatorEvents(b.m7Trace.coordinatorEvents.slice(0, 2));
  l.store.applyEvents([episode(l.session.nowMs(), { plc: true, connector: true, world: false, mode: 'live' })]);
  l.store.state.phase = 'running';
  assert.equal(classifyActivity(l.store.state, l.session.nowMs()).health.plc.tone, 'active');
  l.advance(600);
  assert.equal(classifyActivity(l.store.state, l.session.nowMs()).state, 'plc_stale');
});

test('an unchanged Good value is current when observed, while explicit bad/held/stale/unknown remain visible', () => {
  const l = live();
  const value = { value: true, atMs: 1, observedAtMs: 9900, quality: 'good' as const, freshness: 'current' as const, sourceTimestamp: 'source', serverTimestamp: 'server', workstationTimestamp: 'workstation' };
  l.store.applyEvents([episode(0, { plc: true, mode: 'live' })]);
  assert.equal(signalHealth(value, l.store.state, 10000), 'good');
  assert.equal(signalHealth({ ...value, quality: 'bad' }, l.store.state, 10000), 'bad');
  assert.equal(signalHealth({ ...value, freshness: 'held' }, l.store.state, 10000), 'held');
  assert.equal(signalHealth(value, l.store.state, 11000), 'stale');
  assert.equal(signalHealth(undefined, l.store.state, 11000), 'unknown');
  l.store.state.mode = 'replay';
  assert.equal(signalHealth(value, l.store.state, 900000), 'good', 'viewing replay does not age a recorded value');
});

test('M3–M7 result truth and M4 quality timestamps survive replay; final routing remains untested', async () => {
  const b = await loadRepoFixtures();
  const timeline = composeReplay(b, defaultScope());
  const verdicts = new Map(timeline.events.filter(e => e.kind === 'verdict').map(e => [e.checkId, e.status]));
  for (const id of ['RT-3','RT-4','NO-2','CQ-4','CQ-5','FR-5']) assert.equal(verdicts.get(id), 'pass', id);
  for (const id of ['CQ-20','CQ-50']) assert.equal(verdicts.get(id), 'fail', id);
  assert.equal(verdicts.get('FN-5'), 'not_run');
  assert.match(timeline.events.filter(e => e.kind === 'verdict').find(e => e.checkId === 'NO-2')?.observed ?? '', /88\/88 revisions/);
  const m4 = timeline.events.find(e => e.kind === 'plc.output' && e.checkId === 'CQ-4');
  assert.ok(m4?.kind === "plc.output" && m4.metadata);
  if (m4.kind !== "plc.output") throw new Error("Missing M4 output");
  const meta = Object.values(m4.metadata)[0]!;
  assert.equal(meta.quality, 'good');
  assert.ok(meta.sourceTimestamp && meta.serverTimestamp && meta.workstationTimestamp);
  const replay = new ReplaySession(b, new WorkspaceStore('replay', b.manifest.signals));
  replay.start(); replay.advance(500); replay.pause(); const t = replay.nowMs();
  replay.advance(900000); assert.equal(replay.nowMs(), t);
});

test('HMI observations require source identity, actual media, mode and timestamp; frames and actions enter their own lane', () => {
  const l = live(); const source = { id: 'capture-1', kind: 'capture' as const, label: 'External capture' };
  const action = { sourceId: 'capture-1', mode: 'live' as const, capturedAt: '2026-10-31T12:00:00Z', observation: 'action' as const, note: 'Operator pressed Start' };
  assert.throws(() => ingestHmiObservation(l.store, null, action, 0));
  assert.throws(() => ingestHmiObservation(l.store, source, { ...action, mode: 'replay' }, 0));
  assert.throws(() => ingestHmiObservation(l.store, source, { ...action, capturedAt: 'invalid' }, 0));
  assert.throws(() => ingestHmiObservation(l.store, source, { ...action, observation: 'frame' }, 0));
  ingestHmiObservation(l.store, source, action, 0);
  const e = l.store.state.timeline.at(-1)!;
  assert.equal(e.lane, 'hmi'); assert.equal(e.provenance.recordedAt, action.capturedAt);
  assert.equal(l.store.state.checks['FN-5']?.status, 'planned', 'observing HMI does not pass requirements');
});

test('a finished M7 record remains recorded PLC evidence after health expectations end', async () => {
  const b = await loadRepoFixtures();
  const scope = Object.fromEntries(Object.keys(defaultScope()).map(id => [id, id === 'NO-2']));
  const session = new ReplaySession(b, new WorkspaceStore('replay', b.manifest.signals, scope));
  session.speed = 20; session.start(); session.advance(10000);
  const state = session.store.state;
  assert.equal(state.phase, 'completed');
  assert.equal(state.episode?.plcExpected, false);
  assert.equal(state.episode?.plcIncluded, true);
  const activity = classifyActivity(state, session.nowMs());
  assert.doesNotMatch(activity.health.plc.value, /surrogate/);
  assert.doesNotMatch(activity.health.connector.value, /surrogate/);
});
