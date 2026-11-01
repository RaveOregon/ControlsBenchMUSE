// HMI-recorded alarm history. M8 exposes only its latched first fault (FaultCode/FaultText) and a
// current exception code; it has no alarm list, alarm timestamps or acknowledgement. This
// recorder derives instances from observed transitions, states the time basis of every
// timestamp, and never invents an onset, a clear or a PLC acknowledgement it did not observe.
// ConnectorStale and link health are bench diagnostics and are deliberately not alarms.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AlarmKind, AlarmView, SnapshotView } from "./protocol.ts";
import { HmiJournal } from "./journal.ts";
import { M8_EXCEPTIONS, P, faultInfo } from "./signals.ts";

export const ALARM_TIME_BASIS = "HMI service wall clock at receipt of the OPC UA read that first showed the state. Onset lies after the previous good read (onsetAfterIso). OPC source timestamps are server sampling times, not PLC fault-onset times.";

type HistoryRecord =
  | { type: "alarm.raised"; atIso: string; alarm: AlarmView }
  | { type: "alarm.cleared"; atIso: string; id: string; clearedObservedAtIso: string; clearedAfterIso?: string; clearBasis: AlarmView["clearBasis"] }
  | { type: "alarm.unresolved"; atIso: string; id: string; reason: string }
  | { type: "alarm.gap"; atIso: string; id: string; fromIso: string; toIso: string; reason: string }
  | { type: "alarm.reviewed"; atIso: string; id: string; clientSessionId?: string };

export interface AlarmFilter { state?: "active" | "cleared" | "unresolved" | "all"; kind?: AlarmKind | "all"; code?: number; text?: string; sinceIso?: string; limit?: number }

export interface AlarmRecorderOptions {
  journal: HmiJournal;
  serviceSessionId: string;
  /** Persistent append-only history. Omit for in-memory fixture runs. */
  historyFile?: string;
  onChange?: () => void;
}

const KINDS: Array<{ kind: AlarmKind; code: string; text: string }> = [
  { kind: "fault", code: P.faultCode, text: P.faultText },
  { kind: "exception", code: P.exceptionCode, text: P.exceptionText }
];

export class AlarmRecorder {
  readonly #o: AlarmRecorderOptions;
  readonly #alarms = new Map<string, AlarmView>();
  readonly #open = new Map<AlarmKind, string>();
  #counter = 0;
  #observedBoot?: string;
  #lastOkIso?: string;
  #gap?: { fromIso: string; reason: string };
  readonly loadedFromHistory: number;

  constructor(options: AlarmRecorderOptions) {
    this.#o = options;
    this.loadedFromHistory = this.#load();
  }

  get persistence(): string {
    return this.#o.historyFile ? `Persisted append-only at ${this.#o.historyFile}. ${ALARM_TIME_BASIS}` : `In memory only for this fixture run (not persisted). ${ALARM_TIME_BASIS}`;
  }

  #load(): number {
    const file = this.#o.historyFile;
    if (!file || !existsSync(file)) return 0;
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    for (const line of lines) this.#apply(JSON.parse(line) as HistoryRecord);
    for (const alarm of this.#alarms.values()) {
      const n = Number(alarm.id.split(":").at(-1)); if (Number.isFinite(n)) this.#counter = Math.max(this.#counter, n);
      if (alarm.state === "active") this.#open.set(alarm.kind, alarm.id);
    }
    // Instances still open from an earlier HMI session are reconciled at the first observation.
    const lastIso = lines.length ? (JSON.parse(lines.at(-1)!) as HistoryRecord).atIso : undefined;
    if (this.#open.size && lastIso) this.#gap = { fromIso: lastIso, reason: "HMI service not running" };
    return lines.length;
  }

  #apply(record: HistoryRecord): void {
    if (record.type === "alarm.raised") { this.#alarms.set(record.alarm.id, structuredClone(record.alarm)); return; }
    const alarm = this.#alarms.get(record.id);
    if (!alarm) return;
    if (record.type === "alarm.cleared") Object.assign(alarm, { state: "cleared", clearedObservedAtIso: record.clearedObservedAtIso, clearedAfterIso: record.clearedAfterIso, clearBasis: record.clearBasis });
    else if (record.type === "alarm.unresolved") Object.assign(alarm, { state: "unresolved", unresolvedReason: record.reason });
    else if (record.type === "alarm.gap") alarm.gaps = [...(alarm.gaps ?? []), { fromIso: record.fromIso, toIso: record.toIso, reason: record.reason }];
    else if (record.type === "alarm.reviewed") alarm.review = { atIso: record.atIso, clientSessionId: record.clientSessionId };
  }

  #record(record: HistoryRecord): void {
    this.#apply(record);
    if (this.#o.historyFile) { mkdirSync(dirname(this.#o.historyFile), { recursive: true }); appendFileSync(this.#o.historyFile, `${JSON.stringify(record)}\n`); }
    const { type, ...data } = record;
    this.#o.journal.append(type, data as Record<string, unknown>);
    this.#o.onChange?.();
  }

