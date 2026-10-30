// Derives the live activity line and per-component health from workspace state.
//
// Everything here is computed from recorded events and declared thresholds; there is no
// decorative status text. Staleness is only judged on clocks that actually carry timing.

import { formatClock, formatSeconds } from "./format.ts";
import type { WorkspaceState } from "./workspace-store.ts";

export type ActivityState =
  | "idle"
  | "hardware"
  | "active"
  | "reasoning"
  | "waiting"
  | "paused"
  | "connector_lost"
  | "plc_restarting"
  | "plc_stale"
  | "world_stalled"
  | "request_timed_out"
  | "condition_timeout"
  | "repair_warning"
  | "budget_hold"
  | "stopped"
  | "completed";

export type Tone = "neutral" | "active" | "reasoning" | "waiting" | "paused" | "degraded" | "stalled" | "done";

export interface HealthPill {
  label: string;
  value: string;
  tone: Tone;
}

export interface ActivityView {
  state: ActivityState;
  tone: Tone;
  headline: string;
  detail?: string;
  /** Elapsed time of the current activity on its source clock, when that clock carries timing. */
  elapsedMs?: number;
  elapsedLabel: string;
  exercise: boolean;
  campaignElapsedMs?: number;
  sinceLastMeaningfulMs?: number;
  lastMeaningful?: string;
  health: { muse: HealthPill; coordinator: HealthPill; connector: HealthPill; world: HealthPill; plc: HealthPill };
}

export const DEFAULT_WORLD_STALE_MS = 2000;

/** M5 rule: stale after max(500 ms, 3 × negotiated publish interval). */
export function plcStaleThresholdMs(publishingIntervalMs: number | undefined): number {
  return Math.max(500, 3 * (publishingIntervalMs ?? 0));
}

const PHASE_LABEL: Record<string, string> = {
  preparing: "preparing",
  connecting: "connecting",
  applying_stimulus: "applying stimulus",
  observing: "observing",
  investigating: "investigating",
  reasoning: "reasoning",
  compiling: "repairing candidate",
  migrating: "migrating state",
  writing_evidence: "writing evidence",
  auditing: "auditing evidence"
};

function humanizePurpose(purpose: string): string {
  return purpose.replace(/^gate_c_/, "").replace(/_/g, " ");
}

