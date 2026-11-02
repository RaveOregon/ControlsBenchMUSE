import { useState } from "react";
import type { CheckStatus } from "../model/events.ts";
import { PLAN_GROUPS } from "../model/plan.ts";
import type { CommandResult, CheckState, WorkspaceState } from "../model/workspace-store.ts";
import { evidenceTag } from "./labels.ts";
import type { Selection } from "./selection.ts";

const STATUS_LABEL: Record<CheckStatus, string> = {
  planned: "planned",
  out_of_scope: "out of scope",
  running: "running",
  pass: "pass",
  fail: "fail",
  inconclusive: "inconclusive",
  not_run: "not run"
};

const STATUS_COLOR: Partial<Record<CheckStatus, string>> = {
  pass: "var(--ok)",
  fail: "var(--bad)",
  inconclusive: "var(--warn)",
  running: "var(--accent)",
  not_run: "var(--text-3)"
};

interface Props {
  state: WorkspaceState;
  worldName: string;
  worldVersion: string;
  signalCounts: { inputs: number; outputs: number };
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onScope: (ids: string[], included: boolean) => void;
  onStart: () => CommandResult;
  startDisabledReason?: string;
}

function CheckRow({ check, state, open, selected, locked, onToggle, onSelect, onScope }: { check: CheckState; state: WorkspaceState; open: boolean; selected: boolean; locked: boolean; onToggle: () => void; onSelect: () => void; onScope: (included: boolean) => void }) {
  const tag = evidenceTag(check.evidenceClass, state.mode, check.availability);
  return (
    <div className={`check${selected ? " selected" : ""}`}><button className="check-toggle" onClick={onToggle} aria-expanded={open} aria-label={`Expand ${check.id}: ${check.title}`}>▸</button>
      <span className={`status-dot ${check.status}`} title={STATUS_LABEL[check.status]} />
      <div className="line">
        {check.addedBy === "plan" && (
          <input
            type="checkbox" aria-label={`Include ${check.id} ${check.title}`}
            className="scope-box"
            checked={state.scope[check.id] === true}
            disabled={locked}
            title={locked ? "Scope is locked once the campaign starts" : "Include in campaign scope"}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onScope(event.target.checked)}
          />
        )}
        <span className="id">{check.id}</span>
        <span className="name">{check.title}</span>
      </div>
      {open && (
        <div className="detail" onClick={(event) => event.stopPropagation()}>
          <p>
            <span className={`tag ${tag.cls}`} title={tag.title}>
              {tag.text}
            </span>{" "}
            {check.addedBy === "muse" && <span className="tag muse">added by Muse</span>} <span style={{ color: STATUS_COLOR[check.status] }}>{STATUS_LABEL[check.status]}</span>
            {check.requirement && <span className="muted"> · {check.requirement}</span>}
          </p>
          <p>
            <b>Manipulate</b> {check.manipulate}
          </p>
          <p>
            <b>Observe</b> {check.observe}
          </p>
          <p>
            <b>Pass if</b> {check.oracle}
          </p>
          <p>
            <b>Evidence</b> <span className="mono">{check.evidenceSource}</span>
          </p>
          {check.summary && (
            <p>
              <b>Result</b> {check.summary}
            </p>
          )}
          <button className="btn small" onClick={onSelect}>
            Inspect
          </button>
        </div>
      )}
    </div>
  );
}

