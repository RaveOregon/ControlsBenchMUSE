import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { HmiConfiguration, HmiSurface } from "./components/HmiSurface.tsx";
import { ContextPanel, CommandNotice, ExperimentPanel, FindingCard, HistoricalQualification, ReplayResults, focusedCheck } from "./components/Portal.tsx";
import { ResultsPage } from "./components/ResultsPage.tsx";
import { ingestHmiObservation, type HmiSource, type HmiObservation } from "./adapters/live/hmi-source.ts";
import type { CoordinatorTransport, CoordinatorEventLike, CommandAcknowledgement } from "./adapters/live/coordinator-source.ts";
import { LiveSession } from "./adapters/live/coordinator-source.ts";
import { createHostedBrowserSession } from "./adapters/host/browser-session.ts";
import { connectHostStream, detectHost, fetchTransport } from "./adapters/host/host-transport.ts";
import { CampaignTruthPanel } from "./components/CampaignTruthPanel.tsx";
import type { HostInfo } from "../../src/host/protocol.ts";
import { verifyProvenance, type FixtureBundle, type ProvenanceCheck } from "./adapters/replay/fixtures.ts";
import { parseWorldGeometry } from "./adapters/replay/geometry.ts";
import { REPLAY_SPEEDS, ReplaySession } from "./adapters/replay/replay-session.ts";
import type { CampaignSource } from "./adapters/source.ts";
import { ActivityStrip } from "./components/ActivityStrip.tsx";
import { BudgetPanel } from "./components/BudgetPanel.tsx";
import { ConnectionPanel } from "./components/ConnectionPanel.tsx";
import { EvidenceTimeline } from "./components/EvidenceTimeline.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { GeneratedMachineView } from "./components/GeneratedMachineView.tsx";
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
  const [host, setHost] = useState<HostInfo | null | undefined>(undefined);
  const [error, setError] = useState<string>();
  useEffect(() => {
    import("./adapters/replay/fixtures-browser.ts")
      .then((module) => module.loadBrowserFixtures())
      .then(setBundle)
      .catch((reason: unknown) => setError(String(reason)));
    detectHost().then(setHost, () => setHost(null));
  }, []);
  if (error) return <div className="loading">Could not load preserved evidence: {error}</div>;
  if (!bundle || host === undefined) return <div className="loading">Loading preserved Gate A–D and M0–M7 evidence…</div>;
  return <Workspace bundle={bundle} host={host} />;
}

