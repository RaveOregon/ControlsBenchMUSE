// Offline evidence for the W4 zero-model commissioning harness and the W4 held-state recovery
// (controlsbench.w4-commissioning.v1 / controlsbench.w4-recovery.v1). Runs the typecheck and
// test/w4-commissioning.test.ts against a clean checkout and writes results whose scope is explicitly
// OFFLINE (bench fixture with scripted reactions). They do not qualify live M8 timing, the live
// commissioning stage or any live recovery. No PLC, credential, model or network access.
//   node scripts/run-w4-commissioning-proof.js
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

// Final application integration. Readiness changes are confined to the commissioning tools/tests
// and the npm test registration; the already-qualified PLC/world/adapter/runtime remain unchanged.
const base = "80a8019";
const directory = `artifacts/w4-commissioning/offline-proof/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(directory, { recursive: true });
const git = (...args) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
const gitBytes = (...args) => execFileSync("git", args, { windowsHide: true });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceCommit = git("rev-parse", "HEAD"), baseCommit = git("rev-parse", base);
const dirty = git("status", "--porcelain", "--", "src", "scripts", "test", "package.json", "tsconfig.json");
const changed = git("diff", "--name-status", baseCommit, sourceCommit).split(/\r?\n/).filter(Boolean).map(l => l.split("\t"));
const implementation = ["scripts/lib/w4-commissioning.ts", "scripts/run-w4-commissioning.js", "scripts/recover-w4-held.js", "scripts/run-w4-commissioning.ps1",
  "scripts/run-w4-commissioning-proof.js", "test/w4-commissioning.test.ts", "test/fixtures/w4-bench-transport.ts"];
// Executed but not owned here: the integrated adapter, runtime and connector at the base commit, pinned by blob.
const dependencies = ["src/live/wonder-process/index.ts", "src/live/wonder-process/session.ts", "src/live/wonder-process/driver.ts", "src/live/wonder-process/engine.ts",
  "src/live/wonder-process/channel.ts", "src/live/wonder-process/write-gate.ts", "src/live/wonder-process/ownership.ts", "src/live/wonder-process/protocol.ts",
  "scripts/wonder-process-child.js", "src/live/m8-opcua.ts", "src/live/m8-map.ts", "src/live/m8-native-transport.ts", "src/live/coordinator.ts", "src/campaign/runtime.ts",
  "src/campaign/ledger.ts", "src/campaign/process-port.ts", "src/campaign/contracts.ts", "src/campaign/owner-handoff.ts", "src/host/m8-campaign-factory.ts",
  "test/fixtures/wonder-process-transport.ts", "test/fixtures/m8-protocol-transport.ts", "codesys/conveyordemo.project", "codesys/demo/signal-map-v1.json",
  "artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts"];
const identity = path => {
  const blob = git("rev-parse", `${sourceCommit}:${path}`);
  return { blob, blobSha256: sha(gitBytes("cat-file", "blob", blob)), checkoutSha256: existsSync(path) ? sha(readFileSync(path)) : null };
};

console.log("Checking typecheck…");
const typecheck = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"], { encoding: "utf8", windowsHide: true, timeout: 180_000 });
writeFileSync(join(directory, "typecheck.txt"), `${typecheck.stdout ?? ""}${typecheck.stderr ?? ""}`);
console.log("Running commissioning/recovery tests…");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^OPC_|KEY|TOKEN|SECRET|PASSWORD|^CONTROLSBENCH_WONDER/i.test(k)));
const tests = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap", `--test-reporter-destination=${join(directory, "tests.tap")}`,
  "--test-reporter=spec", `--test-reporter-destination=${join(directory, "tests.txt")}`, "test/w4-commissioning.test.ts"],
  { encoding: "utf8", windowsHide: true, timeout: 600_000, env: { ...env, W4_COMMISSIONING_EVIDENCE: directory } });
const tap = existsSync(join(directory, "tests.tap")) ? readFileSync(join(directory, "tests.tap"), "utf8") : "";
const results = [...tap.matchAll(/^(ok|not ok) \d+ - (.+)$/gm)].map(m => ({ name: m[2].trim(), passed: m[1] === "ok" }));

// Compress large sample journals; keep both hashes so the original bytes stay verifiable.
const samples = {};
const walk = dir => existsSync(dir) ? readdirSync(dir).flatMap(f => statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]) : [];
for (const file of walk(join(directory, "samples"))) {
  const bytes = readFileSync(file), rel = relative(directory, file).replaceAll("\\", "/");
  if (bytes.length > 256 * 1024) { writeFileSync(`${file}.gz`, gzipSync(bytes)); unlinkSync(file); samples[rel] = { sha256: sha(bytes), gz: `${rel}.gz`, gzSha256: sha(readFileSync(`${file}.gz`)) }; }
  else samples[rel] = { sha256: sha(bytes) };
}
const clean = !dirty, typecheckPassed = typecheck.status === 0, testsPassed = tests.status === 0 && results.length > 0 && results.every(r => r.passed);
const readinessPaths = new Set([...implementation, "artifacts/w4-commissioning/.gitattributes", "package.json", "scripts/check-m10-convergence.js"]);
const boundaryPreserved = changed.every(([status, path]) => status === "A" || readinessPaths.has(path));
const status = clean && typecheckPassed && testsPassed && boundaryPreserved ? "pass" : "fail";
writeFileSync(join(directory, "result.json"), JSON.stringify({ status, contracts: ["controlsbench.w4-commissioning.v1", "controlsbench.w4-held-state.v1", "controlsbench.w4-recovery.v1"],
  atIso: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, sourceCommit, baseCommit, clean, dirty: dirty ? dirty.split(/\r?\n/) : [],
  scope: "offline-fake-transport", fixture: "test/fixtures/w4-bench-transport.ts (protocol fixture with hand-written scripted reactions; not an M8 behavior oracle)",
  realChildProcess: true, realRuntime: true, livePlcExecuted: false, plcContacted: false, credentialsUsed: false, modelCalls: 0, paidCalls: 0, networkCalls: 0,
  liveCommissioningQualified: false, liveRecoveryQualified: false,
  boundary: { boundaryPreserved, changedSinceBase: changed.map(([s, p]) => `${s} ${p}`), note: "Existing-source changes confined to commissioning tools/tests and npm registration; B adapter, runtime, PLC and world unchanged" },
  typecheck: { passed: typecheckPassed, status: typecheck.status }, tests: { file: "test/w4-commissioning.test.ts", total: results.length, passed: results.filter(r => r.passed).length, results },
  establishes: ["The zero-model harness drives the real CampaignRuntime and isolated child through preconditions, read-only baseline, normal sort, six lease cases (incl. expiry under a 1.5 s parent stall), a declared overload fault and clean shutdown, and verifies the final state read-only",
    "Refusal before any PLC write: held lock, unclean baseline, live-mode test hooks, missing live pins",
    "A run that stops after writing records held-state.json: exact applied image, boot, epoch, sequence, in-flight commit/commands, uncertain writes, item/completion state, ownership and evidence hashes",
    "recover-w4-held.js reads through a write-refusing gate, refuses every changed precondition (boot, epoch/sequence, image, counters, fault, lock, record hash, authorization) with zero writes, and runs only the recorded H2 write sequence after re-checking in the same connection",
    "Uncertain writes are resolved by observation; a late in-flight commit whose controller reaction the run never observed is refused; a dead run's retained lock is adopted only by nonce with no live child/host and restored byte-for-byte after inspection"],
  doesNotEstablish: ["Live M8 commissioning (native session, 10 Hz cadence under portal/HMI load, real lease timing)", "Live behavior of any recorded reconciliation path on a W4-held state",
    "That the fixture's scripted reactions match M8 (they are not an oracle)", "A Wonder decision, investigation, paid call or W4 pass"],
  samples, implementation: Object.fromEntries(implementation.map(p => [p, identity(p)])), dependencies: Object.fromEntries(dependencies.map(p => [p, identity(p)])),
  note: "Offline scope only. Live qualification needs D's zero-model commissioning run on the bench (scripts/run-w4-commissioning.ps1 -Run)." }, null, 2) + "\n");
writeFileSync("artifacts/w4-commissioning/offline-proof/latest.json", JSON.stringify({ status, directory, sourceCommit }, null, 2) + "\n");
console.log(`${status}: ${directory} (${results.filter(r => r.passed).length}/${results.length} tests, typecheck ${typecheckPassed ? "pass" : "fail"}, clean ${clean}, boundary preserved ${boundaryPreserved})`);
process.exitCode = status === "pass" ? 0 : 1;
