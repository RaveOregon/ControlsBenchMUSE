// CV-1 operator HMI service.
//
//   node scripts/run-hmi.js --fixture m10-final-held [--no-emulate]       labelled fixture, no PLC
//   powershell -File scripts/run-hmi-live.ps1                             live M8 (masked credential prompt)
//
// Options: --port 5181  --poll-ms 250  --shared-poll-ms 1000  --commands auto|enabled|disabled
//          --artifacts artifacts/hmi  --no-artifacts
import { parseArgs } from "node:util";
import { HmiService } from "../src/hmi/service.ts";
import { FixturePlc } from "../src/hmi/fixture.ts";
import { createHmiServer, listen } from "../src/hmi/http.ts";

const { values } = parseArgs({ options: {
  fixture: { type: "string" }, live: { type: "boolean", default: false }, "no-emulate": { type: "boolean", default: false },
  port: { type: "string", default: "5181" }, hostname: { type: "string", default: "127.0.0.1" },
  "poll-ms": { type: "string", default: "250" }, "shared-poll-ms": { type: "string", default: "1000" },
  commands: { type: "string", default: "auto" }, artifacts: { type: "string", default: "artifacts/hmi" }, "no-artifacts": { type: "boolean", default: false }
} });
if (!!values.fixture === values.live) throw new Error("Choose exactly one of --fixture <state> or --live");
if (!["auto", "enabled", "disabled"].includes(values.commands)) throw new Error("--commands must be auto, enabled or disabled");

let source;
if (values.live) {
  if (!process.env.OPC_USER || !process.env.OPC_PASSWORD) throw new Error("Live mode needs OPC_USER/OPC_PASSWORD; run scripts/run-hmi-live.ps1 for a masked prompt");
  const userName = process.env.OPC_USER, secret = process.env.OPC_PASSWORD;
  delete process.env.OPC_PASSWORD;
  const { createM8NativeTransport } = await import("../src/live/m8-native-transport.ts");
  const { m8Map } = await import("../src/live/m8-map.ts");
  // The credential stays in this process; each (re)connect gets a fresh options object that the transport clears.
  source = { kind: "live_plc", endpoint: m8Map.endpoint, userConfigured: true,
    transportFactory: event => createM8NativeTransport({ userName, password: secret, event }) };
} else source = { kind: "fixture", plc: new FixturePlc(values.fixture, { emulate: !values["no-emulate"] }) };

const service = new HmiService({ source, artifactRoot: values["no-artifacts"] ? undefined : values.artifacts, pollIntervalMs: Number(values["poll-ms"]),
  sharedPollIntervalMs: Number(values["shared-poll-ms"]), commandPolicy: values.commands });
const server = createHmiServer(service);
service.url = await listen(server, Number(values.port), values.hostname);
await service.start();
console.log(`CV-1 operator HMI ${service.url}`);
console.log(`  source: ${service.identity.source.label}`);
console.log(`  service session: ${service.serviceSessionId}`);
console.log(`  journal: ${service.journal.file ?? "memory only"}`);
console.log(`  portal: npm run host -- --hmi-url "${service.url}?capture=portal"`);

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  if (closing) process.exit(1);
  closing = true; console.log("Stopping HMI service (no PLC command is issued on shutdown)…");
  await service.stop(); server.closeAllConnections?.(); server.close(() => process.exit(0));
});
