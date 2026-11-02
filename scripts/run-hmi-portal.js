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
import { createCampaignFactory as m8Factory, m8Preflight } from "../src/host/m8-campaign-factory.ts";
import { createCampaignFactory as recordedFactory } from "../src/host/wonder-recorded-factory.ts";
import { createCampaignFactory as wonderFactory } from "../src/host/wonder-campaign-factory.ts";
import { createPortalServer, listen as listenPortal } from "../src/host/http.ts";

const { values } = parseArgs({ options: {
  fixture: { type: "string" }, live: { type: "boolean", default: false }, "no-emulate": { type: "boolean", default: false },
  "hmi-port": { type: "string", default: "5181" }, "portal-port": { type: "string", default: "5179" },
  "poll-ms": { type: "string", default: "250" }, "shared-poll-ms": { type: "string", default: "1000" }, commands: { type: "string", default: "auto" },
  artifacts: { type: "string", default: "artifacts/hmi" }, "hmi-headless": { type: "boolean", default: false },
  "capture-ms": { type: "string", default: "1000" }, "campaign-module": { type: "string" }, campaign: { type: "string", default: "fixture" }
} });
if (!!values.fixture === values.live) throw new Error("Choose exactly one of --fixture <state> or --live");
if (!["auto", "enabled", "disabled"].includes(values.commands)) throw new Error("--commands must be auto, enabled or disabled");
if (!values["campaign-module"] && !["fixture", "fixture-adaptive", "m8", "wonder-recorded", "wonder"].includes(values.campaign)) throw new Error("Unknown campaign mode");
if (["m8", "wonder"].includes(values.campaign) && !values.live) throw new Error("A live campaign requires a live HMI source");

let source;
if (values.live) {
  if (!process.env.OPC_USER || !process.env.OPC_PASSWORD) throw new Error("Live mode needs OPC_USER/OPC_PASSWORD; run scripts/run-hmi-live.ps1 -Portal");
  const userName = process.env.OPC_USER, secret = process.env.OPC_PASSWORD;
  delete process.env.OPC_PASSWORD;
  const { createM8NativeTransport } = await import("../src/live/m8-native-transport.ts");
  const { m8Map } = await import("../src/live/m8-map.ts");
  source = { kind: "live_plc", endpoint: m8Map.endpoint, userConfigured: true, transportFactory: event => createM8NativeTransport({ userName, password: secret, event, modulePath: m8Preflight().modulePath }) };
} else source = { kind: "fixture", plc: new FixturePlc(values.fixture, { emulate: !values["no-emulate"] }) };

const service = new HmiService({ source, artifactRoot: values.artifacts, pollIntervalMs: Number(values["poll-ms"]), sharedPollIntervalMs: Number(values["shared-poll-ms"]), commandPolicy: values.commands });
const artifactDir = service.runDir;
let bridge;
const hub = new HmiHub({ captureIntervalMs: Number(values["capture-ms"]), artifactDir: artifactDir ? `${artifactDir}/portal-hmi` : undefined, onChange: (view, change) => bridge?.onHubChange(view, change) });
bridge = new PortalSessionBridge(service, hub);
const hmiServer = createHmiServer(service, { extraPost: { "/api/agent-actions/execute": body => bridge.executeAgentAction(body) } });
service.url = await listen(hmiServer, Number(values["hmi-port"]));
await service.start();

const factory = values["campaign-module"] ? await loadCampaignFactory(values["campaign-module"])
  : values.campaign === "m8" ? m8Factory()
  : values.campaign === "wonder" ? wonderFactory()
  : values.campaign === "wonder-recorded" ? recordedFactory()
  : fixtureCampaignFactory({ adaptive: values.campaign === "fixture-adaptive" });
const host = new CampaignHost({ factory, artifactDir: artifactDir ? `${artifactDir}/portal-host` : undefined, commandTimeoutMs: factory.evidenceClass === "live_plc" ? 90_000 : 15_000, hmi: hub,
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
const close = async () => {
  if (closing) process.exit(1);
  closing = true; console.log("Stopping portal HMI session and HMI service (no PLC command is issued on shutdown)…");
  await host.close(); await service.stop();
  portal.closeAllConnections?.(); hmiServer.closeAllConnections?.();
  portal.close(); hmiServer.close(() => process.exit(0));
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, close);
// Parent-owned offline composition witnesses can drain their own child on Windows,
// where terminating PowerShell/Node does not reliably deliver a POSIX signal.
if (process.send) process.on("message", message => {
  if (message?.type === "controlsbench.product.stop") void close();
});
