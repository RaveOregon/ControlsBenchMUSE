import { decisionSchema, toolSchemas } from "./contracts.ts";
import type { AgentContext, CampaignProvider, ProviderReply } from "./provider.ts";

export class WonderProvider implements CampaignProvider {
  readonly id = "muse-wonder-1.0"; readonly paid = true; readonly estimatedRequestUsd = 1;
  #apiKey: string; #fetch: typeof fetch; #called = false;
  constructor(options: { apiKey: string; explicitlyAuthorized: boolean; fetch?: typeof fetch }) {
    if (!options.explicitlyAuthorized || !options.apiKey) throw new Error("Wonder checkpoint requires explicit authorization and a local API key");
    this.#apiKey = options.apiKey; this.#fetch = options.fetch ?? fetch;
  }
  async decide(context: AgentContext, signal: AbortSignal): Promise<ProviderReply> {
    if (this.#called) throw new Error("One-call Wonder checkpoint exhausted; no automatic retry");
    this.#called = true;
    const response = await this.#fetch("https://api.meta.ai/v1/responses", {
      method: "POST", signal, headers: { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.id, reasoning: { effort: "high", summary: "auto" }, max_output_tokens: 3000,
        input: [
          { role: "developer", content: "You are ControlsBench's campaign agent. Reason at experiment boundaries. Use only supplied evidence IDs. Never change the PLC, generate scan-by-scan raw values, reveal hidden truth, or claim final conveyor coverage from the measurement DUT. Return one bounded decision as JSON. In a preserved-evidence checkpoint, propose a new evidence-grounded experiment; no live action is available. Inference and uncertainty must remain explicit." },
          { role: "developer", content: JSON.stringify({ tools: toolSchemas }) },
          { role: "user", content: JSON.stringify(context) }
        ], text: { format: { type: "json_schema", name: "campaign_decision_v1", strict: false, schema: decisionSchema } } })
    });
    const responseText = await response.text();
    let rawResponse: Record<string, unknown>;
    try { rawResponse = { httpStatus: response.status, body: JSON.parse(responseText) }; }
    catch { rawResponse = { httpStatus: response.status, bodyText: responseText }; }
    if (!response.ok) return { decision: null, rawResponse, error: `Meta request failed with HTTP ${response.status}; no retry` };
    const payload = rawResponse.body as { output_text?: string; id?: string; usage?: Record<string, unknown>;
      output?: { content?: { type: string; text?: string }[] }[] };
    if (!payload || typeof payload !== "object") return { decision: null, rawResponse, error: "Meta returned non-JSON response" };
    const text = payload.output_text ?? (payload.output ?? []).flatMap(item => item.content ?? [])
      .filter(item => item.type === "output_text" || item.type === "text").map(item => item.text ?? "").join("");
    let decision: unknown;
    try { decision = JSON.parse(text); } catch { decision = text; }
    return { decision, rawResponse, ...(payload.id ? { responseId: payload.id } : {}),
      ...(payload.usage ? { usage: payload.usage } : {}) };
    // Exact dollar billing is unavailable: runtime settles the $1 conservative reservation,
    // including failures/timeouts. Never infer dollars from tokens with an unverified price.
  }
}
