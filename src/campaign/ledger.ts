import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";
import { CAMPAIGN_VERSION, campaignEventSchema, eventSchemas, validate } from "./contracts.ts";
import type { CampaignEvent, CampaignStatus, EventType, Experiment, Finding, Provenance } from "./contracts.ts";

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
export const digest = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

export interface CampaignProjection {
  campaignId: string; sequence: number; status: CampaignStatus; revision: number;
  provenance?: Provenance; evidenceClass?: string; claimBoundary?: string;
  plan?: { objective: string; experiments: Experiment[] };
  experiments: Record<string, Experiment & { status: "proposed" | "running" | "completed"; conclusion?: string; evidenceRefs?: string[] }>;
  actions: Record<string, { name: string; status: string; evidenceRefs: string[]; message?: string }>;
  findings: Record<string, Finding & { review: "unreviewed" | "accepted" | "rerun_requested" }>;
  activeExperiment?: string; connector?: Record<string, unknown>;
  rawImage: Record<string, unknown>; outputs: Record<string, unknown>;
  budget: { campaignUsd: number; sessionUsd: number; checks: Record<string, number>; repairs: Record<string, number>; requests: Record<string, unknown> };
  activity?: Record<string, unknown>; report?: Record<string, unknown>;
}
export function emptyProjection(campaignId: string): CampaignProjection {
  return { campaignId, sequence: 0, status: "preparing", revision: 0, experiments: {}, actions: {}, findings: {}, rawImage: {}, outputs: {},
    budget: { campaignUsd: 0, sessionUsd: 0, checks: {}, repairs: {}, requests: {} } };
}
function safeId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,150}$/.test(id) || ["constructor", "prototype", "__proto__"].includes(id)) throw new Error(`Invalid identifier ${id}`);
}
export function reduceEvent(previous: CampaignProjection, event: CampaignEvent): CampaignProjection {
  const s = structuredClone(previous), d = event.data;
  s.sequence = event.sequence;
  switch (event.type) {
    case "campaign.state": {
      const transitions: Record<CampaignStatus, readonly CampaignStatus[]> = {
        preparing: ["preparing", "running", "stopped", "failed"], running: ["paused", "stopped", "completed", "failed"],
        paused: ["running", "stopped", "failed"], stopped: [], completed: [], failed: []
      };
      if (!transitions[s.status].includes(d.state as CampaignStatus)) throw new Error(`Invalid lifecycle transition ${s.status} -> ${d.state}`);
      s.status = d.state as CampaignStatus; s.revision++; break;
    }
    case "provenance.recorded":
      if (s.provenance) throw new Error("Campaign provenance is immutable");
      s.provenance = d.provenance as unknown as Provenance; s.evidenceClass = String(d.evidenceClass); s.claimBoundary = String(d.claimBoundary); break;
    case "plan.created": case "plan.updated":
      s.plan = d as unknown as CampaignProjection["plan"]; s.revision++; break;
    case "experiment.proposed": {
      const e = d as unknown as Experiment; safeId(e.id);
      if (Object.hasOwn(s.experiments, e.id)) throw new Error(`Duplicate experiment ${e.id}`);
      s.experiments[e.id] = { ...e, status: "proposed" }; s.revision++; break;
    }
    case "experiment.started": {
      const id = String(d.id);
      if (s.activeExperiment || s.experiments[id]?.status !== "proposed") throw new Error("Experiment cannot start");
      s.experiments[id].status = "running"; s.activeExperiment = id; s.revision++; break;
    }
    case "experiment.completed": {
      const id = String(d.id);
      if (s.activeExperiment !== id) throw new Error("Experiment is not active");
      Object.assign(s.experiments[id], { status: "completed", conclusion: d.conclusion, evidenceRefs: d.evidenceRefs });
      delete s.activeExperiment; s.revision++; break;
    }
    case "action.requested": {
      const id = String(d.actionId); safeId(id);
      if (Object.hasOwn(s.actions, id)) throw new Error(`Action ${id} already journaled; inspect instead of retrying`);
      s.actions[id] = { name: String(d.name), status: "requested", evidenceRefs: [] }; break;
    }
    case "action.applied": case "action.rejected": case "action.stale": case "action.timed_out": case "action.inconclusive": {
      const a = s.actions[String(d.actionId)];
      if (!a || a.status !== "requested" || event.type !== `action.${d.status}`) throw new Error("Unpaired action outcome");
      a.status = String(d.status); a.evidenceRefs = d.evidenceRefs as string[]; a.message = String(d.message);
      if (a.status === "applied") s.revision++; break;
    }
    case "connector.state": s.connector = d; break;
    case "world.raw_image": case "simulation.reset": s.rawImage = d.image as Record<string, unknown>; break;
    case "plc.output": s.outputs = d.values as Record<string, unknown>; break;
    case "finding.created": {
      const f = d as unknown as Finding; safeId(f.id);
      if (Object.hasOwn(s.findings, f.id) || !s.experiments[f.experimentId]) throw new Error("Finding identity/experiment invalid");
      s.findings[f.id] = { ...f, review: "unreviewed" }; break;
    }
    case "finding.accepted": case "finding.rerun_requested": {
      const f = s.findings[String(d.id)]; if (!f) throw new Error("Unknown finding");
      f.review = event.type === "finding.accepted" ? "accepted" : "rerun_requested"; break;
    }
    case "budget.accounted":
      s.budget.campaignUsd = Number(d.campaignUsd); s.budget.sessionUsd = Number(d.sessionUsd);
      s.budget.checks[String(d.checkId)] = Number(d.checkUsd); s.budget.repairs[String(d.repairEpisode)] = Number(d.repairUsd);
      s.budget.requests[String(d.requestId)] = d; break;
    case "agent.activity": case "agent.request": s.activity = d; break;
    case "report.finalized":
      if (!["stopped", "completed", "failed"].includes(s.status) || s.report || d.throughSequence !== event.sequence - 1) throw new Error("Report finalization boundary invalid");
      if (Object.values(s.actions).some(a => a.status === "requested")) throw new Error("Unresolved actions at finalization");
      s.report = d; break;
  }
  return s;
}

