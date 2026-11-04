// Engineer-facing bench report bundle.
//
// The authoritative report (`report(events)` in src/campaign/ledger.ts, or a saved report.json)
// travels unchanged. This module only selects the slice of ledger evidence a reader needs to trace
// each displayed conclusion: cited events, actions, HMI frames/actions, model requests and the final
// recorded state. Pure data with no Node or DOM imports, so the host, the offline export CLI and the
// portal share it. Separate audit/review files arrive as attachments with explicit origin and are
// never merged into the model report. Nothing here decides a pass/fail verdict.

import type { CampaignEvent } from "../campaign/contracts.ts";

export const REPORT_BUNDLE_VERSION = "controlsbench.bench-report.v1" as const;

export type RawValue = boolean | number | string | null;

export interface ReportExperiment { id: string; objective: string; category: string; requirements: string[] }
export interface ReportFinding {
  id: string; title: string; experimentId: string; claims: Array<{ evidenceId: string; signal: string; equals: RawValue }>;
  injectedTruthRefs: string[]; inference: string; assumptions: string[]; uncertainty: string; review?: string;
}
export interface HmiAssessmentData {
  id: string; requirementId: string; frameEvidenceRefs: string[]; actionEvidenceRefs: string[]; plcEvidenceRefs: string[];
  observation: string; verdict: string; uncertainty: string;
}
/** `report(events)` output read as data. Saved reports from older builds may omit optional parts. */
export interface CampaignReport {
  schemaVersion: string; campaignId: string; status: string;
  provenance?: Record<string, string>; evidenceClass?: string; claimBoundary?: string;
  plan?: { objective: string; experiments: ReportExperiment[] };
  experiments: Array<ReportExperiment & { status: string; conclusion?: string; evidenceRefs?: string[] }>;
  findings: ReportFinding[];
  budget?: { campaignUsd: number; sessionUsd: number; checks: Record<string, number>; repairs?: Record<string, number>; requests?: Record<string, unknown> };
  finalization?: { summary?: string; throughSequence?: number };
  hmiAssessments?: Array<{ id: string; data: HmiAssessmentData; review: string }>;
  injectedTruth?: Array<{ id: string; data: Record<string, unknown> }>;
  unresolved?: Array<{ id: string; name: string; status: string; evidenceRefs: string[]; message?: string }>;
  untested?: string[];
  coverage?: string;
}

