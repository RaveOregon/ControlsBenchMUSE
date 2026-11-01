import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createCampaignFactory } from "../src/host/wonder-campaign-factory.ts";
import { CampaignLedger } from "../src/campaign/ledger.ts";
import { FakeProvider } from "../src/campaign/provider.ts";
import { appendCoordinatorEvent } from "../src/campaign/live-evidence.ts";
import { fixtureProvenance } from "../src/campaign/harness.ts";
import type { IsolatedWonderSession } from "../src/campaign/process-port.ts";
import type { CampaignFactoryContext } from "../src/host/campaign-factory.ts";
import { verifyOwnerEntry, verifyOwnerHandoff } from "../src/campaign/owner-handoff.ts";

const hmi = { async perform() { throw new Error("Offline HMI unavailable"); } };
test("owner entry pin rejects untracked, changed and redirected entries outside src/scripts before import", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wonder-owner-entry-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", windowsHide: true });
  try {
    git("init", "-q");
    writeFileSync(join(dir, ".gitattributes"), "* -text\n");
    mkdirSync(join(dir, "adapter"));
    const code = "globalThis.__wonder_unreviewed_entry = true; throw new Error('This fixture must never be imported');\n";
    const entry = join(dir, "adapter", "entry.js"); writeFileSync(entry, code);
    git("add", ".gitattributes", "adapter/entry.js");
    git("-c", "user.name=Offline fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Pin owner entry fixture");
    const pin = git("rev-parse", "HEAD").trim();
    const evidence = JSON.stringify({ status: "pass", fixtureOnly: true });
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    writeFileSync(join(dir, "evidence.json"), evidence);
    const manifest = JSON.stringify({ contract: "controlsbench.wonder-process.v1", ownerCommit: pin, checks: Object.fromEntries(["isolation", "recovery", "campaignPort"].map(c => [c, { file: "evidence.json", sha256: sha(evidence) }])) });
    const handoffPath = join(dir, "handoff.json"); writeFileSync(handoffPath, manifest);
    let providers = 0;
    const rejectedFactory = async (path: string, reason: RegExp) => {
      const factory = createCampaignFactory({ processModule: path, handoffCommit: pin, handoffPath, handoffSha256: sha(manifest), provider() { providers++; throw new Error("Provider construction is forbidden"); } });
      await assert.rejects(factory.create({ ledger: new CampaignLedger("invalid-entry"), hmi, scope: { normal: true } }), reason);
      assert.equal(providers, 0); assert.equal((globalThis as any).__wonder_unreviewed_entry, undefined);
    };
    assert.equal(verifyOwnerEntry(entry, pin).entryRelative, "adapter/entry.js");
    const untracked = join(dir, "adapter.ts"); writeFileSync(untracked, code);
    assert.throws(() => verifyOwnerEntry(untracked, pin), /not a tracked regular file/);
    await rejectedFactory(untracked, /not a tracked regular file/);
    writeFileSync(entry, code + "// unreviewed edit\n");
    assert.throws(() => verifyOwnerEntry(entry, pin), /bytes differ/);
    await rejectedFactory(entry, /bytes differ/);
    writeFileSync(entry, code);
    const alias = join(dir, "redirected"); symlinkSync(join(dir, "adapter"), alias, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => verifyOwnerEntry(join(alias, "entry.js"), pin), /redirects/);
    await rejectedFactory(join(alias, "entry.js"), /redirects/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("W4: a handoff needs exact pinned passing isolation, recovery and campaign-port artifacts", () => {
  const dir = mkdtempSync(join(tmpdir(), "wonder-owner-proof-"));
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  try {
    const pass = JSON.stringify({ status: "pass", fixtureOnly: true }); writeFileSync(join(dir, "proof.json"), pass);
    const handoff = JSON.stringify({ contract: "controlsbench.wonder-process.v1", ownerCommit: "a".repeat(40), checks: Object.fromEntries(["isolation", "recovery", "campaignPort"].map(k => [k, { file: "proof.json", sha256: hash(pass) }])) });
    const path = join(dir, "handoff.json"); writeFileSync(path, handoff);
    assert.equal(verifyOwnerHandoff(path, hash(handoff), "a".repeat(40)).evidenceRef, `sha256:${hash(handoff)}`);
    assert.throws(() => verifyOwnerHandoff(path, "0".repeat(64), "a".repeat(40)), /hash mismatch/);
    assert.throws(() => verifyOwnerHandoff(path, hash(handoff), "b".repeat(40)), /commit mismatch/);
    writeFileSync(join(dir, "proof.json"), JSON.stringify({ status: "fail" }));
    assert.throws(() => verifyOwnerHandoff(path, hash(handoff), "a".repeat(40)), /changed or not passing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("W3/W4: checkpoint cannot spend without its flag and live factory refuses a missing owner handoff", async () => {
  const old = process.env.CONTROLSBENCH_WONDER_PROCESS_MODULE;
  const oldPin = process.env.CONTROLSBENCH_WONDER_PROCESS_COMMIT;
  delete process.env.CONTROLSBENCH_WONDER_PROCESS_MODULE; delete process.env.CONTROLSBENCH_WONDER_PROCESS_COMMIT;
  try {
    let called = false;
    const factory = createCampaignFactory({ provider() { called = true; throw new Error("must not construct provider"); } });
    await assert.rejects(factory.create({ ledger: new CampaignLedger("no-handoff"), hmi, scope: { normal: true } }), /W4 not ready/);
    assert.equal(called, false);
    assert.throws(() => execFileSync(process.execPath, ["scripts/run-wonder-checkpoint.js"], { encoding: "utf8", windowsHide: true, stdio: "pipe" }), /W3 not run/);
    for (const bound of ["0", "5", "1.5"]) assert.throws(() => execFileSync(process.execPath, ["scripts/run-wonder-checkpoint.js", "--authorize-paid-wonder-checkpoint", `--max-decisions=${bound}`], { encoding: "utf8", windowsHide: true, stdio: "pipe" }), /max-decisions must/);
  } finally {
    if (old !== undefined) process.env.CONTROLSBENCH_WONDER_PROCESS_MODULE = old;
    if (oldPin !== undefined) process.env.CONTROLSBENCH_WONDER_PROCESS_COMMIT = oldPin;
  }
});

test("W4: injected process contract uses host ledger/HMI and provider loop with originating revisions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wonder-factory-"));
  const ledger = new CampaignLedger("process-fixture"), leases: number[] = [], actions: number[] = [];
  let disposed = 0;
  const openSession = async (context: CampaignFactoryContext): Promise<IsolatedWonderSession> => {
    assert.equal(context.ledger, ledger); assert.equal(context.hmi, hmi);
    let refs: string[] = [];
    return { contract: "controlsbench.wonder-process.v1", ledger, ownershipPath: "offline-only", provenance: fixtureProvenance("offline"),
      handoff: { commit: "offline-fixture", isolationVerified: true, recoveryVerified: true, evidenceRef: "offline fixture only, not a live handoff" },
      driver: { binding: { describe: { tools: ["operator_action"], offline: true }, translate() { throw new Error("No world tool in this fixture"); } },
        observedOutputIds: ["Motor_RunCmd"], operationTimeoutMs: 100, quarantined: false,
        get evidenceAgeMs() { return 0; }, get lastImage() { return { PE_Entry: false }; }, get lastSnapshot() { return undefined; }, get lastEvidenceRefs() { return refs; },
        async initialize() { refs = appendCoordinatorEvent(ledger, { sequence: 1, atIso: "2026-11-01T00:00:00Z", atMonotonicMs: 0, lane: "connector",
          data: { action: "commit.acknowledged", cause: "offline-process-fixture", workstationEpoch: "fixture", workstationSequence: "1", slot: 0, latencyMs: 0,
            bootIdentity: "fixture", plcCycle: "1", outputCaptureCycle: "1", image: { PE_Entry: false }, outputs: { Motor_RunCmd: false } } }); },
        start() {}, async hold() {}, async apply(_call, _signal, revision) { actions.push(revision!); return refs; }, async reset() { return refs; }, async exit() {}, subscribe() { return () => {}; },
        decisionLeases: { async begin(_p, revision) { leases.push(revision); return { id: `lease-${leases.length}`, basedOnRevision: revision, valid: true, reason: "offline contract", evidenceRefs: refs.filter(id => ledger.getEvent(id)?.type === "plc.output") }; }, async finish(receipt) { return receipt; } } },
      controller: { async execute(call, _signal, revision) { actions.push(revision!); const event = ledger.append("controller.action", { actionId: call.id, action: "stop", observation: { source: "offline fixture" } }); return { message: "Offline acknowledged operator fixture", evidenceRefs: [event.id] }; } },
      simulationExit: { async exit() { throw new Error("No live passthrough in fixture"); } }, async dispose() { disposed++; } };
  };
  const provider = new FakeProvider((context, turn) => {
    const output = context.evidence.filter(e => e.type === "plc.output").at(-1)!;
    if (turn === 1) return { summary: "Provider selected a bounded baseline", plan: { objective: "Offline process contract", experiments: [{ id: "baseline", objective: "Observe output", category: "normal", requirements: [] }] }, calls: [
      { id: "operator", name: "operator_action", arguments: { action: "stop" } },
      { id: "finding", name: "record_finding", arguments: { id: "observed", title: "Fixture output observed", experimentId: "baseline", claims: [{ evidenceId: output.id, signal: "Motor_RunCmd", equals: false }],
        injectedTruthRefs: [], inference: "Offline contract only", assumptions: [], uncertainty: "No live result" } }
    ] };
    return { summary: "Finish offline proof", completeExperiment: { id: "baseline", evidenceRefs: [output.id], conclusion: "observed" }, calls: [{ id: "finish", name: "finish_campaign", arguments: { summary: "Offline contract proven" } }] };
  });
  try {
    const factory = createCampaignFactory({ openSession, provider: () => provider });
    const hosted = await factory.create({ ledger, hmi, scope: { normal: true, adaptive: true }, artifactDirectory: dir });
    assert.equal(factory.evidenceClass, "fake_connector"); assert.equal(hosted.run, undefined); assert.equal(hosted.runtime.ledger, ledger); assert.equal(hosted.runtime.options.hmi, hmi);
    await hosted.runtime.start(false); await hosted.runtime.runAgent(); await hosted.runtime.stop();
    assert.equal(hosted.runtime.status, "completed"); assert.equal(leases.length, 2); assert.equal(actions.length, 1);
    const request = ledger.events.find(e => e.type === "action.requested" && e.data.actionId === "operator")!;
    assert.equal(actions[0], request.data.basedOnRevision);
    await hosted.dispose!(); assert.equal(disposed, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
