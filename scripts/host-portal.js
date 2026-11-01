// ControlsBench portal host.
//
//   node scripts/host-portal.js [--port 5179] [--campaign fixture|fixture-adaptive]
//        [--campaign-module path/to/factory.ts] [--hmi-url http://plc:8080/webvisu.htm]
//        [--hmi-headless] [--artifacts artifacts/portal-host] [--dev-origin http://localhost:5178]
//
// Serves ui/dist when built. During UI development run `npm run dev` in ui/ (it proxies /api).
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { CampaignHost } from "../src/host/campaign-host.ts";
import { fixtureCampaignFactory, loadCampaignFactory } from "../src/host/campaign-factory.ts";
import { createPortalServer, listen } from "../src/host/http.ts";

const { values } = parseArgs({ options: {
  port: { type: "string", default: "5179" }, hostname: { type: "string", default: "127.0.0.1" },
  campaign: { type: "string", default: "fixture" }, "campaign-module": { type: "string" },
  "hmi-url": { type: "string" }, "hmi-headless": { type: "boolean", default: false },
  artifacts: { type: "string" }, "dev-origin": { type: "string", multiple: true, default: ["http://localhost:5178", "http://127.0.0.1:5178"] }
} });

const factory = values["campaign-module"] ? await loadCampaignFactory(values["campaign-module"])
  : values.campaign === "fixture-adaptive" ? fixtureCampaignFactory({ adaptive: true })
  : values.campaign === "fixture" ? fixtureCampaignFactory()
  : (() => { throw new Error(`Unknown --campaign ${values.campaign}`); })();
const artifactDir = values.artifacts ? `${values.artifacts}/${new Date().toISOString().replace(/[:.]/g, "-")}` : undefined;
const host = new CampaignHost({ factory, artifactDir, hmiBrowser: { headless: values["hmi-headless"] } });
const staticDir = new URL("../ui/dist/", import.meta.url);
const server = createPortalServer({ host, staticDir: existsSync(staticDir) ? staticDir.pathname.replace(/^\/([A-Za-z]:)/, "$1") : undefined, allowedOrigins: values["dev-origin"] });
const { url } = await listen(server, Number(values.port), values.hostname);
console.log(`ControlsBench portal host ${url}`);
console.log(`  campaign factory: ${factory.label} [${factory.evidenceClass}]`);
console.log(`  artifacts: ${artifactDir ?? "not preserved (pass --artifacts <dir>)"}`);
if (values["hmi-url"]) {
  host.submit({ contractVersion: 1, requestId: `cli-hmi-${Date.now()}`, type: "configure_hmi", payload: { url: values["hmi-url"] } });
  console.log(`  HMI: opening controlled WebVisu session for ${values["hmi-url"]}`);
} else console.log("  HMI: not configured (portal shows HMI not observed/tested)");

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  if (closing) process.exit(1);
  closing = true; console.log("Stopping campaign and HMI session…");
  await host.close(); server.closeAllConnections?.(); server.close(() => process.exit(0));
});
