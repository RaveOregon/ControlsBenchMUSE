// Re-evaluates a preserved candidate after a host change and promotes it if it now passes.
// No model call. The original generation.json disposition is left untouched; the decision is
// recorded in promotion.json alongside it.
//
//   node scripts/promote-machine-view.js --package <dir> --reason "<why re-evaluated>"
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { jsonText, validatePackage } from "../src/machine-view/package.ts";

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const relative = arg("--package");
const reason = arg("--reason");
if (!relative || !reason) throw new Error("--package and --reason are required");
const dir = resolve(relative);
const files = {};
for (const name of ["view.manifest.json", "equipment.json", "view-bindings.json", "view.svg"]) files[name] = await readFile(join(dir, name), "utf8");
const contract = JSON.parse(await readFile(resolve("artifacts/machine-view/contract/binding-contract.json"), "utf8"));
const worldDir = JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8")).relativeDirectory;
const { report } = await validatePackage({ files, contract, worldManifestText: await readFile(resolve(worldDir, "world.manifest.json"), "utf8") });
const browser = spawnSync(process.execPath, ["scripts/check-machine-view-browser.js", "--package", relative], { encoding: "utf8", timeout: 600_000 });
const audit = spawnSync(process.execPath, ["scripts/audit-machine-view.js", "--package", relative], { encoding: "utf8", timeout: 600_000 });
const browserSummary = JSON.parse(await readFile(join(dir, "browser-check", "browser-check.json"), "utf8"));
const auditResult = JSON.parse(await readFile(join(dir, "audit", "audit.json"), "utf8"));
const generation = JSON.parse(await readFile(join(dir, "generation.json"), "utf8"));
const incumbentRel = JSON.parse(await readFile(resolve("artifacts/machine-view/latest.json"), "utf8")).relativeDirectory;
const incumbentAudit = JSON.parse(await readFile(resolve(incumbentRel, "audit", "audit.json"), "utf8"));
const hostSources = {};
for (const name of ["host.ts", "frame.ts", "audit.ts"]) hostSources[`src/machine-view/${name}`] = createHash("sha256").update(await readFile(resolve("src/machine-view", name), "utf8")).digest("hex");
const promoted = report.viewValid && browserSummary.passed && auditResult.passed && auditResult.counts.error < incumbentAudit.counts.error;
const record = {
  schemaVersion: "controlsbench.machine-view.promotion.v1",
  decidedAt: new Date().toISOString(),
  package: relative,
  packageId: report.packageId,
  originalDisposition: generation.disposition,
  reason,
  modelCalls: 0,
  incumbent: { package: incumbentRel, auditErrors: incumbentAudit.counts.error, auditWarnings: incumbentAudit.counts.warning },
  candidate: { viewValid: report.viewValid, browserCheckPassed: browserSummary.passed, auditErrors: auditResult.counts.error, auditWarnings: auditResult.counts.warning, auditExit: audit.status, browserExit: browser.status },
  hostSources,
  disposition: promoted ? "promoted_after_host_fix" : "not_promoted"
};
await writeFile(join(dir, "promotion.json"), jsonText(record));
if (promoted) await writeFile(resolve("artifacts/machine-view/latest.json"), jsonText({ relativeDirectory: relative, packageId: report.packageId, viewValid: true, contractValid: true, browserCheckPassed: true, parent: generation.parent?.relativeDirectory ?? null, promotion: "promotion.json" }));
console.log(JSON.stringify(record, null, 2));
if (!promoted) process.exit(1);
