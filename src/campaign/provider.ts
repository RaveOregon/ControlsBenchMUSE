import type { CampaignEvent, Decision, ToolResult } from "./contracts.ts";
import type { CampaignProjection } from "./ledger.ts";

export interface AgentContext {
  schemaVersion: "controlsbench.campaign.v1";
  spec: string; signals: unknown; capabilities: unknown;
  state: Pick<CampaignProjection, "status" | "revision" | "plan" | "experiments" | "activeExperiment">;
  evidence: CampaignEvent[]; results: ToolResult[];
  diagnosisMode: "known" | "blind";
  boundary?: { evidenceClass: string; claimBoundary: string; categories: string[]; recorded: boolean };
  evidenceWindow?: { throughSequence: number; selectedIds: string[]; retrieval: string; quality: Record<string, unknown> };
  budget?: { campaignUsd: number; sessionUsd: number; perRequestUsd: number; campaignHardUsd: number };
}
export interface ProviderAudit {
  requestId: string;
  preserve(record: Record<string, unknown>): void;
}
export interface ProviderReply {
  decision: unknown; responseId?: string; usage?: Record<string, unknown>; costUsd?: number;
  rawResponse?: Record<string, unknown>; error?: string;
  /** Only an explicitly eligible HTTP error with no response identity/decision.
   * The runtime owns retry accounting, fresh leases and cancellation. */
  retryableServiceError?: { httpStatus: 503; retryAfterMs: number };
  /** Pure model transport only: no parsed decision has reached the executor.
   * Generation may have been billed; a new charged attempt uses the last known head. */
  retryableDecisionTransportError?: { phase: "input_tokens" | "responses"; decisionReturned: false; billing: "possibly_charged"; retryAfterMs: number };
}
export interface CampaignProvider {
  readonly id: string;
  readonly estimatedRequestUsd: number;
  readonly paid: boolean;
  readonly retryDecisionTransport?: boolean;
  decide(context: AgentContext, signal: AbortSignal, audit?: ProviderAudit): Promise<ProviderReply>;
}

// This fixture is intentionally the provider, not a conveyor investigator in the runtime.
// Tests can replace it with any observation-dependent policy or recorded Muse reply.
export class FakeProvider implements CampaignProvider {
  readonly id = "deterministic-fake-v1"; readonly paid = false; readonly estimatedRequestUsd = 0;
  contexts: AgentContext[] = [];
  readonly policy: (context: AgentContext, turn: number) => Decision | Promise<Decision>;
  constructor(policy: (context: AgentContext, turn: number) => Decision | Promise<Decision>) { this.policy = policy; }
  async decide(context: AgentContext, _signal: AbortSignal): Promise<ProviderReply> {
    this.contexts.push(structuredClone(context));
    return { decision: await this.policy(context, this.contexts.length), costUsd: 0, responseId: `fake-${this.contexts.length}` };
  }
}
