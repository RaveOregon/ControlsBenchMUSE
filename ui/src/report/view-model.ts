// Bench report presentation model. One pure function turns a report bundle (current host campaign
// or saved record) into the sections both the in-app Results page and the standalone HTML render.
//
// Labelling rules: campaign execution status, experiment conclusion, requirement verdict and
// engineer review are separate dimensions and are never summed into one pass rate. A completed
// experiment is an observation, not a passing requirement. Model-authored text is labelled as such
// and stays unreviewed unless the ledger records a review. Missing metadata reads "Unavailable".

import type { ActionRecord, AttachmentRecord, EvidenceItem, HmiActionRecord, HmiFrameRecord, MediaRecord, RawValue, ReportBundle, SourceFileRecord } from "../../../src/report/bundle.ts";

export type Tone = "ok" | "warn" | "bad" | "neutral" | "info";
export interface RefView { id: string; sequence?: number; label: string; known: boolean }
export interface Fact { label: string; value: string; mono?: boolean; unavailable?: boolean }
export interface ActionLine { actionId: string; label: string; status: string; statusLabel: string; tone: Tone; atIso: string; refs: RefView[]; message?: string }
export interface ValueGroup { ref: RefView; atIso?: string; sourceAtIso?: string; plcCycle?: string; values: Array<{ signal: string; value: string; matches?: boolean }> }
export interface ExperimentRow {
  id: string; objective: string; category: string; requirements: string[]; origin: string; followup?: { rationale: string; refs: RefView[] };
  status: "observed" | "inconclusive" | "running" | "not_run"; statusLabel: string; tone: Tone; startedAtIso?: string; completedAtIso?: string;
  stimuli: ActionLine[]; checks: ActionLine[]; discrepancies: string[]; values: ValueGroup[]; expected: string; requirementVerdict: string;
  refs: RefView[]; limitations: string[];
}
export interface RequirementRow { id: string; experiments: Array<{ id: string; statusLabel: string }>; verdictLabel: string; tone: Tone; recorded: string[]; separateReviews: string[] }
export interface FindingView {
  id: string; title: string; experimentId: string; priority: string; review: string; reviewTone: Tone;
  claimGroups: ValueGroup[]; claimCount: number; inference: string; assumptions: string[]; uncertainty: string; injected: Array<{ ref: RefView; text: string }>;
}
export interface FrameView {
  id: string; sequence: number; reference: string; capturedAtIso: string; recordedAtIso: string; sha256?: string; actionId: string;
  supplied: boolean; suppliedLabel: string; image: { status: MediaRecord["status"] | "not_selected"; src?: string; note: string };
}
export interface HmiActionView {
  id: string; sequence: number; action: string; target?: string; requestedAtIso?: string; deliveredAtIso?: string; trusted: string;
  plc: string; plcTone: Tone; acknowledgedAtIso?: string; rendered?: string; screen?: FrameView;
}
export interface AssessmentView {
  id: string; sequence?: number; assessmentId: string; requirementId: string; verdict: string; verdictTone: Tone; review: string;
  observation: string; uncertainty: string; frames: FrameView[]; actions: HmiActionView[]; otherActionRefs: RefView[]; plc: ValueGroup[];
  citationIssues: string[]; separateReviews: string[];
}
export interface CountItem { label: string; value: number | string; tone?: Tone }
export interface CountGroup { title: string; note: string; items: CountItem[] }
export interface EvidenceRow { id: string; sequence: number; type: string; atIso: string; sourceAtIso?: string; summary: string; plcCycle?: string; bootIdentity?: string; values: Array<[string, string]> }
export interface ModelRow { requestId: string; experimentId: string; phase: string; tone: Tone; startedAtIso?: string; elapsed: string; tokens: string; decision?: string; exchange?: string }

export interface ReportView {
  title: string; campaignId: string; objective?: string; generatedAtIso: string;
  source: { evidenceClass: string; evidenceLabel: string; evidenceTag: string; context: string; historical: boolean; claimBoundary?: string; coverage?: string };
  execution: { status: string; label: string; tone: Tone; detail: string; interrupted: boolean; finalized: boolean };
  headline: string[]; finalization?: { text: string; author: "muse" | "runtime" }; attention: Array<{ tone: Tone; text: string }>; counts: CountGroup[]; identity: Fact[];
  experiments: ExperimentRow[]; campaignActions: ActionLine[]; requirements: RequirementRow[]; findings: FindingView[];
  hmi: { note: string; assessments: AssessmentView[]; actions: HmiActionView[]; frames: FrameView[]; captured: number; supplied: number };
  recommendations: string[]; remaining: Array<{ title: string; items: string[] }>;
  finalState: { note: string; atIso?: string; sourceAtIso?: string; plcCycle?: string; bootIdentity?: string; connector?: string; values: Array<[string, string]> } | undefined;
  accounting: { reservations: Fact[]; reservationNote: string; tokens: Fact[]; estimates: Fact[]; estimateNote: string };
  attachments: AttachmentRecord[]; evidence: EvidenceRow[]; ledgerEventCount: number; modelTrail: ModelRow[]; sources: SourceFileRecord[];
  integrity: Fact[]; diagnostics?: Record<string, string>;
}

// Bundles opened from a file are untrusted: images may only be inline JPEG/PNG data or this host's
// own retained-frame route, never an arbitrary URL taken from report content.
const SAFE_IMAGE = /^(?:data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+=*|\/api\/hmi\/frames\/[A-Za-z0-9._%-]+\/\d+)$/;
export const safeImageSrc = (src?: string): string | undefined => src && SAFE_IMAGE.test(src) ? src : undefined;
const SAFE_DOWNLOAD = /^[A-Za-z0-9+/]+=*$/;

