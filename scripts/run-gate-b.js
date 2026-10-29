import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateManifest, signalByRole } from "../src/proof/manifest.ts";
import { InstrumentedWorldContext } from "../src/proof/world-context.ts";

const latest = process.argv[2]
  ? { relativeDirectory: process.argv[2] }
  : JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8"));
const packageDirectory = resolve(latest.relativeDirectory);
const manifestFile = validateManifest(JSON.parse(await readFile(resolve(packageDirectory, "world.manifest.json"), "utf8")));
const resultPath = resolve(packageDirectory, "gate-b-result.json");
const checkpoints = [];
const startedAt = Date.now();
let harnessSequence = 0;

function status(message) {
  console.log(`[gate-b +${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${message}`);
}

async function checkpoint(id, exercise) {
  status(`${id} running`);
  const began = Date.now();
  try {
    const evidence = await exercise();
    checkpoints.push({ id, status: "pass", durationMs: Date.now() - began, evidence });
    status(`${id} passed`);
  } catch (error) {
    checkpoints.push({ id, status: "fail", durationMs: Date.now() - began, error: error instanceof Error ? error.stack : String(error) });
    status(`${id} failed: ${error instanceof Error ? error.message : error}`);
    throw error;
  }
}

async function createHarness(label) {
  const imported = await import(`${pathToFileURL(resolve(packageDirectory, "world.ts")).href}?gateB=${++harnessSequence}-${label}`);
  const world = imported.default || imported.world;
  assert(world, "world module export is missing");
  assert.deepEqual(validateManifest(world.manifest), manifestFile, "world export and external manifest drifted before Gate B");
  const seed = 20261029 + harnessSequence;
  const ctx = new InstrumentedWorldContext(manifestFile, { seed, worldVersion: manifestFile.packageVersion });
  let frameSequence = 0;
  await world.initialize(ctx, { seed, worldVersion: manifestFile.packageVersion });

  const signal = (role) => signalByRole(manifestFile, role);
  const input = (role) => ctx.plc.currentInputState()[signal(role).id];
  const send = async (roleValues) => {
    const values = Object.fromEntries(Object.entries(roleValues).map(([role, value]) => [signal(role).id, value]));
    const frame = { sequence: ++frameSequence, observedAtMs: ctx.time.nowMs, values };
    ctx.setPlcFrame(frame);
    await world.onPlcFrame(ctx, frame);
  };
  const control = async (id, payload, cause) => {
    assert(manifestFile.controls.some((entry) => entry.id === id), `Gate B requested undeclared control ${id}`);
    const command = { id, payload, cause };
    ctx.recordControl(command);
    await world.onControl(ctx, command);
  };
  const tick = async () => {
    const worldTick = ctx.advance(manifestFile.tickMs);
    for (const due of ctx.takeDueControls()) {
      ctx.recordControl(due);
      await world.onControl(ctx, due);
    }
    await world.tick(ctx, worldTick);
  };
  const ticks = async (count) => {
    for (let index = 0; index < count; index += 1) await tick();
  };
  const until = async (predicate, timeoutMs, message) => {
    const maxTicks = Math.ceil(timeoutMs / manifestFile.tickMs);
    for (let index = 0; index < maxTicks; index += 1) {
      if (predicate()) return index;
      await tick();
    }
    assert(predicate(), message);
    return maxTicks;
  };
  const evidence = () => ctx.events.filter((event) => event.lane === "evidence").map((event) => event.data.event);
  const exitFor = (itemId) => evidence().find((event) => event?.type === "carton.exited" && event?.data?.itemId === itemId);
  const runCartonToExit = async (itemId, requestedRoute) => {
    const exitRoles = ["sensor.exitA", "sensor.exitB", "sensor.runout"];
    const seen = Object.fromEntries(exitRoles.map((role) => [role, false]));
    await control("carton.introduce", { itemId, requestedRoute }, `Gate B introduces ${itemId}`);
    const maxTicks = Math.ceil(15000 / manifestFile.tickMs);
    for (let index = 0; index < maxTicks; index += 1) {
      for (const role of exitRoles) if (input(role) === true) seen[role] = true;
      const exited = exitFor(itemId);
      if (exited) return { exited, seen, elapsedMs: index * manifestFile.tickMs };
      await tick();
    }
    assert.fail(`${itemId} did not reach a terminal exit within 15 seconds`);
  };
  const carton = (itemId) => [...ctx.entityState.values()].find((entity) => entity.type === "carton" && entity.state.itemId === itemId);
  const dispose = () => world.dispose(ctx, `Gate B ${label} completed`);
  return { world, ctx, signal, input, send, control, tick, ticks, until, evidence, exitFor, runCartonToExit, carton, dispose };
}

