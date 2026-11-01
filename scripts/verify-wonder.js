import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const directory = `artifacts/wonder-verification/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(directory, { recursive: true });
const environment = { ...process.env };
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!environment.CONTROLSBENCH_HMI_BROWSER && existsSync(chrome)) environment.CONTROLSBENCH_HMI_BROWSER = chrome;
const checks = [];
const sourcePaths = ["package.json", "tsconfig.json", ...["src", "test", "scripts"].flatMap(dir => readdirSync(dir, { recursive: true }).filter(p => /\.(ts|js)$/.test(String(p))).map(p => `${dir}/${String(p).replaceAll("\\", "/")}`))];
const sourceHashes = () => Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const sources = sourceHashes(), sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
function run(name, args) {
  console.log(`Checking ${name}…`);
  const result = spawnSync(process.execPath, args, { encoding: "utf8", env: environment, windowsHide: true, timeout: 300_000 });
  writeFileSync(join(directory, `${name}.log`), (result.stdout ?? "") + (result.stderr ?? ""));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  checks.push({ name, status: result.status === 0 ? "pass" : "fail", exitCode: result.status, ...(result.error ? { error: result.error.message } : {}) });
  writeFileSync(join(directory, "result.json"), JSON.stringify({ status: checks.every(c => c.status === "pass") ? "pass" : "fail", checks, sourceCommit, sourceHashes: sources, actualModelCalls: 0, actualSpendUsd: 0, plcContacted: false }, null, 2) + "\n");
  if (result.status !== 0) throw new Error(`${name} failed; see ${directory}`);
}
run("typecheck", [fileURLToPath(new URL("bin/tsc", import.meta.resolve("typescript/package.json"))), "--noEmit"]);
run("tests", ["--test", "--test-concurrency=1", ...readdirSync("test").filter(f => f.endsWith(".test.ts")).map(f => `test/${f}`)]);
run("offline-artifacts", ["scripts/run-wonder-offline.js"]);
if (JSON.stringify(sources) !== JSON.stringify(sourceHashes())) throw new Error("Source changed during verification; rerun the gate");
writeFileSync("artifacts/wonder-verification/latest.json", JSON.stringify({ directory, status: "pass", sourceCommit, actualModelCalls: 0, actualSpendUsd: 0 }, null, 2) + "\n");
console.log(`Verified offline Wonder gates: ${directory}. No paid model or PLC calls.`);
