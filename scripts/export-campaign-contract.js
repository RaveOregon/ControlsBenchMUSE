import { mkdirSync, writeFileSync } from "node:fs";
import { campaignEventSchema, decisionSchema, eventSchemas, toolSchemas, CAMPAIGN_VERSION } from "../src/campaign/contracts.ts";
import { createHarness, driveHarness } from "../src/campaign/harness.ts";

const write = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
mkdirSync("docs/contracts", { recursive: true }); mkdirSync("test/fixtures", { recursive: true });
write("docs/contracts/campaign-v1.schema.json", { $schema: "https://json-schema.org/draft/2020-12/schema", $id: "urn:controlsbench:campaign:v1", ...campaignEventSchema });
write("docs/contracts/campaign-tools-v1.schema.json", { schemaVersion: CAMPAIGN_VERSION, decision: decisionSchema, tools: toolSchemas });
function example(s) {
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  if (type === "object") return Object.fromEntries(Object.entries(s.properties ?? {}).map(([key, schema]) => [key, example(schema)]));
  if (type === "array") return Array.from({ length: s.minItems ?? 0 }, () => example(s.items));
  if (type === "boolean") return false;
  if (type === "number" || type === "integer") return s.minimum ?? 0;
  if (type === "string") return "example";
  return null;
}
write("test/fixtures/campaign-contract-examples.json", Object.fromEntries(Object.entries(eventSchemas).map(([type, schema]) => [type, example(schema)])));
// Golden regeneration is deliberately separate from normal tests.
if (process.argv.includes("--update-golden")) {
  const h = await createHarness({ id: "golden-campaign" }); await driveHarness(h);
  writeFileSync("test/fixtures/campaign-golden.jsonl", h.ledger.events.map(e => JSON.stringify(e)).join("\n") + "\n");
  write("test/fixtures/campaign-golden-projection.json", h.ledger.state);
}
console.log("Exported campaign v1 contracts and examples");
