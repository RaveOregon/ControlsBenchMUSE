// Specification-to-project onboarding: project store, preparation jobs, isolated validation,
// M8 compatibility, activation and the selected-project campaign through the real isolated child.
// Repeatable tests use the labelled fixture author and fixture M8 transport; the preserved genuine
// Muse preparation is checked separately from its saved artifacts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CampaignHost } from "../src/host/campaign-host.ts";
import { createPortalServer, listen } from "../src/host/http.ts";
import { ProjectApi } from "../src/host/project-api.ts";
import { createProjectCampaignFactory } from "../src/host/project-campaign-factory.ts";
import { noAccount } from "../src/projects/accounting.ts";
import { FixtureWorldAuthor } from "../src/projects/author.ts";
import { embeddedIo, parseIoList } from "../src/projects/io-list.ts";
import { PreparationService } from "../src/projects/preparation.ts";
import { activate, activationBlock, readReview } from "../src/projects/selection.ts";
import { ProjectError, ProjectStore, type VersionRecord } from "../src/projects/store.ts";

const repo = fileURLToPath(new URL("../", import.meta.url));
const transportModule = join(repo, "test/fixtures/wonder-process-transport.ts");
const baselineSpec = readFileSync(join(repo, "docs/conveyor-machine-spec.md"));
const slowSpec = readFileSync(join(repo, "docs/examples/conveyor-slow-belt-spec.md"));
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const DONE = ["ready", "failed", "needs_information", "cancelled"];

function rig(author = new FixtureWorldAuthor()) {
  const store = new ProjectStore(mkdtempSync(join(tmpdir(), "cb-onboarding-")));
  const prep = new PreparationService({ store, author: () => author, account: noAccount, maxRepairs: 2 });
  return { store, prep, author };
}
async function until(store: ProjectStore, projectId: string, version: string, states = DONE, timeoutMs = 120_000): Promise<VersionRecord> {
  const end = Date.now() + timeoutMs;
  for (;;) { const r = store.version(projectId, version); if (states.includes(r.status)) return r; if (Date.now() > end) throw new Error(`Timed out in ${r.status}`); await sleep(100); }
}

test("store keeps original bytes and hashes, persists across reopen, revises without overwriting and refuses unsupported uploads", () => {
  const { store } = rig();
  const { project, version } = store.create("Slow belt", { name: "spec.md", bytes: slowSpec, source: "upload" });
  assert.match(project.id, /^p-\d{14}-[0-9a-f]{6}$/);
  assert.equal(version.inputs.spec.sha256, sha(slowSpec));
  assert.deepEqual(readFileSync(join(store.versionDir(project.id, "v1"), version.inputs.spec.file)), slowSpec);
  const reopened = new ProjectStore(store.root);
  assert.deepEqual(reopened.list().map(p => p.id), [project.id]);
  const v2 = store.revise(project.id, "v1", { spec: { name: "spec.md", bytes: Buffer.from("# changed\n"), source: "revision" }, note: "edited" });
  assert.equal(v2.version, "v2"); assert.equal(v2.basedOn, "v1");
  assert.equal(store.version(project.id, "v1").inputs.spec.sha256, sha(slowSpec), "v1 unchanged");
  const refuse = (fn: () => unknown, status: number) => assert.throws(fn, (e: unknown) => e instanceof ProjectError && e.status === status);
  refuse(() => store.create("pdf", { name: "spec.pdf", bytes: Buffer.from("%PDF-1.7 ..."), source: "upload" }), 415);
  refuse(() => store.create("pdf disguised", { name: "spec.md", bytes: Buffer.from("%PDF-1.7 ..."), source: "upload" }), 415);
  refuse(() => store.create("big", { name: "spec.md", bytes: Buffer.alloc(600 * 1024, 65), source: "upload" }), 413);
  refuse(() => store.create("", { name: "spec.md", bytes: slowSpec, source: "upload" }), 400);
  refuse(() => store.version("../..", "v1"), 400);
  refuse(() => store.path("p-x", "../secret"), 400);
});

