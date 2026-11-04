// Bench test report renderer. The same component renders the in-app Results report and, through
// renderToStaticMarkup, the standalone HTML export. All campaign and model text is rendered as
// React text (escaped data), never as markup. Images come only from the view model's vetted sources.

import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from "react";
import type { AttachmentRecord } from "../../../src/report/bundle.ts";
import { fmtTime, type ActionLine, type AssessmentView, type EvidenceRow, type ExperimentRow, type Fact, type FindingView, type FrameView,
  type HmiActionView, type RefView, type ReportView, type ValueGroup } from "./view-model.ts";
// Styles: bench-report.css, imported by the app's Results page and inlined by the standalone export.

export type ReportMode = "app" | "standalone";
const PAGE = 25;
const STANDALONE_GROUP = 50;
const RefContext = createContext<(id: string) => void>(() => undefined);
const ModeContext = createContext<ReportMode>("standalone");

export function BenchReport({ view, mode, toolbar }: { view: ReportView; mode: ReportMode; toolbar?: ReactNode }) {
  const [focus, setFocus] = useState<string>();
  return <ModeContext.Provider value={mode}><RefContext.Provider value={setFocus}>
    <article className="bench-report" data-campaign={view.campaignId} aria-label="Bench test report">
      <header className="br-cover">
        <div className="eyebrow">Bench test report · {view.source.context}</div>
        <h1>{view.title}</h1>
        {view.objective && <p className="br-objective"><span className="label-model">Campaign objective (Muse plan)</span> {view.objective}</p>}
        <div className="br-chips">
          <span className={`tag ${view.source.evidenceTag}`}>{view.source.evidenceLabel}</span>
          <span className={`tag tone-${view.execution.tone}`}>{view.execution.label}</span>
          {view.source.historical && <span className="tag">Historical record</span>}
          <span className="mono muted">{view.campaignId}</span>
        </div>
        {toolbar && <div className="br-actions no-print">{toolbar}</div>}
      </header>

      <section className="panel" aria-label="Summary">
        <header><h2>Summary</h2><span className="note">Generated from the campaign record; no additional model call</span></header>
        <div className="body">
          <ul className="br-headline">{view.headline.map((h, i) => <li key={i}>{h}</li>)}</ul>
          <div className="br-counts">{view.counts.map(g => <div className="br-count" key={g.title}>
            <h4>{g.title}</h4><div className="note">{g.note}</div>
            {g.title === "Campaign execution" ? <div className={`status tone-${g.items[0]!.tone}`}>{g.items[0]!.label}</div>
              : <dl>{g.items.map(i => <Fragment key={i.label}><dt className={i.tone ? `tone-${i.tone}` : undefined}>{i.value}</dt><dd>{i.label}</dd></Fragment>)}</dl>}
          </div>)}</div>
          <h3>Needs attention</h3>
          {view.attention.length ? <ul className="br-attention">{view.attention.map((a, i) => <li key={i} className={`tone-${a.tone}`}>{a.text}</li>)}</ul>
            : <p className="muted">Nothing in the record is flagged for attention.</p>}
          <h3>Execution</h3>
          <p>{view.execution.detail}</p>
          {view.finalization && (view.finalization.author === "muse"
            ? <><h3>Muse summary <span className="label-model">model-authored · unreviewed</span></h3><blockquote className="br-quote">{view.finalization.text}</blockquote></>
            : <><h3>Finalization note <span className="label-generated">written by the runtime, not by Muse</span></h3><blockquote className="br-quote runtime">{view.finalization.text}</blockquote></>)}
        </div>
      </section>

      <section className="panel" aria-label="Campaign result source">
        <header><h2>Identity and source</h2><span className={`tag ${view.source.evidenceTag}`}>{view.source.evidenceLabel}</span></header>
        <div className="body">
          <Facts facts={view.identity} />
          {view.source.claimBoundary && <p className="muted" style={{ marginTop: 10 }}>Claim boundary: {view.source.claimBoundary}</p>}
        </div>
      </section>

      <Experiments view={view} />
      <Requirements view={view} />
      <Findings findings={view.findings} />
      <Hmi view={view} />

      <section className="panel" aria-label="Recommended next checks">
        <header><h2>Recommended next checks</h2><span className="note label-generated">Recommendations generated from gaps in this record · not test results</span></header>
        <div className="body">{view.recommendations.length ? <ol>{view.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ol> : <p className="muted">No gaps in the record suggest a further check.</p>}</div>
      </section>

      <section className="panel" aria-label="Remaining work and limits">
        <header><h2>Remaining work, missing evidence and limits</h2></header>
        <div className="body">{view.remaining.map(group => <Fragment key={group.title}><h3>{group.title}</h3><ul>{group.items.map((x, i) => <li key={i}>{x}</li>)}</ul></Fragment>)}</div>
      </section>

      <FinalState view={view} />
      <Accounting view={view} />
      <Attachments attachments={view.attachments} />
      <Appendix view={view} focus={focus} />

      <p className="br-footer">Generated {fmtTime(view.generatedAtIso)} by ControlsBench Muse from the campaign record. Text written by Muse is labelled model-authored and shown as recorded.
        Separate review files are shown with their own status and do not change the original report.</p>
    </article>
  </RefContext.Provider></ModeContext.Provider>;
}

function Ref({ r }: { r: RefView }) {
  const select = useContext(RefContext), mode = useContext(ModeContext);
  if (!r.known || r.sequence === undefined) return <span className="br-ref missing" title="Not in this report's evidence slice">{r.label}</span>;
  // Standalone: plain fragment links. In the app the appendix is paginated, so reveal the row instead.
  return <a className="br-ref" href={`#ev-${r.sequence}`} title={r.id} onClick={mode === "app" ? e => { e.preventDefault(); select(r.id); } : undefined}>{r.label}</a>;
}
const Refs = ({ refs }: { refs: RefView[] }) => refs.length ? <>{refs.map(r => <Ref key={r.id} r={r} />)}</> : <span className="muted">none cited</span>;

function Facts({ facts }: { facts: Fact[] }) {
  return <dl className="kv">{facts.map(f => <Fragment key={f.label}><dt>{f.label}</dt><dd className={[f.mono ? "mono" : "", f.unavailable ? "unavailable" : ""].join(" ").trim() || undefined}>{f.value}</dd></Fragment>)}</dl>;
}

function Values({ group, title }: { group: ValueGroup; title?: string }) {
  return <div>
    <div className="br-group-head">{title ?? "At"} <Ref r={group.ref} /> recorded {fmtTime(group.atIso)}{group.sourceAtIso ? ` (source ${fmtTime(group.sourceAtIso)})` : ""}{group.plcCycle ? ` · PLC cycle ${group.plcCycle}` : ""}</div>
    {group.values.length ? <div className="br-values">{group.values.map(v => <div key={v.signal}><span>{v.signal}</span><span>{v.value}{v.matches === true ? " ✓" : v.matches === false ? " ✗ differs from record" : ""}</span></div>)}</div>
      : <p className="muted">Values not in this report's evidence slice.</p>}
  </div>;
}

function Actions({ lines, empty }: { lines: ActionLine[]; empty: string }) {
  if (!lines.length) return <span className="muted">{empty}</span>;
  return <ul>{lines.map(a => <li key={a.actionId}>{a.label} — <span className={`tone-${a.tone}`}>{a.statusLabel}</span> <Refs refs={a.refs} />{a.message ? <span className="muted"> {a.message}</span> : null}</li>)}</ul>;
}

function Experiments({ view }: { view: ReportView }) {
  return <section className="panel" aria-label="Test scope and results">
    <header><h2>Test scope and results</h2><span className="note">{view.experiments.length ? `${view.experiments.length} experiment${view.experiments.length === 1 ? "" : "s"}` : "No test plan recorded"}</span></header>
    <div className="body">
      {view.experiments.length ? <div className="table-wrap"><table>
        <thead><tr><th>Experiment</th><th>Requirement refs</th><th>Recorded conclusion</th><th>Requirement verdict</th><th>Evidence</th></tr></thead>
        <tbody>{view.experiments.map(x => <tr key={x.id}><td><span className="mono">{x.id}</span><div className="muted">{x.origin}</div></td><td>{x.requirements.join(", ") || "none"}</td>
          <td className={`tone-${x.tone}`}>{x.statusLabel}</td><td>{x.requirementVerdict}</td><td><Refs refs={x.refs} /></td></tr>)}</tbody>
      </table></div> : <p>No test plan or experiment was recorded before this run ended. Nothing in this record was tested against a requirement.</p>}
      {view.experiments.map(x => <ExperimentCard key={x.id} x={x} />)}
      {view.campaignActions.length > 0 && <><h3>Actions outside an active experiment</h3><Actions lines={view.campaignActions} empty="" /></>}
    </div>
  </section>;
}

function ExperimentCard({ x }: { x: ExperimentRow }) {
  return <details className="br-card" data-print-open="">
    <summary><h4 className="mono">{x.id}</h4><span className="tag">{x.category}</span><span className={`tag tone-${x.tone}`}>{x.statusLabel}</span><span className="muted">{x.objective}</span></summary>
    <dl className="kv">
      <dt>Objective</dt><dd><span className="label-model">Muse</span> {x.objective}</dd>
      <dt>Requirement refs</dt><dd>{x.requirements.join(", ") || "none"}</dd>
      <dt>Origin</dt><dd>{x.origin}{x.followup && <div><span className="label-model">Muse rationale</span> {x.followup.rationale} <Refs refs={x.followup.refs} /></div>}</dd>
      <dt>Run</dt><dd>{x.startedAtIso ? `${fmtTime(x.startedAtIso)} → ${x.completedAtIso ? fmtTime(x.completedAtIso) : "no completion recorded"}` : "Not started"}</dd>
      <dt>Stimulus / operator action</dt><dd><Actions lines={x.stimuli} empty="No stimulus or operator action recorded." /></dd>
      <dt>Expected behaviour</dt><dd className="unavailable">{x.expected}</dd>
      <dt>Observed behaviour</dt><dd>
        <Actions lines={x.checks} empty="No condition checks recorded." />
        {x.discrepancies.map((d, i) => <p key={i} className="tone-warn">Discrepancy: {d}</p>)}
        {x.values.map(g => <Values key={g.ref.id} group={g} title="Cited PLC output" />)}
      </dd>
      <dt>Recorded conclusion</dt><dd className={`tone-${x.tone}`}>{x.statusLabel}</dd>
      <dt>Requirement verdict</dt><dd>{x.requirementVerdict}</dd>
      <dt>Supporting evidence</dt><dd><Refs refs={x.refs} /></dd>
      <dt>Limitations</dt><dd>{x.limitations.length ? <ul>{x.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul> : <span className="muted">None recorded.</span>}</dd>
    </dl>
  </details>;
}

function Requirements({ view }: { view: ReportView }) {
  if (!view.requirements.length) return null;
  return <section className="panel" aria-label="Requirement verdicts">
    <header><h2>Requirement verdicts</h2><span className="note">Only verdicts the campaign explicitly recorded; none are inferred from experiment completion</span></header>
    <div className="body table-wrap"><table>
      <thead><tr><th>Requirement</th><th>Exercised by</th><th>Recorded verdict</th><th>Separate review artifacts</th></tr></thead>
      <tbody>{view.requirements.map(q => <tr key={q.id}><td className="mono">{q.id}</td><td>{q.experiments.map(x => `${x.id} (${x.statusLabel})`).join(", ") || "assessment only"}</td>
        <td><span className={`tone-${q.tone}`}>{q.verdictLabel}</span>{q.recorded.length > 0 && <div className="muted">{q.recorded.join("; ")}</div>}</td>
        <td>{q.separateReviews.length ? q.separateReviews.map((s, i) => <div key={i}>{s}</div>) : <span className="muted">none attached</span>}</td></tr>)}</tbody>
    </table></div>
  </section>;
}

function Findings({ findings }: { findings: FindingView[] }) {
  return <section className="panel" aria-label="Findings">
    <header><h2>Findings</h2><span className="note">Recorded by Muse; observed values are exact PLC outputs, inference is unverified</span></header>
    <div className="body">{findings.length ? findings.map(f => <article className="br-card" key={f.id}>
      <header><h3>{f.title}</h3><span className="mono tag">{f.id}</span><span className={`tag tone-${f.reviewTone}`}>{f.review}</span></header>
      <dl className="kv">
        <dt>Experiment</dt><dd className="mono">{f.experimentId}</dd>
        <dt>Priority</dt><dd className="unavailable">{f.priority}</dd>
        <dt>Observed facts</dt><dd>{f.claimCount} exact PLC claim{f.claimCount === 1 ? "" : "s"} (✓ = matches the cited ledger record){f.claimGroups.map(g => <Values key={g.ref.id} group={g} />)}</dd>
        <dt>Injected fault (truth record)</dt><dd>{f.injected.length ? f.injected.map(i => <div key={i.ref.id}>{i.text} <Ref r={i.ref} /></div>) : <span className="muted">none cited</span>}</dd>
        <dt>Inference <span className="label-model">Muse · unverified</span></dt><dd>{f.inference}</dd>
        <dt>Assumptions</dt><dd>{f.assumptions.length ? <ul>{f.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul> : <span className="muted">none stated</span>}</dd>
        <dt>Uncertainty</dt><dd>{f.uncertainty}</dd>
        <dt>Engineer review</dt><dd className={`tone-${f.reviewTone}`}>{f.review}</dd>
      </dl>
    </article>) : <p className="muted">No finding was recorded in this campaign.</p>}</div>
  </section>;
}

function Frame({ f }: { f: FrameView }) {
  const [expanded, setExpanded] = useState(false);
  const mode = useContext(ModeContext);
  return <figure className="br-frame">
    {f.image.src ? <button type="button" className={`br-thumb${expanded ? " expanded" : ""}`} aria-label={`Enlarge HMI frame ${f.sequence}`} onClick={mode === "app" ? () => setExpanded(!expanded) : undefined}>
      {/* Embedded images load eagerly in the standalone copy so printing never meets an unloaded image. */}
      <img src={f.image.src} alt={`HMI frame #${f.sequence} captured ${fmtTime(f.capturedAtIso)}`} loading={mode === "app" ? "lazy" : undefined} /></button>
      : <div className="br-frame-missing" role="img" aria-label={`HMI frame #${f.sequence} image unavailable`}><strong>Image unavailable</strong><span>{f.image.note}</span><span className="mono">#{f.sequence}{f.sha256 ? ` · sha256 ${f.sha256.slice(0, 16)}…` : ""}</span></div>}
    <figcaption>
      <span><Ref r={{ id: f.id, sequence: f.sequence, label: `#${f.sequence} HMI frame`, known: true }} /> captured {fmtTime(f.capturedAtIso)}</span>
      <span className={f.supplied ? "br-supplied" : "br-not-supplied"}>{f.suppliedLabel}</span>
      <span className="mono muted">{f.reference}{f.sha256 ? ` · sha256 ${f.sha256.slice(0, 16)}…` : ""}</span>
      {f.image.src && <span className="muted">{f.image.note}</span>}
    </figcaption>
  </figure>;
}

function HmiActions({ actions }: { actions: HmiActionView[] }) {
  return <div className="table-wrap"><table>
    <thead><tr><th>HMI action</th><th>Input delivered</th><th>PLC acknowledgement</th><th>Rendered result</th></tr></thead>
    <tbody>{actions.map(a => <tr key={a.id}><td><Ref r={{ id: a.id, sequence: a.sequence, label: `#${a.sequence}`, known: true }} /><span className="mono">{a.action}</span>{a.target && <div className="muted">{a.target}</div>}</td>
      <td>{a.deliveredAtIso ? fmtTime(a.deliveredAtIso) : "not recorded"}<div className="muted">{a.trusted}</div></td>
      <td><span className={`tone-${a.plcTone}`}>{a.plc}</span>{a.acknowledgedAtIso && <div className="muted">{fmtTime(a.acknowledgedAtIso)}</div>}</td>
      <td>{a.rendered ?? <span className="muted">not recorded</span>}{a.screen && <div>screen <Ref r={{ id: a.screen.id, sequence: a.screen.sequence, label: `#${a.screen.sequence} HMI frame`, known: true }} />
        <span className={a.screen.supplied ? "br-supplied" : "br-not-supplied"}>{a.screen.supplied ? "sent to Muse" : "not sent to Muse"}</span></div>}</td></tr>)}</tbody>
  </table></div>;
}

function Assessment({ a }: { a: AssessmentView }) {
  return <article className="br-card">
    <header><h3>{a.requirementId}</h3><span className={`tag tone-${a.verdictTone}`}>Muse verdict: {a.verdict}</span><span className="tag">{a.review}</span><span className="mono muted">{a.assessmentId}</span>
      {a.sequence !== undefined && <Ref r={{ id: a.id, sequence: a.sequence, label: `#${a.sequence}`, known: true }} />}</header>
    <dl className="kv">
      <dt>Visible controls / results <span className="label-model">Muse</span></dt><dd>{a.observation}</dd>
      <dt>Uncertainty</dt><dd>{a.uncertainty}</dd>
      {a.separateReviews.length > 0 && <><dt>Separate review</dt><dd>{a.separateReviews.map((s, i) => <div key={i}>{s}</div>)}</dd></>}
    </dl>
    {a.citationIssues.length > 0 && <div className="br-issues"><b className="tone-warn">Citation check</b><ul>{a.citationIssues.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
    <h4 style={{ marginTop: 10 }}>Cited screenshots</h4>
    <div className="br-frames">{a.frames.map(f => <Frame key={f.id} f={f} />)}</div>
    {(a.actions.length > 0 || a.otherActionRefs.length > 0) && <><h4>Cited actions and acknowledgements</h4>{a.actions.length > 0 && <HmiActions actions={a.actions} />}
      {a.otherActionRefs.length > 0 && <p className="muted">Other cited action evidence: <Refs refs={a.otherActionRefs} /></p>}</>}
    <h4 style={{ marginTop: 10 }}>Matching PLC observations</h4>
    {a.plc.map(g => <details key={g.ref.id} className="br-section" data-print-open=""><summary><Ref r={g.ref} /> recorded {fmtTime(g.atIso)}{g.plcCycle ? ` · PLC cycle ${g.plcCycle}` : ""}</summary><Values group={g} /></details>)}
  </article>;
}

function Hmi({ view }: { view: ReportView }) {
  const h = view.hmi;
  const mode = useContext(ModeContext);
  const shown = new Set(h.assessments.flatMap(a => a.frames.map(f => f.id)));
  return <section className="panel" aria-label="HMI assessments">
    <header><h2>HMI behaviour</h2><span className="note">{h.note}</span></header>
    <div className="body">
      {h.captured > 0 && <p className="muted">Screenshot capture and supply to Muse are separate: each frame states whether its pixels were actually sent to Muse. Assessment verdicts are Muse-authored; any separate review is listed with its own status.</p>}
      {h.assessments.map(a => <Assessment key={a.id} a={a} />)}
      {!h.assessments.length && <p>{h.captured || h.actions.length ? "No HMI assessment was recorded in this campaign." : "No HMI behaviour was observed or assessed in this campaign record."}</p>}
      {h.actions.length > 0 && <details className="br-section" data-print-open=""><summary>All HMI actions ({h.actions.length})</summary><HmiActions actions={h.actions} /></details>}
      {h.frames.length > 0 && <details className="br-section" data-print-open=""><summary>All captured frames ({h.captured}; {h.supplied} supplied to Muse)</summary><div className="table-wrap"><table>
        <thead><tr><th>Frame</th><th>Captured</th><th>Supplied to Muse</th><th>Image</th></tr></thead>
        <tbody>{h.frames.map(f => <tr key={f.id}><td><Ref r={{ id: f.id, sequence: f.sequence, label: `#${f.sequence}`, known: true }} /><span className="mono muted">{f.actionId}</span></td><td>{fmtTime(f.capturedAtIso)}</td>
          <td className={f.supplied ? "br-supplied" : "br-not-supplied"}>{f.suppliedLabel}</td>
          <td className="muted">{!f.image.src ? f.image.note : shown.has(f.id) ? "shown with its assessment above"
            : <img className="br-mini" src={f.image.src} alt={`HMI frame #${f.sequence}`} loading={mode === "app" ? "lazy" : undefined} />}</td></tr>)}</tbody>
      </table></div></details>}
    </div>
  </section>;
}

function FinalState({ view }: { view: ReportView }) {
  const s = view.finalState;
  return <section className="panel" aria-label="Final recorded state">
    <header><h2>Final recorded PLC and connection state</h2><span className="tag">{view.source.historical ? "historical" : "latest recorded"}</span></header>
    <div className="body">{s ? <>
      <p>{s.note}</p>
      <dl className="kv"><dt>PLC output recorded</dt><dd>{fmtTime(s.atIso)}{s.sourceAtIso ? ` (source ${fmtTime(s.sourceAtIso)})` : ""}</dd><dt>PLC cycle</dt><dd className="mono">{s.plcCycle ?? "Unavailable"}</dd>
        <dt>PLC boot identity</dt><dd className="mono">{s.bootIdentity ?? "Unavailable"}</dd><dt>Connector state</dt><dd>{s.connector ?? "Unavailable"}</dd></dl>
      <details className="br-section" data-print-open=""><summary>All {s.values.length} recorded output values</summary><div className="br-values">{s.values.map(([k, v]) => <div key={k}><span>{k}</span><span>{v}</span></div>)}</div></details>
    </> : <p className="muted">No PLC output was recorded in this campaign.</p>}</div>
  </section>;
}

function Accounting({ view }: { view: ReportView }) {
  const a = view.accounting;
  return <section className="panel" aria-label="Usage and accounting">
    <header><h2>Usage and accounting</h2><span className="note">Reservations and estimates, not invoices</span></header>
    <div className="body">
      <h3 style={{ marginTop: 0 }}>Budget reservations</h3><Facts facts={a.reservations} /><p className="muted" style={{ marginTop: 6 }}>{a.reservationNote}</p>
      <h3>Model token usage (as reported per request)</h3><Facts facts={a.tokens} />
      <h3>Token-cost estimates</h3>{a.estimates.length ? <Facts facts={a.estimates} /> : null}<p className="muted" style={{ marginTop: 6 }}>{a.estimateNote}</p>
    </div>
  </section>;
}

function Attachments({ attachments }: { attachments: AttachmentRecord[] }) {
  return <section className="panel" aria-label="Separate review artifacts">
    <header><h2>Separate review artifacts</h2><span className="note">Not part of the model report; status and origin shown as recorded</span></header>
    <div className="body">{attachments.length ? attachments.map(a => <details className="br-card" key={a.file} data-print-open="" open>
      <summary><h4 className="mono">{a.file}</h4><span className="tag">{a.kind === "offline_audit" ? "offline audit" : "engineering review"}</span><span className="tag">status: {a.status.replaceAll("_", " ")}</span></summary>
      <p className="muted">{a.origin}</p>
      <dl className="kv">
        {a.scope && <><dt>Scope</dt><dd>{a.scope}</dd></>}{a.atIso && <><dt>Recorded</dt><dd>{fmtTime(a.atIso)}</dd></>}
        <dt>File SHA-256</dt><dd className="mono">{a.sha256}</dd>
        {a.facts.map(f => <Fragment key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></Fragment>)}
        {a.citationDefects.length > 0 && <><dt>Citation defects</dt><dd className="tone-warn">{a.citationDefects.map(d => `${d.assessmentId} cites ${d.frameId}`).join("; ")}</dd></>}
        {a.requirementNotes.map(n => <Fragment key={n.requirementId}><dt>{n.requirementId}</dt><dd>{n.note}</dd></Fragment>)}
        {a.claimBoundary && <><dt>Claim boundary</dt><dd>{a.claimBoundary}</dd></>}
      </dl>
      {a.limitations.length > 0 && <><h4 style={{ marginTop: 10 }}>Limitations stated by the review</h4><ul>{a.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></>}
    </details>) : <p className="muted">No separate audit or engineering review is attached to this report.</p>}</div>
  </section>;
}

function EvidenceTable({ rows }: { rows: EvidenceRow[] }) {
  return <div className="table-wrap"><table>
    <thead><tr><th>Evidence</th><th>Recorded</th><th>Summary</th></tr></thead>
    <tbody>{rows.map(e => <tr key={e.id} id={`ev-${e.sequence}`}><td><span className="mono">#{e.sequence}</span><div className="muted">{e.type}</div></td>
      <td>{fmtTime(e.atIso)}{e.sourceAtIso && <div className="muted">source {fmtTime(e.sourceAtIso)}</div>}</td>
      <td>{e.summary}{(e.plcCycle || e.bootIdentity) && <div className="muted mono">{e.plcCycle ? `cycle ${e.plcCycle}` : ""}{e.bootIdentity ? ` · boot ${e.bootIdentity}` : ""}</div>}
        {e.values.length > 0 && <details className="br-section"><summary>{e.values.length} values</summary><div className="br-values">{e.values.map(([k, v]) => <div key={k}><span>{k}</span><span>{v}</span></div>)}</div></details>}
        <div className="mono muted">{e.id}</div></td></tr>)}</tbody>
  </table></div>;
}

function Appendix({ view, focus }: { view: ReportView; focus?: string }) {
  const mode = useContext(ModeContext);
  const rows = view.evidence;
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  useEffect(() => {
    if (!focus) return;
    const index = rows.findIndex(r => r.id === focus);
    if (index < 0) return;
    setOpen(true); setPage(Math.floor(index / PAGE));
    const seq = rows[index]!.sequence;
    requestAnimationFrame(() => { const el = document.getElementById(`ev-${seq}`); el?.scrollIntoView({ block: "center" }); el?.classList.add("br-flash"); setTimeout(() => el?.classList.remove("br-flash"), 1600); });
  }, [focus, rows]);
  const groups = Array.from({ length: Math.ceil(rows.length / STANDALONE_GROUP) }, (_, i) => rows.slice(i * STANDALONE_GROUP, (i + 1) * STANDALONE_GROUP));
  return <section className="panel" aria-label="Evidence appendix">
    <header><h2>Evidence appendix</h2><span className="note">{rows.length} cited records of {view.ledgerEventCount.toLocaleString("en-US")} ledger events; the full ledger is a separate file</span></header>
    <div className="body">
      <h3 style={{ marginTop: 0 }}>Integrity and sources</h3>
      <Facts facts={view.integrity} />
      <div className="table-wrap" style={{ marginTop: 10 }}><table>
        <thead><tr><th>Source file</th><th>Role</th><th>SHA-256</th><th>Size</th></tr></thead>
        <tbody>{view.sources.map(s => <tr key={s.file}><td className="mono">{s.file}{s.embeddedBase64 && <div className="no-print"><a className="br-ref" download={s.file} href={`data:${s.contentType ?? "application/octet-stream"};base64,${s.embeddedBase64}`}>download original bytes</a></div>}</td>
          <td>{s.role}{s.events !== undefined ? ` · ${s.events.toLocaleString("en-US")} events` : ""}</td><td className="mono">{s.sha256}</td><td>{(s.byteLength / 1024).toFixed(1)} KiB</td></tr>)}
          {!view.sources.length && <tr><td colSpan={4} className="muted">Served by the current host: use the JSON report and ledger downloads above.</td></tr>}</tbody>
      </table></div>
      <details className="br-section" data-print-open=""><summary>Muse decision trail ({view.modelTrail.length} model requests; decisions are model-authored)</summary><div className="table-wrap"><table>
        <thead><tr><th>Request</th><th>Started · elapsed</th><th>Tokens</th><th>Decision summary (Muse)</th></tr></thead>
        <tbody>{view.modelTrail.map(m => <tr key={m.requestId}><td className="mono">{m.requestId}<div className={`tone-${m.tone}`}>{m.phase}</div><div className="muted">{m.experimentId}</div></td>
          <td>{fmtTime(m.startedAtIso)}<div className="muted">{m.elapsed}</div></td><td>{m.tokens}{m.exchange && <div className="muted">{m.exchange}</div>}</td><td>{m.decision ?? <span className="muted">none recorded</span>}</td></tr>)}</tbody>
      </table></div></details>
      <h3>Cited evidence records</h3>
      {mode === "app" ? <details className="br-section" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>{rows.length} records, {PAGE} per page</summary>
        <div className="br-pager"><button type="button" className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="muted">Page {page + 1} of {pages}</span><button type="button" className="btn small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button></div>
        <EvidenceTable rows={rows.slice(page * PAGE, (page + 1) * PAGE)} />
      </details> : groups.map((g, i) => <details key={i} className="br-section" {...(i === 0 ? { "data-print-open": "" } : {})}>
        <summary>Evidence #{g[0]!.sequence} – #{g.at(-1)!.sequence} ({g.length} records)</summary><EvidenceTable rows={g} /></details>)}
      {mode === "standalone" && groups.length > 1 && <p className="muted">Printed copies include the first evidence group; open the HTML report for the remaining groups.</p>}
      {view.diagnostics && <details className="br-section"><summary>Internal diagnostics</summary><dl className="kv">{Object.entries(view.diagnostics).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="mono">{v}</dd></Fragment>)}</dl></details>}
    </div>
  </section>;
}
