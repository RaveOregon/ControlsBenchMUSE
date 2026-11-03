import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { decisionSchema, toolSchemas } from "./contracts.ts";
import type { AgentContext, CampaignProvider, ProviderAudit, ProviderReply } from "./provider.ts";
import { digest } from "./ledger.ts";
import { assertLogicalContext } from "./model-context.ts";

export const wonderPricing = Object.freeze({ checkedOn: "2026-11-01", source: "https://dev.meta.ai/docs/pricing-rate-limits",
  inputUsdPerMillion: 4, outputUsdPerMillion: 20 });
const instructions = `You are ControlsBench's campaign engineer, Muse Wonder 1.0. Form your own plan from the accepted spec and logical capabilities. Submit one bounded campaign_decision each turn. Its calls are semantic tools executed by CampaignRuntime; their actual terminal outcomes return on the next turn. Choose follow-up investigations from actual evidence rather than repeating a prewritten sequence. Use unique action/experiment/finding IDs. A new follow-up must cite exact observed evidence and fit authorized categories. Complete the current experiment before running the next. Record grounded findings and finish only after all experiments have evidence. A finding's claims must exactly match cited plc.output signal/value pairs. Inference, machine expectations, intervention truth, requested raw stimulus, acknowledged input image, PLC outputs, HMI pixels and verdict are distinct. No inferred requirement coverage or HMI pass. Recorded evidence is historical, never a new action. Read-only tools cannot test future behavior. Inspect exact older windows by ID/sequence when needed; do not invent IDs. Keep assumptions and uncertainty explicit. Never edit PLC code, endpoints, credentials, world source or physics. No scan-by-scan I/O. HMI/branch/rewrite are unsupported unless explicitly declared. Blind diagnosis must use only supplied filtered observations. Default reasoning policy holds; only select bounded continue/condition_deadline when the adapter declares leases. PLC time always advances. No retries after uncertain effects.`;

export interface ExchangeJournal { append(record: Record<string, unknown>): void }
export function fileExchangeJournal(path: string): ExchangeJournal {
  // Fail on path reuse. Every append is flushed, including requests before network and raw bodies before parsing.
  const initial = openSync(path, "wx"); closeSync(initial);
  return { append(record) {
    const fd = openSync(path, "a");
    try { const bytes = Buffer.from(JSON.stringify(record) + "\n"); let offset = 0;
      while (offset < bytes.length) { const n = writeSync(fd, bytes, offset, bytes.length - offset); if (!n) throw new Error("Exchange journal stalled"); offset += n; }
      fsyncSync(fd);
    } finally { closeSync(fd); }
  } };
}