export function PlanPanel({ state, worldName, worldVersion, signalCounts, selection, onSelect, onScope, onStart, startDisabledReason }: Props) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ functional: true, adaptive: true });
  const [openChecks, setOpenChecks] = useState<Record<string, boolean>>({});
  const [startNote, setStartNote] = useState<string>();
  const locked = state.phase === "running" || state.phase === "paused" || state.phase === "budget_hold";
  const checks = state.checkOrder.map((id) => state.checks[id]!).filter(Boolean);
  const scoped = checks.filter((check) => state.scope[check.id]);
  const recorded = scoped.filter((check) => check.availability === "recorded").length;
  const tally = (status: CheckStatus) => scoped.filter((check) => check.status === status).length;
  const done = tally("pass") + tally("fail") + tally("inconclusive") + tally("not_run");
  const groups = [...PLAN_GROUPS, { id: "evidence" as const, title: "Evidence preservation", blurb: "Closing audit of the preserved run record." }];
  const limits = state.budget.limits;

  const definition = state.host?.info?.factory.scope;
  if (definition) return <section className="panel" aria-label="Campaign plan">
    <header><h2>Campaign categories</h2><span className="tag">{state.host?.info?.factory.evidenceClass === "preserved_live_plc" ? "recorded evidence review" : "Wonder-directed"}</span></header>
    <div className="body"><p>{state.host?.info?.factory.label}</p><p>{definition.description}</p>
      {state.scopeNotice && <p role="status">{state.scopeNotice}</p>}
      {definition.choices.map(choice => <label key={choice.id} style={{ display: "block", marginBottom: 8 }}>
        <input type="checkbox" aria-label={`Include ${choice.title}`} checked={state.categoryScope?.[choice.id] === true} disabled={locked} onChange={e => onScope([choice.id], e.target.checked)} /> {choice.title}
      </label>)}
      {!locked && <button className="btn primary" disabled={Boolean(startDisabledReason)} onClick={() => { const result = onStart(); setStartNote(result.ok ? undefined : result.reason); }}>Start Campaign</button>}
      <p className="muted">{startNote ?? startDisabledReason ?? "Start authorizes only these categories. The authoritative plan appears as the provider creates experiments."}</p>
      {Object.values(state.hosted?.projection?.experiments ?? {}).map(e => <p key={e.id}><b>{e.id}</b> · {e.objective} · {e.status}</p>)}
    </div>
  </section>;

  return (
    <section className="panel" aria-label="Campaign plan">
      <header>
        <h2>Campaign</h2>
        <span className="spacer" />
        <span className={`tag ${state.mode}`}>{state.mode === "replay" ? "replay" : "live"}</span>
      </header>
      <div className="body summary-card">
        <p>
          <b style={{ color: "var(--text)" }}>{worldName}</b> · world v{worldVersion} · {signalCounts.inputs} raw inputs / {signalCounts.outputs} PLC outputs · Muse Wonder 1.0
        </p>
        <div className="summary-stats">
          <span>
            <b>{scoped.length}</b> checks in scope
          </span>
          <span>
            <b>{recorded}</b> with preserved evidence
          </span>
          <span>
            <b>{scoped.length - recorded}</b> awaiting live
          </span>
          <span>
            budget <b>${(limits?.campaignHardUsd ?? 5).toFixed(2)}</b> hard stop
          </span>
        </div>
        {state.phase === "ready" || state.phase === "stopped" || state.phase === "completed" || state.phase === "failed" ? (
          <>
            <button
              className="btn primary"
              style={{ width: "100%", padding: "8px" }}
              disabled={Boolean(startDisabledReason)}
              title={startDisabledReason}
              onClick={() => {
                const result = onStart();
                setStartNote(result.ok ? undefined : result.reason);
              }}
            >
              {state.mode === "replay" ? "Play recorded campaign" : state.phase === "ready" ? "Start Campaign" : "Start New Campaign"}
            </button>
            <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              {startNote ?? startDisabledReason ?? "Review the selected scope. Replay plays preserved evidence only; live campaign actions require coordinator confirmation."}
            </p>
          </>
        ) : (
          <>
            <div className="progress" title={`${done} of ${scoped.length} checks finished`}>
              <i style={{ width: `${(tally("pass") / Math.max(1, scoped.length)) * 100}%`, background: "var(--ok)" }} />
              <i style={{ width: `${(tally("inconclusive") / Math.max(1, scoped.length)) * 100}%`, background: "var(--warn)" }} />
              <i style={{ width: `${(tally("fail") / Math.max(1, scoped.length)) * 100}%`, background: "var(--bad)" }} />
              <i style={{ width: `${(tally("not_run") / Math.max(1, scoped.length)) * 100}%`, background: "var(--line-strong)" }} />
              <i style={{ width: `${(tally("running") / Math.max(1, scoped.length)) * 100}%`, background: "var(--accent)" }} />
            </div>
            <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              {done}/{scoped.length} finished · {tally("pass")} pass · {tally("inconclusive")} inconclusive · {tally("fail")} fail · {tally("not_run")} not run · scope locked — steer below
            </p>
          </>
        )}
      </div>
      {groups.map((group) => {
        const members = checks.filter((check) => check.group === group.id);
        if (members.length === 0 && group.id !== "adaptive") return null;
        const open = openGroups[group.id] === true;
        const plannedMembers = members.filter((check) => check.addedBy === "plan");
        const allIn = plannedMembers.length > 0 && plannedMembers.every((check) => state.scope[check.id]);
        const counts = (["pass", "inconclusive", "fail", "running", "not_run"] as CheckStatus[]).map((status) => [status, members.filter((check) => check.status === status).length] as const).filter(([, count]) => count > 0);
        return (
          <div className="group" key={group.id}>
            <div className="group-head" title={group.blurb}>
              <span className={`chev${open ? " open" : ""}`}>▸</span>
              {plannedMembers.length > 0 && (
                <input type="checkbox" aria-label={`Include ${group.title}`} className="scope-box" checked={allIn} disabled={locked} title={locked ? "Scope is locked once the campaign starts" : "Include group in scope"} onClick={(event) => event.stopPropagation()} onChange={(event) => onScope(plannedMembers.map((check) => check.id), event.target.checked)} />
              )}
              <button className="group-toggle title" aria-expanded={open} onClick={() => setOpenGroups({ ...openGroups, [group.id]: !open })}>{group.title}</button>
              <span className="counts">
                {counts.length === 0 ? (
                  <span className="muted">{members.length}</span>
                ) : (
                  counts.map(([status, count]) => (
                    <span key={status} style={{ color: STATUS_COLOR[status] }} title={STATUS_LABEL[status]}>
                      {count} {STATUS_LABEL[status]}
                    </span>
                  ))
                )}
              </span>
            </div>
            {open && members.length === 0 && <div className="check muted" style={{ cursor: "default" }}>Muse adds investigations here when observations warrant them.</div>}
            {open &&
              members.map((check) => (
                <CheckRow
                  key={check.id}
                  check={check}
                  state={state}
                  open={openChecks[check.id] === true}
                  selected={selection?.type === "check" && selection.id === check.id}
                  locked={locked}
                  onToggle={() => setOpenChecks({ ...openChecks, [check.id]: !openChecks[check.id] })}
                  onSelect={() => onSelect({ type: "check", id: check.id })}
                  onScope={(included) => onScope([check.id], included)}
                />
              ))}
          </div>
        );
      })}
    </section>
  );
}
