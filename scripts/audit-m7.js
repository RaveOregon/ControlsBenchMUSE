import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const resultPath = resolve(process.env.M7_OUTPUT || "artifacts/m7/m7-live-result.json");
const tracePath = resolve(process.env.M7_TRACE || "artifacts/m7/m7-live-trace.json");
const auditPath = resolve(process.env.M7_AUDIT || "artifacts/m7/m7-audit.json");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function contiguous(events, label) {
  events.forEach((event, index) => {
    assert.equal(event.sequence, index + 1, `${label} sequence gap at index ${index}`);
  });
}

const [resultBuffer, traceBuffer, projectBuffer, worldBuffer, codesysReadmeBuffer] = await Promise.all([
  readFile(resultPath),
  readFile(tracePath),
  readFile(resolve("codesys/gngnf.project")),
  readFile(resolve("artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts")),
  readFile(resolve("codesys/README.md"))
]);
const result = JSON.parse(resultBuffer.toString("utf8"));
const trace = JSON.parse(traceBuffer.toString("utf8"));
const checks = [];

function check(id, exercise) {
  try {
    const evidence = exercise();
    checks.push({ id, status: "pass", evidence });
  } catch (error) {
    checks.push({ id, status: "fail", error: error instanceof Error ? error.message : String(error) });
  }
}

check("result-verdict", () => {
  assert.equal(result.status, "pass");
  assert.equal(result.error, null);
  assert.equal(result.evidenceClass, "live_plc_closed_loop");
  return { durationMs: result.durationMs, completedAt: result.completedAt };
});

check("checkpoint-completeness", () => {
  assert.deepEqual(
    result.checkpoints.map((item) => [item.id, item.status]),
    [
      ["M7-0-initial-image", "pass"],
      ["M7-1-plc-start-and-acceleration", "pass"],
      ["M7-2-carton-photoeye-and-plc-stop", "pass"],
      ["M7-3-deceleration-and-stationary-hold", "pass"]
    ]
  );
  return { checkpoints: result.checkpoints.length };
});

check("artifact-identity", () => {
  const frozenM2Match = codesysReadmeBuffer.toString("utf8")
    .match(/Final M2 project:[^\n]*SHA-256 `([A-F0-9]{64})`/i);
  assert(frozenM2Match, "codesys/README.md does not declare the frozen M2 project hash");
  const frozenM2ProjectSha256 = frozenM2Match[1].toUpperCase();
  const currentProjectSha256 = sha256(projectBuffer);
  assert.equal(result.plcProjectSha256, frozenM2ProjectSha256);
  assert.equal(result.worldSha256, sha256(worldBuffer));
  assert.equal(trace.evidenceClass, "live_plc_closed_loop");
  assert.equal(trace.worldVersion, result.worldVersion);
  assert.equal(trace.connectorId, "codesys-opcua-m2");
  return {
    resultSha256: sha256(resultBuffer),
    traceSha256: sha256(traceBuffer),
    plcProjectSha256: result.plcProjectSha256,
    frozenM2ProjectSha256,
    currentProjectSha256,
    currentProjectDiffersAfterRun: currentProjectSha256 !== result.plcProjectSha256,
    currentProjectDifferenceDisposition: currentProjectSha256 === result.plcProjectSha256
      ? "current checkout still matches the live run"
      : "disclosed post-run working-tree change owned by the M3-M6 lane; live run matched the frozen M2 hash",
    worldSha256: result.worldSha256
  };
});

check("event-counts-and-ordering", () => {
  assert.equal(trace.coordinatorEvents.length, result.coordinatorEventCount);
  assert.equal(trace.worldEvents.length, result.worldEventCount);
  contiguous(trace.coordinatorEvents, "coordinator");
  contiguous(trace.worldEvents, "world");
  return {
    coordinatorEvents: trace.coordinatorEvents.length,
    worldEvents: trace.worldEvents.length
  };
});

const commits = trace.coordinatorEvents.filter((event) => event.lane === "connector");
check("commit-sequence", () => {
  assert.equal(commits.length, 88);
  commits.forEach((event, index) => {
    assert.equal(event.data.workstationSequence, String(index + 1));
  });
  assert.equal(result.finalOutputFrame.sequence, commits.length);
  return { first: commits[0].data.workstationSequence, last: commits.at(-1).data.workstationSequence };
});