export interface EvidenceItem {
  id: string; sequence: number; type: string; atIso: string; summary: string;
  /** Original source time (coordinator/HMI capture) when it differs from ledger ingestion. */
  sourceAtIso?: string; plcCycle?: string; bootIdentity?: string; values?: Record<string, RawValue>;
}
export interface ActionRecord {
  actionId: string; name: string; arguments: string; experimentId: string; requestedAtIso: string; requestedSeq: number;
  status: string; outcomeAtIso?: string; message?: string; evidenceRefs: string[];
  /** Semantic controller action outcome recorded by the runtime (not an HMI click). */
  controller?: { outcome: string; observedAtIso?: string; plcCycle?: string };
}
export interface ExperimentTiming {
  origin: "plan" | "followup"; proposedAtIso?: string; startedAtIso?: string; startedSeq?: number; completedAtIso?: string; completedSeq?: number;
  followup?: { eventId: string; rationale: string; evidenceRefs: string[] };
}
export interface ObservationRecord {
  id: string; sequence: number; atIso: string; kind: "observation" | "discrepancy"; summary: string; evidenceRefs: string[];
  experimentId?: string; expected?: string; observed?: string;
}
export interface ModelRequestRecord {
  requestId: string; experimentId: string; model: string; startedAtIso?: string; endedAtIso?: string; phase: string; elapsedMs?: number;
  tokens?: { input?: number; cachedInput?: number; output?: number; reasoning?: number; total?: number };
  decision?: string;
  /** From an attached model exchange log only. */
  exchange?: { responseReturned: boolean; httpStatus?: number; imageInputs: number; pricing?: Pricing };
}
export interface Pricing { inputUsdPerMillion: number; outputUsdPerMillion: number; checkedOn?: string; source?: string }
export interface HmiFrameRecord {
  id: string; sequence: number; reference: string; sessionId: string; frameSequence: number; capturedAtIso: string; recordedAtIso: string;
  actionId: string; kind: string; sha256?: string; file?: string;
  /** Whether these pixels were supplied to Muse, and on what basis. Capture alone is not supply. */
  supplied: { toMuse: boolean; basis: "model_exchange_log" | "ledger_receipt" | "no_record"; requestIds: string[] };
  selected: boolean;
}
export interface HmiActionRecord {
  id: string; sequence: number; actionId: string; action: string; atIso: string; reference: string;
  target?: string; requestedAtIso?: string; deliveredAtIso?: string; deliveredVia?: string; trustedInput?: boolean;
  command?: { outcome: string; ackKind?: string; acknowledgedAtIso?: string; detail?: string };
  screen?: { frameRef: string; frameId?: string; capturedAtIso?: string; sha256?: string; renderedStatus?: string };
}
export interface StateChange { sequence: number; atIso: string; state: string; reason: string }
export interface MediaRecord {
  sha256: string; status: "embedded" | "url" | "missing" | "hash_mismatch"; note: string;
  contentType?: string; byteLength?: number; dataUri?: string; url?: string;
}
export interface AttachmentRecord {
  file: string; sha256: string; byteLength: number; kind: "offline_audit" | "engineering_review"; origin: string; status: string;
  scope?: string; atIso?: string; claimBoundary?: string;
  facts: Array<{ label: string; value: string }>;
  citationDefects: Array<{ assessmentId: string; frameId: string }>;
  requirementNotes: Array<{ requirementId: string; note: string }>;
  limitations: string[];
  estimatedUncachedTokenCostUsd?: number;
}
export interface SourceFileRecord {
  file: string; role: string; sha256: string; byteLength: number; events?: number;
  /** Exact original bytes, only for small files free of local path metadata. */
  embeddedBase64?: string; contentType?: string;
}
export interface ExchangeSummary {
  file: string;
  visionInputs: Array<{ evidenceId: string; requestId: string; sha256: string; byteLength?: number }>;
  pricing: Record<string, Pricing>;
  responses: Record<string, { httpStatus?: number }>;
}
export interface BundleContext {
  kind: "host_current" | "saved_record";
  /** Optional human title supplied by whoever exports the report; never inferred. */
  title?: string;
  factoryLabel?: string;
}

export interface ReportBundle {
  schemaVersion: typeof REPORT_BUNDLE_VERSION;
  generatedAtIso: string;
  context: BundleContext;
  report: CampaignReport;
  reportIntegrity: { source: "host_memory" | "saved_file"; sha256?: string; matchesLedgerReconstruction?: boolean };
  ledger: {
    eventCount: number; firstAtIso?: string; lastAtIso?: string; headHash?: string; tailHash?: string;
    typeCounts: Record<string, number>; states: StateChange[]; authorized?: { categories: string[]; diagnosisMode: string };
    bootIdentities: string[];
  };
  evidence: Record<string, EvidenceItem>;
  actions: ActionRecord[];
  experiments: Record<string, ExperimentTiming>;
  observations: ObservationRecord[];
  modelRequests: ModelRequestRecord[];
  hmi: { frames: HmiFrameRecord[]; actions: HmiActionRecord[] };
  final: {
    plcOutput?: { id: string; atIso: string; sourceAtIso?: string; plcCycle?: string; bootIdentity?: string; values: Record<string, RawValue> };
    connector?: { id: string; atIso: string; state: string; reason: string; ageMs?: number };
  };
  attachments: AttachmentRecord[];
  sources: SourceFileRecord[];
  /** Selected HMI images keyed by SHA-256; frames reference them by hash. */
  media: Record<string, MediaRecord>;
  diagnostics?: Record<string, string>;
  /** Engineer's selected project, from the campaign's own selection record. */
  project?: { projectId: string; projectName: string; version: string; kind: string; specSha256: string; ioSha256?: string; worldSha256: string; loadedWorldSha256: string;
    manifestSha256?: string; benchProfile?: string; author?: string; responseIds?: string[] };
  /** Plan prepared before Start, with source-linked expected observations. */
  preparedPlan?: { objective: string; author: string; checks: PreparedCheck[]; notRun: Array<{ id: string; reason?: string }> };
}
export interface PreparedCheck { id: string; group: string; title: string; objective: string; requirementRefs: string[]; sourceRefs: string[]; stimulus: string;
  expectedObservation: string; expectedBasis: "specified" | "unspecified"; observeSignals: string[] }

