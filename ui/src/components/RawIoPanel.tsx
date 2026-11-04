import { signalHealth } from "../model/signal-health.ts";
import { formatClock, formatRaw } from "../model/format.ts";
import type { CommandResult, WorkspaceState } from "../model/workspace-store.ts";
import type { Selection } from "./selection.ts";

interface Props {
  state: WorkspaceState;
  nowMs: number;
  onSelect: (selection: Selection) => void;
  onSuppress: (outputId: string, suppressed: boolean) => CommandResult;
}

export function RawIoPanel({ state, nowMs, onSelect, onSuppress }: Props) {
  // The current portal host has no physical-sink write capability.
  const sinkUnavailable = state.mode === "live" && state.host
    ? "Output overrides are unavailable through this host. Configure physical-sink behavior at the PLC interceptor; PLC commands remain visible here."
    : undefined;
  const inputs = state.signals.filter((signal) => signal.direction === "world_to_plc");
  const outputs = state.signals.filter((signal) => signal.direction === "plc_to_world");
  const latest = Object.values(state.inputs).reduce<{ run?: string; source?: string; atMs: number } | null>((best, value) => (value.atMs !== undefined && (!best || value.atMs > best.atMs) ? { run: value.run, source: value.source, atMs: value.atMs } : best), null);
  const imageSource = latest?.source ? `${latest.source.split("/").at(-1)}${latest.run ? ` · ${latest.run}` : ""}` : latest ? "workspace command" : "no image yet";
  const recent = (atMs: number | undefined) => atMs !== undefined && nowMs - atMs < 250;

  return (
    <section className="panel" aria-label="Raw I/O">
      <header>
        <h2>Raw I/O</h2>
        <span style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 11 }} title="Where the currently displayed raw image came from">
          image: {imageSource}
        </span>
      </header>
      <div className="body" style={{ padding: "4px 6px 8px" }}>
        {sinkUnavailable && <p className="muted">{sinkUnavailable}</p>}
        <table className="io-table">
          <thead>
            <tr>
              <th>World → PLC ({inputs.length})</th>
              <th>Type</th>
              <th style={{ textAlign: "right" }}>Raw</th>
              <th style={{ textAlign: "right" }}>Changed</th>
            </tr>
          </thead>
          <tbody>
            {inputs.map((signal) => {
              const value = state.inputs[signal.id];
              return (
                <tr key={signal.id} className={recent(value?.atMs) ? "flash" : undefined} title={value?.cause ?? signal.description}>
                  <td><button className="text-button" onClick={() => onSelect({ type: "signal", id: signal.id })}>{signal.id}</button><small className={`quality-${signalHealth(value, state, nowMs).split(" ")[0]}`} style={{ display: "block" }}>{signalHealth(value, state, nowMs)}</small></td>
                  <td className="muted">{signal.dataType}</td>
                  <td className="value">{formatRaw(value?.value)}</td>
                  <td className="value muted">{value?.atMs !== undefined ? formatClock(value.atMs) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <table className="io-table" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>PLC → World ({outputs.length})</th>
              <th>Origin</th>
              <th style={{ textAlign: "right" }}>Raw</th>
              <th style={{ textAlign: "right" }} title="Physical sink suppression is engineer configuration; the command is still observed.">
                Sink
              </th>
            </tr>
          </thead>
          <tbody>
            {outputs.map((signal) => {
              const value = state.outputs[signal.id];
              const suppressed = state.suppressedOutputs[signal.id] === true;
              return (
                <tr key={signal.id} className={recent(value?.atMs) ? "flash" : undefined} title={signal.description}>
                  <td><button className="text-button" onClick={() => onSelect({ type: "signal", id: signal.id })}>{signal.id}</button><small className={`quality-${signalHealth(value, state, nowMs).split(" ")[0]}`} style={{ display: "block" }}>{signalHealth(value, state, nowMs)}</small></td>
                  <td className="muted">{value?.origin === "surrogate_driver" ? "surrogate" : value?.origin === "muse_surrogate" ? "Muse→surrogate" : value?.origin ?? "—"}</td>
                  <td className="value">{formatRaw(value?.value)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn small"
                      data-control="sink-suppression"
                      aria-label={`${signal.id} physical-sink override`}
                      disabled={Boolean(sinkUnavailable) || Object.values(state.commands).some(c => c.outcome === "pending")}
                      style={suppressed ? { color: "var(--warn)", borderColor: "var(--warn)" } : undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (sinkUnavailable) return;
                        onSuppress(signal.id, !suppressed);
                      }}
                      title={sinkUnavailable ?? (suppressed ? "Physical sink suppressed; PLC command still traced. Click to release." : "Physical sink active. Click to suppress (engineer configuration).")}
                    >
                      {sinkUnavailable ? "unavailable" : Object.values(state.commands).some(c => c.outcome === "pending" && c.payload?.outputId === signal.id) ? "pending…" : suppressed ? "suppressed" : "physical"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
