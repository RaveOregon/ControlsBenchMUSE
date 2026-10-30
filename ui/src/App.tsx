import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { LiveSession } from "./adapters/live/coordinator-source.ts";
import { verifyProvenance, type FixtureBundle, type ProvenanceCheck } from "./adapters/replay/fixtures.ts";
import { parseWorldGeometry } from "./adapters/replay/geometry.ts";
import { REPLAY_SPEEDS, ReplaySession } from "./adapters/replay/replay-session.ts";
import type { CampaignSource } from "./adapters/source.ts";
import { ActivityStrip } from "./components/ActivityStrip.tsx";
import { BudgetPanel } from "./components/BudgetPanel.tsx";
import { ConnectionPanel } from "./components/ConnectionPanel.tsx";
import { EvidenceTimeline } from "./components/EvidenceTimeline.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { MachineView } from "./components/MachineView.tsx";
import { PlanPanel } from "./components/PlanPanel.tsx";
import { RawIoPanel } from "./components/RawIoPanel.tsx";
import type { Selection } from "./components/selection.ts";
import { SteeringBox } from "./components/SteeringBox.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { classifyActivity } from "./model/activity.ts";
import type { SourceMode } from "./model/events.ts";
import { WorkspaceStore, type SignalDefinition } from "./model/workspace-store.ts";

const FRAME_INTERVAL_MS = 50;
const MAX_FRAME_STEP_MS = 1000;

export function App() {
  const [bundle, setBundle] = useState<FixtureBundle | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    import("./adapters/replay/fixtures-browser.ts")
      .then((module) => module.loadBrowserFixtures())
      .then(setBundle)
      .catch((reason: unknown) => setError(String(reason)));
  }, []);
  if (error) return <div className="loading">Could not load preserved evidence: {error}</div>;
  if (!bundle) return <div className="loading">Loading preserved Gate A–D and M0–M2 evidence…</div>;
  return <Workspace bundle={bundle} />;
}

function Workspace({ bundle }: { bundle: FixtureBundle }) {
  const sessions = useMemo(() => {
    const signals: SignalDefinition[] = bundle.manifest.signals.map((signal) => ({ id: signal.id, direction: signal.direction, dataType: signal.dataType, role: signal.role, description: signal.description }));
    const outputIds = signals.filter((signal) => signal.direction === "plc_to_world").map((signal) => signal.id);
    return {
      replay: new ReplaySession(bundle, new WorkspaceStore("replay", signals)),
      live: new LiveSession(new WorkspaceStore("live", signals), outputIds)
    };
  }, [bundle]);
  const geometry = useMemo(() => parseWorldGeometry(bundle.worldSource), [bundle]);
  const [provenance, setProvenance] = useState<ProvenanceCheck[] | null>(null);
  useEffect(() => {
    verifyProvenance(bundle).then(setProvenance, () => setProvenance([]));
  }, [bundle]);

  const [mode, setMode] = useState<SourceMode>("replay");
  const [speed, setSpeed] = useState(sessions.replay.speed);
  const [selection, setSelection] = useState<Selection>(null);
  const source: CampaignSource = mode === "replay" ? sessions.replay : sessions.live;
  const { state } = useSyncExternalStore(source.store.subscribe, source.store.getSnapshot);
  const [, setFrame] = useState(0);

  useEffect(() => {
    let handle = 0;
    let last = performance.now();
    let pending = 0;
    const loop = (now: number) => {
      // Cap each step so a tab returning from the background does not jump the replay forward,
      // and advance in ~20 Hz batches so dense records do not re-render every animation frame.
      pending += Math.min(now - last, MAX_FRAME_STEP_MS);
      last = now;
      if (pending >= FRAME_INTERVAL_MS) {
        source.advance(pending);
        pending = 0;
        setFrame((frame) => frame + 1);
      }
      handle = requestAnimationFrame(loop);
    };
    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, [source]);

  const nowMs = source.nowMs();
  const view = classifyActivity(state, nowMs);
  const speedNote = mode === "replay" ? `replay ${speed}×${state.episode && state.episode.timeScale > 1 ? `, record condensed ×${Number.isInteger(state.episode.timeScale) ? state.episode.timeScale : state.episode.timeScale.toFixed(1)}` : ""}` : "live wall clock";
  const signalCounts = { inputs: state.signals.filter((signal) => signal.direction === "world_to_plc").length, outputs: state.signals.filter((signal) => signal.direction === "plc_to_world").length };

  return (
    <div className="app">
      <TopBar
        state={state}
        mode={mode}
        liveAttached={!sessions.live.unavailableReason}
        onMode={(next) => {
          setMode(next);
          setSelection(null);
        }}
        speed={speed}
        speeds={REPLAY_SPEEDS}
        onSpeed={(next) => {
          sessions.replay.speed = next;
          setSpeed(next);
        }}
        onSkip={() => sessions.replay.skipToNextEpisode()}
        onSources={() => setSelection({ type: "sources" })}
        commands={{
          pause: () => source.pause(),
          resume: () => source.resume(),
          stop: () => source.stop(),
          reset: () => source.resetSimulation(),
          exitSimulation: () => source.exitSimulation(),
          enterSimulation: () => source.enterSimulation()
        }}
        can={(command) => (source.unavailableReason ? { ok: false, reason: source.unavailableReason } : source.store.can(command))}
      />
      <ActivityStrip view={view} speedNote={speedNote} />
      <main className="workspace">
        <div className="column left">
          <PlanPanel
            state={state}
            worldName={bundle.manifest.name}
            worldVersion={bundle.manifest.packageVersion}
            signalCounts={signalCounts}
            selection={selection}
            onSelect={setSelection}
            onScope={(ids, included) => source.store.setScope(ids, included)}
            onStart={() => source.start()}
            startDisabledReason={source.unavailableReason ?? (source.store.can("start").ok ? undefined : (source.store.can("start") as { reason: string }).reason)}
          />
          <SteeringBox state={state} onSteer={(text) => source.steer(text)} />
        </div>
        <div className="column center">
          {mode === "live" && source.unavailableReason && (
            <section className="panel">
              <div className="body">
                <b>Live mode.</b> <span className="muted">{source.unavailableReason} The live coordinator attaches through the same event adapter (see ui/README.md); this view will not invent PLC state.</span>
              </div>
            </section>
          )}
          <MachineView state={state} geometry={geometry} onSelect={setSelection} />
          <EvidenceTimeline state={state} nowMs={nowMs} selection={selection} onSelect={setSelection} />
        </div>
        <div className="column right">
          <ConnectionPanel state={state} nowMs={nowMs} />
          <BudgetPanel state={state} nowMs={nowMs} />
          <RawIoPanel state={state} nowMs={nowMs} onSelect={setSelection} onSuppress={(outputId, suppressed) => source.setSuppression(outputId, suppressed)} />
        </div>
      </main>
      <Inspector state={state} selection={selection} provenance={provenance} onSelect={setSelection} />
    </div>
  );
}
