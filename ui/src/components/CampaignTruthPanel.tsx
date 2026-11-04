import { Fragment } from 'react';
import type { CommandResult, WorkspaceState } from '../model/workspace-store.ts';
import type { Selection } from './selection.ts';

export const HOST_EVIDENCE_LABEL: Record<string, { text: string; title: string; cls: string }> = {
  fake_connector: { text: 'FAKE CONNECTOR · no PLC', title: 'Deterministic fake PLC connector. No PLC behavior is evidenced.', cls: 'surrogate' },
  preserved_live_plc: { text: 'PRESERVED LIVE PLC · historical', title: 'Re-presented historical PLC evidence. No new PLC run.', cls: 'replay' },
  live_plc: { text: 'LIVE PLC', title: 'Actual running PLC through the live connector.', cls: 'live' }
};

function Ref({ id, onSelect }: { id: string; onSelect: (s: Selection) => void }) {
  return <button className="text-button mono ref" onClick={() => onSelect({ type: 'event', id })} title="Open this campaign evidence">{id.split(':').at(-1) ? `#${id.split(':').at(-1)}` : id}</button>;
}

export interface CampaignTruthActions {
  reviewFinding: (id: string, review: 'accepted' | 'rerun_requested') => CommandResult;
  reportUrl: string;
  ledgerUrl: string;
}