async function prepareRunning(harness, divert1 = false, divert2 = false) {
  await harness.send({ "drive.runCommand": true, "divert1.extendCommand": divert1, "divert2.extendCommand": divert2 });
  await harness.until(() => harness.input("drive.runningFeedback") === true, 5000, "drive did not reach running feedback");
  if (divert1) await harness.until(() => harness.input("divert1.extendedFeedback") === true, 5000, "divert 1 did not reach extended feedback");
  if (divert2) await harness.until(() => harness.input("divert2.extendedFeedback") === true, 5000, "divert 2 did not reach extended feedback");
}

try {
  await checkpoint("CP-5", async () => {
    const routed = await createHarness("cp5-routed-a");
    await prepareRunning(routed, true, false);
    const routedResult = await routed.runCartonToExit("CP5-A", "A");
    assert.equal(routedResult.exited.data.actualExit, "A", "extended divert 1 did not physically route carton to A");
    assert.equal(routedResult.seen["sensor.exitA"], true, "exit A photoeye was never asserted");
    assert.equal(routedResult.seen["sensor.exitB"], false, "A carton incorrectly asserted exit B photoeye");
    assert.equal(routedResult.seen["sensor.runout"], false, "A carton incorrectly asserted runout photoeye");
    await routed.dispose();

    const missed = await createHarness("cp5-missed-a");
    await prepareRunning(missed, false, false);
    const missedResult = await missed.runCartonToExit("CP5-MISSED-A", "A");
    assert.equal(missedResult.exited.data.actualExit, "runout", "requested route A overrode actual home divert position");
    assert.equal(missedResult.seen["sensor.exitA"], false, "home divert 1 produced false A passage");
    assert.equal(missedResult.seen["sensor.runout"], true, "missed A carton never asserted runout photoeye");
    await missed.dispose();
    return {
      actualPositionRoute: routedResult.exited.data.actualExit,
      requestedRouteWithoutActuation: missedResult.exited.data.actualExit,
      routedElapsedMs: routedResult.elapsedMs,
      missedElapsedMs: missedResult.elapsedMs
    };
  });

  await checkpoint("CP-6", async () => {
    const routedB = await createHarness("cp6-routed-b");
    await prepareRunning(routedB, false, true);
    const bResult = await routedB.runCartonToExit("CP6-B", "B");
    assert.equal(bResult.exited.data.actualExit, "B", "extended divert 2 did not physically route carton to B");
    assert.equal(bResult.seen["sensor.exitA"], false, "B carton incorrectly asserted exit A photoeye");
    assert.equal(bResult.seen["sensor.exitB"], true, "exit B photoeye was never asserted");
    assert.equal(bResult.seen["sensor.runout"], false, "B carton incorrectly asserted runout photoeye");
    await routedB.dispose();

    const runout = await createHarness("cp6-runout");
    await prepareRunning(runout, false, false);
    const runoutResult = await runout.runCartonToExit("CP6-UNASSIGNED", null);
    assert.equal(runoutResult.exited.data.actualExit, "runout", "unassigned carton did not continue to runout");
    assert.equal(runoutResult.seen["sensor.exitA"], false, "unassigned carton incorrectly asserted exit A");
    assert.equal(runoutResult.seen["sensor.exitB"], false, "unassigned carton incorrectly asserted exit B");
    assert.equal(runoutResult.seen["sensor.runout"], true, "unassigned carton never asserted runout photoeye");
    await runout.dispose();
    return { routedB: bResult.exited.data.actualExit, unassigned: runoutResult.exited.data.actualExit };
  });

  await checkpoint("CP-7", async () => {
    const sensorFault = await createHarness("cp7-sensor");
    const entrySignalId = sensorFault.signal("sensor.entry").id;
    assert.equal(sensorFault.ctx.entityState.size, 0, "sensor fault harness unexpectedly contains a carton");
    await sensorFault.control("fault.setSensorStuck", { signalId: entrySignalId, active: true, value: true }, "Gate B stuck-high photoeye fault");
    assert.equal(sensorFault.input("sensor.entry"), true, "stuck-high fault did not override raw photoeye");
    assert.equal(sensorFault.ctx.entityState.size, 0, "stuck photoeye incorrectly created physical carton truth");
    await sensorFault.control("fault.clearAll", {}, "Gate B clears stuck photoeye fault");
    assert.equal(sensorFault.input("sensor.entry"), false, "clearing stuck photoeye did not restore physical raw value");
    await sensorFault.control("fault.setSensorBounce", { signalId: entrySignalId, durationMs: 240 }, "Gate B photoeye bounce fault");
    const bounceValues = new Set();
    for (let index = 0; index < Math.ceil(300 / manifestFile.tickMs); index += 1) {
      bounceValues.add(sensorFault.input("sensor.entry"));
      await sensorFault.tick();
    }
    assert(bounceValues.has(true) && bounceValues.has(false), "bounce fault did not produce both raw states");
    assert.equal(sensorFault.input("sensor.entry"), false, "photoeye did not return to physical value after bounce duration");
    await sensorFault.dispose();

    const driveFault = await createHarness("cp7-drive");
    await driveFault.control("fault.setDriveFeedbackFailure", { active: true }, "Gate B missing drive feedback fault");
    await driveFault.send({ "drive.runCommand": true });
    await driveFault.control("carton.introduce", { itemId: "CP7-DRIVE", requestedRoute: null }, "Gate B introduces carton under failed drive");
    const startPosition = Number(driveFault.carton("CP7-DRIVE")?.state.positionM);
    const startEncoder = Number(driveFault.input("motion.encoderCount"));
    await driveFault.ticks(Math.ceil(1000 / manifestFile.tickMs));
    assert.equal(driveFault.input("drive.runningFeedback"), false, "failed drive feedback unexpectedly asserted");
    assert.equal(Number(driveFault.input("motion.encoderCount")), startEncoder, "encoder advanced under missing-feedback drive inhibition");
    assert.equal(Number(driveFault.carton("CP7-DRIVE")?.state.positionM), startPosition, "carton moved under missing-feedback drive inhibition");
    await driveFault.control("fault.clearAll", {}, "Gate B clears drive feedback fault");
    await driveFault.until(() => driveFault.input("drive.runningFeedback") === true, 5000, "drive did not recover after fault cleanup");
    await driveFault.until(() => Number(driveFault.carton("CP7-DRIVE")?.state.positionM) > startPosition, 2000, "carton did not resume after drive fault cleanup");
    await driveFault.dispose();

    const divertFault = await createHarness("cp7-divert");
    await divertFault.control("fault.setDivertJam", { divert: 1, active: true }, "Gate B jams divert 1");
    await divertFault.send({ "divert1.extendCommand": true });
    await divertFault.ticks(Math.ceil(1000 / manifestFile.tickMs));
    assert.equal(divertFault.input("divert1.extendedFeedback"), false, "jammed divert incorrectly reached extended feedback");
    assert.equal(divertFault.input("divert1.homeFeedback"), true, "jammed home divert left home position");
    await divertFault.control("fault.clearAll", {}, "Gate B clears divert jam");
    await divertFault.until(() => divertFault.input("divert1.extendedFeedback") === true, 5000, "divert did not recover after jam cleanup");
    await divertFault.dispose();

    return {
      sensorStuckSeparatedFromPhysicalTruth: true,
      sensorBounceStates: [...bounceValues],
      driveFailureHeldEncoderAt: startEncoder,
      driveRecovered: true,
      divertJamHeldHome: true,
      divertRecovered: true
    };
  });

  await writeFile(resultPath, `${JSON.stringify({ status: "pass", packageDirectory: latest.relativeDirectory, durationMs: Date.now() - startedAt, checkpoints }, null, 2)}\n`);
  status(`Gate B passed; result written to ${resultPath}`);
} catch (error) {
  await writeFile(resultPath, `${JSON.stringify({ status: "fail", packageDirectory: latest.relativeDirectory, durationMs: Date.now() - startedAt, checkpoints }, null, 2)}\n`);
  process.exitCode = 1;
}
