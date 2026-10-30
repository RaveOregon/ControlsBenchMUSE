// Plays a composed replay timeline into the workspace store against a campaign playhead.
// Pause freezes the playhead (the held image stays on screen); Stop finalizes; nothing is
// sent anywhere — replay commands are recorded locally.

import type { MuseEvent } from "../../model/events.ts";
import type { CommandResult, WorkspaceStore } from "../../model/workspace-store.ts";
import type { CampaignSource } from "../source.ts";
import { composeReplay, type ReplayTimeline } from "./compose.ts";
import type { FixtureBundle } from "./fixtures.ts";

export const REPLAY_SPEEDS = [1, 2, 5, 10, 20] as const;

export class ReplaySession implements CampaignSource {
  readonly mode = "replay" as const;
  readonly label = "Replay · preserved Gate A–D and M0–M2 evidence";
  readonly store: WorkspaceStore;
  readonly bundle: FixtureBundle;
  speed = 2;
  #timeline: ReplayTimeline | null = null;
  #cursor = 0;
  #playheadMs = 0;

  constructor(bundle: FixtureBundle, store: WorkspaceStore) {
    this.bundle = bundle;
    this.store = store;
  }

  get timeline(): ReplayTimeline | null {
    return this.#timeline;
  }

  get playheadMs(): number {
    return this.#playheadMs;
  }

  nowMs(): number {
    return this.#playheadMs;
  }

  start(): CommandResult {
    const allowed = this.store.can("start");
    if (!allowed.ok) return allowed;
    this.#timeline = composeReplay(this.bundle, this.store.state.scope);
    this.#cursor = 0;
    this.#playheadMs = 0;
    return this.store.start(0);
  }

  advance(wallDeltaMs: number): void {
    if (!this.#timeline || this.store.state.phase !== "running") return;
    this.#playheadMs = Math.min(this.#timeline.durationMs, this.#playheadMs + Math.max(0, wallDeltaMs) * this.speed);
    this.#flushTo(this.#playheadMs);
  }

  /** Replay-only convenience: jump forward to the next episode boundary. */
  skipToNextEpisode(): CommandResult {
    const timeline = this.#timeline;
    if (!timeline || (this.store.state.phase !== "running" && this.store.state.phase !== "paused")) return { ok: false, reason: "Start the campaign first." };
    const next = timeline.episodes.find((episode) => episode.startMs > this.#playheadMs + 1);
    if (!next) return { ok: false, reason: "Already in the last episode." };
    this.#playheadMs = next.startMs;
    this.#flushTo(next.startMs);
    return { ok: true };
  }

  #flushTo(targetMs: number): void {
    const timeline = this.#timeline!;
    const batch: MuseEvent[] = [];
    while (this.#cursor < timeline.events.length && timeline.events[this.#cursor]!.atMs <= targetMs) batch.push(timeline.events[this.#cursor++]!);
    this.store.applyEvents(batch);
    if (this.#cursor >= timeline.events.length && targetMs >= timeline.durationMs && this.store.state.phase === "running") this.store.complete(targetMs);
  }

  pause(): CommandResult {
    return this.store.pause(this.#playheadMs);
  }

  resume(): CommandResult {
    return this.store.resume(this.#playheadMs);
  }

  stop(): CommandResult {
    return this.store.stop(this.#playheadMs);
  }

  resetSimulation(): CommandResult {
    return this.store.resetSimulation(this.#playheadMs);
  }

  exitSimulation(): CommandResult {
    return this.store.exitSimulation(this.#playheadMs);
  }

  enterSimulation(): CommandResult {
    return this.store.enterSimulation(this.#playheadMs);
  }

  setSuppression(outputId: string, suppressed: boolean): CommandResult {
    return this.store.setSuppression(outputId, suppressed, this.#playheadMs);
  }

  steer(text: string): CommandResult {
    return this.store.steer(text, this.#playheadMs);
  }
}
