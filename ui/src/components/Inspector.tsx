import { signalHealth } from "../model/signal-health.ts";
import { useEffect, useRef, type ReactNode } from "react";
import type { ProvenanceCheck } from "../adapters/replay/fixtures.ts";
import type { MuseEvent } from "../model/events.ts";
import { formatClock, formatRaw, shortHash } from "../model/format.ts";
import type { WorkspaceState } from "../model/workspace-store.ts";
import { CLOCK_LABEL, evidenceTag } from "./labels.ts";
import type { Selection } from "./selection.ts";
import type { CampaignEnvelope } from "../../../src/host/protocol.ts";

interface Props {
  state: WorkspaceState;
  nowMs: number;
  selection: Selection;
  provenance: ProvenanceCheck[] | null;
  onSelect: (selection: Selection) => void;
  lookupEnvelope?: (id: string) => CampaignEnvelope | undefined;
}

function eventBody(event: MuseEvent): Record<string, unknown> {
  const { id: _id, atMs: _atMs, lane: _lane, summary: _summary, checkId: _checkId, provenance: _provenance, ...body } = event;
  return body;
}

function ProvenanceTable({ event }: { event: MuseEvent }) {
  const p = event.provenance;
  const evidenceMode = p.sourceMode ?? p.mode;
  const tag = evidenceTag(p.evidenceClass, evidenceMode);
  return (
    <dl className="kv">
      <dt>Mode</dt>
      <dd>
        <span className={`tag ${evidenceMode}`}>{evidenceMode === "replay" ? "replay — recorded, not live" : "live"}</span>
      </dd>
      <dt>Evidence class</dt>
      <dd>
        <span className={`tag ${tag.cls}`}>{tag.text}</span> <span className="muted">{tag.title}</span>
      </dd>
      <dt>Source</dt>
      <dd className="mono">{p.source}</dd>
      {p.ref && (
        <>
          <dt>Reference</dt>
          <dd className="mono">{p.ref}</dd>
        </>
      )}
      <dt>Clock</dt>
      <dd>{CLOCK_LABEL[p.clock]}</dd>
      {p.sourceAtMs !== undefined && (
        <>
          <dt>Source time</dt>
          <dd className="mono">{p.sourceAtMs.toFixed(p.sourceAtMs % 1 ? 3 : 0)} ms</dd>
        </>
      )}
      {p.recordedAt && (
        <>
          <dt>Recorded at</dt>
          <dd className="mono">{p.recordedAt}</dd>
        </>
      )}
      {p.run && (
        <>
          <dt>Run</dt>
          <dd className="mono">
            {p.run}
            {p.seed !== undefined ? ` · seed ${p.seed}` : ""}
          </dd>
        </>
      )}
      {p.worldVersion && (
        <>
          <dt>World version</dt>
          <dd className="mono">{p.worldVersion}</dd>
        </>
      )}
    </dl>
  );
}

