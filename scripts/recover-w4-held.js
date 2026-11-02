// Recorded reconciliation of one saved W4 commissioning run that stopped held
// (controlsbench.w4-recovery.v1). Inspect-only by default: it verifies the saved record against the
// run's own child journals, checks runtime ownership, then reads the PLC through a write-refusing
// gate and classifies the held state against the recorded W4/H2 paths. It writes nothing unless
// --reconcile --authorize <held-state sha256> is given, every precondition still matches in the
// same connection immediately before the first write, and the path is one this procedure supports.
// No retry, no automatic Reset outside the fixed path, no passthrough. A failure after the first
// write retains the lock and stops for a separate decision.
//
//   node scripts/recover-w4-held.js <run directory>                                   (read-only)
//   node scripts/recover-w4-held.js <run directory> --reconcile --authorize <sha256>
//   Live via scripts/run-w4-commissioning.ps1 -RecoverFrom <run> [-Reconcile -Authorize <sha256>].
//   Offline tests add --offline --transport-module <abs> --ownership <lane lock> --artifacts <root>.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { commonWonderPaths } from "../src/campaign/wonder-paths.ts";
import { frozenProjectHash } from "../src/campaign/m10-rehearsal.ts";
import { m8Preflight } from "../src/host/m8-campaign-factory.ts";
import { createM8NativeTransport } from "../src/live/m8-native-transport.ts";
import { InstrumentedWorldContext } from "../src/proof/world-context.ts";
import { worldSeed } from "../src/live/wonder-process/index.ts";
import { RECOVERY_SCHEMA, classifyHeldState, inspectionConnection, readJsonl, reconciledMismatches, sha256, shaFile, summarizeInspection } from "./lib/w4-commissioning.ts";

const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { reconcile: { type: "boolean" }, authorize: { type: "string" },
  offline: { type: "boolean" }, "transport-module": { type: "string" }, "transport-options": { type: "string" }, ownership: { type: "string" }, artifacts: { type: "string" } } });
