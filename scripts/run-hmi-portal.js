// CV-1 operator HMI shown in the ControlsBench portal (Lane B host) from one controlled session.
//
//   node scripts/run-hmi-portal.js --fixture m10-final-held [--hmi-headless]
//   powershell -File scripts/run-hmi-live.ps1 -Portal               (live M8, masked credential prompt)
//
// Starts the HMI service (default :5181) and Lane B's portal host (default :5179). The portal opens
// its controlled browser on http://127.0.0.1:5181/?capture=portal; that one session is what the
// portal tile shows, what an engineer operates (headed window) and what agent actions click.
//   POST http://127.0.0.1:5181/api/agent-actions/execute {"targetId":"cmd.stop","requester":"script"}
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { HmiService } from "../src/hmi/service.ts";
import { FixturePlc } from "../src/hmi/fixture.ts";
import { createHmiServer, listen } from "../src/hmi/http.ts";
import { PortalSessionBridge } from "../src/hmi/portal-bridge.ts";
import { CampaignHost } from "../src/host/campaign-host.ts";
import { fixtureCampaignFactory, loadCampaignFactory } from "../src/host/campaign-factory.ts";
import { CdpWebVisuSource } from "../src/host/cdp-webvisu.ts";
import { HmiHub } from "../src/host/hmi.ts";
import { createPortalServer, listen as listenPortal } from "../src/host/http.ts";

const { values } = parseArgs({ options: {
  fixture: { type: "string" }, live: { type: "boolean", default: false }, "no-emulate": { type: "boolean", default: false },
  "hmi-port": { type: "string", default: "5181" }, "portal-port": { type: "string", default: "5179" },
  "poll-ms": { type: "string", default: "250" }, "shared-poll-ms": { type: "string", default: "1000" }, commands: { type: "string", default: "auto" },
  artifacts: { type: "string", default: "artifacts/hmi" }, "hmi-headless": { type: "boolean", default: false },
  "capture-ms": { type: "string", default: "1000" }, "campaign-module": { type: "string" }
} });
if (!!values.fixture === values.live) throw new Error("Choose exactly one of --fixture <state> or --live");

let source;
if (values.live) {
  if (!process.env.OPC_USER || !process.env.OPC_PASSWORD) throw new Error("Live mode needs OPC_USER/OPC_PASSWORD; run scripts/run-hmi-live.ps1 -Portal");
  const userName = process.env.OPC_USER, secret = process.env.OPC_PASSWORD;
  delete process.env.OPC_PASSWORD;
  const { createM8NativeTransport } = await import("../src/live/m8-native-transport.ts");
  const { m8Map } = await import("../src/live/m8-map.ts");
  source = { kind: "live_plc", endpoint: m8Map.endpoint, userConfigured: true, transportFactory: event => createM8NativeTransport({ userName, password: secret, event }) };
} else source = { kind: "fixture", plc: new FixturePlc(values.fixture, { emulate: !values["no-emulate"] }) };

const service = new HmiService({ source, artifactRoot: values.artifacts, pollIntervalMs: Number(values["poll-ms"]), sharedPollIntervalMs: Number(values["shared-poll-ms"]), commandPolicy: values.commands });
const artifactDir = service.runDir;
let bridge;
const hub = new HmiHub({ captureIntervalMs: Number(values["capture-ms"]), artifactDir: artifactDir ? `${artifactDir}/portal-hmi` : undefined, onChange: (view, change) => bridge?.onHubChange(view, change) });
bridge = new PortalSessionBridge(service, hub);
const hmiServer = createHmiServer(service, { extraPost: { "/api/agent-actions/execute": body => bridge.executeAgentAction(body) } });
service.url = await listen(hmiServer, Number(values["hmi-port"]));
await service.start();

const factory = values["campaign-module"] ? await loadCampaignFactory(values["campaign-module"]) : fixtureCampaignFactory();
const host = new CampaignHost({ factory, artifactDir: artifactDir ? `${artifactDir}/portal-host` : undefined, hmi: hub,
  hmiSourceFactory: url => bridge.attachSource(new CdpWebVisuSource(url, { headless: values["hmi-headless"], width: 1280, height: 800 })) });
const staticDir = new URL("../ui/dist/", import.meta.url);
const portal = createPortalServer({ host, staticDir: existsSync(staticDir) ? staticDir.pathname.replace(/^\/([A-Za-z]:)/, "$1") : undefined });
const { url: portalUrl } = await listenPortal(portal, Number(values["portal-port"]), "127.0.0.1");
const hmiUrl = `${service.url}?capture=portal`;
host.submit({ contractVersion: 1, requestId: `hmi-portal-${Date.now()}`, type: "configure_hmi", payload: { url: hmiUrl } });

console.log(`CV-1 operator HMI ${service.url}  [${service.identity.source.label}]`);
console.log(`ControlsBench portal ${portalUrl}  (campaign factory: ${factory.label} [${factory.evidenceClass}])`);
console.log(`  portal HMI session: controlled ${values["hmi-headless"] ? "headless" : "headed"} browser on ${hmiUrl}`);
console.log(`  evidence: ${artifactDir ?? "memory only"}`);
console.log(`  agent seam: POST ${service.url}api/agent-actions/execute {"targetId":"cmd.stop","requester":"script"}`);
if (!existsSync(staticDir)) console.log("  note: ui/dist is not built; run `npm run build` in ui/ to serve the portal page");

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  if (closing) process.exit(1);
  closing = true; console.log("Stopping portal HMI session and HMI service (no PLC command is issued on shutdown)…");
  await host.close(); await service.stop();
  portal.closeAllConnections?.(); hmiServer.closeAllConnections?.();
  portal.close(); hmiServer.close(() => process.exit(0));
});