export function Inspector({ state, nowMs, selection, provenance, onSelect, lookupEnvelope }: Props) {
  const drawer = useRef<HTMLElement>(null);
  const open = selection !== null;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    drawer.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onSelect(null); }
      if (e.key === 'Tab') {
        const controls = drawer.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]');
        if (!controls?.length) { e.preventDefault(); return; }
        const first = controls[0]!; const last = controls[controls.length - 1]!;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === drawer.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus(); };
  }, [open, onSelect]);
  if (!selection) return null;
  const close = () => onSelect(null);
  let title = "";
  let content: ReactNode = null;

  if (selection.type === "event") {
    const event = state.keyEvents.find((candidate) => candidate.id === selection.id) ?? state.timeline.find((candidate) => candidate.id === selection.id) ?? state.verdicts.find((candidate) => candidate.id === selection.id);
    const envelope = lookupEnvelope?.(selection.id);
    title = event ? event.summary : "Event";
    content = !event && envelope ? <><p className="mono">{envelope.id} · {envelope.type} · {envelope.visibility}</p><p>Original campaign ledger envelope. World truth and observed PLC evidence remain separate.</p><pre className="json">{JSON.stringify(envelope, null, 2)}</pre></> : !event ? (
      <p className="muted">This event has scrolled out of the bounded in-memory trace. The preserved source file still holds it.</p>
    ) : (
      <>
        <dl className="kv">
          <dt>Kind</dt>
          <dd className="mono">{event.kind}</dd>
          <dt>Lane</dt>
          <dd>{event.lane}</dd>
          <dt>Campaign time</dt>
          <dd className="mono">
            {formatClock(event.atMs)} ({event.atMs.toFixed(1)} ms)
          </dd>
          {event.checkId && (
            <>
              <dt>Check</dt>
              <dd>
                <button className="btn small" onClick={() => onSelect({ type: "check", id: event.checkId! })}>
                  {event.checkId}
                </button>
              </dd>
            </>
          )}
        </dl>
        <div className="section-title">Provenance</div>
        <ProvenanceTable event={event} />
        <div className="section-title">Record</div>
        <pre className="json">{JSON.stringify(eventBody(event), null, 2)}</pre>
      </>
    );
  }

  if (selection.type === "check") {
    const check = state.checks[selection.id];
    title = check ? `${check.id} · ${check.title}` : selection.id;
    const tag = check ? evidenceTag(check.evidenceClass, state.mode, check.availability) : null;
    content = !check ? (
      <p className="muted">Unknown check.</p>
    ) : (
      <>
        <dl className="kv">
          <dt>Status</dt>
          <dd>{check.status.replace("_", " ")}</dd>
          <dt>Evidence</dt>
          <dd>
            {tag && <span className={`tag ${tag.cls}`}>{tag.text}</span>} <span className="mono">{check.evidenceSource}</span>
          </dd>
          <dt>Added by</dt>
          <dd>{check.addedBy === "muse" ? "Muse, during the run" : "campaign plan"}</dd>
          {check.requirement && (
            <>
              <dt>Requirement</dt>
              <dd>{check.requirement}</dd>
            </>
          )}
          <dt>Manipulate</dt>
          <dd>{check.manipulate}</dd>
          <dt>Observe</dt>
          <dd>{check.observe}</dd>
          <dt>Pass if</dt>
          <dd>{check.oracle}</dd>
          {check.summary && (
            <>
              <dt>Result</dt>
              <dd>{check.summary}</dd>
            </>
          )}
        </dl>
        {check.verdictEventId && (
          <p>
            <button className="btn small" onClick={() => onSelect({ type: "event", id: check.verdictEventId! })}>
              Show verdict event and provenance
            </button>
          </p>
        )}
        {check.evidence && (
          <>
            <div className="section-title">Verdict evidence</div>
            <pre className="json">{JSON.stringify(check.evidence, null, 2)}</pre>
          </>
        )}
      </>
    );
  }

  if (selection.type === "signal") {
    const signal = state.signals.find((candidate) => candidate.id === selection.id);
    const value = signal?.direction === "plc_to_world" ? state.outputs[selection.id] : state.inputs[selection.id];
    const faults = Object.values(state.faults).filter((fault) => !fault.sealed && (fault.target === selection.id || selection.id.startsWith(fault.target)));
    title = selection.id;
    content = (
      <dl className="kv">
        <dt>Direction</dt>
        <dd>{signal?.direction === "plc_to_world" ? "PLC output → world" : "world → PLC raw input"}</dd>
        <dt>Type</dt>
        <dd className="mono">{signal?.dataType}</dd>
        <dt>Role</dt>
        <dd className="mono">{signal?.role}</dd>
        <dt>Description</dt>
        <dd>{signal?.description}</dd>
        <dt>Raw value</dt>
        <dd className="mono">{formatRaw(value?.value)}</dd>
        <dt>Last change</dt>
        <dd className="mono">{value?.atMs !== undefined ? formatClock(value.atMs) : "—"}</dd>
        <dt>Quality / freshness</dt><dd>{value?.quality ?? "unknown"} / {signalHealth(value, state, nowMs)}</dd>
        <dt>Source timestamp</dt><dd>{value?.sourceTimestamp ?? "not provided"}</dd>
        <dt>Server timestamp</dt><dd>{value?.serverTimestamp ?? "not provided"}</dd>
        <dt>Workstation timestamp</dt><dd>{value?.workstationTimestamp ?? "not provided"}</dd>
        <dt>Observed at</dt><dd>{value?.observedAtMs !== undefined ? `${formatClock(value.observedAtMs)} on campaign clock` : "unknown"}</dd>
        <dt>Cause</dt>
        <dd>{value?.cause ?? "—"}</dd>
        <dt>Source</dt>
        <dd className="mono">{value?.source ? `${value.source}${value.run ? ` · ${value.run}` : ""}` : "—"}</dd>
        {signal?.direction === "plc_to_world" && (
          <>
            <dt>Physical sink</dt>
            <dd>{state.suppressedOutputs[selection.id] ? "suppressed by engineer (command still traced)" : "physical"}</dd>
          </>
        )}
        <dt>Injected faults</dt>
        <dd>{faults.length ? faults.map((fault) => fault.detail).join("; ") : "none active"}</dd>
        {value?.eventId && (
          <>
            <dt>Event</dt>
            <dd>
              <button className="btn small" onClick={() => onSelect({ type: "event", id: value.eventId! })}>
                Show change event
              </button>
            </dd>
          </>
        )}
      </dl>
    );
  }

  if (selection.type === "sources") {
    title = "Evidence sources";
    content = (
      <>
        <p className="muted" style={{ marginTop: 0 }}>
          Every replayed event cites one of these preserved files. Hashes are computed over LF-normalized text and compared with values recorded when the evidence was produced (gate-d-result.json and codesys/README.md).
        </p>
        {!provenance ? (
          <p className="muted">Hashing…</p>
        ) : (
          <table className="io-table">
            <thead>
              <tr>
                <th>File</th>
                <th>SHA-256</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {provenance.map((entry) => (
                <tr key={entry.key} title={`${entry.path}\nactual ${entry.actual}${entry.recorded ? `\nrecorded ${entry.recorded} (${entry.recordedIn})` : ""}`}>
                  <td style={{ whiteSpace: "normal" }}>{entry.path.replace(/^artifacts\/generated-world\/[^/]+\//, "world/")}</td>
                  <td className="mono">{shortHash(entry.actual)}</td>
                  <td style={{ color: entry.status === "verified" ? "var(--ok)" : entry.status === "mismatch" ? "var(--bad)" : "var(--text-3)" }}>{entry.status === "verified" ? "verified" : entry.status === "mismatch" ? "MISMATCH" : "no recorded hash"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </>
    );
  }

  return (
    <aside ref={drawer} tabIndex={-1} className="drawer" role="dialog" aria-modal="true" aria-label="Inspector">
      <header>
        <h2>{title}</h2>
        <button className="btn small" onClick={close} aria-label="Close inspector">
          Close
        </button>
      </header>
      <div className="content">{content}</div>
    </aside>
  );
}
