// M9 campaign envelope -> portal MuseEvent adapter.
//
// Every mapped event keeps the exact campaign event ID (`<campaignId>:<sequence>`) so evidence
// references in findings, actions and acknowledgements open the same record in the portal.
// Raw images and PLC outputs come only from the derived public evidence the ledger verified
// against its source acknowledgement; truth-lane world events feed the engineer's simulated
// world view and are never forwarded anywhere else. No requirement pass/fail is inferred.

import type { CampaignEnvelope, HostEvidenceClass } from "../../../../src/host/protocol.ts";
import type { ActivityPhase, EventLane, EvidenceClass, MuseEvent, MuseEventBody, Provenance, RawValue, SourceMode, ValueMetadata } from "../../model/events.ts";

export interface MapperOptions {
  mode: SourceMode;
  evidenceClass: HostEvidenceClass;
  /** Campaign-clock origin, epoch milliseconds. */
  originEpochMs: number;
  requestTimeoutMs: number;
  label?: string;
  diagnosisMode?: "known" | "blind";
}

type Lookup = (id: string) => CampaignEnvelope | undefined;
type Source = { sequence?: number; atIso?: string; atMonotonicMs?: number; lane?: string; data?: Record<string, unknown> };

const ACTIVITY_PHASE: Record<string, ActivityPhase> = { reasoning: "reasoning", observing: "observing", waiting_condition: "observing", decision: "investigating", initialized: "preparing" };
const isRaw = (v: unknown): v is RawValue => v === null || ["boolean", "number", "string"].includes(typeof v);
const rawRecord = (v: unknown): Record<string, RawValue> => Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).filter(([, x]) => isRaw(x))) as Record<string, RawValue>;
const text = (v: unknown, max = 400) => String(v ?? "").slice(0, max);

export class CampaignEventMapper {
  readonly options: MapperOptions;
  #reservations = new Map<string, number>();
  #experiments = new Map<string, string>();
  #connectorState?: string;
  #simulation?: boolean;
  #boot?: string;
  #tick?: number;
  #episodeOpen = false;

  constructor(options: MapperOptions) { this.options = options; }

  atMs(iso: string | undefined): number {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? t - this.options.originEpochMs : 0;
  }

  #plcClass(): EvidenceClass { return this.options.evidenceClass === "fake_connector" ? "surrogate_contract" : "plc_measurement"; }
  #worldClass(): EvidenceClass { return this.options.evidenceClass === "fake_connector" ? "surrogate_contract" : "world_model"; }

