import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, openSync, closeSync, unlinkSync } from "node:fs";
import { resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { createM8NativeTransport } from "../src/live/m8-native-transport.ts";
import { M8OpcUaConnector } from "../src/live/m8-opcua.ts";
import { InstrumentedWorldContext } from "../src/proof/world-context.ts";
import { readLedger, replay } from "../src/campaign/ledger.ts";
import { shaFile, frozenProjectHash } from "../src/campaign/m10-rehearsal.ts";
import world from "../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts";

if (!process.env.OPC_USER || !process.env.OPC_PASSWORD) throw new Error("Use the masked M10 operator session");
const root = resolve("artifacts/m10"), reference = resolve(JSON.parse(readFileSync(`${root}/latest.json`, "utf8")).directory);
assert(reference.startsWith(root + sep), "Reference must remain inside M10 artifacts");
const priorResult = JSON.parse(readFileSync(`${reference}/result.json`, "utf8"));
assert.equal(priorResult.status, "failed");
const prior = replay(readLedger(`${reference}/campaign.jsonl`));
assert.equal(prior.activeExperiment, "sort-a"); assert.equal(prior.connector.state, "stale");
const priorOutput = readLedger(`${reference}/campaign.jsonl`).filter(e => e.type === "plc.output").at(-1);
assert(priorOutput, "Cannot reconcile an attempt without observed PLC evidence");
const priorSource = readLedger(`${reference}/campaign.jsonl`).find(e => e.id === priorOutput.data.sourceId).data.source.data;
assert.equal(shaFile("codesys/conveyordemo.project"), frozenProjectHash);
const lock = openSync(`${root}/live.lock`, "wx"), directory = `${root}/preparation-${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(directory); const trace = `${directory}/transport.jsonl`; writeFileSync(trace, "", { flag: "wx" });
let activeImage;
const event = (kind, data) => { if (kind === "observation") activeImage = data.activeImage; appendFileSync(trace, JSON.stringify({ kind, atIso: new Date().toISOString(), atMonotonicMs: performance.now(), ...data }) + "\n"); };
const result = { status: "failed", evidenceKind: "explicit_reconciliation_of_saved_stale_A_trial", reference,
  referenceLedgerSha256: shaFile(`${reference}/campaign.jsonl`), projectSha256: frozenProjectHash, modelCalls: 0 };
let connector;
try {
  connector = new M8OpcUaConnector(createM8NativeTransport({ userName: process.env.OPC_USER, password: process.env.OPC_PASSWORD, event }), event);
  delete process.env.OPC_PASSWORD;
  const initial = await connector.open(); result.initialObservation = initial;
  assert.equal(initial.bootIdentity, priorSource.bootIdentity, "PLC restarted: require a separately verified clean baseline");
  assert.equal(initial.simulationApplied, true); assert.equal(initial.appliedEpoch, priorSource.workstationEpoch); assert.equal(initial.appliedSequence, priorSource.workstationSequence);
  assert.deepEqual(activeImage, prior.rawImage, "Another owner changed the held image");
  const v = initial.values, fault = v["controller.FaultCode"];
  assert([0,33].includes(fault), "Only held Auto or its declared 30 s transit timeout may be reconciled");
  assert(v["controller.ItemActive"] && v["controller.ActiveItemId"] === 101 || fault === 33 && v["controller.CompletionItemId"] === 101 && v["controller.CompletionDisposition"] === 4);
  for (const n of ["CountExitA", "CountExitB", "CountRunout", "CountMisroute"]) assert.equal(v[`controller.${n}`], prior.outputs[`controller.${n}`]);
  event("baseline.reconciliation-authorized", { reference, reason: "Replace invalid held world after diagnosed pre-step read starvation; preserve failed trial and declare input/counter rebaseline" });
  await connector.action("stop", {}, "baseline-stop");
  const context = new InstrumentedWorldContext(world.manifest, { seed: 20261031, worldVersion: world.manifest.packageVersion });
  await world.initialize(context, { seed: 20261031, worldVersion: world.manifest.packageVersion });
  event("world.reset", { worldSha256: shaFile("artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts"), sourceEvents: context.events,
    reason: "Explicit removal of invalid trial carton and new world baseline; encoder reset is not physical travel evidence" });
  await connector.resetSession();
  let receipt;
  for (let i = 0; i < 5; i++) receipt = await connector.commit(context.plc.currentInputState());
  await connector.action("completion_ack", { sequence: receipt.values["controller.CompletionSequence"] }, "baseline-completion-ack");
  const reset = await connector.action("reset", {}, "baseline-reset");
  assert.equal(reset.values["controller.Mode"], 0); assert.equal(reset.values["controller.FaultCode"], 0);
  assert.equal(reset.values.Motor_RunCmd, false); assert.equal(reset.values["controller.ItemActive"], false); assert.equal(reset.values["controller.CompletionPending"], false);
  Object.assign(result, { status: "pass", finalObservation: reset, finalImage: receipt.image });
} catch (error) { result.error = error.stack; process.exitCode = 1; console.error(error.message); }
finally {
  if (connector) await connector.close().catch(e => { result.status = "failed"; result.closeError = e.message; process.exitCode = 1; });
  writeFileSync(`${directory}/transport.jsonl.gz`, gzipSync(readFileSync(trace))); unlinkSync(trace);
  result.transportSha256 = shaFile(`${directory}/transport.jsonl.gz`);
  writeFileSync(`${directory}/result.json`, JSON.stringify(result, null, 2) + "\n");
  writeFileSync(`${root}/preparation-latest.json`, JSON.stringify({ status: result.status, directory }, null, 2) + "\n");
  closeSync(lock); unlinkSync(`${root}/live.lock`); console.log(JSON.stringify({ status: result.status, directory, error: result.error ?? null }));
}
