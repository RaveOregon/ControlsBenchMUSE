import { Fragment, useEffect, useRef, useState } from 'react';
import type { HmiSource } from '../adapters/live/hmi-source.ts';
import { validatedMediaUrl } from '../adapters/live/hmi-source.ts';
import type { CommandResult, WorkspaceState } from '../model/workspace-store.ts';
import { HMI_NOT_OBSERVED, hmiTileModel } from '../model/hmi-tile.ts';
import type { Selection } from './selection.ts';

export interface HostedHmiControls {
  configure: (url: string) => CommandResult;
  disconnect: () => CommandResult;
}

export function HmiConfiguration({ source, onConfigure, state, hosted }: { source: HmiSource | null; onConfigure: (s: HmiSource | null) => void; state?: WorkspaceState; hosted?: HostedHmiControls }) {
  const [kind, setKind] = useState<'webvisu' | 'capture'>('webvisu');
  const [value, setValue] = useState(state?.hmi.url ?? '');
  const [note, setNote] = useState('');
  if (hosted && state) {
    const hmi = state.hmi;
    const active = hmi.state === 'observing' || hmi.state === 'stale' || hmi.state === 'connecting';
    return <section className="panel"><header><h2>Operator HMI source</h2><span className={`tag hmi-state-${hmi.state}`}>{hmi.state.replace('_', ' ')}</span></header>
      <form className="body" onSubmit={e => { e.preventDefault(); try { const url = validatedMediaUrl(value.trim()); const r = hosted.configure(url); setNote(r.ok ? 'Requested. The host opens a controlled browser on this URL; observation starts with the first captured frame.' : r.reason); } catch (err) { setNote(String(err)); } }}>
        <label className="field">Browser HMI URL (opened by the portal host)<input value={value} onChange={e => setValue(e.target.value)} placeholder="http://127.0.0.1:5181/?capture=portal" /></label>
        <div className="actions"><button className="btn" type="submit">{active ? 'Reconnect source' : 'Observe HMI'}</button>{active && <button className="btn" type="button" onClick={() => { const r = hosted.disconnect(); setNote(r.ok ? 'Disconnect requested.' : r.reason); }}>Stop observing</button>}</div>
        <p className="muted">{note || hmi.detail}</p>
        <p className="muted">The tile shows only frames captured from this page. A configured URL is not an observation, and observation is not an HMI requirement verdict.</p>
      </form></section>;
  }
  return <section className="panel"><header><h2>PLC HMI source</h2><span className="tag">optional observation</span></header><form className="body" onSubmit={e => { e.preventDefault(); try { const url = kind === 'webvisu' ? validatedMediaUrl(value) : undefined; if (!value.trim()) throw new Error('Enter a URL or capture source ID.'); onConfigure({ id: value.trim(), kind, url, label: kind === 'webvisu' ? 'Configured WebVisu' : value.trim() }); setNote('Source configured. Observation is unconfirmed until timestamped evidence arrives.'); } catch (err) { setNote(String(err)); } }}>
    <label className="field">Source type<select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="webvisu">WebVisu URL</option><option value="capture">External browser / screen capture</option></select></label>
    <label className="field">{kind === 'webvisu' ? 'WebVisu URL' : 'Capture source ID'}<input value={value} onChange={e => setValue(e.target.value)} placeholder={kind === 'webvisu' ? 'https://controller/webvisu.htm' : 'workstation-hmi'} /></label>
    <div className="actions"><button className="btn" type="submit">Configure source</button>{source && <button className="btn" type="button" onClick={() => onConfigure(null)}>Disconnect HMI source</button>}</div>
    <p className="muted">{note || 'WebVisu embeds the actual configured page. External capture can supply timestamped actions, frames and clips. A configured URL alone does not establish HMI test coverage.'}</p>
  </form></section>;
}

const age = (ms: number | undefined) => ms === undefined ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