function checkReferences(event: CampaignEvent, lookup: ReadonlyMap<string, CampaignEvent>): void {
  for (const key of ["evidenceRefs", "injectedTruthRefs"]) {
    const refs = event.data[key];
    if (Array.isArray(refs)) for (const ref of refs) if (!lookup.has(String(ref))) throw new Error(`Unknown evidence ${ref}`);
  }
  if (event.type === "finding.created") {
    const f = event.data as unknown as Finding;
    for (const claim of f.claims) {
      const source = lookup.get(claim.evidenceId);
      if (source?.type !== "plc.output" || (source.data.values as Record<string, unknown>)[claim.signal] !== claim.equals) throw new Error("Finding claim is not supported by exact PLC output evidence");
    }
    for (const ref of f.injectedTruthRefs) if (lookup.get(ref)?.type !== "fault.truth") throw new Error("Injected truth must cite committed fault truth");
  }
  if (["world.raw_image", "plc.acknowledged", "plc.output"].includes(event.type)) {
    const source = lookup.get(String(event.data.sourceId));
    if (source?.type !== "coordinator.event") throw new Error("Derived PLC evidence requires its original coordinator event");
    const d = (source.data.source as { data: Record<string, unknown> }).data;
    if (d.action !== "commit.acknowledged") throw new Error("Source is not an acknowledged commit");
    if (event.type === "plc.output" && (canonical(event.data.values) !== canonical(d.outputs) || event.data.plcCycle !== d.plcCycle || event.data.outputCaptureCycle !== d.outputCaptureCycle)) throw new Error("Derived output differs from source");
    if (event.type === "world.raw_image" && (canonical(event.data.image) !== canonical(d.image) || event.data.epoch !== d.workstationEpoch || event.data.sequence !== d.workstationSequence)) throw new Error("Derived image differs from source");
    if (event.type === "plc.acknowledged") for (const [key, sourceKey] of Object.entries({ epoch: "workstationEpoch", sequence: "workstationSequence", bootIdentity: "bootIdentity", plcCycle: "plcCycle", outputCaptureCycle: "outputCaptureCycle", latencyMs: "latencyMs" })) {
      if (event.data[key] !== d[sourceKey]) throw new Error("Derived acknowledgement differs from source");
    }
  }
  if (event.type === "experiment.completed" && event.data.conclusion === "observed") {
    if (!(event.data.evidenceRefs as string[]).some(id => lookup.get(id)?.type === "plc.output")) throw new Error("Observed completion requires PLC output evidence");
  }
}

export function replay(events: readonly CampaignEvent[]): CampaignProjection {
  let state = emptyProjection(events[0]?.campaignId ?? "empty"), previousHash = "";
  const preceding: CampaignEvent[] = [];
  const lookup = new Map<string, CampaignEvent>();
  for (const event of events) {
    validate(campaignEventSchema, event);
    const { hash, ...body } = event;
    if (event.sequence !== preceding.length + 1 || event.id !== `${state.campaignId}:${event.sequence}` || event.campaignId !== state.campaignId
      || event.previousHash !== previousHash || hash !== digest(body)) throw new Error("Broken campaign sequence/hash chain");
    checkReferences(event, lookup);
    state = reduceEvent(state, event); preceding.push(event); lookup.set(event.id, event); previousHash = hash;
  }
  return state;
}

