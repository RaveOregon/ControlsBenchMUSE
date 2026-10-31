// V1 explicitly maps the flattened runtime record; no runtime changes required.
import type { CommitReceipt, ConnectorObservation } from '../../../../src/live/connector.ts';
import type { MuseEvent, MuseEventBody, EventLane, RawValue, ValueMetadata, EngineerCommand } from '../../model/events.ts';
import type { CommandResult, WorkspaceStore } from '../../model/workspace-store.ts';
import { formatMs, formatRaw } from '../../model/format.ts';
import type { CampaignSource } from '../source.ts';

export const LIVE_CONTRACT_VERSION = 1;
export interface CoordinatorEventLike { sequence: number; atIso: string; atMonotonicMs: number; lane: 'lifecycle' | 'control' | 'connector' | 'world'; data: Record<string, unknown> }
export type ConnectorObservationLike = ConnectorObservation & { metadata?: Record<string, ValueMetadata> };
export type CommitReceiptLike = CommitReceipt & { metadata?: Record<string, ValueMetadata> };
export interface CoordinatorCommand { contractVersion: 1; requestId: string; type: string; payload?: Record<string, unknown> }
export interface CoordinatorTransport { send(command: CoordinatorCommand): void }
export interface CommandAcknowledgement { requestId: string; outcome: 'applied' | 'rejected'; detail?: string }

