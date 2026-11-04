// Bench report bundle: bounded saved-evidence resolver, preservation of original bytes, partial
// runs keeping their own identity, shareable-output path scrubbing and the host presentation endpoint.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixtureCampaignFactory } from "../src/host/campaign-factory.ts";
import { CampaignHost } from "../src/host/campaign-host.ts";
import { createPortalServer, listen } from "../src/host/http.ts";
import { containsLocalPath, REPORT_BUNDLE_VERSION, scrubLocalPaths, type ReportBundle } from "../src/report/bundle.ts";
import { loadSavedCampaign, resolveFrameMedia } from "../src/report/saved-campaign.ts";

const repo = fileURLToPath(new URL("../", import.meta.url));
const PARTIAL = join(repo, "artifacts/s2/2026-11-03T13-58-03-806Z-live/host/runs/2026-11-03T23-10-57-424Z-live_plc/portal-host/portal-20261103231427237-1");
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function hashTree(dir: string, out: Record<string, string> = {}, prefix = ""): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) hashTree(path, out, `${prefix}${name}/`);
    else out[`${prefix}${name}`] = sha(readFileSync(path));
  }
  return out;
}

test("a partial saved run keeps its own identity, stays stopped and leaves the evidence bytes untouched", () => {
  const before = hashTree(PARTIAL);
  const bundle = loadSavedCampaign(PARTIAL, { generatedAtIso: "2026-11-04T00:00:00.000Z" });
  assert.deepEqual(hashTree(PARTIAL), before, "no evidence file is written or changed");
  assert.equal(bundle.schemaVersion, REPORT_BUNDLE_VERSION);
  assert.equal(bundle.report.campaignId, "portal-20261103231427237-1");
  assert.equal(bundle.report.status, "stopped");
  assert.equal(bundle.reportIntegrity.matchesLedgerReconstruction, true);
  assert.deepEqual(bundle.ledger.states.map(s => s.state), ["preparing", "running", "paused", "stopped"]);
  assert.equal(bundle.report.experiments.length, 0);
  assert.equal(bundle.report.plan, undefined, "no plan was applied before the stop");
  assert.deepEqual(bundle.modelRequests.map(r => [r.requestId, r.phase, r.exchange?.responseReturned]), [["request-1", "cancelled", true]]);
  // Only its own first frame, from its own HMI session: nothing inherited from the later retry.
  assert.deepEqual(bundle.hmi.frames.map(f => [f.id, f.sessionId, f.supplied.toMuse]), [["portal-20261103231427237-1:43", "hmi-638ec133-87be-45fd-a85c-ec391addf174", true]]);
  assert.equal(bundle.hmi.actions.length, 0);
  assert.equal(Object.keys(bundle.media).length, 0, "no assessment, action or experiment cites a frame");
  assert.ok(bundle.final.plcOutput && Date.parse(bundle.final.plcOutput.atIso) < Date.parse("2026-11-03T23:15:00Z"), "final state comes from this run's own ledger");
  assert.equal(bundle.final.connector?.state, "stale");
  assert.deepEqual(bundle.attachments.map(a => [a.file, a.status, a.kind]), [["s2-audit.json", "partial", "offline_audit"]]);
  const original = bundle.sources.find(s => s.file === "report.json")!;
  assert.equal(Buffer.from(original.embeddedBase64!, "base64").toString("utf8"), readFileSync(join(PARTIAL, "report.json"), "utf8"), "embedded report is the exact original bytes");
  assert.equal(original.sha256, sha(readFileSync(join(PARTIAL, "report.json"))));
  assert.equal(containsLocalPath(JSON.stringify(bundle)), false, "held-state paths never reach the shareable bundle");
  assert.equal(bundle.diagnostics, undefined, "source paths only on request");
  assert.deepEqual(loadSavedCampaign(PARTIAL, { diagnosticsBase: repo }).diagnostics, { evidenceDirectory: "artifacts/s2/2026-11-03T13-58-03-806Z-live/host/runs/2026-11-03T23-10-57-424Z-live_plc/portal-host/portal-20261103231427237-1" });
});

