// Explicit, recorded reconciliation of one saved failed H2 run that left M8 held (pattern of Lane A's
// scripts/prepare-m10-baseline.js). It refuses unless the PLC still shows exactly what that run left:
// same boot, same applied epoch/sequence, same held raw image, the declared transit timeout (fault 33)
// for the run's item, and unchanged exit counters. It then removes the invalid held world, has the WCS
// peer acknowledge the aborted completion, and requests Reset. It never touches any other state.
//
//   node scripts/recover-hmi-h2-baseline.js artifacts/hmi/h2/<failed run>     (via run-hmi-h2-live.ps1 -RecoverFrom)
import assert from "node:assert/strict";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { createM8NativeTransport } from "../src/live/m8-native-transport.ts";
import { M8OpcUaConnector } from "../src/live/m8-opcua.ts";
import { InstrumentedWorldContext } from "../src/proof/world-context.ts";
import { shaFile, frozenProjectHash } from "../src/campaign/m10-rehearsal.ts";
import { defaultOwnershipRoots } from "../src/hmi/service.ts";
import world from "../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts";

if (!process.env.OPC_USER || !process.env.OPC_PASSWORD) throw new Error("Use run-hmi-h2-live.ps1 -RecoverFrom <run> for a masked credential prompt");
const h2Root = resolve("artifacts/hmi/h2"), reference = resolve(process.argv[2] ?? "");
assert(reference.startsWith(h2Root + sep), "Reference must be a saved H2 run directory");
const prior = JSON.parse(readFileSync(join(reference, "result.json"), "utf8"));
assert.equal(prior.status, "failed", "Only a failed run can be reconciled");
// Only the two diagnosed coordinator-timing failures: heartbeat lapse (M8 ConnectorStale) or Lane A's 300 ms observation bound.
assert.match(prior.error, /ConnectorStale=true|World step gap [d.]+ ms exceeds the declared 300 ms observation bound/, "Only a diagnosed coordinator-timing failure is reconciled here");
const trace = gunzipSync(readFileSync(join(reference, "world-transport.jsonl.gz"))).toString("utf8").trim().split("\n").map(l => JSON.parse(l));
const lastCommit = trace.filter(e => e.kind === "commit.acknowledged").at(-1)?.receipt;
const lastObservation = trace.filter(e => e.kind === "observation").at(-1);
assert(lastCommit && lastObservation, "Reference lacks committed image or observation evidence");
// Which held state the failed run left decides the only reconciliation allowed:
//   transit-timeout: a tracked carton held in Auto (fault 33 expected); fresh world at rest, WCS ack, Reset.
//   injected-overload: the run's own injected drive overload, never cleared, held in the image (fault 10
//   expected); fresh world at rest without it, Reset.
//   start-feedback-timeout: Start accepted just before the heartbeat lapsed, image held at rest, no carton
//   (fault 11 expected: motor running feedback missing on start); Stop and Reset only, image unchanged.
const heldItem = lastObservation.observation.values["controller.ItemActive"] === true;
const finalPlc = prior.finalPlc ?? {};
const stimuli = readFileSync(join(reference, "campaign.jsonl"), "utf8").trim().split(/\r?\n/).map(l => JSON.parse(l))
  .filter(e => e.type === "world.stimulus" && e.data.control?.id === "fault.setOverload");
const overloadHeld = stimuli.length > 0 && stimuli.at(-1).data.control.payload.active === true && lastCommit.image.Drive_Overload === true;
const path = heldItem ? "transit-timeout"
  : overloadHeld && finalPlc.FaultCode === 10 && finalPlc.ItemActive === false ? "injected-overload"
  : finalPlc.Mode === 1 && finalPlc.Motor_RunCmd === true && finalPlc.Active_Drive_RunningFB === false && finalPlc.ItemActive === false ? "start-feedback-timeout" : undefined;
assert(path, "Reference left a held state this procedure does not reconcile; decide separately");
const itemId = heldItem ? Number(lastObservation.observation.values["controller.ActiveItemId"]) : 0;
const AT_REST = { D1_HomeFB: true, D1_ExtendedFB: false, D2_HomeFB: true, D2_ExtendedFB: false, Drive_RunningFB: false, Runout_Ready: true,
  PE_Entry: false, PE_D1Approach: false, PE_D2Approach: false, PE_ExitA: false, PE_ExitB: false, PE_Runout: false };