const EVIDENCE: Record<string, { label: string; tag: string }> = {
  live_plc: { label: "Live PLC evidence", tag: "live" },
  preserved_live_plc: { label: "Recorded PLC evidence, re-presented", tag: "replay" },
  fake_connector: { label: "Fixture · fake connector, no PLC", tag: "surrogate" }
};
const STIMULUS = new Set(["request_hmi_action", "operator_action", "inject_fault", "clear_fault", "introduce_carton", "assign_route", "acknowledge_completion", "set_downstream_readiness", "branch_or_reset_world"]);
const CHECK = new Set(["wait_for_condition", "capture_hmi_evidence"]);
const TYPE_LABEL: Record<string, string> = {
  "plc.output": "PLC output", "world.raw_image": "Raw inputs", "plc.acknowledged": "PLC ack", "hmi.evidence": "HMI frame", "hmi.action": "HMI action",
  "hmi.assessment": "Assessment", observation: "Observation", discrepancy: "Discrepancy", "fault.truth": "Injected fault", "followup.added": "Follow-up",
  "world.stimulus": "World control", "controller.action": "Controller action", "coordinator.event": "Source record"
};
const UNAVAILABLE = "Unavailable";

export function fmtTime(iso?: string): string {
  if (!iso) return UNAVAILABLE;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : `${iso.slice(0, 10)} ${iso.slice(11, 23)} UTC`;
}
export function fmtDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return UNAVAILABLE;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}
export const fmtValue = (v: RawValue | undefined): string => v === undefined ? "—" : typeof v === "string" ? (v === "" ? '""' : v) : String(v);
const usd = (n: number) => `$${n.toFixed(2)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const between = (a?: string, b?: string) => a && b ? Date.parse(b) - Date.parse(a) : undefined;
const parse = (json: string): Record<string, unknown> => { try { const v = JSON.parse(json); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
const short = (id: string) => { const m = /:(\d+)$/.exec(id); return m ? `#${m[1]}` : id; };