test("I/O comes from the separate list or the specification's own tables", () => {
  const embedded = embeddedIo(baselineSpec.toString("utf8"));
  assert.ok(embedded.some(r => r.name === "PE_Entry" && r.nativeType === "BOOL" && r.direction === "world_to_plc"));
  const csv = parseIoList("name,direction,type,unit\nPE_Entry,input,BOOL,\nMotor_RunCmd,output,BOOL,\nBelt_SpeedActual,input,REAL,m/s\n", "io.csv");
  assert.deepEqual(csv.map(r => [r.name, r.direction, r.nativeType, r.unit]), [["PE_Entry", "world_to_plc", "BOOL", undefined], ["Motor_RunCmd", "plc_to_world", "BOOL", undefined], ["Belt_SpeedActual", "world_to_plc", "REAL", "m/s"]]);
  assert.equal(parseIoList(JSON.stringify({ signals: [{ id: "Encoder_Count", dataType: "UDINT", direction: "world_to_plc" }] }), "io.json")[0]!.nativeType, "UDINT");
});

test("preparation sends the uploaded text, validates in the worker, and a changed spec changes the world's measured behavior", async () => {
  const { store, prep, author } = rig();
  const base = store.create("Baseline", { name: "spec.md", bytes: baselineSpec, source: "upload" });
  const slow = store.create("Slow belt", { name: "spec.md", bytes: slowSpec, source: "upload" });
  prep.start(base.project.id, "v1"); prep.start(slow.project.id, "v1");
  const [a, b] = [await until(store, base.project.id, "v1"), await until(store, slow.project.id, "v1")];
  assert.equal(a.status, "ready", a.job?.error ?? ""); assert.equal(b.status, "ready", b.job?.error ?? "");
  assert.deepEqual(author.calls.map(c => c.specSha256), [sha(baselineSpec), sha(slowSpec)], "the author received each project's own uploaded text");
  const [ra, rb] = [readReview(store, base.project.id, "v1")!, readReview(store, slow.project.id, "v1")!];
  assert.equal(ra.measured!.steadySpeedMps, 0.5); assert.equal(rb.measured!.steadySpeedMps, 0.3);
  assert.equal(ra.measured!.encoderCountsPerSecond, 500); assert.equal(rb.measured!.encoderCountsPerSecond, 300);
  assert.notEqual(a.package!.worldSha256, b.package!.worldSha256);
  assert.ok(rb.validation!.checks.every(c => c.status === "pass"));
  assert.equal(rb.compatibility!.compatible, true);
  assert.equal(rb.io.source, "embedded");
  assert.ok(rb.plan.checks.length > 0 && rb.plan.checks.every(c => /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(c.id)));
  assert.ok(rb.plan.checks.filter(c => c.needsHmi).every(c => !c.available && /HMI/.test(c.unavailableReason ?? "")), "HMI checks are unavailable without an HMI-capable composition");
  assert.equal(b.job!.provider.fixture, true); assert.equal(b.job!.reservationsUsd, 0);
});

test("compiler defects go back to the author with diagnostics; every attempt is preserved", async () => {
  const { store, prep } = rig(new FixtureWorldAuthor({ failFirstCompile: true }));
  const { project } = store.create("Repair", { name: "spec.md", bytes: slowSpec, source: "upload" });
  prep.start(project.id, "v1");
  const r = await until(store, project.id, "v1");
  assert.equal(r.status, "ready", r.job?.error ?? ""); assert.equal(r.job!.requests, 2); assert.equal(r.job!.repairs, 1);
  const review = readReview(store, project.id, "v1")!;
  assert.deepEqual(review.lineage.map(l => [l.purpose, l.validationOk]), [["generate", false], ["repair", true]]);
  const first = JSON.parse(readFileSync(join(store.versionDir(project.id, "v1"), review.lineage[0]!.directory, "validation.json"), "utf8"));
  assert.equal(first.checks.find((c: { id: string }) => c.id === "compile.strict").classification, "compiler");
  assert.equal(r.package!.attempt, 2);
});

