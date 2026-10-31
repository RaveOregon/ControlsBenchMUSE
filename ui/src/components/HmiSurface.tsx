import { useState } from 'react';
import type { HmiSource } from '../adapters/live/hmi-source.ts';
import { validatedMediaUrl } from '../adapters/live/hmi-source.ts';
import type { WorkspaceState } from '../model/workspace-store.ts';
import type { Selection } from './selection.ts';

export function HmiConfiguration({ source, onConfigure }: { source: HmiSource | null; onConfigure: (s: HmiSource | null) => void }) {
  const [kind, setKind] = useState<'webvisu' | 'capture'>('webvisu');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  return <section className="panel"><header><h2>PLC HMI source</h2><span className="tag">optional observation</span></header><form className="body" onSubmit={e => { e.preventDefault(); try { const url = kind === 'webvisu' ? validatedMediaUrl(value) : undefined; if (!value.trim()) throw new Error('Enter a URL or capture source ID.'); onConfigure({ id: value.trim(), kind, url, label: kind === 'webvisu' ? 'Configured WebVisu' : value.trim() }); setNote('Source configured. Observation is unconfirmed until timestamped evidence arrives.'); } catch (err) { setNote(String(err)); } }}>
    <label className="field">Source type<select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="webvisu">WebVisu URL</option><option value="capture">External browser / screen capture</option></select></label>
    <label className="field">{kind === 'webvisu' ? 'WebVisu URL' : 'Capture source ID'}<input value={value} onChange={e => setValue(e.target.value)} placeholder={kind === 'webvisu' ? 'https://controller/webvisu.htm' : 'workstation-hmi'} /></label>
    <div className="actions"><button className="btn" type="submit">Configure source</button>{source && <button className="btn" type="button" onClick={() => onConfigure(null)}>Disconnect HMI source</button>}</div>
    <p className="muted">{note || 'WebVisu embeds the actual configured page. External capture can supply timestamped actions, frames and clips. A configured URL alone does not establish HMI test coverage.'}</p>
  </form></section>;
}

export function HmiSurface({ state, source, onSelect }: { state: WorkspaceState; source: HmiSource | null; onSelect: (s: Selection) => void }) {
  const observations = state.keyEvents.filter(e => e.kind === 'hmi.observation');
  const last = observations.at(-1);
  const media = [...observations].reverse().find(e => e.kind === 'hmi.observation' && e.observation !== 'action');
  return <section className="panel hmi"><header><h2>PLC HMI / WebVisu</h2><span className={`tag ${state.mode}`}>{state.mode === 'replay' ? 'recorded evidence' : 'live source'}</span></header>
    <div className="hmi-status"><b>{last ? 'Timestamped HMI evidence' : 'HMI not observed/tested'}</b><p className="muted">{state.mode === 'replay' ? 'The preserved campaigns include no HMI recording. Replay controls only play recorded evidence.' : source ? `${source.label} · source configured; observation and requirement verdicts are separate.` : 'Configure a WebVisu URL or external capture in Setup.'}</p></div>
    {state.mode === 'live' && source?.kind === 'webvisu' && <><iframe title="Actual PLC WebVisu" src={source.url} referrerPolicy="no-referrer" /><p className="body muted">Embedded HMI actions need external timestamped capture. If embedding is blocked, <a href={source.url} target="_blank" rel="noreferrer">open configured WebVisu</a>.</p></>}
    {media?.kind === 'hmi.observation' && (media.observation === 'clip' ? <video controls src={media.mediaUrl} aria-label="Captured PLC HMI clip" /> : <img src={media.mediaUrl} alt={`Captured PLC HMI at ${media.capturedAt}`} />)}
    {last?.kind === 'hmi.observation' && <div className="body"><time>{last.capturedAt}</time><p>{last.note}</p><button className="btn small" onClick={() => onSelect({ type: 'event', id: last.id })}>Inspect HMI evidence</button></div>}
  </section>;
}
