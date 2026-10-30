import { useState } from "react";
import type { SourceMode } from "../model/events.ts";
import type { CommandResult, WorkspaceState } from "../model/workspace-store.ts";

interface Props {
  state: WorkspaceState;
  mode: SourceMode;
  liveAttached: boolean;
  onMode: (mode: SourceMode) => void;
  speed: number;
  speeds: readonly number[];
  onSpeed: (speed: number) => void;
  onSkip: () => CommandResult;
  onSources: () => void;
  commands: {
    pause: () => CommandResult;
    resume: () => CommandResult;
    stop: () => CommandResult;
    reset: () => CommandResult;
    exitSimulation: () => CommandResult;
    enterSimulation: () => CommandResult;
  };
  can: (command: "pause" | "resume" | "stop" | "reset_simulation" | "exit_simulation" | "enter_simulation") => CommandResult;
}

export function TopBar({ state, mode, liveAttached, onMode, speed, speeds, onSpeed, onSkip, onSources, commands, can }: Props) {
  const [note, setNote] = useState<string>();
  const [confirmExit, setConfirmExit] = useState(false);
  const run = (command: () => CommandResult) => () => {
    const result = command();
    setNote(result.ok ? undefined : result.reason);
  };
  const reason = (result: CommandResult) => (result.ok ? undefined : result.reason);
  const paused = state.phase === "paused";
  const simulated = state.connection.simulationRequested;
  const pauseCheck = can(paused ? "resume" : "pause");
  const stopCheck = can("stop");
  const resetCheck = can("reset_simulation");
  const exitCheck = can(simulated ? "exit_simulation" : "enter_simulation");

  return (
    <header className="topbar">
      <div className="brand">
        ControlsBench Muse<small>campaign workspace</small>
      </div>
      {mode === "replay" ? (
        <span className="mode-badge replay" title="Everything shown is re-presented from preserved Gate A–D and M0–M2 records. Nothing here is live.">
          REPLAY <span className="sub">recorded evidence · nothing here is live</span>
        </span>
      ) : (
        <span className={`mode-badge live${liveAttached ? "" : " detached"}`}>
          LIVE <span className="sub">{liveAttached ? "coordinator attached" : "no coordinator attached"}</span>
        </span>
      )}
      <div className="segmented" role="group" aria-label="Evidence source">
        <button aria-pressed={mode === "replay"} onClick={() => onMode("replay")}>
          Replay
        </button>
        <button aria-pressed={mode === "live"} onClick={() => onMode("live")}>
          Live
        </button>
      </div>
      {mode === "replay" && (
        <>
          <div className="segmented" role="group" aria-label="Replay speed" title="Replay playback speed. Elapsed times stay on each record's own clock.">
            {speeds.map((option) => (
              <button key={option} aria-pressed={speed === option} onClick={() => onSpeed(option)}>
                {option}×
              </button>
            ))}
          </div>
          <button className="btn small" onClick={run(onSkip)} title="Replay only: jump to the next recorded episode">
            Skip to next record
          </button>
        </>
      )}
      <span className="spacer" />
      <div className="controls">
        {note && <span className="command-note">{note}</span>}
        <button className="btn" disabled={!pauseCheck.ok} title={reason(pauseCheck) ?? (paused ? "Resume from the held image" : "Freeze world evolution and hold the current raw image")} onClick={run(paused ? commands.resume : commands.pause)}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button className="btn" disabled={!stopCheck.ok} title={reason(stopCheck) ?? "Finalize the run record and hold the final image for inspection"} onClick={run(commands.stop)}>
          Stop
        </button>
        <button className="btn" disabled={!resetCheck.ok} title={reason(resetCheck) ?? "Zero the complete simulated DI/AI image; stay in simulation"} onClick={run(commands.reset)}>
          Reset Simulation
        </button>
        {simulated ? (
          confirmExit ? (
            <>
              <button
                className="btn danger"
                onClick={() => {
                  run(commands.exitSimulation)();
                  setConfirmExit(false);
                }}
              >
                Confirm: return to hardware
              </button>
              <button className="btn" onClick={() => setConfirmExit(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn danger" disabled={!exitCheck.ok} title={reason(exitCheck) ?? "Deliberately return interceptor authority to hardware passthrough"} onClick={() => setConfirmExit(true)}>
              Exit Simulation
            </button>
          )
        ) : (
          <button className="btn" disabled={!exitCheck.ok} title={reason(exitCheck) ?? "Select simulated inputs; the image starts at false/zero"} onClick={run(commands.enterSimulation)}>
            Enter Simulation
          </button>
        )}
        <button className="btn small" onClick={onSources} title="Preserved files behind this replay and their hash checks">
          Sources
        </button>
      </div>
    </header>
  );
}