/** The authoritative campaign projection, shown verbatim. Requirement coverage is never inferred from it. */
export function CampaignTruthPanel({ state, actions, onSelect }: { state: WorkspaceState; actions?: CampaignTruthActions; onSelect: (s: Selection) => void }) {
  const hosted = state.hosted;
  if (!hosted) return <section className="panel"><header><h2>Campaign record</h2><span className="tag">none</span></header><div className="body muted">{state.host ? 'No campaign yet. Start Campaign creates a new campaign ledger on the host.' : 'No portal host attached.'}</div></section>;
  const p = hosted.projection;
  const badge = HOST_EVIDENCE_LABEL[hosted.evidenceClass] ?? { text: hosted.evidenceClass, title: '', cls: '' };
  const connector = p?.connector as { state?: string; reason?: string; ageMs?: number } | undefined;
  const finalized = p && ['completed', 'failed', 'stopped'].includes(p.status);
  const recorded = hosted.evidenceClass === 'preserved_live_plc';
  const connectorText = !connector ? 'no connector observation yet'
    : recorded ? `Recorded source state: ${connector.state} · ${connector.reason}; no current PLC freshness`
    : finalized ? `Last observed ${connector.state} · ${connector.reason} (age at observation ${Math.round(connector.ageMs ?? 0)} ms); campaign finalized — current freshness not monitored`
    : `${connector.state} · ${connector.reason} (${Math.round(connector.ageMs ?? 0)} ms)`;
  const experiments = p ? Object.values(p.experiments) : [];
  const actionsList = p ? Object.entries(p.actions) : [];
  const findings = p ? Object.values(p.findings) : [];
  const report = p?.report as { summary?: string; throughSequence?: number } | undefined;
  return <section className="panel campaign-truth" aria-label="Campaign record">
    <header><h2>Campaign record</h2><span className={`tag evidence-badge ${badge.cls}`} title={badge.title}>{badge.text}</span><span className="tag">{p?.status ?? 'awaiting events'}</span></header>
    <div className="body">
      {hosted.integrityError && <p className="verdict-fail" role="alert"><b>Integrity failure — no further events applied.</b> {hosted.integrityError}</p>}
      <p className="muted">{p?.claimBoundary ?? hosted.label}</p>
      <dl className="kv">
        <dt>Campaign</dt><dd className="mono">{hosted.campaignId} · seq {hosted.throughSequence} · revision {p?.revision ?? 0}</dd>
        <dt>Diagnosis</dt><dd>{hosted.diagnosisMode}</dd>
        <dt>Connector</dt><dd className={connector?.state === 'fresh' && !finalized && !recorded ? undefined : 'quality-held'}>{connectorText}</dd>
        <dt>Budget</dt><dd>campaign ${(p?.budget.campaignUsd ?? 0).toFixed(2)} · session ${(p?.budget.sessionUsd ?? 0).toFixed(2)}</dd>
        {p?.activeExperiment && <Fragment><dt>Active experiment</dt><dd className="mono">{p.activeExperiment}</dd></Fragment>}
      </dl>
      {p?.provenance && <details><summary>Provenance</summary><dl className="kv">{Object.entries(p.provenance).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="mono">{v}</dd></Fragment>)}</dl></details>}
      <h3>Plan{p?.plan ? ` · ${p.plan.objective}` : ''}</h3>
      {experiments.length ? <table className="results-table"><thead><tr><th>Experiment</th><th>Category</th><th>Status</th><th>Conclusion · evidence</th></tr></thead><tbody>
        {experiments.map(e => <tr key={e.id}><td><span className="mono">{e.id}</span><div className="muted">{e.objective}</div></td><td>{e.category}</td><td>{e.status}</td>
          <td>{e.conclusion ?? '—'} {(e.evidenceRefs ?? []).map(r => <Ref key={r} id={r} onSelect={onSelect} />)}</td></tr>)}
      </tbody></table> : <p className="muted">No experiments recorded yet.</p>}
      <details><summary>Actions ({actionsList.length}; {actionsList.filter(([, a]) => a.status === 'requested').length} unresolved)</summary>
        <table className="results-table"><thead><tr><th>Action</th><th>Outcome</th><th>Message · evidence</th></tr></thead><tbody>
          {actionsList.map(([id, a]) => <tr key={id}><td className="mono">{id} · {a.name}</td><td className={a.status === 'applied' ? undefined : a.status === 'requested' ? 'quality-held' : 'verdict-fail'}>{a.status === 'requested' ? 'unresolved' : a.status}</td>
            <td>{a.message ?? ''} {a.evidenceRefs.map(r => <Ref key={r} id={r} onSelect={onSelect} />)}</td></tr>)}
        </tbody></table></details>
      <h3>Findings</h3>
      {findings.length ? findings.map(f => <article key={f.id} className="finding-record">
        <h4>{f.title} <span className="tag">{f.review === 'unreviewed' ? 'unreviewed' : f.review === 'accepted' ? 'accepted by engineer' : 'rerun requested'}</span></h4>
        <dl className="kv">
          <dt>Observed (exact PLC output)</dt><dd>{f.claims.map(c => <div key={`${c.evidenceId}-${c.signal}`}><span className="mono">{c.signal} = {String(c.equals)}</span> <Ref id={c.evidenceId} onSelect={onSelect} /></div>)}</dd>
          <dt>Injected truth</dt><dd>{f.injectedTruthRefs.length ? f.injectedTruthRefs.map(r => <Ref key={r} id={r} onSelect={onSelect} />) : 'none cited'}</dd>
          <dt>Inference (unverified)</dt><dd>{f.inference}</dd>
          <dt>Assumptions</dt><dd>{f.assumptions.length ? f.assumptions.join('; ') : 'none stated'}</dd>
          <dt>Uncertainty</dt><dd>{f.uncertainty}</dd>
        </dl>
        {actions && state.mode === 'live' && <div className="actions"><button className="btn small" disabled={f.review === 'accepted'} onClick={() => actions.reviewFinding(f.id, 'accepted')}>Accept finding</button><button className="btn small" disabled={f.review === 'rerun_requested'} onClick={() => actions.reviewFinding(f.id, 'rerun_requested')}>Request rerun (records request only)</button></div>}
      </article>) : <p className="muted">No grounded finding recorded.</p>}
      <p className="muted">{report ? `Report finalized through sequence ${report.throughSequence}: ${report.summary}` : 'Report not finalized.'} Experiment evidence only; no conveyor requirement coverage is certified.</p>
      {actions && <div className="actions"><a className="btn small" href={actions.reportUrl} target="_blank" rel="noreferrer">Open JSON report</a><a className="btn small" href={actions.ledgerUrl} download>Download ledger (JSONL)</a></div>}
    </div>
  </section>;
}
