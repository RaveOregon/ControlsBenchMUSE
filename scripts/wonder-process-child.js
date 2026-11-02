// Isolated Wonder process child (controlsbench.wonder-process.v1), forked by
// src/live/wonder-process/channel.ts. It alone owns world time, the 10 Hz connector cadence,
// interventions, reasoning leases and the PLC write session. The host's campaign ledger stays in
// the parent; this process keeps no campaign ledger, only its own boundary journals.
//
// `load` (construction) is read-only: it hashes and imports the world and reports the bytes it
// loaded. `initialize` (after Start) takes runtime ownership first, then opens the connector.
// --offline accepts only an explicit test transport module; live uses the native M8 transport.
// Parent loss: freeze world time, drain bounded outstanding work, close the session. No reset,
// restart, retry or passthrough. Ownership is released only when nothing is left uncertain.
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LiveWorldCoordinator } from "../src/live/coordinator.ts";
import { M8OpcUaConnector } from "../src/live/m8-opcua.ts";
import { createM8NativeTransport } from "../src/live/m8-native-transport.ts";
import { withM8Observations } from "../src/live/m8-map.ts";
import { ProcessEngine, ProcessRefusal } from "../src/live/wonder-process/engine.ts";
import { WriteGate } from "../src/live/wonder-process/write-gate.ts";
import { ProcessOwnership } from "../src/live/wonder-process/ownership.ts";
import { WIRE } from "../src/live/wonder-process/protocol.ts";

const offline = process.argv.includes("--offline");
const nonce = randomBytes(8).toString("hex");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
let seq = 0, engine, world, loaded, gate, ownership, journalDir, closing, closeRequested = false;
let streamFault, swapped; // offline fixture only

const send = message => { try { if (process.connected) process.send(message); } catch { /* parent gone */ } };
const journal = (file, entry) => {
  if (!journalDir) return;
  try { appendFileSync(join(journalDir, file), JSON.stringify({ atIso: new Date().toISOString(), atMonotonicMs: performance.now(), ...entry }) + "\n"); } catch { /* journal is best effort */ }
};
function emit(record) {
  const message = { type: "stream", nonce, seq: ++seq, record };
  // The journal records what the child produced, independent of what the parent later ingests.
  journal("child-stream.jsonl", { seq: message.seq, record });
  deliver(message);
  return message.seq;
}
function deliver(message) {
  const fault = streamFault;
  if (fault && (!fault.kind || message.record.kind === fault.kind)) {
    streamFault = undefined;
    journal("child-lifecycle.jsonl", { kind: "fixture.stream_fault", mode: fault.mode, seq: message.seq, recordKind: message.record.kind });
    if (fault.mode === "drop") return;
    if (fault.mode === "swap") { swapped = message; return; }
    send(message);
    if (fault.mode === "duplicate") send(message);
    if (fault.mode === "conflict") send({ ...message, record: { ...message.record, conflicting: true } });
    return;
  }
  send(message);
  if (swapped) { const late = swapped; swapped = undefined; send(late); }
}

const hooks = {
  emit,
  onQuarantine: reason => gate?.refuse(reason),
  uncertainWrites: () => gate?.outstanding() ?? [],
  writesDrained: ms => gate ? gate.drained(ms) : Promise.resolve(true),
  abandon: async () => { await gate?.inner.close(); }
};
const need = () => { if (!engine) throw new ProcessRefusal("rejected", "Child session not initialized"); return engine; };