check("epoch-and-boot-continuity", () => {
  const epochs = new Set(commits.map((event) => event.data.workstationEpoch));
  const boots = new Set(commits.map((event) => event.data.bootIdentity));
  assert.equal(epochs.size, 1);
  assert.equal(boots.size, 1);
  assert.notEqual([...boots][0], "0");
  return { epoch: [...epochs][0], bootIdentity: [...boots][0] };
});

check("plc-output-capture-correlation", () => {
  for (const event of commits) assert.equal(event.data.outputCaptureCycle, event.data.plcCycle);
  return { correlatedCommits: commits.length };
});

check("commit-latency", () => {
  const values = commits.map((event) => Number(event.data.latencyMs)).sort((a, b) => a - b);
  assert(values.every((value) => Number.isFinite(value) && value >= 0));
  return {
    minMs: values[0],
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: values.at(-1)
  };
});

check("plc-output-decision", () => {
  const firstMotorOn = commits.find((event) => event.data.outputs.Motor_RunCmd === true);
  assert(firstMotorOn, "no PLC motor-on observation");
  const laterMotorOff = commits.find((event) => Number(event.data.workstationSequence) > Number(firstMotorOn.data.workstationSequence)
    && event.data.outputs.Motor_RunCmd === false);
  assert(laterMotorOff, "no later PLC motor-off observation");
  return {
    motorOnSequence: firstMotorOn.data.workstationSequence,
    motorOffSequence: laterMotorOff.data.workstationSequence
  };
});

check("photoeye-causality", () => {
  const entryEffects = trace.worldEvents.filter((event) => event.lane === "raw_input" && event.data.signalId === "PE_Entry");
  assert.deepEqual(entryEffects.map((event) => event.data.value), [false, true, false]);
  assert.match(entryEffects[1].data.cause, /injected stuck fault/);
  assert.match(entryEffects[2].data.cause, /no carton geometrically blocks/);
  const controls = trace.worldEvents.filter((event) => event.lane === "control").map((event) => event.data.control);
  assert(controls.some((control) => control.id === "carton.introduce" && control.payload.itemId === "M7-CARTON-1"));
  assert(controls.some((control) => control.id === "fault.setSensorStuck" && control.payload.active === false));
  return { effects: entryEffects.map((event) => ({ sequence: event.sequence, atMs: event.atMs, value: event.data.value, cause: event.data.cause })) };
});

check("physical-acceleration-and-encoder", () => {
  const evidence = result.checkpoints.find((item) => item.id === "M7-1-plc-start-and-acceleration").evidence;
  assert.equal(evidence.speedMps, 0.5);
  assert(evidence.encoderCount > 0);
  const encoders = commits.map((event) => Number(event.data.image.Encoder_Count));
  encoders.forEach((value, index) => {
    if (index > 0) assert(value >= encoders[index - 1], `encoder regressed at commit ${index + 1}`);
  });
  return { speedMps: evidence.speedMps, firstMotionEncoder: evidence.encoderCount, finalEncoder: encoders.at(-1) };
});

check("deceleration-coast-and-hold", () => {
  const evidence = result.checkpoints.find((item) => item.id === "M7-3-deceleration-and-stationary-hold").evidence;
  assert(evidence.speedAtStopCommand > 0);
  assert(evidence.coastDistanceM > 0);
  assert(evidence.stoppedEncoder > evidence.encoderAtStopCommand);
  assert(evidence.holdDurationMs >= 500);
  assert.equal(result.finalInputImage.Belt_SpeedActual, 0);
  assert.equal(result.finalInputImage.Drive_RunningFB, false);
  assert.equal(result.finalSnapshot.state.cartons[0].velocityMps, 0);
  return {
    speedAtStopCommand: evidence.speedAtStopCommand,
    coastDistanceM: evidence.coastDistanceM,
    encoderCoastCounts: evidence.stoppedEncoder - evidence.encoderAtStopCommand,
    holdDurationMs: evidence.holdDurationMs
  };
});

const failures = checks.filter((item) => item.status === "fail");
const audit = {
  schemaVersion: 1,
  auditedAt: new Date().toISOString(),
  status: failures.length === 0 ? "pass" : "fail",
  evidenceClass: "deterministic_live_trace_audit",
  checks,
  failureCount: failures.length
};
await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
if (failures.length) {
  process.stderr.write(`${JSON.stringify(audit, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
}
