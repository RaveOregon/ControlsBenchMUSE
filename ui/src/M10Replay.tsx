// Read-only preserved-M10 witness. Uses the same client mapper and generated-view component
// as the hosted portal. No command transport, model provider or PLC endpoint is constructed.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ledgerText from "../../artifacts/m10/2026-11-01T00-58-43-185Z/campaign.jsonl?raw";
import manifest from "../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.manifest.json";
import { HostedSession } from "./adapters/host/hosted-session.ts";
import { parseLedgerJsonl } from "./adapters/host/envelope.ts";
import { WorkspaceStore } from "./model/workspace-store.ts";
import type { SignalDefinition } from "./model/workspace-store.ts";
import { GeneratedMachineView } from "./components/GeneratedMachineView.tsx";
import { Inspector } from "./components/Inspector.tsx";
import type { Selection } from "./components/selection.ts";
import "./styles.css";

const events = parseLedgerJsonl(ledgerText);
async function load(through: number) {
  const session = new HostedSession(new WorkspaceStore("replay", manifest.signals as SignalDefinition[]));
  await session.ingestEnvelopes(events[0]!.campaignId, events.slice(0, through), undefined, { evidenceClass: "preserved_live_plc", label: "Preserved M10 · read only" });
  return session;
}
function Replay() {
  const [session, setSession] = useState<HostedSession>(), [error, setError] = useState<string>();
  const current = useRef<HostedSession | undefined>(undefined);
  const [probe, setProbe] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const seek = async (through: number) => { const s = await load(through); current.current = s; setSession(s); setSelection(null); setProbe(""); };
  useEffect(() => {
    seek(events.length).catch(e => setError(String(e)));
    const witness = { seek, eventCount: events.length, events,
      state: () => current.current?.store.state,
      setLink: (state: "fresh" | "stale" | "quarantined") => {
        const s = current.current;
        if (!s) return;
        s.store.state.connection.link = state === "fresh" ? "up" : "lost";
        // Force a render only; changes are a labeled presentation probe, never recorded evidence.
        setProbe(state);
      } };
    // Only this offline page exposes a read-only evidence/scrub seam for the browser audit.
    (window as Window & { m10Replay?: unknown }).m10Replay = witness;
    return () => { delete (window as Window & { m10Replay?: unknown }).m10Replay; };
  }, []);
  if (!session) return <div className="body">{error ?? "Checking preserved M10 ledger…"}</div>;
  return <main className="body"><h1>Preserved M10 · recorded PLC evidence</h1><p>No live PLC, HMI or model connection. Unknown historical quality remains unknown.</p>
    {probe && <p role="status">Presentation probe: {probe}. The recorded ledger is unchanged.</p>}
    <div className="body"><button onClick={() => seek(events.length)}>Final held state</button>{["exitA", "exitB"].map(path => <button key={path} onClick={() => seek(events.findIndex(e => e.type === "world.evidence" && (e.data.source as any)?.data?.snapshot?.state?.path === path) + 1)}>Recorded {path}</button>)}</div>
    <GeneratedMachineView key={session.lastSequence} state={{ ...session.store.state }} nowMs={session.nowMs()} onSelect={setSelection} />
    <section className="panel body">HMI not observed/tested</section>
    <Inspector state={session.store.state} nowMs={session.nowMs()} selection={selection} onSelect={setSelection} provenance={null} lookupEnvelope={id => session.getEnvelope(id)} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Replay />);