export class CampaignLedger {
  #events: CampaignEvent[] = [];
  #index = new Map<string, CampaignEvent>();
  #state: CampaignProjection;
  #fd?: number;
  #closed = false;
  readonly campaignId: string;
  readonly nowIso: () => string;
  constructor(campaignId: string, options: { file?: string; nowIso?: () => string } = {}) {
    safeId(campaignId); this.campaignId = campaignId; this.nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.#state = emptyProjection(campaignId);
    // Never truncate or silently resume a run with possibly unresolved side effects.
    if (options.file) this.#fd = openSync(options.file, "wx");
  }
  get events(): CampaignEvent[] { return structuredClone(this.#events); }
  getEvent(id: string): CampaignEvent | undefined { return structuredClone(this.#index.get(id)); }
  eventsSince(sequence: number, type?: EventType): CampaignEvent[] {
    return structuredClone(this.#events.slice(sequence).filter(e => !type || e.type === type));
  }
  evidenceWindow(after: number, through: number, limit: number, allowed: (event: Readonly<Pick<CampaignEvent, "type" | "visibility">>) => boolean): CampaignEvent[] {
    const selected: CampaignEvent[] = [];
    for (let i = Math.max(0, after); i < Math.min(through, this.#events.length) && selected.length < limit; i++) {
      const e = this.#events[i]; if (allowed(Object.freeze({ type: e.type, visibility: e.visibility }))) selected.push(e);
    }
    return structuredClone(selected);
  }
  recentEvents(limit: number, allowed: (event: Readonly<Pick<CampaignEvent, "type" | "visibility">>) => boolean): CampaignEvent[] {
    const selected: CampaignEvent[] = [];
    for (let i = this.#events.length - 1; i >= 0 && selected.length < limit; i--) {
      const e = this.#events[i]; if (allowed(Object.freeze({ type: e.type, visibility: e.visibility }))) selected.push(e);
    }
    return structuredClone(selected.reverse());
  }
  get state(): CampaignProjection { return structuredClone(this.#state); }
  append(type: EventType, data: Record<string, unknown>, visibility: CampaignEvent["visibility"] = "public"): CampaignEvent {
    if (this.#closed) throw new Error("Ledger is closed");
    if (["fault.truth", "world.evidence", "world.branch", "coordinator.event", "agent.response"].includes(type) && visibility !== "truth") throw new Error("Unfiltered source/world/fault truth cannot enter the public evidence lane");
    validate(eventSchemas[type], data);
    const sequence = this.#events.length + 1;
    const body = { schemaVersion: CAMPAIGN_VERSION, campaignId: this.campaignId, id: `${this.campaignId}:${sequence}`,
      sequence, atIso: this.nowIso(), type, visibility, data: structuredClone(data), previousHash: this.#events.at(-1)?.hash ?? "" };
    const event: CampaignEvent = { ...body, hash: digest(body) };
    checkReferences(event, this.#index);
    const state = reduceEvent(this.#state, event);
    if (this.#fd !== undefined) {
      const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
      let offset = 0;
      while (offset < bytes.length) { const written = writeSync(this.#fd, bytes, offset, bytes.length - offset); if (!written) throw new Error("Ledger write stalled"); offset += written; }
      fsyncSync(this.#fd);
    }
    this.#events.push(event); this.#index.set(event.id, event); this.#state = state;
    return structuredClone(event);
  }
  close(): void { if (this.#fd !== undefined) { closeSync(this.#fd); this.#fd = undefined; } this.#closed = true; }
}
export function readLedger(file: string): CampaignEvent[] {
  const text = readFileSync(file, "utf8");
  if (text && !text.endsWith("\n")) throw new Error("Incomplete final ledger record; reconcile before resuming");
  const events = text.trim() ? text.trim().split("\n").map(line => JSON.parse(line) as CampaignEvent) : [];
  replay(events); return events;
}

export function report(events: readonly CampaignEvent[]) {
  const s = replay(events);
  return { schemaVersion: CAMPAIGN_VERSION, campaignId: s.campaignId, status: s.status, provenance: s.provenance,
    evidenceClass: s.evidenceClass, claimBoundary: s.claimBoundary, plan: s.plan, experiments: Object.values(s.experiments),
    findings: Object.values(s.findings), budget: s.budget, finalization: s.report,
    ...(events.some(e => e.type === "hmi.assessment") ? { hmiAssessments: events.filter(e => e.type === "hmi.assessment").map(e => ({ id: e.id, data: e.data, review: "unreviewed" })) } : {}),
    injectedTruth: events.filter(e => e.type === "fault.truth").map(e => ({ id: e.id, data: e.data })),
    worldEvidenceRefs: events.filter(e => e.type === "world.evidence").map(e => e.id),
    sourceEvidenceRefs: events.filter(e => e.type === "coordinator.event").map(e => e.id),
    modelResponseRefs: events.filter(e => e.type === "agent.response").map(e => e.id),
    plcEvidence: events.filter(e => e.type === "plc.output").map(e => e.id),
    unresolved: Object.entries(s.actions).filter(([, a]) => a.status !== "applied").map(([id, action]) => ({ id, ...action })),
    untested: Object.values(s.experiments).filter(e => e.status !== "completed").map(e => e.id),
    coverage: "Experiment evidence only; no final conveyor-controller requirement coverage is certified." };
}