test("the committed partial-run export is current with the resolver", () => {
  const exported = JSON.parse(readFileSync(join(repo, "artifacts/bench-report/saved-exports/s2-first-attempt-partial/report-bundle.json"), "utf8")) as ReportBundle;
  const fresh = loadSavedCampaign(PARTIAL, { title: exported.context.title, generatedAtIso: exported.generatedAtIso });
  assert.deepEqual(JSON.parse(JSON.stringify(fresh)), exported);
});

test("frame media resolves only ledger-named files under vision-frames with a matching hash", () => {
  const root = mkdtempSync(join(tmpdir(), "cb-report-"));
  mkdirSync(join(root, "vision-frames"));
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  writeFileSync(join(root, "vision-frames", "1-current.jpg"), jpeg);
  writeFileSync(join(root, "report.json"), "{}");
  const good = resolveFrameMedia(root, { sha256: sha(jpeg), file: "vision-frames/1-current.jpg" }, { embed: true });
  assert.equal(good.status, "embedded");
  assert.equal(good.dataUri, `data:image/jpeg;base64,${jpeg.toString("base64")}`);
  assert.equal(resolveFrameMedia(root, { sha256: "0".repeat(64), file: "vision-frames/1-current.jpg" }, { embed: true }).status, "hash_mismatch");
  for (const file of ["../report.json", "vision-frames/../report.json", "vision-frames/../../etc/x.jpg", "C:/Windows/win.ini", "/etc/passwd", "vision-frames/x.svg", "report.json"]) {
    const r = resolveFrameMedia(root, { sha256: sha(jpeg), file }, { embed: true });
    assert.equal(r.status, "missing", file);
    assert.equal(r.dataUri, undefined, file);
  }
  assert.match(resolveFrameMedia(root, { sha256: sha(jpeg) }, { embed: true }).note, /not preserved/);
  assert.equal(resolveFrameMedia(root, { sha256: sha(jpeg), file: "vision-frames/2-missing.jpg" }, { embed: true }).status, "missing");
});

test("shareable output scrubs workstation paths but keeps data URIs and ordinary text", () => {
  const scrubbed = scrubLocalPaths({ a: "run C:\\Users\\steve\\Documents\\x\\held.json now", b: ["\\\\server\\share\\f", "/Users/sam/x", "/home/kim/y"], c: "data:image/png;base64,AAAA", d: "UI-01: pass at 10:20", e: "https://dev.meta.ai/docs" });
  assert.equal(scrubbed.a, "run [local path removed] now");
  assert.deepEqual(scrubbed.b, ["[local path removed]", "[local path removed]", "[local path removed]"]);
  assert.equal(scrubbed.c, "data:image/png;base64,AAAA");
  assert.equal(scrubbed.d, "UI-01: pass at 10:20");
  assert.equal(scrubbed.e, "https://dev.meta.ai/docs");
});

test("the host serves a presentation bundle for its current campaign alongside the unchanged JSON report", async () => {
  const host = new CampaignHost({ factory: fixtureCampaignFactory({ adaptive: true }) });
  const server = createPortalServer({ host });
  const { url } = await listen(server, 0);
  try {
    assert.equal((await fetch(`${url}/api/campaign/report/bundle`)).status, 404);
    host.submit({ contractVersion: 1, requestId: "test-start", type: "start" });
    const deadline = Date.now() + 30_000;
    while (!["completed", "stopped", "failed"].includes(host.report()?.status ?? "") && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    const report = await (await fetch(`${url}/api/campaign/report`)).json();
    const bundle = await (await fetch(`${url}/api/campaign/report/bundle`)).json() as ReportBundle;
    assert.equal(bundle.schemaVersion, REPORT_BUNDLE_VERSION);
    assert.deepEqual(bundle.context, { kind: "host_current", factoryLabel: host.factory.label });
    assert.deepEqual(bundle.report, report, "the bundle carries the authoritative report unchanged");
    assert.equal(bundle.report.evidenceClass, "fake_connector");
    const ids = new Set(host.events.map(e => e.id));
    assert.ok(Object.keys(bundle.evidence).every(id => ids.has(id)), "evidence slice cites only ledger records");
    assert.ok(report.experiments.some((x: { conclusion?: string }) => x.conclusion === "inconclusive"), "fixture includes a completed-but-inconclusive experiment");
    assert.equal(bundle.ledger.eventCount, host.events.length);
  } finally {
    await host.close(); server.closeAllConnections?.(); await new Promise(r => server.close(r));
  }
});
