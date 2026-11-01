import type { CoordinatorEvent } from "../live/coordinator.ts";
import { CampaignLedger } from "./ledger.ts";
import { eventSchemas, obj, raw, str, validate } from "./contracts.ts";

const flatCommit = obj({ action: { const: "commit.acknowledged" }, cause: str, workstationEpoch: str, workstationSequence: str,
  slot: { type: "integer", minimum: 0, maximum: 1 }, latencyMs: { type: "number", minimum: 0 }, bootIdentity: str,
  plcCycle: str, outputCaptureCycle: str, image: { type: "object", additionalProperties: raw }, outputs: { type: "object", additionalProperties: raw },
  outputQuality: { type: "object", additionalProperties: { enum: ["good", "bad", "unknown"] } } }, ["outputQuality"]);
function validateSource(source: CoordinatorEvent): void {
  validate(eventSchemas["coordinator.event"].properties!.source, source);
  if (source.data.action === "commit.acknowledged") {
    validate(flatCommit, source.data);
    if (source.lane !== "connector" || source.data.plcCycle !== source.data.outputCaptureCycle) throw new Error("Invalid commit/capture correlation");
  }
}

// Keep the exact source event. In particular, commit.acknowledged has NO receipt property.
export function appendCoordinatorEvent(ledger: CampaignLedger, source: CoordinatorEvent, origin = "live-coordinator"): string[] {
  validateSource(source);
  const sourceEvent = ledger.append("coordinator.event", { origin, source }, "truth");
  if (source.lane !== "connector" || source.data.action !== "commit.acknowledged") return [sourceEvent.id];
  const d = source.data;
  const sourceId = sourceEvent.id;
  const image = ledger.append("world.raw_image", { sourceId, image: d.image, epoch: d.workstationEpoch, sequence: d.workstationSequence });
  const ack = ledger.append("plc.acknowledged", { sourceId, epoch: d.workstationEpoch, sequence: d.workstationSequence,
    bootIdentity: d.bootIdentity, plcCycle: d.plcCycle, outputCaptureCycle: d.outputCaptureCycle, latencyMs: d.latencyMs });
  const output = ledger.append("plc.output", { sourceId, values: d.outputs, plcCycle: d.plcCycle, outputCaptureCycle: d.outputCaptureCycle });
  return [sourceEvent.id, image.id, ack.id, output.id];
}

export function importPreservedM7(ledger: CampaignLedger, trace: unknown): void {
  const t = trace as { traceVersion?: string; evidenceClass?: string; coordinatorEvents?: CoordinatorEvent[] };
  if (t.traceVersion !== "controlsbench-live-m7-v1" || t.evidenceClass !== "live_plc_closed_loop" || !Array.isArray(t.coordinatorEvents)) throw new Error("Not preserved M7 evidence");
  // Validate the entire source before appending anything.
  let sequence = 0;
  for (const e of t.coordinatorEvents) {
    validateSource(e);
    if (e.sequence !== ++sequence) throw new Error("M7 source sequence gap");
    if (e.data.action === "commit.acknowledged" && (!e.data.image || !e.data.outputs || e.data.plcCycle !== e.data.outputCaptureCycle)) throw new Error("Invalid flattened M7 acknowledgement");
  }
  for (const event of t.coordinatorEvents) appendCoordinatorEvent(ledger, event, "preserved-m7");
}
