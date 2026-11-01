// Wire protocol between the parent-side isolated driver (channel.ts/driver.ts) and the child
// (scripts/wonder-process-child.js + engine.ts) that alone owns world time, the 10 Hz connector
// cadence, interventions, reasoning leases and the PLC write session.
//
// parent -> child  { type: "request", id, op, args, knownCampaignRevision }   one reply per request
//                  { type: "ping", knownCampaignRevision }                      liveness only
// child -> parent  { type: "ready", identity }                                 once, before any request
//                  { type: "stream", nonce, seq, record }                       ordered, contiguous from 1
//                  { type: "reply", id, ok, value | outcome+message, boundaryRevision, throughSeq }
//
// `throughSeq` is the last stream seq the child sent before the reply. Every reply is therefore
// ordered after the records it depends on; a reply that overtakes the stream is an integrity fault.
import type { CoordinatorEvent } from "../coordinator.ts";
import type { RawSignalImage } from "../connector.ts";
import type { WorldControl, WorldSnapshot } from "../../proof/contracts.ts";
import type { DecisionLease } from "../../campaign/contracts.ts";

export const CONTRACT = "controlsbench.wonder-process.v1" as const;
export const WIRE = "controlsbench.wonder-process.wire.v1" as const;

/** Accepted M8 timing bounds. The adapter never relaxes these to make a run pass. */
export const CADENCE_MS = 100;
export const MAXIMUM_STEP_MS = 300;

export type FailureOutcome = "rejected" | "timed_out" | "stale" | "inconclusive";
export type LeaseState = "active" | "released" | "expired" | "condition_met" | "interrupted" | "refused";
export type HoldCause = "campaign.hold" | `lease.hold:${string}` | "parent.silent" | "parent.lost";

export interface ChildIdentity {
  wire: typeof WIRE; pid: number; nonce: string; node: string;
  /** performance.timeOrigin of the child; source atMonotonicMs values are relative to it. */
  timeOriginEpochMs: number;
}
export interface LoadedWorld {
  worldPath: string; worldSha256: string; worldVersion: string; projectPath: string; projectSha256: string;
  observedOutputIds: string[]; controls: string[]; worldToPlc: { id: string; dataType: string }[];
}
export interface TimingOptions {
  operationTimeoutMs: number; initializeTimeoutMs: number; parentSilenceMs: number; drainMs: number;
}

/** Interventions carry their original identity and both revisions; the child never re-derives them. */
export interface InterventionRequest {
  actionId: string; name: string; campaignRevision: number; boundaryRevision: number;
}
export interface ApplyRequest extends InterventionRequest { control: WorldControl; visibility: "public" | "truth" }
export interface ControllerRequest extends InterventionRequest {
  action: "start" | "stop" | "reset" | "offer" | "completion_ack"; parameters: Record<string, unknown>;
}

export interface LeaseReceiptDetail {
  leaseId: string; state: LeaseState; valid: boolean; reason: string; policy: DecisionLease;
  campaignRevision: number; boundaryRevision: number;
  /** Stream seq of the confirmed commit this receipt rests on; the parent maps it to plc.output. */
  basisSeq?: number;
  beganAtIso?: string; terminalAtIso?: string; elapsedMs?: number;
  worldHeld: boolean; plcScanContinues: true;
}

export type StreamRecord =
  | { kind: "source"; origin: "live-coordinator" | "campaign-driver"; event: CoordinatorEvent }
  | { kind: "world"; event: Record<string, unknown> }
  | { kind: "stimulus"; actionId: string; control: WorldControl; visibility: "public" | "truth"; campaignRevision: number; boundaryRevision: number }
  | { kind: "fresh"; reason: string; ageMs: number }
  | { kind: "tick"; advanced: boolean; held?: HoldCause; boundaryRevision: number; image: RawSignalImage; snapshot?: WorldSnapshot;
      confirmedAtEpochMs: number; worldTimeMs: number; stepMs?: number; tickMs: number; commitSeq: number }
  | { kind: "delayed"; elapsedMs: number }
  | { kind: "lease"; detail: LeaseReceiptDetail }
  | { kind: "hold"; cause: HoldCause; reason: string; boundaryRevision: number }
  | { kind: "fault"; outcome: FailureOutcome; message: string; uncertainWrites: UncertainWrite[]; boundaryRevision: number }
  | { kind: "write"; state: "settled_after_quarantine"; paths: string[]; outcome: "completed" | "failed"; message?: string; heldMs: number }
  | { kind: "controller"; actionId: string; action: string; outcome: "applied" | "failed"; message?: string; observation?: Record<string, unknown>; afterCancellation: boolean };

export interface UncertainWrite { paths: string[]; startedAtIso: string; ageMs: number }

export type ParentMessage =
  | { type: "request"; id: number; op: string; args: Record<string, unknown>; knownCampaignRevision?: number }
  | { type: "ping"; knownCampaignRevision?: number };
export type ChildMessage =
  | { type: "ready"; identity: ChildIdentity }
  | { type: "stream"; nonce: string; seq: number; record: StreamRecord }
  | { type: "reply"; id: number; ok: true; value: unknown; boundaryRevision: number; throughSeq: number }
  | { type: "reply"; id: number; ok: false; outcome: FailureOutcome; message: string; boundaryRevision: number; throughSeq: number };

/** Monotonic high-resolution wall time comparable across processes on one host. */
export const epochNow = (): number => performance.timeOrigin + performance.now();
