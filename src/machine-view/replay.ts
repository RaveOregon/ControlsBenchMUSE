// Replay adapter: folds a preserved `controlsbench-proof-trace-v1` world run into view
// snapshots on the recorded clock. It replays recorded values only; it never interpolates.

import type { Channel, EntitySample, ScalarValue, ViewEvidenceClass, ViewSnapshot } from "./contracts.ts";
import { buildSnapshot } from "./frame.ts";

interface TraceEvent { sequence: number; atMs: number; lane: string; data: Record<string, unknown> }
export interface TraceRun { label: string; events: TraceEvent[]; finalTimeMs: number }

export interface ReplayOptions {
  packageId: string;
  channels: readonly Channel[];
  evidenceClass: ViewEvidenceClass;
  /** Snapshot cadence on the recorded clock (default 100 ms, the qualified 10 Hz point). */
  periodMs?: number;
  evidencePrefix?: string;
}

export function replaySnapshots(run: TraceRun, options: ReplayOptions): ViewSnapshot[] {
  const periodMs = options.periodMs ?? 100;
  const raw: Record<string, ScalarValue> = {};
  const outputs: Record<string, ScalarValue> = {};
  const rawRefs: Record<string, string> = {};
  const outputRefs: Record<string, string> = {};
  const entities = new Map<string, EntitySample>();
  const prefix = options.evidencePrefix ?? `trace:${run.label}`;
  const events = [...run.events].sort((a, b) => a.sequence - b.sequence);
  const snapshots: ViewSnapshot[] = [];
  let index = 0;
  let lastSequence = 0;
  for (let t = 0, frame = 0; t <= run.finalTimeMs + periodMs - 1; t += periodMs, frame += 1) {
    while (index < events.length && events[index]!.atMs <= t) {
      const e = events[index++]!;
      lastSequence = e.sequence;
      if (e.lane === "raw_input" && typeof e.data.signalId === "string") {
        raw[e.data.signalId] = e.data.value as ScalarValue;
        rawRefs[`world.${e.data.signalId}`] = `${prefix}#${e.sequence}`;
      } else if (e.lane === "plc_frame") {
        const values = (e.data.frame as { values?: Record<string, ScalarValue> } | undefined)?.values ?? {};
        for (const [k, v] of Object.entries(values)) { outputs[k] = v; outputRefs[`plc.${k}`] = `${prefix}#${e.sequence}`; }
      } else if (e.lane === "entity") {
        if (e.data.action === "publish") {
          const s = e.data.snapshot as { id: string; type: string; state: Record<string, ScalarValue> };
          entities.set(s.id, { id: s.id, type: s.type, state: { ...s.state }, evidenceRef: `${prefix}#${e.sequence}` });
        } else if (e.data.action === "remove" && typeof e.data.entityId === "string") entities.delete(e.data.entityId);
      }
    }
    snapshots.push(buildSnapshot(options.channels, {
      packageId: options.packageId,
      mode: "replay",
      evidenceClass: options.evidenceClass,
      sequence: frame,
      campaignSequence: lastSequence,
      sourceTimeMs: Math.min(t, run.finalTimeMs),
      label: `${run.label} t=${(Math.min(t, run.finalTimeMs) / 1000).toFixed(1)} s`,
      link: { state: "not_connected" },
      raw: { ...raw },
      outputs: { ...outputs },
      evidenceRefs: { ...rawRefs, ...outputRefs },
      entities: [...entities.values()].map(e => structuredClone(e))
    }));
  }
  return snapshots;
}
