import { useEffect, useRef, useState } from "react";
import { MachineViewController } from "../../../src/machine-view/host.ts";
import type { EvidenceSelection, ViewHostStatus } from "../../../src/machine-view/host.ts";
import { loadPromotedMachineView } from "../adapters/machine-view-package.ts";
import { workspaceViewSnapshot } from "../model/machine-view-snapshot.ts";
import type { WorkspaceState } from "../model/workspace-store.ts";
import type { Selection } from "./selection.ts";

export function GeneratedMachineView({ state, nowMs, onSelect }: { state: WorkspaceState; nowMs: number; onSelect: (selection: Selection) => void }) {
  const container = useRef<HTMLDivElement>(null), controller = useRef<MachineViewController | null>(null);
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof loadPromotedMachineView>>>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<ViewHostStatus>();
  const [selected, setSelected] = useState<EvidenceSelection | null>(null);
  const [fallback, setFallback] = useState("");
  useEffect(() => { let active = true; loadPromotedMachineView().then(v => { if (active) setLoaded(v); }, e => { if (active) setError(String(e)); }); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!loaded || !container.current) return;
    const element = document.createElement("iframe");
    element.setAttribute("sandbox", "allow-scripts"); element.referrerPolicy = "no-referrer";
    element.title = "Muse-generated machine view: simulated physical truth, not the PLC HMI";
    const c = new MachineViewController({ ...loaded, post: m => element.contentWindow?.postMessage(m, "*"), onSelect: setSelected,
      onStatus: s => { setStatus(s); if (!["loading", "ready", "disposed"].includes(s.state)) { element.remove(); setFallback(c.fallbackHtml()); } } });
    controller.current = c; setStatus(c.status);
    const receive = (e: MessageEvent) => { if (e.source === element.contentWindow) c.receive(e.data); };
    window.addEventListener("message", receive);
    if (c.srcdoc && loaded.report.viewValid) { element.srcdoc = c.srcdoc; container.current.appendChild(element); }
    else setFallback(c.fallbackHtml());
    return () => { window.removeEventListener("message", receive); c.dispose(); element.remove(); controller.current = null; };
  }, [loaded]);
  useEffect(() => {
    const c = controller.current;
    if (!c || !loaded?.pkg) return;
    c.push(workspaceViewSnapshot(loaded.pkg, state, nowMs));
    if (!["ready", "loading"].includes(c.status.state)) setFallback(c.fallbackHtml());
  }, [loaded, state, nowMs]);
  return <section className="panel generated-machine" aria-label="Muse-generated simulated world" data-view-status={status?.state} data-package-id={loaded?.pkg?.manifest.packageId}>
    <header><h2>Simulated World</h2><span className="tag">{status?.state ?? (error ? "unavailable" : "validating package")}</span></header>
    <div ref={container} className="generated-view-mount" />
    {error && <div role="status" className="body">Machine view unavailable: {error}. Campaign evidence remains available.</div>}
    {fallback && <div role="status" className="body generated-fallback" dangerouslySetInnerHTML={{ __html: fallback }} />}
    {selected && <div className="body view-selection"><strong>{selected.label}</strong>
      <p>Selected evidence at event {selected.snapshotSequence ?? "unknown"}; values are held from that selection.</p>
      {selected.values.map(v => <div key={v.channel}>{v.signal}: {v.display} · {v.health} · {v.truthClass}</div>)}
      {selected.evidenceRefs.length ? [...new Set(selected.evidenceRefs)].map(ref => <button className="text-button ref" key={ref} onClick={() => onSelect({ type: "event", id: ref })}>Open {ref}</button>) : <p>No evidence supplied for this selection.</p>}
    </div>}
  </section>;
}
