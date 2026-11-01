import type { RawValue } from "../proof/contracts.ts";

export type RawSignalImage = Record<string, RawValue>;

export interface ConnectorObservation {
  observedAtIso: string;
  observedAtMonotonicMs: number;
  bootIdentity: string;
  appliedEpoch: string;
  appliedSequence: string;
  plcCycle: string;
  plcTimeUs: string;
  outputCaptureCycle: string;
  outputCaptureTimeUs: string;
  connectorStale: boolean;
  simulationApplied: boolean;
  values: Record<string, RawValue>;
}

export interface CommitReceipt extends ConnectorObservation {
  workstationEpoch: string;
  workstationSequence: string;
  slot: number;
  sentAtIso: string;
  sentAtMonotonicMs: number;
  acknowledgedAtIso: string;
  acknowledgedAtMonotonicMs: number;
  latencyMs: number;
  image: RawSignalImage;
}

export interface BenchConnector {
  readonly id: string;
  open(): Promise<ConnectorObservation>;
  resetSession(): Promise<ConnectorObservation>;
  commit(image: Readonly<RawSignalImage>): Promise<CommitReceipt>;
  observe(): Promise<ConnectorObservation>;
  // Optional lightweight fresh link/session check. No PLC-output claims are derived from it.
  inspectLink?(): Promise<ConnectorObservation>;
  close(): Promise<void>;
}
