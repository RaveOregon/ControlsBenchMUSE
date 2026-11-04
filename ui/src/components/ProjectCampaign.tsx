// Campaign-page views for a selected project: the Muse-prepared, source-linked plan (grouped
// checks with stimulus and expected observation) that gates Start and then tracks each check's
// recorded outcome, campaign-added follow-ups listed separately; and a labelled signal/equipment
// view for generated worlds that have no drawn machine view.

import { useMemo } from "react";
import type { CommandResult, WorkspaceState } from "../model/workspace-store.ts";
import type { ProjectsIndex, Review } from "../projects/api.ts";
export { projectStartBlock } from "../projects/gating.ts";

const TERMINAL = ["completed", "stopped", "failed"];


export function ProjectPlanPanel({ state, index, review, onScope, onStart, startDisabledReason }: { state: WorkspaceState; index: ProjectsIndex; review?: Review;
  onScope: (ids: string[], included: boolean) => void; onStart: () => CommandResult; startDisabledReason?: string }) {
  const active = index.active;
  const projection = state.hosted?.projection;
  const started = Boolean(projection && projection.status !== "preparing");
  const locked = Boolean(projection && !TERMINAL.includes(projection.status));
  const definition = state.host?.info?.factory.scope;
  const planned = new Set(review?.plan.checks.map(c => c.id) ?? []);
  const groups = useMemo(() => { const m = new Map<string, NonNullable<Review>["plan"]["checks"]>(); for (const c of review?.plan.checks ?? []) m.set(c.group, [...(m.get(c.group) ?? []), c]); return [...m]; }, [review]);
  const selected = new Set(Object.entries(state.categoryScope ?? {}).filter(([, on]) => on).map(([id]) => id));
  const status = (id: string, group: string, available: boolean): [string, string] => {
    const e = projection?.experiments[id];
    if (e) return e.status === "completed" ? [e.conclusion === "inconclusive" ? "inconclusive" : "observed", e.conclusion === "inconclusive" ? "warn" : "info"]
      : e.status === "running" ? ["running", "info"] : TERMINAL.includes(projection!.status) ? ["not run", "warn"] : ["queued", ""];
    if (!available) return ["unavailable", "warn"];
    if (started) return ["not in this campaign", ""];
    return selected.has(group) ? ["planned", ""] : ["category not selected", "warn"];
  };
  const followups = Object.values(projection?.experiments ?? {}).filter(e => !planned.has(e.id));
  return <section className="panel" aria-label="Campaign plan">
    <header><h2>Campaign plan{active ? ` · ${active.projectName} ${active.version}` : ""}</h2>
      {review ? <span className="tag">{review.author.fixture ? "prepared by fixture author (not Muse)" : `prepared by ${review.author.label}`}</span> : active?.kind === "example" ? <span className="tag replay">prepared example</span> : null}</header>
    <div className="body">
      {!active && <p className="muted">No project selected. Choose one in Setup.</p>}
      {active?.kind === "example" && <p className="muted">Prepared example: it has no pre-run plan. As in its historical campaigns, the plan is formed after Start; the checks appear here as the campaign records them.</p>}
      {review && <p>{review.plan.objective} <span className="muted">· preparation ran no PLC test; nothing here has passed until a campaign records it.</span></p>}
      {definition && <div className="scope-row" role="group" aria-label="Campaign categories">{definition.choices.map(choice => {
        const count = review?.plan.checks.filter(c => c.group === choice.id && c.available).length;
        return <label key={choice.id}><input type="checkbox" checked={state.categoryScope?.[choice.id] === true} disabled={locked} onChange={e => onScope([choice.id], e.target.checked)} /> {choice.title}{count !== undefined ? <span className="muted"> ({count})</span> : null}</label>;
      })}</div>}
      {groups.map(([group, checks]) => <div key={group} className="plan-group"><h3>{group}</h3>
        <table className="results-table"><thead><tr><th>Check</th><th>Stimulus</th><th>Expected observation</th><th>Status</th></tr></thead><tbody>{checks.map(c => {
          const [label, tone] = status(c.id, c.group, c.available);
          return <tr key={c.id}><td><span className="mono">{c.id}</span><div>{c.title}</div><div className="muted">{[...c.requirementRefs, ...c.sourceRefs].join(", ")}</div></td>
            <td>{c.stimulus}{c.worldControls.length > 0 && <div className="muted mono">{c.worldControls.join(", ")}</div>}</td>
            <td><span className={`tag ${c.expectedBasis === "specified" ? "tone-ok" : "tone-warn"}`}>{c.expectedBasis === "specified" ? "specified" : "not specified"}</span> {c.expectedObservation}</td>
            <td className={`tone-${tone}`}>{label}{!c.available && <div className="muted">{c.unavailableReason}</div>}</td></tr>;
        })}</tbody></table></div>)}
      {(followups.length > 0 || started) && <><h3>Added during the campaign</h3>{followups.length ? <ul>{followups.map(e => <li key={e.id}><span className="mono">{e.id}</span> [{e.category}] {e.objective} — <span className={e.status === "completed" ? "tone-info" : ""}>{e.status === "completed" ? e.conclusion : e.status}</span></li>)}</ul>
        : <p className="muted">None yet.</p>}</>}
      {!locked && <div className="actions"><button className="btn primary" disabled={Boolean(startDisabledReason)} title={startDisabledReason} onClick={() => onStart()}>Start campaign</button>
        <span className="muted">{startDisabledReason ?? (projection && TERMINAL.includes(projection.status) ? "Previous campaign finished; Start runs this plan again from a fresh campaign." : "Start runs this exact project version through the isolated engine.")}</span></div>}
    </div>
  </section>;
}

/** Signal/equipment view for a generated world without a drawn machine view. */
export function ProjectSignalView({ state, index, review }: { state: WorkspaceState; index: ProjectsIndex; review?: Review }) {
  const signals = review?.compatibility?.signals ?? [];
  const entities = Object.entries(state.entities);
  const value = (id: string, direction: string) => { const v = direction === "world_to_plc" ? state.inputs[id] : state.outputs[id]; return v ? String(v.value) : "—"; };
  return <section className="panel" aria-label="Project signal view">
    <header><h2>Signals and equipment · {index.active?.projectName} {index.active?.version}</h2><span className="tag">signal view · no generated drawing</span></header>
    <div className="body">
      <p className="muted">This generated world has no drawn machine view yet. Values are the campaign's own raw inputs and PLC outputs; items are the world's published entities.</p>
      <div className="signal-columns">{(["world_to_plc", "plc_to_world"] as const).map(direction => <div key={direction}><h3>{direction === "world_to_plc" ? "World → PLC (raw inputs)" : "PLC → world (outputs)"}</h3>
        <table className="results-table compact"><tbody>{signals.filter(s => s.direction === direction).map(s => <tr key={s.id}><td className="mono">{s.id}</td><td className="muted">{s.role}</td><td className="mono">{value(s.id, direction)}</td></tr>)}</tbody></table></div>)}</div>
      <h3>Items</h3>{entities.length ? <ul>{entities.map(([id, e]) => <li key={id} className="mono">{id} ({e.type}) {typeof e.state.positionM === "number" ? `at ${(e.state.positionM as number).toFixed(3)} m` : ""}{typeof e.state.velocityMps === "number" ? ` · ${(e.state.velocityMps as number).toFixed(3)} m/s` : ""}</li>)}</ul> : <p className="muted">No items in the world.</p>}
    </div>
  </section>;
}
