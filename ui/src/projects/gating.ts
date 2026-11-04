// Start gating for project campaigns: a selected project, and for an uploaded project at least
// one runnable prepared check in the chosen categories. The prepared example plans after Start.
import type { WorkspaceState } from "../model/workspace-store.ts";
import type { ProjectsIndex, Review } from "./api.ts";

export function projectStartBlock(index: ProjectsIndex | undefined, review: Review | undefined, state: WorkspaceState): string | undefined {
  if (!index) return undefined;
  if (!index.active) return "Select a project in Setup (or Load example conveyor) first";
  if (index.active.kind === "uploaded") {
    if (!review) return "Loading the project's prepared plan…";
    const selected = Object.entries(state.categoryScope ?? {}).filter(([, on]) => on).map(([id]) => id);
    if (!review.plan.checks.some(c => c.available && selected.includes(c.group))) return "Select a category that contains runnable planned checks";
  }
  return undefined;
}
