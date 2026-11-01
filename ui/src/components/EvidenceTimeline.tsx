import { useMemo, useState } from "react";
import { TIMELINE_LANES, type MuseEvent, type TimelineLane } from "../model/events.ts";
import { formatClock } from "../model/format.ts";
import type { WorkspaceState } from "../model/workspace-store.ts";
import { LANE_COLOR, LANE_LABEL, eventEvidenceTag, shortSource } from "./labels.ts";
import type { Selection } from "./selection.ts";

const WINDOWS = [
  { label: "6 s", ms: 6_000 },
  { label: "20 s", ms: 20_000 },
  { label: "60 s", ms: 60_000 },
  { label: "all", ms: Number.POSITIVE_INFINITY }
];

const LABEL_W = 132;
const WIDTH = 900;
const ROW_H = 22;

function firstIndexAtOrAfter(events: readonly MuseEvent[], atMs: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (events[mid]!.atMs < atMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

interface Props {
  state: WorkspaceState;
  nowMs: number;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

export function EvidenceTimeline({ state, nowMs, selection, onSelect }: Props) {
  const [windowMs, setWindowMs] = useState(20_000);
  const [showDense, setShowDense] = useState(false);
  const timeline = state.timeline;
  const keyEvents = state.keyEvents;
  const end = Math.max(nowMs, timeline.at(-1)?.atMs ?? 0);
  const start = Number.isFinite(windowMs) ? Math.max(0, end - windowMs) : 0;
  const span = Math.max(1, end - start);
  const toX = (atMs: number) => LABEL_W + ((atMs - start) / span) * (WIDTH - LABEL_W - 8);
  const selectedEvent = selection?.type === "event" ? keyEvents.find((event) => event.id === selection.id) ?? timeline.find((event) => event.id === selection.id) : undefined;

  const marks = useMemo(() => {
    const byLane = new Map<TimelineLane, Array<{ x: number; event: MuseEvent }>>();
    for (const lane of TIMELINE_LANES) byLane.set(lane, []);
    const lastX = new Map<TimelineLane, number>();
    const drawn = new Set<string>();
    const place = (event: MuseEvent) => {
      if (event.lane === "system" || drawn.has(event.id)) return;
      const lane = event.lane as TimelineLane;
      const px = toX(event.atMs);
      const important = event.kind === "verdict" || event.kind === "fault.set" || event.kind === "plan.added";
      if (!important && Math.abs((lastX.get(lane) ?? -10) - px) < 2) return;
      lastX.set(lane, px);
      drawn.add(event.id);
      byLane.get(lane)!.push({ x: px, event });
    };
    // Key events first so a dense stream never hides an important mark in the same pixel.
    for (let index = firstIndexAtOrAfter(keyEvents, start); index < keyEvents.length; index += 1) place(keyEvents[index]!);
    lastX.clear();
    for (let index = firstIndexAtOrAfter(timeline, start); index < timeline.length; index += 1) place(timeline[index]!);
    return byLane;
  }, [timeline.length, timeline.at(-1)?.id, keyEvents.length, keyEvents.at(-1)?.id, start, span]);

  const recent = useMemo(() => {
    const source = showDense ? timeline : keyEvents;
    const rows: MuseEvent[] = [];
    for (let index = source.length - 1; index >= 0 && rows.length < 120; index -= 1) {
      const event = source[index]!;
      if (event.lane === "system" && event.kind !== "step" && event.kind !== "episode.start" && event.kind !== "connector.link" && event.kind !== "wait.start") continue;
      rows.push(event);
    }
    return rows;
  }, [timeline.length, timeline.at(-1)?.id, keyEvents.length, keyEvents.at(-1)?.id, showDense]);

  const height = TIMELINE_LANES.length * ROW_H + 24;
  const ticks = 6;

  return (
    <section className="panel lanes" aria-label="Evidence timeline">
      <header>
        <h2>Evidence trace</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {state.eventCount.toLocaleString("en-US")} events · {state.mode} · world → raw commit → PLC ack → PLC output → HMI → finding
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        <div className="segmented" role="group" aria-label="Time window">
          {WINDOWS.map((option) => (
            <button key={option.label} aria-pressed={windowMs === option.ms} onClick={() => setWindowMs(option.ms)}>
              {option.label}
            </button>
          ))}
        </div>
      </header>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" style={{ height }}>
        {TIMELINE_LANES.map((lane, row) => (
          <g key={lane} transform={`translate(0 ${row * ROW_H})`}>
            <rect x={LABEL_W} y={2} width={WIDTH - LABEL_W - 4} height={ROW_H - 4} fill={row % 2 ? "transparent" : "var(--panel-2)"} />
            <text x={8} y={ROW_H / 2 + 4} className="lane-label">
              {LANE_LABEL[lane]}
            </text>
            {marks.get(lane)!.map(({ x, event }) => (
              <rect
                key={event.id}
                x={x - (event.kind === "verdict" ? 3 : 1)}
                y={event.kind === "verdict" ? 4 : 6}
                width={event.kind === "verdict" ? 6 : 2}
                height={event.kind === "verdict" ? ROW_H - 8 : ROW_H - 12}
                fill={event.kind === "verdict" ? (event.status === "pass" ? "var(--ok)" : event.status === "fail" ? "var(--bad)" : "var(--warn)") : LANE_COLOR[lane]}
                className="clickable" role="button" tabIndex={0} aria-label={event.summary}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect({ type: "event", id: event.id }); } }}
                onClick={() => onSelect({ type: "event", id: event.id })}
              >
                <title>{`${formatClock(event.atMs)} ${event.summary}`}</title>
              </rect>
            ))}
          </g>
        ))}
        {selectedEvent && selectedEvent.atMs >= start && <line x1={toX(selectedEvent.atMs)} x2={toX(selectedEvent.atMs)} y1={0} y2={TIMELINE_LANES.length * ROW_H} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="3 2" />}
        {Array.from({ length: ticks + 1 }, (_, index) => {
          const atMs = start + (span * index) / ticks;
          return (
            <text key={index} x={toX(atMs)} y={height - 6} textAnchor={index === 0 ? "start" : index === ticks ? "end" : "middle"} className="svg-small">
              {formatClock(atMs)}
            </text>
          );
        })}
      </svg>
      <div style={{ display: "flex", gap: 8, padding: "4px 10px", alignItems: "center", fontSize: 12 }}>
        <span className="muted">Key events, newest first</span>
        <span style={{ flex: 1 }} />
        <label className="muted">
          <input type="checkbox" checked={showDense} onChange={(event) => setShowDense(event.target.checked)} /> include commits, acks, analog raw
        </label>
      </div>
      <div className="events" role="list">
        {recent.length === 0 && <div className="event-row muted">No events yet.</div>}
        {recent.map((event) => {
          const tag = eventEvidenceTag(event.provenance);
          const lane = event.lane === "system" ? null : (event.lane as TimelineLane);
          return (
            <button key={event.id} type="button" className={`event-row${selection?.type === "event" && selection.id === event.id ? " selected" : ""}`} onClick={() => onSelect({ type: "event", id: event.id })}>
              <span className="mono muted">{formatClock(event.atMs)}</span>
              <span className="lane-chip" style={{ ["--lane-color" as string]: lane ? LANE_COLOR[lane] : "var(--text-3)" }}>
                {lane ? LANE_LABEL[lane] : event.kind === "step" ? "Activity" : "Coordinator"}
              </span>
              <span className="summary" title={event.summary}>
                {event.summary}
              </span>
              <span className={`tag ${tag.cls}`} title={`${tag.title}\n${shortSource(event.provenance)}`}>
                {tag.text}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
