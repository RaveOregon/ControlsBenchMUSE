// ControlsBench portal host.
//
//   node scripts/host-portal.js [--port 5179] [--campaign fixture|fixture-adaptive]
//        [--campaign-module path/to/factory.ts] [--hmi-url http://plc:8080/webvisu.htm]
//        [--hmi-headless] [--artifacts artifacts/portal-host] [--dev-origin http://localhost:5178]
//
// Serves ui/dist when built. During UI development run `npm run dev` in ui/ (it proxies /api).
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { CampaignHost } from "../src/host/campaign-host.ts";
import { fixtureCampaignFactory, loadCampaignFactory } from "../src/host/campaign-factory.ts";
import { createPortalServer, listen } from "../src/host/http.ts";
import { createCampaignFactory as m8Factory, m8Preflight } from "../src/host/m8-campaign-factory.ts";

const { values } = parseArgs({ options: {
  port: { type: "string", default: "5179" }, hostname: { type: "string", default: "127.0.0.1" },
  campaign: { type: "string", default: "fixture" }, "campaign-module": { type: "string" },
  "hmi-url": { type: "string" }, "hmi-headless": { type: "boolean", default: false },
  artifacts: { type: "string" }, "dev-origin": { type: "string", multiple: true, default: ["http://localhost:5178", "http://127.0.0.1:5178"] },
  preflight: { type: "boolean", default: false }
} });

if (!["127.0.0.1", "localhost", "::1"].includes(values.hostname)) throw new Error("The portal host must bind to loopback");
if (values.preflight) {
  const check = m8Preflight();
  console.log(JSON.stringify({ ...check, portalBuilt: existsSync(new URL("../ui/dist/index.html", import.meta.url)),
    hmiSource: values["hmi-url"] ? "configured separately; not opened by preflight" : "not configured", launchDoesNotStartCampaign: true }, null, 2));
  process.exit(check.ready ? 0 : 1);
}

const factory = values["campaign-module"] ? await loadCampaignFactory(values["campaign-module"])
  : values.campaign === "fixture-adaptive" ? fixtureCampaignFactory({ adaptive: true })
  : values.campaign === "fixture" ? fixtureCampaignFactory()
  : values.campaign === "m8" ? m8Factory()
  : (() => { throw new Error(`Unknown --campaign ${values.campaign}`); })();
const artifactBase = values.artifacts ?? (factory.evidenceClass === "live_plc" ? "artifacts/portal-host" : undefined);
const artifactDir = artifactBase ? `${artifactBase}/${new Date().toISOString().replace(/[:.]/g, "-")}` : undefined;
const host = new CampaignHost({ factory, artifactDir, commandTimeoutMs: factory.evidenceClass === "live_plc" ? 90_000 : 15_000, hmiBrowser: { headless: values["hmi-headless"] } });
const staticDir = new URL("../ui/dist/", import.meta.url);
const server = createPortalServer({ host, staticDir: existsSync(staticDir) ? fileURLToPath(staticDir) : undefined, allowedOrigins: values["dev-origin"] });
const { url } = await listen(server, Number(values.port), values.hostname);
console.log(`ControlsBench portal host ${url}`);
console.log(`  campaign factory: ${factory.label} [${factory.evidenceClass}]`);
console.log(`  artifacts: ${artifactDir ?? "not preserved (pass --artifacts <dir>)"}`);
if (values["hmi-url"]) {
  host.submit({ contractVersion: 1, requestId: `cli-hmi-${Date.now()}`, type: "configure_hmi", payload: { url: values["hmi-url"] } });
  console.log(`  HMI: opening the configured actual browser HMI session for ${values["hmi-url"]}`);
} else console.log("  HMI: not configured (portal shows HMI not observed/tested)");

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  if (closing) process.exit(1);
  closing = true; console.log("Stopping campaign and HMI session…");
  await host.close(); server.closeAllConnections?.(); server.close(() => process.exit(0));
});
