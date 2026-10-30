import { formatClock, formatSeconds, formatUsd } from "../model/format.ts";
import type { WorkspaceState } from "../model/workspace-store.ts";

function Meter({ value, max, marks, color }: { value: number; max: number; marks?: Array<{ at: number; color: string; title: string }>; color: string }) {
  return (
    <div className="meter" role="meter" aria-valuenow={value} aria-valuemax={max}>
      <i style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
      {marks?.map((mark) => <b key={mark.title} title={mark.title} style={{ left: `${(mark.at / max) * 100}%`, background: mark.color }} />)}
    </div>
  );
}

export function BudgetPanel({ state, nowMs }: { state: WorkspaceState; nowMs: number }) {
  const budget = state.budget;
  const limits = budget.limits;
  const calls = state.agent.calls;
  const active = state.agent.active;
  const scale = state.episode?.timeScale ?? 1;
  const failedCalls = calls.filter((call) => call.failed).length;
  const outputTokens = calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0);
  const levelColor = budget.level === "hard_stop" ? "var(--bad)" : budget.level === "warning" ? "var(--warn)" : "var(--ok)";
  const activeAge = active ? (nowMs - active.startedAtMs) * scale : 0;
  const repairEpisodes = Object.entries(budget.repairSpentUsd);
  const elapsed = state.startedAtMs !== undefined ? (state.endedAtMs ?? nowMs) - state.startedAtMs : 0;

  return (
    <section className="panel" aria-label="Budget and progress">
      <header>
        <h2>Budget</h2>
        <span style={{ flex: 1 }} />
        <span className="tag" style={{ color: levelColor, borderColor: levelColor }}>
          {budget.level.replace("_", " ")}
        </span>
      </header>
      <div className="body">
        {!limits ? (
          <p className="muted" style={{ margin: 0 }}>
            Limits load when the campaign starts.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
              <span>
                Campaign <b className="mono">{formatUsd(budget.spentUsd)}</b> / {formatUsd(limits.campaignHardUsd)} hard
              </span>
              <span className="muted">
                reserved <span className="mono">{formatUsd(budget.reservedUsd)}</span>
              </span>
            </div>
            <Meter
              value={budget.spentUsd + budget.reservedUsd}
              max={limits.campaignHardUsd}
              color={levelColor}
              marks={[
                { at: limits.campaignWarningUsd, color: "var(--warn)", title: `Warning at ${formatUsd(limits.campaignWarningUsd)}` },
                { at: budget.spentUsd, color: "var(--text)", title: "Settled spend" }
              ]}
            />
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Model calls</dt>
              <dd>
                <span className="mono">{calls.length}</span> settled{failedCalls > 0 && <span style={{ color: "var(--warn)" }}> · {failedCalls} rejected artifact</span>}
                {active && <span style={{ color: "var(--reason)" }}> · 1 in flight</span>}
                <span className="muted"> · {outputTokens.toLocaleString("en-US")} output tokens</span>
              </dd>
              <dt>In-flight request</dt>
              <dd>
                {active ? (
                  <>
                    <div style={{ fontSize: 12 }}>
                      {active.purpose.replace(/_/g, " ")} · <span className="mono">{formatSeconds(activeAge)}</span> of {formatClock(active.timeoutMs)} limit · {formatUsd(active.reservedUsd)} reserved
                    </div>
                    <Meter value={activeAge} max={active.timeoutMs} color="var(--reason)" />
                  </>
                ) : (
                  <span className="muted">none</span>
                )}
              </dd>
              {repairEpisodes.map(([episode, spent]) => (
                <div key={episode} style={{ display: "contents" }}>
                  <dt>Repair episode</dt>
                  <dd>
                    <span className="mono">{formatUsd(spent)}</span> / {formatUsd(limits.repairEpisodeUsd)} · failed {budget.failedRepairs[episode] ?? 0} (warn {limits.failedRepairWarning}, stop {limits.failedRepairHard})
                  </dd>
                </div>
              ))}
              <dt>Campaign time</dt>
              <dd className="mono">{formatClock(elapsed)}</dd>
              <dt>Per request</dt>
              <dd>
                {formatUsd(limits.perRequestUsd)} max · {formatClock(limits.requestTimeoutMs)} timeout · session {formatUsd(limits.sessionHardUsd)}
              </dd>
            </dl>
            <div className="budget-explainer">
              Before each call a worst-case cost is reserved; a call that cannot fit is refused. At {formatUsd(limits.campaignHardUsd)} Muse makes no further model calls and the last valid image is held until you extend or stop. Every request is aborted at {formatClock(limits.requestTimeoutMs)}, so a hung model cannot keep spending.
              {state.mode === "replay" && <div className="muted" style={{ marginTop: 4 }}>Replay spends nothing: figures are the recorded Gate C conservative reservations (exact provider billing was not returned).</div>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
