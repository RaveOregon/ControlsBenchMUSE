import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { validateManifest, signalByRole } from "../src/proof/manifest.ts";
import { InstrumentedWorldContext } from "../src/proof/world-context.ts";

const root = resolve(".");
const requestedDirectory = process.argv[2];
const latest = requestedDirectory
  ? { relativeDirectory: requestedDirectory }
  : JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8"));
const packageDirectory = resolve(latest.relativeDirectory);
const resultPath = resolve(packageDirectory, "gate-a-result.json");
const checkpoints = [];
const startedAt = Date.now();

function status(message) {
  console.log(`[gate-a +${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${message}`);
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

let world;
let ctx;
try {
  await checkpoint("CP-0", async () => {
    const compiler = resolve("node_modules/typescript/bin/tsc");
    execFileSync(process.execPath, [compiler, "-p", resolve(packageDirectory, "tsconfig.json")], { cwd: root, stdio: "pipe" });
    execFileSync(process.execPath, ["--test", resolve(packageDirectory, "world.test.ts")], { cwd: root, stdio: "pipe" });

    const source = await readFile(resolve(packageDirectory, "world.ts"), "utf8");
    const forbidden = [
      [/from\s+["']node:fs/, "filesystem access"],
      [/\bfetch\s*\(/, "network access"],
      [/\bprocess\s*\./, "process access"],
      [/\beval\s*\(/, "eval"],
      [/new\s+Function\s*\(/, "Function constructor"],
      [/import\s*\(/, "dynamic import"]
    ];
    for (const [pattern, label] of forbidden) assert.doesNotMatch(source, pattern, `generated world uses forbidden ${label}`);

    const manifestFile = validateManifest(JSON.parse(await readFile(resolve(packageDirectory, "world.manifest.json"), "utf8")));
    const imported = await import(`${pathToFileURL(resolve(packageDirectory, "world.ts")).href}?proof=${Date.now()}`);
    world = imported.default || imported.world;
    assert(world, "world.ts must export a default or named world module");
    assert.deepEqual(validateManifest(world.manifest), manifestFile, "exported manifest differs from world.manifest.json");
    return { compiler: "strict TypeScript pass", generatedTests: "pass", signals: manifestFile.signals.length, controls: manifestFile.controls.length };
  });

  const manifest = validateManifest(world.manifest);
  ctx = new InstrumentedWorldContext(manifest, { seed: 20261029, worldVersion: manifest.packageVersion });
  let frameSequence = 0;
  const sendFrame = async (values) => {
    const frame = { sequence: ++frameSequence, observedAtMs: ctx.time.nowMs, values };
    ctx.setPlcFrame(frame);
    await world.onPlcFrame(ctx, frame);
  };
  const control = async (id, payload, cause) => {
    const command = { id, payload, cause };
    ctx.recordControl(command);
    await world.onControl(ctx, command);
  };
  const ticks = async (count) => {
    for (let index = 0; index < count; index += 1) {
      const tick = ctx.advance(manifest.tickMs);
      for (const due of ctx.takeDueControls()) {
        ctx.recordControl(due);
        await world.onControl(ctx, due);
      }
      await world.tick(ctx, tick);
    }
  };
  const tickUntil = async (predicate, maxTicks, message) => {
    for (let index = 0; index < maxTicks; index += 1) {
      if (predicate()) return index;
      await ticks(1);
    }
    assert(predicate(), message);
    return maxTicks;
  };

  await checkpoint("CP-1", async () => {
    for (const signal of manifest.signals.filter((entry) => entry.direction === "world_to_plc")) {
      const value = ctx.plc.currentInputState()[signal.id];
      assert(value === false || value === 0 || value === "", `${signal.id} was not zero before initialization`);
    }
    await world.initialize(ctx, { seed: 20261029, worldVersion: manifest.packageVersion });
    assert(ctx.activities.length > 0, "initialize produced no activity status");
    assert(ctx.events.some((event) => event.lane === "evidence"), "initialize produced no evidence");
    const snapshot = await world.snapshot(ctx);
    assert.equal(snapshot.stateSchemaVersion, manifest.stateSchemaVersion);
    assert(snapshot.state !== undefined, "snapshot omitted state");
    return { activities: ctx.activities.length, events: ctx.events.length, snapshotSchema: snapshot.stateSchemaVersion };
  });

  const runCommand = signalByRole(manifest, "drive.runCommand");
  const runningFeedback = signalByRole(manifest, "drive.runningFeedback");
  const encoder = signalByRole(manifest, "motion.encoderCount");
  const entrySensor = signalByRole(manifest, "sensor.entry");
  assert.equal(runCommand.direction, "plc_to_world");
  for (const signal of [runningFeedback, encoder, entrySensor]) assert.equal(signal.direction, "world_to_plc");

  await checkpoint("CP-2", async () => {
    await sendFrame({ [runCommand.id]: false });
    await ticks(Math.ceil(500 / manifest.tickMs));
    assert.equal(ctx.plc.currentInputState()[runningFeedback.id], false, "drive ran without command");
    await sendFrame({ [runCommand.id]: true });
    const startTicks = await tickUntil(
      () => ctx.plc.currentInputState()[runningFeedback.id] === true,
      Math.ceil(5000 / manifest.tickMs),
      "drive feedback never became true"
    );
    await sendFrame({ [runCommand.id]: false });
    const stopTicks = await tickUntil(
      () => ctx.plc.currentInputState()[runningFeedback.id] === false,
      Math.ceil(5000 / manifest.tickMs),
      "drive feedback never became false"
    );
    return { startDelayMs: startTicks * manifest.tickMs, stopDelayMs: stopTicks * manifest.tickMs };
  });

  await checkpoint("CP-3", async () => {
    const stoppedCount = Number(ctx.plc.currentInputState()[encoder.id]);
    await ticks(Math.ceil(500 / manifest.tickMs));
    assert.equal(Number(ctx.plc.currentInputState()[encoder.id]), stoppedCount, "encoder advanced while stopped");
    await sendFrame({ [runCommand.id]: true });
    await tickUntil(() => ctx.plc.currentInputState()[runningFeedback.id] === true, Math.ceil(5000 / manifest.tickMs), "drive did not restart");
    const before = Number(ctx.plc.currentInputState()[encoder.id]);
    await ticks(Math.ceil(1000 / manifest.tickMs));
    const after = Number(ctx.plc.currentInputState()[encoder.id]);
    assert(after > before, `encoder did not advance with physical motion (${before} -> ${after})`);
    return { before, after, delta: after - before };
  });

  await checkpoint("CP-4", async () => {
    const gateCarton = () => [...ctx.entityState.values()].find((entity) => entity.type === "carton" && entity.state.itemId === "gate-a-carton");
    await control("carton.introduce", { itemId: "gate-a-carton", requestedRoute: null }, "Gate A geometry exercise");
    await tickUntil(
      () => Boolean(gateCarton()) && ctx.plc.currentInputState()[entrySensor.id] === true,
      Math.ceil(5000 / manifest.tickMs),
      "introduced carton never published at the entry sensor"
    );
    const first = gateCarton();
    assert(first && typeof first.state.positionM === "number", "carton entity omitted numeric positionM");
    const firstPosition = first.state.positionM;
    await ticks(Math.ceil(300 / manifest.tickMs));
    const moved = gateCarton();
    assert(moved && Number(moved.state.positionM) > Number(firstPosition), "carton position did not evolve while drive ran");

    await sendFrame({ [runCommand.id]: false });
    const coastStartPosition = Number(gateCarton()?.state.positionM);
    const coastTicks = await tickUntil(
      () => ctx.plc.currentInputState()[runningFeedback.id] === false && Number(gateCarton()?.state.velocityMps) === 0,
      Math.ceil(5000 / manifest.tickMs),
      "drive and carton motion did not settle after stop command"
    );
    const stopped = gateCarton();
    assert(stopped, "carton disappeared before stop check");
    const stoppedPosition = Number(stopped.state.positionM);
    const stoppedSensor = ctx.plc.currentInputState()[entrySensor.id];
    await ticks(Math.ceil(500 / manifest.tickMs));
    const held = gateCarton();
    assert(held, "carton disappeared while drive was stopped");
    assert.equal(Number(held.state.positionM), stoppedPosition, "carton moved while drive was stopped");
    assert.equal(ctx.plc.currentInputState()[entrySensor.id], stoppedSensor, "entry sensor changed while stopped carton position was preserved");
    assert.equal(Number(held.state.velocityMps), 0, "carton velocity was not zero while stopped");
    return {
      firstPosition,
      movedPosition: moved.state.positionM,
      coastDistanceM: stoppedPosition - coastStartPosition,
      settleTimeMs: coastTicks * manifest.tickMs,
      stoppedPosition,
      entrySensorHeld: stoppedSensor
    };
  });

  await world.dispose(ctx, "Gate A completed");
  await writeFile(resultPath, `${JSON.stringify({ status: "pass", packageDirectory: latest.relativeDirectory, durationMs: Date.now() - startedAt, checkpoints, eventCount: ctx.events.length }, null, 2)}\n`);
  status(`Gate A passed; result written to ${resultPath}`);
} catch (error) {
  await writeFile(resultPath, `${JSON.stringify({ status: "fail", packageDirectory: latest.relativeDirectory, durationMs: Date.now() - startedAt, checkpoints }, null, 2)}\n`);
  process.exitCode = 1;
}
