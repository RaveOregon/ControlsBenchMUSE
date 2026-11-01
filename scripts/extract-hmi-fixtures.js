// Extracts labelled HMI fixture states from the preserved successful M10 transport trace.
// The output is a fixture for rendering and offline tests, never a live connection state.
//
//   node scripts/extract-hmi-fixtures.js
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const source = "artifacts/m10/2026-11-01T00-58-43-185Z/transport.jsonl.gz";
const bytes = readFileSync(source);
const events = gunzipSync(bytes).toString("utf8").trim().split("\n").map(line => JSON.parse(line));
const reads = events.filter(e => e.kind === "opc.read" && Object.keys(e.samples).length > 50);
const valuesOf = read => Object.fromEntries(Object.entries(read.samples).map(([path, s]) => [path, s.value]));
const pick = (label, predicate) => {
  const read = reads.find(r => predicate(valuesOf(r)));
  if (!read) throw new Error(`No recorded read for ${label}`);
  return read;
};
// Retained write-group values as last written before each chosen read (the trace records writes, not their readback).
const writesBefore = atIso => {
  const last = {};
  for (const e of events) if (e.kind === "opc.write" && e.atIso <= atIso) for (const item of e.items) if (!/Slot[01]_/.test(item.path)) last[item.path] = item.value;
  return last;
};
const state = (id, title, description, read) => ({ id, title, description, recordedAtIso: read.atIso,
  samples: read.samples, writeGroup: writesBefore(read.atIso) });

const fixtures = {
  schemaVersion: 1,
  label: "FIXTURE — recorded M10 samples replayed without a PLC",
  source: { file: source, sha256: createHash("sha256").update(bytes).digest("hex"), run: "M10 deterministic live campaign 2026-11-01T00:58:43Z" },
  note: "Each state is one recorded 72-field M10 controller read plus the last values written to the operator/WCS/bench request groups before it. Fields the M10 runner did not read are filled by the fixture transport and labelled 'fixture default'.",
  states: [
    state("m10-final-held", "M10 final held state", "End of the failed-divert scenario: fault 23 latched, completion 7 pending, carton on the D1 approach beam, simulation selected.", reads.at(-1)),
    state("m10-sorting-a", "Sorting item 101 to A", "Auto, belt running, D1 commanded and extended for item 101/A.", pick("sorting", v => v["GVL_DemoRead.Status.Mode"] === 1 && v["GVL_BenchRead.D1_ExtendCmd"] === true && v["GVL_BenchRead.Active_D1_ExtendedFB"] === true && v["GVL_DemoRead.Status.ActiveItemId"] === 101)),
    state("m10-stopped-ready", "Stopped, ready", "Stopped with no fault, no carton and no pending completion, before the A scenario.", pick("stopped", v => v["GVL_DemoRead.Status.Mode"] === 0 && v["GVL_DemoRead.Status.FaultCode"] === 0 && v["GVL_DemoRead.Status.ItemActive"] === false && v["GVL_DemoRead.Status.CompletionPending"] === false))
  ]
};
mkdirSync("test/fixtures/hmi", { recursive: true });
writeFileSync("test/fixtures/hmi/m10-recorded-states.json", JSON.stringify(fixtures, null, 2) + "\n");
console.log(fixtures.states.map(s => `${s.id} @ ${s.recordedAtIso}`).join("\n"));
