import type { MuseEvent, SourceMode } from '../../model/events.ts';
import type { WorkspaceStore } from '../../model/workspace-store.ts';

export interface HmiSource { id: string; kind: 'webvisu' | 'capture'; url?: string; label: string }
export interface HmiObservation { sourceId: string; mode: SourceMode; capturedAt: string; observation: 'action' | 'frame' | 'clip'; note: string; mediaUrl?: string; endAt?: string }
export function validatedMediaUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:', 'blob:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) or blob URL without credentials.');
  return url.href;
}
export function ingestHmiObservation(store: WorkspaceStore, source: HmiSource | null, input: HmiObservation, nowMs: number): void {
  if (!source || source.id !== input.sourceId || input.mode !== store.state.mode) throw new Error('HMI source or evidence mode does not match this workspace.');
  if (!Number.isFinite(Date.parse(input.capturedAt))) throw new Error('HMI capture needs a valid source timestamp.');
  if (input.observation !== 'action' && !input.mediaUrl) throw new Error('HMI frames/clips need an actual media URL.');
  if (input.endAt && (!Number.isFinite(Date.parse(input.endAt)) || Date.parse(input.endAt) < Date.parse(input.capturedAt))) throw new Error('Invalid clip end timestamp.');
  const event: MuseEvent = { ...input, mediaUrl: input.mediaUrl ? validatedMediaUrl(input.mediaUrl) : undefined, kind: 'hmi.observation', id: `hmi-${crypto.randomUUID()}`, atMs: nowMs, lane: 'hmi', summary: `HMI ${input.observation}: ${input.note}`, provenance: { mode: input.mode, evidenceClass: 'plc_measurement', source: `hmi:${source.id}`, clock: input.mode === 'live' ? 'live_wall' : 'recorded_wall', recordedAt: input.capturedAt } };
  store.applyEvents([event]);
}