test("missing I/O asks a question without a model request; cancel and failure never replace the active project", async () => {
  const { store, prep, author } = rig(new FixtureWorldAuthor({ delayMs: 20_000 }));
  const noIo = store.create("No I/O", { name: "spec.md", bytes: Buffer.from("# Mixer\nA tank mixer with an agitator. No signal list yet.\n"), source: "paste" });
  prep.start(noIo.project.id, "v1");
  const q = await until(store, noIo.project.id, "v1");
  assert.equal(q.status, "needs_information"); assert.equal(author.calls.length, 0);
  assert.match(readReview(store, noIo.project.id, "v1")!.questions[0]!.question, /I\/O list/);
  assert.match(activationBlock(store, noIo.project.id, "v1")!, /blocking questions/);

  const before = activate(store, "example-conveyor", "example", false);
  const slow = store.create("Cancelled", { name: "spec.md", bytes: slowSpec, source: "upload" });
  prep.start(slow.project.id, "v1");
  await until(store, slow.project.id, "v1", ["preparing"]);
  await sleep(200);
  const cancelled = prep.cancel(slow.project.id, "v1");
  assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.job!.cancelledBy, "engineer");
  await sleep(300);
  assert.equal(store.version(slow.project.id, "v1").status, "cancelled"); assert.equal(store.version(slow.project.id, "v1").package, undefined);
  assert.deepEqual(store.readActive(), before, "active selection untouched");
  assert.throws(() => activate(store, slow.project.id, "v1", false), /cancelled/);
});

test("an incompatible or failing world cannot become live-ready or active", async () => {
  const extra = rig(new FixtureWorldAuthor({ breakWorld: "extra_write" }));
  const e = extra.store.create("Extra write", { name: "spec.md", bytes: slowSpec, source: "upload" });
  extra.prep.start(e.project.id, "v1");
  assert.equal((await until(extra.store, e.project.id, "v1")).status, "ready", "the world itself validates");
  const review = readReview(extra.store, e.project.id, "v1")!;
  assert.equal(review.compatibility!.compatible, false); assert.equal(review.compatibility!.liveReady, false);
  assert.ok(review.compatibility!.issues.some(i => i.code === "extra_plc_write" && i.signal === "Extra_Valve"));
  assert.throws(() => activate(extra.store, e.project.id, "v1", false), /Not compatible.*Extra_Valve/);

  const missing = rig(new FixtureWorldAuthor({ breakWorld: "missing_signal" }));
  const before = activate(missing.store, "example-conveyor", "example", false);
  const m = missing.store.create("Missing signal", { name: "spec.md", bytes: slowSpec, source: "upload" });
  missing.prep.start(m.project.id, "v1");
  const failed = await until(missing.store, m.project.id, "v1");
  assert.equal(failed.status, "failed"); assert.equal(failed.job!.requests, 3, "bounded: one generation and two repairs");
  assert.deepEqual(missing.store.readActive(), before);
});

