// Offline evidence for the isolated Wonder process adapter (controlsbench.wonder-process.v1).
// Runs the real-child tests and the typecheck against a clean checkout, then writes per-check
// results whose scope is explicitly OFFLINE (fake M8 transport). These files do not qualify live
// M8 timing or recovery; the runtime owner reviews scope before citing them in a W4 manifest.
// No PLC, credential, model or network access.
//   node scripts/run-wonder-process-proof.js
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const directory = `artifacts/w4-process/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(directory, { recursive: true });
const git = (...args) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
const gitBytes = (...args) => execFileSync("git", args, { windowsHide: true });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceCommit = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain", "--", "src", "scripts", "test", "package.json", "tsconfig.json");
const implementation = git("ls-files", "--", "src/live/wonder-process", "scripts/wonder-process-child.js", "scripts/run-wonder-process-proof.js",
  "test/wonder-process.test.ts", "test/fixtures/wonder-process-transport.ts", "test/fixtures/wonder-process-parent.ts").split(/\r?\n/).filter(Boolean);
// Code and data the adapter executes but does not own: unchanged by this lane, pinned here by blob.
const dependencies = ["src/live/coordinator.ts", "src/live/connector.ts", "src/live/m8-opcua.ts", "src/live/m8-map.ts", "src/live/m8-native-transport.ts",
  "src/proof/world-context.ts", "src/campaign/clock.ts", "src/campaign/live-evidence.ts", "src/campaign/ledger.ts", "src/campaign/contracts.ts", "src/campaign/driver.ts",
  "src/campaign/process-port.ts", "src/campaign/runtime.ts", "src/campaign/owner-handoff.ts", "src/campaign/m8-bindings.ts", "src/campaign/conveyor-bindings.ts",
  "src/campaign/wonder-paths.ts", "src/host/m8-campaign-factory.ts", "src/host/wonder-campaign-factory.ts", "test/fixtures/m8-protocol-transport.ts",
  "artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts", "codesys/conveyordemo.project", "codesys/demo/signal-map-v1.json", "docs/conveyor-machine-spec.md"];
const identity = path => {
  const blob = git("rev-parse", `${sourceCommit}:${path}`);
  return { blob, blobSha256: sha(gitBytes("cat-file", "blob", blob)), checkoutSha256: existsSync(path) ? sha(readFileSync(path)) : null };
};

console.log("Checking typecheck…");
const typecheck = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"], { encoding: "utf8", windowsHide: true, timeout: 180_000 });
writeFileSync(join(directory, "typecheck.txt"), `${typecheck.stdout ?? ""}${typecheck.stderr ?? ""}`);
console.log("Running real-child tests…");
const tests = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap", `--test-reporter-destination=${join(directory, "tests.tap")}`,
  "--test-reporter=spec", `--test-reporter-destination=${join(directory, "tests.txt")}`, "test/wonder-process.test.ts"],
  { encoding: "utf8", windowsHide: true, timeout: 300_000, env: { ...process.env, WONDER_PROCESS_EVIDENCE: directory } });
const tap = existsSync(join(directory, "tests.tap")) ? readFileSync(join(directory, "tests.tap"), "utf8") : "";
const results = [...tap.matchAll(/^(ok|not ok) \d+ - (.+)$/gm)].map(m => ({ name: m[2].trim(), passed: m[1] === "ok" }));
const measurements = existsSync(join(directory, "measurements.jsonl")) ? readFileSync(join(directory, "measurements.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l)) : [];

const offline = { scope: "offline-fake-transport", transport: "test/fixtures/wonder-process-transport.ts (protocol fixture, not an M8 behavior oracle)",
  realChildProcess: true, livePlcExecuted: false, plcContacted: false, credentialsUsed: false, paidCalls: 0, networkCalls: 0,
  liveTimingQualified: false, liveRecoveryQualified: false };
const checks = {
  isolation: { measures: ["parent-stall", "hold-lease", "condition-lease", "factory-campaign"], tests: ["construction is read-only", "parent event-loop stall", "hold lease", "condition/deadline lease", "parent silence", "source stream", "provider campaign through the Wonder factory"],
    establishes: ["World time, the 10 Hz cadence, interventions and reasoning leases run in a separate child process on its own monotonic clock",
      "A 1.5 s parent event-loop stall does not delay child commits (max gap measured) or extend a lease; expiry holds the world during the stall",
      "Hold/continue/condition-deadline leases return terminal evidence-backed receipts; held commits show PLC scan counters continuing",
      "Ordered, gap-checked, de-duplicated source stream into the single host ledger; gaps/reorders/conflicts quarantine without ingestion",
      "Construction is read-only; the child reports the world bytes it actually loaded"],
    doesNotEstablish: ["Live M8 cadence/latency under portal, HMI capture and model load", "Windows scheduling margin on the bench machine with a real OPC UA session"] },
  recovery: { measures: ["parent-loss-steady", "parent-loss-hang", "delayed-write"], tests: ["child exit", "parent loss (steady)", "parent loss (hang)", "delayed write", "stop drains and closes", "cancellation"],
    establishes: ["Child exit quarantines the driver, holds the runtime and retains ownership for explicit reconciliation",
      "Parent loss freezes world time, drains bounded work and closes the session; ownership is released only when nothing is uncertain",
      "A timed-out write stays uncertain, refuses every later write, and its late settlement is recorded; no retry, reset or passthrough",
      "Stop drains and closes without passthrough; reset commits a zero image with simulation held; exit observes passthrough",
      "A pending control is withdrawn before any world change; an in-flight controller request is reported, never undone"],
    doesNotEstablish: ["Live PLC recovery from a held/faulted M8 state (no recovery procedure is part of this adapter)",
      "Real OPC UA write timeout/settlement behavior and ConnectorStale watchdog timing on the PLC",
      "Native-module session teardown after parent loss on the bench machine"] },
  campaignPort: { measures: ["factory-campaign", "hold-lease", "condition-lease"], tests: ["provider campaign through the Wonder factory", "stale campaign/boundary revisions", "hold lease", "condition/deadline lease", "cancellation", "construction is read-only"],
    establishes: ["createWonderSession contract (IsolatedWonderSession) accepted by the existing Wonder factory with the exact host ledger and HMI object",
      "Original action IDs, originating campaign revision and child boundary revision travel to the child; stale/duplicate requests are refused without replay",
      "Every child source record reaches the host ledger once, in order, and derived plc.output/raw image/acknowledgement match it exactly"],
    doesNotEstablish: ["A live Wonder-directed campaign, its spend or its adaptive follow-up", "The reviewed W4 manifest (assembled by the runtime owner from this pin)"] }
};
const clean = !dirty, typecheckPassed = typecheck.status === 0, testsPassed = tests.status === 0 && results.length > 0 && results.every(r => r.passed);
const files = {};
for (const [name, check] of Object.entries(checks)) {
  const matched = check.tests.map(prefix => ({ prefix, results: results.filter(r => r.name.startsWith(prefix)) }));
  const passed = clean && typecheckPassed && matched.every(m => m.results.length && m.results.every(r => r.passed));
  const file = `${name === "campaignPort" ? "campaign-port" : name}.json`;
  writeFileSync(join(directory, file), JSON.stringify({ status: passed ? "pass" : "fail", check: name, contract: "controlsbench.wonder-process.v1", sourceCommit, clean,
    ...offline, tests: matched.flatMap(m => m.results.length ? m.results : [{ name: `${m.prefix} (missing)`, passed: false }]),
    establishes: check.establishes, doesNotEstablish: check.doesNotEstablish,
    measurements: measurements.filter(m => check.measures.includes(m.test)),
    note: "Offline scope only. Citing this file in a live W4 manifest is a runtime-owner decision; it is not live timing or recovery qualification." }, null, 2) + "\n");
  files[name] = { file, sha256: sha(readFileSync(join(directory, file))), status: passed ? "pass" : "fail" };
}
const status = clean && typecheckPassed && testsPassed ? "pass" : "fail";
writeFileSync(join(directory, "result.json"), JSON.stringify({ status, contract: "controlsbench.wonder-process.v1", wire: "controlsbench.wonder-process.wire.v1",
  atIso: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, sourceCommit, clean, dirty: dirty ? dirty.split(/\r?\n/) : [],
  entry: "src/live/wonder-process/index.ts", export: "createWonderSession", ...offline,
  typecheck: { passed: typecheckPassed, status: typecheck.status }, tests: { file: "test/wonder-process.test.ts", total: results.length, passed: results.filter(r => r.passed).length, results },
  checks: files, measurements, samples: existsSync(join(directory, "samples")) ? ["samples/factory-campaign", "samples/parent-stall"] : [],
  implementation: Object.fromEntries(implementation.map(p => [p, identity(p)])), dependencies: Object.fromEntries(dependencies.map(p => [p, identity(p)])) }, null, 2) + "\n");
writeFileSync("artifacts/w4-process/latest.json", JSON.stringify({ status, directory, sourceCommit }, null, 2) + "\n");
console.log(`${status}: ${directory} (${results.filter(r => r.passed).length}/${results.length} tests, typecheck ${typecheckPassed ? "pass" : "fail"}, clean ${clean})`);
process.exitCode = status === "pass" ? 0 : 1;
