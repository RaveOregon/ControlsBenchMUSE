// Reproducible offline three-lane gate, with source identity and separate logs for each check.
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { m8Preflight } from "../src/host/m8-campaign-factory.ts";

const directory = `artifacts/m10-convergence/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(directory, { recursive: true });
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const env = { ...process.env, ...(process.env.CONTROLSBENCH_HMI_BROWSER || !existsSync(chrome) ? {} : { CONTROLSBENCH_HMI_BROWSER: chrome }) };
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const checks = [
  ["runtime-typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["runtime-tests", pkg.scripts.test.replace(/^node /, "").split(" ")],
  ["view-contract", ["scripts/build-machine-view-contract.js", "--check"]],
  ["view-portal-typecheck", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.portal-check.json"]],
  ["ui-typecheck", ["../node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], "ui"],
  ["ui-tests", ["--test", "test/*.test.ts"], "ui"],
  ["production-build", ["node_modules/vite/bin/vite.js", "build"], "ui"],
  ["preserved-m10-browser", ["scripts/check-m10-portal-view.js", "--out", `${directory}/view`]]
];
const results = [];
for (const [name, args, cwd] of checks) {
  console.log(`Checking ${name}…`);
  // The serial union includes real-child commissioning/recovery cases. Give the test suite
  // eight minutes; individual transport, lease, world-step and test-case deadlines are unchanged.
  const timeout = name === "runtime-tests" ? 480_000 : 180_000;
  const result = spawnSync(process.execPath, args, { cwd: resolve(cwd ?? "."), env, encoding: "utf8", windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(`${directory}/${name}.txt`, `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ?? ""}`);
  results.push({ name, status: result.status, signal: result.signal, passed: result.status === 0,
    ...(name.endsWith("tests") ? { tests: Number(/(?:ℹ |# )tests (\d+)/.exec(result.stdout ?? "")?.[1] ?? 0), passedTests: Number(/(?:ℹ |# )pass (\d+)/.exec(result.stdout ?? "")?.[1] ?? 0) } : {}) });
  if (result.status !== 0) { console.error(`${name} failed: see ${directory}/${name}.txt`); break; }
}
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const sources = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "src/campaign", "src/live", "src/host", "src/machine-view", "ui/src", "ui/test", "test", "scripts", "package.json", "tsconfig.json", "tsconfig.portal-check.json", "ui/package.json", "ui/vite.config.ts", "ui/tsconfig.json", "ui/m10-replay.html"], { encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/).filter(p => existsSync(p));
const status = results.length === checks.length && results.every(r => r.passed) ? "pass" : "fail";
writeFileSync(`${directory}/result.json`, JSON.stringify({ status, atIso: new Date().toISOString(), node: process.version, commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(),
  workingTree: execFileSync("git", ["status", "--short"], { encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/),
  sources: Object.fromEntries(sources.map(p => [p, hash(p)])), browser: env.CONTROLSBENCH_HMI_BROWSER ?? "auto-discovery", results, preflight: m8Preflight(), livePlcExecuted: false, paidCalls: 0 }, null, 2) + "\n");
writeFileSync("artifacts/m10-convergence/latest.json", JSON.stringify({ status, directory }, null, 2) + "\n");
console.log(`${status}: ${directory}`);
process.exitCode = status === "pass" ? 0 : 1;
