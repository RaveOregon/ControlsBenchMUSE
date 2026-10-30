// Lightweight diagnostic schematic. It draws recorded state only: raw inputs, PLC outputs,
// carton entities, and injected faults. It does not move anything on its own — belt marks
// advance from the raw Encoder_Count, so stops show the recorded deceleration and coast.

import type { MachineGeometry } from "../adapters/replay/geometry.ts";
import type { RawValue } from "../model/events.ts";
import { formatRaw } from "../model/format.ts";
import type { WorkspaceState } from "../model/workspace-store.ts";
import { evidenceTag } from "./labels.ts";
import type { Selection } from "./selection.ts";

const X0 = 92;
const PX = 160;
const LANE_Y = 118;
const LANE_H = 34;
const BRANCH_DEG = 32;
const COS = Math.cos((BRANCH_DEG * Math.PI) / 180);
const SIN = Math.sin((BRANCH_DEG * Math.PI) / 180);
const MARK_SPACING = 22;

const x = (m: number) => X0 + m * PX;

interface Props {
  state: WorkspaceState;
  geometry: MachineGeometry | null;
  onSelect: (selection: Selection) => void;
}

function on(value: RawValue | undefined): boolean {
  return value === true;
}

export function MachineView({ state, geometry, onSelect }: Props) {
  const episode = state.episode;
  const input = (id: string) => state.inputs[id]?.value;
  const output = (id: string) => state.outputs[id]?.value;
  const faultOn = (target: string) => Object.values(state.faults).filter((fault) => !fault.sealed && fault.target === target);
  const sealed = Object.values(state.faults).find((fault) => fault.sealed);
  const noWorld = Boolean(episode) && !episode?.world;
  const select = (id: string) => () => onSelect({ type: "signal", id });

  if (!geometry) {
    return (
      <section className="panel machine">
        <header>
          <h2>Machine</h2>
        </header>
        <div className="body muted">Geometry unavailable: the generated world source has no parseable CONFIG block, so no schematic is drawn.</div>
      </section>
    );
  }

  const g = geometry;
  const branchPoint = (startM: number, alongM: number) => ({ x: x(startM) + alongM * PX * COS, y: LANE_Y + alongM * PX * SIN });
  const pathPoint = (path: string, positionM: number) => {
    if (path === "exitA") return { ...branchPoint(g.divert1M, positionM - g.divert1M), angle: BRANCH_DEG };
    if (path === "exitB") return { ...branchPoint(g.divert2M, positionM - g.divert2M), angle: BRANCH_DEG };
    return { x: x(positionM), y: LANE_Y, angle: 0 };
  };

  const encoder = Number(input("Encoder_Count") ?? 0);
  const markOffset = (((encoder / g.encoderCountsPerM) * PX) % MARK_SPACING + MARK_SPACING) % MARK_SPACING;
  const laneStart = x(0) - 10;
  const laneEnd = x(g.runoutEndM) + 6;
  const branchA = { from: { x: x(g.divert1M), y: LANE_Y }, to: branchPoint(g.divert1M, g.exitAEndM - g.divert1M) };
  const branchB = { from: { x: x(g.divert2M), y: LANE_Y }, to: branchPoint(g.divert2M, g.exitBEndM - g.divert2M) };

  const Lamp = ({ cx, cy, id, value, color, label }: { cx: number; cy: number; id: string; value: RawValue | undefined; color: string; label: string }) => (
    <g className="clickable" onClick={select(id)}>
      <title>{`${id} = ${formatRaw(value)}`}</title>
      <circle cx={cx} cy={cy} r={5.5} fill={on(value) ? color : "transparent"} stroke={value === undefined ? "var(--line-strong)" : color} strokeWidth={1.5} strokeDasharray={value === undefined ? "2 2" : undefined} />
      <text x={cx} y={cy + 16} textAnchor="middle" className="svg-small">
        {label}
      </text>
      {state.suppressedOutputs[id] && (
        <text x={cx} y={cy - 9} textAnchor="middle" className="svg-small" style={{ fill: "var(--warn)" }}>
          sink off
        </text>
      )}
    </g>
  );

  const FaultBadge = ({ cx, cy, target }: { cx: number; cy: number; target: string }) => {
    const faults = faultOn(target);
    if (faults.length === 0) return null;
    return (
      <g>
        <title>{faults.map((fault) => fault.detail).join("\n")}</title>
        <rect x={cx - 26} y={cy - 9} width={52} height={15} rx={3} fill="var(--bad)" />
        <text x={cx} y={cy + 2} textAnchor="middle" style={{ font: "600 9.5px var(--sans)", fill: "#fff" }}>
          FAULT
        </text>
      </g>
    );
  };

  const Photoeye = ({ id, label, path, positionM }: { id: string; label: string; path: string; positionM: number }) => {
    const p = pathPoint(path, positionM);
    const value = input(id);
    const lit = on(value);
    return (
      <g className="clickable" onClick={select(id)} transform={`translate(${p.x} ${p.y}) rotate(${p.angle})`}>
        <title>{`${id} raw = ${formatRaw(value)}${state.inputs[id]?.cause ? `\n${state.inputs[id]!.cause}` : ""}`}</title>
        <line x1={0} y1={-LANE_H / 2 - 7} x2={0} y2={LANE_H / 2 + 7} stroke={lit ? "var(--beam)" : "var(--line-strong)"} strokeWidth={lit ? 3 : 1} strokeDasharray={lit ? undefined : "3 3"} />
        <rect x={-4} y={-LANE_H / 2 - 13} width={8} height={7} rx={1.5} fill={lit ? "var(--beam)" : "var(--panel-2)"} stroke="var(--text-3)" />
        <rect x={-4} y={LANE_H / 2 + 6} width={8} height={7} rx={1.5} fill="var(--panel-2)" stroke="var(--text-3)" />
        <g transform={`rotate(${-p.angle})`}>
          <text x={0} y={-LANE_H / 2 - 18} textAnchor="middle" className="svg-label">
            {label}
          </text>
          <text x={14} y={LANE_H / 2 + 14} className="svg-mono" style={{ fill: lit ? "var(--beam)" : "var(--text-3)" }}>
            {formatRaw(value)}
          </text>
        </g>
        <FaultBadge cx={0} cy={-LANE_H / 2 - 34} target={id} />
      </g>
    );
  };

  const Divert = ({ n, atM }: { n: 1 | 2; atM: number }) => {
    const position = Number(input(`D${n}_Position`) ?? 0);
    const angle = Math.max(0, Math.min(1, position / 100)) * 40;
    const pivot = { x: x(atM) - 44, y: LANE_Y - LANE_H / 2 };
    return (
      <g>
        <g className="clickable" onClick={select(`D${n}_Position`)}>
          <title>{`D${n}_Position raw = ${formatRaw(input(`D${n}_Position`))}`}</title>
          <line x1={pivot.x} y1={pivot.y} x2={pivot.x + 58 * Math.cos((angle * Math.PI) / 180)} y2={pivot.y + 58 * Math.sin((angle * Math.PI) / 180)} stroke="var(--text)" strokeWidth={4} strokeLinecap="round" />
          <circle cx={pivot.x} cy={pivot.y} r={4} fill="var(--text)" />
        </g>
        <text x={pivot.x - 4} y={pivot.y - 50} className="svg-label">
          D{n}
        </text>
        <text x={pivot.x + 18} y={pivot.y - 50} className="svg-mono">
          {formatRaw(input(`D${n}_Position`))}%
        </text>
        <Lamp cx={pivot.x + 4} cy={pivot.y - 32} id={`D${n}_ExtendCmd`} value={output(`D${n}_ExtendCmd`)} color="var(--accent)" label="" />
        <Lamp cx={pivot.x + 22} cy={pivot.y - 32} id={`D${n}_HomeFB`} value={input(`D${n}_HomeFB`)} color="var(--ok)" label="" />
        <Lamp cx={pivot.x + 40} cy={pivot.y - 32} id={`D${n}_ExtendedFB`} value={input(`D${n}_ExtendedFB`)} color="var(--ok)" label="" />
        <text x={pivot.x + 52} y={pivot.y - 28} className="svg-small">
          cmd · H · E
        </text>
        <FaultBadge cx={pivot.x + 22} cy={pivot.y - 70} target={`D${n}`} />
      </g>
    );
  };

  const cartons = Object.entries(state.entities).filter(([, entity]) => entity.type === "carton");

  return (
    <section className="panel machine" aria-label="Machine diagnostic view">
      <header>
        <h2>Machine</h2>
        <div className="machine-meta">
          {episode?.world ? (
            <>
              <span className="mono">
                {episode.world.worldId} v{state.world.version ?? episode.world.worldVersion}
              </span>
              <span>· run {episode.world.run}</span>
              {episode.world.seed !== undefined && <span>· seed {episode.world.seed}</span>}
              {(() => {
                const tag = evidenceTag(episode.world.blindView ? "agent_record" : "surrogate_contract", state.mode);
                return <span className={`tag ${tag.cls}`} title={tag.title}>{episode.world.blindView ? "blind view" : tag.text}</span>;
              })()}
              {!episode.plcExpected && <span className="muted">· surrogate PLC-output driver, no PLC</span>}
            </>
          ) : episode ? (
            <span className="muted">{episode.title}</span>
          ) : (
            <span className="muted">No campaign running</span>
          )}
        </div>
      </header>
      <svg viewBox="0 0 880 300" role="img" aria-label="Conveyor schematic">
        <defs>
          <clipPath id="lane-clip">
            <rect x={laneStart} y={LANE_Y - LANE_H / 2} width={laneEnd - laneStart} height={LANE_H} />
          </clipPath>
        </defs>
        <g opacity={noWorld ? 0.4 : 1}>
          {[branchA, branchB].map((branch, index) => (
            <line key={index} x1={branch.from.x} y1={branch.from.y} x2={branch.to.x} y2={branch.to.y} stroke="var(--belt)" strokeWidth={LANE_H} strokeLinecap="butt" />
          ))}
          <rect x={laneStart} y={LANE_Y - LANE_H / 2} width={laneEnd - laneStart} height={LANE_H} fill="var(--belt)" />
          <g clipPath="url(#lane-clip)">
            {Array.from({ length: Math.ceil((laneEnd - laneStart) / MARK_SPACING) + 2 }, (_, index) => {
              const mx = laneStart - MARK_SPACING + index * MARK_SPACING + markOffset;
              return <path key={index} d={`M ${mx} ${LANE_Y - 9} l 6 9 l -6 9`} fill="none" stroke="var(--belt-mark)" strokeWidth={2} />;
            })}
          </g>

          <text x={branchA.to.x + 8} y={branchA.to.y + 4} className="svg-label">
            Exit A
          </text>
          <text x={branchB.to.x + 8} y={branchB.to.y + 4} className="svg-label">
            Exit B
          </text>
          <text x={laneEnd + 6} y={LANE_Y + 4} className="svg-label">
            Runout
          </text>
          <Lamp cx={branchA.to.x + 20} cy={branchA.to.y + 18} id="ExitA_Ready" value={input("ExitA_Ready")} color="var(--ok)" label="ready" />
          <Lamp cx={branchB.to.x + 20} cy={branchB.to.y + 18} id="ExitB_Ready" value={input("ExitB_Ready")} color="var(--ok)" label="ready" />
          <Lamp cx={laneEnd + 22} cy={LANE_Y + 20} id="Runout_Ready" value={input("Runout_Ready")} color="var(--ok)" label="ready" />

          <Photoeye id="PE_Entry" label="Entry" path="main" positionM={g.peEntryM} />
          <Photoeye id="PE_D1Approach" label="D1 appr" path="main" positionM={g.peD1ApproachM} />
          <Photoeye id="PE_D2Approach" label="D2 appr" path="main" positionM={g.peD2ApproachM} />
          <Photoeye id="PE_Runout" label="PE runout" path="main" positionM={g.peRunoutM} />
          <Photoeye id="PE_ExitA" label="PE A" path="exitA" positionM={g.peExitAM} />
          <Photoeye id="PE_ExitB" label="PE B" path="exitB" positionM={g.peExitBM} />

          <Divert n={1} atM={g.divert1M} />
          <Divert n={2} atM={g.divert2M} />

          {cartons.map(([id, entity]) => {
            const s = entity.state;
            const p = pathPoint(String(s.path ?? "main"), Number(s.positionM ?? 0));
            const length = Number(s.lengthM ?? g.cartonLengthM) * PX;
            const route = s.requestedRoute ? String(s.requestedRoute) : "—";
            return (
              <g key={id}>
                <g transform={`translate(${p.x} ${p.y}) rotate(${p.angle})`}>
                  <rect x={-length / 2} y={-11} width={length} height={22} rx={2} fill="var(--carton)" stroke={s.jammed ? "var(--bad)" : "#00000055"} strokeWidth={s.jammed ? 2 : 1} />
                </g>
                <text x={p.x} y={p.y + 4} textAnchor="middle" style={{ font: "600 10px var(--sans)", fill: "#1d1408" }}>
                  {String(s.itemId ?? id).slice(0, 14)} → {route}
                </text>
                <text x={p.x} y={p.y + 30} textAnchor="middle" className="svg-small">
                  {Number(s.positionM).toFixed(3)} m · {Number(s.velocityMps ?? 0).toFixed(2)} m/s
                </text>
              </g>
            );
          })}

          <g transform={`translate(18 ${LANE_Y - 26})`}>
            <rect x={0} y={0} width={56} height={52} rx={6} fill="var(--panel-2)" stroke="var(--line-strong)" />
            <text x={28} y={21} textAnchor="middle" style={{ font: "700 14px var(--sans)", fill: "var(--text)" }}>
              M
            </text>
            <FaultBadge cx={28} cy={-14} target="Drive_RunningFB" />
            <FaultBadge cx={28} cy={-30} target="Drive_Overload" />
          </g>
          <Lamp cx={26} cy={LANE_Y + 6} id="Motor_RunCmd" value={output("Motor_RunCmd")} color="var(--accent)" label="" />
          <Lamp cx={46} cy={LANE_Y + 6} id="Drive_RunningFB" value={input("Drive_RunningFB")} color="var(--ok)" label="" />
          <Lamp cx={66} cy={LANE_Y + 6} id="Drive_Overload" value={input("Drive_Overload")} color="var(--bad)" label="" />
          <text x={18} y={LANE_Y + 40} className="svg-small">
            cmd · fb · OL
          </text>

          <g transform="translate(18 214)">
            {[
              ["Encoder_Count", "Encoder_Count (UDINT)"],
              ["Belt_SpeedActual", "Belt_SpeedActual (REAL)"],
              ["Drive_Current", "Drive_Current (REAL)"]
            ].map(([id, label], index) => (
              <g key={id} className="clickable" onClick={select(id!)} transform={`translate(0 ${index * 18})`}>
                <title>{`${id} raw = ${formatRaw(input(id!))}`}</title>
                <text x={0} y={0} className="svg-small">
                  {label}
                </text>
                <text x={176} y={0} className="svg-mono">
                  {formatRaw(input(id!))}
                </text>
              </g>
            ))}
          </g>

          <g transform="translate(800 24)">
            <text x={0} y={0} className="svg-small">
              Stack
            </text>
            <Lamp cx={8} cy={14} id="StackLight_Red" value={output("StackLight_Red")} color="var(--bad)" label="" />
            <Lamp cx={26} cy={14} id="StackLight_Green" value={output("StackLight_Green")} color="var(--ok)" label="" />
          </g>
        </g>

        {noWorld && (
          <text x={440} y={34} textAnchor="middle" className="svg-label">
            No world in this record — last held image shown dimmed
          </text>
        )}
        {episode?.world?.blindView && (
          <text x={440} y={22} textAnchor="middle" className="svg-label" style={{ fill: "var(--reason)" }}>
            Blind view: physical entities withheld from Muse — raw signals only
          </text>
        )}
        {sealed && (
          <text x={440} y={292} textAnchor="middle" className="svg-label" style={{ fill: "var(--bad)" }}>
            Sealed fault active · identity hidden until the diagnosis is sealed
          </text>
        )}
      </svg>
      <div className="machine-note">
        Geometry from the generated world's declared CONFIG (Muse assumptions, not PLC thresholds). Belt marks follow raw Encoder_Count; cartons are recorded world entities. Click any sensor, lamp, or raw value to inspect it.
      </div>
    </section>
  );
}
