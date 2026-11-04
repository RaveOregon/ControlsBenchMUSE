// ControlsBench portal host.
//
//   node scripts/host-portal.js [--port 5179] [--campaign fixture|fixture-adaptive]
//        [--campaign-module path/to/factory.ts] [--hmi-url http://plc:8080/webvisu.htm]
//        [--hmi-headless] [--artifacts artifacts/portal-host] [--dev-origin http://localhost:5178]
//
// Serves ui/dist when built. During UI development run `npm run dev` in ui/ (it proxies /api).
//
// Specification-to-project onboarding:
//   --projects artifacts/projects            enable /api/projects with this project store
//   --project-author fixture|muse            server-side world author (muse needs MODEL_API_KEY; paid)
//   --campaign project                       Start runs the selected project (offline isolated child + fixture M8 transport)
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { CampaignHost } from "../src/host/campaign-host.ts";
import { fixtureCampaignFactory, loadCampaignFactory } from "../src/host/campaign-factory.ts";
import { createPortalServer, listen } from "../src/host/http.ts";
import { createCampaignFactory as m8Factory, m8Preflight } from "../src/host/m8-campaign-factory.ts";
import { ProjectApi } from "../src/host/project-api.ts";
import { createProjectCampaignFactory } from "../src/host/project-campaign-factory.ts";
import { durablePreparationAccount, noAccount, preparationAccountPath } from "../src/projects/accounting.ts";
import { FixtureWorldAuthor, WonderWorldAuthor } from "../src/projects/author.ts";
import { PreparationService } from "../src/projects/preparation.ts";
import { ProjectStore } from "../src/projects/store.ts";

const { values } = parseArgs({ options: {
  port: { type: "string", default: "5179" }, hostname: { type: "string", default: "127.0.0.1" },
  campaign: { type: "string", default: "fixture" }, "campaign-module": { type: "string" },
  "hmi-url": { type: "string" }, "hmi-headless": { type: "boolean", default: false },
  artifacts: { type: "string" }, "dev-origin": { type: "string", multiple: true, default: ["http://localhost:5178", "http://127.0.0.1:5178"] },
  preflight: { type: "boolean", default: false },
  projects: { type: "string" }, "project-author": { type: "string", default: "fixture" }, "preparation-account": { type: "string" }
} });
if (values.campaign === "project" && !values.projects) throw new Error("--campaign project requires --projects <store directory>");
if (!["fixture", "muse"].includes(values["project-author"])) throw new Error("--project-author must be fixture or muse");
const store = values.projects ? new ProjectStore(values.projects) : undefined;

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
  : values.campaign === "project" ? createProjectCampaignFactory({ store, transportModule: fileURLToPath(new URL("../test/fixtures/wonder-process-transport.ts", import.meta.url)),
      lockDirectory: join(store.root, ".locks") })
  : (() => { throw new Error(`Unknown --campaign ${values.campaign}`); })();
const artifactBase = values.artifacts ?? (factory.evidenceClass === "live_plc" ? "artifacts/portal-host" : undefined);
const artifactDir = artifactBase ? `${artifactBase}/${new Date().toISOString().replace(/[:.]/g, "-")}` : undefined;
const host = new CampaignHost({ factory, artifactDir, commandTimeoutMs: factory.evidenceClass === "live_plc" ? 90_000 : 15_000, hmiBrowser: { headless: values["hmi-headless"] } });
const staticDir = new URL("../ui/dist/", import.meta.url);
let projects;
if (store) {
  const muse = values["project-author"] === "muse";
  const author = () => muse ? new WonderWorldAuthor({ apiKey: process.env.MODEL_API_KEY ?? "" }) : new FixtureWorldAuthor();
  const probe = muse ? { id: "muse-wonder-1.0", label: "Muse Wonder 1.0 (paid model request)", paid: true, fixture: false } : { id: "fixture-author", label: "Fixture author (offline test; not Muse)", paid: false, fixture: true };
  if (muse && !process.env.MODEL_API_KEY) throw new Error("--project-author muse requires MODEL_API_KEY in the host environment (never sent to the browser)");
  const preparation = new PreparationService({ store, author, account: muse ? durablePreparationAccount(values["preparation-account"] ?? preparationAccountPath()) : noAccount, hmiCapable: false });
  projects = new ProjectApi({ store, preparation, host, author: probe });
}
const server = createPortalServer({ host, staticDir: existsSync(staticDir) ? fileURLToPath(staticDir) : undefined, allowedOrigins: values["dev-origin"], projects });
const { url } = await listen(server, Number(values.port), values.hostname);
console.log(`ControlsBench portal host ${url}`);
console.log(`  campaign factory: ${factory.label} [${factory.evidenceClass}]`);
if (store) console.log(`  projects: ${store.root}; preparation author: ${values["project-author"]}`);
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
