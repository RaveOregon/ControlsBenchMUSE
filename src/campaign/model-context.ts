import type { CampaignEvent, ToolResult } from "./contracts.ts";
import type { CampaignLedger } from "./ledger.ts";

export const blindEvidenceTypes = new Set(["world.raw_image", "plc.acknowledged", "plc.output", "hmi.evidence", "observation", "discrepancy"]);
export function visible(event: Pick<CampaignEvent, "type" | "visibility">, blind: boolean): boolean {
  return event.visibility === "public" && (!blind || blindEvidenceTypes.has(event.type));
}
export function compactEvidence(ledger: CampaignLedger, blind: boolean): CampaignEvent[] {
  const limits: Record<string, number> = { "plc.output": 6, "world.raw_image": 2, "plc.acknowledged": 2,
    "observation": 4, "discrepancy": 4, "hmi.evidence": 2, "action.rejected": 2,
    "action.timed_out": 2, "action.stale": 2, "action.inconclusive": 2, "followup.added": 2 };
  const evidence = ledger.recentEvents(100, e => visible(e, blind));
  const counts: Record<string, number> = {};
  return evidence.reverse().filter(e => (counts[e.type] = (counts[e.type] ?? 0) + 1) <= (limits[e.type] ?? 0)).reverse();
}
export function contextResults(results: ToolResult[], ledger: CampaignLedger, blind: boolean): ToolResult[] {
  return results.map(result => {
    const refs = result.evidenceRefs.filter(id => { const e = ledger.getEvent(id); return !!e && visible(e, blind); });
    // Blind result values can contain source IDs, hidden setup or adapter-specific truth.
    // Deliver exact allowlisted observations by reference, never arbitrary adapter values/messages.
    if (blind) return { actionId: result.actionId, status: result.status, message: `Tool ${result.status}; inspect cited observations`, evidenceRefs: refs,
      value: refs.map(id => ledger.getEvent(id)) };
    if (JSON.stringify(result).length > 48_000) return { actionId: result.actionId, status: result.status,
      message: result.message, evidenceRefs: refs, value: { omitted: "Result exceeds compact context; retrieve an exact evidence window" } };
    return structuredClone(result);
  });
}
export function evidenceQuality(ledger: CampaignLedger, evidence: CampaignEvent[], recorded: boolean, nowMs: number) {
  return Object.fromEntries(evidence.filter(e => e.type === "plc.output").map(e => {
    const source = ledger.getEvent(String(e.data.sourceId));
    const original = source?.data.source as { atIso?: string; data?: Record<string, unknown> } | undefined;
    return [e.id, { recorded, freshness: recorded ? "recorded-not-live" : "age-and-connector-state-required", observedAtIso: original?.atIso ?? e.atIso,
      ageMs: Math.max(0, nowMs - Date.parse(original?.atIso ?? e.atIso)),
      outputQuality: original?.data?.outputQuality ?? "unknown (not in original evidence)",
      plcCycle: e.data.plcCycle, outputCaptureCycle: e.data.outputCaptureCycle }];
  }));
}
export function assertLogicalContext(value: unknown): void {
  const text = JSON.stringify(value);
  if (/(?:opc\.tcp:\/\/|\bns=\d+;[is]=|\bBearer\s|"(?:password|apiKey|authorization|endpoint|nodeId)"\s*:)/i.test(text))
    throw new Error("Model context must contain logical capabilities, not credentials or opaque connection endpoints");
}
