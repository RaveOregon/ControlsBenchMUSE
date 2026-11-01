import type { CampaignLedger } from "./ledger.ts";
import type { DecisionLease, Provenance, ToolCall } from "./contracts.ts";
import type { CoordinatorCampaignDriver, SimulationExit, ToolFailure } from "./driver.ts";

// Structural, transport-free boundary. Claude owns its isolated child implementation.
export interface DecisionLeaseReceipt {
  id: string; basedOnRevision: number; valid: boolean; reason: string; evidenceRefs: string[];
}
export interface DecisionLeaseControl {
  begin(policy: DecisionLease, basedOnRevision: number, signal: AbortSignal): Promise<DecisionLeaseReceipt>;
  finish(receipt: DecisionLeaseReceipt, signal: AbortSignal): Promise<DecisionLeaseReceipt>;
}
export type CampaignDriver = Pick<CoordinatorCampaignDriver,
  "binding" | "initialize" | "start" | "hold" | "reset" | "exit" | "subscribe" |
  "lastSnapshot" | "lastImage" | "lastEvidenceRefs" | "evidenceAgeMs" | "operationTimeoutMs" | "quarantined" | "failure"> & {
    onFault?: (error: ToolFailure) => void;
    observedOutputIds?: readonly string[];
    decisionLeases?: DecisionLeaseControl;
    apply(call: ToolCall, signal: AbortSignal, basedOnRevision?: number): Promise<string[]>;
  };
export interface IsolatedWonderSession {
  contract: "controlsbench.wonder-process.v1";
  // Recorded handoff must be independently verified by the runtime owner before launch.
  handoff: { commit: string; isolationVerified: true; recoveryVerified: true; evidenceRef: string };
  ledger: CampaignLedger;
  provenance: Provenance;
  ownershipPath: string;
  driver: CampaignDriver;
  controller: { execute(call: ToolCall, signal: AbortSignal, basedOnRevision?: number): Promise<{ message: string; evidenceRefs: string[]; value?: unknown }> };
  simulationExit: SimulationExit;
  dispose(): Promise<void>;
}
