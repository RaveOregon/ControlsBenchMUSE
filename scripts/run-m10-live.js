import { closeSync, openSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { CampaignLedger } from "../src/campaign/ledger.ts";
import { createM8NativeTransport } from "../src/live/m8-native-transport.ts";
import { M8OpcUaConnector } from "../src/live/m8-opcua.ts";
import { runM10Rehearsal, shaFile, frozenProjectHash } from "../src/campaign/m10-rehearsal.ts";
import { auditM10 } from "./audit-m10.js";

if (!process.env.OPC_USER || !process.env.OPC_PASSWORD) throw new Error("Run scripts/run-m10-live.ps1 for a masked OPC credential prompt");
mkdirSync("artifacts/m10", { recursive: true });
const lockPath = "artifacts/m10/live.lock", lock = openSync(lockPath, "wx");
const directory = `artifacts/m10/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(directory); const transportPath = `${directory}/transport.jsonl`;
writeFileSync(transportPath, "", { flag: "wx" });
const ledger = new CampaignLedger("m10-live", { file: `${directory}/campaign.jsonl` });
const event = (kind, data) => appendFileSync(transportPath, JSON.stringify({ kind, atIso: new Date().toISOString(), atMonotonicMs: performance.now(), ...data }) + "\n");
const result = { schemaVersion: 1, status: "failed", directory, modelCalls: 0, projectSha256: shaFile("codesys/conveyordemo.project"),
  worldSha256: shaFile("artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts"),
  base: "m10-base/fa8d2ee", mapSha256: shaFile("codesys/demo/signal-map-v1.json") };
let connector;
try {
  if (result.projectSha256 !== frozenProjectHash) throw new Error("M8 project differs from frozen accepted build");
  if (existsSync("codesys/demo/operator-status.json") && JSON.parse(readFileSync("codesys/demo/operator-status.json", "utf8")).active) throw new Error("M8 operator session owns runtime; stop and coordinate");
  const precheck = execFileSync(process.execPath, ["codesys/demo/tests/precheck.cjs"], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  writeFileSync(`${directory}/precheck.json`, precheck);
  const transport = createM8NativeTransport({ userName: process.env.OPC_USER, password: process.env.OPC_PASSWORD, event });
  delete process.env.OPC_PASSWORD;
  connector = new M8OpcUaConnector(transport, event);
  Object.assign(result, await runM10Rehearsal(connector, ledger, message => console.log(`[M10] ${message}`)));
} catch (error) { result.error = error instanceof Error ? error.stack : String(error); console.error(result.error); process.exitCode = 1; }
finally {
  // No controller reset/recovery or passthrough transition on failure. Close transport only.
  if (connector) await connector.close().catch(error => { result.closeError = error.message; result.status = "failed"; process.exitCode = 1; });
  ledger.close();
  writeFileSync(`${directory}/transport.jsonl.gz`, gzipSync(readFileSync(transportPath)));
  unlinkSync(transportPath);
  result.evidenceHashes = Object.fromEntries(["campaign.jsonl", "transport.jsonl.gz", ...(existsSync(`${directory}/precheck.json`) ? ["precheck.json"] : [])].map(file => [file, shaFile(`${directory}/${file}`)]));
  result.finishedAt = new Date().toISOString();
  writeFileSync(`${directory}/result.json`, JSON.stringify(result, null, 2) + "\n");
  if (result.report) writeFileSync(`${directory}/report.json`, JSON.stringify(result.report, null, 2) + "\n");
  if (result.status === "pass") {
    try { writeFileSync(`${directory}/audit.json`, JSON.stringify(auditM10(directory), null, 2) + "\n"); }
    catch (error) { result.status = "failed_audit"; result.error = error.message; writeFileSync(`${directory}/result.json`, JSON.stringify(result, null, 2) + "\n"); process.exitCode = 1; }
  }
  writeFileSync("artifacts/m10/latest.json", JSON.stringify({ status: result.status, directory, error: result.error ?? null }, null, 2) + "\n");
  closeSync(lock); unlinkSync(lockPath);
  console.log(JSON.stringify({ status: result.status, directory, error: result.error ?? null }));
}
