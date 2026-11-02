// Assemble a reviewable commissioning manifest from real retained evidence. No connection,
// credentials, generation, lock acquisition or fabricated qualification is involved.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { proof: { type: "string" }, out: { type: "string" } } });
assert(values.proof && values.out, "Use --proof <passing Lane B result.json> --out <new manifest.json>");
const proofPath = resolve(values.proof), out = resolve(values.out);
const proof = JSON.parse(readFileSync(proofPath, "utf8"));
assert.equal(proof.status, "pass"); assert.match(proof.sourceCommit, /^[a-f0-9]{40}$/);
const git = (...args) => execFileSync("git", args, { windowsHide: true });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
for (const [path, expected] of Object.entries(proof.sourceHashes)) assert.equal(sha(readFileSync(path)), expected, `Source differs from passed proof: ${path}`);
const source = "artifacts/w4-process/2026-11-02T00-02-35-343Z";
const qualification = JSON.parse(readFileSync(`${source}/result.json`, "utf8"));
assert.equal(qualification.sourceCommit, "9e98da72ed667368078922a8a5233b08886a8476");
const implementation = {};
for (const [path, pin] of Object.entries(qualification.implementation)) {
  const blob = git("rev-parse", `${proof.sourceCommit}:${path}`).toString("utf8").trim();
  assert.equal(blob, pin.blob, `Lane A implementation changed: ${path}`);
  assert.equal(sha(git("cat-file", "blob", blob)), pin.blobSha256);
  implementation[path] = { blob, sha256: pin.blobSha256, checkoutSha256: sha(readFileSync(path)) };
}
const reference = path => ({ file: relative(dirname(out), resolve(path)).replaceAll("\\", "/"), sha256: sha(readFileSync(path)) });
const checks = {};
const expectedHashes = { isolation: "5f33de1b52722d6316aa3b2de91bb83b4df5b661b6738aa83f816f56c15336c0",
  recovery: "a0069c7907a60f1e40fa2b9073f932b72d2a4c677395ff3686322bc7819c476b",
  campaignPort: "0020a42a5711ddcdd710e88a679df0d1a233507bc68de9773d2c634d89b2ba41" };
for (const [check, file] of Object.entries({ isolation: "isolation.json", recovery: "recovery.json", campaignPort: "campaign-port.json" })) {
  const path = `${source}/${file}`, evidence = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(evidence.status, "pass"); assert.equal(evidence.scope, "offline-fake-transport");
  assert.equal(evidence.liveTimingQualified, false); assert.equal(evidence.liveRecoveryQualified, false);
  checks[check] = reference(path); assert.equal(checks[check].sha256, expectedHashes[check]);
}
const manifest = { contract: "controlsbench.wonder-process.v1", ownerCommit: proof.sourceCommit,
  module: "src/live/wonder-process/index.ts", implementationCommit: qualification.sourceCommit,
  checks, integrationProof: reference(proofPath), implementation,
  qualification: { scope: "offline-integrated-real-child-fake-transport", purpose: "candidate for separately authorized first live commissioning",
    liveTimingQualified: false, liveRecoveryQualified: false, livePlcExecuted: false,
    establishes: ["Reviewed immutable Lane A implementation", "Source-pinned offline union and production-browser proof", "Original-event host ledger, native provider pairing, controller/world tools and independent child leases"],
    doesNotEstablish: ["Real Wonder adaptive W4 result", "Live timing, native transport teardown or recovery", "A W4 held-state recovery procedure", "New data-transfer/spend authorization"],
    runtimeOwnerReviewRequired: "Read exact evidence scopes, current DUT/lock state, W4 payload and new bounded approval before use. H2 recovery only applies to matching H2 run formats." },
  previousApproval: { W3: "partial", conservativeUsdConsumed: 4, remainingConservativeUsd: 0 } };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ ownerCommit: manifest.ownerCommit, file: out, sha256: sha(readFileSync(out)), scope: manifest.qualification.scope, liveAuthorized: false }));
