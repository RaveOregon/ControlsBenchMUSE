// Campaign page reading: outcome headline, expected beside recorded result, review state, and the
// prepared-plan context taken from the campaign's own ledger records. Observations are never passes.
import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignEnvelope, ProjectionView } from "../../src/host/protocol.ts";
import { campaignReview, contextFromEnvelope, recordIsFor } from "../src/model/campaign-review.ts";

const exp = (id: string, status: "proposed" | "running" | "completed", conclusion?: string) => ({ id, objective: id === "sort-a" ? "sort-a" : `Objective of ${id}`, category: "functional", requirements: [], status, ...(conclusion ? { conclusion, evidenceRefs: [`c:${id.length}`] } : {}) });
const finding = (id: string, experimentId: string, review: "unreviewed" | "accepted" | "rerun_requested") => ({ id, title: `Finding ${id}`, experimentId, review, inference: "inferred", assumptions: ["a"], uncertainty: "u", injectedTruthRefs: [],
  claims: [{ evidenceId: "c:493", signal: "Motor_RunCmd", equals: true }, { evidenceId: "c:493", signal: "controller.FaultText", equals: "" }, { evidenceId: "c:600", signal: "controller.Mode", equals: 1 }] });
function projection(status: ProjectionView["status"], experiments: ReturnType<typeof exp>[], findings: ReturnType<typeof finding>[]): ProjectionView {
  return { campaignId: "c", sequence: 1, status, revision: 1, experiments: Object.fromEntries(experiments.map(e => [e.id, e])), actions: {}, findings: Object.fromEntries(findings.map(f => [f.id, f])),
    rawImage: {}, outputs: {}, budget: { campaignUsd: 0, sessionUsd: 0, checks: {}, repairs: {}, requests: {} } } as ProjectionView;
}

test("a finished campaign reads as recorded observations with findings awaiting review, not passes", () => {
  const r = campaignReview(projection("completed", [exp("sort-a", "completed", "observed"), exp("sort-b", "completed", "observed"), exp("jam", "completed", "inconclusive"), exp("late", "proposed")],
    [finding("F-A", "sort-a", "accepted"), finding("F-B", "sort-b", "unreviewed")]));
  assert.equal(r.headline, "Completed: 3 of 4 checks recorded an observation (1 inconclusive, 1 not run).");
  assert.equal(r.findingsLine, "2 findings: 1 needs your review, 1 accepted.");
  assert.deepEqual(r.checks.map(c => [c.id, c.statusLabel, c.reviewLabel]), [["sort-a", "Observed", "Accepted"], ["sort-b", "Observed", "Needs your review"], ["jam", "Inconclusive", "No finding"], ["late", "Not run", "No finding"]]);
  assert.equal(r.checks[0]!.result, "Finding F-A"); assert.match(r.checks[2]!.result, /did not settle/);
  assert.deepEqual(r.findings.map(f => f.id), ["F-B", "F-A"], "findings needing review come first");
  assert.deepEqual(r.findings[0]!.groups.map(g => [g.evidenceId, g.values.map(v => `${v.signal}=${v.value}`).join(",")]), [["c:493", 'Motor_RunCmd=true,controller.FaultText=""'], ["c:600", "controller.Mode=1"]]);
  assert.ok(!JSON.stringify(r).match(/\bpass(ed)?\b/i), "nothing is called a pass");
});

test("a running campaign shows progress and waiting checks", () => {
  const r = campaignReview(projection("running", [exp("a", "completed", "observed"), exp("b", "running"), exp("c", "proposed")], []));
  assert.equal(r.headline, "Running: 1 of 3 checks recorded; now b.");
  assert.deepEqual(r.checks.map(c => c.statusLabel), ["Observed", "Running", "Waiting to run"]);
  assert.equal(r.findingsLine, "No findings written yet.");
});

test("expectations come only from the plan recorded before Start; later checks are marked as added", () => {
  const env = (seq: number, source: Record<string, unknown>): CampaignEnvelope => ({ schemaVersion: "controlsbench.campaign.v1", campaignId: "c", id: `c:${seq}`, sequence: seq, atIso: "2026-11-05T00:00:00Z",
    type: "world.evidence", visibility: "truth", data: { source }, previousHash: "", hash: "h" });
  let context = contextFromEnvelope(env(4, { kind: "selected_project", projectId: "p-1", projectName: "Slow belt", version: "v1", projectKind: "uploaded" }));
  context = contextFromEnvelope(env(5, { kind: "prepared_plan", author: "Muse Wonder 1.0", checks: [{ id: "R-02", title: "Normal A sort", stimulus: "Assign A; release one carton",
    expectedObservation: "MUST: D1 actuates in time, one A completion", expectedBasis: "specified", sourceRefs: ["§9 R-02"] }] }), context);
  assert.deepEqual(context.project, { id: "p-1", name: "Slow belt", version: "v1", kind: "uploaded" });
  assert.equal(recordIsFor(context, { projectId: "p-1", version: "v1" }), true);
  assert.equal(recordIsFor(context, { projectId: "p-2", version: "v1" }), false, "another project's record (same check ids) does not describe this plan");
  assert.equal(recordIsFor(context, { projectId: "p-1", version: "v2" }), false, "nor does another version's");
  assert.equal(recordIsFor({}, { projectId: "p-1", version: "v1" }), true, "a record without a selected project cannot be told apart");
  const r = campaignReview(projection("completed", [exp("R-02", "completed", "observed"), exp("FOLLOWUP-1", "completed", "observed")], []), context);
  assert.equal(r.checks[0]!.expected?.expectedObservation, "MUST: D1 actuates in time, one A completion");
  assert.equal(r.checks[0]!.addedDuringRun, false);
  assert.equal(r.checks[1]!.expected, undefined); assert.equal(r.checks[1]!.addedDuringRun, true);
  assert.equal(campaignReview(projection("completed", [exp("sort-a", "completed", "observed")], [])).checks[0]!.addedDuringRun, false, "without a prepared plan nothing is labelled added");
});