function Workspace({ bundle, host }: { bundle: FixtureBundle; host: HostInfo | null }) {
  const sessions = useMemo(() => {
    const signals: SignalDefinition[] = bundle.manifest.signals.map((signal) => ({ id: signal.id, direction: signal.direction, dataType: signal.dataType, role: signal.role, description: signal.description }));
    const outputIds = signals.filter((signal) => signal.direction === "plc_to_world").map((signal) => signal.id);
    const bridge = new LiveSession(new WorkspaceStore("live", signals), outputIds);
    const hosted = host ? createHostedBrowserSession(signals, fetchTransport()) : null;
    return {
      replay: new ReplaySession(bundle, new WorkspaceStore("replay", signals)),
      bridge,
      hosted,
      live: (hosted ?? bridge) as CampaignSource
    };
  }, [bundle, host]);
  useEffect(() => {
    if (!sessions.hosted) return;
    const stream = connectHostStream(sessions.hosted);
    return () => stream.close();
  }, [sessions]);
  const geometry = useMemo(() => parseWorldGeometry(bundle.worldSource), [bundle]);
  const [provenance, setProvenance] = useState<ProvenanceCheck[] | null>(null);
  useEffect(() => {
    verifyProvenance(bundle).then(setProvenance, () => setProvenance([]));
  }, [bundle]);

  const [destination, setDestination] = useState<"Setup" | "Campaign" | "Results">("Campaign");
  const [hmiSource, setHmiSource] = useState<HmiSource | null>(null);
  const [visualSurface, setVisualSurface] = useState<"both" | "world" | "hmi">("both");
  // A hosted portal opens on its live campaign; preserved replay remains one click away.
  const [mode, setMode] = useState<SourceMode>(host ? "live" : "replay");
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

  useEffect(() => {
    const portal = {
      contractVersion: 1 as const,
      // V1 window bridge. When a portal host is attached, Live mode shows the host instead.
      hosted: Boolean(sessions.hosted),
      attachCoordinator: (transport: CoordinatorTransport) => { sessions.bridge.attach(transport); setFrame(n => n + 1); },
      detachCoordinator: () => { sessions.bridge.detach(); setFrame(n => n + 1); },
      ingestCoordinatorEvents: (events: readonly CoordinatorEventLike[]) => sessions.bridge.ingestCoordinatorEvents(events),
      acknowledge: (ack: CommandAcknowledgement) => sessions.bridge.acknowledge(ack),
      ingestEvidence: (events: readonly import('./model/events.ts').MuseEvent[]) => sessions.bridge.store.applyEvents(events),
      ingestHmi: (observation: HmiObservation) => { const target = observation.mode === 'live' ? sessions.live : sessions.replay; ingestHmiObservation(target.store, hmiSource, observation, target.nowMs()); }
    };
    (window as Window & { controlsBenchPortal?: typeof portal }).controlsBenchPortal = portal;
    return () => { delete (window as Window & { controlsBenchPortal?: typeof portal }).controlsBenchPortal; };
  }, [sessions, hmiSource]);
  const nowMs = source.nowMs();
  const hostedSource = mode === "live" && sessions.hosted ? sessions.hosted : null;
  const nowEpochMs = hostedSource ? hostedSource.nowEpochMs() : Date.now();
  const truthActions = hostedSource ? { reviewFinding: (id: string, review: "accepted" | "rerun_requested") => hostedSource.reviewFinding(id, review), reportUrl: "/api/campaign/report", ledgerUrl: "/api/campaign/ledger" } : undefined;
  const reportLinks = useMemo(() => hostedSource ? { bundleUrl: "/api/campaign/report/bundle", reportUrl: "/api/campaign/report", ledgerUrl: "/api/campaign/ledger" } : undefined, [hostedSource]);
  const hmiControls = hostedSource ? { configure: (url: string) => hostedSource.configureHmi(url), disconnect: () => hostedSource.disconnectHmi() } : undefined;
  const liveDetail = sessions.hosted ? `${state.host?.state === "connected" ? "host" : "host reconnecting"} · ${host?.factory.evidenceClass.replaceAll("_", " ")}` : undefined;
  const check = focusedCheck(state, selection);
  const pending = Object.values(state.commands).find(c => c.outcome === 'pending');
  const startReason = source.unavailableReason ?? (pending ? 'Awaiting application acknowledgement' : source.store.can('start').ok ? undefined : (source.store.can('start') as { reason: string }).reason);
  const plan = <PlanPanel state={state} worldName={bundle.manifest.name} worldVersion={bundle.manifest.packageVersion} signalCounts={{ inputs: state.signals.filter(s => s.direction === 'world_to_plc').length, outputs: state.signals.filter(s => s.direction === 'plc_to_world').length }} selection={selection} onSelect={setSelection} onScope={(ids, included) => source.store.setScope(ids, included)} onStart={() => { const result = source.start(); if (result.ok) setDestination('Campaign'); return result; }} startDisabledReason={startReason} />;
  const view = classifyActivity(state, nowMs);
  const speedNote = mode === "replay" ? `replay ${speed}×${state.episode && state.episode.timeScale > 1 ? `, record condensed ×${Number.isInteger(state.episode.timeScale) ? state.episode.timeScale : state.episode.timeScale.toFixed(1)}` : ""}` : "live wall clock";


  return (
    <div className="app">
      <TopBar
        state={state}
        mode={mode}
        liveAttached={!sessions.live.unavailableReason}
        liveDetail={liveDetail}
        reviewingRecorded={host?.factory.evidenceClass === "preserved_live_plc"}
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
        can={(command) => (source.unavailableReason ? { ok: false, reason: source.unavailableReason } : pending ? { ok: false, reason: "Awaiting application acknowledgement" } : source.store.can(command))}
      />
      <nav className="destinations" aria-label="Main navigation">{(['Setup', 'Campaign', 'Results'] as const).map(item => <button key={item} aria-current={destination === item ? 'page' : undefined} onClick={() => { setDestination(item); setSelection(null); }}>{item}</button>)}<span className="muted">Conveyor bench <span className="mono">/ world v{bundle.manifest.packageVersion}</span></span></nav>
      <div className="portal-scroll">
        <ActivityStrip view={view} speedNote={speedNote} />
        <CommandNotice state={state} />
        <main className="portal-main">
          {destination === 'Setup' && <><div className="page-heading"><div><div className="eyebrow">{mode} · engineering setup</div><h1>Conveyor bench setup</h1><p>Imported specification, raw signal contract and visible world assumptions.</p></div></div><div className="setup-grid"><div><ContextPanel bundle={bundle} /><HmiConfiguration source={hmiSource} onConfigure={setHmiSource} state={state} hosted={hmiControls} /></div><div>{plan}<details className="inspector-disclosure"><summary>Connection & authority</summary><ConnectionPanel state={state} nowMs={nowMs} /></details></div></div></>}
          {destination === 'Campaign' && <>
            <div className="page-heading"><div><div className="eyebrow">{mode === 'replay' ? 'RECORDED CAMPAIGN · nothing here is live' : host?.factory.evidenceClass === 'preserved_live_plc' ? 'HOSTED REVIEW · recorded PLC/world evidence' : 'LIVE CAMPAIGN'}</div><h1>Conveyor bench campaign</h1></div><button className="btn primary" disabled={Boolean(startReason)} title={startReason} onClick={() => source.start()}>{mode === 'replay' ? 'Play recorded campaign' : 'Start campaign'}</button></div>
            {mode === 'live' && source.unavailableReason && <div className="source-notice"><b>{sessions.hosted ? 'Portal host unavailable.' : 'Live coordinator not attached.'}</b> {source.unavailableReason}</div>}
            {/* Hosted campaigns show the M9 experiments and findings; the built-in check cards would cite unrelated preserved checks. */}
            {hostedSource ? <CampaignTruthPanel state={state} actions={truthActions} onSelect={setSelection} />
              : <div className="experiment-grid"><ExperimentPanel state={state} check={check} onSelect={setSelection} /><FindingCard state={state} check={check} source={source} onSelect={setSelection} /></div>}
            <details className="inspector-disclosure"><summary>Steer Muse / request a targeted experiment</summary><SteeringBox state={state} onSteer={text => source.steer(text)} /></details>
            <div className="visual-heading"><h2>Observe the experiment</h2><div className="segmented" role="group" aria-label="Observation surfaces">{(['both','world','hmi'] as const).map(v => <button key={v} aria-pressed={visualSurface === v} onClick={() => setVisualSurface(v)}>{v === 'both' ? 'Side by side' : v === 'world' ? 'Simulated World' : 'PLC HMI'}</button>)}</div><details><summary>Generated geometry & assumptions</summary><p className="mono">World v{bundle.manifest.packageVersion}</p><pre className="document-text">{JSON.stringify(geometry, null, 2)}</pre><ul>{bundle.manifest.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></details></div>
            <div className={visualSurface === 'both' ? 'observation-grid' : 'observation-single'}>{visualSurface !== 'hmi' && <GeneratedMachineView state={state} nowMs={nowMs} onSelect={setSelection} />}{visualSurface !== 'world' && <HmiSurface state={state} source={hmiSource} nowEpochMs={nowEpochMs} onSelect={setSelection} />}</div>
            <EvidenceTimeline state={state} nowMs={nowMs} selection={selection} onSelect={setSelection} />
            <details className="inspector-disclosure"><summary>Campaign scope & checks</summary>{plan}</details>
            <details className="inspector-disclosure"><summary>Protocol diagnostics, budget & raw I/O</summary><ConnectionPanel state={state} nowMs={nowMs} /><BudgetPanel state={state} nowMs={nowMs} /><RawIoPanel state={state} nowMs={nowMs} onSelect={setSelection} onSuppress={(id, suppressed) => source.setSuppression(id, suppressed)} /></details>
          </>}
          {destination === 'Results' && <ResultsPage state={state} links={reportLinks} fallback={<ReplayResults state={state} bundle={bundle} onSelect={setSelection} />} historical={<HistoricalQualification bundle={bundle} onSelect={setSelection} />} />}
        </main>
      </div>
      <Inspector nowMs={nowMs} state={state} selection={selection} provenance={provenance} onSelect={setSelection} lookupEnvelope={hostedSource ? id => hostedSource.getEnvelope(id) : undefined} />
    </div>
  );
}
