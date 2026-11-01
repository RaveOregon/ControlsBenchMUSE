import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { readLedger, replay } from "../src/campaign/ledger.ts";
import { rawInputs, writeSignals } from "../src/live/m8-map.ts";
import { shaFile, frozenProjectHash, scenarios } from "../src/campaign/m10-rehearsal.ts";

export function auditM10(directory) {
  const result = JSON.parse(readFileSync(resolve(directory, "result.json"), "utf8"));
  const events = readLedger(resolve(directory, "campaign.jsonl")), state = replay(events);
  const trace = gunzipSync(readFileSync(resolve(directory, "transport.jsonl.gz"))).toString("utf8").trim().split("\n").map(JSON.parse);
  const checks = [];
  const check = (name, fn) => { fn(); checks.push({ name, passed: true }); };
  const outputs = events.filter(e => e.type === "plc.output"), commits = trace.filter(e => e.kind === "commit.acknowledged").map(e => e.receipt);
  check("frozen build, original world, evidence identities", () => {
    assert.equal(result.status, "pass"); assert.equal(result.projectSha256, frozenProjectHash);
    for (const [file, hash] of Object.entries(result.evidenceHashes)) assert.equal(shaFile(resolve(directory, file)), hash, file);
    assert.equal(state.provenance.worldModule, result.worldSha256); assert.equal(state.evidenceClass, "live_plc");
    assert.equal(result.modelCalls, 0); assert.equal(state.provenance.plcBuild.includes(frozenProjectHash), true);
  });
  check("six completed experiments with exact grounded findings", () => {
    assert.equal(state.status, "completed"); assert(state.report);
    assert.deepEqual(Object.keys(state.experiments), scenarios);
    assert(Object.values(state.experiments).every(e => e.status === "completed"));
    assert.deepEqual(Object.keys(state.findings), scenarios);
    assert(Object.values(state.actions).every(a => a.status === "applied"));
    assert(!events.some(e => e.type === "agent.request"));
  });
  check("all commits complete, matched, monotonic and cycle-correlated", () => {
    assert(commits.length > 100); const boot = commits[0].bootIdentity, epoch = commits[0].workstationEpoch;
    assert.equal(commits.length, outputs.length);
    commits.forEach((r, i) => {
      assert.equal(r.workstationEpoch, epoch); assert.equal(r.bootIdentity, boot);
      assert.equal(r.workstationSequence, String(i + 1)); assert.equal(r.appliedSequence, r.workstationSequence); assert.equal(r.appliedEpoch, epoch);
      assert.equal(r.plcCycle, r.outputCaptureCycle); assert.equal(r.connectorStale, false); assert.equal(r.simulationApplied, true);
      assert.deepEqual(Object.keys(r.image).sort(), [...rawInputs].sort());
      assert.deepEqual(r.values, outputs[i].data.values);
      const observation = trace.find(e => e.kind === "observation" && e.observation.plcCycle === r.plcCycle && e.observation.appliedEpoch === epoch && e.observation.appliedSequence === r.appliedSequence);
      assert(observation); assert.deepEqual(observation.activeImage, r.image);
    });
  });
  check("raw commit dispatch never exceeds 10 Hz", () => {
    const requested = trace.filter(e => e.kind === "commit.requested");
    requested.forEach((e, i) => { if (i) assert(e.sentAtMonotonicMs - requested[i - 1].sentAtMonotonicMs >= 100, "commit starts less than 100 ms apart"); });
  });
  check("connected world advances with bounded elapsed time", () => {
    const ticks = events.filter(e => e.type === "coordinator.event" && e.data.source.lane === "world" && e.data.source.data.action === "tick");
    assert(ticks.length > 100);
    for (const e of ticks) assert(e.data.source.data.tick.deltaMs > 0 && e.data.source.data.tick.deltaMs <= 300);
  });
  check("write allowlist, separate valid/sequence ordering and Good timestamped reads", () => {
    const allow = new Set(writeSignals.map(s => s.iecPath));
    for (const e of trace) {
      if (e.kind === "opc.write") for (const item of e.items) { assert(allow.has(item.path)); assert(item.status.startsWith("Good")); }
      if (e.kind === "opc.read") for (const sample of Object.values(e.samples)) assert(sample.status.startsWith("Good") && sample.sourceTimestamp && sample.serverTimestamp && sample.receivedAtIso);
    }
    for (const request of trace.filter(e => e.kind === "commit.requested")) {
      const start = trace.indexOf(request), end = trace.findIndex((e, i) => i > start && e.kind === "commit.acknowledged");
      const writes = trace.slice(start, end).filter(e => e.kind === "opc.write");
      assert.equal(writes.length, 5); assert(writes[0].items[0].path.endsWith("_Valid") && writes[0].items[0].value === false);
      assert.equal(writes[1].items.length, 22); assert(writes[2].items[0].value === true);
      assert.equal(writes[4].items.length, 1); assert.equal(writes[4].items[0].path, "GVL_BenchWrite.RequestedSequence");
    }
  });
  check("operator/WCS action IDs and PLC acknowledgements", () => {
    const commands = trace.filter(e => e.kind === "command.applied");
    assert.equal(commands.length, events.filter(e => e.type === "controller.action").length);
    for (const c of commands) {
      assert(events.some(e => e.type === "action.requested" && e.data.actionId === c.actionId));
      assert(events.some(e => e.type === "controller.action" && e.data.actionId === c.actionId));
      const v = c.observation.values;
      if (c.action === "offer") { assert.equal(v["controller.OfferAckSequence"], c.expected); assert.equal(v["controller.OfferAccepted"], true); }
      if (c.action === "start" || c.action === "stop" || c.action === "reset") assert.equal(v[`controller.${c.action[0].toUpperCase() + c.action.slice(1)}Ack`], c.expected);
    }
  });
  check("PLC completions A/B/unassigned/misroute and exactly-once counts", () => {
    const completed = outputs.filter((e, i) => i && e.data.values["controller.CompletionSequence"] !== outputs[i - 1].data.values["controller.CompletionSequence"]);
    assert.equal(completed.length, 6);
    assert.deepEqual(completed.map(e => [e.data.values["controller.CompletionItemId"], e.data.values["controller.CompletionExit"], e.data.values["controller.CompletionDisposition"]]), [[101,1,1],[102,2,1],[0,3,2],[103,3,3],[0,3,2],[201,0,4]]);
    for (const e of completed.slice(0,5)) {
      const source = events.find(s => s.id === e.data.sourceId), d = source.data.source.data;
      const exit = e.data.values["controller.CompletionExit"], beam = exit === 1 ? "PE_ExitA" : exit === 2 ? "PE_ExitB" : "PE_Runout";
      assert.equal(d.image[beam], true);
    }
    const first = outputs[0].data.values, last = outputs.at(-1).data.values;
    for (const [n, delta] of Object.entries({ CountExitA:1, CountExitB:1, CountRunout:3, CountMisroute:1, CountFaulted:1 })) assert.equal(last[`controller.${n}`] - first[`controller.${n}`], delta);
  });
  check("Stop physical coast, then stationary hold, without fabricated field changes", () => {
    const coast = events.find(e => e.type === "world.evidence" && e.data.source.type === "m10.coast-measurement").data.source.data;
    const command = events.find(e => e.id === coast.commandRef);
    assert.equal(command.data.observation.values.Motor_RunCmd, false);
    assert(coast.stoppedPosition > coast.positionAtCommand); assert(coast.stoppedEncoder > coast.encoderAtCommand);
    const afterStop = events.filter(e => e.sequence > command.sequence && e.type === "world.raw_image");
    assert(afterStop.some(e => e.data.image.Belt_SpeedActual > 0 && e.data.image.Encoder_Count > coast.encoderAtCommand));
    const stopped = outputs.find(e => e.sequence > command.sequence && e.data.values["controller.Mode"] === 0);
    const resume = events.find(e => e.sequence > command.sequence && e.type === "controller.action" && e.data.action === "start");
    assert(stopped && resume); const held = events.filter(e => e.type === "world.raw_image" && e.sequence > stopped.sequence && e.sequence < resume.sequence);
    const stoppedSource = events.find(e => e.id === stopped.data.sourceId).data.source;
    assert(resume.data.observation.observedAtMonotonicMs - stoppedSource.atMonotonicMs >= 500);
    assert(held.length >= 2); assert(held.every(e => e.data.image.Belt_SpeedActual === 0 && e.data.image.Encoder_Count === coast.stoppedEncoder));
  });
  check("failed-divert causal chain, faulted completion and final held simulation", () => {
    const faultTruth = events.find(e => e.type === "fault.truth"); assert.equal(faultTruth.data.truth.controlId, "fault.setDivertJam");
    const fault = outputs.find(e => e.data.values["controller.FaultCode"] === 23); assert(fault && fault.sequence > faultTruth.sequence);
    const beforeFault = outputs.filter(e => e.sequence > faultTruth.sequence && e.sequence < fault.sequence);
    assert(beforeFault.some(e => e.data.values.D1_ExtendCmd === true));
    for (const e of outputs) assert([0,23].includes(e.data.values["controller.FaultCode"]));
    assert.equal(result.finalObservation.values.Motor_RunCmd, false); assert.equal(result.finalObservation.simulationApplied, true);
    assert.equal(result.finalImage.Belt_SpeedActual, 0); assert.equal(result.finalObservation.values["controller.FaultCode"], 23);
  });
  const intervals = commits.slice(1).map((r, i) => r.sentAtMonotonicMs - commits[i].sentAtMonotonicMs).sort((a,b) => a-b);
  return { schemaVersion: 1, status: "pass", checks, checkCount: checks.length, commitCount: commits.length,
    measuredCommitIntervalMs: { min: intervals[0], p50: intervals[Math.floor(intervals.length/2)], p99: intervals[Math.floor(intervals.length*0.99)], max: intervals.at(-1) },
    claimBoundary: "Deterministic preserved-world/M9/M8 execution only; no paid Wonder, HMI or broader coverage claim." };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] ?? JSON.parse(readFileSync("artifacts/m10/latest.json", "utf8")).directory);
  try { const audit = auditM10(directory); writeFileSync(resolve(directory, "audit.json"), JSON.stringify(audit, null, 2) + "\n"); console.log(JSON.stringify(audit, null, 2)); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