export function HmiSurface({ state, source, nowEpochMs, onSelect }: { state: WorkspaceState; source: HmiSource | null; nowEpochMs: number; onSelect: (s: Selection) => void }) {
  const model = hmiTileModel(state, nowEpochMs);
  const [expanded, setExpanded] = useState(false);
  const [embed, setEmbed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);
  const legacyEmbed = state.mode === 'live' && source?.kind === 'webvisu' && !state.host;
  const f = model.frame;
  return <section className={`panel hmi${expanded ? ' hmi-expanded' : ''}`} aria-label="Operator HMI" role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined}>
    <header><h2>Operator HMI</h2>
      <span className={`tag hmi-state-${model.connection}`} title={model.detail}>{model.connection.replace('_', ' ')}</span>
      {model.recording && <span className="tag live" title="Frames are being captured and retained as evidence">● recording</span>}
      <span className={`tag ${state.mode}`}>{state.mode === 'replay' ? 'recorded evidence' : 'actual HMI only'}</span>
      {f && <button className="btn small" ref={expanded ? closeRef : undefined} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? 'Close' : 'Expand'}</button>}
    </header>
    {f ? <figure className="hmi-frame">
      <img src={f.src} alt={`Captured PLC HMI frame at ${f.capturedAt}`} />
      {model.overlay && <figcaption className={`hmi-overlay hmi-overlay-${model.overlay.kind}`} role="status">{model.overlay.text}</figcaption>}
    </figure> : <div className="hmi-status"><b>{HMI_NOT_OBSERVED}</b><p className="muted">{model.detail}</p></div>}
    {f && <div className="body hmi-meta">
      <p><b>{model.headline}</b> <span className="muted">{model.detail}</span></p>
      <dl className="kv">
        <dt>Captured</dt><dd className="mono">{f.capturedAt}{f.requestedAt ? ` (requested ${f.requestedAt})` : ''}</dd>
        <dt>Frame age</dt><dd className={model.overlay ? 'quality-held' : undefined}>{age(f.ageMs)}</dd>
        {f.sequence !== undefined && <><dt>Frame</dt><dd className="mono">#{f.sequence}</dd></>}
        {f.pageUrl && <><dt>Rendered page</dt><dd className="mono">{f.pageUrl}</dd></>}
        {f.sha256 && <><dt>SHA-256</dt><dd className="mono" title={f.sha256}>{f.sha256.slice(0, 16)}…</dd></>}
        {f.reference && <><dt>Evidence ref</dt><dd className="mono">{f.reference}</dd></>}
      </dl>
      <div className="actions">{f.eventId && <button className="btn small" onClick={() => onSelect({ type: 'event', id: f.eventId! })}>Inspect frame evidence</button>}
        {model.lastAction && <button className="btn small" onClick={() => onSelect({ type: 'event', id: model.lastAction!.eventId })}>Last HMI input {model.lastAction.atIso.slice(11, 23)}</button>}</div>
    </div>}
    {model.identity.length > 0 && <details className="body"><summary>HMI session identity</summary><dl className="kv">{model.identity.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="mono">{v}</dd></Fragment>)}</dl></details>}
    {legacyEmbed && <div className="body"><button className="btn small" onClick={() => setEmbed(!embed)}>{embed ? 'Hide embedded WebVisu' : 'Embed configured WebVisu (interactive, not recorded)'}</button>
      {embed && <><iframe title="Actual PLC WebVisu (embedded, not recorded)" src={source?.url} referrerPolicy="no-referrer" /><p className="muted">Embedded interaction is not captured evidence. If embedding is blocked, <a href={source?.url} target="_blank" rel="noreferrer">open configured WebVisu</a>.</p></>}</div>}
    <p className="body muted hmi-boundary">Separate from the simulated world view. This tile shows only captured pixels of the actual HMI; it never redraws the HMI from PLC values.</p>
  </section>;
}
