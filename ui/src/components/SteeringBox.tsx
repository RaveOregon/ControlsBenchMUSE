import { useState } from "react";
import { formatClock } from "../model/format.ts";
import type { CommandResult, WorkspaceState } from "../model/workspace-store.ts";

export function SteeringBox({ state, onSteer }: { state: WorkspaceState; onSteer: (text: string) => CommandResult }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<string>();
  const submit = () => {
    const result = onSteer(text);
    if (result.ok) {
      setText("");
      setNote(undefined);
    } else setNote(result.reason);
  };
  return (
    <section className="panel steer" aria-label="Steer Muse">
      <header>
        <h2>Steer Muse</h2>
      </header>
      <div className="body">
        <textarea
          value={text}
          aria-label="Direction for Muse"
          placeholder="e.g. Spend more time on divert 2 jams; skip multi-carton spacing for now."
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit();
          }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
          <button className="btn" onClick={submit} disabled={!text.trim()}>
            {state.mode === "replay" ? "Record direction locally" : "Send direction"}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            {note ?? (state.mode === "replay" ? "Replay records your direction in the run record; no model is called." : "Requires coordinator application acknowledgement.")}
          </span>
        </div>
        {state.steering.length > 0 && (
          <ul className="steer-log">
            {state.steering
              .slice()
              .reverse()
              .map((entry) => (
                <li key={entry.id}>
                  <span className="mono muted">{formatClock(entry.atMs)}</span> {entry.text}
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}
