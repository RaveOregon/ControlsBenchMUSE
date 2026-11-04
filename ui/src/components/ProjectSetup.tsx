// Setup destination for specification-to-project onboarding: create or reopen a project, prepare
// it with Muse (a server-side job the page polls), review the world, mapping, validation and
// source-linked plan, and select an exact validated version. The prepared conveyor example stays
// one click away and is labelled as such. Summaries first; details expand.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { projectsApi, readUpload, type ProjectsIndex, type Review, type Upload, type VersionView } from "../projects/api.ts";
import "../projects/projects.css";

const ACTIVE = ["queued", "preparing", "validating", "repairing"];
const STATUS_LABEL: Record<string, string> = { draft: "not prepared", queued: "queued", preparing: "preparing with Muse", validating: "validating", repairing: "repairing",
  needs_information: "needs information", ready: "ready", failed: "failed", cancelled: "cancelled" };
const STATUS_TONE: Record<string, string> = { ready: "ok", failed: "bad", cancelled: "warn", needs_information: "warn", queued: "info", preparing: "info", validating: "info", repairing: "info", draft: "" };
const remember = (key: string, value?: string) => { try { value === undefined ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* storage unavailable */ } };
const recall = (key: string) => { try { return localStorage.getItem(key) ?? undefined; } catch { return undefined; } };
const short = (h?: string) => h ? `${h.slice(0, 12)}…` : "—";
const ago = (iso?: string, now = Date.now()) => { if (!iso) return "—"; const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000)); return s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ${s % 60} s ago`; };
const duration = (from?: string, to?: string, now = Date.now()) => { if (!from) return "—"; const s = Math.max(0, Math.round(((to ? Date.parse(to) : now) - Date.parse(from)) / 1000)); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };

export function ProjectSetup({ index, refresh, onOpenReport }: { index: ProjectsIndex; refresh: () => void; onOpenReport: (url: string, title: string) => void }) {
  const [open, setOpen] = useState<{ projectId: string; version: string } | undefined>(() => {
    const saved = recall("cb.project.open");
    if (saved) { const [projectId, version] = saved.split("/"); if (projectId && version) return { projectId, version }; }
    return index.active ? { projectId: index.active.projectId, version: index.active.version } : undefined;
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const select = (projectId: string, version: string) => { setOpen({ projectId, version }); remember("cb.project.open", `${projectId}/${version}`); setCreating(false); };
  const activateExample = async () => {
    try { await projectsApi.activate("example-conveyor", "example"); select("example-conveyor", "example"); refresh(); setError(undefined); }
    catch (e) { setError((e as Error).message); }
  };
  const active = index.active;
  return <div className="project-setup">
    <div className="page-heading"><div><div className="eyebrow">Setup · machine project</div><h1>Project</h1>
      <p>Supply a machine specification and its I/O, prepare a simulated world and test plan with Muse, review it, then select it for campaigns.</p></div>
      <div className="actions"><button className="btn" onClick={activateExample} disabled={index.campaignRunning}>Load example conveyor</button>
        <button className="btn primary" onClick={() => setCreating(true)}>Create project from specification</button></div></div>
    {error && <div className="source-notice" role="alert">{error}</div>}
    <section className="panel" aria-label="Active project">
      <header><h2>Active project for campaigns</h2>{active ? <span className={`tag ${active.kind === "example" ? "replay" : "live"}`}>{active.kind === "example" ? "prepared example · historical evidence" : "uploaded specification"}</span> : <span className="tag">none selected</span>}
        {index.campaignRunning && <span className="tag">frozen while a campaign runs</span>}</header>
      <div className="body">{active ? <dl className="kv">
        <dt>Project</dt><dd><button className="text-button" onClick={() => select(active.projectId, active.version)}>{active.projectName} · {active.version}</button></dd>
        <dt>Specification</dt><dd className="mono">sha256 {active.specSha256}</dd>
        <dt>Generated world</dt><dd className="mono">sha256 {active.worldSha256}</dd>
        <dt>Bench profile</dt><dd>CODESYS M8 conveyor interface (m8-conveyor-1.0.2) · offline isolated child with fixture M8 transport in this host; live use needs commissioning</dd>
        <dt>Selected</dt><dd>{new Date(active.selectedAtIso).toLocaleString()}</dd></dl>
        : <p className="muted">Select a validated project version, or Load example conveyor, before starting a campaign.</p>}</div>
    </section>
    {creating && <CreateProject index={index} onCancel={() => setCreating(false)} onCreated={(projectId, version) => { select(projectId, version); refresh(); }} />}
    <section className="panel" aria-label="Projects">
      <header><h2>Projects</h2><span className="note muted">Preparation author on this host: {index.author.label}</span></header>
      <div className="table-wrap"><table className="results-table"><thead><tr><th>Project</th><th>Versions</th><th>Created</th></tr></thead>
        <tbody>{index.projects.map(p => <tr key={p.id}><td><b>{p.name}</b>{p.kind === "example" && <div className="muted">Prepared example with its own historical evidence</div>}</td>
          <td>{p.versions.map(v => <button key={v.version} className={`chip ${open?.projectId === p.id && open.version === v.version ? "open" : ""}`} onClick={() => select(p.id, v.version)}>
            {v.version} <span className={`tone-${STATUS_TONE[v.status]}`}>{STATUS_LABEL[v.status] ?? v.status}</span></button>)}</td>
          <td>{new Date(p.createdAtIso).toLocaleString()}</td></tr>)}</tbody></table></div>
    </section>
    {open && <VersionPanel key={`${open.projectId}/${open.version}`} index={index} projectId={open.projectId} version={open.version} refresh={refresh} onSelect={select} onOpenReport={onOpenReport} />}
  </div>;
}

function CreateProject({ index, onCancel, onCreated }: { index: ProjectsIndex; onCancel: () => void; onCreated: (projectId: string, version: string) => void }) {
  const [name, setName] = useState(""), [specText, setSpecText] = useState(""), [ioText, setIoText] = useState("");
  const [specFile, setSpecFile] = useState<File>(), [ioFile, setIoFile] = useState<File>();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const submit = async () => {
    setBusy(true); setError(undefined);
    try {
      const spec: Upload | undefined = specFile ? await readUpload(specFile) : specText.trim() ? { name: "pasted-specification.md", text: specText } : undefined;
      if (!spec) throw new Error("Upload or paste a specification");
      const io: Upload | undefined = ioFile ? await readUpload(ioFile) : ioText.trim() ? { name: "pasted-io.txt", text: ioText } : undefined;
      const created = await projectsApi.create(name, spec, io);
      onCreated(created.project.id, created.record.version);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="panel" aria-label="Create project">
    <header><h2>Create project from specification</h2></header>
    <div className="body project-form">
      <label>Project name<input value={name} maxLength={index.limits.nameChars} onChange={e => setName(e.target.value)} placeholder="e.g. Sorter line 2" /></label>
      <fieldset><legend>Machine specification (required)</legend>
        <input type="file" aria-label="Specification file" accept={index.formats.specification.join(",")} onChange={e => setSpecFile(e.target.files?.[0])} />
        <span className="muted">or paste it:</span><textarea aria-label="Paste specification" rows={6} value={specText} onChange={e => setSpecText(e.target.value)} disabled={Boolean(specFile)} /></fieldset>
      <fieldset><legend>PLC I/O list (optional when the specification embeds its I/O tables)</legend>
        <input type="file" aria-label="I/O file" accept={index.formats.io.join(",")} onChange={e => setIoFile(e.target.files?.[0])} />
        <span className="muted">or paste it:</span><textarea aria-label="Paste I/O list" rows={4} value={ioText} onChange={e => setIoText(e.target.value)} disabled={Boolean(ioFile)} /></fieldset>
      <p className="muted">Supported: specification {index.formats.specification.join(", ")} (up to {index.limits.specBytes / 1024} KiB); I/O {index.formats.io.join(", ")} (up to {index.limits.ioBytes / 1024} KiB). {index.formats.note} The original bytes are kept with their SHA-256.</p>
      {error && <p className="verdict-fail" role="alert">{error}</p>}
      <div className="actions"><button className="btn primary" disabled={busy || !name.trim()} onClick={submit}>{busy ? "Creating…" : "Create project"}</button><button className="btn" onClick={onCancel}>Cancel</button></div>
    </div>
  </section>;
}

function VersionPanel({ index, projectId, version, refresh, onSelect, onOpenReport }: { index: ProjectsIndex; projectId: string; version: string; refresh: () => void;
  onSelect: (p: string, v: string) => void; onOpenReport: (url: string, title: string) => void }) {
  const [view, setView] = useState<VersionView & { project: { name: string; kind: string; versions: string[] } }>();
  const [error, setError] = useState<string>(), [now, setNow] = useState(Date.now()), [revising, setRevising] = useState(false);
  const load = useCallback(async () => { try { setView(await projectsApi.version(projectId, version)); setError(undefined); } catch (e) { setError((e as Error).message); } }, [projectId, version]);
  useEffect(() => { void load(); }, [load]);
  const running = view ? ACTIVE.includes(view.record.status) : false;
  useEffect(() => {
    if (!running) return;
    const poll = setInterval(() => { void load(); refresh(); }, 1500), tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [running, load, refresh]);
  const act = async (task: () => Promise<unknown>) => { try { await task(); setError(undefined); await load(); refresh(); } catch (e) { setError((e as Error).message); } };
  if (!view) return <section className="panel"><div className="body muted">{error ?? "Loading project…"}</div></section>;
  const { record, review } = view, job = record.job, example = projectId === "example-conveyor";
  const isActive = index.active?.projectId === projectId && index.active.version === version;
  return <section className="panel version-panel" aria-label="Project version">
    <header><h2>{view.project.name} · {version}</h2><span className={`tag tone-${STATUS_TONE[record.status]}`}>{STATUS_LABEL[record.status] ?? record.status}</span>
      {isActive && <span className="tag live">active for campaigns</span>}{record.basedOn && <span className="tag">revision of {record.basedOn}</span>}</header>
    <div className="body">
      {error && <p className="verdict-fail" role="alert">{error}</p>}
      {example && <p>Prepared example: Muse generated this conveyor world on 2026-10-29 from the accepted specification; its qualification and live campaigns (W4 fault/adaptive, S2 HMI) are historical evidence for this world only. It has no pre-run plan: campaigns plan after Start, as in those runs.</p>}
      <h3>Inputs</h3>
      <dl className="kv"><dt>Specification</dt><dd>{record.inputs.spec.name} · {(record.inputs.spec.byteLength / 1024).toFixed(1)} KiB · <span className="mono">sha256 {record.inputs.spec.sha256}</span></dd>
        <dt>I/O</dt><dd>{record.inputs.io ? <>{record.inputs.io.name} · <span className="mono">sha256 {record.inputs.io.sha256}</span></> : record.inputs.ioSource === "embedded" ? "Embedded in the specification" : record.status === "draft" ? "No separate list (embedded tables are read at preparation)" : "None found"}</dd>
        {record.revisionNote && <><dt>Revision note</dt><dd>{record.revisionNote}</dd></>}</dl>
      <details><summary>View the specification as uploaded</summary><pre className="document-text">{view.specText}</pre></details>
      {view.ioText && <details><summary>View the I/O list as uploaded</summary><pre className="document-text">{view.ioText}</pre></details>}

      {!example && <>
        <h3>Preparation</h3>
        {job ? <div className="prep-status" role="status" aria-live="polite">
          <dl className="kv"><dt>Status</dt><dd className={`tone-${STATUS_TONE[job.state]}`}>{STATUS_LABEL[job.state] ?? job.state}{job.error ? ` — ${job.error}` : ""}</dd>
            <dt>Author</dt><dd>{job.provider.label}</dd>
            <dt>Elapsed</dt><dd>{duration(job.startedAtIso ?? job.queuedAtIso, job.endedAtIso, now)}</dd>
            <dt>Last activity</dt><dd>{job.lastActivity ? <>{job.lastActivity.message} <span className="muted">({ago(job.lastActivity.atIso, now)})</span></> : "—"}</dd>
            <dt>Model requests</dt><dd>{job.requests} of at most {job.maxRequests} · {job.repairs} repair request{job.repairs === 1 ? "" : "s"}</dd>
            <dt>Token usage</dt><dd>{job.usage.inputTokens.toLocaleString()} in ({job.usage.cachedInputTokens.toLocaleString()} cached) · {job.usage.outputTokens.toLocaleString()} out ({job.usage.reasoningTokens.toLocaleString()} reasoning)</dd>
            <dt>Accounting</dt><dd>${job.reservationsUsd} conservative reservation{job.provider.paid ? "" : " (fixture: none)"} · ≈ ${job.estimatedUsd.toFixed(4)} token-cost estimate at uncached list rates. Neither is an invoice.</dd></dl>
          <details><summary>Activity log ({job.activities.length})</summary><ol className="activity-log">{job.activities.map((a, i) => <li key={i}><span className="mono muted">{a.atIso.slice(11, 19)}</span> {a.message}</li>)}</ol></details>
        </div> : <p className="muted">Not prepared yet. Preparation sends this project's specification{record.inputs.io ? " and I/O list" : ""} to {index.author.label}, then validates the result in an isolated worker. It runs no PLC test.</p>}
        <div className="actions">
          {!running && record.status !== "ready" && <button className="btn primary" onClick={() => act(() => projectsApi.prepare(projectId, version))}>{record.job ? "Prepare again" : index.author.fixture ? "Prepare (fixture author — not Muse)" : "Prepare with Muse"}</button>}
          {running && <button className="btn danger" onClick={() => act(() => projectsApi.cancel(projectId, version))}>Cancel preparation</button>}
          {!running && <button className="btn" onClick={() => setRevising(!revising)}>Edit and create revision</button>}
        </div>
        {revising && <Revise view={view} onDone={next => { setRevising(false); onSelect(projectId, next); refresh(); }} projectId={projectId} version={version} />}
      </>}
      {review && <ReviewPanel review={review} projectId={projectId} version={version} />}

      <h3>Use for campaigns</h3>
      <div className="actions"><button className="btn primary" disabled={Boolean(view.activationBlocked) || isActive || index.campaignRunning}
        title={view.activationBlocked ?? undefined} onClick={() => act(() => projectsApi.activate(projectId, version))}>{isActive ? "Active" : example ? "Use prepared example" : "Use this version"}</button>
        <span className={view.activationBlocked ? "tone-warn" : "muted"}>{index.campaignRunning ? "A campaign is running; the selection is frozen." : view.activationBlocked ?? (isActive ? "Campaigns use this exact version." : "Validated and compatible; selecting it freezes these hashes for the next campaign.")}</span></div>

      {!example && <><h3>Runs</h3>{view.runs.length ? <table className="results-table"><thead><tr><th>Campaign</th><th>Started</th><th>Status</th><th>Report</th></tr></thead>
        <tbody>{view.runs.map(r => <tr key={r.campaignId}><td className="mono">{r.campaignId}</td><td>{new Date(r.startedAtIso).toLocaleString()}</td><td>{r.status}</td>
          <td>{r.reportAvailable ? <button className="text-button" onClick={() => onOpenReport(projectsApi.runBundleUrl(projectId, version, r.campaignId), `${view.project.name} ${version} · ${r.campaignId}`)}>Open report</button> : <span className="muted">not available</span>}</td></tr>)}</tbody></table>
        : <p className="muted">No campaign has run this version yet.</p>}</>}
    </div>
  </section>;
}

function Revise({ view, projectId, version, onDone }: { view: VersionView; projectId: string; version: string; onDone: (version: string) => void }) {
  const [spec, setSpec] = useState(view.specText ?? ""), [io, setIo] = useState(view.ioText ?? ""), [note, setNote] = useState(""), [error, setError] = useState<string>();
  const submit = async () => {
    try {
      const specChanged = spec !== view.specText, ioChanged = io !== (view.ioText ?? "");
      const next = await projectsApi.revise(projectId, version, { ...(specChanged ? { spec: { name: view.record.inputs.spec.name, text: spec } } : {}),
        ...(ioChanged ? { io: io.trim() ? { name: view.record.inputs.io?.name ?? "io.txt", text: io } : null } : {}), note });
      onDone(next.record.version);
    } catch (e) { setError((e as Error).message); }
  };
  return <div className="project-form">
    <p className="muted">A revision is a new version. {version} and all its artifacts and evidence stay unchanged.</p>
    <label>Specification<textarea rows={10} value={spec} onChange={e => setSpec(e.target.value)} /></label>
    <label>I/O list (empty: none)<textarea rows={4} value={io} onChange={e => setIo(e.target.value)} /></label>
    <label>What changed<input value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></label>
    {error && <p className="verdict-fail">{error}</p>}
    <button className="btn primary" onClick={submit}>Create revision</button>
  </div>;
}

function ReviewPanel({ review, projectId, version }: { review: Review; projectId: string; version: string }) {
  const groups = useMemo(() => { const m = new Map<string, Review["plan"]["checks"]>(); for (const c of review.plan.checks) m.set(c.group, [...(m.get(c.group) ?? []), c]); return [...m]; }, [review]);
  const v = review.validation, c = review.compatibility;
  const mapping = new Map((c?.uploaded ?? []).map(u => [u.name, u]));
  return <div className="review" aria-label="Preparation review">
    <h3>Review</h3>
    <p>{review.summary} {review.author.fixture ? <span className="tag">fixture author — not Muse</span> : <span className="label-model">Muse summary · model-authored</span>}</p>
    {review.questions.length > 0 && <div className={review.questions.some(q => q.blocking) ? "source-notice" : "review-questions"}><b>Questions for the engineer</b><ul>{review.questions.map(q => <li key={q.id}>{q.blocking && <b>Blocking: </b>}{q.question} <span className="muted">({q.relatesTo})</span></li>)}</ul></div>}
    <div className="review-grid">
      <div><h4>Validation</h4>{v ? <><p className={v.ok ? "tone-ok" : "verdict-fail"}>{v.ok ? `Passed ${v.checks.length} independent checks` : `${v.checks.filter(x => x.status === "fail").length} failed`} · isolated worker · {(v.durationMs / 1000).toFixed(1)} s</p>
        {review.measured && <dl className="kv small">{Object.entries(review.measured).map(([k, val]) => <Fragment key={k}><dt>{k}</dt><dd className="mono">{String(val)}</dd></Fragment>)}</dl>}</> : <p className="muted">Not validated</p>}</div>
      <div><h4>M8 bench mapping</h4>{c ? <><p className={c.compatible ? "tone-ok" : "verdict-fail"}>{c.compatible ? "Compatible with " : "Not compatible with "}{c.profile.interface}</p><p className="muted">{c.liveReadyReason}</p></> : <p className="muted">Not checked</p>}</div>
      <div><h4>Test plan</h4><p>{review.plan.checks.length} checks · {review.plan.checks.filter(x => x.available).length} runnable on this bench</p><p className="muted">{review.plan.objective}</p></div>
    </div>
    <details open><summary>Planned checks by group ({review.plan.checks.length})</summary>{groups.map(([group, checks]) => <div key={group} className="plan-group"><h4>{group}</h4>
      <table className="results-table"><thead><tr><th>Check</th><th>Stimulus</th><th>Expected observation</th><th>Source</th></tr></thead><tbody>{checks.map(x => <tr key={x.id}>
        <td><span className="mono">{x.id}</span><div>{x.title}</div>{!x.available && <div className="tone-warn">Unavailable: {x.unavailableReason}</div>}</td><td>{x.stimulus}</td>
        <td><span className={x.expectedBasis === "specified" ? "tag tone-ok" : "tag tone-warn"}>{x.expectedBasis}</span> {x.expectedObservation}{x.observeSignals.length > 0 && <div className="muted mono">observe {x.observeSignals.join(", ")}</div>}</td>
        <td>{[...x.requirementRefs, ...x.sourceRefs].join(", ")}</td></tr>)}</tbody></table></div>)}</details>
    <details><summary>I/O and mapping ({review.io.rows.length} {review.io.source} signals)</summary><table className="results-table"><thead><tr><th>Signal</th><th>Direction</th><th>Native type</th><th>Unit / normal</th><th>M8 mapping</th><th>Source</th></tr></thead>
      <tbody>{review.io.rows.map(r => { const m = mapping.get(r.name); return <tr key={r.name}><td className="mono">{r.name}</td><td>{r.direction}</td><td>{r.nativeType ?? "—"}</td><td>{[r.unit, r.normal].filter(Boolean).join(" · ") || "—"}</td>
        <td className={m?.status === "mapped" ? "tone-ok" : "tone-warn"}>{m ? `${m.status.replace("_", " ")}${m.m8Type ? ` (${m.m8Type})` : ""}` : "—"}</td><td className="muted">{r.source}</td></tr>; })}</tbody></table>
      {c && c.missingFromUpload.length > 0 && <p className="muted">M8 signals not in the uploaded list: {c.missingFromUpload.join(", ")}</p>}</details>
    {c && <details><summary>World signals against the M8 interface ({c.signals.length}; {c.issues.length} issue{c.issues.length === 1 ? "" : "s"})</summary>
      {c.issues.length > 0 && <ul>{c.issues.map((i, n) => <li key={n} className={i.severity === "blocking" ? "verdict-fail" : "tone-warn"}>{i.severity}: {i.message}</li>)}</ul>}
      <table className="results-table"><thead><tr><th>Signal</th><th>Direction / type</th><th>Role</th><th>M8 path</th><th>Result</th></tr></thead><tbody>{c.signals.map(s => <tr key={s.id}><td className="mono">{s.id}</td><td>{s.direction} · {s.dataType}</td><td>{s.role}</td><td className="mono">{s.m8?.iecPath ?? "—"}</td><td className={s.status === "mapped" ? "tone-ok" : "verdict-fail"}>{s.status.replace("_", " ")}</td></tr>)}</tbody></table>
      <p className="muted">World controls: {c.controls.declared.join(", ")}{c.controls.unbound.length ? ` · not reachable by campaign tools: ${c.controls.unbound.join(", ")}` : ""}</p></details>}
    <details><summary>Physical parameters and assumptions ({review.physicalParameters.length})</summary><table className="results-table"><thead><tr><th>Parameter</th><th>Value</th><th>Basis</th><th>Source</th></tr></thead>
      <tbody>{review.physicalParameters.map((p, i) => <tr key={i}><td>{p.name}</td><td className="mono">{p.value} {p.unit}</td><td className={p.basis === "specified" ? "tone-ok" : "tone-warn"}>{p.basis}</td><td>{p.source}</td></tr>)}</tbody></table>
      <p><a className="text-button" href={projectsApi.fileUrl(projectId, version, "assumptions.md")} target="_blank" rel="noreferrer">Open assumptions.md</a> · <a className="text-button" href={projectsApi.fileUrl(projectId, version, "world.ts")} target="_blank" rel="noreferrer">world.ts</a> · <a className="text-button" href={projectsApi.fileUrl(projectId, version, "world.manifest.json")} target="_blank" rel="noreferrer">manifest</a> · <a className="text-button" href={projectsApi.fileUrl(projectId, version, "world.test.ts")} target="_blank" rel="noreferrer">tests</a></p></details>
    {v && <details><summary>Validation checks ({v.checks.length})</summary><table className="results-table"><thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead><tbody>{v.checks.map(x => <tr key={x.id}>
      <td><span className="mono">{x.id}</span><div className="muted">{x.title}</div></td><td className={x.status === "pass" ? "tone-ok" : x.status === "fail" ? "verdict-fail" : "muted"}>{x.status}{x.classification ? ` · ${x.classification}` : ""}</td><td><pre className="detail">{x.detail}</pre></td></tr>)}</tbody></table></details>}
    <details><summary>Generation lineage ({review.lineage.length} attempt{review.lineage.length === 1 ? "" : "s"})</summary><table className="results-table"><thead><tr><th>Attempt</th><th>Response</th><th>Duration</th><th>Validation</th></tr></thead>
      <tbody>{review.lineage.map(l => <tr key={l.attempt}><td>{l.attempt} · {l.purpose}</td><td className="mono">{l.responseId ?? `${l.model} (no model response)`}</td><td>{(l.durationMs / 1000).toFixed(0)} s</td><td className={l.validationOk ? "tone-ok" : "verdict-fail"}>{l.validationOk ? "passed" : "failed"}</td></tr>)}</tbody></table></details>
  </div>;
}
