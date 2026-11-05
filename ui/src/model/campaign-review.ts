// Plain-language reading of a campaign for the Campaign page: what ran, what each check was
// expected to show (only when an expectation was recorded before the run), what was recorded, and
// which findings still need the engineer's review. It never turns an observation into a pass.

import type { CampaignEnvelope, ProjectionView } from "../../../src/host/protocol.ts";

export interface PreparedExpectation { title: string; stimulus: string; expectedObservation: string; expectedBasis: "specified" | "unspecified"; sourceRefs: string[] }
export interface CampaignContext {
  project?: { id: string; name: string; version: string; kind: string };
  prepared?: { author: string; checks: Record<string, PreparedExpectation> };
}

/** Project identity and the plan prepared before Start, from the campaign's own ledger records. */
export function contextFromEnvelope(env: CampaignEnvelope, current: CampaignContext = {}): CampaignContext {
  if (env.type !== "world.evidence") return current;
  const s = (env.data.source ?? {}) as Record<string, unknown>;
  if (s.kind === "selected_project") return { ...current, project: { id: String(s.projectId ?? ""), name: String(s.projectName ?? s.projectId ?? ""), version: String(s.version ?? ""), kind: String(s.projectKind ?? "") } };
  if (s.kind === "prepared_plan" && Array.isArray(s.checks)) {
    const checks: Record<string, PreparedExpectation> = {};
    for (const c of s.checks as Array<Record<string, unknown>>) checks[String(c.id)] = { title: String(c.title ?? ""), stimulus: String(c.stimulus ?? ""),
      expectedObservation: String(c.expectedObservation ?? ""), expectedBasis: c.expectedBasis === "specified" ? "specified" : "unspecified", sourceRefs: Array.isArray(c.sourceRefs) ? c.sourceRefs.map(String) : [] };
    return { ...current, prepared: { author: String(s.author ?? ""), checks } };
  }
  return current;
}

/**
 * Whether the campaign record describes this project version. A record left from another project
 * (often with the same check ids) must not report outcomes for the newly selected plan. Records
 * without a selected-project entry cannot be told apart and are taken as current.
 */
export function recordIsFor(context: CampaignContext | undefined, active: { projectId: string; version: string } | null | undefined): boolean {
  return !context?.project || (Boolean(active) && context.project.id === active!.projectId && context.project.version === active!.version);
}

export type CheckStatus = "queued" | "running" | "observed" | "inconclusive" | "not_run";
export type ReviewState = "needs_review" | "accepted" | "rerun" | "no_finding";
export interface CheckRow {
  id: string; objective: string; category: string; status: CheckStatus; statusLabel: string; expected?: PreparedExpectation; addedDuringRun: boolean;
  result: string; review: ReviewState; reviewLabel: string; evidenceRefs: string[]; findingIds: string[];
}
export interface FindingCard {
  id: string; title: string; experimentId: string; review: ReviewState; reviewLabel: string; inference: string; uncertainty: string; assumptions: string[];
  injectedTruthRefs: string[]; claimCount: number; groups: Array<{ evidenceId: string; values: Array<{ signal: string; value: string }> }>; expected?: PreparedExpectation;
}
export interface CampaignReview { status: string; finished: boolean; headline: string; findingsLine: string; checks: CheckRow[]; findings: FindingCard[]; needsReview: number }

