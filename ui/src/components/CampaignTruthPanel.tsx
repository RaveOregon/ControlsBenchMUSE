import { Fragment } from 'react';
import { campaignReview, type CheckRow, type FindingCard } from '../model/campaign-review.ts';
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

const STATUS_TONE: Record<CheckRow['status'], string> = { observed: 'info', inconclusive: 'warn', running: 'info', queued: 'neutral', not_run: 'warn' };
const REVIEW_TONE: Record<CheckRow['review'], string> = { needs_review: 'warn', accepted: 'ok', rerun: 'warn', no_finding: 'neutral' };
const Chip = ({ tone, children }: { tone: string; children: string }) => <span className={`state-chip tone-${tone}`}>{children}</span>;

/**
 * The authoritative campaign projection, read for an engineer: outcome first, each check's expected
 * result (only when one was recorded before the run) beside what was recorded, then the findings
 * that need review. Raw values and run metadata stay one click away. No pass is ever inferred.
 */
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
  const review = campaignReview(p, hosted.context);
  const actionsList = p ? Object.entries(p.actions) : [];
  const report = p?.report as { summary?: string; throughSequence?: number } | undefined;
  const canReview = Boolean(actions) && state.mode === 'live';
  const prepared = hosted.context?.prepared;
  return <section className="panel campaign-truth" aria-label="Campaign record">
    <header><h2>Campaign record</h2><span className={`tag evidence-badge ${badge.cls}`} title={badge.title}>{badge.text}</span><span className="tag">{p?.status ?? 'awaiting events'}</span>
      {hosted.context?.project && <span className="tag">{hosted.context.project.name} · {hosted.context.project.version}</span>}</header>
    <div className="body">
      {hosted.integrityError && <p className="verdict-fail" role="alert"><b>Integrity failure — no further events applied.</b> {hosted.integrityError}</p>}
      <div className="review-summary" aria-label="Campaign outcome">
        <p className="headline">{review.headline}</p>
        <p>{review.findingsLine}{review.needsReview > 0 && canReview ? ' Open each finding below to review it.' : ''}</p>
        <p className="muted">“Observed” means the PLC's response was recorded as evidence; it is not a pass. A finding is Muse's reading of that evidence. Accepting a finding records that you checked its cited PLC values support it; it does not mark a requirement as passed.</p>
      </div>

      <h3>Checks</h3>
      {review.checks.length ? <div className="table-wrap"><table className="results-table review-table"><thead><tr><th>Check</th><th>Expected</th><th>Recorded result</th><th>Your review</th></tr></thead><tbody>
        {review.checks.map(c => <tr key={c.id}>
          <td><span className="mono">{c.id}</span>{c.objective !== c.id && <div className="muted clamp">{c.objective}</div>}{c.addedDuringRun && <div className="muted">Added during the run</div>}</td>
          <td>{c.expected ? <><span className={`state-chip tone-${c.expected.expectedBasis === 'specified' ? 'ok' : 'warn'}`}>{c.expected.expectedBasis === 'specified' ? 'From spec' : 'Not specified'}</span> <span className="clamp">{c.expected.expectedObservation}</span></>
            : <span className="muted">{prepared ? 'Added during the run; no expectation recorded' : 'No expected result was defined before the run'}</span>}</td>
          <td><Chip tone={STATUS_TONE[c.status]}>{c.statusLabel}</Chip> <span className="clamp">{c.result}</span></td>
          <td><Chip tone={REVIEW_TONE[c.review]}>{c.reviewLabel}</Chip></td>
        </tr>)}
      </tbody></table></div> : <p className="muted">No checks recorded yet.</p>}

      <h3>Findings{review.findings.length ? ` (${review.findings.length})` : ''}</h3>
      {review.findings.length ? review.findings.map(f => <Finding key={f.id} f={f} canReview={canReview} actions={actions} onSelect={onSelect} />) : <p className="muted">No grounded finding recorded.</p>}

      <details className="run-details"><summary>Run details, connector, budget and actions ({actionsList.length} actions, {actionsList.filter(([, a]) => a.status === 'requested').length} unresolved)</summary>
        <p className="muted">{p?.claimBoundary ?? hosted.label}</p>
        <dl className="kv">
          <dt>Campaign</dt><dd className="mono">{hosted.campaignId} · seq {hosted.throughSequence} · revision {p?.revision ?? 0}</dd>
          <dt>Diagnosis</dt><dd>{hosted.diagnosisMode}</dd>
          <dt>Connector</dt><dd className={connector?.state === 'fresh' && !finalized && !recorded ? undefined : 'quality-held'}>{connectorText}</dd>
          <dt>Budget</dt><dd>campaign ${(p?.budget.campaignUsd ?? 0).toFixed(2)} · session ${(p?.budget.sessionUsd ?? 0).toFixed(2)} (conservative reservations, not spend)</dd>
          {p?.activeExperiment && <Fragment><dt>Active experiment</dt><dd className="mono">{p.activeExperiment}</dd></Fragment>}
          {p?.plan && <Fragment><dt>Plan objective</dt><dd>{p.plan.objective}</dd></Fragment>}
          {prepared && <Fragment><dt>Plan prepared by</dt><dd>{prepared.author}</dd></Fragment>}
          <dt>Report</dt><dd>{report ? `Finalized through sequence ${report.throughSequence}: ${report.summary}` : 'Not finalized.'}</dd>
        </dl>
        {p?.provenance && <details><summary>Provenance</summary><dl className="kv">{Object.entries(p.provenance).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="mono">{v}</dd></Fragment>)}</dl></details>}
        <details><summary>Actions</summary><table className="results-table"><thead><tr><th>Action</th><th>Outcome</th><th>Message · evidence</th></tr></thead><tbody>
          {actionsList.map(([id, a]) => <tr key={id}><td className="mono">{id} · {a.name}</td><td className={a.status === 'applied' ? undefined : a.status === 'requested' ? 'quality-held' : 'verdict-fail'}>{a.status === 'requested' ? 'unresolved' : a.status}</td>
            <td>{a.message ?? ''} {a.evidenceRefs.map(r => <Ref key={r} id={r} onSelect={onSelect} />)}</td></tr>)}
        </tbody></table></details>
        <details><summary>Evidence cited per check</summary><ul>{review.checks.map(c => <li key={c.id}><span className="mono">{c.id}</span>: {c.evidenceRefs.length ? c.evidenceRefs.map(r => <Ref key={r} id={r} onSelect={onSelect} />) : <span className="muted">none yet</span>}</li>)}</ul></details>
      </details>
      <p className="muted">Experiment evidence only; no requirement coverage is certified. Results has the full report.</p>
      {actions && <div className="actions"><a className="btn small" href={actions.reportUrl} target="_blank" rel="noreferrer">Open JSON report</a><a className="btn small" href={actions.ledgerUrl} download>Download ledger (JSONL)</a></div>}
    </div>
  </section>;
}

