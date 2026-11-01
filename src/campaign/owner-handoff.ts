import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

/** Resolve and attest the actual entry before import, even outside src/scripts. */
export function verifyOwnerEntry(modulePath: string, ownerCommit: string) {
  if (!/^[a-f0-9]{40}$/.test(ownerCommit)) throw new Error("Full owner commit is required");
  const requested = resolve(modulePath), entryPath = realpathSync(requested);
  const samePath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!lstatSync(requested).isFile() || !samePath(requested, entryPath)) throw new Error("Owner entry redirects through a symlink/junction");
  const git = (...args: string[]) => execFileSync("git", ["-C", dirname(entryPath), ...args], { windowsHide: true });
  const ownerRoot = realpathSync(git("rev-parse", "--show-toplevel").toString("utf8").trim());
  const path = relative(ownerRoot, entryPath);
  if (!path || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) throw new Error("Owner entry is outside the pinned checkout");
  const entryRelative = path.replaceAll("\\", "/");
  if (git("rev-parse", "HEAD").toString("utf8").trim() !== ownerCommit) throw new Error("Owner adapter checkout differs from pinned commit");
  const tree = execFileSync("git", ["-C", ownerRoot, "ls-tree", "-z", ownerCommit, "--", entryRelative], { windowsHide: true }).toString("utf8");
  const record = /^(100644|100755) blob ([a-f0-9]{40,64})\t([^\0]+)\0$/.exec(tree);
  if (!record || record[3] !== entryRelative) throw new Error("Owner entry is not a tracked regular file at the pinned commit");
  const pinnedBytes = git("cat-file", "blob", record[2]!);
  const actualBytes = readFileSync(entryPath);
  if (!pinnedBytes.equals(actualBytes)) throw new Error("Owner entry bytes differ from pinned commit; preserve entry bytes with Git attributes");
  const codeChanges = execFileSync("git", ["-C", ownerRoot, "status", "--porcelain", "--", "src", "scripts"], { encoding: "utf8", windowsHide: true }).trim();
  if (codeChanges) throw new Error("Owner src/scripts differ from pinned commit");
  return { ownerRoot, entryPath, entryRelative, entryBlob: record[2]!, entrySha256: createHash("sha256").update(actualBytes).digest("hex") };
}

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
