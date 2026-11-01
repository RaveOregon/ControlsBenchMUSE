import { execFileSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptedBudgetLimits } from "../campaign/budget.ts";
import { createM10Session, executeM10Rehearsal, frozenProjectHash, shaFile } from "../campaign/m10-rehearsal.ts";
import type { M10Session } from "../campaign/m10-rehearsal.ts";
import { observedSignals } from "../live/m8-map.ts";
import { createM8NativeTransport } from "../live/m8-native-transport.ts";
import { M8OpcUaConnector } from "../live/m8-opcua.ts";
import type { M8Transport, TransportEvent } from "../live/m8-opcua.ts";
import type { CampaignFactory } from "./campaign-factory.ts";

const repository = fileURLToPath(new URL("../../", import.meta.url));
export function sharedM8Root(): string {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: repository, encoding: "utf8", windowsHide: true }).trim();
  return dirname(common);
}
export function m8Preflight(options: { ownershipPath?: string; modulePath?: string } = {}) {
  const root = sharedM8Root();
  const ownershipPath = options.ownershipPath ?? join(root, "artifacts/m10/live.lock");
  const modulePath = options.modulePath ?? process.env.CONTROLSBENCH_OPCUA_MODULE ?? join(root, "codesys/codesys_handoff/browser_hmi_handoff/opcua_relay/node_modules/node-opcua");
  const legacy = join(root, "codesys/demo/operator-status.json"), session = join(root, "artifacts/m10/operator-status.json");
  const active = (path: string) => existsSync(path) && JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")).active === true;
  const state = { projectUnchanged: shaFile(join(repository, "codesys/conveyordemo.project")) === frozenProjectHash,
    runtimeOwned: existsSync(ownershipPath), legacySessionActive: active(legacy) || active(session),
    nativeModuleAvailable: existsSync(modulePath), credentialsPresent: !!process.env.OPC_USER && !!process.env.OPC_PASSWORD,
    ownershipPath: resolve(ownershipPath), modulePath: resolve(modulePath), plcContacted: false, paidCalls: 0 };
  return { ...state, ready: state.projectUnchanged && !state.runtimeOwned && !state.legacySessionActive && state.nativeModuleAvailable && state.credentialsPresent };
}
export interface M8FactoryOptions {
  ownershipPath?: string;
  modulePath?: string;
  /** Test seam; injected transports are always labeled fake_connector. Never contacts native OPC. */
  transportFactory?: (event: TransportEvent) => M8Transport;
  /** Bounded test executors reuse the real runtime/driver without a software copy of PLC logic. */
  executor?: (session: M10Session) => Promise<unknown>;
  onSession?: (session: M10Session) => void;
}

/** Construction/preflight is read-only. Native OPC opens only after the host accepts Start. */
export function createCampaignFactory(options: M8FactoryOptions = {}): CampaignFactory {
  const injected = !!options.transportFactory;
  const evidenceClass = injected ? "fake_connector" as const : "live_plc" as const;
  const claimBoundary = injected ? "Injected M8 protocol transport; no live PLC or model call."
    : "M8 build 8001/interface 1; deterministic six-scenario M10 campaign using the preserved Muse world. No model calls; HMI pixels and generated view remain separate evidence.";
  return { id: injected ? "m8-injected" : "m8-live", label: injected ? "M8 protocol fixture" : "M8 live · full six-case deterministic campaign",
    evidenceClass, claimBoundary, connectorId: "m8-opcua-v1", outputIds: observedSignals.map(s => s.logical), limits: { ...acceptedBudgetLimits }, supportsExitSimulation: true,
    async create({ ledger, hmi, scope, artifactDirectory }) {
      if (Object.values(scope).some(v => v !== true)) throw new Error("M10 currently requires the complete six-case scope; partial/deselected scopes are not executed");
      const check = m8Preflight(options);
      if (!check.projectUnchanged) throw new Error("Frozen M8 project hash differs; no PLC contact made");
      if (!injected && !check.ready) throw new Error("M8 preflight failed: check credentials, native package, shared ownership and operator sessions; no PLC contact made");
      if (!injected && !artifactDirectory) throw new Error("Live M8 requires the host's persistent artifact directory");
      mkdirSync(dirname(check.ownershipPath), { recursive: true });
      const lease = openSync(check.ownershipPath, "wx");
      writeFileSync(lease, JSON.stringify({ campaignId: ledger.campaignId, owner: "portal-m8", pid: process.pid }) + "\n");
      let connector: M8OpcUaConnector | undefined;
      let disposed = false;
      const release = () => { if (!disposed) { disposed = true; closeSync(lease); unlinkSync(check.ownershipPath); } };
      try {
        const event: TransportEvent = (kind, data) => {
          if (artifactDirectory) appendFileSync(join(artifactDirectory, "m8-transport.jsonl"), JSON.stringify({ kind, atIso: new Date().toISOString(), atMonotonicMs: performance.now(), ...data }) + "\n");
        };
        const transport = options.transportFactory ? options.transportFactory(event) : createM8NativeTransport({
          userName: process.env.OPC_USER!, password: process.env.OPC_PASSWORD!, event, modulePath: check.modulePath });
        connector = new M8OpcUaConnector(transport, event, { requireStoppedBaseline: true });
        const session = await createM10Session(connector, ledger, { hmi, evidenceClass, claimBoundary });
        options.onSession?.(session);
        let running: Promise<unknown> | undefined;
        return { runtime: session.runtime,
          run: () => running ??= (options.executor ?? executeM10Rehearsal)(session),
          resumeBlockedReason: () => session.resumeBlockedReason,
          simulationExit: { async exit(signal) {
            if (signal.aborted) throw new Error("Exit cancelled before request");
            const observation = await connector!.exitSimulation();
            if (signal.aborted) throw new Error("Exit completed after cancellation; inspect actual passthrough state");
            return observation;
          } },
          dispose: async () => { await connector!.close(); release(); } };
      } catch (error) { if (connector) await connector.close(); release(); throw error; }
    }
  };
}
