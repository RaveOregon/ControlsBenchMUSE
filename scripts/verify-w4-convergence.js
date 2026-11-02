// Lane B offline union. Never opens a native PLC transport or calls a model.
import assert from "node:assert/strict";
import { execFileSync, fork, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { auditHmiH2 } from "./audit-hmi-h2.js";
import { commonWonderPaths } from "../src/campaign/wonder-paths.ts";

const directory = `artifacts/w4-convergence/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(directory, { recursive: true });
const environment = { ...process.env };
for (const name of Object.keys(environment)) if (/^(MODEL_|OPC_|CONTROLSBENCH_WONDER_)/.test(name)) delete environment[name];
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
if (!environment.CONTROLSBENCH_HMI_BROWSER && existsSync(chrome)) environment.CONTROLSBENCH_HMI_BROWSER = chrome;
const git = (...args) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
const files = git("ls-files", "--", "src", "ui/src", "ui/test", "test", "scripts", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.portal-check.json", "ui/package.json", "ui/package-lock.json", "ui/tsconfig.json", "ui/vite.config.ts").split(/\r?\n/);
const sha = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const hashes = paths => Object.fromEntries(paths.map(path => [path, sha(path)]));
const sourceHashes = hashes(files), sourceCommit = git("rev-parse", "HEAD");
const frozenPaths = git("ls-files", "--", "codesys", "artifacts/generated-world", "artifacts/machine-view", "artifacts/wonder/checkpoint-2026-11-01T22-10-17-207Z", "artifacts/wonder/checkpoint-2026-11-01T22-14-56-275Z").split(/\r?\n/);
const frozenHashes = hashes(frozenPaths);
const accountPath = commonWonderPaths().session;
const accountHash = existsSync(accountPath) ? sha(accountPath) : null;
const checks = [];
const save = status => writeFileSync(join(directory, "result.json"), JSON.stringify({ status, sourceCommit, sourceHashes, frozenHashes, checks,
  configuration: "external Meta/OPC/Wonder configuration removed; real-response replay additionally denies all Node networking",
  sessionAccount: { sha256: accountHash, modified: false, previousApprovalRemainingUsd: 0 },
  actualModelCalls: 0, actualSpendUsd: 0, plcContacted: false, W3: "partial; no novel post-observation follow-up", W4: "not run; live qualification and new approval required" }, null, 2) + "\n");
function run(name, args) {
  console.log(`Checking ${name}…`);
  const r = spawnSync(process.execPath, args, { env: environment, encoding: "utf8", windowsHide: true, timeout: 600_000, maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(join(directory, `${name}.txt`), (r.stdout ?? "") + (r.stderr ?? "") + (r.error ? String(r.error) : ""));
  checks.push({ name, status: r.status === 0 ? "pass" : "fail", exitCode: r.status }); save("running");
  assert.equal(r.status, 0, `${name} failed; see ${directory}`);
}
async function product(mode) {
  const out = `${directory}/product-${mode}`; mkdirSync(out, { recursive: true });
  const child = fork(resolve("scripts/run-hmi-portal.js"), ["--fixture", "m10-final-held", "--campaign", mode === "recorded" ? "wonder-recorded" : "fixture-adaptive",
    "--portal-port", "0", "--hmi-port", "0", "--hmi-headless", "--artifacts", resolve(out, "service")],
    { env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let url, output = ""; let exited = false;
  const exit = new Promise(resolveExit => child.once("exit", code => { exited = true; resolveExit(code); }));
  for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => {
    appendFileSync(join(out, "service.txt"), bytes); output += bytes;
    url = /ControlsBench portal (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output)?.[1];
  });
  try {
    const began = Date.now();
    while (!url && !exited && Date.now() - began < 45_000) await new Promise(r => setTimeout(r, 100));
    assert(url && !exited, `Own ${mode} composition did not start; see ${out}/service.txt`);
    run(`product-${mode}`, ["scripts/check-product-browser.js", url, "--out", `${out}/browser`]);
  } finally {
    if (!exited && child.connected) child.send({ type: "controlsbench.product.stop" });
    let timer;
    const code = await Promise.race([exit, new Promise(r => { timer = setTimeout(() => r("drain-timeout"), 30_000); })]);
    clearTimeout(timer);
    if (code === "drain-timeout") child.kill(); // Own child only; never search for or kill another lane's process.
    assert.equal(code, 0, `Own ${mode} composition did not drain cleanly`);
    checks.push({ name: `product-${mode}-drain`, status: "pass" });
  }
}
try {
  run("union-convergence", ["scripts/check-m10-convergence.js"]);
  run("network-disabled-real-response-replay", ["--import", "./scripts/lib/network-disabled.js", "--test", "test/wonder-paid-replay.test.ts"]);
  run("wonder-production-browser", ["scripts/check-wonder-portal.js", "--out", `${directory}/wonder-browser`]);
  for (const runId of ["2026-11-01T14-02-24-720Z", "2026-11-01T14-07-10-579Z", "2026-11-01T15-12-23-772Z"]) {
    const audit = auditHmiH2(`artifacts/hmi/h2/${runId}`);
    writeFileSync(join(directory, `h2-${runId}.json`), JSON.stringify(audit, null, 2) + "\n");
    checks.push({ name: `recorded-H2-${runId}`, status: audit.pass ? "pass" : "fail", passedChecks: audit.checks.filter(c => c.pass).length });
    assert(audit.pass, "Recorded H2 audit failed; original evidence was not rewritten");
  }
  await product("preview"); await product("recorded");
  run("representative-offline-artifacts", ["scripts/run-wonder-offline.js"]);
  assert.deepEqual(hashes(files), sourceHashes, "Sources changed during verification");
  assert.deepEqual(hashes(frozenPaths), frozenHashes, "Frozen project/world/view/checkpoint bytes changed");
  assert.equal(existsSync(accountPath) ? sha(accountPath) : null, accountHash, "Shared conservative account changed during offline proof");
  save("pass");
  writeFileSync("artifacts/w4-convergence/latest.json", JSON.stringify({ directory, status: "pass", sourceCommit, actualModelCalls: 0, actualSpendUsd: 0, plcContacted: false }, null, 2) + "\n");
  console.log(`Lane B offline union passed: ${directory}`);
} catch (error) { checks.push({ name: "final", status: "fail", error: String(error) }); save("fail"); throw error; }
