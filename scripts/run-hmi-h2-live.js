// H2 live verification of the CV-1 operator HMI against M8 build 8001.
//
//   powershell -File scripts/run-hmi-h2-live.ps1 [-Headed]      (masked PLC credential prompt)
//
// Roles stay separate and attributable:
//   - Simulation coordinator (field inputs): Lane A's M8 connector + preserved Muse world 0.5.0 on its own
//     OPC UA session, driven at the declared 10 Hz ceiling. Only it writes the raw input image.
//   - WCS peer: the coordinator's assign_route / acknowledge_completion tools.
//   - Operator: the HMI service on a second OPC UA session. Every operator command here is a real
//     trusted click on the HMI page in the portal's controlled browser session (Lane B HMI hub).
// The run stops on the first unexplained result. It never resets an unexplained state.
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createM8NativeTransport } from "../src/live/m8-native-transport.ts";
import { M8OpcUaConnector } from "../src/live/m8-opcua.ts";
import { LiveWorldCoordinator } from "../src/live/coordinator.ts";
import { m8Map, withM8Observations } from "../src/live/m8-map.ts";
import { CampaignLedger } from "../src/campaign/ledger.ts";
import { CampaignRuntime } from "../src/campaign/runtime.ts";
import { CoordinatorCampaignDriver } from "../src/campaign/driver.ts";
import { m8ControllerActions, m8WorldBindings } from "../src/campaign/m8-bindings.ts";
import { FakeProvider } from "../src/campaign/provider.ts";
import { shaFile, frozenProjectHash } from "../src/campaign/m10-rehearsal.ts";
import { HmiService, defaultOwnershipRoots } from "../src/hmi/service.ts";
import { createHmiServer, listen } from "../src/hmi/http.ts";
import { PortalSessionBridge } from "../src/hmi/portal-bridge.ts";
import { CampaignHost } from "../src/host/campaign-host.ts";
import { fixtureCampaignFactory } from "../src/host/campaign-factory.ts";
import { CdpWebVisuSource } from "../src/host/cdp-webvisu.ts";
import { HmiHub } from "../src/host/hmi.ts";
import { createPortalServer, listen as listenPortal } from "../src/host/http.ts";

const { values: args } = parseArgs({ options: { headed: { type: "boolean", default: false }, "hmi-port": { type: "string", default: "5181" }, "portal-port": { type: "string", default: "5189" } } });
if (!process.env.OPC_USER || !process.env.OPC_PASSWORD) throw new Error("Run scripts/run-hmi-h2-live.ps1 for a masked PLC credential prompt");
const userName = process.env.OPC_USER, secret = process.env.OPC_PASSWORD;
delete process.env.OPC_PASSWORD;

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = `artifacts/hmi/h2/${stamp}`;
mkdirSync(dir, { recursive: true });
const roots = defaultOwnershipRoots();
const mainRoot = roots.at(-1);
const result = { schemaVersion: 1, status: "failed", directory: dir, startedAtIso: new Date().toISOString(), modelCalls: 0, steps: [],
  projectSha256: shaFile("codesys/conveyordemo.project"), mapSha256: shaFile("codesys/demo/signal-map-v1.json"),
  worldSha256: shaFile("artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts"),
  roles: { fieldInputs: "simulation coordinator (Lane A M8OpcUaConnector + preserved world)", wcs: "coordinator WCS tools", operator: "HMI service via portal controlled-browser clicks" } };
const log = (m) => console.log(`[H2 ${new Date().toISOString().slice(11, 23)}] ${m}`);