export interface BundleInput {
  report: CampaignReport;
  events: readonly CampaignEvent[];
  context: BundleContext;
  reportIntegrity: ReportBundle["reportIntegrity"];
  generatedAtIso?: string;
  exchanges?: ExchangeSummary;
  attachments?: AttachmentRecord[];
  sources?: SourceFileRecord[];
  /** Bounded media resolver for the selected frames; unresolved frames keep a placeholder. */
  resolveMedia?: (frame: HmiFrameRecord) => MediaRecord;
}

const MAX_EVIDENCE_ITEMS = 2000;
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const strings = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : [];
const isRaw = (v: unknown): v is RawValue => v === null || ["boolean", "number", "string"].includes(typeof v);
const rawRecord = (v: unknown): Record<string, RawValue> => Object.fromEntries(Object.entries(obj(v)).filter(([, x]) => isRaw(x))) as Record<string, RawValue>;
const num = (v: unknown): number | undefined => typeof v === "number" && Number.isFinite(v) ? v : undefined;
const opt = (v: unknown, max = 2000): string | undefined => v === undefined || v === null || v === "" ? undefined : text(v, max);
export function text(v: unknown, max = 2000): string {
  const s = typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Ledger references are `<campaignId>:<sequence>`; anything else is not a ledger reference. */
export function sequenceOf(id: string): number | undefined {
  const match = /:(\d+)$/.exec(id);
  return match ? Number(match[1]) : undefined;
}

function tokens(usage: unknown): ModelRequestRecord["tokens"] {
  const u = obj(usage);
  if (!Object.keys(u).length) return undefined;
  return { input: num(u.input_tokens ?? u.inputTokens), cachedInput: num(obj(u.input_tokens_details).cached_tokens), output: num(u.output_tokens ?? u.outputTokens),
    reasoning: num(obj(u.output_tokens_details).reasoning_tokens), total: num(u.total_tokens ?? u.totalTokens) };
}

function summarize(e: CampaignEvent): string {
  const d = e.data;
  switch (e.type) {
    case "plc.output": return `PLC outputs at cycle ${text(d.outputCaptureCycle)}`;
    case "world.raw_image": return `Raw input image, commit sequence ${text(d.sequence)}`;
    case "plc.acknowledged": return `PLC applied commit ${text(d.sequence)} (${Number(d.latencyMs).toFixed(1)} ms)`;
    case "hmi.evidence": return `HMI ${text(d.kind)} ${text(d.reference)}`;
    case "hmi.action": return `HMI action ${text(d.action)} · PLC ${text(obj(obj(d.receipt).command).outcome) || "outcome not recorded"}`;
    case "hmi.assessment": return `Muse HMI assessment ${text(d.id)} (${text(d.requirementId)}): ${text(d.verdict)}`;
    case "observation": case "discrepancy": return text(d.summary, 600);
    case "fault.truth": { const t = obj(d.truth); return `Injected ${text(t.controlId)} ${text(t.parameters, 200)}`; }
    case "fault.committed": return "Fault truth committed before execution";
    case "followup.added": return `Follow-up ${text(obj(d.experiment).id)} added`;
    case "experiment.completed": return `Experiment ${text(d.id)} completed · ${text(d.conclusion)}`;
    case "finding.created": return `Finding ${text(d.id)}`;
    case "world.stimulus": return `World control ${text(obj(d.control).id)}`;
    case "controller.action": return `Controller ${text(d.action)} ${text(d.outcome)}`;
    case "connector.state": return `Connector ${text(d.state)}: ${text(d.reason, 300)}`;
    case "campaign.state": return `Campaign ${text(d.state)}: ${text(d.reason, 300)}`;
    case "coordinator.event": { const s = obj(d.source); return `Coordinator ${text(s.lane)} ${text(obj(s.data).action)}`; }
    default: return e.type.startsWith("action.") ? `${text(d.actionId)} ${text(d.status ?? d.name)}` : e.type;
  }
}

export function buildReportBundle(input: BundleInput): ReportBundle {
  const { report, events } = input;
  const byId = new Map<string, CampaignEvent>();
  const ackBySource = new Map<string, CampaignEvent>();
  const typeCounts: Record<string, number> = {};
  const states: StateChange[] = [];
  const boots: string[] = [];
  const actions = new Map<string, ActionRecord>();
  const experiments: Record<string, ExperimentTiming> = {};
  const observations: ObservationRecord[] = [];
  const requests = new Map<string, ModelRequestRecord>();
  const frames: HmiFrameRecord[] = [];
  const hmiActions: HmiActionRecord[] = [];
  const exchangeInputs = new Map<string, string[]>();
  for (const v of input.exchanges?.visionInputs ?? []) exchangeInputs.set(v.evidenceId, [...(exchangeInputs.get(v.evidenceId) ?? []), v.requestId]);
  let authorized: ReportBundle["ledger"]["authorized"];
  let project: ReportBundle["project"], preparedPlan: ReportBundle["preparedPlan"];
  let active: string | undefined;
  let lastCompletedRequest: ModelRequestRecord | undefined;
  let lastOutput: CampaignEvent | undefined, lastConnector: CampaignEvent | undefined;

  for (const e of events) {
    byId.set(e.id, e);
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
    const d = e.data;
    switch (e.type) {
      case "campaign.state": states.push({ sequence: e.sequence, atIso: e.atIso, state: text(d.state), reason: text(d.reason, 1200) }); break;
      case "campaign.authorized": authorized = { categories: strings(d.categories), diagnosisMode: text(d.diagnosisMode) }; break;
      case "world.evidence": {
        const s = obj(d.source);
        if (s.kind === "selected_project") {
          const prep = obj(s.preparation);
          project = { projectId: text(s.projectId, 120), projectName: text(s.projectName, 200), version: text(s.version, 20), kind: text(s.projectKind, 20), specSha256: text(s.specSha256, 64),
            ...(s.ioSha256 ? { ioSha256: text(s.ioSha256, 64) } : {}), worldSha256: text(s.worldSha256, 64), loadedWorldSha256: text(s.loadedWorldSha256, 64),
            ...(s.manifestSha256 ? { manifestSha256: text(s.manifestSha256, 64) } : {}), ...(s.benchProfile ? { benchProfile: text(s.benchProfile, 80) } : {}),
            ...(prep.author ? { author: text(prep.author, 200) } : {}), responseIds: strings(prep.responseIds) };
        }
        if (s.kind === "prepared_plan") preparedPlan = { objective: text(s.objective), author: text(s.author, 200),
          checks: (Array.isArray(s.checks) ? s.checks : []).map(obj).map(c => ({ id: text(c.id, 150), group: text(c.group, 40), title: text(c.title, 400), objective: text(c.objective),
            requirementRefs: strings(c.requirementRefs), sourceRefs: strings(c.sourceRefs), stimulus: text(c.stimulus), expectedObservation: text(c.expectedObservation),
            expectedBasis: c.expectedBasis === "specified" ? "specified" as const : "unspecified" as const, observeSignals: strings(c.observeSignals) })),
          notRun: (Array.isArray(s.notRun) ? s.notRun : []).map(obj).map(n => ({ id: text(n.id, 150), ...(n.reason ? { reason: text(n.reason, 400) } : {}) })) };
        break;
      }
      case "plc.acknowledged":
        ackBySource.set(text(d.sourceId), e);
        if (d.bootIdentity && boots.at(-1) !== text(d.bootIdentity)) boots.push(text(d.bootIdentity));
        break;
      case "plc.output": lastOutput = e; break;
      case "connector.state": lastConnector = e; break;
      case "experiment.proposed": experiments[text(d.id)] ??= { origin: "plan", proposedAtIso: e.atIso }; break;
      case "followup.added": {
        const id = text(obj(d.experiment).id);
        experiments[id] = { ...experiments[id], origin: "followup", followup: { eventId: e.id, rationale: text(d.rationale), evidenceRefs: strings(d.evidenceRefs) } };
        break;
      }
      case "experiment.started": {
        const id = text(d.id); active = id;
        experiments[id] = { ...(experiments[id] ?? { origin: "plan" }), startedAtIso: e.atIso, startedSeq: e.sequence };
        break;
      }
      case "experiment.completed": {
        const id = text(d.id); if (active === id) active = undefined;
        experiments[id] = { ...(experiments[id] ?? { origin: "plan" }), completedAtIso: e.atIso, completedSeq: e.sequence };
        break;
      }
      case "observation": case "discrepancy":
        observations.push({ id: e.id, sequence: e.sequence, atIso: e.atIso, kind: e.type, summary: text(d.summary), evidenceRefs: strings(d.evidenceRefs), experimentId: active,
          ...(e.type === "discrepancy" ? { expected: text(d.expected, 800), observed: text(d.observed, 800) } : {}) });
        break;
      case "action.requested":
        actions.set(text(d.actionId), { actionId: text(d.actionId), name: text(d.name), arguments: text(d.arguments, 600), experimentId: text(d.experimentId),
          requestedAtIso: e.atIso, requestedSeq: e.sequence, status: "requested", evidenceRefs: [] });
        break;
      case "action.applied": case "action.rejected": case "action.timed_out": case "action.stale": case "action.inconclusive": {
        const a = actions.get(text(d.actionId));
        if (a) Object.assign(a, { status: text(d.status), outcomeAtIso: e.atIso, message: text(d.message, 1200), evidenceRefs: strings(d.evidenceRefs) });
        break;
      }
      case "controller.action": {
        const a = actions.get(text(d.actionId)), o = obj(d.observation);
        if (a) a.controller = { outcome: text(d.outcome) || "observed", observedAtIso: opt(o.observedAtIso), plcCycle: opt(o.plcCycle) };
        break;
      }
      case "agent.request": {
        const id = text(d.requestId);
        const r = requests.get(id) ?? { requestId: id, experimentId: text(d.experimentId), model: text(d.model), phase: "started" };
        if (d.phase === "started") r.startedAtIso ??= e.atIso;
        else { Object.assign(r, { phase: text(d.phase), endedAtIso: e.atIso, elapsedMs: num(d.elapsedMs), tokens: tokens(d.usage) }); if (d.phase === "completed") lastCompletedRequest = r; }
        requests.set(id, r);
        break;
      }
      case "agent.activity":
        if (d.phase === "decision" && lastCompletedRequest && !lastCompletedRequest.decision) lastCompletedRequest.decision = text(d.summary, 1200);
        break;
      case "hmi.evidence": {
        const receipt = obj(d.receipt), reference = text(d.reference, 300);
        const match = /^hmi-frame:([^:]+):(\d+)$/.exec(reference);
        const viaExchange = exchangeInputs.get(e.id);
        const file = opt(receipt.file, 200);
        frames.push({ id: e.id, sequence: e.sequence, reference, sessionId: match?.[1] ?? text(receipt.sessionId), frameSequence: Number(match?.[2] ?? -1),
          capturedAtIso: text(d.atIso), recordedAtIso: e.atIso, actionId: text(d.actionId), kind: text(d.kind), sha256: opt(receipt.sha256, 64), file,
          supplied: input.exchanges ? { toMuse: Boolean(viaExchange), basis: "model_exchange_log", requestIds: viaExchange ?? [] }
            : file ? { toMuse: true, basis: "ledger_receipt", requestIds: [] } : { toMuse: false, basis: "no_record", requestIds: [] },
          selected: false });
        break;
      }
      case "hmi.action": {
        const receipt = obj(d.receipt), action = obj(receipt.action), command = obj(receipt.command), screen = obj(action.screen);
        const delivered = obj(action.delivered), page = obj(action.pageInput), target = obj(action.targetRect);
        hmiActions.push({ id: e.id, sequence: e.sequence, actionId: text(d.actionId), action: text(d.action), atIso: text(d.atIso), reference: text(d.reference, 300),
          target: opt(target.label, 200), requestedAtIso: opt(action.requestedAtIso), deliveredAtIso: opt(delivered.atIso), deliveredVia: opt(delivered.via, 300),
          trustedInput: typeof page.isTrusted === "boolean" ? page.isTrusted : undefined,
          command: Object.keys(command).length ? { outcome: text(command.outcome), ackKind: opt(command.ackKind), acknowledgedAtIso: opt(command.acknowledgedAtIso), detail: opt(command.detail, 600) } : undefined,
          screen: screen.frameRef ? { frameRef: text(screen.frameRef, 300), capturedAtIso: opt(screen.capturedAtIso), sha256: opt(screen.sha256, 64), renderedStatus: opt(screen.renderedStatus, 400) } : undefined });
        break;
      }
    }
  }

  // An action's rendered screen links to the first recorded frame with the same reference.
  const frameByRef = new Map<string, HmiFrameRecord>();
  for (const f of frames) if (!frameByRef.has(f.reference)) frameByRef.set(f.reference, f);
  for (const a of hmiActions) if (a.screen) a.screen.frameId = frameByRef.get(a.screen.frameRef)?.id;

  // Exchange log enrichment is attached only when the log was supplied.
  for (const r of requests.values()) {
    if (!input.exchanges) continue;
    const response = input.exchanges.responses[r.requestId];
    r.exchange = { responseReturned: response?.httpStatus === 200, httpStatus: response?.httpStatus,
      imageInputs: input.exchanges.visionInputs.filter(v => v.requestId === r.requestId).length, pricing: input.exchanges.pricing[r.requestId] };
  }

  // Cited evidence: everything a displayed conclusion points at.
  const cited = new Set<string>();
  const cite = (ids: Iterable<string>) => { for (const id of ids) if (byId.has(id)) cited.add(id); };
  for (const x of report.experiments ?? []) cite(x.evidenceRefs ?? []);
  for (const f of report.findings ?? []) { cite(f.claims.map(c => c.evidenceId)); cite(f.injectedTruthRefs); }
  for (const a of report.hmiAssessments ?? []) { cite([a.id]); cite(a.data.frameEvidenceRefs); cite(a.data.actionEvidenceRefs); cite(a.data.plcEvidenceRefs); }
  for (const u of report.unresolved ?? []) cite(u.evidenceRefs);
  for (const a of actions.values()) cite(a.evidenceRefs);
  for (const o of observations) { cite([o.id]); cite(o.evidenceRefs); }
  for (const x of Object.values(experiments)) if (x.followup) { cite([x.followup.eventId]); cite(x.followup.evidenceRefs); }
  cite(frames.map(f => f.id)); cite(hmiActions.map(a => a.id));
  if (lastOutput) cite([lastOutput.id]);

  const evidence: Record<string, EvidenceItem> = {};
  for (const id of [...cited].sort((a, b) => (byId.get(a)!.sequence - byId.get(b)!.sequence)).slice(0, MAX_EVIDENCE_ITEMS)) {
    const e = byId.get(id)!, d = e.data;
    const item: EvidenceItem = { id, sequence: e.sequence, type: e.type, atIso: e.atIso, summary: summarize(e) };
    if (e.type === "plc.output" || e.type === "world.raw_image") {
      const source = byId.get(text(d.sourceId)), ack = ackBySource.get(text(d.sourceId));
      item.sourceAtIso = opt(obj(source?.data.source).atIso);
      item.values = rawRecord(e.type === "plc.output" ? d.values : d.image);
      item.plcCycle = opt(d.plcCycle ?? ack?.data.plcCycle);
      item.bootIdentity = opt(ack?.data.bootIdentity);
    } else if (e.type === "hmi.evidence" || e.type === "hmi.action") item.sourceAtIso = opt(d.atIso);
    evidence[id] = item;
  }

  // Selected frames: those an assessment, an HMI action screen or an experiment conclusion cites.
  const selected = new Set<string>();
  for (const a of report.hmiAssessments ?? []) a.data.frameEvidenceRefs.forEach(id => selected.add(id));
  for (const a of hmiActions) if (a.screen?.frameId) selected.add(a.screen.frameId);
  for (const x of report.experiments ?? []) (x.evidenceRefs ?? []).forEach(id => selected.add(id));
  const media: Record<string, MediaRecord> = {};
  for (const f of frames) {
    f.selected = selected.has(f.id);
    if (!f.selected || !f.sha256 || media[f.sha256]?.status === "embedded" || media[f.sha256]?.status === "url") continue;
    media[f.sha256] = input.resolveMedia?.(f) ?? { sha256: f.sha256, status: "missing", note: "No image source is available for this report" };
  }

  const out = lastOutput ? ackBySource.get(text(lastOutput.data.sourceId)) : undefined;
  const plcSource = lastOutput ? byId.get(text(lastOutput.data.sourceId)) : undefined;
  return {
    schemaVersion: REPORT_BUNDLE_VERSION,
    generatedAtIso: input.generatedAtIso ?? new Date().toISOString(),
    context: input.context,
    report,
    reportIntegrity: input.reportIntegrity,
    ledger: { eventCount: events.length, firstAtIso: events[0]?.atIso, lastAtIso: events.at(-1)?.atIso, headHash: events[0]?.hash, tailHash: events.at(-1)?.hash,
      typeCounts, states, authorized, bootIdentities: boots },
    evidence,
    actions: [...actions.values()],
    experiments,
    observations,
    modelRequests: [...requests.values()],
    hmi: { frames, actions: hmiActions },
    final: {
      plcOutput: lastOutput ? { id: lastOutput.id, atIso: lastOutput.atIso, sourceAtIso: opt(obj(plcSource?.data.source).atIso), plcCycle: opt(lastOutput.data.plcCycle),
        bootIdentity: opt(out?.data.bootIdentity), values: rawRecord(lastOutput.data.values) } : undefined,
      connector: lastConnector ? { id: lastConnector.id, atIso: lastConnector.atIso, state: text(lastConnector.data.state), reason: text(lastConnector.data.reason, 600),
        ageMs: num(lastConnector.data.ageMs) } : undefined
    },
    ...(project ? { project } : {}), ...(preparedPlan ? { preparedPlan } : {}),
    attachments: input.attachments ?? [],
    sources: input.sources ?? [],
    media
  };
}

// Shareable output must not carry workstation paths: drive-letter, UNC and home-directory paths.
const LOCAL_PATH = /(?:\b[A-Za-z]:[\\/]|\\\\[^\\\s]|\/(?:Users|home)\/)[^\s"'<>|]*/g;
export const containsLocalPath = (value: string): boolean => new RegExp(LOCAL_PATH.source).test(value);

/** Replaces local path text throughout a bundle (data URIs and hashes cannot match). Returns a copy. */
export function scrubLocalPaths<T>(value: T): T {
  if (typeof value === "string") return (value.startsWith("data:") ? value : value.replace(LOCAL_PATH, "[local path removed]")) as T;
  if (Array.isArray(value)) return value.map(scrubLocalPaths) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubLocalPaths(v)])) as T;
  return value;
}
