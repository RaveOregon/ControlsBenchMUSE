import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function commonWonderPaths() {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8", windowsHide: true }).trim();
  const root = dirname(common);
  return { root, session: join(root, "artifacts/wonder/session.jsonl"), ownership: join(root, "artifacts/m10/live.lock") };
}
