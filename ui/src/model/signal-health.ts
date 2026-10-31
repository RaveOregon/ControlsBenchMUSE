import type { SignalValue, WorkspaceState } from './workspace-store.ts';
import { plcStaleThresholdMs } from './activity.ts';
export function signalHealth(value: SignalValue | undefined, state: WorkspaceState, nowMs: number): string {
  if (value?.value === undefined) return 'unknown';
  if (value.quality === 'bad') return 'bad';
  if (value.freshness === 'stale') return 'stale';
  if (value.freshness === 'held' || state.connection.link === 'lost' || ['paused','stopped','completed','budget_hold'].includes(state.phase)) return 'held';
  // Change time is not freshness. A stable value can remain Good indefinitely
  // when frames/heartbeats are current. Replay viewing time never ages signals.
  if (state.mode === 'live' && state.episode?.plcExpected && value.observedAtMs !== undefined && nowMs - value.observedAtMs > plcStaleThresholdMs(state.connection.publishingIntervalMs)) return 'stale';
  return value.quality === 'good' ? 'good' : 'unknown quality';
}