export class LiveEventMapper {
  readonly #outputIds: Set<string>;
  #origin: number | null = null;
  #sequence = 0;
  #bootIdentity: string | undefined;
  #linkStale: boolean | undefined;
  #simulationApplied: boolean | undefined;
  readonly #initialNow: () => number;
  constructor(outputIds: Iterable<string>, initialNow = () => 0) {
    this.#outputIds = new Set(outputIds);
    this.#initialNow = initialNow;
  }
  #at(ms: number): number {
    if (this.#origin === null) this.#origin = ms - this.#initialNow();
    return ms - this.#origin;
  }
  #event(ms: number, lane: EventLane, summary: string, body: MuseEventBody, ref: string, recordedAt?: string): MuseEvent {
    return { ...body, id: `live-${++this.#sequence}`, atMs: this.#at(ms), lane, summary,
      provenance: { mode: 'live', evidenceClass: lane === 'world' || lane === 'raw_input' ? 'world_model' : 'plc_measurement', source: 'live:coordinator', clock: 'live_wall', ref, recordedAt, sourceAtMs: ms } } as MuseEvent;
  }
  observation(o: ConnectorObservationLike, ref = 'observation', stateKnown = true): MuseEvent[] {
    const ev = (lane: EventLane, summary: string, body: MuseEventBody) => this.#event(o.observedAtMonotonicMs, lane, summary, body, ref, o.observedAtIso);
    const events: MuseEvent[] = [];
    if (o.bootIdentity !== this.#bootIdentity) {
      events.push(ev('plc_ack', `PLC boot identity ${o.bootIdentity}`, { kind: 'plc.identity', bootIdentity: o.bootIdentity, previousBootIdentity: this.#bootIdentity }));
      this.#bootIdentity = o.bootIdentity;
    }
    events.push(ev('system', `PLC cycle ${o.plcCycle}`, { kind: 'plc.heartbeat', plcCycle: o.plcCycle }));
    if (stateKnown && o.simulationApplied !== this.#simulationApplied) events.push(ev('system', `SimulationApplied = ${o.simulationApplied}`, { kind: 'simulation.state', applied: o.simulationApplied, detail: 'Reported by the PLC interceptor' }));
    if (stateKnown) this.#simulationApplied = o.simulationApplied;
    if (stateKnown && o.connectorStale !== this.#linkStale) events.push(ev('system', o.connectorStale ? 'PLC reports BenchLinkStale' : 'Bench link fresh', { kind: 'connector.link', state: o.connectorStale ? 'lost' : 'up', detail: o.connectorStale ? 'Last simulated image held' : 'Confirmed PLC observation' }));
    if (stateKnown) this.#linkStale = o.connectorStale;
    const outputs = Object.fromEntries(Object.entries(o.values).filter(([id]) => this.#outputIds.has(id)));
    const metadata = Object.fromEntries(Object.keys(outputs).map(id => [id, { quality: 'unknown', freshness: o.connectorStale ? 'held' : 'current', workstationTimestamp: o.observedAtIso, ...o.metadata?.[id] } satisfies ValueMetadata]));
    if (Object.keys(outputs).length) events.push(ev('plc_output', `PLC outputs @ cycle ${o.outputCaptureCycle}`, { kind: 'plc.output', values: outputs, origin: 'plc', metadata }));
    return events;
  }
  receipt(r: CommitReceiptLike, ref = 'receipt', stateKnown = true): MuseEvent[] {
    const events: MuseEvent[] = Object.entries(r.image).map(([signalId, value]) => this.#event(r.sentAtMonotonicMs, 'raw_input', `${signalId} = ${formatRaw(value)}`, { kind: 'raw.input', signalId, value, cause: `complete image seq ${r.workstationSequence}`, metadata: { quality: 'unknown', freshness: 'current', workstationTimestamp: r.sentAtIso || undefined, ...r.metadata?.[signalId] } }, ref, r.sentAtIso || undefined));
    events.push(this.#event(r.sentAtMonotonicMs, 'raw_input', `Commit seq ${r.workstationSequence} → slot ${r.slot}`, { kind: 'connector.commit', epoch: r.workstationEpoch, sequence: r.workstationSequence, slot: r.slot }, ref, r.sentAtIso || undefined));
    events.push(this.#event(r.acknowledgedAtMonotonicMs, 'plc_ack', `PLC applied seq ${r.appliedSequence} in ${formatMs(r.latencyMs)}`, { kind: 'connector.ack', epoch: r.appliedEpoch, sequence: r.appliedSequence, slot: r.slot, latencyMs: r.latencyMs, outputCaptureCycle: r.outputCaptureCycle }, ref, r.acknowledgedAtIso));
    return [...events, ...this.observation({ ...r, observedAtMonotonicMs: r.acknowledgedAtMonotonicMs, observedAtIso: r.acknowledgedAtIso }, ref, stateKnown)];
  }
  coordinator(event: CoordinatorEventLike): MuseEvent[] {
    const ref = `coordinator event #${event.sequence}`;
    const d = event.data;
    this.#at(event.atMonotonicMs);
    if (d.action === 'commit.acknowledged') {
      for (const key of ['workstationEpoch', 'workstationSequence', 'bootIdentity', 'plcCycle', 'outputCaptureCycle', 'image', 'outputs', 'slot', 'latencyMs']) if (d[key] === undefined) throw new Error(`Invalid coordinator V1 commit: missing ${key}`);
      const latencyMs = Number(d.latencyMs);
      if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new Error('Invalid coordinator latency');
      // V1 preserves acknowledgement time + latency. The action guarantees the
      // applied revision. Send timing is derived; source/server quality is absent.
      return this.receipt({
        workstationEpoch: String(d.workstationEpoch), workstationSequence: String(d.workstationSequence),
        appliedEpoch: String(d.workstationEpoch), appliedSequence: String(d.workstationSequence),
        bootIdentity: String(d.bootIdentity), plcCycle: String(d.plcCycle), outputCaptureCycle: String(d.outputCaptureCycle),
        plcTimeUs: '', outputCaptureTimeUs: '', slot: Number(d.slot), latencyMs,
        image: d.image as Record<string, RawValue>, values: d.outputs as Record<string, RawValue>,
        sentAtMonotonicMs: event.atMonotonicMs - latencyMs, sentAtIso: '',
        acknowledgedAtMonotonicMs: event.atMonotonicMs, acknowledgedAtIso: event.atIso,
        observedAtMonotonicMs: event.atMonotonicMs, observedAtIso: event.atIso,
        connectorStale: false, simulationApplied: true
      }, `${ref}; V1 send time derived from latency; source/server timestamps and quality unavailable`, false);
    }
    if (d.receipt) return this.receipt(d.receipt as CommitReceiptLike, ref);
    const events: MuseEvent[] = [];
    if (d.action === 'connector.open' || (event.lane === 'world' && d.action === 'initialize')) events.push(this.#event(event.atMonotonicMs, 'system', 'Live coordinator session', { kind: 'episode.start', episodeId: 'live-session', title: 'Live world / PLC session', checkIds: [], connectorExpected: true, plcExpected: true, worldExpected: d.action === 'initialize', timeScale: 1 }, ref, event.atIso));
    if (event.lane === 'world' && d.action === 'initialize') events.push(this.#event(event.atMonotonicMs, 'system', 'World initialized', { kind: 'campaign.state', phase: 'running', detail: 'Coordinator initialized world' }, ref, event.atIso));
    if (d.observation) events.push(...this.observation(d.observation as ConnectorObservationLike, ref));
    if (event.lane === 'control') {
      const c = (d.control ?? d) as { id?: string; payload?: Record<string, unknown>; cause?: string };
      events.push(this.#event(event.atMonotonicMs, 'world', c.id ?? 'control', { kind: 'world.control', controlId: c.id ?? 'control', payload: c.payload ?? {}, cause: c.cause ?? '' }, ref, event.atIso));
    } else if (event.lane === 'world' && d.action === 'tick') events.push(this.#event(event.atMonotonicMs, 'world', 'World tick', { kind: 'world.heartbeat', tick: Number((d.tick as { tick: number }).tick) }, ref, event.atIso));
    else if (d.action === 'close') {
      events.push(this.#event(event.atMonotonicMs, 'system', 'Coordinator completed', { kind: 'campaign.state', phase: 'completed', detail: String(d.reason ?? 'closed') }, ref, event.atIso));
      events.push(this.#event(event.atMonotonicMs, 'system', 'Coordinator closed', { kind: 'episode.end', episodeId: 'live-session' }, ref, event.atIso));
      events.push(this.#event(event.atMonotonicMs, 'system', 'Connector closed', { kind: 'connector.link', state: 'closed', detail: String(d.reason ?? 'closed') }, ref, event.atIso));
    } else if (!d.observation) events.push(this.#event(event.atMonotonicMs, 'world', String(d.action ?? d.type ?? 'world event'), { kind: 'world.evidence', type: String(d.action ?? d.type ?? 'world'), data: d }, ref, event.atIso));
    return events;
  }
}

export class LiveSession implements CampaignSource {
  readonly mode = 'live' as const;
  readonly label = 'Live coordinator';
  readonly store: WorkspaceStore;
  readonly mapper: LiveEventMapper;
  transport: CoordinatorTransport | null = null;
  #clockMs = 0;
  #wallAnchor: number;
  #clock: () => number;
  #request = 0;
  #prefix = crypto.randomUUID();
  constructor(store: WorkspaceStore, outputIds: Iterable<string>, clock = () => performance.now()) {
    this.store = store; this.#clock = clock; this.#wallAnchor = clock();
    this.mapper = new LiveEventMapper(outputIds, () => this.nowMs());
  }
  get unavailableReason(): string | undefined { return this.transport ? undefined : 'No live coordinator is attached. Nothing in this view is live until one is.'; }
  attach(transport: CoordinatorTransport): void { this.transport = transport; }
  detach(): void {
    for (const c of Object.values(this.store.state.commands)) if (c.outcome === 'pending') this.acknowledge({ requestId: c.requestId, outcome: 'rejected', detail: 'Transport disconnected' });
    this.transport = null;
  }
  ingestCoordinatorEvents(events: readonly CoordinatorEventLike[]): void {
    const mapped = events.flatMap(event => this.mapper.coordinator(event)).sort((a, b) => a.atMs - b.atMs);
    this.#clockMs = Math.max(this.nowMs(), ...mapped.map(event => event.atMs)); this.#wallAnchor = this.#clock();
    this.store.applyEvents(mapped);
  }
  nowMs(): number { return this.#clockMs + Math.max(0, this.#clock() - this.#wallAnchor); }
  advance(): void {
    for (const c of Object.values(this.store.state.commands)) if (c.outcome === 'pending' && this.nowMs() >= c.deadlineMs) this.#outcome(c.requestId, 'timed_out', 'No application acknowledgement before deadline; applied state is unknown. Inspect before retrying.');
  }
  #outcome(requestId: string, outcome: 'applied' | 'rejected' | 'timed_out', detail?: string): void {
    const c = this.store.state.commands[requestId];
    if (!c || c.outcome !== 'pending') return;
    this.store.applyEvents([{ ...c, kind: 'command.outcome', outcome, detail, id: `${requestId}-${outcome}`, atMs: this.nowMs(), lane: 'system', summary: `${c.command} ${outcome}${detail ? `: ${detail}` : ''}`, provenance: { mode: 'live', evidenceClass: 'engineer_local', source: 'live:transport', clock: 'live_wall' } }]);
  }
  acknowledge(ack: CommandAcknowledgement): void { this.advance(); this.#outcome(ack.requestId, ack.outcome, ack.detail); }
  #forward(type: string, command?: EngineerCommand, payload?: Record<string, unknown>): CommandResult {
    if (!this.transport) return { ok: false, reason: this.unavailableReason! };
    if (Object.values(this.store.state.commands).some(c => c.outcome === 'pending')) return { ok: false, reason: 'Awaiting application acknowledgement of the pending command.' };
    if (command) { const allowed = this.store.can(command); if (!allowed.ok) return allowed; }
    const requestId = `${this.#prefix}-${++this.#request}`; const now = this.nowMs();
    this.store.applyEvents([{ kind: 'command.outcome', requestId, command: type, payload, outcome: 'pending', deadlineMs: now + 5000, id: `${requestId}-pending`, atMs: now, lane: 'system', summary: `${type} pending application acknowledgement`, provenance: { mode: 'live', evidenceClass: 'engineer_local', source: 'workspace', clock: 'live_wall' } }]);
    try {
      const sending = this.transport.send({ contractVersion: LIVE_CONTRACT_VERSION, requestId, type, payload });
      void Promise.resolve(sending).catch(e => this.#outcome(requestId, "rejected", String(e)));
    }
    catch (e) { this.#outcome(requestId, 'rejected', String(e)); return { ok: false, reason: String(e) }; }
    return { ok: true };
  }
  start(): CommandResult { return this.#forward('start', 'start', { scope: { ...this.store.state.scope } }); }
  pause(): CommandResult { return this.#forward('pause', 'pause'); }
  resume(): CommandResult { return this.#forward('resume', 'resume'); }
  stop(): CommandResult { return this.#forward('stop', 'stop'); }
  resetSimulation(): CommandResult { return this.#forward('reset_simulation', 'reset_simulation'); }
  exitSimulation(): CommandResult { return this.#forward('exit_simulation', 'exit_simulation'); }
  enterSimulation(): CommandResult { return this.#forward('enter_simulation', 'enter_simulation'); }
  setSuppression(outputId: string, suppressed: boolean): CommandResult {
    if (!this.store.state.signals.some(s => s.id === outputId && s.direction === 'plc_to_world')) return { ok: false, reason: 'Unknown PLC output' };
    return this.#forward('set_output_suppression', undefined, { outputId, suppressed });
  }
  steer(text: string): CommandResult { return text.trim() ? this.#forward('steer', undefined, { text: text.trim() }) : { ok: false, reason: 'Write a direction for Muse first.' }; }
}