const mainRoot = defaultOwnershipRoots().at(-1);
for (const rel of ["artifacts/m10/operator-status.json", "codesys/demo/operator-status.json"]) {
  const f = join(mainRoot, rel);
  if (existsSync(f) && JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")).active) throw new Error(`${f} reports an active runtime owner`);
}
assert.equal(shaFile("codesys/conveyordemo.project"), frozenProjectHash);
const lockPath = join(mainRoot, "artifacts/m10/live.lock"), lock = openSync(lockPath, "wx");
const directory = join(h2Root, `recovery-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(directory);
writeFileSync(lockPath, JSON.stringify({ owner: "hmi-h2-recovery", pid: process.pid, directory }) + "\n");
const transportFile = join(directory, "transport.jsonl");
let activeImage;
const event = (kind, data) => { if (kind === "observation") activeImage = data.activeImage; appendFileSync(transportFile, JSON.stringify({ kind, atIso: new Date().toISOString(), atMonotonicMs: performance.now(), ...data }) + "\n"); };
const result = { schemaVersion: 1, status: "failed", evidenceKind: "explicit_reconciliation_of_saved_failed_H2_run", reference,
  referenceResultSha256: shaFile(join(reference, "result.json")), referenceTraceSha256: shaFile(join(reference, "world-transport.jsonl.gz")),
  projectSha256: frozenProjectHash, modelCalls: 0, startedAtIso: new Date().toISOString(),
  expected: { bootIdentity: lastCommit.bootIdentity, appliedEpoch: lastCommit.workstationEpoch, appliedSequence: lastCommit.workstationSequence, itemId, path } };
const log = m => console.log(`[recovery ${new Date().toISOString().slice(11, 23)}] ${m}`);
let connector;
try {
  connector = new M8OpcUaConnector(createM8NativeTransport({ userName: process.env.OPC_USER, password: process.env.OPC_PASSWORD, event }), event);
  delete process.env.OPC_PASSWORD;
  const initial = await connector.open();
  result.initialObservation = initial; result.initialActiveImage = activeImage;
  const v = initial.values;
  log(`observed Mode ${v["controller.ModeText"]}, fault ${v["controller.FaultCode"]}, item active ${v["controller.ItemActive"]}, completion ${v["controller.CompletionSequence"]} pending ${v["controller.CompletionPending"]}, stale ${initial.connectorStale}`);
  assert.equal(initial.bootIdentity, lastCommit.bootIdentity, "PLC restarted since the failed run: verify a clean baseline separately");
  assert.equal(initial.simulationApplied, true);
  assert.equal(initial.appliedEpoch, lastCommit.workstationEpoch, "Another writer applied a different epoch");
  assert.equal(initial.appliedSequence, lastCommit.workstationSequence, "Another writer applied a different sequence");
  assert.deepEqual(activeImage, lastCommit.image, "The held raw image changed since the failed run");
  if (path === "transit-timeout") {
    assert.equal(v["controller.FaultCode"], 33, "Expected the declared 30 s transit timeout (fault 33); any other state needs a separate decision");
    assert.equal(v["controller.ItemActive"], false); assert.equal(v["controller.CompletionItemId"], itemId);
    assert.equal(v["controller.CompletionDisposition"], 4); assert.equal(v["controller.CompletionExit"], 0); assert.equal(v["controller.CompletionPending"], true);
  } else {
    const expectedFault = path === "injected-overload" ? 10 : 11;
    assert.equal(v["controller.FaultCode"], expectedFault, `Expected fault ${expectedFault} for ${path}; any other state needs a separate decision`);
    assert.equal(v["controller.Mode"], 3); assert.equal(v["controller.ItemActive"], false); assert.equal(v["controller.CompletionPending"], false);
    const img = lastCommit.image;
    for (const [k, want] of Object.entries({ ...AT_REST, Drive_Overload: path === "injected-overload" })) assert.equal(img[k], want, `held image differs from the expected ${path} state: ${k}`);
  }
  for (const n of ["CountExitA", "CountExitB", "CountRunout", "CountMisroute"]) assert.equal(v[`controller.${n}`], lastObservation.observation.values[`controller.${n}`], `${n} changed`);
  event("baseline.reconciliation-authorized", { reference, path, reason: {
    "transit-timeout": "User-authorized reconciliation: coordinator heartbeat starved; held Auto carton reached the declared transit timeout",
    "injected-overload": "User-authorized reconciliation: the run stopped with its own injected drive overload still held in the image (fault 10)",
    "start-feedback-timeout": "User-authorized reconciliation: coordinator heartbeat starved during start-up; Start accepted with the image held at rest, so motor feedback never arrived (fault 11)" }[path] });
  log(`state matches the failed run exactly (${path}); reconciling`);
  await connector.action("stop", {}, "recovery-stop");
  let finalImage = activeImage;
  if (path !== "start-feedback-timeout") {
    const context = new InstrumentedWorldContext(world.manifest, { seed: 20261101, worldVersion: world.manifest.packageVersion });
    await world.initialize(context, { seed: 20261101, worldVersion: world.manifest.packageVersion });
    event("world.reset", { worldSha256: shaFile("artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts"), sourceEvents: context.events,
      reason: "Explicit replacement of the invalid held image with a new world baseline at rest; encoder reset is not physical travel evidence" });
    await connector.resetSession();
    let receipt;
    for (let i = 0; i < 5; i++) receipt = await connector.commit(context.plc.currentInputState());
    finalImage = receipt.image;
    assert.equal(finalImage.Drive_Overload, false);
    log("fresh world image at rest applied");
    if (path === "transit-timeout") await connector.action("completion_ack", { sequence: receipt.values["controller.CompletionSequence"] }, "recovery-completion-ack");
  }
  const reset = await connector.action("reset", {}, "recovery-reset");
  const r = reset.values;
  assert.equal(r["controller.Mode"], 0); assert.equal(r["controller.FaultCode"], 0); assert.equal(r.Motor_RunCmd, false);
  assert.equal(r["controller.ItemActive"], false); assert.equal(r["controller.CompletionPending"], false);
  Object.assign(result, { status: "pass", finalObservation: reset, finalImage });
  log("PLC Stopped, fault-free, no tracked item, no pending completion; simulation held at rest");
} catch (error) { result.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; console.error(error instanceof Error ? error.message : error); }
finally {
  if (connector) await connector.close().catch(e => { result.status = "failed"; result.closeError = e.message; process.exitCode = 1; });
  if (existsSync(transportFile)) { writeFileSync(`${transportFile}.gz`, gzipSync(readFileSync(transportFile))); unlinkSync(transportFile); result.transportSha256 = shaFile(`${transportFile}.gz`); }
  result.finishedAtIso = new Date().toISOString();
  writeFileSync(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
  writeFileSync(join(h2Root, "recovery-latest.json"), JSON.stringify({ status: result.status, directory, error: result.error?.split("\n")[0] ?? null }, null, 2) + "\n");
  closeSync(lock); unlinkSync(lockPath);
  console.log(JSON.stringify({ status: result.status, directory, error: result.error?.split("\n")[0] ?? null }));
}