export function classifyActivity(state: WorkspaceState, nowMs: number): ActivityView {
  const episode = state.episode;
  const scale = episode?.timeScale ?? 1;
  const timed = episode ? episode.clock !== "discrete" : state.mode === "live";
  const toSource = (campaignMs: number) => campaignMs * scale;
  const elapsedLabel = (sourceMs: number | undefined): string => {
    if (!timed || sourceMs === undefined) return "timing not recorded";
    return `${formatSeconds(sourceMs)}${scale > 1 ? ` (condensed ×${Number.isInteger(scale) ? scale : scale.toFixed(1)})` : ""}`;
  };
  const active = state.phase === "running";
  const conn = state.connection;
  const worldStaleMs = state.budget.limits?.worldHeartbeatStaleMs ?? DEFAULT_WORLD_STALE_MS;
  const plcStaleMs = plcStaleThresholdMs(conn.publishingIntervalMs);
  const flag = state.runtimeFlag;
  const call = state.agent.active;
  const callAge = call ? toSource(nowMs - call.startedAtMs) : undefined;
  const plcAge = conn.lastPlcHeartbeatAtMs !== undefined ? toSource(nowMs - conn.lastPlcHeartbeatAtMs) : undefined;
  const worldAge = state.world.lastHeartbeatAtMs !== undefined ? toSource(nowMs - state.world.lastHeartbeatAtMs) : undefined;
  const waits = Object.values(state.waits).sort((left, right) => left.startedAtMs - right.startedAtMs);

  // ----- component health
  const muse: HealthPill = (() => {
    if (state.phase === "budget_hold" || state.budget.level === "hard_stop") return { label: "Muse", value: "budget hold · no calls", tone: "stalled" };
    if (call && callAge !== undefined) {
      if (timed && callAge >= call.timeoutMs) return { label: "Muse", value: `request timed out at ${formatClock(call.timeoutMs)}`, tone: "stalled" };
      return { label: "Muse", value: `reasoning ${timed ? formatSeconds(callAge) : ""}`.trim(), tone: "reasoning" };
    }
    if (flag?.state === "request_timed_out") return { label: "Muse", value: `timeout${flag.exercise ? " (guard exercise)" : ""}`, tone: "stalled" };
    const last = state.agent.calls.at(-1);
    return { label: "Muse", value: last ? `idle · last call ${formatSeconds(last.durationMs)}` : "idle", tone: "neutral" };
  })();

  const coordinator: HealthPill = (() => {
    switch (state.phase) {
      case "ready":
        return { label: "Coordinator", value: "ready", tone: "neutral" };
      case "paused":
        return { label: "Coordinator", value: "paused · image held", tone: "paused" };
      case "stopped":
        return { label: "Coordinator", value: "stopped · image held", tone: "done" };
      case "completed":
        return { label: "Coordinator", value: "completed", tone: "done" };
      case "budget_hold":
        return { label: "Coordinator", value: "holding (budget)", tone: "stalled" };
      default:
        if (waits[0]) return { label: "Coordinator", value: `waiting · ${waits[0].condition}`, tone: "waiting" };
        return { label: "Coordinator", value: state.step ? PHASE_LABEL[state.step.phase] ?? state.step.phase : "running", tone: "active" };
    }
  })();

  const connector: HealthPill = (() => {
    if (!episode?.connectorExpected) {
      if (episode?.world && !episode.plcExpected) return { label: "Connector", value: "n/a · surrogate driver", tone: "neutral" };
      return { label: "Connector", value: conn.link === "none" ? "not attached" : "idle", tone: "neutral" };
    }
    if (conn.link === "lost") return { label: "Connector", value: "lost", tone: "stalled" };
    if (conn.link === "reconnecting") return { label: "Connector", value: "reconnecting", tone: "degraded" };
    if (conn.link === "up") return { label: "Connector", value: `${conn.transport ?? "up"}${conn.publishingIntervalMs ? ` · ${conn.publishingIntervalMs} ms` : ""}`, tone: "active" };
    return { label: "Connector", value: "awaiting session", tone: "waiting" };
  })();

  const plc: HealthPill = (() => {
    if (!episode?.plcExpected) {
      if (episode?.world) return { label: "PLC", value: "surrogate driver (no PLC)", tone: "neutral" };
      if (conn.bootIdentity) return { label: "PLC", value: `last boot ${conn.bootIdentity}`, tone: "neutral" };
      return { label: "PLC", value: episode ? "not in this record" : state.mode === "replay" ? "none (replay)" : "not connected", tone: "neutral" };
    }
    if (conn.plcRestarting) return { label: "PLC", value: "restarting · awaiting boot identity", tone: "degraded" };
    if (timed && plcAge !== undefined && plcAge > plcStaleMs) return { label: "PLC", value: `stale ${formatSeconds(plcAge)}`, tone: "stalled" };
    if (conn.lastPlcHeartbeatAtMs === undefined) return { label: "PLC", value: "awaiting first observation", tone: "waiting" };
    return { label: "PLC", value: `alive${conn.plcCycle ? ` · cycle ${conn.plcCycle}` : ""}`, tone: "active" };
  })();

  const world: HealthPill = (() => {
    if (flag?.state === "world_stalled") return { label: "World", value: `stalled ${formatSeconds(flag.elapsedMs)}${flag.exercise ? " (guard exercise)" : ""}`, tone: "stalled" };
    if (!episode?.worldExpected) {
      if (episode?.world) return { label: "World", value: `held · ${episode.world.run}`, tone: "neutral" };
      return { label: "World", value: episode ? "no world in this record" : "not loaded", tone: "neutral" };
    }
    if (timed && active && worldAge !== undefined && worldAge > worldStaleMs) return { label: "World", value: `stalled ${formatSeconds(worldAge)}`, tone: "stalled" };
    return { label: "World", value: `running${state.world.tick !== undefined ? ` · tick ${state.world.tick}` : ""}${state.world.version ? ` · v${state.world.version}` : ""}`, tone: "active" };
  })();

  const base = {
    health: { muse, coordinator, connector, world, plc },
    campaignElapsedMs: state.startedAtMs !== undefined ? (state.endedAtMs ?? nowMs) - state.startedAtMs : undefined,
    sinceLastMeaningfulMs: state.lastMeaningful ? Math.max(0, nowMs - state.lastMeaningful.atMs) : undefined,
    lastMeaningful: state.lastMeaningful?.summary,
    exercise: false
  };
  const view = (partial: Omit<ActivityView, keyof typeof base | "elapsedLabel"> & { elapsedLabel?: string; exercise?: boolean }): ActivityView => ({ ...base, elapsedLabel: partial.elapsedLabel ?? elapsedLabel(partial.elapsedMs), ...partial });
  const inProgress = state.step?.message;

  // ----- headline, most severe first
  if (state.phase === "ready") {
    if (!conn.simulationRequested) return view({ state: "hardware", tone: "neutral", headline: "Hardware passthrough — enter simulation before starting a campaign", elapsedLabel: "—" });
    return view({ state: "idle", tone: "neutral", headline: "Ready — review the plan scope, then Start Campaign", elapsedLabel: "—" });
  }
  if (state.phase === "completed") return view({ state: "completed", tone: "done", headline: "Campaign complete — run record finalized and held for inspection", elapsedLabel: "—" });
  if (state.phase === "stopped") return view({ state: "stopped", tone: "done", headline: "Stopped — run record finalized; final raw image held for inspection", elapsedLabel: "—" });
  if (state.phase === "paused") return view({ state: "paused", tone: "paused", headline: "Paused — current raw image held; the PLC keeps scanning", detail: inProgress ? `Was: ${inProgress}` : undefined, elapsedLabel: "—" });
  if (state.phase === "budget_hold") return view({ state: "budget_hold", tone: "stalled", headline: "Budget hard stop — no further model calls; state held until you extend or stop", detail: `Spent $${state.budget.spentUsd.toFixed(2)} of $${state.budget.limits?.campaignHardUsd.toFixed(2)}`, elapsedLabel: "—" });

  if (episode?.connectorExpected && conn.link === "lost") {
    const since = conn.linkChangedAtMs !== undefined ? toSource(nowMs - conn.linkChangedAtMs) : undefined;
    return view({ state: "connector_lost", tone: "stalled", headline: "Connector lost — PLC holds the last simulated image; evidence gap open", detail: conn.linkDetail, elapsedMs: since });
  }
  if (episode?.plcExpected && conn.plcRestarting) {
    const since = conn.plcRestartAtMs !== undefined ? toSource(nowMs - conn.plcRestartAtMs) : undefined;
    return view({ state: "plc_restarting", tone: "degraded", headline: "PLC restarting — awaiting a new boot identity before opening a fresh epoch", detail: inProgress, elapsedMs: since });
  }
  if (episode?.plcExpected && timed && plcAge !== undefined && plcAge > plcStaleMs) {
    return view({ state: "plc_stale", tone: "stalled", headline: `PLC heartbeat stale — no observation for ${formatSeconds(plcAge)} (threshold ${plcStaleMs} ms)`, elapsedMs: plcAge });
  }

  if (flag) {
    const prefix = flag.exercise ? "Guard exercise · " : "";
    const detail = flag.exercise ? "Recorded CP-11 guard check with synthetic inputs, not a live failure." : undefined;
    const exerciseLabel = flag.elapsedMs !== undefined ? `${formatSeconds(flag.elapsedMs)} (recorded guard input)` : "timing not recorded";
    switch (flag.state) {
      case "world_stalled":
        return view({ state: "world_stalled", tone: "stalled", headline: `${prefix}World stalled — ${flag.message}`, detail, elapsedLabel: exerciseLabel, exercise: flag.exercise });
      case "request_timed_out":
        return view({ state: "request_timed_out", tone: "stalled", headline: `${prefix}Model request timed out — ${flag.message}`, detail, elapsedLabel: exerciseLabel, exercise: flag.exercise });
      case "condition_timeout":
        return view({ state: "condition_timeout", tone: "stalled", headline: `${prefix}${flag.message}`, detail, elapsedLabel: exerciseLabel, exercise: flag.exercise });
      case "waiting_condition":
        return view({ state: "waiting", tone: "waiting", headline: `${prefix}${flag.message} — healthy wait`, detail, elapsedLabel: exerciseLabel, exercise: flag.exercise });
      case "budget_stop":
        return view({ state: "budget_hold", tone: "stalled", headline: `${prefix}${flag.message}`, detail, elapsedLabel: "—", exercise: flag.exercise });
      case "repair_continue":
        return view({ state: "active", tone: "active", headline: `${prefix}${flag.message}`, detail, elapsedLabel: "—", exercise: flag.exercise });
      case "repair_warning":
      case "repair_hard_stop":
        return view({ state: "repair_warning", tone: flag.state === "repair_hard_stop" ? "stalled" : "degraded", headline: `${prefix}${flag.message}`, detail, elapsedLabel: "—", exercise: flag.exercise });
    }
  }

  if (episode?.worldExpected && timed && worldAge !== undefined && worldAge > worldStaleMs) {
    return view({ state: "world_stalled", tone: "stalled", headline: `World stalled — no heartbeat for ${formatSeconds(worldAge)} (threshold ${formatSeconds(worldStaleMs)})`, elapsedMs: worldAge });
  }

  if (call && callAge !== undefined) {
    const limit = formatClock(call.timeoutMs);
    if (timed && callAge >= call.timeoutMs) return view({ state: "request_timed_out", tone: "stalled", headline: `Model request exceeded ${limit} — aborted; no further spend on this call`, elapsedMs: callAge });
    return view({
      state: "reasoning",
      tone: "reasoning",
      headline: `Muse reasoning — ${humanizePurpose(call.purpose)}`,
      detail: `${inProgress ? `${inProgress} · ` : ""}request limit ${limit}, reserved $${call.reservedUsd.toFixed(2)}`,
      elapsedMs: callAge
    });
  }

  const wait = waits[0];
  if (wait) {
    const age = toSource(nowMs - wait.startedAtMs);
    if (timed && wait.timeoutMs !== null && age > wait.timeoutMs) return view({ state: "condition_timeout", tone: "stalled", headline: `Condition timed out — ${wait.condition}`, elapsedMs: age });
    const deadline = wait.timeoutMs === null ? "no deadline declared" : `window ${formatSeconds(wait.timeoutMs)}`;
    const health = [connector, plc, world].filter((pill) => pill.tone === "active").map((pill) => pill.label).join(", ");
    return view({ state: "waiting", tone: "waiting", headline: `Waiting for ${wait.condition}`, detail: `${deadline}${health ? ` · ${health} active` : ""}${waits.length > 1 ? ` · ${waits.length - 1} more pending` : ""}`, elapsedMs: age });
  }

  if (state.step) {
    return view({ state: "active", tone: "active", headline: state.step.message, detail: state.step.awaiting ? `Awaiting ${state.step.awaiting}` : episode?.title, elapsedMs: toSource(nowMs - state.step.atMs) });
  }
  return view({ state: "active", tone: "active", headline: episode?.title ?? "Running", elapsedMs: episode ? toSource(nowMs - episode.startedAtMs) : undefined });
}
