import { mkdirSync, writeFileSync } from "node:fs";
import { createHarness, driveHarness } from "../src/campaign/harness.ts";
import { CampaignLedger, replay } from "../src/campaign/ledger.ts";
import { preservedM7Runtime } from "../src/campaign/m7-replay.ts";
import assert from "node:assert/strict";

const directory = `artifacts/m9/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(directory, { recursive: true });
const results = [];
for (const adaptive of [false, true]) {
  const name = adaptive ? "adaptive" : "normal";
  const h = await createHarness({ adaptive, id: `m9-${name}`, file: `${directory}/${name}.jsonl` });
  await driveHarness(h); assert.equal(h.runtime.status, "completed"); assert.deepEqual(replay(h.ledger.events), h.ledger.state);
  writeFileSync(`${directory}/${name}-report.json`, JSON.stringify(h.runtime.getReport(), null, 2) + "\n"); h.ledger.close();
  results.push({ name, status: "pass", eventCount: h.ledger.events.length, evidenceClass: "fake_connector" });
}
const ledger = new CampaignLedger("m9-m7", { file: `${directory}/m7.jsonl` });
const runtime = preservedM7Runtime(ledger); await runtime.start(false); await runtime.runAgent(); await runtime.stop();
assert.equal(runtime.status, "completed");
writeFileSync(`${directory}/m7-report.json`, JSON.stringify(runtime.getReport(), null, 2) + "\n"); ledger.close();
results.push({ name: "preserved-m7", status: "pass", acknowledgements: ledger.events.filter(e => e.type === "plc.acknowledged").length, evidenceClass: "preserved_live_plc" });
const result = { schemaVersion: 1, status: "pass", directory, results, paidCalls: 0,
  claimBoundary: "M9 deterministic runtime and historical M7 evidence review only. No final conveyor controller coverage.", M9_F: "not_run_requires_explicit_paid_authorization" };
writeFileSync(`${directory}/result.json`, JSON.stringify(result, null, 2) + "\n");
writeFileSync("artifacts/m9/latest.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
