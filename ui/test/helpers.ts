import type { MuseEvent, MuseEventBody, EventLane, Provenance, SourceMode } from "../src/model/events.ts";
import type { SignalDefinition } from "../src/model/workspace-store.ts";

export const SIGNALS: SignalDefinition[] = [
  { id: "PE_Entry", direction: "world_to_plc", dataType: "BOOL", role: "sensor.entry", description: "" },
  { id: "D1_HomeFB", direction: "world_to_plc", dataType: "BOOL", role: "divert1.homeFeedback", description: "" },
  { id: "Belt_SpeedActual", direction: "world_to_plc", dataType: "REAL", role: "diagnostic.beltSpeedActual", description: "" },
  { id: "Encoder_Count", direction: "world_to_plc", dataType: "UDINT", role: "motion.encoderCount", description: "" },
  { id: "Motor_RunCmd", direction: "plc_to_world", dataType: "BOOL", role: "drive.runCommand", description: "" }
];

export const LIMITS = {
  perRequestUsd: 1,
  repairEpisodeUsd: 2,
  campaignWarningUsd: 3,
  campaignHardUsd: 5,
  sessionHardUsd: 15,
  requestTimeoutMs: 300_000,
  failedRepairWarning: 3,
  failedRepairHard: 5,
  worldHeartbeatStaleMs: 2_000
};

let sequence = 0;

/** Builds a synthetic event; tests use it for state shapes no preserved record contains. */
export function ev(atMs: number, body: MuseEventBody, options: { mode?: SourceMode; lane?: EventLane; clock?: Provenance["clock"]; checkId?: string } = {}): MuseEvent {
  return {
    ...body,
    id: `test-${++sequence}`,
    atMs,
    lane: options.lane ?? "system",
    summary: body.kind,
    checkId: options.checkId,
    provenance: { mode: options.mode ?? "replay", evidenceClass: "plc_measurement", source: "test", clock: options.clock ?? "recorded_wall" }
  } as MuseEvent;
}

export function episode(atMs: number, options: { connector?: boolean; plc?: boolean; world?: boolean; clock?: Provenance["clock"]; mode?: SourceMode; checkIds?: string[] } = {}): MuseEvent {
  return ev(
    atMs,
    {
      kind: "episode.start",
      episodeId: `episode-${atMs}`,
      checkIds: options.checkIds ?? [],
      title: "test episode",
      world: options.world ? { worldId: "w", worldVersion: "0.5.0", run: "run-1" } : undefined,
      connectorExpected: options.connector ?? false,
      plcExpected: options.plc ?? false,
      worldExpected: options.world ?? false,
      timeScale: 1
    },
    { clock: options.clock, mode: options.mode }
  );
}