const TERMINAL = ["completed", "stopped", "failed"];
const STATUS_LABEL: Record<CheckStatus, string> = { queued: "Waiting to run", running: "Running", observed: "Observed", inconclusive: "Inconclusive", not_run: "Not run" };
const REVIEW_LABEL: Record<ReviewState, string> = { needs_review: "Needs your review", accepted: "Accepted", rerun: "Rerun flagged", no_finding: "No finding" };
const reviewOf = (r: string): ReviewState => r === "accepted" ? "accepted" : r === "rerun_requested" ? "rerun" : "needs_review";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function campaignReview(p: ProjectionView | undefined, context: CampaignContext = {}): CampaignReview {
  const status = p?.status ?? "preparing", finished = TERMINAL.includes(status);
  const findings = Object.values(p?.findings ?? {});
  const checks: CheckRow[] = Object.values(p?.experiments ?? {}).map(e => {
    const s: CheckStatus = e.status === "completed" ? (e.conclusion === "inconclusive" ? "inconclusive" : "observed") : e.status === "running" ? "running" : finished ? "not_run" : "queued";
    const mine = findings.filter(f => f.experimentId === e.id);
    const review: ReviewState = !mine.length ? "no_finding" : mine.some(f => f.review === "rerun_requested") ? "rerun" : mine.every(f => f.review === "accepted") ? "accepted" : "needs_review";
    const result = mine.length ? mine.map(f => f.title).join("; ")
      : s === "observed" ? "PLC response recorded; no finding written" : s === "inconclusive" ? "Recorded, but the evidence did not settle it" : s === "running" ? "In progress" : s === "queued" ? "Not started yet" : "Not run before the campaign ended";
    return { id: e.id, objective: e.objective, category: e.category, status: s, statusLabel: STATUS_LABEL[s], expected: context.prepared?.checks[e.id],
      addedDuringRun: Boolean(context.prepared) && !context.prepared!.checks[e.id], result, review, reviewLabel: REVIEW_LABEL[review], evidenceRefs: e.evidenceRefs ?? [], findingIds: mine.map(f => f.id) };
  });
  const cards: FindingCard[] = findings.map(f => {
    const groups = new Map<string, Array<{ signal: string; value: string }>>();
    for (const c of f.claims) groups.set(c.evidenceId, [...(groups.get(c.evidenceId) ?? []), { signal: c.signal, value: typeof c.equals === "string" ? (c.equals || '""') : String(c.equals) }]);
    const review = reviewOf(f.review);
    return { id: f.id, title: f.title, experimentId: f.experimentId, review, reviewLabel: REVIEW_LABEL[review], inference: f.inference, uncertainty: f.uncertainty, assumptions: f.assumptions,
      injectedTruthRefs: f.injectedTruthRefs, claimCount: f.claims.length, groups: [...groups].map(([evidenceId, values]) => ({ evidenceId, values })), expected: context.prepared?.checks[f.experimentId] };
  });
  // Findings that still need review come first.
  cards.sort((a, b) => Number(b.review === "needs_review") - Number(a.review === "needs_review"));
  const n = (s: CheckStatus) => checks.filter(c => c.status === s).length;
  const recorded = n("observed") + n("inconclusive"), total = checks.length;
  const extras = [n("inconclusive") && `${n("inconclusive")} inconclusive`, n("not_run") && `${n("not_run")} not run`].filter(Boolean).join(", ");
  const running = checks.find(c => c.status === "running");
  const headline = !total ? (finished ? `${status === "completed" ? "Completed" : "Ended"} without any recorded check.` : "Preparing: no check has started yet.")
    : !finished ? `Running: ${recorded} of ${plural(total, "check")} recorded${running ? `; now ${running.id}` : ""}.`
    : `${status === "completed" ? "Completed" : status === "failed" ? "Failed" : "Stopped before completion"}: ${recorded} of ${plural(total, "check")} recorded an observation${extras ? ` (${extras})` : ""}.`;
  const needsReview = cards.filter(c => c.review === "needs_review").length, accepted = cards.filter(c => c.review === "accepted").length, rerun = cards.filter(c => c.review === "rerun").length;
  const findingsLine = !cards.length ? "No findings written yet." : `${plural(cards.length, "finding")}: ${[needsReview && `${needsReview} need${needsReview === 1 ? "s" : ""} your review`, accepted && `${accepted} accepted`, rerun && `${rerun} flagged for rerun`].filter(Boolean).join(", ")}.`;
  return { status, finished, headline, findingsLine, checks, findings: cards, needsReview };
}
