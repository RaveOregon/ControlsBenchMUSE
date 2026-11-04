// Bench report presentation over the saved W4, S2 and partial exports, plus synthetic edge cases:
// separate count dimensions, completed-but-inconclusive, partial runs, absent HMI data, missing
// media, the screenshot-capture versus supplied-to-Muse distinction, and safe rendering.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ReportBundle } from "../../src/report/bundle.ts";
import { buildReportView, safeImageSrc, type ReportView } from "../src/report/view-model.ts";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(`${repo}artifacts/bench-report/saved-exports/${name}/report-bundle.json`, "utf8")) as ReportBundle;
const W4 = load("w4-adaptive-plc-investigation"), S2 = load("s2-hmi-operator-trial"), PARTIAL = load("s2-first-attempt-partial");
const count = (v: ReportView, group: string, label: string) => v.counts.find(g => g.title === group)!.items.find(i => i.label === label)?.value;
const everyText = (v: ReportView) => JSON.stringify(v);

test("W4: adaptive PLC investigation keeps observations, findings and refused actions separate from requirement verdicts", () => {
  const v = buildReportView(W4);
  assert.equal(v.campaignId, "portal-20261103131442735-1");
  assert.equal(v.execution.label, "Run completed");
  assert.deepEqual(v.experiments.map(x => [x.id, x.status, x.origin]), [["EXP-FAULT-DRIVEFB-01", "observed", "Planned"], ["EXP-ADAPT-D1CONTRA-02", "observed", "Adaptive follow-up (added from evidence)"]]);
  assert.ok(v.experiments.every(x => /not a pass verdict/.test(x.statusLabel)), "a completed experiment is not a passing requirement");
  assert.ok(v.experiments.every(x => /No explicit acceptance criterion/.test(x.expected)), "no expected behaviour is invented");
  assert.deepEqual([count(v, "Requirement verdicts", "Pass"), count(v, "Requirement verdicts", "Fail"), count(v, "Requirement verdicts", "No verdict")], [0, 0, 3]);
  assert.deepEqual(v.requirements.map(r => [r.id, r.verdictLabel]), [["R-11", "No verdict recorded"], ["R-15", "No verdict recorded"], ["R-18", "No verdict recorded"]]);
  assert.equal(v.findings.length, 2);
  assert.equal(v.findings.reduce((s, f) => s + f.claimCount, 0), 31, "31 exact claims");
  assert.ok(v.findings.every(f => f.claimGroups.every(g => g.values.every(c => c.matches === true))), "each claim matches its cited PLC output");
  assert.ok(v.findings.every(f => f.review === "Unreviewed" && f.priority.startsWith("Not supplied")));
  assert.deepEqual([count(v, "Muse actions", "Refused"), count(v, "Muse actions", "Timed out")], [2, 2]);
  assert.ok(v.attention.some(a => /4 Muse actions did not apply/.test(a.text)));
  assert.equal(v.hmi.assessments.length, 0);
  assert.equal(v.hmi.note, "This campaign record contains no HMI actions, HMI captures or HMI assessments.", "not presented as HMI-operated");
  assert.equal(v.finalization?.author, "muse");
  assert.ok(v.attachments.some(a => a.file === "engineering-review.json" && a.status === "pass"));
  const estimate = Number(/\$([\d.]+)/.exec(v.accounting.estimates[0]!.value)![1]);
  assert.ok(Math.abs(estimate - 3.50398) < 0.001, "recorded usage at recorded pricing reproduces the review's estimate");
  assert.match(v.accounting.reservationNote, /not spend/);
  assert.doesNotMatch(everyText(v), /all (PLC )?requirements passed|HMI (was )?never tested/i);
});

