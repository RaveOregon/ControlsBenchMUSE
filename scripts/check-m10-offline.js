import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { shaFile, frozenProjectHash } from "../src/campaign/m10-rehearsal.ts";
import assert from "node:assert/strict";

const directory = "artifacts/m10/offline";
mkdirSync(directory, { recursive: true });
const typecheck = execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"], { encoding: "utf8", windowsHide: true });
const tests = execFileSync(process.execPath, ["--test", "test/proof-chassis.test.ts", "test/budget-guard.test.ts", "test/live-coordinator.test.ts", "test/campaign.test.ts", "test/m8-connector.test.ts"], { encoding: "utf8", windowsHide: true });
const sources = ["src/live/m8-map.ts", "src/live/m8-opcua.ts", "src/live/m8-native-transport.ts", "src/campaign/m8-bindings.ts", "src/campaign/m10-rehearsal.ts", "src/campaign/contracts.ts", "src/campaign/runtime.ts", "src/campaign/driver.ts", "scripts/run-m10-live.js", "scripts/run-m10-live.ps1", "scripts/audit-m10.js"];
assert.equal(shaFile("codesys/conveyordemo.project"), frozenProjectHash);
writeFileSync(`${directory}/checks.txt`, `${typecheck}\n${tests}`);
const result = { schemaVersion: 1, status: "pass", checkedAt: new Date().toISOString(),
  evidenceClass: "offline_protocol_and_regression_tests", livePlcExecuted: false, paidCalls: 0,
  testedSources: Object.fromEntries(sources.map(path => [path, shaFile(path)])),
  frozenProjectSha256: frozenProjectHash, liveGate: "pending_new_live_M10_evidence_and_audit" };
writeFileSync(`${directory}/result.json`, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
