import type { SourceMode } from "../model/events.ts";
import type { CommandResult, WorkspaceStore } from "../model/workspace-store.ts";

/**
 * A campaign source owns the clock and feeds MuseEvents into a WorkspaceStore. Components
 * only talk to this interface, so the replay source can be swapped for the live coordinator.
 */
export interface CampaignSource {
  readonly mode: SourceMode;
  readonly label: string;
  readonly store: WorkspaceStore;
  /** Why this source cannot start, if it cannot (e.g. no live coordinator attached). */
  readonly unavailableReason?: string;
  nowMs(): number;
  advance(wallDeltaMs: number): void;
  start(): CommandResult;
  pause(): CommandResult;
  resume(): CommandResult;
  stop(): CommandResult;
  resetSimulation(): CommandResult;
  exitSimulation(): CommandResult;
  enterSimulation(): CommandResult;
  setSuppression(outputId: string, suppressed: boolean): CommandResult;
  steer(text: string): CommandResult;
}
