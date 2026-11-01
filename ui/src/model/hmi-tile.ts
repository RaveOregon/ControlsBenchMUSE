// What the PLC HMI tile may claim. Pixels only come from an actual captured frame (host
// WebVisu session or an externally supplied capture). Without one, the tile says exactly
// "HMI not observed/tested". Nothing here derives an HMI from PLC values.

import type { HmiSessionView } from "../../../src/host/protocol.ts";
import type { WorkspaceState } from "./workspace-store.ts";

export const HMI_NOT_OBSERVED = "HMI not observed/tested";

export type HmiOverlay = "stale" | "disconnected" | "error" | "host_lost";

export interface HmiTileModel {
  observed: boolean;
  headline: string;
  detail: string;
  connection: HmiSessionView["state"] | "external";
  recording: boolean;
  frame?: { src: string; capturedAt: string; requestedAt?: string; ageMs?: number; reference?: string; sha256?: string; pageUrl?: string; eventId?: string; sequence?: number };
  overlay?: { kind: HmiOverlay; text: string };
  identity: Array<[string, string]>;
  lastAction?: { atIso: string; note: string; eventId: string };
}

export function hmiTileModel(state: WorkspaceState, nowEpochMs: number): HmiTileModel {
  const hmi = state.hmi;
  const identity: Array<[string, string]> = [];
  if (hmi.sourceId) identity.push(["Source", hmi.sourceId]);
  if (hmi.url) identity.push(["Configured URL", hmi.url]);
  if (hmi.sessionId) identity.push(["Session", hmi.sessionId]);
  if (hmi.browser) identity.push(["Controlled browser", hmi.browser]);
  if (hmi.startedAtIso) identity.push(["Session started", hmi.startedAtIso]);
  if (hmi.captureIntervalMs) identity.push(["Capture interval", `${hmi.captureIntervalMs} ms (stale after ${hmi.staleAfterMs ?? "?"} ms)`]);
  identity.push(["Frames this session", String(hmi.frameCount)]);

  const actions = state.timeline.filter(e => e.kind === "hmi.observation" && e.observation === "action");
  const action = actions.at(-1);
  const lastAction = action?.kind === "hmi.observation" ? { atIso: action.capturedAt, note: action.note, eventId: action.id } : undefined;

  const last = hmi.lastFrame;
  if (last) {
    const ageMs = Math.max(0, nowEpochMs - Date.parse(last.capturedAtIso));
    const hostLost = state.host !== undefined && state.host.state !== "connected";
    const staleByAge = hmi.state === "observing" && hmi.staleAfterMs !== undefined && ageMs > hmi.staleAfterMs;
    let overlay: HmiTileModel["overlay"];
    if (hostLost) overlay = { kind: "host_lost", text: "HOST LINK LOST — last frame held; age is growing" };
    else if (hmi.state === "disconnected") overlay = { kind: "disconnected", text: "DISCONNECTED — last frame held; no further observation" };
    else if (hmi.state === "error") overlay = { kind: "error", text: "CAPTURE ERROR — last frame held" };
    else if (hmi.state === "stale" || staleByAge) overlay = { kind: "stale", text: `STALE — last frame ${(ageMs / 1000).toFixed(1)} s old` };
    return {
      observed: true,
      // Pixels of whatever page was configured; the URL, not this label, identifies it as WebVisu.
      headline: overlay ? "Captured pixels of the configured HMI page · last observed frame" : "Captured pixels of the configured HMI page · observing",
      detail: hmi.detail,
      connection: staleByAge ? "stale" : hmi.state,
      recording: hmi.recording && !overlay,
      frame: { src: last.mediaUrl, capturedAt: last.capturedAtIso, requestedAt: last.requestedAtIso, ageMs, reference: last.reference, sha256: last.sha256, pageUrl: last.pageUrl, eventId: last.reference, sequence: last.frameSequence },
      overlay, identity, lastAction
    };
  }

  // Externally supplied capture (V1 window bridge). It carries its own source timestamp only.
  const media = [...state.keyEvents].reverse().find(e => e.kind === "hmi.observation" && e.observation !== "action" && e.mediaUrl);
  if (media?.kind === "hmi.observation" && media.mediaUrl) {
    return { observed: true, headline: `Captured HMI ${media.observation} · externally supplied`, detail: media.note, connection: "external", recording: false,
      frame: { src: media.mediaUrl, capturedAt: media.capturedAt, ageMs: Math.max(0, nowEpochMs - Date.parse(media.capturedAt)), reference: media.reference, sha256: media.sha256, eventId: media.id },
      identity: [["Source", media.sourceId], ...identity.filter(([k]) => k !== "Frames this session")], lastAction };
  }

  const why = state.mode === "replay" ? "This record contains no HMI capture." : hmi.state === "connecting" ? "Opening the controlled WebVisu session; no frame captured yet."
    : hmi.state === "error" ? hmi.detail : hmi.state === "not_configured" ? "Configure the WebVisu URL to observe the actual HMI." : hmi.detail;
  return { observed: false, headline: HMI_NOT_OBSERVED, detail: why, connection: hmi.state, recording: false, identity: hmi.sourceId ? identity : [], lastAction };
}