test("selected project runs through the isolated child with verified identity, seeded plan, report linkage and run archive; tampering blocks", async () => {
  const { store, prep } = rig();
  const { project } = store.create("Slow belt", { name: "conveyor-slow-belt-spec.md", bytes: slowSpec, source: "upload" });
  prep.start(project.id, "v1");
  const ready = await until(store, project.id, "v1");
  const factory = createProjectCampaignFactory({ store, transportModule, lockDirectory: join(store.root, ".locks") });
  const host = new CampaignHost({ factory });
  const api = new ProjectApi({ store, preparation: prep, host, author: { id: "fixture-author", label: "Fixture", paid: false, fixture: true } });
  const server = createPortalServer({ host, projects: api });
  const { url } = await listen(server, 0);
  const post = (path: string, body: unknown) => fetch(url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(`/api/projects/${project.id}/versions/v1/activate`, {})).status, 200);
    const scope = { io: true, startup: true, normal: true, functional: true, faults: true, edge: true, runtime: true, adaptive: true };
    assert.equal((await post("/api/commands", { contractVersion: 1, requestId: "start-1", type: "start", payload: { scope } })).status, 202);
    const end = Date.now() + 120_000;
    while (!(host.report()?.finalization) && Date.now() < end) await sleep(200);
    const report = host.report()!;
    assert.equal(report.status, "completed");
    assert.equal(report.provenance!.spec, `sha256:${sha(slowSpec)}`);
    assert.match(report.provenance!.worldModule, new RegExp(`^sha256:${ready.package!.worldSha256};`));
    const selected = host.events.find(e => e.type === "world.evidence" && (e.data.source as { kind?: string }).kind === "selected_project")!.data.source as Record<string, string>;
    assert.equal(selected.loadedWorldSha256, ready.package!.worldSha256); assert.equal(selected.projectId, project.id); assert.equal(selected.version, "v1");
    const review = readReview(store, project.id, "v1")!;
    const runnable = review.plan.checks.filter(c => c.available).map(c => c.id);
    assert.deepEqual(report.plan!.experiments.slice(0, runnable.length).map(e => e.id), runnable, "the prepared plan is the campaign's starting plan");
    assert.ok(report.experiments.some(e => e.id === "FOLLOWUP-fixture"), "campaign-added follow-up stays distinct");
    const bundle = await (await fetch(`${url}/api/campaign/report/bundle`)).json();
    assert.equal(bundle.project.loadedWorldSha256, ready.package!.worldSha256);
    assert.ok(bundle.preparedPlan.checks.every((c: { expectedObservation: string }) => c.expectedObservation.length > 0));
    await sleep(300);
    const runs = api.runs(project.id, "v1");
    assert.deepEqual(runs.map(r => [r.campaignId, r.status, r.reportAvailable]), [[report.campaignId, "completed", true]]);
    assert.equal((await fetch(`${url}/api/projects/${project.id}/versions/v1/runs/${report.campaignId}/bundle`)).status, 200);

    // A second run of the same version from a fresh campaign.
    const acks: Array<{ requestId: string; outcome: string; detail: string }> = [];
    host.subscribe(m => { if (m.type === "ack") acks.push(m.ack); });
    assert.equal((await post("/api/commands", { contractVersion: 1, requestId: "start-2", type: "start", payload: { scope } })).status, 202);
    const end2 = Date.now() + 120_000;
    while ((host.campaignId === report.campaignId || !host.report()?.finalization) && Date.now() < end2) await sleep(200);
    const second = host.report()!;
    assert.equal(second.status, "completed"); assert.notEqual(second.campaignId, report.campaignId);

    // Changed bytes after selection: explicit mismatch, no fallback to the example.
    appendFileSync(join(store.versionDir(project.id, "v1"), ready.package!.directory, "world.ts"), "\n// tampered\n");
    assert.equal((await post("/api/commands", { contractVersion: 1, requestId: "start-3", type: "start", payload: { scope } })).status, 202);
    const end3 = Date.now() + 15_000;
    while (!acks.some(a => a.requestId === "start-3") && Date.now() < end3) await sleep(100);
    const refused = acks.find(a => a.requestId === "start-3")!;
    assert.equal(refused.outcome, "rejected"); assert.match(refused.detail, /does not match its recorded hashes \(world\.ts/);
    assert.ok(host.campaignId === null || host.campaignId === second.campaignId, "no campaign was created from mismatched bytes");
    assert.equal(api.runs(project.id, "v1").length, 2);
  } finally { await host.close(); server.closeAllConnections?.(); await new Promise(r => server.close(r)); }
});

test("the preserved genuine Muse preparation received the uploaded text and passed independent validation after one repair", () => {
  const dir = join(repo, "artifacts/projects/p-20261104015133-55daee/v1");
  const store = new ProjectStore(join(repo, "artifacts/projects"));
  const record = store.version("p-20261104015133-55daee", "v1");
  assert.equal(record.status, "ready"); assert.equal(record.inputs.spec.sha256, sha(slowSpec));
  assert.equal(record.job!.provider.paid, true); assert.equal(record.job!.repairs, 1);
  const review = readReview(store, record.projectId, "v1")!;
  assert.equal(review.author.id, "muse-wonder-1.0");
  assert.deepEqual(review.lineage.map(l => [l.purpose, l.validationOk, /^resp_/.test(l.responseId ?? "")]), [["generate", false, true], ["repair", true, true]]);
  assert.equal(review.measured!.steadySpeedMps, 0.3); assert.equal(review.measured!.encoderCountsPerSecond, 300);
  assert.equal(review.compatibility!.compatible, true);
  const journal = readFileSync(join(dir, "generation", `${record.job!.id}-exchanges.jsonl`), "utf8").trim().split("\n").map(l => JSON.parse(l));
  const requests = journal.filter(j => j.phase === "request");
  assert.equal(requests.length, 2);
  for (const r of requests) {
    assert.ok(r.requestText.includes(sha(slowSpec)), "request names the uploaded spec hash");
    assert.ok(r.requestText.includes("configured nominal belt speed of 0.30 m/s"), "request carries the uploaded variant text");
    assert.ok(!/Bearer|MODEL_API_KEY/.test(r.requestText));
  }
  const files = readdirSync(join(dir, "attempts"));
  assert.equal(files.length, 2);
  assert.ok(existsSync(join(dir, record.package!.directory, "world.ts")));
  assert.equal(sha(readFileSync(join(dir, record.package!.directory, "world.ts"))), record.package!.worldSha256);
});
