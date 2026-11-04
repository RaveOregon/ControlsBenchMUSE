// Onboarding presentation: Start stays gated until a validated project and its runnable prepared
// plan are selected, and the report carries the project identity and the prepared, source-linked
// expected observation for each check (still "observed", never a pass).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ReportBundle } from "../../src/report/bundle.ts";
import { projectStartBlock } from "../src/projects/gating.ts";
import type { ProjectsIndex, Review } from "../src/projects/api.ts";
import { WorkspaceStore } from "../src/model/workspace-store.ts";
import { buildReportView } from "../src/report/view-model.ts";
import { SIGNALS } from "./helpers.ts";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const index = (active: ProjectsIndex["active"]): ProjectsIndex => ({ formats: { specification: [".md"], io: [".csv"], note: "" }, limits: { specBytes: 1, ioBytes: 1, nameChars: 80 },
  author: { id: "fixture-author", label: "Fixture", paid: false, fixture: true }, factory: "project-offline", campaignRunning: false, active, projects: [] });
const uploaded = { schema: "controlsbench.project.v1" as const, projectId: "p-1", version: "v1", kind: "uploaded" as const, selectedAtIso: "2026-11-04T00:00:00Z", specSha256: "a", worldSha256: "b", manifestSha256: "c", projectName: "Line" };
const check = (id: string, group: Review["plan"]["checks"][number]["group"], available = true) => ({ id, group, title: id, objective: id, requirementRefs: ["R-01"], sourceRefs: ["§9 R-01"],
  stimulus: "Start, then Stop", expectedObservation: "Motor command removed; item stays at rest", expectedBasis: "specified" as const, observeSignals: ["Motor_RunCmd"], worldControls: [], needsHmi: !available, available,
  ...(available ? {} : { unavailableReason: "Needs HMI operation" }) });
const review = { plan: { objective: "o", checks: [check("CHK-1", "startup"), check("CHK-HMI", "functional", false)] } } as unknown as Review;

test("Start needs a selected project and a runnable prepared check in the chosen categories", () => {
  const store = new WorkspaceStore("live", SIGNALS);
  const state = { ...store.state, categoryScope: { startup: false, functional: true } };
  assert.equal(projectStartBlock(undefined, undefined, state), undefined, "hosts without onboarding keep their own gating");
  assert.match(projectStartBlock(index(null), undefined, state)!, /Select a project/);
  assert.match(projectStartBlock(index(uploaded), undefined, state)!, /prepared plan/);
  assert.match(projectStartBlock(index(uploaded), review, state)!, /runnable planned checks/, "an unavailable HMI check does not enable Start");
  assert.equal(projectStartBlock(index(uploaded), review, { ...state, categoryScope: { startup: true } }), undefined);
  assert.equal(projectStartBlock(index({ ...uploaded, kind: "example", projectId: "example-conveyor", version: "example" }), undefined, state), undefined, "the prepared example plans after Start");
});

test("the report shows the selected project, prepared expectations and checks that were not run", () => {
  const bundle = JSON.parse(readFileSync(`${repo}artifacts/bench-report/saved-exports/w4-adaptive-plc-investigation/report-bundle.json`, "utf8")) as ReportBundle;
  const [first, second] = bundle.report.experiments;
  bundle.project = { projectId: "p-1", projectName: "Slow belt", version: "v2", kind: "uploaded", specSha256: "s".repeat(64), worldSha256: "w".repeat(64), loadedWorldSha256: "w".repeat(64), benchProfile: "m8-conveyor-1.0.2",
    author: "Muse Wonder 1.0 (paid model request)", responseIds: ["resp_1", "resp_2"] };
  bundle.preparedPlan = { objective: "Prepared", author: "Muse Wonder 1.0 (paid model request)", notRun: [{ id: "UI-HMI", reason: "Needs HMI operation; the configured campaign composition cannot operate the HMI" }],
    checks: [{ id: first!.id, group: "faults", title: "t", objective: first!.objective, requirementRefs: ["R-11"], sourceRefs: ["§9 R-11"], stimulus: "Inject drive feedback failure while running",
      expectedObservation: "MUST: detected drive-start fault, no virtual motion", expectedBasis: "specified", observeSignals: ["Motor_RunCmd"] }] };
  const v = buildReportView(bundle);
  assert.ok(v.identity.some(f => f.label === "Project" && f.value === "Slow belt · v2 (uploaded specification)"));
  assert.ok(v.identity.some(f => f.label === "Specification / world" && f.value.includes("verified as loaded by the isolated child")));
  assert.ok(v.identity.some(f => f.label === "World prepared by" && f.value.includes("resp_1")));
  const x = v.experiments.find(e => e.id === first!.id)!;
  assert.match(x.origin, /^Prepared before Start/);
  assert.equal(x.expected, "Specified: MUST: detected drive-start fault, no virtual motion (source: §9 R-11)");
  assert.equal(x.plannedStimulus, "Inject drive feedback failure while running");
  assert.match(x.statusLabel, /not a pass verdict/);
  assert.equal(v.experiments.find(e => e.id === second!.id)!.origin, "Adaptive follow-up (added from evidence)");
  assert.ok(v.remaining.some(g => g.title === "Prepared checks not run in this campaign" && g.items[0]!.startsWith("UI-HMI: Needs HMI")));

  const loadedDiffers = structuredClone(bundle); loadedDiffers.project!.loadedWorldSha256 = "x".repeat(64);
  assert.ok(buildReportView(loadedDiffers).identity.some(f => f.value.includes("LOADED WORLD DIFFERS")));
});
