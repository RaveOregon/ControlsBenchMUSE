// Active project selection. Activation names an exact validated version and records the hashes
// of its specification, I/O, world and manifest. Using the selection re-verifies those bytes; a
// mismatch blocks rather than falling back to the prepared example.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Review } from "./preparation.ts";
import { EXAMPLE_PROJECT_ID, PROJECT_SCHEMA, ProjectError, exampleFiles, type ActiveSelection, type ProjectStore } from "./store.ts";

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

export interface SelectionFiles { world: string; spec: string; manifest: string; review?: string; versionDir?: string }
export function selectionFiles(store: ProjectStore, s: Pick<ActiveSelection, "projectId" | "version" | "worldPath">): SelectionFiles {
  if (s.projectId === EXAMPLE_PROJECT_ID) return { world: exampleFiles.world, spec: exampleFiles.spec, manifest: exampleFiles.manifest };
  const record = store.version(s.projectId, s.version);
  if (!record.package) throw new ProjectError(409, "Selected version has no validated package");
  const dir = store.versionDir(s.projectId, s.version);
  return { world: join(dir, record.package.directory, "world.ts"), manifest: join(dir, record.package.directory, "world.manifest.json"),
    spec: join(dir, record.inputs.spec.file), review: join(dir, "review.json"), versionDir: dir };
}
export function readReview(store: ProjectStore, projectId: string, version: string): Review | undefined {
  if (projectId === EXAMPLE_PROJECT_ID) return undefined;
  const file = join(store.versionDir(projectId, version), "review.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Review : undefined;
}

/** Explains why a version cannot be activated, or undefined when it can. */
export function activationBlock(store: ProjectStore, projectId: string, version: string): string | undefined {
  if (projectId === EXAMPLE_PROJECT_ID) return undefined;
  const record = store.version(projectId, version);
  if (record.status !== "ready") return record.status === "needs_information" ? "Answer the blocking questions and prepare a new revision first" : `Version is ${record.status.replace("_", " ")}, not ready`;
  const review = readReview(store, projectId, version);
  if (!review?.compatibility) return "No compatibility result was recorded";
  if (!review.compatibility.compatible) return `Not compatible with ${review.compatibility.profile.interface}: ${review.compatibility.issues.filter(i => i.severity === "blocking").map(i => i.message).slice(0, 3).join("; ")}`;
  if (!review.plan.checks.some(c => c.available)) return "The prepared plan has no check this bench can run";
  return undefined;
}

export function activate(store: ProjectStore, projectId: string, version: string, campaignRunning: boolean): ActiveSelection {
  if (campaignRunning) throw new ProjectError(409, "A campaign is running; its project selection is frozen until it ends");
  const block = activationBlock(store, projectId, version);
  if (block) throw new ProjectError(409, block);
  const record = store.version(projectId, version);
  const files = selectionFiles(store, { projectId, version, worldPath: "" });
  const selection: ActiveSelection = { schema: PROJECT_SCHEMA, projectId, version, kind: projectId === EXAMPLE_PROJECT_ID ? "example" : "uploaded", selectedAtIso: new Date().toISOString(),
    specSha256: record.inputs.spec.sha256, ...(record.inputs.io ? { ioSha256: record.inputs.io.sha256 } : {}),
    worldSha256: record.package!.worldSha256, manifestSha256: record.package!.manifestSha256,
    worldPath: files.world, specPath: files.spec, manifestPath: files.manifest, ...(files.review ? { planPath: files.review } : {}) };
  verifySelection(store, selection);
  store.writeActive(selection);
  return selection;
}

/** Re-hashes every selected file; any difference is an explicit mismatch, never a fallback. */
export function verifySelection(store: ProjectStore, s: ActiveSelection): SelectionFiles {
  const files = selectionFiles(store, s);
  const problems = [
    sha(files.spec) !== s.specSha256 && "specification",
    sha(files.world) !== s.worldSha256 && "world.ts",
    sha(files.manifest) !== s.manifestSha256 && "world.manifest.json",
    s.projectId !== EXAMPLE_PROJECT_ID && store.version(s.projectId, s.version).package?.worldSha256 !== s.worldSha256 && "version record"
  ].filter(Boolean);
  if (problems.length) throw new ProjectError(409, `Selected project ${s.projectId}/${s.version} does not match its recorded hashes (${problems.join(", ")}); re-select a validated version`);
  return files;
}