const root = fileURLToPath(new URL("../", import.meta.url));
const offline = args.offline === true, reconcile = args.reconcile === true;
const sharedLock = commonWonderPaths().ownership;
const ownershipPath = resolve(offline ? args.ownership ?? "" : sharedLock);
const artifactsRoot = resolve(args.artifacts ?? join(root, "artifacts/w4-commissioning"));
const reference = resolve(positionals[0] ?? "");
const worldPath = join(root, "artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts");
const directory = join(reference, `recovery-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const log = message => console.log(`[w4 recovery ${new Date().toISOString().slice(11, 23)}] ${message}`);
const credentials = offline ? null : { user: process.env.OPC_USER, password: process.env.OPC_PASSWORD };
if (!offline) delete process.env.OPC_PASSWORD;
const result = { schemaVersion: 1, schema: RECOVERY_SCHEMA, status: "refused", mode: reconcile ? "reconcile" : "inspect", scope: offline ? "offline-fake-transport" : "live-m8",
  reference, startedAtIso: new Date().toISOString(), modelCalls: 0, writesAuthorized: false, checks: [] };
const fail = message => { throw new Error(message); };
const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
let lock = { mode: "none" }, connection, transportFile, dirty = false;

try {
  // 1. The saved record, bound to the run's own journals. No PLC contact.
  if (!positionals[0] || dirname(reference).toLowerCase() !== artifactsRoot.toLowerCase()) fail(`Reference must be a saved W4 commissioning run directly under ${artifactsRoot}`);
  const prior = JSON.parse(readFileSync(join(reference, "result.json"), "utf8"));
  mkdirSync(directory);
  if (prior.status !== "held" || !prior.heldState?.sha256) fail("Only a saved W4 run that stopped held (result status \"held\") is reconciled here");
  const heldBytes = readFileSync(join(reference, "held-state.json")), heldSha = shaFile(join(reference, "held-state.json"));
  if (heldSha !== prior.heldState.sha256) fail("held-state.json differs from the hash the run recorded");
  const record = JSON.parse(heldBytes.toString("utf8"));
  Object.assign(result, { heldStateSha256: heldSha, resultSha256: shaFile(join(reference, "result.json")), campaignId: record.campaignId });
  for (const [file, sha] of Object.entries(record.evidence)) if (!existsSync(join(reference, file)) || shaFile(join(reference, file)) !== sha) fail(`Run evidence ${file} changed since the held state was recorded`);
  const acks = readJsonl(join(reference, "wonder-process/child-transport.jsonl")).filter(e => e.kind === "commit.acknowledged");
  const last = acks.at(-1)?.receipt;
  if (!last || last.workstationEpoch !== record.lastAcknowledgedCommit?.epoch || last.workstationSequence !== record.lastAcknowledgedCommit?.sequence
    || JSON.stringify(last.image) !== JSON.stringify(record.lastAcknowledgedCommit.image)) fail("Child transport journal disagrees with the recorded last acknowledged commit");
  if (reconcile && args.authorize !== heldSha) fail(`--reconcile requires --authorize ${heldSha} (the reviewed held-state.json SHA-256)`);
  if (shaFile(join(root, "codesys/conveyordemo.project")) !== frozenProjectHash) fail("Frozen M8 project bytes differ; no PLC contact");
  if (shaFile(worldPath) !== record.identities.worldSha256) fail("World bytes differ from the run's; run recovery from the run's checkout");
  if (record.ownership.path.toLowerCase() !== ownershipPath.toLowerCase()) fail(`Recorded ownership path ${record.ownership.path} differs from this session's ${ownershipPath}`);
  if (offline && ownershipPath.toLowerCase() === resolve(sharedLock).toLowerCase()) fail("Offline recovery must not use the shared main-checkout lock");
  if (alive(record.child.pid)) fail(`The run's child process ${record.child.pid} is still running; it may still own the session`);
  if (!offline) {
    process.env.OPC_PASSWORD = credentials.password;
    const preflight = m8Preflight({ ownershipPath }); delete process.env.OPC_PASSWORD;
    result.preflight = preflight;
    if (!preflight.projectUnchanged || preflight.legacySessionActive || !preflight.nativeModuleAvailable || !preflight.credentialsPresent) fail(`M8 preflight failed: ${JSON.stringify(preflight)}`);
  }

  // 2. Ownership: take the free lock, or adopt exactly the run's own retained lock (its child is gone).
  const ours = JSON.stringify({ owner: "w4-recovery", pid: process.pid, reference, heldStateSha256: heldSha, mode: result.mode, acquiredAtIso: new Date().toISOString() }) + "\n";
  if (existsSync(ownershipPath)) {
    const original = readFileSync(ownershipPath);
    let current; try { current = JSON.parse(original.toString("utf8")); } catch { current = null; }
    if (current?.owner !== "wonder-process-v1" || current.nonce !== record.child.nonce || current.campaignId !== record.campaignId)
      fail(`Runtime ownership is held by another owner (${original.toString("utf8").trim().slice(0, 300)}); not this run's retained lock`);
    if (alive(current.parentPid)) fail(`The run's host process ${current.parentPid} is still running`);
    if (sha256(original) !== record.ownership.lockSha256) fail("The run's retained lock changed since the held state was recorded");
    writeFileSync(ownershipPath, ours);
    lock = { mode: "adopted", original };
    result.ownership = { adopted: current, originalSha256: sha256(original) };
  } else {
    const fd = openSync(ownershipPath, "wx"); writeSync(fd, ours); closeSync(fd);
    lock = { mode: "acquired" }; result.ownership = { acquired: true };
  }

  // 3. Read-only inspection through the write-refusing gate, then classification.
  transportFile = join(directory, "transport.jsonl");
  const journal = (kind, data) => appendFileSync(transportFile, JSON.stringify({ kind, atIso: new Date().toISOString(), atMonotonicMs: performance.now(), ...data }) + "\n");
  const transport = offline ? (await import(pathToFileURL(resolve(args["transport-module"])).href)).createTransport(JSON.parse(args["transport-options"] ?? "{}"), { event: journal })
    : createM8NativeTransport({ userName: credentials.user, password: credentials.password, event: journal, modulePath: result.preflight.modulePath });
  connection = inspectionConnection(transport, journal);
  const first = await connection.inspect();
  const classification = classifyHeldState(record, first);
  Object.assign(result, { inspection: summarizeInspection(first), classification });
  writeFileSync(join(directory, "inspection.json"), JSON.stringify({ heldStateSha256: heldSha, observation: first.observation, activeImage: first.activeImage, classification }, null, 2) + "\n");
  log(`path ${classification.path ?? "none"}: ${classification.supported ? `supported, plan ${classification.plan.map(s => s.op).join(" > ") || "(no writes)"}` : `refused: ${classification.refusals.join("; ")}`}`);
  if (!classification.supported) fail(`Held state is not reconcilable by this procedure (unmet: ${classification.refusals.join("; ")})`);
  if (!reconcile) { result.status = classification.plan.length ? "inspected" : "no_reconciliation_required"; throw null; }
  if (!classification.plan.length) { result.status = "no_reconciliation_required"; throw null; }

  // 4. Reconcile: re-inspect in this same connection, require the identical classification, record the
  // authorization, then run the fixed path. From here on a failure retains the lock.
  const again = await connection.inspect();
  const confirm = classifyHeldState(record, again);
  if (!confirm.supported || confirm.path !== classification.path || JSON.stringify(confirm.plan) !== JSON.stringify(classification.plan))
    fail(`PLC state changed between inspection and the first write (${confirm.path}: ${confirm.refusals.join("; ")}); no write`);
  connection.gate.authorize(`User-authorized W4 reconciliation of ${reference} (held-state sha256 ${heldSha}), path ${confirm.path}: ${confirm.evidenceBasis}`);
  result.writesAuthorized = true; dirty = true;
  const { connector } = connection;
  let receipt = again.observation, image;
  for (const step of confirm.plan) {
    journal("reconciliation.step", { step });
    log(`step ${step.op}`);
    if (step.op === "stop") receipt = await connector.action("stop", {}, "w4-recovery-stop");
    else if (step.op === "reset") receipt = await connector.action("reset", {}, "w4-recovery-reset");
    else if (step.op === "completion_ack") {
      if (receipt.values["controller.CompletionSequence"] !== step.sequence) fail(`Completion sequence changed to ${receipt.values["controller.CompletionSequence"]}; stop`);
      receipt = await connector.action("completion_ack", { sequence: step.sequence }, "w4-recovery-completion-ack");
    } else if (step.op === "fresh_world") {
      const world = (await import(`${pathToFileURL(worldPath).href}?w4-recovery=${Date.now()}`)).default;
      const context = new InstrumentedWorldContext(world.manifest, { seed: worldSeed, worldVersion: world.manifest.packageVersion });
      await world.initialize(context, { seed: worldSeed, worldVersion: world.manifest.packageVersion });
      journal("world.reset", { worldSha256: shaFile(worldPath), seed: worldSeed, sourceEvents: context.events,
        reason: "Explicit replacement of the held image with a new world baseline at rest; encoder reset is not physical travel evidence" });
      await connector.resetSession();
      for (let i = 0; i < 5; i++) receipt = await connector.commit(context.plc.currentInputState());
      image = receipt.image;
    } else if (step.op === "await_stopped") {
      // Stopping completes on running feedback off plus 200 ms of stationary encoder; no fault to reset.
      const deadline = performance.now() + 3000;
      do { await new Promise(r => setTimeout(r, 150)); receipt = await connector.commit(image); } while (receipt.values["controller.Mode"] !== 0 && performance.now() < deadline);
    }
  }
  const final = await connection.inspect();
  const mismatches = reconciledMismatches(final.observation.values);
  Object.assign(result, { finalObservation: summarizeInspection(final), finalImage: final.activeImage });
  if (mismatches.length) fail(`Reconciliation did not reach the stopped baseline: ${mismatches.join(", ")}; stop and decide separately`);
  result.status = "pass"; dirty = false;
  log("PLC Stopped, fault-free, no tracked item, no pending completion; simulation held at rest");
} catch (error) {
  if (error !== null) { result.error = error instanceof Error ? error.stack : String(error); console.error(error instanceof Error ? error.message : error); }
} finally {
  if (connection) await connection.connector.close().catch(e => { result.closeError = e.message; });
  if (connection) result.refusedWrites = connection.gate.refusedWrites;
  // Ownership: release after a pass or when nothing was written; restore an adopted lock exactly; retain after a failed write.
  if (lock.mode !== "none") {
    if (dirty) result.ownershipAfter = "retained (a reconciliation write may have applied; decide separately)";
    else if (lock.mode === "adopted" && result.status !== "pass") { writeFileSync(ownershipPath, lock.original); result.ownershipAfter = "restored the run's retained lock byte-for-byte"; }
    else { unlinkSync(ownershipPath); result.ownershipAfter = "released"; }
  }
  result.finishedAtIso = new Date().toISOString();
  if (existsSync(directory)) {
    if (transportFile && existsSync(transportFile)) result.transportSha256 = shaFile(transportFile);
    writeFileSync(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
    writeFileSync(join(reference, "recovery-latest.json"), JSON.stringify({ status: result.status, directory, error: result.error?.split("\n")[0] ?? null }, null, 2) + "\n");
  }
  console.log(JSON.stringify({ status: result.status, directory: existsSync(directory) ? directory : null, path: result.classification?.path ?? null, error: result.error?.split("\n")[0] ?? null }));
  process.exitCode = ["pass", "inspected", "no_reconciliation_required"].includes(result.status) ? 0 : 1;
}
