import { formatMs, formatSeconds, percentile } from "../model/format.ts";
import { plcStaleThresholdMs } from "../model/activity.ts";
import type { WorkspaceState } from "../model/workspace-store.ts";
import { shortSource } from "./labels.ts";

export function ConnectionPanel({ state, nowMs }: { state: WorkspaceState; nowMs: number }) {
  const c = state.connection;
  const replay = state.mode === "replay" || state.hosted?.evidenceClass === "preserved_live_plc";
  const scale = state.episode?.timeScale ?? 1;
  const timed = state.episode ? state.episode.clock !== "discrete" : !replay;
  const sorted = [...c.latencies].sort((left, right) => left - right);
  const outstanding = c.commits - c.acks;
  const heartbeatAge = c.lastPlcHeartbeatAtMs !== undefined && (!replay || state.episode?.plcExpected) ? Math.max(0, nowMs - c.lastPlcHeartbeatAtMs) * scale : undefined;
  const staleMs = plcStaleThresholdMs(c.publishingIntervalMs);
  const linkText = c.link === "none" ? "no session" : c.link;
  const recordedAt = c.provenance?.recordedAt;

  return (
    <section className="panel" aria-label="Connection and authority">
      <header>
        <h2>Connection & authority</h2>
        <span style={{ flex: 1 }} />
        <span className={`tag ${replay ? "replay" : "live"}`} title={replay ? "Values come from preserved records; no PLC is connected to this workspace." : "Values are observed now."}>
          {replay ? "recorded · not live" : "live"}
        </span>
      </header>
      <div className="body">
        {replay && (
          <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
            This panel re-presents recorded connector/PLC evidence{recordedAt ? ` (last source recorded ${recordedAt})` : ""}{c.provenance ? ` from ${shortSource(c.provenance)}` : ""}. Current review activity and any separately observed HMI session have their own status.
          </p>
        )}
        {!replay && state.episode && !state.episode.connectorExpected && c.link !== "none" && (
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--wait)" }}>
            The current record ({state.episode.title}) {state.episode.world ? "uses the surrogate PLC-output driver" : "has no connector"}; values below are from the last recorded connector session, not this record.
          </p>
        )}
        <dl className="kv">
          <dt>PLC runtime</dt>
          <dd>{c.serverProduct ?? <span className="muted">not reported</span>}</dd>
          <dt>Endpoint</dt>
          <dd className="mono">{c.endpoint ?? "—"}</dd>
          <dt>Link</dt>
          <dd>
            <span style={{ color: c.link === "up" ? "var(--ok)" : c.link === "lost" ? "var(--bad)" : "var(--text-2)" }}>{linkText}</span>
            {replay && c.link !== "none" && <span className="muted"> (recorded)</span>}
            {c.linkDetail && <span className="muted"> · {c.linkDetail}</span>}
          </dd>
          <dt>Transport</dt>
          <dd>{c.transport ? `${c.transport} · ${c.securityMode} · ${c.securityPolicy} · ${c.identity}` : "—"}</dd>
          <dt>Negotiated</dt>
          <dd>
            {c.publishingIntervalMs !== undefined ? (
              <>
                publish <span className="mono">{c.publishingIntervalMs} ms</span> (req {c.requestedPublishingIntervalMs}) · sampling <span className="mono">{c.samplingIntervalMs} ms</span>
              </>
            ) : (
              "—"
            )}
          </dd>
          <dt>Measured cadence</dt>
          <dd>
            {sorted.length > 0 ? (
              <>
                ack p50 <span className="mono">{formatMs(percentile(sorted, 50))}</span> · p99 <span className="mono">{formatMs(percentile(sorted, 99))}</span> <span className="muted">(last {sorted.length})</span>
              </>
            ) : (
              <span className="muted">no timed acknowledgements yet</span>
            )}
            <div className="muted" style={{ fontSize: 11 }}>
              M3 sustained-rate tier: not yet measured
            </div>
          </dd>
          <dt>Simulation</dt>
          <dd>
            requested <b>{c.simulationRequested ? "simulated inputs" : "hardware passthrough"}</b>
            <span className="muted"> (engineer)</span>
            <br />
            applied <b>{c.simulationApplied === null ? "not reported" : c.simulationApplied ? "yes" : "no"}</b>
            <span className="muted"> · {c.simulationDetail}</span>
          </dd>
          <dt>Workstation seq</dt>
          <dd className="mono">
            {c.workstationSequence ?? "—"}
            {c.epoch && <span className="muted"> · epoch {c.epoch}</span>}
          </dd>
          <dt>PLC applied seq</dt>
          <dd className="mono">
            {c.appliedSequence ?? "—"}
            {outstanding > 0 && <span style={{ color: "var(--wait)" }}> · {outstanding} awaiting echo</span>}
          </dd>
          <dt>Ack lag</dt>
          <dd className="mono">{c.lastAckLatencyMs === undefined ? "—" : c.lastAckLatencyMs === null ? "not recorded" : formatMs(c.lastAckLatencyMs)}</dd>
          <dt>Boot identity</dt>
          <dd className="mono">
            {c.bootIdentity ?? "—"}
            {c.previousBootIdentity && <div className="muted">changed from {c.previousBootIdentity} → new epoch required</div>}
            {c.plcRestarting && <div style={{ color: "var(--warn)" }}>restart in progress</div>}
          </dd>
          <dt>Heartbeat</dt>
          <dd>
            {c.plcCycle ? <span className="mono">cycle {c.plcCycle}</span> : "—"}
            {heartbeatAge !== undefined && state.episode?.plcExpected && timed && (
              <span style={{ color: heartbeatAge > staleMs ? "var(--bad)" : "var(--text-2)" }}>
                {" "}
                · {formatSeconds(heartbeatAge, 2)} ago {heartbeatAge > staleMs ? "· STALE" : ""}
              </span>
            )}
            <div className="muted" style={{ fontSize: 11 }}>
              stale after {staleMs} ms (max 500 ms, 3× publish)
            </div>
          </dd>
        </dl>
        {c.cases.length > 0 && (
          <>
            <div className="section-title">Recent connector cases</div>
            <ul className="case-list">
              {c.cases.slice(-5).map((testCase, index) => (
                <li key={`${testCase.name}-${index}`} title={testCase.detail}>
                  <span style={{ color: testCase.accepted === testCase.expectedAccepted ? "var(--ok)" : "var(--bad)" }}>{testCase.accepted === testCase.expectedAccepted ? "✓" : "✗"}</span>
                  <span className="mono">{testCase.name}</span>
                  <span className="muted">{testCase.accepted ? "accepted" : "rejected"}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