// Exclusive runtime claim honoured by Lane A's runner (it opens the same lock with "wx").
const lockPath = join(mainRoot, "artifacts/m10/live.lock");
for (const rel of ["artifacts/m10/operator-status.json", "codesys/demo/operator-status.json"]) {
  const f = join(mainRoot, rel);
  if (existsSync(f) && JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")).active) throw new Error(`${f} reports an active runtime owner; coordinate before H2`);
}
mkdirSync(join(mainRoot, "artifacts/m10"), { recursive: true });
const lock = openSync(lockPath, "wx");
writeFileSync(lockPath, JSON.stringify({ owner: "hmi-h2-live", pid: process.pid, directory: resolve(dir), startedAtIso: result.startedAtIso, hmiCommandsPermitted: true }) + "\n");

const worldTrace = `${dir}/world-transport.jsonl`;
const worldEvent = (kind, data) => appendFileSync(worldTrace, JSON.stringify({ kind, atIso: new Date().toISOString(), atMonotonicMs: performance.now(), ...data }) + "\n");
// Proxy for the HMI's own session only: lets the run interrupt HMI reads to verify disconnect handling. PLC unaffected.
const hmiLinkControl = { failReads: false };
const hmiTransportFactory = event => {
  const inner = createM8NativeTransport({ userName, password: secret, event });
  return { open: () => inner.open(), close: () => inner.close(), write: items => inner.write(items),
    read: paths => hmiLinkControl.failReads ? Promise.reject(new Error("H2 simulated HMI-session read interruption (transport proxy; PLC unaffected)")) : inner.read(paths) };
};

let service, hmiServer, host, portal, runtime, connector, ledger, driver, unsubscribe;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hmiValue = path => { const s = service.link.latest?.values[path]; return s?.good ? s.value : undefined; };
async function until(predicate, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(`Deadline: ${label}`); if (driver?.failure) throw driver.failure; await sleep(50); }
}
async function click(targetId, step) {
  const r = await (await fetch(`${service.url}api/agent-actions/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetId, requester: `h2:${step}` }) })).json();
  if (r.error) throw new Error(`Agent action ${targetId}: ${r.error}`);
  return r;
}
function record(step, data) {
  const entry = { step, atIso: new Date().toISOString(), ...data };
  result.steps.push(entry);
  service.journal.append("h2.step", entry);
  log(`${step}: ${data.summary ?? ""}`);
}
const plcState = () => Object.fromEntries(["GVL_DemoRead.Status.Mode", "GVL_DemoRead.Status.ModeText", "GVL_DemoRead.Status.FaultCode", "GVL_DemoRead.Status.FaultText", "GVL_DemoRead.Status.Motor_RunCmd",
  "GVL_BenchRead.Active_Drive_RunningFB", "GVL_DemoWrite.AutoRequest", "GVL_BenchRead.ConnectorStale", "GVL_BenchRead.SimApplied", "GVL_BenchRead.Active_Encoder_Count", "GVL_DemoRead.Status.ItemActive",
  "GVL_DemoRead.Status.CompletionPending", "GVL_BenchRead.PlcBootIdentity"].map(p => [p.split(".").at(-1), hmiValue(p)]));
const expectOutcome = (r, outcome, label) => { if (r.command?.outcome !== outcome) throw new Error(`${label}: expected ${outcome}, got ${r.command?.outcome ?? r.action?.status}: ${r.command?.detail ?? r.action?.detail}`); };
async function tool(name, args) {
  const r = await runtime.executeTool({ id: `h2-${name}-${Date.now()}`, name, arguments: args });
  if (r.status !== "applied") throw new Error(`${name} ${r.status}: ${r.message}`);
  return r;
}

try {
  if (result.projectSha256 !== frozenProjectHash) throw new Error("M8 project differs from the frozen accepted build");
  // ---- HMI observes first (read-only until the baseline is explained) ----
  service = new HmiService({ source: { kind: "live_plc", endpoint: m8Map.endpoint, userConfigured: true, transportFactory: hmiTransportFactory },
    artifactRoot: `${dir}/hmi`, pollIntervalMs: 250, sharedPollIntervalMs: 500, commandPolicy: "enabled", ownershipRoots: roots });
  let bridge;
  const hub = new HmiHub({ captureIntervalMs: 1000, artifactDir: `${dir}/portal-hmi`, onChange: (view, change) => bridge?.onHubChange(view, change) });
  bridge = new PortalSessionBridge(service, hub);
  hmiServer = createHmiServer(service, { extraPost: { "/api/agent-actions/execute": body => bridge.executeAgentAction(body) } });
  service.url = await listen(hmiServer, Number(args["hmi-port"]));
  await service.start();
  log(`HMI ${service.url} observing ${m8Map.endpoint}`);
  await until(() => service.link.fresh, "HMI first good PLC read", 30_000);
  const baseline = plcState();
  record("baseline", { summary: `Mode ${baseline.ModeText}, fault ${baseline.FaultCode}, item ${baseline.ItemActive}, completion pending ${baseline.CompletionPending}, sim ${baseline.SimApplied}, boot ${baseline.PlcBootIdentity}`,
    plc: baseline, alarms: service.state().alarms.active });
  if (hmiValue("GVL_DemoRead.BuildId") !== 8001 || hmiValue("GVL_DemoRead.InterfaceVersion") !== 1) throw new Error("Controller is not M8 build 8001/interface 1");
  if (baseline.Mode !== 0 || baseline.FaultCode !== 0 || baseline.ItemActive !== false || baseline.CompletionPending !== false)
    throw new Error("Baseline is not a clean stopped state. Not recovering an unexplained state; inspect and decide explicitly.");

  // ---- Portal session (Lane B host) ----
  host = new CampaignHost({ factory: fixtureCampaignFactory(), artifactDir: `${dir}/portal-host`, hmi: hub,
    hmiSourceFactory: url => bridge.attachSource(new CdpWebVisuSource(url, { headless: !args.headed, width: 1280, height: 800 })) });
  portal = createPortalServer({ host, staticDir: existsSync("ui/dist") ? resolve("ui/dist") : undefined });
  const { url: portalUrl } = await listenPortal(portal, Number(args["portal-port"]), "127.0.0.1");
  host.submit({ contractVersion: 1, requestId: `h2-hmi-${Date.now()}`, type: "configure_hmi", payload: { url: `${service.url}?capture=portal` } });
  await until(() => hub.observing && !!bridge.portalClient() && !!service.targets(bridge.portalClient())?.targets.length, "portal HMI session observing", 30_000);
  record("portal-session", { summary: `Portal ${portalUrl} observing HMI session ${hub.view.sessionId} (${hub.view.browser})`, hmiSession: hub.view, portalUrl, client: bridge.portalClient() });

  // ---- Simulation coordinator (Lane A connector + preserved world) ----
  const worldPath = new URL("../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts", import.meta.url);
  const world = withM8Observations((await import(worldPath.href)).default);
  connector = new M8OpcUaConnector(createM8NativeTransport({ userName, password: secret, event: worldEvent }), worldEvent, { requireStoppedBaseline: true });
  ledger = new CampaignLedger("hmi-h2-live", { file: `${dir}/campaign.jsonl` });
  const coordinator = new LiveWorldCoordinator(world, connector, { seed: 20261101, worldVersion: world.manifest.packageVersion });
  driver = new CoordinatorCampaignDriver(coordinator, ledger, m8WorldBindings, { operationTimeoutMs: 5000, initializeTimeoutMs: 60_000, elapsedStep: true, maximumStepMs: 300 });
  runtime = new CampaignRuntime({ ledger, driver, controller: m8ControllerActions(connector, ledger),
    provider: new FakeProvider(() => { throw new Error("H2 never requests a model decision"); }),
    provenance: { spec: shaFile("docs/conveyor-machine-spec.md"), ioMap: result.mapSha256, plcBuild: `8001/interface-1/sha256:${result.projectSha256}`, worldModule: result.worldSha256,
      model: "none;H2 HMI operator verification", connector: `${connector.id}/${m8Map.mapVersion}` },
    evidenceClass: "live_plc", claimBoundary: "HMI operator verification: Start/Stop/Reset/Auto, fault presentation, alarm transitions and disconnect handling against M8 build 8001 with the preserved world as field-input coordinator.",
    spec: readFileSync("docs/conveyor-machine-spec.md", "utf8"), signals: world.manifest.signals, categories: ["functional", "runtime", "faults"] });
  let expectedFault = 0;
  unsubscribe = driver.subscribe(() => {
    const fault = Number(coordinator.latestObservation?.values?.["controller.FaultCode"] ?? 0);
    if (fault && fault !== expectedFault && !result.unexpectedFault) { result.unexpectedFault = fault; void runtime.pause(`Unexpected M8 fault ${fault}`); }
  });
  await runtime.start();
  if (runtime.status !== "running") throw new Error("World coordinator failed to start");
  await runtime.applyDecision({ summary: "HMI H2 verification: the coordinator supplies field inputs and WCS; the HMI is the operator", plan: { objective: "Verify the operator HMI against M8", experiments: [{ id: "hmi-h2", objective: "HMI operator verification", category: "runtime", requirements: [] }] }, calls: [] }, ledger.state.revision);
  await until(() => hmiValue("GVL_BenchRead.SimApplied") === true && hmiValue("GVL_BenchRead.ConnectorStale") === false && hmiValue("GVL_BenchRead.Active_D1_HomeFB") === true, "HMI sees applied simulation image", 10_000);
  record("coordinator", { summary: "Simulation applied; world at rest with divert home limits and destinations ready", plc: plcState() });
  const guard = () => { if (result.unexpectedFault) throw new Error(`Unexpected M8 fault ${result.unexpectedFault}`); };

  // ---- Auto / Start / Stop ----
  let r = await click("cmd.auto.on", "auto-on"); expectOutcome(r, "applied", "Auto on");
  record("auto-on", { summary: r.command.detail, agent: r.action, command: r.command });
  r = await click("cmd.start", "start"); expectOutcome(r, "applied", "Start");
  await until(() => hmiValue("GVL_DemoRead.Status.Mode") === 1 && hmiValue("GVL_DemoRead.Status.Motor_RunCmd") === true && hmiValue("GVL_BenchRead.Active_Drive_RunningFB") === true, "Auto with motor command and running feedback", 5000);
  guard();
  const enc0 = Number(hmiValue("GVL_BenchRead.Active_Encoder_Count"));
  await sleep(1500);
  record("start", { summary: `${r.command.detail} Running: encoder ${enc0} → ${hmiValue("GVL_BenchRead.Active_Encoder_Count")}`, agent: r.action, command: r.command, plc: plcState() });
  r = await click("cmd.stop", "stop"); expectOutcome(r, "applied", "Stop");
  const encStop = Number(hmiValue("GVL_BenchRead.Active_Encoder_Count"));
  await until(() => hmiValue("GVL_DemoRead.Status.Mode") === 0 && hmiValue("GVL_BenchRead.Active_Drive_RunningFB") === false, "Stopped after coast", 8000);
  await sleep(800);
  record("stop", { summary: `${r.command.detail} Coast: encoder ${encStop} → ${hmiValue("GVL_BenchRead.Active_Encoder_Count")}; Mode Stopped`, agent: r.action, command: r.command, plc: plcState() });

  // ---- Auto withdrawal stops a running conveyor ----
  r = await click("cmd.start", "start-2"); expectOutcome(r, "applied", "Start 2");
  await until(() => hmiValue("GVL_BenchRead.Active_Drive_RunningFB") === true, "running again", 5000);
  record("start-2", { summary: r.command.detail, agent: r.action, command: r.command });
  r = await click("cmd.auto.off", "auto-off"); expectOutcome(r, "applied", "Auto off");
  await until(() => hmiValue("GVL_DemoRead.Status.Mode") === 0 && hmiValue("GVL_BenchRead.Active_Drive_RunningFB") === false, "Auto withdrawal reaches Stopped", 8000);
  record("auto-off", { summary: `${r.command.detail} Mode → Stopped`, agent: r.action, command: r.command, plc: plcState() });
  r = await click("cmd.start", "start-refused-by-plc"); expectOutcome(r, "rejected", "Start with Auto off");
  record("start-rejected", { summary: r.command.detail, agent: r.action, command: r.command, unmet: r.command.preconditions?.filter(p => p.met === false) });

  // ---- Fault presentation, Reset rejection and acceptance, alarm transitions ----
  expectedFault = 10;
  await tool("inject_fault", { controlId: "fault.setOverload", parameters: { active: true } });
  await until(() => hmiValue("GVL_DemoRead.Status.FaultCode") === 10 && service.alarms.active().some(a => a.code === 10), "PLC fault 10 observed by HMI", 5000);
  const raised = service.alarms.active().find(a => a.code === 10);
  await sleep(1200);
  const faultFrame = await hub.captureNow();
  record("fault-raised", { summary: `PLC fault 10 '${raised.plcText}' raised; basis ${raised.firstObservedBasis}`, alarm: raised, frame: faultFrame.reference, plc: plcState() });
  r = await click("cmd.reset", "reset-while-overloaded"); expectOutcome(r, "rejected", "Reset while overloaded");
  record("reset-rejected", { summary: r.command.detail, agent: r.action, command: r.command, unmet: r.command.preconditions?.filter(p => p.met === false) });
  await tool("clear_fault", { controlId: "fault.setOverload", parameters: { active: false } });
  await until(() => hmiValue("GVL_BenchRead.Active_Drive_Overload") === false, "overload input clear", 5000);
  r = await click("cmd.reset", "reset"); expectOutcome(r, "applied", "Reset after cause cleared");
  await until(() => hmiValue("GVL_DemoRead.Status.FaultCode") === 0 && !service.alarms.active().some(a => a.code === 10), "alarm cleared by observed transition", 5000);
  expectedFault = 0;
  const cleared = service.alarms.query({ code: 10 }).alarms[0];
  record("reset", { summary: `${r.command.detail} Alarm ${cleared.state} (${cleared.clearBasis}); Reset did not start: Mode ${hmiValue("GVL_DemoRead.Status.ModeText")}`, agent: r.action, command: r.command, alarm: cleared, plc: plcState() });
  if (hmiValue("GVL_DemoRead.Status.Mode") !== 0 || hmiValue("GVL_DemoRead.Status.Motor_RunCmd") !== false) throw new Error("Reset implied a restart");

  // ---- A carton through the HMI-started conveyor: item, route, disposition, counts, completion ----
  r = await click("cmd.auto.on", "auto-on-2"); expectOutcome(r, "applied", "Auto on 2");
  r = await click("cmd.start", "start-3"); expectOutcome(r, "applied", "Start 3");
  await until(() => hmiValue("GVL_BenchRead.Active_Drive_RunningFB") === true && hmiValue("GVL_DemoRead.Status.ReleaseReady") === true, "running and release ready", 6000);
  const before = { a: hmiValue("GVL_DemoRead.Status.CountExitA"), seq: Number(hmiValue("GVL_DemoRead.Status.CompletionSequence")) };
  await tool("assign_route", { itemId: "301", route: "A" });
  await tool("introduce_carton", { itemId: "301", requestedRoute: "A" });
  await until(() => hmiValue("GVL_DemoRead.Status.ItemActive") === true, "HMI shows tracked item", 6000);
  record("item-active", { summary: `Tracked item ${hmiValue("GVL_DemoRead.Status.ActiveItemId")} requested ${hmiValue("GVL_DemoRead.Status.RequestedRoute")} effective ${hmiValue("GVL_DemoRead.Status.EffectiveRoute")}`, frame: (await hub.captureNow()).reference });
  await until(() => Number(hmiValue("GVL_DemoRead.Status.CompletionSequence")) === before.seq + 1, "PLC completion for item 301", 20_000);
  guard();
  record("completion", { summary: `Completion #${before.seq + 1}: item ${hmiValue("GVL_DemoRead.Status.CompletionItemId")} exit ${hmiValue("GVL_DemoRead.Status.CompletionExit")} disposition ${hmiValue("GVL_DemoRead.Status.CompletionDisposition")}; Exit A count ${before.a} → ${hmiValue("GVL_DemoRead.Status.CountExitA")}`,
    frame: (await hub.captureNow()).reference, plc: plcState() });
  await until(() => [...coordinator.context.entityState.values()].every(e => e.type !== "carton"), "carton left the world", 10_000);
  await tool("acknowledge_completion", { sequence: before.seq + 1 });
  await until(() => hmiValue("GVL_DemoRead.Status.CompletionPending") === false, "WCS acknowledgement observed", 5000);
  r = await click("cmd.stop", "stop-2"); expectOutcome(r, "applied", "Stop 2");
  await until(() => hmiValue("GVL_DemoRead.Status.Mode") === 0 && hmiValue("GVL_BenchRead.Active_Drive_RunningFB") === false, "Stopped", 8000);
  record("stop-2", { summary: r.command.detail, command: r.command, plc: plcState() });

  // ---- HMI link interruption (HMI session only) ----
  hmiLinkControl.failReads = true;
  await until(() => service.link.view.state === "stale" || service.link.view.state === "reconnecting", "HMI shows stale/reconnecting", 8000);
  await sleep(1500);
  const staleFrame = await hub.captureNow();
  r = await click("cmd.start", "start-while-stale");
  record("link-interrupted", { summary: `HMI link ${service.link.view.state}; Start target ${r.action.status} (${r.action.detail})`, link: service.link.view, frame: staleFrame.reference, agent: r.action, command: r.command });
  if (r.command && r.command.outcome !== "refused") throw new Error("A command was sent while the HMI link was not fresh");
  hmiLinkControl.failReads = false;
  await until(() => service.link.fresh, "HMI link recovered", 30_000);
  record("link-recovered", { summary: `HMI link fresh again after ${service.link.view.reconnects} reconnect(s)`, link: service.link.view });

  // ---- Bench diagnostic: stop the coordinator heartbeat; ConnectorStale is a banner, not an alarm ----
  const alarmCount = service.alarms.size;
  await runtime.stop("HMI H2 complete; last image held in simulation");
  await connector.close(); connector = undefined;
  await until(() => hmiValue("GVL_BenchRead.ConnectorStale") === true, "ConnectorStale observed by HMI", 10_000);
  await sleep(1500);
  const staleConnectorFrame = await hub.captureNow();
  if (service.alarms.size !== alarmCount) throw new Error("ConnectorStale created a machine alarm");
  record("connector-stale", { summary: "Coordinator stopped; PLC ConnectorStale TRUE shown as bench banner; no machine alarm created", frame: staleConnectorFrame.reference, plc: plcState() });

  // ---- Page views of the same portal session ----
  for (const page of ["alarms", "engineering", "operation"]) {
    const nav = await click(`nav.${page}`, `nav-${page}`);
    record(`view-${page}`, { summary: `Portal session shows ${page}`, frame: nav.action.screen?.frameRef, agent: nav.action });
  }
  result.status = "pass";
} catch (error) {
  result.error = error instanceof Error ? error.stack : String(error);
  console.error(result.error);
  process.exitCode = 1;
} finally {
  // No reset, restart or passthrough on failure. Close sessions; the PLC keeps its state.
  unsubscribe?.();
  if (runtime && !["stopped", "completed", "failed"].includes(runtime.status)) await runtime.stop(`H2 stopped: ${result.error ? "unexplained result" : "complete"}`).catch(() => {});
  if (connector) await connector.close().catch(e => { result.closeError = e.message; });
  ledger?.close();
  if (service) result.finalPlc = plcState();
  if (host) await host.close().catch(() => {});
  if (service) { result.journal = service.journal.file; result.alarms = service.alarms.query({}).alarms; result.commands = service.commands.list(100); await service.stop(); }
  hmiServer?.close(); portal?.close();
  if (existsSync(worldTrace)) { writeFileSync(`${worldTrace}.gz`, gzipSync(readFileSync(worldTrace))); unlinkSync(worldTrace); }
  // Keep the frames each step cites alongside the evidence; the per-second stream stays out of git.
  const frameDir = `${dir}/evidence-frames`; mkdirSync(frameDir, { recursive: true });
  const cited = new Set(JSON.stringify(result.steps).match(/hmi-frame:[^"]+/g) ?? []);
  for (const ref of cited) {
    const [, session, seq] = ref.split(":");
    const file = `${dir}/portal-hmi/hmi-frames/${session.replace(/[^a-zA-Z0-9_-]/g, "_")}/${String(seq).padStart(6, "0")}.jpg`;
    if (existsSync(file)) copyFileSync(file, `${frameDir}/${session}-${String(seq).padStart(6, "0")}.jpg`);
  }
  result.finishedAt = new Date().toISOString();
  writeFileSync(`${dir}/result.json`, JSON.stringify(result, null, 2) + "\n");
  writeFileSync("artifacts/hmi/h2/latest.json", JSON.stringify({ status: result.status, directory: dir, error: result.error?.split("\n")[0] ?? null }, null, 2) + "\n");
  closeSync(lock); unlinkSync(lockPath);
  console.log(JSON.stringify({ status: result.status, directory: dir, error: result.error?.split("\n")[0] ?? null }));
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