const ops = {
  async load(args) {
    if (loaded) throw new ProcessRefusal("rejected", "World already loaded");
    if (args.journalDir) { mkdirSync(args.journalDir, { recursive: true }); journalDir = args.journalDir; }
    const before = sha256(readFileSync(args.worldPath));
    const module = await import(`${pathToFileURL(args.worldPath).href}?wonder-process=${nonce}`);
    const worldSha256 = sha256(readFileSync(args.worldPath));
    if (worldSha256 !== before) throw new ProcessRefusal("rejected", "World bytes changed while loading; refuse an unidentified world");
    world = withM8Observations(module.default);
    loaded = { worldPath: args.worldPath, worldSha256, worldVersion: world.manifest.packageVersion,
      projectPath: args.projectPath, projectSha256: sha256(readFileSync(args.projectPath)),
      observedOutputIds: world.manifest.signals.filter(s => s.direction === "plc_to_world").map(s => s.id),
      controls: world.manifest.controls.map(c => c.id),
      worldToPlc: world.manifest.signals.filter(s => s.direction === "world_to_plc").map(s => ({ id: s.id, dataType: s.dataType })) };
    journal("child-lifecycle.jsonl", { kind: "loaded", offline, ...loaded });
    return loaded;
  },
  async initialize(args) {
    if (!loaded || engine) throw new ProcessRefusal("rejected", "Load the world once before initialize");
    ownership = new ProcessOwnership(args.ownershipPath);
    const lock = ownership.acquire({ campaignId: String(args.campaignId), childPid: process.pid, parentPid: process.ppid, nonce });
    journal("child-lifecycle.jsonl", { kind: "ownership.acquired", path: ownership.path, lock });
    const event = (kind, data) => journal("child-transport.jsonl", { kind, ...data });
    let inner;
    if (offline) {
      if (!args.transportModule) throw new ProcessRefusal("rejected", "Offline child requires an explicit fixture transport module");
      inner = (await import(pathToFileURL(args.transportModule).href)).createTransport(args.transportOptions ?? {}, { event });
    } else {
      if (!process.env.OPC_USER || !process.env.OPC_PASSWORD) throw new ProcessRefusal("rejected", "Live child needs OPC_USER/OPC_PASSWORD from the host environment");
      inner = createM8NativeTransport({ userName: process.env.OPC_USER, password: process.env.OPC_PASSWORD, event, ...(args.modulePath ? { modulePath: args.modulePath } : {}) });
      delete process.env.OPC_PASSWORD;
    }
    gate = new WriteGate(inner);
    gate.onSettledAfterRefusal = write => emit({ kind: "write", state: "settled_after_quarantine", ...write });
    const connector = new M8OpcUaConnector(gate, event, { requireStoppedBaseline: true });
    const coordinator = new LiveWorldCoordinator(world, connector, { seed: Number(args.seed), worldVersion: world.manifest.packageVersion });
    engine = new ProcessEngine(coordinator, hooks, { timing: args.timing, observedOutputIds: loaded.observedOutputIds, controller: connector });
    return engine.initialize();
  },
  start: args => need().start(args.automatic !== false),
  hold: args => need().hold(args.stopClock === true),
  tick: async () => { await need().tick(); return need().status(); },
  apply: args => need().apply(args),
  cancel: args => need().cancel(String(args.actionId)),
  controller: args => need().controllerAction(args),
  leaseBegin: args => need().leaseBegin(args),
  leaseFinish: args => need().leaseFinish(args),
  leaseInterrupt: args => need().leaseInterrupt(args),
  reset: () => need().reset(),
  exit: () => need().exit(),
  status: () => ({ ...(engine?.status() ?? {}), ownershipHeld: ownership?.held ?? false, uncertainWrites: gate?.outstanding() ?? [], lastSeq: seq }),
  close: args => { closeRequested = true; return shutdown(String(args.reason ?? "parent requested close")); },
  fixture(args) {
    if (!offline) throw new ProcessRefusal("rejected", "Fixture control exists only in an offline child");
    if (args.stream) { streamFault = { mode: args.stream, ...(args.kind ? { kind: args.kind } : {}) }; return { armed: streamFault }; }
    if (!gate?.inner.control) throw new ProcessRefusal("rejected", "Fixture transport has no control surface");
    return gate.inner.control(args.transport);
  }
};

function shutdown(reason) {
  closing ??= (async () => {
    let result = { drained: true, closed: true, uncertainWrites: [] };
    if (engine) result = await engine.close(reason);
    else if (gate) { try { await gate.inner.close(); } catch { /* never opened */ } }
    let released = "not_held";
    if (ownership?.held) {
      if (result.drained && !result.uncertainWrites.length) released = ownership.release();
      else { ownership.retain(); released = "retained_uncertain"; }
    }
    const summary = { reason, ...result, ownership: released, ownershipPath: ownership?.path ?? null, boundaryRevision: engine?.boundaryRevision ?? 0, lastSeq: seq };
    journal("child-lifecycle.jsonl", { kind: "closed", ...summary });
    return summary;
  })();
  return closing;
}

process.on("message", async message => {
  if (!message || typeof message !== "object") return;
  engine?.noteParent(message.knownCampaignRevision);
  if (message.type !== "request") return;
  const { id, op } = message;
  try {
    if (closing && op !== "status" && op !== "close") throw new ProcessRefusal("stale", "Child session is closing or closed");
    if (!Object.hasOwn(ops, op)) throw new ProcessRefusal("rejected", `Unknown op ${op}`);
    const value = await ops[op](message.args ?? {});
    send({ type: "reply", id, ok: true, value: value ?? {}, boundaryRevision: engine?.boundaryRevision ?? 0, throughSeq: seq });
  } catch (error) {
    send({ type: "reply", id, ok: false, outcome: error instanceof ProcessRefusal ? error.outcome : "inconclusive",
      message: String(error instanceof Error ? error.message : error).slice(0, 4000), boundaryRevision: engine?.boundaryRevision ?? 0, throughSeq: seq });
  }
});
process.on("disconnect", () => {
  if (!closeRequested) journal("child-lifecycle.jsonl", { kind: "parent.lost", lastSeq: seq, status: engine?.status() ?? null });
  engine?.parentLost();
  void shutdown(closeRequested ? "parent closed the session" : "parent lost").finally(() => process.exit(0));
});
send({ type: "ready", identity: { wire: WIRE, pid: process.pid, nonce, node: process.version, timeOriginEpochMs: performance.timeOrigin } });
