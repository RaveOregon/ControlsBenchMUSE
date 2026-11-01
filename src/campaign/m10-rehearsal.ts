import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { LiveWorldCoordinator } from "../live/coordinator.ts";
import { M8OpcUaConnector } from "../live/m8-opcua.ts";
import { m8Map, withM8Observations } from "../live/m8-map.ts";
import type { GeneratedWorldModule } from "../proof/contracts.ts";
import { CampaignRuntime } from "./runtime.ts";
import { CampaignLedger } from "./ledger.ts";
import { CoordinatorCampaignDriver } from "./driver.ts";
import { m8ControllerActions, m8WorldBindings } from "./m8-bindings.ts";
import { FakeProvider } from "./provider.ts";
import type { ToolCall, Experiment } from "./contracts.ts";

const root = new URL("../../", import.meta.url);
export const shaFile = (path: URL | string) => createHash("sha256").update(readFileSync(path)).digest("hex");
export const frozenProjectHash = "6c2a1eb6c9c83485b75cb9bcefc1be237a94c8727ecf8098ad57a4d680516628";
export const scenarios = ["sort-a", "sort-b", "unassigned-runout", "assigned-runout-misroute", "stop-coast", "failed-divert"];
export async function runM10Rehearsal(connector: M8OpcUaConnector, ledger: CampaignLedger, progress: (message: string) => void = () => {}) {
  const worldPath = new URL("artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts", root);
  const world = withM8Observations((await import(worldPath.href)).default as GeneratedWorldModule);
  const coordinator = new LiveWorldCoordinator(world, connector, { seed: 20261031, worldVersion: world.manifest.packageVersion });
  const driver = new CoordinatorCampaignDriver(coordinator, ledger, m8WorldBindings, { operationTimeoutMs: 5000, initializeTimeoutMs: 60_000, elapsedStep: true, maximumStepMs: 300 });
  const projectHash = shaFile(new URL("codesys/conveyordemo.project", root));
  assert.equal(projectHash, frozenProjectHash, "M8 project bytes changed from accepted build");
  const runtime = new CampaignRuntime({ ledger, driver, controller: m8ControllerActions(connector, ledger),
    provider: new FakeProvider(() => { throw new Error("Deterministic rehearsal never requests a model decision"); }),
    provenance: { spec: shaFile(new URL("docs/conveyor-machine-spec.md", root)), ioMap: shaFile(new URL("codesys/demo/signal-map-v1.json", root)),
      plcBuild: `8001/interface-1/sha256:${projectHash}`, worldModule: shaFile(worldPath), model: "deterministic-M10-rehearsal-v1;zero-model-requests", connector: `${connector.id}/${m8Map.mapVersion}` },
    evidenceClass: "live_plc", claimBoundary: "Six deterministic single-carton scenarios against M8 build 8001 using the preserved Muse world. No paid model or HMI evidence, no broader controller coverage.",
    spec: readFileSync(new URL("docs/conveyor-machine-spec.md", root), "utf8"), signals: world.manifest.signals, categories: ["functional", "runtime", "faults"] });
  const checks: { scenario: string; evidenceRefs: string[]; data: Record<string, unknown> }[] = [];
  let actionId = 0, expectedFault = 0, unexplained: Error | undefined;
  const values = () => coordinator.latestObservation?.values ?? {};
  const cartons = () => [...coordinator.context.entityState.values()].filter(e => e.type === "carton");
  const raw = () => coordinator.context.plc.currentInputState();
  const latestOutput = () => ledger.recentEvents(1, e => e.type === "plc.output")[0];
  const monitor = () => {
    const fault = Number(values()["controller.FaultCode"] ?? 0);
    if (fault && fault !== expectedFault) {
      unexplained = new Error(`Unexpected M8 fault ${fault}: ${values()["controller.FaultText"]}`);
      void runtime.pause(unexplained.message);
    }
  };
  const unsubscribe = driver.subscribe(monitor);
  const healthy = () => { monitor(); if (unexplained) throw unexplained; if (driver.failure) throw driver.failure; if (runtime.status !== "running") throw new Error(`Campaign ${runtime.status}; stop without next experiment`); };
  async function tool(name: ToolCall["name"], args: Record<string, unknown>) {
    healthy();
    const r = await runtime.executeTool({ id: `m10-action-${++actionId}`, name, arguments: args });
    if (r.status !== "applied") throw new Error(`${name} ${r.status}: ${r.message}`); if (name !== "finish_campaign") healthy(); return r;
  }
  async function wait(predicate: () => boolean, label: string, timeoutMs = 15_000) {
    healthy(); const began = performance.now();
    progress(label);
    await new Promise<void>((resolve, reject) => {
      let off = () => {};
      const timer = setTimeout(() => { off(); reject(new Error(`Unexplained deadline: ${label}`)); }, timeoutMs);
      const check = () => { try { healthy(); if (predicate()) { clearTimeout(timer); off(); resolve(); } } catch (e) { clearTimeout(timer); off(); reject(e); } };
      off = driver.subscribe(check); check();
    });
    const output = latestOutput(); assert(output, "No PLC output evidence");
    return ledger.append("observation", { summary: `${label}; elapsed ${Math.round(performance.now() - began)} ms`, evidenceRefs: [output.id] }).id;
  }
  async function complete(scenario: string, data: Record<string, unknown>, output = latestOutput()) {
    assert(output);
    const finding = await tool("record_finding", { id: scenario, title: `M10 ${scenario}: observed deterministic oracle`, experimentId: scenario,
      claims: ["Motor_RunCmd", "controller.Mode", "controller.FaultCode", "controller.CompletionSequence", "controller.CompletionExit", "controller.CompletionDisposition", "controller.CountExitA", "controller.CountExitB", "controller.CountRunout", "controller.CountMisroute", "controller.CountFaulted"]
        .map(signal => ({ evidenceId: output.id, signal, equals: (output.data.values as Record<string, unknown>)[signal] })),
      injectedTruthRefs: scenario === "failed-divert" ? ledger.events.filter(e => e.type === "fault.truth").map(e => e.id) : [],
      inference: "Deterministic scenario oracle passed against correlated PLC observations; physical behavior is independently retained in world evidence.",
      assumptions: ["Preserved world 0.5.0 physical assumptions; one carton; M8 declared timer/oracle settings"], uncertainty: "Only the executed scenario and measured transport are established; no HMI or paid Muse proof." });
    checks.push({ scenario, evidenceRefs: [output.id, ...finding.evidenceRefs], data });
    await runtime.applyDecision({ summary: `Completed ${scenario}`, completeExperiment: { id: scenario, evidenceRefs: [output.id], conclusion: "observed" }, calls: [] }, ledger.state.revision);
  }
  async function runCarton(scenario: string, route: "A" | "B" | null, itemId: string, exit: number, disposition: number) {
    await wait(() => values()["controller.ReleaseReady"] === true && cartons().length === 0, "Empty world and PLC release ready");
    const before = { ...values() }, sequence = Number(before["controller.CompletionSequence"]) + 1;
    if (route) await tool("assign_route", { itemId, route });
    await tool("introduce_carton", { itemId, requestedRoute: route });
    await wait(() => values()["controller.CompletionSequence"] === sequence, `${scenario}: PLC completion`);
    assert.equal(values()["controller.CompletionExit"], exit); assert.equal(values()["controller.CompletionDisposition"], disposition);
    assert.equal(values()["controller.CompletionItemId"], route ? Number(itemId) : 0);
    assert.equal(values()["controller.CompletionRoute"], route === "A" ? 1 : route === "B" ? 2 : 0);
    for (const [code, counter] of [[1, "CountExitA"], [2, "CountExitB"], [3, "CountRunout"]] as const)
      assert.equal(values()[`controller.${counter}`], Number(before[`controller.${counter}`]) + (exit === code ? 1 : 0));
    assert.equal(values()["controller.CountMisroute"], Number(before["controller.CountMisroute"]) + (disposition === 3 ? 1 : 0));
    await wait(() => cartons().length === 0, `${scenario}: physical carton left world`);
    assert.equal(values()["controller.CompletionSequence"], sequence, "No repeated completion while physical carton leaves");
    await tool("acknowledge_completion", { sequence });
    await wait(() => values()["controller.ReleaseReady"] === true, "PLC release re-enabled after completion acknowledgement");
    await complete(scenario, { completionSequence: sequence, exit, disposition, itemId: route ? Number(itemId) : 0 });
  }
  try {
    await runtime.start();
    if (runtime.status !== "running") throw new Error(String(ledger.state.report?.summary ?? "M8 setup failed before experiments"));
    assert.equal(values()["controller.Mode"], 0, "Require stopped baseline; do not recover an unexplained controller state");
    assert.equal(values()["controller.ItemActive"], false); assert.equal(values()["controller.CompletionPending"], false);
    const initialCounts = Object.fromEntries(["CountExitA", "CountExitB", "CountRunout", "CountMisroute", "CountFaulted"].map(n => [n, values()[`controller.${n}`]]));
    const experiments: Experiment[] = scenarios.map(id => ({ id, objective: id, category: id === "stop-coast" ? "runtime" : id === "failed-divert" ? "faults" : "functional", requirements: [] }));
    await runtime.applyDecision({ summary: "Execute deterministic M10 rehearsal within the selected six-scenario scope", plan: { objective: "Connect preserved Muse world and M9 runtime to M8", experiments }, calls: [] }, ledger.state.revision);
    await tool("operator_action", { action: "reset" }); await tool("operator_action", { action: "start" });
    await runCarton("sort-a", "A", "101", 1, 1);
    await runCarton("sort-b", "B", "102", 2, 1);
    await runCarton("unassigned-runout", null, "unassigned", 3, 2);
    await tool("set_downstream_readiness", { destination: "A", ready: false });
    await runCarton("assigned-runout-misroute", "A", "103", 3, 3);
    await tool("set_downstream_readiness", { destination: "A", ready: true });
    await wait(() => values()["controller.ReleaseReady"] === true && cartons().length === 0, "Ready for Stop/coast carton");
    await tool("introduce_carton", { itemId: "stop-carton", requestedRoute: null });
    await wait(() => values()["controller.ItemActive"] === true && Number(cartons()[0]?.state.positionM) >= 0.7, "Carton in travel before Stop");
    await tool("operator_action", { action: "stop" });
    const command = ledger.events.filter(e => e.type === "controller.action" && e.data.action === "stop").at(-1)!;
    assert.equal((command.data.observation as any).values.Motor_RunCmd, false);
    const positionAtCommand = Number(cartons()[0].state.positionM), encoderAtCommand = Number(raw().Encoder_Count);
    assert(Number(raw().Belt_SpeedActual) > 0);
    await wait(() => values()["controller.Mode"] === 0 && raw().Belt_SpeedActual === 0 && raw().Drive_RunningFB === false, "Physical deceleration and PLC stationary Stop");
    const stoppedPosition = Number(cartons()[0].state.positionM), stoppedEncoder = Number(raw().Encoder_Count);
    assert(stoppedPosition > positionAtCommand); assert(stoppedEncoder > encoderAtCommand);
    await tool("observe_for_duration", { durationMs: 500 });
    assert.equal(cartons()[0].state.positionM, stoppedPosition); assert.equal(raw().Encoder_Count, stoppedEncoder);
    const stoppedEvidence = latestOutput();
    const coast = { positionAtCommand, encoderAtCommand, stoppedPosition, stoppedEncoder, commandRef: command.id };
    ledger.append("world.evidence", { source: { type: "m10.coast-measurement", data: coast } }, "truth");
    // Resume the same tracked carton to clear the physical world before the final fault trial.
    const nextCompletion = Number(values()["controller.CompletionSequence"]) + 1;
    await tool("operator_action", { action: "start" });
    await wait(() => values()["controller.CompletionSequence"] === nextCompletion && cartons().length === 0, "Resumed Stop carton exits runout");
    assert.equal(values()["controller.CompletionExit"], 3); assert.equal(values()["controller.CompletionDisposition"], 2);
    await tool("acknowledge_completion", { sequence: nextCompletion }); await complete("stop-coast", coast, stoppedEvidence);
    await wait(() => values()["controller.ReleaseReady"] === true && cartons().length === 0, "Ready for failed-divert trial");
    const faultBefore = { ...values() }; expectedFault = 23;
    await tool("inject_fault", { controlId: "fault.setDivertJam", parameters: { divert: 1, active: true } });
    await tool("assign_route", { itemId: "201", route: "A" }); await tool("introduce_carton", { itemId: "201", requestedRoute: "A" });
    await wait(() => values()["controller.FaultCode"] === 23 && raw().Belt_SpeedActual === 0, "D1 failed motion: PLC fault 23 and world stopped", 6000);
    assert.equal(values().Motor_RunCmd, false); assert.equal(values()["controller.CompletionDisposition"], 4); assert.equal(values()["controller.CompletionExit"], 0);
    assert.equal(values()["controller.CompletionSequence"], Number(faultBefore["controller.CompletionSequence"]) + 1);
    assert.equal(values()["controller.CountFaulted"], Number(faultBefore["controller.CountFaulted"]) + 1);
    for (const n of ["CountExitA", "CountExitB", "CountRunout"]) assert.equal(values()[`controller.${n}`], faultBefore[`controller.${n}`]);
    await tool("observe_for_duration", { durationMs: 500 });
    assert.equal(values()["controller.CompletionSequence"], Number(faultBefore["controller.CompletionSequence"]) + 1);
    await complete("failed-divert", { faultCode: 23, initialCounts, finalCounts: Object.fromEntries(Object.keys(initialCounts).map(n => [n, values()[`controller.${n}`]])) });
    await tool("finish_campaign", { summary: "Six deterministic M8 scenarios passed; expected failed-divert state retained in simulation for inspection" });
    await runtime.stop();
    return { status: "pass", checks, finalImage: driver.lastImage, finalSnapshot: driver.lastSnapshot, finalObservation: connector.latest, report: runtime.getReport() };
  } catch (error) {
    await runtime.stop(`M10 stopped on unexplained behavior: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally { unsubscribe(); assert.equal(shaFile(new URL("codesys/conveyordemo.project", root)), projectHash, "PLC project changed during validation"); }
}