/** Multi-turn provider; owns only API framing/lineage, never experiment choice or effects. */
export class WonderResponsesProvider implements CampaignProvider {
  readonly id = "muse-wonder-1.0";
  readonly paid = true;
  readonly estimatedRequestUsd: number;
  #key: string; #fetch: typeof fetch; #journal: ExchangeJournal; #calls = 0;
  #previous?: string; #pendingCall?: string; #seenResponses = new Set<string>(); #seenCalls = new Set<string>();
  #busy = false; #blocked = false;
  #transientFailures = 0;
  readonly maxTransientRetries: number;
  readonly maxCalls: number; readonly maxOutputTokens: number;
  constructor(options: { apiKey: string; explicitlyAuthorized: boolean; journal: ExchangeJournal; fetch?: typeof fetch; maxCalls?: number; maxOutputTokens?: number; maxTransientRetries?: number; requestAdmissionUsd?: number }) {
    if (!options.explicitlyAuthorized || !options.apiKey) throw new Error("Wonder requires Start Campaign authorization and a local key");
    this.#key = options.apiKey; this.#fetch = options.fetch ?? fetch; this.#journal = options.journal;
    this.estimatedRequestUsd = options.requestAdmissionUsd ?? 1;
    if (!Number.isInteger(this.estimatedRequestUsd) || this.estimatedRequestUsd < 1 || this.estimatedRequestUsd > 5) throw new Error("Invalid explicit request admission allowance");
    this.maxCalls = options.maxCalls ?? 4; this.maxOutputTokens = options.maxOutputTokens ?? 4000;
    this.maxTransientRetries = options.maxTransientRetries ?? 0;
    if (!Number.isInteger(this.maxTransientRetries) || this.maxTransientRetries < 0 || this.maxTransientRetries > 2) throw new Error("Invalid bounded transient retry limit");
    if (!Number.isInteger(this.maxCalls) || this.maxCalls < 1 || this.maxCalls > 40 || !Number.isInteger(this.maxOutputTokens) || this.maxOutputTokens < 16 || this.maxOutputTokens > 16000)
      throw new Error("Invalid bounded Wonder request limits");
  }
  async decide(context: AgentContext, signal: AbortSignal, audit?: ProviderAudit): Promise<ProviderReply> {
    if (this.#busy || this.#blocked || this.#calls >= this.maxCalls || signal.aborted) throw new Error("Wonder provider blocked/exhausted/cancelled; no automatic retry");
    this.#busy = true; const turn = ++this.#calls;
    const preserve = (record: Record<string, unknown>) => {
      const entry = { turn, requestId: audit?.requestId ?? `direct-${turn}`, atIso: new Date().toISOString(), ...record };
      this.#journal.append(entry); // Independent durable sink also preserves responses arriving after cancellation.
      if (!signal.aborted) audit?.preserve(entry);
    };
    try {
      assertLogicalContext({ signals: context.signals, capabilities: context.capabilities, evidence: context.evidence, results: context.results });
      const input: unknown[] = [];
      const requestContext = { ...context, providerBudget: { decisionNumber: turn, maxDecisions: this.maxCalls,
        remainingDecisionsAfterThis: this.maxCalls - turn } };
      if (this.#pendingCall) input.push({ type: "function_call_output", call_id: this.#pendingCall,
        output: JSON.stringify({ originatingDecision: this.#pendingCall, revision: context.state.revision,
          status: context.state.status, results: context.results }) });
      // Results travel once as paired tool output, not repeated inside the user state item.
      input.push({ role: "user", content: [{ type: "input_text", text: JSON.stringify(this.#pendingCall ? { ...requestContext, results: [] } : requestContext) }] });
      const body = { model: this.id, store: true, reasoning: { effort: "high", summary: "auto" },
        max_output_tokens: this.maxOutputTokens, parallel_tool_calls: false,
        ...(this.#previous ? { previous_response_id: this.#previous } : {}), instructions: instructions + " Contract details: Existing experiment definitions are immutable: omit plan when continuing them; use create_followup_experiment for a new evidence-dependent experiment. completeExperiment is validated before calls execute and its evidenceRefs must contain public observations, never fault.truth records. Put injected fault truth IDs only in finding.injectedTruthRefs. If capabilities.previousDecisionRefusal is present, the preceding decision applied nothing: use its feedback to submit a new corrected decision, preserving already executed earlier actions.",
        tools: [{ type: "function", name: "campaign_decision", description: "Submit a plan, completion and ordered semantic calls to the bounded campaign runtime. Results arrive next turn.", parameters: decisionSchema, strict: false }],
        // Meta's live endpoint rejects named/required choices (preserved W3 HTTP 400).
        // Auto does not relax our one-new-decision-call validation below.
        tool_choice: "auto",
        input: !this.#previous ? [{ role: "developer", content: [{ type: "input_text", text: JSON.stringify({ semanticTools: toolSchemas }) }] }, ...input] : input };
      if (Buffer.byteLength(JSON.stringify(body)) > 160_000) throw new Error("Compact context exceeds request byte limit; retrieve a smaller window");
      const countBody = { model: body.model, input: body.input, instructions: body.instructions, tools: body.tools,
        tool_choice: body.tool_choice, parallel_tool_calls: false, ...(this.#previous ? { previous_response_id: this.#previous } : {}) };
      const count = await this.#exchange("input_tokens", countBody, signal, preserve);
      const tokens = (count.payload as any)?.input_tokens;
      if (!count.ok || !Number.isSafeInteger(tokens) || tokens < 0) throw new Error("Token-count preflight failed; no generation sent");
      // Count includes stored history and hidden scaffolding. Charge all input at uncached Standard rate.
      // No hosted tools/extra model iterations; max_output_tokens includes reasoning.
      const maximumUsd = (tokens * wonderPricing.inputUsdPerMillion + this.maxOutputTokens * wonderPricing.outputUsdPerMillion) / 1_000_000;
      preserve({ phase: "admission", inputTokens: tokens, maxOutputTokens: this.maxOutputTokens, maximumUsd, pricing: wonderPricing });
      if (maximumUsd > this.estimatedRequestUsd) throw new Error(`Request maximum exceeds $${this.estimatedRequestUsd} admission; no generation sent`);
      const response = await this.#exchange("responses", body, signal, preserve);
      if (signal.aborted) throw new Error("Late response retained, no decision applied");
      const payload = response.payload as any;
      const metadata = { ...(typeof payload?.id === "string" ? { responseId: payload.id } : {}),
        ...(payload?.usage && typeof payload.usage === "object" && !Array.isArray(payload.usage) ? { usage: payload.usage } : {}) };
      // Never retry a returned decision, unknown network outcome, malformed error,
      // or partial response identity. Preserve the previous valid conversation head.
      const delay = serviceRetryDelay(response.headers["retry-after"]);
      if (response.httpStatus === 503 && payload?.error?.type === "server_error" && typeof payload.error.message === "string"
        && payload.id === undefined && payload.status === undefined && payload.output === undefined
        && delay !== undefined && this.#transientFailures < this.maxTransientRetries && this.#calls < this.maxCalls) {
        this.#transientFailures++;
        preserve({ phase: "retryable_service_error", httpStatus: 503, retryAfterMs: delay, retryNumber: this.#transientFailures,
          previousResponseId: this.#previous ?? null, pendingCallId: this.#pendingCall ?? null });
        return { decision: null, ...metadata, error: "Meta HTTP 503 server_error; no response identity or decision returned",
          retryableServiceError: { httpStatus: 503, retryAfterMs: delay } };
      }
      if (!response.ok || payload?.status !== "completed" || typeof payload.id !== "string" || this.#seenResponses.has(payload.id)) {
        this.#blocked = true;
        return { decision: null, ...metadata, error: "HTTP, incomplete, missing or repeated response identity; no retry" };
      }
      const calls = Array.isArray(payload.output) ? payload.output.filter((item: any) => item.type === "function_call") : [];
      if (calls.length !== 1 || calls[0].name !== "campaign_decision" || typeof calls[0].call_id !== "string" || !/^[A-Za-z0-9_.:-]{1,64}$/.test(calls[0].call_id)
        || this.#seenCalls.has(calls[0].call_id) || (calls[0].status !== undefined && calls[0].status !== "completed")) {
        this.#blocked = true; return { decision: null, ...metadata, error: "Expected one new campaign_decision function call; text/unsupported calls are not executable" };
      }
      let decision: unknown;
      try { decision = JSON.parse(calls[0].arguments); } catch { this.#blocked = true; return { decision: null, ...metadata, error: "Malformed decision JSON; raw body preserved" }; }
      this.#previous = payload.id; this.#pendingCall = calls[0].call_id;
      this.#seenResponses.add(payload.id); this.#seenCalls.add(calls[0].call_id);
      return { decision, ...metadata }; // Runtime validates arguments, scope, revisions and evidence.
    } catch (error) {
      this.#blocked = true;
      preserve({ phase: "failed", reason: signal.aborted ? "cancelled or timed out; possibly charged" : "transport/preflight/provider failure; no retry" });
      throw error;
    } finally { this.#busy = false; }
  }
  async #exchange(endpoint: "input_tokens" | "responses", body: unknown, signal: AbortSignal, preserve: (r: Record<string, unknown>) => void) {
    const url = endpoint === "input_tokens" ? "https://api.meta.ai/v1/responses/input_tokens" : "https://api.meta.ai/v1/responses";
    const requestText = JSON.stringify(body);
    preserve({ phase: "request", endpoint, requestText, requestHash: digest(body) });
    const response = await this.#fetch(url, { method: "POST", signal, headers: { authorization: `Bearer ${this.#key}`, "content-type": "application/json" }, body: requestText });
    const responseText = await response.text();
    const headers = Object.fromEntries([...response.headers].filter(([name]) => name.startsWith("x-ratelimit-") || ["x-request-id", "retry-after"].includes(name)));
    preserve({ phase: "response", endpoint, httpStatus: response.status, headers, responseText, responseHash: digest(responseText) });
    let payload: unknown;
    try { payload = JSON.parse(responseText); } catch { payload = null; }
    return { ok: response.ok, payload, httpStatus: response.status, headers };
  }
}

/** Honor short Retry-After values; refuse long/invalid waits rather than shorten them. */
function serviceRetryDelay(header: string | undefined): number | undefined {
  if (header === undefined) return 1000;
  const delay = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(delay) && delay >= 0 && delay <= 10_000 ? Math.max(250, Math.ceil(delay)) : undefined;
}
