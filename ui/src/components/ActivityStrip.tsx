import type { ActivityView, HealthPill } from "../model/activity.ts";
import { formatClock, formatSeconds } from "../model/format.ts";

const ANIMATED = new Set(["active", "reasoning", "waiting"]);

function Pill({ pill }: { pill: HealthPill }) {
  return (
    <div className={`pill tone-${pill.tone}`} title={`${pill.label}: ${pill.value}`}>
      <span className="label">{pill.label}</span>
      <span className="value">{pill.value}</span>
    </div>
  );
}

export function ActivityStrip({ view, speedNote }: { view: ActivityView; speedNote?: string }) {
  const animate = ANIMATED.has(view.tone);
  return (
    <section className="activity" aria-live="polite" aria-label={speedNote?.startsWith("replay") ? "Recorded activity" : "Live activity"}>
      <div className="activity-main">
        <span className={`pulse tone-${view.tone}${animate ? " animate" : ""}`} aria-hidden />
        <div style={{ minWidth: 0 }}>
          {view.progress && <div className="activity-progress">{view.progress}</div>}
          <div className="headline" title={view.headline}>
            {view.tone === "reasoning" ? <span className="shimmer">{view.headline}</span> : view.headline}
          </div>
          <div className="activity-meta">
            <span>
              Elapsed <b className="mono">{view.elapsedLabel}</b>
            </span>
            {view.detail && <span title={view.detail}>{view.detail.length > 140 ? `${view.detail.slice(0, 139)}…` : view.detail}</span>}
            {view.exercise && <span className="exercise-tag">recorded guard exercise</span>}
          </div>
          <div className="activity-meta">
            <span>
              Campaign <b className="mono">{view.campaignElapsedMs === undefined ? "—" : formatClock(view.campaignElapsedMs)}</b>
              {speedNote && <span className="muted"> · {speedNote}</span>}
            </span>
            <span title={view.lastMeaningful}>
              Last meaningful activity{" "}
              <b className="mono">{view.sinceLastMeaningfulMs === undefined ? "—" : `${formatSeconds(view.sinceLastMeaningfulMs)} ago`}</b>
              {view.lastMeaningful && <span className="muted"> · {view.lastMeaningful.length > 90 ? `${view.lastMeaningful.slice(0, 89)}…` : view.lastMeaningful}</span>}
            </span>
          </div>
          {view.diagnostic && <details className="activity-diagnostics"><summary>Timing details</summary><p>{view.diagnostic}. Full precision remains in the evidence log.</p></details>}
        </div>
      </div>
      <div className="health" aria-label="Component health">
        <Pill pill={view.health.muse} />
        <Pill pill={view.health.coordinator} />
        <Pill pill={view.health.connector} />
        <Pill pill={view.health.world} />
        <Pill pill={view.health.plc} />
      </div>
    </section>
  );
}