  map(env: CampaignEnvelope, lookup: Lookup): MuseEvent[] {
    const out: MuseEvent[] = [];
    const at = this.atMs(env.atIso);
    const d = env.data;
    const source = (d.sourceId ? (lookup(String(d.sourceId))?.data.source as Source | undefined) : undefined);
    const add = (lane: EventLane, evidenceClass: EvidenceClass, summary: string, body: MuseEventBody, extra: Partial<Provenance> = {}) => {
      const provenance: Provenance = { mode: this.options.mode, evidenceClass, source: `campaign:${env.campaignId}`, ref: env.id,
        clock: this.options.mode === "live" ? "live_wall" : "recorded_wall", recordedAt: env.atIso, run: env.campaignId, ...extra };
      out.push({ ...body, id: out.length ? `${env.id}#${out.length}` : env.id, atMs: at, lane, summary, provenance } as MuseEvent);
    };
    const record = (lane: EventLane, evidenceClass: EvidenceClass, summary: string) => add(lane, evidenceClass, summary, { kind: "campaign.record", type: env.type, data: d });
    // Source timing: campaign time is ingestion; the original coordinator record carries source time.
    const sourceRef = source ? { recordedAt: source.atIso, sourceAtMs: source.atMonotonicMs, ref: `${env.id}; source ${String(d.sourceId)} (coordinator #${source.sequence ?? "?"})` } : {};

    switch (env.type) {
      case "campaign.state":
        add("system", "audit", `Campaign ${text(d.state)}: ${text(d.reason)}`, { kind: "campaign.status", status: d.state as "running", reason: text(d.reason, 2000) });
        // A terminal campaign holds its image; PLC/world liveness is no longer expected or judged.
        if (["stopped", "completed", "failed"].includes(String(d.state)) && this.#episodeOpen) {
          this.#episodeOpen = false;
          add("system", "audit", "Campaign record finalized; live health expectations end", { kind: "episode.end", episodeId: env.campaignId });
        }
        break;
      case "campaign.authorized":
        record("agent", "engineer_local", `Start Campaign authorized ${(d.categories as string[] ?? []).join(", ")} (${text(d.diagnosisMode)} diagnosis), including adaptive investigations`);
        break;
      case "provenance.recorded":
        record("system", "audit", `Evidence class ${text(d.evidenceClass)} — ${text(d.claimBoundary)}`);
        break;
      case "plan.created": case "plan.updated":
        record("agent", "agent_record", `${env.type === "plan.created" ? "Plan" : "Plan updated"}: ${text(d.objective)} (${(d.experiments as unknown[] ?? []).length} experiments)`);
        break;
      case "experiment.proposed":
        this.#experiments.set(String(d.id), text(d.objective));
        record("agent", "agent_record", `Experiment proposed · ${text(d.id)} [${text(d.category)}]: ${text(d.objective)}`);
        break;
      case "experiment.started":
        add("system", "agent_record", `Experiment ${text(d.id)} running`, { kind: "step", phase: "investigating", message: `Experiment ${text(d.id)}: ${this.#experiments.get(String(d.id)) ?? ""}` });
        break;
      case "experiment.completed":
        record("conclusion", "agent_record", `Experiment ${text(d.id)} completed · ${text(d.conclusion)} (no requirement verdict)`);
        break;
      case "followup.added": {
        const e = d.experiment as { id?: string; objective?: string };
        record("agent", "agent_record", `Adaptive follow-up · ${text(e?.id)}: ${text(e?.objective)} — ${text(d.rationale)}`);
        break;
      }
      case "agent.activity":
        add("system", "agent_record", text(d.summary), { kind: "step", phase: ACTIVITY_PHASE[String(d.phase)] ?? "investigating", message: text(d.summary, 2000) });
        break;
      case "agent.request": {
        const id = String(d.requestId);
        if (d.phase === "started") {
          add("agent", "agent_record", `Muse request ${id} (${text(d.model)})`, { kind: "agent.request.start", requestId: id, purpose: text(d.experimentId), model: text(d.model), reservedUsd: this.#reservations.get(id) ?? 0, timeoutMs: this.options.requestTimeoutMs });
        } else {
          const usage = (d.usage ?? {}) as Record<string, unknown>;
          const total = Number(usage.total_tokens ?? usage.totalTokens);
          add("agent", "agent_record", `Muse request ${id} ${text(d.phase)} after ${Math.round(Number(d.elapsedMs))} ms`, { kind: "agent.request.end", requestId: id, status: text(d.phase), failed: d.phase !== "completed",
            durationMs: Number(d.elapsedMs) || 0, costUsd: 0, totalTokens: Number.isFinite(total) ? total : undefined, note: "Cost is settled by the following budget.accounted record" });
        }
        break;
      }
      case "agent.response":
        record("agent", "agent_record", `Raw model response preserved (sha256 ${text(d.responseHash, 16)}…)`);
        break;
      case "budget.accounted": {
        const id = String(d.requestId);
        if (d.phase === "reserved") this.#reservations.set(id, Number(d.costUsd) || 0); else this.#reservations.delete(id);
        const outstanding = [...this.#reservations.values()].reduce((a, b) => a + b, 0);
        add("system", "agent_record", `Budget ${text(d.phase)} $${Number(d.costUsd).toFixed(2)} (${text(d.basis)}); campaign $${Number(d.campaignUsd).toFixed(2)}`, { kind: "budget.accounted", requestId: id, phase: d.phase === "settled" ? "settled" : "reserved",
          costUsd: Number(d.costUsd) || 0, campaignUsd: Number(d.campaignUsd) || 0, sessionUsd: Number(d.sessionUsd) || 0, outstandingReservedUsd: outstanding, basis: text(d.basis) });
        break;
      }
      case "budget.warning":
        record("system", "agent_record", `Budget warning: ${text(d.message)}`);
        break;
      case "budget.hard_stop":
        add("system", "agent_record", `Budget hard stop: ${text(d.message)}`, { kind: "runtime.flag", state: "budget_stop", message: `Budget hard stop — ${text(d.message)}`, exercise: false });
        break;
      case "action.requested":
        add("agent", "agent_record", `Muse requested ${text(d.name)} · ${text(d.actionId)}`, { kind: "agent.action", action: text(d.name), rationale: `${text(d.actionId)} on revision ${text(d.basedOnRevision)} · ${JSON.stringify(d.arguments ?? {}).slice(0, 600)}` });
        break;
      case "action.applied": case "action.rejected": case "action.timed_out": case "action.stale": case "action.inconclusive":
        add("agent", "agent_record", `${text(d.actionId)} ${text(d.status)}: ${text(d.message)}`, { kind: "campaign.action", actionId: text(d.actionId), status: text(d.status), message: text(d.message, 2000), evidenceRefs: (d.evidenceRefs as string[] ?? []).map(String) });
        break;
      case "connector.state": {
        const state = String(d.state);
        if (state !== this.#connectorState) {
          this.#connectorState = state;
          if (state === "passthrough") {
            this.#simulation = false;
            add("system", this.#plcClass(), `Hardware passthrough observed: ${text(d.reason)}`, { kind: "simulation.state", applied: false, detail: text(d.reason) });
          } else {
            add("system", this.#plcClass(), `Connector ${state}: ${text(d.reason)}`, { kind: "connector.link", state: state === "fresh" ? "up" : "lost", detail: `${state}: ${text(d.reason, 1000)}` });
            // M9 marks evidence fresh only when the PLC reports SimulationApplied.
            if (state === "fresh" && this.#simulation !== true) { this.#simulation = true; add("system", this.#plcClass(), "SimulationApplied observed", { kind: "simulation.state", applied: true, detail: "Connector observation reported simulation active under stable boot" }); }
          }
        }
        break;
      }
      case "coordinator.event": {
        const s = d.source as Source;
        const sd = s?.data ?? {};
        const ref = { recordedAt: s?.atIso, sourceAtMs: s?.atMonotonicMs, ref: `${env.id}; ${text(d.origin)} coordinator #${s?.sequence ?? "?"}` };
        if (sd.action === "connector.open" && !this.#episodeOpen) {
          this.#episodeOpen = true;
          add("system", this.#plcClass(), "Campaign connector session", { kind: "episode.start", episodeId: env.campaignId, title: this.options.label ?? "Hosted M9 campaign", checkIds: [],
            world: { worldId: "conveyor", worldVersion: "0.5.0", run: env.campaignId }, connectorExpected: true, plcExpected: true, worldExpected: true, timeScale: 1,
            note: `Evidence class ${this.options.evidenceClass}` }, ref);
        }
        const observation = sd.observation as { bootIdentity?: string; plcCycle?: string } | undefined;
        if (observation?.bootIdentity && observation.bootIdentity !== this.#boot) {
          add("plc_ack", this.#plcClass(), `PLC boot identity ${observation.bootIdentity}`, { kind: "plc.identity", bootIdentity: observation.bootIdentity, previousBootIdentity: this.#boot }, ref);
          this.#boot = observation.bootIdentity;
        }
        if (s?.lane === "world" && sd.action === "tick") {
          const tick = Number((sd.tick as { tick?: number } | undefined)?.tick ?? sd.tick);
          if (Number.isFinite(tick)) add("world", this.#worldClass(), `World tick ${tick}`, { kind: "world.heartbeat", tick }, ref);
        }
        if (sd.action === "close") {
          this.#episodeOpen = false;
          add("system", this.#plcClass(), "Connector closed", { kind: "connector.link", state: "closed", detail: text(sd.reason) }, ref);
          add("system", this.#plcClass(), "Coordinator closed", { kind: "episode.end", episodeId: env.campaignId }, ref);
        }
        break;
      }
      case "world.raw_image": {
        const image = rawRecord(d.image);
        const sd = source?.data ?? {};
        // Simulated raw values come from the validated acknowledged complete image, not OPC quality.
        const meta: ValueMetadata = { quality: "good", freshness: "current", workstationTimestamp: source?.atIso };
        for (const [signalId, value] of Object.entries(image)) add("raw_input", this.#worldClass(), `${signalId} = ${String(value)}`, { kind: "raw.input", signalId, value, cause: `complete image seq ${text(d.sequence)} (${String(d.sourceId)})`, metadata: meta }, sourceRef);
        add("raw_input", this.#worldClass(), `Commit seq ${text(d.sequence)} → slot ${text(sd.slot)}`, { kind: "connector.commit", epoch: text(d.epoch), sequence: text(d.sequence), slot: Number.isInteger(sd.slot) ? Number(sd.slot) : null }, sourceRef);
        break;
      }
      case "plc.acknowledged": {
        const sd = source?.data ?? {};
        if (d.bootIdentity && d.bootIdentity !== this.#boot) {
          add("plc_ack", this.#plcClass(), `PLC boot identity ${text(d.bootIdentity)}`, { kind: "plc.identity", bootIdentity: text(d.bootIdentity), previousBootIdentity: this.#boot }, sourceRef);
          this.#boot = String(d.bootIdentity);
        }
        add("plc_ack", this.#plcClass(), `PLC applied seq ${text(d.sequence)} in ${Number(d.latencyMs).toFixed(1)} ms`, { kind: "connector.ack", epoch: text(d.epoch), sequence: text(d.sequence),
          slot: Number.isInteger(sd.slot) ? Number(sd.slot) : null, latencyMs: Number.isFinite(Number(d.latencyMs)) ? Number(d.latencyMs) : null, outputCaptureCycle: text(d.outputCaptureCycle) }, sourceRef);
        add("system", this.#plcClass(), `PLC cycle ${text(d.plcCycle)}`, { kind: "plc.heartbeat", plcCycle: text(d.plcCycle) }, sourceRef);
        break;
      }
      case "plc.output": {
        const values = rawRecord(d.values);
        const quality = source?.data?.outputQuality as Record<string, string> | undefined;
        const metadata = Object.fromEntries(Object.keys(values).map(id => [id, { quality: quality?.[id] === "good" ? "good" : quality?.[id] === "bad" ? "bad" : "unknown", freshness: "current", workstationTimestamp: source?.atIso } satisfies ValueMetadata]));
        add("plc_output", this.#plcClass(), `PLC outputs @ cycle ${text(d.outputCaptureCycle)}`, { kind: "plc.output", values, origin: this.options.evidenceClass === "fake_connector" ? "surrogate_driver" : "plc", metadata }, sourceRef);
        break;
      }
      case "world.stimulus": {
        const control = (d.control ?? {}) as { id?: string; payload?: Record<string, unknown>; cause?: string };
        add("world", this.#worldClass(), `World control ${text(control.id)} (${text(d.actionId)})`, { kind: "world.control", controlId: text(control.id), payload: control.payload ?? {}, cause: text(d.actionId) });
        break;
      }
      case "world.evidence": {
        const s = d.source as { lane?: string; tick?: number; atMs?: number; data?: Record<string, unknown> } | undefined;
        const sd = s?.data ?? {};
        const ref = { sourceAtMs: s?.atMs, ref: `${env.id}; world ${s?.lane ?? "?"} record (truth lane, engineer view only)` };
        if (typeof s?.tick === "number" && s.tick !== this.#tick) { this.#tick = s.tick; add("world", this.#worldClass(), `World tick ${s.tick}`, { kind: "world.heartbeat", tick: s.tick }, ref); }
        if (s?.lane === "entity") {
          if (sd.action === "publish") {
            const snapshot = sd.snapshot as { id: string; type: string; state: Record<string, unknown> };
            add("system", this.#worldClass(), `${snapshot.id} world projection`, { kind: "entity.publish", entityId: snapshot.id, entityType: snapshot.type, state: snapshot.state }, ref);
          } else add("world", this.#worldClass(), `${text(sd.entityId)} removed: ${text(sd.reason)}`, { kind: "entity.remove", entityId: text(sd.entityId), reason: text(sd.reason) }, ref);
        } else if (s?.lane === "evidence") {
          const e = (sd.event ?? {}) as { type?: string; summary?: string; data?: Record<string, unknown> };
          add(String(e.type).startsWith("fault.") ? "fault" : "world", this.#worldClass(), text(e.summary ?? e.type), { kind: "world.evidence", type: text(e.type), data: e.data }, ref);
        } else if (s?.lane === "activity") {
          const u = (sd.update ?? {}) as { message?: string };
          add("system", this.#worldClass(), text(u.message), { kind: "step", phase: "observing", message: text(u.message, 2000) }, ref);
        }
        break;
      }
      case "world.branch":
        record("world", this.#worldClass(), `Branch checkpoint "${text(d.label)}" preserved (no live world replacement)`);
        break;
      case "simulation.reset":
        record("raw_input", this.#worldClass(), "Simulation reset: complete zero raw image acknowledged; simulation remains selected and held");
        break;
      case "simulation.exited":
        this.#simulation = false;
        add("system", this.#plcClass(), `Exit Simulation: ${text(d.reason)}`, { kind: "simulation.state", applied: false, detail: text(d.reason) });
        break;
      case "hmi.action":
        add("hmi", "agent_record", `Muse requested HMI action "${text(d.action)}"`, { kind: "hmi.observation", observation: "action", sourceId: "campaign-hmi", capturedAt: text(d.atIso), reference: text(d.reference),
          origin: "muse_tool", note: `Muse HMI action "${text(d.action)}" · ${text(d.reference)}. Delivery/visible result/PLC effect are separate evidence.` }, { recordedAt: text(d.atIso) });
        break;
      case "hmi.evidence": {
        const reference = text(d.reference, 500);
        const frame = /^hmi-frame:([^:]+):(\d+)$/.exec(reference);
        // Pixels observed from the configured HMI page, whatever the campaign's connector class.
        add("hmi", "plc_measurement", `HMI ${text(d.kind)} captured (${reference})`, { kind: "hmi.observation", observation: d.kind === "clip" ? "clip" : "frame", sourceId: "campaign-hmi",
          capturedAt: text(d.atIso), reference, origin: "muse_tool", mediaUrl: frame ? `/api/hmi/frames/${encodeURIComponent(frame[1]!)}/${frame[2]}` : undefined,
          note: `Captured for ${text(d.actionId)}; pixels are the observed WebVisu, not PLC state.` }, { recordedAt: text(d.atIso) });
        break;
      }
      case "observation":
        add("agent", "agent_record", `Observation: ${text(d.summary)}`, { kind: "agent.observation", observationId: env.id, note: `${text(d.summary, 2000)} · evidence ${(d.evidenceRefs as string[] ?? []).join(", ")}`, values: {} });
        break;
      case "discrepancy":
        add("fault", "agent_record", `Discrepancy: ${text(d.summary)}`, { kind: "agent.observation", observationId: env.id, note: `Discrepancy: ${text(d.summary, 2000)}; expected ${JSON.stringify(d.expected)}`, values: rawRecord(d.observed) });
        break;
      case "finding.created": {
        const claims = ((d.claims ?? []) as Array<{ evidenceId: string; signal: string; equals: unknown }>).map(c => ({ evidenceId: String(c.evidenceId), signal: String(c.signal), equals: isRaw(c.equals) ? c.equals : null }));
        add("conclusion", "agent_record", `Finding · ${text(d.title)}`, { kind: "campaign.finding", findingId: text(d.id), title: text(d.title), experimentId: text(d.experimentId), claims, inference: text(d.inference, 2000), uncertainty: text(d.uncertainty, 2000) });
        break;
      }
      case "finding.accepted": case "finding.rerun_requested":
        add("conclusion", "engineer_local", `${env.type === "finding.accepted" ? "Engineer accepted" : "Engineer requested rerun of"} ${text(d.id)}`, { kind: "finding.review", findingId: text(d.id), action: env.type === "finding.accepted" ? "accepted" : "follow_up", note: text(d.reason, 2000) });
        break;
      case "fault.committed":
        add("fault", "audit", `Fault truth committed ${text(d.commitment, 16)}…`, { kind: "blind", phase: "commit", hash: text(d.commitment), detail: "Hidden truth committed before execution" });
        break;
      case "fault.truth": {
        const truth = (d.truth ?? {}) as Record<string, unknown>;
        add("fault", this.#worldClass(), `Injected fault ${text(truth.controlId)} (truth lane)`, { kind: "fault.set", faultId: env.id, target: text(truth.controlId), active: true, detail: JSON.stringify(truth.parameters ?? {}).slice(0, 400), sealed: this.options.diagnosisMode === "blind" });
        break;
      }
      case "report.finalized":
        record("conclusion", "audit", `Report finalized through sequence ${text(d.throughSequence)}: ${text(d.summary)}`);
        break;
      default:
        // Additive v1 types (e.g. M10 `controller.action`) stay visible without a portal change.
        record("system", this.options.evidenceClass === "fake_connector" ? "surrogate_contract" : "plc_measurement", `${env.type}${d.action ? ` · ${text(d.action)}` : ""}`);
    }
    return out;
  }
}
