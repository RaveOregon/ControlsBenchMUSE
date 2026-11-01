// Simulation coordinator for H2, in its own process so HMI, portal and capture work in the parent
// can never starve the M8 heartbeat (H2 attempt 6 failed that way in a single process).
// Forked by scripts/run-hmi-h2-live.js; it alone writes the raw field-input image and WCS fields.
//
// IPC: parent → { id, op: "start" | "tool" | "cartons" | "expect-fault" | "stop", ... }
//      child  → { id, ok, value?, error? } replies, and { event: "failure" | "unexpected-fault", message } notices.
// --fake uses Lane A's deterministic FakeConnector (no PLC) to test this wiring offline.
import { appendFileSync, readFileSync } from "node:fs";
import { createM8NativeTransport } from "../src/live/m8-native-transport.ts";
import { M8OpcUaConnector } from "../src/live/m8-opcua.ts";
import { LiveWorldCoordinator } from "../src/live/coordinator.ts";
import { m8Map, withM8Observations } from "../src/live/m8-map.ts";
import { CampaignLedger } from "../src/campaign/ledger.ts";
import { CampaignRuntime } from "../src/campaign/runtime.ts";
import { CoordinatorCampaignDriver } from "../src/campaign/driver.ts";
import { m8ControllerActions, m8WorldBindings } from "../src/campaign/m8-bindings.ts";
import { preservedConveyorBindings } from "../src/campaign/conveyor-bindings.ts";
import { FakeConnector } from "../src/campaign/fake-connector.ts";
import { FakeProvider } from "../src/campaign/provider.ts";
import { shaFile } from "../src/campaign/m10-rehearsal.ts";

const fake = process.argv.includes("--fake");
const dir = process.env.H2_DIR;
if (!dir) throw new Error("H2_DIR required");
const trace = `${dir}/world-transport.jsonl`;
const event = (kind, data) => appendFileSync(trace, JSON.stringify({ kind, atIso: new Date().toISOString(), atMonotonicMs: performance.now(), ...data }) + "\n");
let runtime, connector, driver, coordinator, ledger, expectedFault = 0, notified = false;
const send = message => { try { process.send?.(message); } catch { /* parent gone */ } };

async function start() {
  const worldPath = new URL("../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts", import.meta.url);
  const world = fake ? (await import(worldPath.href)).default : withM8Observations((await import(worldPath.href)).default);
  if (fake) connector = new FakeConnector(() => ({ Motor_RunCmd: false, D1_ExtendCmd: false, D2_ExtendCmd: false, StackLight_Red: false, StackLight_Green: true }));
  else {
    if (!process.env.OPC_USER || !process.env.OPC_PASSWORD) throw new Error("Coordinator needs OPC_USER/OPC_PASSWORD from the H2 parent");
    const transport = createM8NativeTransport({ userName: process.env.OPC_USER, password: process.env.OPC_PASSWORD, event });
    delete process.env.OPC_PASSWORD;
    connector = new M8OpcUaConnector(transport, event, { requireStoppedBaseline: true });
  }
  ledger = new CampaignLedger(fake ? "hmi-h2-fake" : "hmi-h2-live", { file: `${dir}/campaign.jsonl` });
  coordinator = new LiveWorldCoordinator(world, connector, { seed: 20261101, worldVersion: world.manifest.packageVersion });
  driver = new CoordinatorCampaignDriver(coordinator, ledger, fake ? preservedConveyorBindings : m8WorldBindings, { operationTimeoutMs: 5000, initializeTimeoutMs: 60_000, elapsedStep: true, maximumStepMs: 300 });
  runtime = new CampaignRuntime({ ledger, driver, controller: fake ? undefined : m8ControllerActions(connector, ledger),
    provider: new FakeProvider(() => { throw new Error("H2 never requests a model decision"); }),
    provenance: { spec: shaFile("docs/conveyor-machine-spec.md"), ioMap: shaFile("codesys/demo/signal-map-v1.json"), plcBuild: fake ? "fake" : `8001/interface-1/sha256:${shaFile("codesys/conveyordemo.project")}`,
      worldModule: shaFile("artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts"), model: "none;H2 HMI operator verification", connector: `${connector.id}/${m8Map.mapVersion}` },
    evidenceClass: fake ? "fake_connector" : "live_plc", claimBoundary: "HMI operator verification: field inputs and WCS from this coordinator process; operator commands from the HMI.",
    spec: readFileSync("docs/conveyor-machine-spec.md", "utf8"), signals: world.manifest.signals, categories: ["functional", "runtime", "faults"] });
  driver.subscribe(() => {
    if (driver.failure && !notified) { notified = true; send({ event: "failure", message: String(driver.failure.message ?? driver.failure) }); }
    const fault = Number(coordinator.latestObservation?.values?.["controller.FaultCode"] ?? 0);
    if (fault && fault !== expectedFault && !notified) { notified = true; send({ event: "unexpected-fault", message: `Unexpected M8 fault ${fault}` }); void runtime.pause(`Unexpected M8 fault ${fault}`); }
  });
  await runtime.start();
  if (runtime.status !== "running") throw new Error(`World coordinator failed to start: ${runtime.status}`);
  await runtime.applyDecision({ summary: "HMI H2 verification: this coordinator supplies field inputs and WCS; the HMI is the operator",
    plan: { objective: "Verify the operator HMI against M8", experiments: [{ id: "hmi-h2", objective: "HMI operator verification", category: "runtime", requirements: [] }] }, calls: [] }, ledger.state.revision);
  return { status: runtime.status, pid: process.pid };
}

async function stop(reason) {
  if (runtime && !["stopped", "completed", "failed"].includes(runtime.status)) await runtime.stop(reason).catch(() => {});
  if (connector) { const c = connector; connector = undefined; await c.close().catch(() => {}); }
  ledger?.close();
  return { stopped: true };
}

const ops = {
  start,
  async tool({ name, args }) {
    if (driver?.failure) throw new Error(`Coordinator failed: ${driver.failure.message}`);
    const r = await runtime.executeTool({ id: `h2-${name}-${Date.now()}`, name, arguments: args });
    return { status: r.status, message: r.message, evidenceRefs: r.evidenceRefs };
  },
  async cartons() { return [...coordinator.context.entityState.values()].filter(e => e.type === "carton").length; },
  async "expect-fault"({ code }) { expectedFault = Number(code); return { expectedFault }; },
  async stop({ reason }) { return stop(reason ?? "H2 parent requested stop"); }
};

process.on("message", async message => {
  try { send({ id: message.id, ok: true, value: await ops[message.op](message) }); }
  catch (error) { send({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
});
// Parent gone: stop the world and close the session. No reset, restart or passthrough.
process.on("disconnect", async () => { await stop("H2 parent disconnected"); process.exit(0); });
send({ event: "ready", pid: process.pid });
