import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadFixtureBundle, type FixtureBundle } from "../src/adapters/replay/fixtures.ts";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

let cached: Promise<FixtureBundle> | null = null;

/** Loads the same preserved artifacts the browser replays, straight from the repository. */
export function loadRepoFixtures(): Promise<FixtureBundle> {
  cached ??= loadFixtureBundle((_key, repoPath) => readFile(repoRoot + repoPath, "utf8"));
  return cached;
}