export function buildReportView(bundle: ReportBundle): ReportView {
  const r = bundle.report;
  const ev = bundle.evidence;
  const ref = (id: string): RefView => { const e = ev[id]; return { id, sequence: e?.sequence, label: `${short(id)}${e ? ` ${TYPE_LABEL[e.type] ?? e.type}` : ""}`, known: Boolean(e) }; };
  const refs = (ids: readonly string[] = []) => [...new Set(ids)].map(ref);
  const finalized = Boolean(r.finalization) || ["completed", "stopped", "failed"].includes(r.status);
  const states = bundle.ledger.states;
  const started = states.find(s => s.state === "running")?.atIso;
  const ended = [...states].reverse().find(s => ["completed", "stopped", "failed"].includes(s.state))?.atIso;
  const evidence = EVIDENCE[r.evidenceClass ?? ""] ?? { label: r.evidenceClass ? `Evidence class ${r.evidenceClass}` : "Evidence class not recorded", tag: "" };
  const historical = bundle.context.kind === "saved_record" || r.evidenceClass === "preserved_live_plc" || finalized;
  const context = bundle.context.kind === "saved_record" ? "Saved record · offline review (historical)"
    : finalized ? "Current host campaign · finalized, recorded values are historical" : "Current host campaign · in progress";

  // ---- media and frames
  const media = (f: HmiFrameRecord): FrameView["image"] => {
    if (!f.selected) return { status: "not_selected", note: "Not selected for this report; metadata only" };
    const m = f.sha256 ? bundle.media[f.sha256] : undefined;
    if (!m) return { status: "missing", note: f.sha256 ? "Image not available" : "No image hash was recorded for this capture" };
    if (m.status !== "embedded" && m.status !== "url") return { status: m.status, note: m.note };
    const src = safeImageSrc(m.status === "embedded" ? m.dataUri : m.url);
    return src ? { status: m.status, src, note: m.note } : { status: "missing", note: "Image source is not an allowed embedded image or host frame; not loaded" };
  };
  const frameViews = new Map<string, FrameView>(bundle.hmi.frames.map(f => [f.id, {
    id: f.id, sequence: f.sequence, reference: f.reference, capturedAtIso: f.capturedAtIso, recordedAtIso: f.recordedAtIso, sha256: f.sha256, actionId: f.actionId,
    supplied: f.supplied.toMuse,
    suppliedLabel: f.supplied.toMuse
      ? `Pixels sent to Muse${f.supplied.requestIds.length ? ` in ${f.supplied.requestIds.join(", ")}` : ""} (${f.supplied.basis === "model_exchange_log" ? "model exchange log" : "ledger receipt"})`
      : f.supplied.basis === "model_exchange_log" ? "Captured only: pixels were not among the images sent to Muse (model exchange log)" : "Captured only: no record that these pixels were sent to Muse",
    image: media(f)
  }]));
  const hmiActionView = (a: HmiActionRecord): HmiActionView => {
    const outcome = a.command?.outcome;
    return { id: a.id, sequence: a.sequence, action: a.action, target: a.target, requestedAtIso: a.requestedAtIso, deliveredAtIso: a.deliveredAtIso,
      trusted: a.trustedInput === undefined ? "Not recorded" : a.trustedInput ? "Trusted page input" : "Untrusted page input",
      plc: outcome ? `${outcome}${a.command?.ackKind ? ` (${a.command.ackKind.replaceAll("_", " ")})` : ""}${a.command?.detail ? ` — ${a.command.detail}` : ""}` : "No PLC acknowledgement recorded",
      plcTone: outcome === "applied" ? "ok" : outcome ? "warn" : "neutral", acknowledgedAtIso: a.command?.acknowledgedAtIso, rendered: a.screen?.renderedStatus,
      screen: a.screen?.frameId ? frameViews.get(a.screen.frameId) : undefined };
  };
  const hmiActions = bundle.hmi.actions.map(hmiActionView);
  const hmiActionById = new Map(hmiActions.map(a => [a.id, a]));

  // ---- actions
  const label = (a: ActionRecord): string => {
    const x = parse(a.arguments), p = (v: unknown) => typeof v === "object" ? JSON.stringify(v) : String(v);
    switch (a.name) {
      case "request_hmi_action": return `HMI action ${p(x.action ?? "?")}`;
      case "operator_action": return `Operator ${p(x.action ?? "?")} (direct PLC command, not via HMI)`;
      case "inject_fault": return `Inject ${p(x.controlId ?? "fault")} ${p(x.parameters ?? "")}`;
      case "clear_fault": return `Clear ${p(x.controlId ?? "fault")} ${p(x.parameters ?? "")}`;
      case "introduce_carton": return `Introduce carton ${p(x.itemId ?? "")} (requested route ${p(x.requestedRoute ?? "none")})`;
      case "assign_route": return `Assign route ${p(x.route ?? "?")} to ${p(x.itemId ?? "?")}`;
      case "wait_for_condition": return `Wait for ${p(x.signal ?? "?")} = ${p(x.equals)} (up to ${p(x.timeoutMs ?? "?")} ms)`;
      case "capture_hmi_evidence": return `Capture HMI ${p(x.kind ?? "frame")}`;
      default: return `${a.name.replaceAll("_", " ")} ${a.arguments === "{}" ? "" : a.arguments}`.trim();
    }
  };
  const STATUS: Record<string, [string, Tone]> = { applied: ["applied", "ok"], rejected: ["refused", "bad"], timed_out: ["timed out", "warn"], stale: ["stale", "warn"], inconclusive: ["inconclusive", "warn"], requested: ["unresolved", "warn"] };
  const line = (a: ActionRecord): ActionLine => {
    const [statusLabel, tone] = STATUS[a.status] ?? [a.status, "neutral" as Tone];
    const outcome = a.name === "wait_for_condition" && a.status === "applied" ? "observed" : a.name === "operator_action" && a.controller ? `${statusLabel}; controller ${a.controller.outcome}` : statusLabel;
    return { actionId: a.actionId, label: label(a), status: a.status, statusLabel: outcome, tone, atIso: a.requestedAtIso, refs: refs(a.evidenceRefs), message: a.status === "applied" ? undefined : a.message };
  };

  // ---- experiments (plan entries never proposed count as not run)
  const assessments = r.hmiAssessments ?? [];
  const findingsFor = (id: string) => r.findings.filter(f => f.experimentId === id);
  const ids = [...new Set([...r.experiments.map(x => x.id), ...(r.plan?.experiments ?? []).map(x => x.id)])];
  const verdictLabel = (reqs: string[]) => {
    const recorded = assessments.filter(a => reqs.includes(a.data.requirementId));
    return recorded.length ? recorded.map(a => `${a.data.requirementId}: ${a.data.verdict} (Muse assessment, ${a.review})`).join("; ") : "No requirement verdict recorded";
  };
  const experiments: ExperimentRow[] = ids.map(id => {
    const x = r.experiments.find(e => e.id === id) ?? { ...(r.plan?.experiments ?? []).find(e => e.id === id)!, status: "planned" };
    const timing = bundle.experiments[id];
    const status: ExperimentRow["status"] = x.status === "completed" ? (x.conclusion === "inconclusive" ? "inconclusive" : "observed") : x.status === "running" ? "running" : "not_run";
    const [statusLabel, tone]: [string, Tone] = status === "observed" ? ["Observed — conclusion recorded, not a pass verdict", "info"] : status === "inconclusive" ? ["Inconclusive", "warn"]
      : status === "running" ? ["Interrupted — still running when the record ended", "warn"] : ["Not run", "warn"];
    const mine = bundle.actions.filter(a => a.experimentId === id);
    const findings = findingsFor(id);
    const signals = new Set([...findings.flatMap(f => f.claims.map(c => c.signal)), ...mine.filter(a => a.name === "wait_for_condition").map(a => String(parse(a.arguments).signal ?? ""))].filter(Boolean));
    const values: ValueGroup[] = (x.evidenceRefs ?? []).filter(e => ev[e]?.type === "plc.output").map(e => valueGroup(ev[e]!, [...signals], ref(e)));
    const limitations = [
      ...findings.map(f => `${f.id}: ${f.uncertainty}`),
      ...mine.filter(a => a.status !== "applied").map(a => `${a.actionId} ${STATUS[a.status]?.[0] ?? a.status}: ${a.message ?? ""}`.trim()),
      ...assessments.filter(a => x.requirements.includes(a.data.requirementId) && a.data.verdict !== "pass").map(a => `${a.data.requirementId} assessed ${a.data.verdict}: ${a.data.uncertainty}`),
      ...(status === "not_run" ? ["No evidence: this experiment was not executed."] : status === "running" ? ["The record ended before this experiment reached a conclusion."] : [])
    ];
    return { id, objective: x.objective, category: x.category, requirements: x.requirements, origin: timing?.origin === "followup" ? "Adaptive follow-up (added from evidence)" : "Planned",
      followup: timing?.followup ? { rationale: timing.followup.rationale, refs: refs(timing.followup.evidenceRefs) } : undefined,
      status, statusLabel, tone, startedAtIso: timing?.startedAtIso, completedAtIso: timing?.completedAtIso,
      stimuli: mine.filter(a => STIMULUS.has(a.name)).map(line), checks: mine.filter(a => CHECK.has(a.name)).map(line),
      discrepancies: bundle.observations.filter(o => o.kind === "discrepancy" && o.experimentId === id).map(discrepancy),
      values, expected: "No explicit acceptance criterion is recorded in the campaign for this experiment.", requirementVerdict: verdictLabel(x.requirements),
      refs: refs(x.evidenceRefs ?? []), limitations };
  });
  const experimentIds = new Set(ids);
  const campaignActions = bundle.actions.filter(a => !experimentIds.has(a.experimentId) && (STIMULUS.has(a.name) || CHECK.has(a.name) || a.status !== "applied")).map(line);
  const outsideDiscrepancies = bundle.observations.filter(o => o.kind === "discrepancy" && !experimentIds.has(o.experimentId ?? "")).map(discrepancy);

  // ---- requirements: union of experiment references and recorded assessments
  const reqIds = [...new Set([...experiments.flatMap(x => x.requirements), ...assessments.map(a => a.data.requirementId)])];
  const reviewNotes = (requirementId: string) => bundle.attachments.flatMap(a => a.requirementNotes.filter(n => n.requirementId === requirementId).map(n => `${a.file} (${a.status}, separate artifact): ${n.note}`));
  const requirements: RequirementRow[] = reqIds.map(id => {
    const recorded = assessments.filter(a => a.data.requirementId === id);
    const verdicts = [...new Set(recorded.map(a => a.data.verdict))];
    const tone: Tone = !verdicts.length ? "neutral" : verdicts.includes("fail") ? "bad" : verdicts.includes("inconclusive") ? "warn" : "ok";
    return { id, experiments: experiments.filter(x => x.requirements.includes(id)).map(x => ({ id: x.id, statusLabel: x.status === "observed" ? "observed" : x.status.replace("_", " ") })),
      verdictLabel: verdicts.length ? `${verdicts.join(" / ")} — Muse assessment, ${recorded.every(a => a.review === "unreviewed") ? "unreviewed" : recorded.map(a => a.review).join(", ")}` : "No verdict recorded",
      tone, recorded: recorded.map(a => `${a.data.id} (${short(a.id)}): ${a.data.verdict}`), separateReviews: reviewNotes(id) };
  });

  // ---- findings
  const findings: FindingView[] = r.findings.map(f => {
    const groups = new Map<string, ValueGroup>();
    for (const c of f.claims) {
      const e = ev[c.evidenceId];
      const g = groups.get(c.evidenceId) ?? { ref: ref(c.evidenceId), atIso: e?.atIso, sourceAtIso: e?.sourceAtIso, plcCycle: e?.plcCycle, values: [] };
      g.values.push({ signal: c.signal, value: fmtValue(c.equals), matches: e?.values ? e.values[c.signal] === c.equals : undefined });
      groups.set(c.evidenceId, g);
    }
    const review = f.review ?? "unreviewed";
    return { id: f.id, title: f.title, experimentId: f.experimentId, priority: "Not supplied in the campaign record",
      review: review === "accepted" ? "Accepted by engineer" : review === "rerun_requested" ? "Rerun requested by engineer" : "Unreviewed",
      reviewTone: review === "accepted" ? "ok" : review === "rerun_requested" ? "warn" : "neutral",
      claimGroups: [...groups.values()], claimCount: f.claims.length, inference: f.inference, assumptions: f.assumptions, uncertainty: f.uncertainty,
      injected: f.injectedTruthRefs.map(id => ({ ref: ref(id), text: ev[id]?.summary ?? "Injected fault record" })) };
  });

  // ---- HMI assessments
  const defects = bundle.attachments.flatMap(a => a.citationDefects.map(d => ({ ...d, file: a.file })));
  const assessmentViews: AssessmentView[] = assessments.map(a => {
    const d = a.data;
    const frames = d.frameEvidenceRefs.map(id => frameViews.get(id) ?? { id, sequence: ev[id]?.sequence ?? 0, reference: "Not an HMI frame in this record", capturedAtIso: "", recordedAtIso: "", actionId: "",
      supplied: false, suppliedLabel: "Cited reference is not a recorded HMI frame", image: { status: "missing" as const, note: "No frame record for this reference" } });
    // One line per cited frame Muse did not receive, naming any separate file that flags the same citation.
    const flagged = (frameId: string) => defects.filter(x => x.assessmentId === a.id && x.frameId === frameId).map(x => x.file);
    const issues = [
      ...frames.filter(f => !f.supplied).map(f => `Cites ${short(f.id)}: ${f.suppliedLabel.replace(/^Captured only: /, "")}${flagged(f.id).length ? `; also flagged by ${flagged(f.id).join(" and ")}` : ""}.`),
      ...defects.filter(x => x.assessmentId === a.id && !frames.some(f => f.id === x.frameId && !f.supplied)).map(x => `${x.file} records a citation defect for ${short(x.frameId)}.`)
    ];
    return { id: a.id, sequence: ev[a.id]?.sequence, assessmentId: d.id, requirementId: d.requirementId, verdict: d.verdict,
      verdictTone: d.verdict === "pass" ? "ok" : d.verdict === "fail" ? "bad" : "warn",
      review: a.review === "unreviewed" ? "Unreviewed Muse assessment (model-authored)" : `Muse assessment · ${a.review}`,
      observation: d.observation, uncertainty: d.uncertainty, frames,
      actions: d.actionEvidenceRefs.map(id => hmiActionById.get(id)).filter((x): x is HmiActionView => !!x),
      otherActionRefs: refs(d.actionEvidenceRefs.filter(id => !hmiActionById.has(id))),
      plc: d.plcEvidenceRefs.map(id => ev[id] ? valueGroup(ev[id]!, undefined, ref(id)) : { ref: ref(id), values: [] }),
      citationIssues: issues, separateReviews: reviewNotes(d.requirementId) };
  });
  const frames = [...frameViews.values()];
  const supplied = frames.filter(f => f.supplied).length;
  const hmiNote = !frames.length && !hmiActions.length && !assessments.length ? "This campaign record contains no HMI actions, HMI captures or HMI assessments."
    : `${plural(hmiActions.length, "HMI action")} recorded; ${plural(frames.length, "frame")} captured, ${supplied} of them supplied to Muse; ${plural(assessments.length, "assessment")} recorded.`;

  // ---- counts (separate dimensions, no combined rate)
  const n = (s: ExperimentRow["status"]) => experiments.filter(x => x.status === s).length;
  const verdictCount = (v: string) => assessments.filter(a => a.data.verdict === v).length;
  const actionCount = (s: string) => bundle.actions.filter(a => a.status === s).length;
  const noVerdict = requirements.filter(q => !assessments.some(a => a.data.requirementId === q.id)).length;
  const execution = executionView();
  const counts: CountGroup[] = [
    { title: "Campaign execution", note: execution.finalized ? "Recorded run status" : "Run not finalized", items: [{ label: execution.label, value: r.status, tone: execution.tone }] },
    { title: "Experiments", note: experiments.length ? "Experiment conclusions as recorded; observed is not pass" : "No test plan recorded",
      items: [{ label: "Planned", value: experiments.length }, { label: "Observed", value: n("observed"), tone: n("observed") ? "info" : undefined },
      { label: "Inconclusive", value: n("inconclusive"), tone: n("inconclusive") ? "warn" : undefined }, { label: "Not run", value: n("not_run"), tone: n("not_run") ? "warn" : undefined },
      ...(n("running") ? [{ label: "Interrupted", value: n("running"), tone: "warn" as Tone }] : [])] },
    { title: "Requirement verdicts", note: assessments.length ? "Muse-recorded assessments; unreviewed unless stated" : "None recorded; experiments report observations only",
      items: [{ label: "Pass", value: verdictCount("pass"), tone: verdictCount("pass") ? "ok" : undefined }, { label: "Fail", value: verdictCount("fail"), tone: verdictCount("fail") ? "bad" : undefined },
        { label: "Inconclusive", value: verdictCount("inconclusive"), tone: verdictCount("inconclusive") ? "warn" : undefined }, { label: "No verdict", value: noVerdict }] },
    { title: "Findings", note: "Engineer review state in the campaign record", items: [{ label: "Recorded", value: findings.length },
      { label: "Unreviewed", value: findings.filter(f => f.review === "Unreviewed").length }, { label: "Accepted", value: findings.filter(f => f.review.startsWith("Accepted")).length }] },
    { title: "Muse actions", note: "Tool calls, counted by outcome", items: [{ label: "Applied", value: actionCount("applied") }, { label: "Refused", value: actionCount("rejected"), tone: actionCount("rejected") ? "bad" : undefined },
      { label: "Timed out", value: actionCount("timed_out"), tone: actionCount("timed_out") ? "warn" : undefined },
      ...(actionCount("stale") + actionCount("inconclusive") + actionCount("requested") ? [{ label: "Stale / inconclusive / unresolved", value: actionCount("stale") + actionCount("inconclusive") + actionCount("requested"), tone: "warn" as Tone }] : [])] }
  ];

  // ---- attention, headline, recommendations, remaining work
  const missingImages = Object.values(bundle.media).filter(m => m.status === "missing" || m.status === "hash_mismatch");
  const unknownRefs = [...new Set([...r.experiments.flatMap(x => x.evidenceRefs ?? []), ...r.findings.flatMap(f => f.claims.map(c => c.evidenceId))])].filter(id => !ev[id]);
  const refused = bundle.actions.filter(a => a.status !== "applied");
  const attention: ReportView["attention"] = [];
  if (execution.interrupted) attention.push({ tone: r.status === "failed" ? "bad" : "warn", text: `Run ${r.status} before completion. ${execution.detail}` });
  if (!finalized) attention.push({ tone: "info", text: "Campaign still in progress; this report reflects the record so far and will change." });
  for (const x of experiments.filter(x => x.status !== "observed")) attention.push({ tone: "warn", text: `${x.id}: ${x.statusLabel.toLowerCase()}${x.requirements.length ? ` (${x.requirements.join(", ")})` : ""}.` });
  for (const a of assessmentViews.filter(a => a.verdict !== "pass")) attention.push({ tone: a.verdictTone, text: `${a.requirementId} assessed ${a.verdict} by Muse (${a.assessmentId}).` });
  for (const a of assessmentViews) for (const issue of a.citationIssues) attention.push({ tone: "warn", text: `${a.assessmentId} (${a.requirementId}): ${issue}` });
  if (refused.length) attention.push({ tone: "warn", text: `${plural(refused.length, "Muse action")} did not apply: ${refused.map(a => `${a.actionId} ${STATUS[a.status]?.[0] ?? a.status}`).join(", ")}.` });
  if (outsideDiscrepancies.length) attention.push({ tone: "warn", text: `${plural(outsideDiscrepancies.length, "discrepancy", "discrepancies")} recorded outside an active experiment.` });
  if (missingImages.length) attention.push({ tone: "warn", text: `${plural(missingImages.length, "cited image")} not available in this report; placeholders keep their references.` });
  if (unknownRefs.length) attention.push({ tone: "warn", text: `${plural(unknownRefs.length, "cited reference")} not found in the ledger: ${unknownRefs.map(short).join(", ")}.` });
  if (bundle.reportIntegrity.matchesLedgerReconstruction === false) attention.push({ tone: "bad", text: "The saved report does not match a reconstruction from its ledger. Treat the report as unverified." });
  const unreviewedFindings = findings.filter(f => f.review === "Unreviewed").length;
  if (unreviewedFindings) attention.push({ tone: "neutral", text: `${plural(unreviewedFindings, "finding")} awaiting engineer review in the campaign record.` });
  for (const q of bundle.modelRequests.filter(q => q.phase !== "completed"))
    attention.push({ tone: "warn", text: `Model request ${q.requestId} (${q.experimentId}) ${q.phase}${q.exchange?.responseReturned ? "; a response was returned but its decision was not applied" : ""}.` });

  const headline: string[] = [];
  const total = experiments.length, concluded = n("observed") + n("inconclusive");
  headline.push(r.status === "completed" ? `Run completed${ended ? ` ${fmtTime(ended).slice(0, 10)}` : ""} after ${fmtDuration(between(started, ended))}.`
    : execution.interrupted ? `Run ${r.status} early${started && ended ? ` after ${fmtDuration(between(started, ended))}` : ""}${concluded ? "" : ", before any experiment reached a conclusion"}.`
    : `Run ${r.status}; report not finalized.`);
  headline.push(!total ? "No test plan or experiment was recorded." : `${concluded} of ${plural(total, "planned experiment")} reached a recorded conclusion (${n("observed")} observed, ${n("inconclusive")} inconclusive)${n("not_run") + n("running") ? `; ${n("not_run") + n("running")} did not` : ""}.`);
  headline.push(assessments.length ? `Muse recorded ${plural(assessments.length, "requirement assessment")}: ${["pass", "fail", "inconclusive"].map(v => `${verdictCount(v)} ${v}`).join(", ")}; ${assessments.every(a => a.review === "unreviewed") ? "none reviewed in the campaign record" : "see review state"}.`
    : "No requirement verdict was recorded; experiments report observations only.");
  headline.push(findings.length ? `${plural(findings.length, "finding")} with ${plural(findings.reduce((s, f) => s + f.claimCount, 0), "exact PLC claim")}; ${unreviewedFindings} unreviewed.` : "No finding was recorded.");
  if (bundle.attachments.length) headline.push(`Separate review files attached: ${bundle.attachments.map(a => `${a.file} (${a.status.replaceAll("_", " ")})`).join("; ")}.`);

  const recommendations: string[] = [];
  if (execution.interrupted) recommendations.push(`Resolve the stop cause and re-run: ${execution.detail}`);
  if (!total) recommendations.push("Re-run the campaign to obtain a recorded test plan; nothing was tested in this record.");
  for (const x of experiments.filter(x => x.status === "not_run" || x.status === "running")) recommendations.push(`Run ${x.id}${x.requirements.length ? ` (${x.requirements.join(", ")})` : ""}; it has no concluded evidence.`);
  for (const x of experiments.filter(x => x.status === "inconclusive")) recommendations.push(`Define and apply a stimulus that exercises ${x.requirements.join(", ") || x.id}, then re-run ${x.id}; its recorded conclusion is inconclusive.`);
  for (const a of assessmentViews.filter(a => a.citationIssues.length)) recommendations.push(`Re-review ${a.assessmentId} (${a.requirementId}) against only the frames Muse actually received.`);
  if (refused.length) recommendations.push(`Review the ${plural(refused.length, "action")} that did not apply before relying on the affected sequence.`);
  const criteriaGaps = reqIds.filter(id => !assessments.some(a => a.data.requirementId === id));
  if (criteriaGaps.length) recommendations.push(`Define acceptance criteria for ${criteriaGaps.join(", ")} so observations can become requirement verdicts.`);
  if (unreviewedFindings || assessments.some(a => a.review === "unreviewed")) recommendations.push("Engineer review: accept or request a rerun for each unreviewed finding and assessment.");
  if (missingImages.length) recommendations.push(`Recover or re-capture ${plural(missingImages.length, "cited image")} missing from this package.`);

  const remaining: ReportView["remaining"] = [
    { title: "Not run or interrupted", items: experiments.filter(x => x.status === "not_run" || x.status === "running").map(x => `${x.id}: ${x.objective}`) },
    { title: "Inconclusive", items: [...experiments.filter(x => x.status === "inconclusive").map(x => `${x.id}: ${x.objective}`), ...assessmentViews.filter(a => a.verdict === "inconclusive").map(a => `${a.requirementId} (${a.assessmentId}): ${a.uncertainty}`)] },
    { title: "Actions that did not apply", items: refused.map(a => `${a.actionId} (${a.name.replaceAll("_", " ")}) ${STATUS[a.status]?.[0] ?? a.status}: ${a.message ?? ""}`) },
    { title: "Missing evidence", items: [...missingImages.map(m => `Image ${m.sha256.slice(0, 12)}…: ${m.note}`), ...unknownRefs.map(id => `${short(id)} cited but not in the ledger`)] },
    { title: "Scope limits", items: [r.claimBoundary, r.coverage, ...outsideDiscrepancies].filter((x): x is string => !!x) }
  ];

  // ---- final recorded state
  const fo = bundle.final.plcOutput;
  const finalState = fo ? {
    note: finalized ? `Last PLC output recorded in this campaign, at ${fmtTime(fo.atIso)}. Historical: this report does not monitor current PLC state or freshness.`
      : `Latest PLC output recorded so far (${fmtTime(fo.atIso)}). The campaign is still running; this is not a freshness monitor.`,
    atIso: fo.atIso, sourceAtIso: fo.sourceAtIso, plcCycle: fo.plcCycle, bootIdentity: fo.bootIdentity,
    connector: bundle.final.connector ? `${bundle.final.connector.state} — ${bundle.final.connector.reason} (recorded ${fmtTime(bundle.final.connector.atIso)})` : undefined,
    values: Object.entries(fo.values).map(([k, v]) => [k, fmtValue(v)] as [string, string])
  } : undefined;

  // ---- accounting
  const budget = r.budget;
  const bases = [...new Set(Object.values(budget?.requests ?? {}).map(x => String((x as { basis?: string }).basis ?? "")).filter(Boolean))];
  const reservationNote = bases.includes("conservative_reservation") ? "Conservative reservations are admission accounting held before each model request. They are not spend and not an invoice."
    : bases.includes("fake_zero") ? "Fixture provider: zero-cost accounting." : bases.length ? `Accounting basis: ${bases.join(", ")}.` : "No accounting records.";
  const sum = (k: "input" | "cachedInput" | "output" | "reasoning") => bundle.modelRequests.reduce((s, q) => s + (q.tokens?.[k] ?? 0), 0);
  const priced = bundle.modelRequests.filter(q => q.tokens?.input !== undefined && q.tokens.output !== undefined && q.exchange?.pricing);
  const estimate = priced.reduce((s, q) => s + (q.tokens!.input! * q.exchange!.pricing!.inputUsdPerMillion + q.tokens!.output! * q.exchange!.pricing!.outputUsdPerMillion) / 1e6, 0);
  const pricing = priced[0]?.exchange?.pricing;
  const phases = Object.entries(bundle.modelRequests.reduce<Record<string, number>>((m, q) => ({ ...m, [q.phase]: (m[q.phase] ?? 0) + 1 }), {})).map(([k, v]) => `${v} ${k}`).join(", ");
  const accounting = {
    reservations: budget ? [{ label: "This campaign", value: usd(budget.campaignUsd) }, { label: "Session total (includes earlier campaigns)", value: usd(budget.sessionUsd) },
      ...Object.entries(budget.checks).map(([k, v]) => ({ label: `Held for ${k}`, value: usd(v) }))] : [{ label: "Reservations", value: UNAVAILABLE, unavailable: true }],
    reservationNote,
    tokens: [{ label: "Model requests", value: bundle.modelRequests.length ? `${bundle.modelRequests.length} (${phases})` : "none" }, { label: "Input tokens", value: sum("input").toLocaleString("en-US") },
      { label: "of which cached", value: sum("cachedInput").toLocaleString("en-US") }, { label: "Output tokens", value: sum("output").toLocaleString("en-US") }, { label: "of which reasoning", value: sum("reasoning").toLocaleString("en-US") }],
    estimates: [
      ...(priced.length ? [{ label: `Estimate at uncached list rates (${priced.length} of ${bundle.modelRequests.length} requests priced)`, value: `≈ $${estimate.toFixed(4)}` }] : []),
      ...bundle.attachments.filter(a => a.estimatedUncachedTokenCostUsd !== undefined).map(a => ({ label: `Estimate stated in ${a.file}`, value: `≈ $${a.estimatedUncachedTokenCostUsd!.toFixed(4)}` }))
    ],
    estimateNote: priced.length ? `Token-cost estimates use the pricing recorded with each request (${pricing?.inputUsdPerMillion}/${pricing?.outputUsdPerMillion} USD per million input/output tokens${pricing?.checkedOn ? `, checked ${pricing.checkedOn}` : ""}). Estimates, not the invoice; caching and billing can differ.`
      : "No pricing record is attached, so no token-cost estimate is made. Reservations above are not spend."
  };

  // ---- identity, integrity and appendix
  const p = r.provenance ?? {};
  const identity: Fact[] = [
    { label: "Campaign", value: r.campaignId, mono: true },
    ...(bundle.context.title ? [{ label: "Report title", value: bundle.context.title }] : []),
    { label: "Machine", value: "Name not recorded in the campaign record; identified by the specification and I/O map below", unavailable: true },
    { label: "Evidence class", value: evidence.label }, { label: "Report source", value: context },
    ...(bundle.context.factoryLabel ? [{ label: "Host campaign factory", value: bundle.context.factoryLabel }] : []),
    { label: "Started", value: fmtTime(started ?? bundle.ledger.firstAtIso), unavailable: !started && !bundle.ledger.firstAtIso },
    { label: "Ended", value: ended ? fmtTime(ended) : "Not ended", unavailable: !ended }, { label: "Duration", value: fmtDuration(between(started, ended)), unavailable: !(started && ended) },
    ...([["plcBuild", "Controller build"], ["worldModule", "World module"], ["spec", "Specification"], ["ioMap", "I/O map"], ["model", "Model"], ["connector", "Connector"]] as const)
      .map(([k, l]) => ({ label: l, value: p[k] ?? UNAVAILABLE, mono: Boolean(p[k]), unavailable: !p[k] })),
    { label: "PLC boot identity", value: bundle.ledger.bootIdentities.join(" → ") || UNAVAILABLE, mono: bundle.ledger.bootIdentities.length > 0, unavailable: !bundle.ledger.bootIdentities.length },
    { label: "Authorized scope", value: bundle.ledger.authorized ? `${bundle.ledger.authorized.categories.join(", ")} · ${bundle.ledger.authorized.diagnosisMode} diagnosis` : UNAVAILABLE, unavailable: !bundle.ledger.authorized }
  ];
  const integrity: Fact[] = [
    { label: "Report", value: bundle.reportIntegrity.source === "saved_file" ? `report.json${bundle.reportIntegrity.sha256 ? ` sha256 ${bundle.reportIntegrity.sha256}` : ""}` : "Generated by the host from its in-memory ledger", mono: true },
    ...(bundle.reportIntegrity.matchesLedgerReconstruction === undefined ? [] : [{ label: "Matches reconstruction from ledger", value: bundle.reportIntegrity.matchesLedgerReconstruction ? "yes" : "NO" }]),
    { label: "Ledger", value: `${bundle.ledger.eventCount.toLocaleString("en-US")} events · head ${bundle.ledger.headHash?.slice(0, 16) ?? "?"}… · tail ${bundle.ledger.tailHash?.slice(0, 16) ?? "?"}…`, mono: true },
    { label: "Recorded span", value: `${fmtTime(bundle.ledger.firstAtIso)} → ${fmtTime(bundle.ledger.lastAtIso)}` },
    { label: "Report generated", value: fmtTime(bundle.generatedAtIso) }
  ];
  const evidenceRows: EvidenceRow[] = Object.values(ev).sort((a, b) => a.sequence - b.sequence).map(e => ({ id: e.id, sequence: e.sequence, type: TYPE_LABEL[e.type] ?? e.type, atIso: e.atIso,
    sourceAtIso: e.sourceAtIso, summary: e.summary, plcCycle: e.plcCycle, bootIdentity: e.bootIdentity, values: Object.entries(e.values ?? {}).map(([k, v]) => [k, fmtValue(v)] as [string, string]) }));
  const modelTrail: ModelRow[] = bundle.modelRequests.map(q => ({ requestId: q.requestId, experimentId: q.experimentId, phase: q.phase, tone: q.phase === "completed" ? "ok" : q.phase === "started" ? "info" : "warn",
    startedAtIso: q.startedAtIso, elapsed: q.elapsedMs === undefined ? "—" : fmtDuration(q.elapsedMs),
    tokens: q.tokens ? `${q.tokens.input?.toLocaleString("en-US") ?? "?"} in (${q.tokens.cachedInput?.toLocaleString("en-US") ?? 0} cached) · ${q.tokens.output?.toLocaleString("en-US") ?? "?"} out` : "not recorded",
    decision: q.decision,
    exchange: q.exchange ? `${q.exchange.responseReturned ? "response returned" : "no response recorded"}${q.phase !== "completed" && q.exchange.responseReturned ? ` but request ${q.phase}` : ""} · ${plural(q.exchange.imageInputs, "image input")}` : undefined }));

  return {
    title: bundle.context.title ?? "Bench test report", campaignId: r.campaignId, objective: r.plan?.objective, generatedAtIso: bundle.generatedAtIso,
    source: { evidenceClass: r.evidenceClass ?? "", evidenceLabel: evidence.label, evidenceTag: evidence.tag, context, historical, claimBoundary: r.claimBoundary, coverage: r.coverage },
    execution, headline, attention, counts, identity,
    // Muse writes the summary only through finish_campaign; otherwise the runtime wrote the finalization note.
    finalization: r.finalization?.summary ? { text: r.finalization.summary, author: bundle.actions.some(a => a.name === "finish_campaign" && a.status === "applied") ? "muse" : "runtime" } : undefined,
    experiments, campaignActions, requirements, findings,
    hmi: { note: hmiNote, assessments: assessmentViews, actions: hmiActions, frames, captured: frames.length, supplied },
    recommendations, remaining: remaining.filter(x => x.items.length), finalState, accounting,
    attachments: bundle.attachments, evidence: evidenceRows, ledgerEventCount: bundle.ledger.eventCount, modelTrail, integrity, diagnostics: bundle.diagnostics,
    sources: bundle.sources.map(s => s.embeddedBase64 && !SAFE_DOWNLOAD.test(s.embeddedBase64) ? { ...s, embeddedBase64: undefined } : { ...s, contentType: s.embeddedBase64 ? "application/json" : s.contentType })
  };

  function executionView(): ReportView["execution"] {
    const transitions = states.filter(s => !["preparing", "running"].includes(s.state));
    const detail = r.status === "completed" ? `Completed ${fmtTime(ended)}.`
      : transitions.length ? transitions.map(s => `${s.state[0]!.toUpperCase()}${s.state.slice(1)}: ${s.reason}`).join(" → ") : "No terminal state recorded.";
    switch (r.status) {
      case "completed": return { status: r.status, label: "Run completed", tone: "info", detail, interrupted: false, finalized };
      case "stopped": return { status: r.status, label: "Stopped before completion", tone: "warn", detail, interrupted: true, finalized };
      case "failed": return { status: r.status, label: "Run failed", tone: "bad", detail, interrupted: true, finalized };
      default: return { status: r.status, label: r.status === "paused" ? "Paused" : r.status === "preparing" ? "Preparing" : "In progress", tone: "info", detail, interrupted: false, finalized };
    }
  }
}

function valueGroup(e: EvidenceItem, signals: string[] | undefined, ref: RefView): ValueGroup {
  const entries = Object.entries(e.values ?? {}).filter(([k]) => !signals?.length || signals.includes(k));
  return { ref, atIso: e.atIso, sourceAtIso: e.sourceAtIso, plcCycle: e.plcCycle, values: entries.map(([signal, v]) => ({ signal, value: fmtValue(v) })) };
}

function discrepancy(o: { summary: string; expected?: string; evidenceRefs: string[] }): string {
  const expected = (() => { try { const x = JSON.parse(o.expected ?? ""); return x && typeof x === "object" && "signal" in x ? `${String(x.signal)} = ${String(x.equals)}` : o.expected; } catch { return o.expected; } })();
  return `${o.summary}${expected ? ` (expected ${expected})` : ""} ${o.evidenceRefs.map(short).join(", ")}`.trim();
}