  /** The PLC link stopped delivering good reads; open alarms get an observation gap. */
  linkLost(reason: string): void {
    if (!this.#gap && this.#lastOkIso) this.#gap = { fromIso: this.#lastOkIso, reason };
  }

  /** A new PLC boot identity: alarms of the old boot can no longer be observed to clear. */
  bootChanged(from: string, to: string, atIso: string): void {
    for (const [kind, id] of this.#open) {
      const alarm = this.#alarms.get(id)!;
      if (alarm.bootIdentity !== to) { this.#record({ type: "alarm.unresolved", atIso, id, reason: `PLC boot changed ${from} → ${to}; clear not observed` }); this.#open.delete(kind); }
    }
    this.#observedBoot = undefined;
  }

  observe(snapshot: SnapshotView): void {
    const boot = snapshot.values[P.boot]?.good ? String(snapshot.values[P.boot].value) : undefined;
    if (!boot) return;
    const atIso = snapshot.receivedAtIso;
    const firstOfBoot = this.#observedBoot !== boot;
    const gap = this.#gap; this.#gap = undefined;
    for (const { kind, code: codePath, text: textPath } of KINDS) {
      const sample = snapshot.values[codePath];
      if (!sample?.good) continue;
      const code = Number(sample.value);
      const openId = this.#open.get(kind);
      const open = openId ? this.#alarms.get(openId) : undefined;
      if (open && open.bootIdentity !== boot) { // restart across an HMI outage
        this.#record({ type: "alarm.unresolved", atIso, id: open.id, reason: `PLC boot is now ${boot}; clear of boot ${open.bootIdentity} not observed` });
        this.#open.delete(kind);
      } else if (open && gap) {
        this.#record({ type: "alarm.gap", atIso, id: open.id, fromIso: gap.fromIso, toIso: atIso, reason: gap.reason });
      }
      const current = this.#open.get(kind) ? this.#alarms.get(this.#open.get(kind)!) : undefined;
      if (current && current.code !== code) {
        this.#record({ type: "alarm.cleared", atIso, id: current.id, clearedObservedAtIso: atIso, clearedAfterIso: gap?.fromIso ?? this.#lastOkIso, clearBasis: gap ? "observed_after_gap" : "transition_observed" });
        this.#open.delete(kind);
      }
      if (code !== 0 && !this.#open.get(kind)) {
        const basis: AlarmView["firstObservedBasis"] = gap ? "observed_after_gap" : firstOfBoot ? "active_at_observation_start" : "transition_observed";
        const info = kind === "fault" ? faultInfo(code) : { ...(M8_EXCEPTIONS[code] ?? { cause: "Exception code not in the M8 table.", response: "Unknown." }), operation: ["item"], engineering: [] as string[] };
        const alarm: AlarmView = { id: `alarm:${boot}:${++this.#counter}`, kind, code, plcText: String(snapshot.values[textPath]?.value ?? ""), cause: info.cause, response: info.response,
          state: "active", firstObservedAtIso: atIso, firstObservedBasis: basis, onsetAfterIso: basis === "active_at_observation_start" ? undefined : gap?.fromIso ?? this.#lastOkIso,
          plcSourceTimestamp: sample.sourceTimestamp, bootIdentity: boot, serviceSessionId: this.#o.serviceSessionId,
          related: { operation: info.operation, engineering: info.engineering } };
        this.#record({ type: "alarm.raised", atIso, alarm });
        this.#open.set(kind, alarm.id);
      }
    }
    this.#observedBoot = boot;
    this.#lastOkIso = atIso;
  }

  review(id: string, clientSessionId?: string): AlarmView {
    const alarm = this.#alarms.get(id);
    if (!alarm) throw new Error(`Unknown alarm ${id}`);
    if (!alarm.review) this.#record({ type: "alarm.reviewed", atIso: new Date().toISOString(), id, clientSessionId });
    return structuredClone(this.#alarms.get(id)!);
  }

  active(): AlarmView[] { return [...this.#open.values()].map(id => structuredClone(this.#alarms.get(id)!)); }

  query(filter: AlarmFilter = {}): { alarms: AlarmView[]; total: number } {
    const text = filter.text?.toLowerCase();
    const list = [...this.#alarms.values()].reverse().filter(a =>
      (!filter.state || filter.state === "all" || a.state === filter.state) && (!filter.kind || filter.kind === "all" || a.kind === filter.kind) &&
      (filter.code === undefined || a.code === filter.code) && (!filter.sinceIso || a.firstObservedAtIso >= filter.sinceIso) &&
      (!text || `${a.code} ${a.plcText} ${a.cause}`.toLowerCase().includes(text)));
    return { alarms: list.slice(0, filter.limit ?? 200).map(a => structuredClone(a)), total: list.length };
  }

  get size(): number { return this.#alarms.size; }
}
