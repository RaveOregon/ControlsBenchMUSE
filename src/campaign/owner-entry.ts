import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

/** Check the actual imported file, including entries outside src/scripts and symlink targets. */
export function verifyOwnerEntry(modulePath: string, pin: string) {
  const entry = realpathSync(resolve(modulePath));
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", windowsHide: true, stdio: "pipe" }).trim();
  const ownerRoot = realpathSync(git("-C", dirname(entry), "rev-parse", "--show-toplevel"));
  const entryPath = relative(ownerRoot, entry).split(sep).join("/");
  if (!entryPath || entryPath === ".." || entryPath.startsWith("../")) throw new Error("Owner entry must belong to its pinned checkout");
  if (git("-C", ownerRoot, "rev-parse", "HEAD") !== pin) throw new Error("Owner adapter checkout must match its pinned commit");
  const tracked = git("-C", ownerRoot, "ls-files", "--error-unmatch", "--", entryPath);
  if (tracked !== entryPath) throw new Error("Owner adapter entry must be tracked at its pinned path");
  const expected = git("-C", ownerRoot, "rev-parse", `${pin}:${entryPath}`);
  // Git's declared clean conversion handles checked-out LF/CRLF without rewriting evidence.
  const actual = git("-C", ownerRoot, "hash-object", `--path=${entryPath}`, entry);
  if (actual !== expected) throw new Error("Owner adapter entry differs from its pinned commit");
  const changes = git("-C", ownerRoot, "status", "--porcelain", "--", "src", "scripts", entryPath);
  if (changes) throw new Error("Owner adapter checkout must have unchanged src/scripts and entry");
  return { entry, ownerRoot, entryPath, gitBlob: actual, sha256: createHash("sha256").update(readFileSync(entry)).digest("hex") };
}
