// W4 zero-model live commissioning harness (controlsbench.w4-commissioning.v1). Drives the real
// CampaignRuntime and the isolated Wonder process adapter (controlsbench.wonder-process.v1) through
// declared commissioning steps: preconditions, read-only baseline inspection, normal operation, the
// reasoning-lease cases, one declared world fault, and clean shutdown with a read-only final
// inspection. No model is called: the lease turns come from a scripted zero-cost provider whose
// decisions are commissioning steps, not Wonder decisions. Nothing is retried, reset or exited
// automatically. A run that stops after writing records held-state.json for scripts/recover-w4-held.js.
//
//   Live (via scripts/run-w4-commissioning.ps1 for the masked credential prompt):
//     node scripts/run-w4-commissioning.js [--inspect-only] [--module <pinned checkout>] [--load-note <text>]
//   Offline (fake transport; tests and rehearsal only):
//     node scripts/run-w4-commissioning.js --offline --transport-module <abs> --ownership <lane lock> --artifacts <dir>
import { execFileSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { CampaignLedger, readLedger, report } from "../src/campaign/ledger.ts";
import { CampaignRuntime } from "../src/campaign/runtime.ts";
import { CampaignBudget } from "../src/campaign/budget.ts";
import { commonWonderPaths } from "../src/campaign/wonder-paths.ts";
import { verifyOwnerEntry } from "../src/campaign/owner-handoff.ts";
import { frozenProjectHash } from "../src/campaign/m10-rehearsal.ts";
import { m8Preflight } from "../src/host/m8-campaign-factory.ts";
import { createM8NativeTransport } from "../src/live/m8-native-transport.ts";
import { HARNESS_CONTRACT, baselineMismatches, commissioningQualification, deriveHeldState, inspectionConnection, readJsonl, shaFile, summarizeInspection } from "./lib/w4-commissioning.ts";

const { values: args } = parseArgs({ options: { offline: { type: "boolean" }, "transport-module": { type: "string" }, "transport-options": { type: "string" },
  ownership: { type: "string" }, artifacts: { type: "string" }, module: { type: "string" }, "inspect-only": { type: "boolean" }, "offline-abort-at": { type: "string" },
  "offline-timing": { type: "string" }, "load-note": { type: "string" } } });
const root = fileURLToPath(new URL("../", import.meta.url));
const offline = args.offline === true;
const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", windowsHide: true }).trim();
const sharedLock = commonWonderPaths().ownership;
const ownershipPath = resolve(offline ? args.ownership ?? "" : sharedLock);
const artifactsRoot = resolve(args.artifacts ?? join(root, "artifacts/w4-commissioning"));
const startedAtIso = new Date().toISOString(), stamp = startedAtIso.replace(/[:.]/g, "-");
const directory = join(artifactsRoot, stamp);
mkdirSync(directory, { recursive: true });
const worldRelative = "artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts";
const log = message => console.log(`[w4 ${new Date().toISOString().slice(11, 23)}] ${message}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const inspectionJournal = join(directory, "inspection-transport.jsonl");
const journal = (kind, data) => appendFileSync(inspectionJournal, JSON.stringify({ kind, atIso: new Date().toISOString(), atMonotonicMs: performance.now(), ...data }) + "\n");

// Credentials stay in this process's memory only; the child receives them from the environment at fork.
const credentials = offline ? null : { user: process.env.OPC_USER, password: process.env.OPC_PASSWORD };
if (!offline) delete process.env.OPC_PASSWORD;
const result = { schemaVersion: 1, contract: HARNESS_CONTRACT, status: "refused", scope: offline ? "offline-fake-transport" : "live-m8",
  evidenceClass: offline ? "fake_connector" : "live_plc", directory, startedAtIso, modelCalls: 0, paidCalls: 0,
  claimBoundary: "Zero-model W4 commissioning: declared deterministic commissioning steps and a scripted zero-cost lease provider through the isolated adapter. Not a Wonder decision, investigation, controller coverage or spend authorization.",
  loadNote: args["load-note"] ?? null, phases: [], measurements: {}, identities: {} };
const phase = (name, data = {}) => { result.phases.push({ name, atIso: new Date().toISOString(), ...data }); log(`phase ${name}${data.status ? `: ${data.status}` : ""}`); };
let inspectionLock, session, runtime, ledger, childStarted = false, wroteToPlc = false;
const takeInspectionLock = () => {
  const fd = openSync(ownershipPath, "wx");
  writeSync(fd, JSON.stringify({ owner: "w4-commissioning-inspection", pid: process.pid, directory, acquiredAtIso: new Date().toISOString() }) + "\n");
  inspectionLock = fd;
};
const releaseInspectionLock = () => { if (inspectionLock === undefined) return; closeSync(inspectionLock); inspectionLock = undefined; unlinkSync(ownershipPath); };
/** Scripted zero-cost commissioning turns for the lease cases. Not a model and not a Wonder decision. */
class ScriptedLeaseProvider {
  id = "w4-commissioning-scripted-leases-v1;zero-model"; paid = false; estimatedRequestUsd = 0;
  turn = 0; stall = null; h = null;
  async decide(_context, signal) {
    // Keyed by finished leases, so a lease that already ended at begin (never reaching decide) keeps the script aligned.
    const turn = this.turn = ledger.events.filter(e => e.type === "agent.response" && e.data.response.phase === "decision_lease_finished").length + 1;
    const reply = decision => ({ decision, costUsd: 0, responseId: `w4-scripted-${turn}` });
    const pause = ms => new Promise(resolve => { const t = setTimeout(resolve, ms); signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true }); });
    const observe = id => ({ id, name: "observe_for_duration", arguments: { durationMs: 300 } });
    if (turn === 1) { await pause(700); return reply({ summary: "Commissioning lease 1 (scripted): reasoning under the default hold lease", calls: [observe("lease-observe-1")], reasoningLease: { mode: "continue", timeoutMs: 3000 } }); }
    if (turn === 2) { await pause(300); return reply({ summary: "Commissioning lease 2 (scripted): continue lease returned within bounds", calls: [observe("lease-observe-2")],
      reasoningLease: { mode: "condition_deadline", timeoutMs: 3000, condition: { signal: "controller.ItemActive", equals: true } } }); }
    if (turn === 3) { await pause(300); return reply({ summary: "Commissioning lease 3 (scripted): unmet condition returned; introduce an unassigned carton", calls: [
      { id: "lease-carton", name: "introduce_carton", arguments: { itemId: "unassigned", requestedRoute: null } }],
      reasoningLease: { mode: "condition_deadline", timeoutMs: 6000, condition: { signal: "controller.ItemActive", equals: true } } }); }
    if (turn === 4) {
      // Return only after the PLC reported the condition; the child must already have held the world.
      const began = performance.now();
      while (this.h.values()["controller.ItemActive"] !== true && performance.now() - began < 4000 && !signal.aborted) await pause(50);
      await pause(300);
      return reply({ summary: "Late decision after a met condition (must not apply)", calls: [observe("late-after-condition")] });
    }
    if (turn === 5) { await pause(200); return reply({ summary: "Commissioning lease 5 (scripted): unmet condition returned", calls: [observe("lease-observe-5")], reasoningLease: { mode: "continue", timeoutMs: 400 } }); }
    if (turn === 6) {
      // Deliberate 1.5 s parent event-loop stall under a 400 ms continue lease.
      const startedAtEpochMs = Date.now(), end = performance.now() + 1500;
      while (performance.now() < end) { /* stall */ }
      this.stall = { startedAtEpochMs, endedAtEpochMs: Date.now(), leaseTimeoutMs: 400 };
      return reply({ summary: "Late decision after lease expiry (must not apply)", calls: [observe("late-after-expiry")] });
    }
    throw new Error(`No scripted commissioning turn ${turn}`);
  }
}
async function openTransport(event) {
  if (offline) return (await import(pathToFileURL(resolve(args["transport-module"])).href)).createTransport(JSON.parse(args["transport-options"] ?? "{}"), { event });
  return createM8NativeTransport({ userName: credentials.user, password: credentials.password, event, modulePath: result.identities.preflight.modulePath });
}
async function readOnlyInspection(label) {
  const connection = inspectionConnection(await openTransport(journal), (kind, data) => journal(kind, { inspection: label, ...data }));
  try { const inspection = await connection.inspect(); return { inspection, refusedWrites: connection.gate.refusedWrites }; }
  finally { await connection.connector.close().catch(error => journal("close.failed", { inspection: label, message: error.message })); }
}

try {
  // 1. Preconditions. No PLC contact.
  const checkout = { commit: git(root, "rev-parse", "HEAD"), dirty: git(root, "status", "--porcelain", "--", "src", "scripts", "test", "package.json").split(/\r?\n/).filter(Boolean) };
  const moduleRoot = resolve(args.module ?? root), entry = join(moduleRoot, "src/live/wonder-process/index.ts");
  result.identities = { harness: checkout, projectSha256: shaFile(join(root, "codesys/conveyordemo.project")), worldSha256: shaFile(join(root, worldRelative)),
    mapSha256: shaFile(join(root, "codesys/demo/signal-map-v1.json")), specSha256: shaFile(join(root, "docs/conveyor-machine-spec.md")), ownershipPath, node: process.version };
  if (result.identities.projectSha256 !== frozenProjectHash) throw new Error("Frozen M8 project bytes differ from the accepted build; no PLC contact");
  if (offline) {
    if (args["load-note"] === undefined) result.loadNote = "offline: no portal/HMI load";
    if (!args["transport-module"] || !args.ownership) throw new Error("Offline commissioning requires --transport-module and a lane-specific --ownership lock");
    if (ownershipPath.toLowerCase() === resolve(sharedLock).toLowerCase()) throw new Error("Offline commissioning must not take the shared main-checkout runtime lock");
    result.identities.module = { root: moduleRoot, commit: git(moduleRoot, "rev-parse", "HEAD"), entry, verified: "offline-unpinned" };
  } else {
    if (args["offline-abort-at"] || args["transport-module"] || args["offline-timing"]) throw new Error("Offline test hooks are refused in live mode");
    if (checkout.dirty.length) throw new Error(`Harness checkout has uncommitted src/scripts/test changes; commit before a live run: ${checkout.dirty.join(", ")}`);
    const pin = process.env.CONTROLSBENCH_WONDER_PROCESS_COMMIT;
    if (!pin || !process.env.CONTROLSBENCH_WONDER_HANDOFF || !process.env.CONTROLSBENCH_WONDER_HANDOFF_SHA256) throw new Error("Pinned adapter commit, reviewed handoff manifest and its SHA-256 are required; no PLC contact");
    const attested = verifyOwnerEntry(entry, pin);
    result.identities.module = { root: attested.ownerRoot, commit: pin, entry: attested.entryPath, entryBlob: attested.entryBlob, entrySha256: attested.entrySha256,
      handoff: { path: resolve(process.env.CONTROLSBENCH_WONDER_HANDOFF), sha256: process.env.CONTROLSBENCH_WONDER_HANDOFF_SHA256 } };
    process.env.OPC_PASSWORD = credentials.password;
    const preflight = m8Preflight({ ownershipPath });
    delete process.env.OPC_PASSWORD;
    result.identities.preflight = preflight;
    if (!preflight.ready) throw new Error(`M8 preflight failed: ${JSON.stringify(preflight)}; no PLC contact`);
  }
  if (existsSync(ownershipPath)) throw new Error(`Runtime ownership is held (${ownershipPath}); no PLC contact. Reconcile the previous owner explicitly`);
  phase("preconditions", { status: "pass" });

  // 2. Read-only baseline inspection under the ownership lock (writes are refused by the gate).
  takeInspectionLock();
  const baseline = await readOnlyInspection("baseline");
  writeFileSync(join(directory, "baseline.json"), JSON.stringify({ ...baseline, summary: summarizeInspection(baseline.inspection) }, null, 2) + "\n");
  const mismatches = baselineMismatches(baseline.inspection.observation.values);
  phase("baseline", { status: mismatches.length ? "refused" : "pass", summary: summarizeInspection(baseline.inspection) });
  if (mismatches.length) throw new Error(`Baseline is not a clean stopped M8 state (${mismatches.join(", ")}); no write. A saved W4 held run is reconciled only by scripts/recover-w4-held.js`);
  if (args["inspect-only"]) { result.status = "inspected"; throw null; }
  releaseInspectionLock();

  // 3. Isolated session and runtime. The child takes ownership and connects only at Start.
  const adapter = await import(pathToFileURL(entry).href);
  ledger = new CampaignLedger(`w4-commissioning-${stamp}`, { file: join(directory, "campaign.jsonl") });
  const context = { ledger, scope: { normal: true, runtime: true, faults: true }, artifactDirectory: directory,
    hmi: { async perform() { throw new Error("HMI operation is not part of zero-model commissioning"); } } };
  if (offline) session = await adapter.openOfflineWonderSession(context, { transportModule: resolve(args["transport-module"]),
    transportOptions: JSON.parse(args["transport-options"] ?? "{}"), ownershipPath, timing: JSON.parse(args["offline-timing"] ?? "{}") });
  else { process.env.OPC_PASSWORD = credentials.password; try { session = await adapter.createWonderSession(context); } finally { delete process.env.OPC_PASSWORD; } }
  result.identities.session = { contract: session.contract, handoff: session.handoff, provenance: session.provenance, child: session.process.identity,
    loadedWorldSha256: session.process.loaded.worldSha256, loadedProjectSha256: session.process.loaded.projectSha256 };
  const driver = session.driver;
  const manifest = JSON.parse(readFileSync(join(root, "artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.manifest.json"), "utf8"));
  const signals = [...manifest.signals, ...driver.observedOutputIds.filter(id => !manifest.signals.some(s => s.id === id)).map(id => ({ id, direction: "plc_to_world", description: "Declared observed M8 controller diagnostic" }))];
  const provider = new ScriptedLeaseProvider();
  runtime = new CampaignRuntime({ ledger, provider, budget: new CampaignBudget(ledger), driver, controller: session.controller, hmi: context.hmi,
    paidAuthorized: false, requireDecisionLeases: true, evidenceClass: result.evidenceClass, claimBoundary: result.claimBoundary, categories: ["normal", "runtime", "faults"],
    provenance: { ...session.provenance, model: provider.id }, spec: readFileSync(join(root, "docs/conveyor-machine-spec.md"), "utf8"), signals,
    capabilities: { harness: HARNESS_CONTRACT, maximumCadenceHz: 10, observationGuardMs: 300, decisionLeases: ["hold", "continue", "condition_deadline"], model: "none (scripted commissioning turns)" } });
  childStarted = true;
  await runtime.start(true);
  await startConfirmed(driver, driver.boundaryRevision);
  if (runtime.status !== "running") throw new Error(`Isolated session did not start: ${JSON.stringify(ledger.state.report ?? ledger.events.filter(e => e.type === "campaign.state").at(-1)?.data)}`);
  const firstAck = ledger.events.find(e => e.type === "plc.acknowledged");
  phase("session", { status: "pass", child: session.process.identity, bootIdentity: firstAck?.data.bootIdentity, baselineBootMatches: firstAck?.data.bootIdentity === baseline.inspection.observation.bootIdentity });
  if (firstAck?.data.bootIdentity !== baseline.inspection.observation.bootIdentity) throw new Error("PLC boot identity changed between baseline inspection and session start");

  const h = harness(driver);
  await normalOperation(h);
  await leaseCases(h, provider);
  await declaredFault(h);
  await cleanShutdown(h);
  result.status = "pass";
} catch (error) {
  if (error !== null) { result.error = error instanceof Error ? error.stack : String(error); console.error(error instanceof Error ? error.message : error); }
} finally {
  if (runtime && !["stopped", "completed", "failed"].includes(runtime.status)) await runtime.stop(`W4 commissioning stopped: ${result.error?.split("\n")[0] ?? "harness ended"}`).catch(e => { result.stopError = e.message; });
  if (session) await session.dispose().catch(e => { result.disposeError = e.message; });
  ledger?.close();
  releaseInspectionLock();
  const journals = join(directory, "wonder-process");
  const transport = readJsonl(join(journals, "child-transport.jsonl"));
  wroteToPlc = transport.some(e => ["opc.write", "commit.requested", "command.requested"].includes(e.kind));
  const closed = readJsonl(join(journals, "child-lifecycle.jsonl")).filter(e => e.kind === "closed").at(-1) ?? null;
  result.child = childStarted ? { exit: session?.process.channel.exit ?? null, closed, lockPresentAfterDispose: existsSync(ownershipPath) } : null;
  result.wroteToPlc = wroteToPlc;
  let postStop = null;
  if (childStarted && session?.process.channel.exit) {
    try { const after = await readOnlyInspection("post-stop"); postStop = after.inspection; writeFileSync(join(directory, "final-inspection.json"), JSON.stringify({ ...after, summary: summarizeInspection(postStop) }, null, 2) + "\n"); }
    catch (error) { result.postStopInspectionError = error.message; }
  }
  if (childStarted) {
    const events = existsSync(join(directory, "campaign.jsonl")) ? readLedger(join(directory, "campaign.jsonl")) : [];
    const state = deriveHeldState({ directory, campaignId: ledger?.campaignId ?? "", reason: result.error?.split("\n")[0] ?? (result.status === "pass" ? "completed" : "stopped"),
      ownershipPath, ledgerEvents: events, identities: result.identities, childExit: session?.process.channel.exit ?? null, postStop });
    result.measurements.cadence = cadence(readJsonl(join(journals, "child-stream.jsonl")));
    if (result.status === "pass") {
      result.qualification = commissioningQualification(result.measurements);
      if (!result.qualification.passed) {
        result.status = "failed_qualification";
        result.error = `Commissioning evidence did not qualify: ${result.qualification.failures.join("; ")}`;
      }
    }
    if (events.length) { result.report = report(events); writeFileSync(join(directory, "report.json"), JSON.stringify(result.report, null, 2) + "\n"); }
    if (result.status === "pass") {
      result.finalState = { appliedEpoch: state.plc.appliedEpoch, appliedSequence: state.plc.appliedSequence, appliedImageSha256: state.appliedImageSha256,
        ownership: state.ownership.closeResult, postStopMatchesApplied: !!postStop && state.postStopInspection.activeImageMatchesApplied
          && postStop.observation.appliedEpoch === state.plc.appliedEpoch && postStop.observation.appliedSequence === state.plc.appliedSequence,
        postStopBaselineMismatches: postStop ? baselineMismatches(postStop.observation.values) : ["not inspected"] };
      if (!result.finalState.postStopMatchesApplied || result.finalState.postStopBaselineMismatches.length || state.ownership.closeResult !== "released") {
        result.status = "failed_final_state"; result.error = `Final state not verified clean: ${JSON.stringify(result.finalState)}`;
      }
    }
    if (result.status !== "pass" && wroteToPlc) {
      writeFileSync(join(directory, "held-state.json"), JSON.stringify(state, null, 2) + "\n");
      result.heldState = { file: "held-state.json", sha256: shaFile(join(directory, "held-state.json")), ownership: state.ownership,
        recovery: `node scripts/recover-w4-held.js "${directory}"  (read-only inspection; reconcile only with --reconcile --authorize <held-state sha256>)` };
      result.status = "held";
    }
  }
  result.evidenceHashes = Object.fromEntries(["campaign.jsonl", "baseline.json", "final-inspection.json", "held-state.json", "report.json", "inspection-transport.jsonl",
    "wonder-process/child-stream.jsonl", "wonder-process/child-transport.jsonl", "wonder-process/child-lifecycle.jsonl", "wonder-process/parent-boundary.jsonl"]
    .filter(f => existsSync(join(directory, f))).map(f => [f, shaFile(join(directory, f))]));
  result.finishedAtIso = new Date().toISOString();
  writeFileSync(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
  writeFileSync(join(artifactsRoot, "latest.json"), JSON.stringify({ status: result.status, directory, error: result.error?.split("\n")[0] ?? null }, null, 2) + "\n");
  console.log(JSON.stringify({ status: result.status, directory, error: result.error?.split("\n")[0] ?? null, heldState: result.heldState?.sha256 ?? null }));
  process.exitCode = ["pass", "inspected"].includes(result.status) ? 0 : 1;
}

// ------------------------------------------------------------------------------------------------
// Driver.start() does not wait for the child: a host-driven tool sent before the child's start reply
// carries the pre-start boundary revision and is refused as stale (safely, nothing applied). The
// model path never races here because every turn first awaits a lease. Wait for the confirmation.
async function startConfirmed(driver, before, timeoutMs = 5000) {
  const began = performance.now();
  while (driver.boundaryRevision <= before) {
    if (driver.failure || performance.now() - began > timeoutMs) throw new Error(`Child did not confirm Start/Resume (${driver.failure?.message ?? "no boundary revision change"})`);
    await sleep(10);
  }
}
async function resume(driver) { const before = driver.boundaryRevision; runtime.resume(); await startConfirmed(driver, before); }
function checkpoint(label) { if (offline && args["offline-abort-at"] === label) throw new Error(`Offline abort hook at ${label}`); }
function harness(driver) {
  const values = () => ledger.state.outputs;
  const cartons = () => driver.lastSnapshot?.state?.cartons ?? [];
  const latestOutput = () => ledger.recentEvents(1, e => e.type === "plc.output")[0];
  let actionId = 0, expectedFault = 0;
  const healthy = () => {
    const fault = Number(values()["controller.FaultCode"] ?? 0);
    if (fault && fault !== h.expectedFault) throw new Error(`Unexpected M8 fault ${fault}: ${values()["controller.FaultText"]}`);
    if (driver.failure) throw new Error(`Isolated session ${driver.failure.outcome}: ${driver.failure.message}`);
    if (runtime.status !== "running") throw new Error(`Campaign ${runtime.status}; stop without next step`);
  };
  async function tool(name, args, id = `w4-${++actionId}-${name}`) {
    healthy();
    const r = await runtime.executeTool({ id, name, arguments: args });
    if (r.status !== "applied") throw new Error(`${name} ${r.status}: ${r.message}`);
    if (name !== "finish_campaign") healthy();
    return r;
  }
  async function wait(predicate, label, timeoutMs = 15_000) {
    const began = performance.now();
    await new Promise((resolve, reject) => {
      let off = () => {};
      const check = () => { try {
        healthy();
        if (predicate()) { clearInterval(timer); off(); resolve(); }
        else if (performance.now() - began > timeoutMs) throw new Error(`Unexplained deadline: ${label}`);
      } catch (e) { clearInterval(timer); off(); reject(e); } };
      const timer = setInterval(check, 20);
      off = driver.subscribe(check); check();
    });
    return ledger.append("observation", { summary: `${label}; elapsed ${Math.round(performance.now() - began)} ms`, evidenceRefs: [latestOutput().id] }).id;
  }
  async function complete(experiment, claims, inference) {
    const output = latestOutput();
    await tool("record_finding", { id: experiment, title: `W4 commissioning ${experiment}: declared step outcomes observed`, experimentId: experiment,
      claims: claims.map(signal => ({ evidenceId: output.id, signal, equals: output.data.values[signal] })), injectedTruthRefs: experiment === "w4-fault" ? ledger.events.filter(e => e.type === "fault.truth").map(e => e.id) : [],
      inference, assumptions: ["Preserved Muse world 0.5.0; one carton at a time; M8 build 8001/interface 1 declared timers"],
      uncertainty: "Commissioning of the isolated runtime path only; no controller coverage, Wonder decision or HMI-operation claim." });
    await runtime.applyDecision({ summary: `Completed ${experiment}`, completeExperiment: { id: experiment, evidenceRefs: [output.id], conclusion: "observed" }, calls: [] }, ledger.state.revision);
  }
  const h = { values, cartons, latestOutput, tool, wait, complete, healthy, driver, get expectedFault() { return expectedFault; }, set expectedFault(v) { expectedFault = v; } };
  return h;
}

async function normalOperation(h) {
  const { values, cartons, tool, wait } = h;
  await runtime.applyDecision({ summary: "Declared zero-model W4 commissioning steps (not a Wonder plan)", plan: { objective: "Commission the isolated runtime path against M8", experiments: [
    { id: "w4-normal", objective: "One assigned carton sorted to exit A with WCS offer, PLC completion and acknowledgement", category: "normal", requirements: [] },
    { id: "w4-leases", objective: "Hold, continue and condition-deadline reasoning leases enforced by the isolated child, including expiry under a parent stall", category: "runtime", requirements: [] },
    { id: "w4-fault", objective: "Declared drive overload, PLC fault 10, clear and operator Reset to a stopped baseline", category: "faults", requirements: [] }] }, calls: [] }, ledger.state.revision);
  await tool("operator_action", { action: "reset" });
  await tool("operator_action", { action: "start" });
  await wait(() => values()["controller.Mode"] === 1 && h.driver.lastImage.Drive_RunningFB === true && values()["controller.ReleaseReady"] === true && cartons().length === 0, "Auto, belt running, release ready, empty world");
  const before = { ...values() }, sequence = Number(before["controller.CompletionSequence"]) + 1;
  await tool("assign_route", { itemId: "401", route: "A" });
  await tool("introduce_carton", { itemId: "401", requestedRoute: "A" });
  await wait(() => values()["controller.ItemActive"] === true && values()["controller.ActiveItemId"] === 401, "PLC tracks carton 401");
  checkpoint("normal:carton-in-transit");
  await wait(() => values()["controller.CompletionSequence"] === sequence, "Carton 401 completion", 20_000);
  const v = values(), expect = { "controller.CompletionExit": 1, "controller.CompletionDisposition": 1, "controller.CompletionItemId": 401, "controller.CompletionRoute": 1,
    "controller.CountExitA": Number(before["controller.CountExitA"]) + 1, "controller.CountExitB": before["controller.CountExitB"], "controller.CountRunout": before["controller.CountRunout"],
    "controller.CountMisroute": before["controller.CountMisroute"] };
  const wrong = Object.entries(expect).filter(([k, want]) => v[k] !== want);
  if (wrong.length) throw new Error(`Normal sort outcome differs: ${wrong.map(([k, want]) => `${k}=${v[k]} (expected ${want})`).join(", ")}`);
  await wait(() => cartons().length === 0, "Carton 401 left the world");
  checkpoint("normal:completion-pending");
  await tool("acknowledge_completion", { sequence });
  await wait(() => values()["controller.ReleaseReady"] === true && values()["controller.CompletionPending"] === false, "Release re-enabled after acknowledgement");
  await h.complete("w4-normal", ["controller.Mode", "controller.CompletionSequence", "controller.CompletionExit", "controller.CompletionDisposition", "controller.CountExitA"],
    "Assigned carton sorted to exit A with WCS offer acknowledgement, PLC completion and peer acknowledgement through the isolated child.");
  phase("normal", { status: "pass", completionSequence: sequence });
}

async function leaseCases(h, provider) {
  const { values, cartons, wait } = h;
  const receipts = () => ledger.events.filter(e => e.type === "agent.response" && e.data.response.phase === "decision_lease_finished").map(e => ({ ...e.data.response.receipt, eventSequence: e.sequence }));
  const lateNeverRan = id => !ledger.events.some(e => e.type === "action.requested" && e.data.actionId === id);
  const heldWindow = (fromSeq, toSeq) => {
    const outputs = ledger.events.filter(e => e.type === "plc.output" && e.sequence > fromSeq && e.sequence < toSeq);
    const images = new Set(ledger.events.filter(e => e.type === "world.raw_image" && e.sequence > fromSeq && e.sequence < toSeq).map(e => JSON.stringify(e.data.image)));
    return { samples: outputs.length, distinctImages: images.size, plcCycleFirst: outputs[0]?.data.plcCycle, plcCycleLast: outputs.at(-1)?.data.plcCycle };
  };
  provider.h = h;
  // Turns 1-4: hold (valid), continue (valid), unmet condition (valid, then a carton is introduced), met condition (invalid, held).
  await runtime.runAgent();
  const afterCondition = receipts();
  const condition = afterCondition.at(-1);
  if (afterCondition.length !== 4 || !afterCondition.slice(0, 3).every(r => r.valid) || condition.valid || condition.boundary?.state !== "condition_met" || !condition.boundary?.worldHeld)
    throw new Error(`Lease receipts differ from the declared hold/continue/unmet/met sequence: ${JSON.stringify(afterCondition.map(r => ({ valid: r.valid, state: r.boundary?.state, reason: r.reason })))}`);
  if (runtime.status !== "paused" || !lateNeverRan("late-after-condition")) throw new Error("Met condition did not hold the campaign without applying the late decision");
  const conditionOutput = ledger.getEvent(condition.evidenceRefs[0]);
  if (conditionOutput?.data.values["controller.ItemActive"] !== true) throw new Error("Condition receipt does not cite the matching PLC observation");
  const conditionHeldSeq = ledger.state.sequence;
  await sleep(1000); // keep the world held briefly: PLC scans continue against the unchanged image
  const conditionHold = heldWindow(condition.eventSequence, ledger.state.sequence + 1);
  checkpoint("leases:held-after-condition");
  await resume(h.driver);
  const sequence = Number(values()["controller.CompletionSequence"]) + 1;
  await wait(() => values()["controller.CompletionSequence"] === sequence && cartons().length === 0, "Unassigned lease carton completes at runout after Resume", 20_000);
  if (values()["controller.CompletionExit"] !== 3 || values()["controller.CompletionDisposition"] !== 2) throw new Error("Unassigned carton did not complete at runout");
  await h.tool("acknowledge_completion", { sequence });
  await wait(() => values()["controller.ReleaseReady"] === true && values()["controller.CompletionPending"] === false, "Release re-enabled after lease carton");
  // Turns 5-6: unmet condition returns valid; then a continue lease expires during a 1.5 s parent event-loop stall.
  await runtime.runAgent();
  const all = receipts(), expiry = all.at(-1);
  if (all.length !== 6 || !all[4].valid || expiry.valid || expiry.boundary?.state !== "expired" || !expiry.boundary?.worldHeld)
    throw new Error(`Expiry receipt differs: ${JSON.stringify(all.slice(4).map(r => ({ valid: r.valid, state: r.boundary?.state, reason: r.reason })))}`);
  if (runtime.status !== "paused" || !lateNeverRan("late-after-expiry")) throw new Error("Expired lease did not hold the campaign without applying the late decision");
  await sleep(1000);
  const expiryHold = heldWindow(expiry.eventSequence, ledger.state.sequence + 1);
  checkpoint("leases:held-after-expiry");
  await resume(h.driver);
  await wait(() => values()["controller.Mode"] === 1, "World resumed after expiry hold");
  result.measurements.leases = { receipts: all.map(r => ({ id: r.id, valid: r.valid, state: r.boundary?.state, mode: r.boundary?.policy?.mode, timeoutMs: r.boundary?.policy?.timeoutMs,
    elapsedMs: r.boundary?.elapsedMs, worldHeld: r.boundary?.worldHeld, reason: r.reason, evidenceRefs: r.evidenceRefs })),
    parentStall: provider.stall, stallCommits: stallCommits(provider.stall), conditionHold, expiryHold, conditionHeldThroughSequence: conditionHeldSeq };
  for (const [name, hold] of [["condition", conditionHold], ["expiry", expiryHold]])
    if (hold.samples < 2 || hold.distinctImages !== 1 || BigInt(hold.plcCycleLast ?? 0) <= BigInt(hold.plcCycleFirst ?? 0)) throw new Error(`${name} hold did not show an unchanged image with PLC scans continuing: ${JSON.stringify(hold)}`);
  await h.complete("w4-leases", ["controller.Mode", "Motor_RunCmd"], "Child-enforced leases returned evidence-backed receipts; met condition and expiry held the world while PLC scans continued; late decisions were not applied.");
  phase("leases", { status: "pass", receipts: result.measurements.leases.receipts.map(r => `${r.mode}:${r.state}:${r.valid}`) });
}
function stallCommits(stall) {
  if (!stall) return null;
  const ticks = readJsonl(join(directory, "wonder-process/child-stream.jsonl")).filter(e => e.record?.kind === "tick").map(e => Date.parse(e.atIso));
  const within = ticks.filter(t => t >= stall.startedAtEpochMs && t <= stall.endedAtEpochMs);
  // Include both stall edges: two closely-spaced commits alone cannot hide a long silent tail.
  const edges = [stall.startedAtEpochMs, ...within, stall.endedAtEpochMs];
  const gaps = edges.slice(1).map((t, i) => t - edges[i]);
  return { stallMs: Math.round(stall.endedAtEpochMs - stall.startedAtEpochMs), childCommitsDuringStall: within.length, maxGapMs: gaps.length ? Math.max(...gaps) : null };
}

async function declaredFault(h) {
  const { values, cartons, tool, wait, driver } = h;
  await wait(() => values()["controller.Mode"] === 1 && values().Motor_RunCmd === true && driver.lastImage.Drive_RunningFB === true && cartons().length === 0, "Auto running, empty world before fault");
  const before = { ...values() };
  h.expectedFault = 10;
  await tool("inject_fault", { controlId: "fault.setOverload", parameters: { active: true } });
  await wait(() => values()["controller.FaultCode"] === 10, "PLC fault 10 (drive overload)", 6000);
  const v = values();
  if (v["controller.Mode"] !== 3 || v.Motor_RunCmd !== false || v["controller.ItemActive"] !== false || v["controller.CompletionPending"] !== false
    || ["CountExitA", "CountExitB", "CountRunout", "CountMisroute"].some(n => v[`controller.${n}`] !== before[`controller.${n}`])) throw new Error(`Overload response differs: ${JSON.stringify(v)}`);
  checkpoint("fault:faulted");
  await tool("observe_for_duration", { durationMs: 500 });
  if (values()["controller.FaultCode"] !== 10) throw new Error("Fault 10 did not stay latched");
  await tool("clear_fault", { controlId: "fault.setOverload", parameters: { active: false } });
  await wait(() => driver.lastImage.Drive_Overload === false, "Overload cleared in the committed image");
  const reset = await tool("operator_action", { action: "reset" });
  await wait(() => values()["controller.FaultCode"] === 0 && values()["controller.Mode"] === 0, "Operator Reset to Stopped");
  h.expectedFault = 0;
  await h.complete("w4-fault", ["controller.Mode", "controller.FaultCode", "Motor_RunCmd", "StackLight_Red"],
    "Declared drive overload produced PLC fault 10 with motor off; after clearing the world fault an explicit operator Reset returned the controller to Stopped.");
  phase("fault", { status: "pass", resetEvidence: reset.evidenceRefs });
}

async function cleanShutdown(h) {
  const { values, cartons, tool, wait } = h;
  await wait(() => baselineMismatches(values()).length === 0 && cartons().length === 0, "Stopped baseline, empty world");
  checkpoint("shutdown:stopped");
  await tool("finish_campaign", { summary: "Zero-model W4 commissioning steps completed; controller Stopped with the at-rest image held in simulation" });
  for (let i = 0; i < 100 && runtime.status !== "completed"; i++) await sleep(20);
  if (runtime.status !== "completed") throw new Error(`Runtime did not finalize: ${runtime.status}`);
  phase("shutdown", { status: "pass" });
}

function cadence(stream) {
  const ticks = stream.filter(e => e.record?.kind === "tick");
  const at = ticks.map(e => e.atMonotonicMs), gaps = at.slice(1).map((t, i) => t - at[i]).sort((a, b) => a - b);
  const pick = q => gaps.length ? Math.round(gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))]) : null;
  return { commits: ticks.length, held: ticks.filter(e => e.record.held || e.record.advanced === false).length, gapP50Ms: pick(0.5), gapP95Ms: pick(0.95), gapMaxMs: gaps.length ? Math.round(gaps.at(-1)) : null,
    gapsOver300Ms: gaps.filter(g => g > 300).length, delayed: stream.filter(e => e.record?.kind === "delayed").length, faults: stream.filter(e => e.record?.kind === "fault").map(e => e.record.message) };
}
