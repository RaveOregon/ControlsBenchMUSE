// Engineer-facing view data. Entity publications are coordinator truth records, separate
// from the public M9 projection and from the diagnosing model's context.
import { buildSnapshot } from "../../../src/machine-view/frame.ts";
import type { LoadedPackage } from "../../../src/machine-view/frame.ts";
import type { EntitySample, Health, LinkState, ScalarValue, ViewEvidenceClass } from "../../../src/machine-view/contracts.ts";
import type { SignalValue, WorkspaceState } from "./workspace-store.ts";

export function workspaceViewSnapshot(pkg: LoadedPackage, state: WorkspaceState, nowMs: number) {
  const projection = state.hosted?.projection;
  const last = state.connection.lastPlcHeartbeatAtMs;
  const ageMs = last === undefined ? null : Math.max(0, nowMs - last);
  let link: LinkState = state.connection.link === "lost" || (state.host && state.host.state !== "connected") || state.hosted?.integrityError ? "disconnected"
    : state.connection.simulationApplied === false ? "passthrough"
    : ["paused", "stopped", "completed", "failed", "budget_hold"].includes(state.phase) ? "held"
    : !last && last !== 0 ? "not_connected" : "fresh";
  if (projection?.connector?.state === "quarantined") link = "quarantined";
  else if (projection?.connector?.state === "stale" || (state.mode === "live" && link === "fresh" && ageMs !== null && ageMs > 2000)) link = "stale";
  const quality: Record<string, Health> = {}, observedAtMs: Record<string, number> = {}, evidenceRefs: Record<string, string> = {};
  const samples = (prefix: string, values: Record<string, SignalValue>) => {
    for (const [id, v] of Object.entries(values)) {
      quality[`${prefix}.${id}`] = v.quality === "bad" ? "bad" : v.freshness === "stale" ? "stale" : v.freshness === "held" ? "held" : v.quality === "unknown" ? "unknown" : "good";
      if (v.observedAtMs !== undefined) observedAtMs[`${prefix}.${id}`] = v.observedAtMs;
      if (v.eventId) evidenceRefs[`${prefix}.${id}`] = v.eventId.split("#")[0]!;
    }
  };
  samples("world", state.inputs); samples("plc", state.outputs);
  const scalar = (v: unknown): v is ScalarValue => v === null || typeof v === "boolean" || typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
  const entities: EntitySample[] | null = state.world.entitiesSupplied ? Object.entries(state.entities).filter(([, e]) => e.type === "carton").map(([id, e]) => ({
    id, type: e.type, state: Object.fromEntries(Object.entries(e.state).filter(([, v]) => scalar(v))) as Record<string, ScalarValue>, evidenceRef: e.eventId ?? null
  })) : null;
  const evidenceClass: ViewEvidenceClass = state.hosted?.evidenceClass ?? (state.episode?.plcIncluded ? "preserved_live_plc" : "surrogate_contract");
  return buildSnapshot(pkg.bindings.channels, { packageId: pkg.manifest.packageId, mode: state.mode, evidenceClass,
    sequence: state.eventCount, campaignSequence: projection?.sequence, sourceTimeMs: state.world.sourceTimeMs ?? state.world.lastHeartbeatAtMs,
    label: state.hosted?.campaignId ?? state.episode?.title ?? "No campaign evidence", link: { state: link, ageMs, reason: String(projection?.connector?.reason ?? state.host?.detail ?? state.connection.linkDetail ?? "Recorded coordinator evidence").slice(0, 200) },
    raw: Object.fromEntries(Object.entries(state.inputs).map(([id, v]) => [id, v.value])), outputs: Object.fromEntries(Object.entries(state.outputs).map(([id, v]) => [id, v.value])),
    entities, quality, observedAtMs, evidenceRefs, nowMs, staleAfterMs: 2000 });
}