function Finding({ f, canReview, actions, onSelect }: { f: FindingCard; canReview: boolean; actions?: CampaignTruthActions; onSelect: (s: Selection) => void }) {
  return <details className="finding-record">
    <summary><Chip tone={REVIEW_TONE[f.review]}>{f.reviewLabel}</Chip> <b>{f.title}</b> <span className="muted">· {f.experimentId} · {f.claimCount} PLC value{f.claimCount === 1 ? '' : 's'}</span></summary>
    <dl className="kv">
      {f.expected && <><dt>Expected</dt><dd>{f.expected.expectedObservation} <span className="muted">({f.expected.expectedBasis === 'specified' ? 'from the specification' : 'not specified'}{f.expected.sourceRefs.length ? `: ${f.expected.sourceRefs.join(', ')}` : ''})</span></dd></>}
      <dt>Muse concluded</dt><dd>{f.inference} <span className="muted">(model-authored, not verified)</span></dd>
      <dt>Evidence</dt><dd>{f.groups.map(g => <div key={g.evidenceId} className="claim-line"><Ref id={g.evidenceId} onSelect={onSelect} /> {g.values.map(v => `${v.signal} = ${v.value}`).join(' · ')}</div>)}</dd>
      <dt>Limits</dt><dd>{f.uncertainty}</dd>
      {f.assumptions.length > 0 && <><dt>Assumptions</dt><dd>{f.assumptions.join('; ')}</dd></>}
      {f.injectedTruthRefs.length > 0 && <><dt>Injected fault</dt><dd>{f.injectedTruthRefs.map(r => <Ref key={r} id={r} onSelect={onSelect} />)}</dd></>}
    </dl>
    {canReview && actions && <div className="review-box">
      <p><b>Your review.</b> Accept if the cited PLC values support this finding. It is recorded in the campaign ledger and does not mark a requirement as passed. Flag for rerun if they do not; that records the request but does not start a run.</p>
      <div className="actions"><button className="btn small" disabled={f.review === 'accepted'} onClick={() => actions.reviewFinding(f.id, 'accepted')}>{f.review === 'accepted' ? 'Accepted' : 'Accept finding'}</button>
        <button className="btn small" disabled={f.review === 'rerun'} onClick={() => actions.reviewFinding(f.id, 'rerun_requested')}>{f.review === 'rerun' ? 'Flagged for rerun' : 'Flag for rerun'}</button></div>
    </div>}
  </details>;
}
