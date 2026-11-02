// Read-only review of Lane A's pinned sources, artifacts and sample ledger chains.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const owner = resolve(process.argv[2] ?? "../../.claude/worktrees/w4-process-adapter");
const pin = "9e98da72ed667368078922a8a5233b08886a8476";
const folder = "artifacts/w4-process/2026-11-02T00-02-35-343Z";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const reportBytes = readFileSync(join(owner, folder, "result.json"));
assert.equal(sha(reportBytes), "cbacff21be5afd9cddb7fb3c0c1e9d902d484351f7beac029353fe2daea95fe7");
const report = JSON.parse(reportBytes);
assert.equal(report.sourceCommit, pin);
const git = (...args) => execFileSync("git", ["-C", owner, ...args], { windowsHide: true, stdio: "pipe" });
const verified = {};
for (const [group, sources] of Object.entries({ implementation: report.implementation, dependencies: report.dependencies })) {
  for (const [file, identity] of Object.entries(sources)) {
    assert.equal(git("rev-parse", `${pin}:${file}`).toString().trim(), identity.blob, file);
    assert.equal(sha(git("cat-file", "blob", identity.blob)), identity.blobSha256, file);
    assert.equal(sha(readFileSync(join(owner, file))), identity.checkoutSha256, file);
  }
  verified[group] = Object.keys(sources).length;
}
const evidence = [];
for (const [check, reference] of Object.entries(report.checks)) {
  const bytes = readFileSync(join(owner, folder, reference.file));
  assert.equal(sha(bytes), reference.sha256, reference.file);
  const proof = JSON.parse(bytes);
  assert.equal(proof.status, "pass");
  assert.equal(proof.sourceCommit, pin);
  assert.equal(proof.scope, "offline-fake-transport");
  assert.equal(proof.liveTimingQualified, false);
  assert.equal(proof.liveRecoveryQualified, false);
  assert.equal(proof.plcContacted, false);
  evidence.push({ check, file: reference.file, sha256: reference.sha256, scope: proof.scope });
}
const { readLedger, replay } = await import(pathToFileURL(join(owner, "src/campaign/ledger.ts")).href);
const ledgers = [];
for (const sample of report.samples) {
  const file = join(owner, folder, sample, "campaign.jsonl");
  const events = readLedger(file);
  const projection = replay(events);
  assert.equal(projection.sequence, events.length);
  ledgers.push({ sample, events: events.length, evidenceClass: projection.evidenceClass, sha256: sha(readFileSync(file)) });
}
const out = "artifacts/w4-lane-a-review/9e98da7";
mkdirSync(out, { recursive: true });
const result = { status: "pass", implementationPin: pin, ...verified, evidence, ledgers,
  scope: "source_and_evidence_integrity_review", liveTimingQualified: false, liveRecoveryQualified: false,
  plcContacted: false, paidCalls: 0 };
writeFileSync(`${out}/integrity.json`, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
