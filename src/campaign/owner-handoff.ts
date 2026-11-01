import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Pinned owner artifacts, not unverified capability booleans. No model or PLC access. */
export function verifyOwnerHandoff(path: string, sha256: string, ownerCommit: string) {
  if (!/^[a-f0-9]{64}$/.test(sha256) || !/^[a-f0-9]{40}$/.test(ownerCommit)) throw new Error("Full owner commit and handoff SHA-256 are required");
  const bytes = readFileSync(path);
  const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
  if (hash(bytes) !== sha256) throw new Error("Owner handoff hash mismatch");
  const handoff = JSON.parse(bytes.toString("utf8"));
  if (handoff.contract !== "controlsbench.wonder-process.v1" || handoff.ownerCommit !== ownerCommit) throw new Error("Owner handoff contract/commit mismatch");
  for (const check of ["isolation", "recovery", "campaignPort"]) {
    const ref = handoff.checks?.[check];
    if (!ref || typeof ref.file !== "string" || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw new Error(`Missing pinned ${check} evidence`);
    const evidence = readFileSync(resolve(dirname(path), ref.file));
    if (hash(evidence) !== ref.sha256 || JSON.parse(evidence.toString("utf8")).status !== "pass") throw new Error(`${check} evidence is changed or not passing`);
  }
  return { evidenceRef: `sha256:${sha256}`, ownerCommit };
}