test("S2: HMI assessments distinguish frames Muse received from frames only captured, and keep the original assessment unreviewed", () => {
  const v = buildReportView(S2);
  assert.deepEqual(v.experiments.map(x => [x.id, x.status]), [["EXP-HMI-01", "observed"], ["EXP-HMI-02", "observed"], ["EXP-HMI-03", "inconclusive"]], "completed-but-inconclusive stays inconclusive");
  assert.deepEqual(S2.report.untested, [], "the report's untested list alone would hide it");
  assert.deepEqual([count(v, "Experiments", "Observed"), count(v, "Experiments", "Inconclusive"), count(v, "Experiments", "Not run")], [2, 1, 0]);
  assert.deepEqual(v.hmi.assessments.map(a => [a.requirementId, a.verdict]), [["UI-01", "pass"], ["UI-02", "pass"], ["UI-03", "pass"], ["UI-04", "inconclusive"]]);
  assert.ok(v.hmi.assessments.every(a => a.review.startsWith("Unreviewed")), "a separate engineering review does not mark the model assessment reviewed");
  const ui03 = v.hmi.assessments.find(a => a.requirementId === "UI-03")!;
  const received = ui03.frames.find(f => f.id.endsWith(":2798"))!, unseen = ui03.frames.find(f => f.id.endsWith(":2783"))!;
  assert.equal(received.supplied, true);
  assert.match(received.suppliedLabel, /sent to Muse in request-3 \(model exchange log\)/);
  assert.match(received.image.src ?? "", /^data:image\/jpeg;base64,/);
  assert.equal(unseen.supplied, false);
  assert.match(unseen.suppliedLabel, /not among the images sent to Muse/);
  assert.equal(unseen.image.src, undefined);
  assert.match(unseen.image.note, /not preserved/, "missing image keeps a placeholder and its reference");
  assert.equal(ui03.citationIssues.length, 1);
  assert.match(ui03.citationIssues[0]!, /#2783.*s2-audit\.json and engineering-review\.json/);
  assert.ok(ui03.separateReviews.some(s => /engineering-review\.json \(pass_with_limitations, separate artifact\)/.test(s)));
  assert.deepEqual(v.attachments.map(a => [a.file, a.status]), [["s2-audit.json", "reference_review_required"], ["engineering-review.json", "pass_with_limitations"]]);
  assert.equal(v.hmi.captured, 19);
  assert.equal(v.hmi.supplied, 17, "seventeen image inputs were sent");
  assert.ok(v.hmi.actions.length === 6 && v.hmi.actions.every(a => a.trusted === "Trusted page input" && /^applied/.test(a.plc)));
  assert.ok(v.requirements.find(r => r.id === "UI-04")!.verdictLabel.startsWith("inconclusive"));
  assert.ok(v.recommendations.some(r => /UI-04/.test(r)) && v.recommendations.some(r => /ASSESS-UI03-01/.test(r)));
  assert.equal(v.finalState?.bootIdentity, "1787886077538");
  assert.match(v.finalState!.note, /Historical/);
});

test("Partial run: stopped before testing, with no inherited screenshots, verdicts or final state", () => {
  const v = buildReportView(PARTIAL);
  assert.equal(v.execution.label, "Stopped before completion");
  assert.equal(v.execution.interrupted, true);
  assert.match(v.execution.detail, /Paused: Connector stale/);
  assert.equal(v.experiments.length, 0);
  assert.ok(v.headline.includes("No test plan or experiment was recorded."));
  assert.match(v.headline[0]!, /stopped early/);
  assert.equal(count(v, "Requirement verdicts", "Pass"), 0);
  assert.equal(v.hmi.assessments.length, 0);
  assert.equal(v.hmi.frames.length, 1);
  assert.ok(v.hmi.frames.every(f => f.id.startsWith("portal-20261103231427237-1:")));
  assert.equal(v.finalization?.author, "runtime", "the runtime's stop note is not presented as a Muse summary");
  assert.ok(v.attention.some(a => /request-1 \(planning\) cancelled; a response was returned but its decision was not applied/.test(a.text)));
  assert.ok(v.recommendations[0]!.startsWith("Resolve the stop cause"));
  assert.notEqual(v.finalState?.atIso, buildReportView(S2).finalState?.atIso);
  assert.doesNotMatch(everyText(v), /Run completed|UI-0[1-4]: pass/);
});

test("absent optional HMI data, missing or unsafe media and unknown references degrade to explicit placeholders", () => {
  const b = structuredClone(S2);
  delete b.report.hmiAssessments;
  const v = buildReportView(b);
  assert.equal(v.hmi.assessments.length, 0);
  assert.equal(count(v, "Requirement verdicts", "Pass"), 0);
  assert.ok(v.requirements.every(r => r.verdictLabel === "No verdict recorded"));

  const m = structuredClone(S2);
  const shown = [...new Set(buildReportView(S2).hmi.assessments.flatMap(a => a.frames).filter(f => f.image.src).map(f => f.sha256!))];
  const [first, second] = shown;
  assert.ok(first && second);
  m.media[first!] = { ...m.media[first!]!, status: "url", url: "https://example.invalid/track.png", dataUri: undefined };
  m.media[second!] = { ...m.media[second!]!, dataUri: "data:image/svg+xml;base64,PHN2Zy8+" };
  const frames = buildReportView(m).hmi.assessments.flatMap(a => a.frames);
  for (const sha of [first, second]) for (const f of frames.filter(x => x.sha256 === sha)) {
    assert.equal(f.image.src, undefined, "external URLs and non-raster data URIs are never loaded");
    assert.match(f.image.note, /not an allowed/);
  }
  assert.equal(safeImageSrc("/api/hmi/frames/hmi-abc/12"), "/api/hmi/frames/hmi-abc/12");
  assert.equal(safeImageSrc("/api/hmi/frames/../../x"), undefined);
  assert.equal(safeImageSrc("javascript:alert(1)"), undefined);

  const r = structuredClone(W4);
  r.report.findings[0]!.claims.push({ evidenceId: "portal-20261103131442735-1:999999", signal: "Motor_RunCmd", equals: true });
  const view = buildReportView(r);
  assert.ok(view.attention.some(a => /not found in the ledger: #999999/.test(a.text)));
  assert.ok(view.findings[0]!.claimGroups.some(g => !g.ref.known));
});

test("a running host campaign is labelled current and its counts are provisional", () => {
  const b = structuredClone(W4);
  b.context = { kind: "host_current" };
  b.report.status = "running"; delete b.report.finalization;
  b.ledger.states = b.ledger.states.filter(s => s.state !== "completed");
  b.report.experiments[1]!.status = "running"; delete b.report.experiments[1]!.conclusion;
  const v = buildReportView(b);
  assert.equal(v.source.context, "Current host campaign · in progress");
  assert.equal(v.source.historical, false);
  assert.ok(v.attention.some(a => /still in progress/.test(a.text)));
  assert.equal(v.experiments[1]!.status, "running");
  assert.match(v.experiments[1]!.statusLabel, /^Running/);
  assert.ok(v.experiments[1]!.limitations.some(s => /still in progress/.test(s)));
  assert.ok(!v.experiments[1]!.limitations.some(s => /record ended/.test(s)));
  assert.match(v.finalState!.note, /still running; this is not a freshness monitor/);
  b.report.status = "stopped";
  const stopped = buildReportView(b);
  assert.match(stopped.experiments[1]!.statusLabel, /^Interrupted/);
  assert.ok(stopped.experiments[1]!.limitations.some(s => /record ended/.test(s)));
});

test("standalone HTML renders model text as data, embeds only vetted images and carries no host URLs or local paths", async () => {
  const vite = await import("vite");
  const { module } = await vite.runnerImport<typeof import("../src/report/standalone.tsx")>(fileURLToPath(new URL("../src/report/standalone.tsx", import.meta.url)),
    { root: fileURLToPath(new URL("../", import.meta.url)), logLevel: "error" });
  const b = structuredClone(S2);
  b.report.findings[0]!.inference = `<img src=x onerror="alert(1)"></script><script>alert(2)</script>`;
  b.report.finalization!.summary = "Summary with <b>markup</b> & C:\\Users\\someone\\secret.txt";
  const sha = Object.keys(b.media)[0]!;
  b.media[sha] = { ...b.media[sha]!, status: "url", url: "/api/hmi/frames/hmi-x/1", dataUri: undefined };
  const html = module.renderStandaloneReport(b);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(!html.includes(`<img src=x onerror`), "model text is escaped");
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;/script&gt;&lt;script&gt;alert(2)&lt;/script&gt;"));
  assert.equal(html.match(/<script>/g)?.length, 1, "only the fixed report script");
  assert.ok(html.includes("&lt;b&gt;markup&lt;/b&gt; &amp; [local path removed]"), "escaped, and a local path in model text is removed");
  assert.ok(!/\/api\//.test(html), "host frame URLs become placeholders in a portable export");
  assert.ok(html.includes("Image was not embedded at export"));
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; img-src data:/);
  assert.ok(html.includes("data:image/jpeg;base64,"), "verified images are embedded");
  const partial = module.renderStandaloneReport(PARTIAL);
  assert.ok(!/[A-Za-z]:\\\\|\\Users\\/.test(partial), "no workstation paths");
  assert.ok(partial.includes("Stopped before completion") && partial.includes("No test plan or experiment was recorded"));
  assert.ok(partial.includes('data-print-open=""'), "print expands the key sections");
});
