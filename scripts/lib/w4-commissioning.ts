// Shared logic for the W4 zero-model commissioning harness (scripts/run-w4-commissioning.js) and the
// W4 held-state reconciliation (scripts/recover-w4-held.js). Evidence derivation, read-only inspection
// and held-state classification only: nothing here retries, resets, exits simulation or decides to
// write on its own. Reconciliation steps run only after every precondition matched and the caller
// recorded an explicit authorization in the same connection. See docs/w4-commissioning.md.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { M8OpcUaConnector } from "../../src/live/m8-opcua.ts";
import type { M8Sample, M8Transport, TransportEvent } from "../../src/live/m8-opcua.ts";
import type { CommitReceipt, ConnectorObservation, RawSignalImage } from "../../src/live/connector.ts";
import { rawInputs } from "../../src/live/m8-map.ts";
import type { RawValue } from "../../src/proof/contracts.ts";

export const HARNESS_CONTRACT = "controlsbench.w4-commissioning.v1";
export const HELD_STATE_SCHEMA = "controlsbench.w4-held-state.v1";
export const RECOVERY_SCHEMA = "controlsbench.w4-recovery.v1";

export const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export const shaFile = (path: string) => sha256(readFileSync(path));
export const readJsonl = (path: string): Record<string, any>[] => existsSync(path)
  ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The hash-bound parent journal identifies one fork, even after Windows reuses its PID.
 * Only a real terminal exit (not an IPC disconnect/error with no exit code) proves it is gone. */
export function recordedChildExited(record: HeldState, boundary: Record<string, any>[]): boolean {
  const ready = boundary.findIndex(e => e.kind === "child.ready" && e.identity?.pid === record.child.pid && e.identity?.nonce === record.child.nonce);
  if (ready < 0 || !record.child.exit) return false;
  return boundary.slice(ready + 1).some(e => e.kind === "child.exit"
    && (Number.isInteger(e.code) || typeof e.signal === "string" && e.signal.length > 0)
    && e.code === record.child.exit!.code && e.signal === record.child.exit!.signal);
}

/** Shared by the live harness and negative offline cases: missing measurements cannot pass.
 * 10 Hz is the requested ceiling, while 300 ms remains the accepted observation-gap bound. */
export function commissioningQualification(measurements: Record<string, any>): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  const require = (ok: boolean, message: string) => { if (!ok) failures.push(message); };
  const cadence = measurements.cadence, leases = measurements.leases;
  require(Number.isInteger(cadence?.commits) && cadence.commits >= 2, "At least two child commits are required");
  require(Number.isFinite(cadence?.gapMaxMs) && cadence.gapMaxMs <= 300 && cadence.gapsOver300Ms === 0, "Child observation gap exceeds 300 ms or is missing");
  require(Array.isArray(cadence?.faults) && cadence.faults.length === 0, "Child fault evidence is missing or contains faults");
  const stall = leases?.stallCommits;
  require(Number.isFinite(stall?.stallMs) && stall.stallMs >= 1500, "Parent stall must last at least 1500 ms");
  require(Number.isInteger(stall?.childCommitsDuringStall) && stall.childCommitsDuringStall >= 2, "Child continuity during parent stall is unproven");
  require(Number.isFinite(stall?.maxGapMs) && stall.maxGapMs <= 300, "Parent-stall observation gap (including its edges) exceeds 300 ms or is missing");
  const receipts = leases?.receipts;
  const expected = [["hold", "released", true], ["continue", "released", true], ["condition_deadline", "released", true],
    ["condition_deadline", "condition_met", false], ["condition_deadline", "released", true], ["continue", "expired", false]];
  require(Array.isArray(receipts) && same(receipts.map((r: any) => [r.mode, r.state, r.valid]), expected), "Six declared lease outcomes are required");
  const expiry = Array.isArray(receipts) ? receipts.at(-1) : undefined;
  require(expiry?.timeoutMs === 400 && Number.isFinite(expiry.elapsedMs) && expiry.elapsedMs >= 400 && expiry.elapsedMs <= 700
    && expiry.worldHeld === true, "400 ms lease expiry must hold within the additional 300 ms observation bound");
  for (const name of ["conditionHold", "expiryHold"]) {
    const hold = leases?.[name];
    let scansAdvance = false;
    try { scansAdvance = hold?.plcCycleFirst !== undefined && hold?.plcCycleLast !== undefined && BigInt(hold.plcCycleLast) > BigInt(hold.plcCycleFirst); } catch { /* missing/invalid counters fail */ }
    require(Number.isInteger(hold?.samples) && hold.samples >= 2 && hold.distinctImages === 1 && scansAdvance,
      `${name} needs nonempty unchanged-image evidence with advancing PLC scans`);
  }
  return { passed: failures.length === 0, failures };
}

/** The connector's requireStoppedBaseline set: what every W4 run requires before its first write. */
export const stoppedBaseline: Record<string, RawValue> = { "controller.Mode": 0, "controller.FaultCode": 0, "controller.ItemActive": false,
  "controller.CompletionPending": false, Motor_RunCmd: false };
export const baselineMismatches = (values: Record<string, unknown>) =>
  Object.entries(stoppedBaseline).filter(([k, v]) => values[k] !== v).map(([k]) => `${k}=${JSON.stringify(values[k])}`);
export const counterNames = ["CountExitA", "CountExitB", "CountRunout", "CountMisroute"];
/** H2's recorded at-rest input set (scripts/recover-hmi-h2-baseline.js). */
export const AT_REST: Record<string, RawValue> = { D1_HomeFB: true, D1_ExtendedFB: false, D2_HomeFB: true, D2_ExtendedFB: false, Drive_RunningFB: false, Runout_Ready: true,
  PE_Entry: false, PE_D1Approach: false, PE_D2Approach: false, PE_ExitA: false, PE_ExitB: false, PE_Runout: false };

/**
 * Wraps the M8 transport for inspection: every write is refused until the caller records an
 * explicit authorization on this same connection, after all preconditions were checked.
 */
export class ReadOnlyTransport implements M8Transport {
  readonly inner: M8Transport;
  readonly event: TransportEvent;
  authorization?: string;
  refusedWrites = 0;
  writes = 0;
  constructor(inner: M8Transport, event: TransportEvent) { this.inner = inner; this.event = event; }
  authorize(reason: string): void { this.authorization = reason; this.event("writes.authorized", { reason }); }
  open(): Promise<void> { return this.inner.open(); }
  read(paths: string[]): Promise<Record<string, M8Sample>> { return this.inner.read(paths); }
  async write(items: { path: string; value: RawValue }[]): Promise<void> {
    if (!this.authorization) {
      this.refusedWrites++; this.event("write.refused", { paths: items.map(i => i.path) });
      throw new Error("Read-only inspection: no PLC write before an explicit recorded authorization");
    }
    this.writes++; return this.inner.write(items);
  }
  close(): Promise<void> { return this.inner.close(); }
}
export interface Inspection { observation: ConnectorObservation; activeImage: RawSignalImage }
/** A connector over a read-only gate. open()/observe() only read; the gate refuses writes until authorized. */
export function inspectionConnection(transport: M8Transport, journal: TransportEvent) {
  const gate = new ReadOnlyTransport(transport, journal);
  let activeImage: RawSignalImage = {};
  const connector = new M8OpcUaConnector(gate, (kind, data) => { if (kind === "observation") activeImage = structuredClone(data.activeImage as RawSignalImage); journal(kind, data); });
  let opened = false;
  return { gate, connector,
    async inspect(): Promise<Inspection> {
      const observation = opened ? await connector.observe() : await connector.open();
      opened = true; return { observation, activeImage: structuredClone(activeImage) };
    } };
}
export function summarizeInspection(inspection: Inspection) {
  const o = inspection.observation, v = o.values;
  return { bootIdentity: o.bootIdentity, appliedEpoch: o.appliedEpoch, appliedSequence: o.appliedSequence, plcCycle: o.plcCycle, plcTimeUs: o.plcTimeUs,
    simulationApplied: o.simulationApplied, connectorStale: o.connectorStale, mode: v["controller.ModeText"], faultCode: v["controller.FaultCode"],
    itemActive: v["controller.ItemActive"], activeItemId: v["controller.ActiveItemId"], completionPending: v["controller.CompletionPending"],
    completionSequence: v["controller.CompletionSequence"], motorRunCmd: v.Motor_RunCmd,
    counters: Object.fromEntries([...counterNames, "CountFaulted"].map(n => [n, v[`controller.${n}`]])), stoppedBaselineMismatches: baselineMismatches(v) };
}

// ------------------------------------------------------------------------------------------------
// Held-state record: everything a recorded reconciliation needs, derived from the child's own
// journals (what it actually did on the PLC) and cross-checked against the host ledger.

export interface HeldState {
  schema: typeof HELD_STATE_SCHEMA;
  runDirectory: string; campaignId: string; stoppedAtIso: string; reason: string;
  identities: Record<string, unknown>;
  plc: { bootIdentity: string; appliedEpoch: string; appliedSequence: string; plcCycle: string; plcTimeUs: string; simulationApplied: boolean; connectorStale: boolean };
  appliedImage: RawSignalImage; appliedImageSha256: string;
  lastAcknowledgedCommit: { epoch: string; sequence: string; slot: number; acknowledgedAtIso: string; image: RawSignalImage } | null;
  inFlightCommit: { epoch: string; sequence: string; image: RawSignalImage; sentAtIso: string } | null;
  inFlightCommands: { actionId: string; action: string; parameters: unknown }[];
  outstandingWrites: { atClose: unknown[] | "not_recorded"; atQuarantine: unknown[]; settledAfterQuarantine: unknown[]; childClosed: boolean };
  lastObservation: { observedAtIso: string; plcCycle: string; values: Record<string, RawValue>; activeImage: RawSignalImage } | null;
  controller: Record<string, RawValue>;
  world: { cartons: unknown[]; injectedFaults: { actionId: string; controlId: string; parameters: unknown }[]; clearedFaults: { actionId: string; controlId: string }[] };
  ownership: { path: string; acquired: Record<string, unknown> | null; closeResult: string | null; lockPresent: boolean; lockMatchesRun: boolean; lockSha256: string | null };
  child: { pid: number | null; nonce: string | null; exit: { code: number | null; signal: string | null } | null; parentLost: boolean };
  ledger: { lastAcknowledged: { epoch: unknown; sequence: unknown; bootIdentity: unknown } | null; agreesWithChild: boolean };
  postStopInspection: ReturnType<typeof summarizeInspection> & { activeImageMatchesApplied: boolean } | null;
  evidence: Record<string, string>;
}

const controllerKeys = (values: Record<string, RawValue>) => Object.fromEntries(Object.entries(values).filter(([k]) => k.startsWith("controller.") || ["Motor_RunCmd", "D1_ExtendCmd", "D2_ExtendCmd", "StackLight_Red", "StackLight_Green"].includes(k)));

export function deriveHeldState(input: { directory: string; campaignId: string; reason: string; ownershipPath: string; ledgerEvents: Record<string, any>[];
  identities: Record<string, unknown>; childExit: { code: number | null; signal: string | null } | null; postStop?: Inspection | null }): HeldState {
  const journals = join(input.directory, "wonder-process");
  const transport = readJsonl(join(journals, "child-transport.jsonl")), lifecycle = readJsonl(join(journals, "child-lifecycle.jsonl"));
  const stream = readJsonl(join(journals, "child-stream.jsonl"));
  const acks = transport.filter(e => e.kind === "commit.acknowledged").map(e => e.receipt as CommitReceipt);
  const last = acks.at(-1);
  const requested = transport.filter(e => e.kind === "commit.requested");
  const pending = requested.at(-1);
  const inFlight = pending && !acks.some(a => a.workstationEpoch === pending.epoch && a.workstationSequence === pending.sequence) ? pending : undefined;
  const applied = new Set(transport.filter(e => e.kind === "command.applied" || e.kind === "command.rejected").map(e => e.actionId));
  const observation = transport.filter(e => e.kind === "observation").at(-1);
  const acquired = lifecycle.find(e => e.kind === "ownership.acquired")?.lock ?? null;
  const closed = lifecycle.filter(e => e.kind === "closed").at(-1);
  const lockPresent = existsSync(input.ownershipPath);
  let lock: Record<string, unknown> | null = null;
  try { lock = lockPresent ? JSON.parse(readFileSync(input.ownershipPath, "utf8")) : null; } catch { lock = null; }
  const ledgerAck = input.ledgerEvents.filter(e => e.type === "plc.acknowledged").at(-1)?.data ?? null;
  const applications = new Set(input.ledgerEvents.filter(e => e.type === "action.applied").map(e => e.data.actionId));
  const injected = input.ledgerEvents.filter(e => e.type === "action.requested" && e.data.name === "inject_fault" && applications.has(e.data.actionId))
    .map(e => ({ actionId: e.data.actionId, controlId: e.data.arguments.controlId, parameters: e.data.arguments.parameters }));
  const cleared = input.ledgerEvents.filter(e => e.type === "action.requested" && e.data.name === "clear_fault" && applications.has(e.data.actionId))
    .map(e => ({ actionId: e.data.actionId, controlId: e.data.arguments.controlId }));
  const tick = stream.filter(e => e.record?.kind === "tick" && e.record.snapshot).at(-1)?.record;
  const appliedImage = last?.image ?? {};
  const files = ["campaign.jsonl", "wonder-process/child-stream.jsonl", "wonder-process/child-transport.jsonl", "wonder-process/child-lifecycle.jsonl", "wonder-process/parent-boundary.jsonl"];
  return { schema: HELD_STATE_SCHEMA, runDirectory: input.directory, campaignId: input.campaignId, stoppedAtIso: new Date().toISOString(), reason: input.reason,
    identities: input.identities,
    plc: { bootIdentity: last?.bootIdentity ?? "", appliedEpoch: last?.workstationEpoch ?? "", appliedSequence: last?.workstationSequence ?? "", plcCycle: last?.plcCycle ?? "",
      plcTimeUs: last?.plcTimeUs ?? "", simulationApplied: last?.simulationApplied ?? false, connectorStale: last?.connectorStale ?? true },
    appliedImage, appliedImageSha256: sha256(JSON.stringify(rawInputs.map(k => [k, appliedImage[k]]))),
    lastAcknowledgedCommit: last ? { epoch: last.workstationEpoch, sequence: last.workstationSequence, slot: last.slot, acknowledgedAtIso: last.acknowledgedAtIso, image: last.image } : null,
    inFlightCommit: inFlight ? { epoch: inFlight.epoch, sequence: inFlight.sequence, image: inFlight.image, sentAtIso: inFlight.sentAtIso } : null,
    inFlightCommands: transport.filter(e => e.kind === "command.requested" && !applied.has(e.actionId)).map(e => ({ actionId: e.actionId, action: e.action, parameters: e.parameters })),
    outstandingWrites: { atClose: closed ? closed.uncertainWrites ?? [] : "not_recorded",
      atQuarantine: stream.filter(e => e.record?.kind === "fault").flatMap(e => e.record.uncertainWrites ?? []),
      settledAfterQuarantine: stream.filter(e => e.record?.kind === "write").map(e => e.record), childClosed: !!closed },
    lastObservation: observation ? { observedAtIso: observation.observation.observedAtIso, plcCycle: observation.observation.plcCycle, values: observation.observation.values, activeImage: observation.activeImage } : null,
    controller: observation ? controllerKeys(observation.observation.values) : {},
    world: { cartons: (tick?.snapshot?.state?.cartons ?? []) as unknown[], injectedFaults: injected, clearedFaults: cleared },
    ownership: { path: input.ownershipPath, acquired, closeResult: closed?.ownership ?? null, lockPresent,
      lockMatchesRun: !!lock && !!acquired && lock.nonce === acquired.nonce, lockSha256: lockPresent ? shaFile(input.ownershipPath) : null },
    child: { pid: (acquired?.childPid as number | undefined) ?? null, nonce: (acquired?.nonce as string | undefined) ?? null, exit: input.childExit, parentLost: lifecycle.some(e => e.kind === "parent.lost") },
    ledger: { lastAcknowledged: ledgerAck ? { epoch: ledgerAck.epoch, sequence: ledgerAck.sequence, bootIdentity: ledgerAck.bootIdentity } : null,
      agreesWithChild: !!ledgerAck && !!last && ledgerAck.epoch === last.workstationEpoch && ledgerAck.sequence === last.workstationSequence },
    postStopInspection: input.postStop ? { ...summarizeInspection(input.postStop), activeImageMatchesApplied: same(input.postStop.activeImage, appliedImage) } : null,
    evidence: Object.fromEntries(files.filter(f => existsSync(join(input.directory, f))).map(f => [f, shaFile(join(input.directory, f))])) };
}

// ------------------------------------------------------------------------------------------------
// Classification. Each supported path is a held-state evolution that was recorded on this M8 build
// (H2 recoveries 2026-11-01, artifacts/hmi/h2/recovery-*) and the exact write sequence that then
// reconciled it live. Anything else is refused with no write; the engineer decides separately.

export type Step = { op: "stop" } | { op: "fresh_world" } | { op: "completion_ack"; sequence: number } | { op: "reset" } | { op: "await_stopped" };
export interface Classification {
  path: string | null; supported: boolean; refusals: string[]; checks: { check: string; ok: boolean; detail?: unknown }[];
  plan: Step[]; matchedCommit: "last_acknowledged" | "in_flight" | null; landedCommands: string[]; differences: Record<string, [unknown, unknown]>; evidenceBasis?: string;
}
/** Settle-only diagnostic: the PLC's encoder delta reads zero once the encoder count is held. */
const settling = (key: string, current: unknown) => key === "controller.EncoderDelta" && current === 0;
const ackFor: Record<string, string> = { start: "controller.StartAck", stop: "controller.StopAck", reset: "controller.ResetAck", offer: "controller.OfferAckSequence" };
const commitPath = /^GVL_BenchWrite\.(Slot[01]_|Requested(Slot|Epoch|Sequence)$|WorkstationHeartbeat$)/;
// H2 recovery-2026-11-01T14-54-13-612Z: recorded fields changed by the declared 30 s transit timeout.
const transitTimeoutKeys = new Set(["Motor_RunCmd", "D1_ExtendCmd", "D2_ExtendCmd", "StackLight_Red", "StackLight_Green", "controller.Mode", "controller.ModeText",
  "controller.FaultCode", "controller.FaultText", "controller.ItemActive", "controller.Disposition", "controller.CompletionSequence", "controller.CompletionPending",
  "controller.CompletionItemId", "controller.CompletionRoute", "controller.CompletionExit", "controller.CompletionDisposition", "controller.CountFaulted"]);

export function classifyHeldState(record: HeldState, current: Inspection): Classification {
  const checks: Classification["checks"] = [], refusals: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ check: name, ok, ...(detail !== undefined ? { detail } : {}) }); if (!ok) refusals.push(name); return ok; };
  const o = current.observation, C = o.values, R = record.lastObservation?.values ?? {};
  const result: Classification = { path: null, supported: false, refusals, checks, plan: [], matchedCommit: null, landedCommands: [], differences: {} };
  check("record has a last acknowledged commit and observation", !!record.lastAcknowledgedCommit && !!record.lastObservation);
  if (!record.lastAcknowledgedCommit || !record.lastObservation) return result;
  check("PLC boot identity unchanged since the run", o.bootIdentity === record.plc.bootIdentity, { recorded: record.plc.bootIdentity, current: o.bootIdentity });
  check("simulation still applied", o.simulationApplied === true);
  // The applied commit must be exactly the run's last acknowledged commit, or its recorded in-flight commit (late settlement).
  const candidates = [["last_acknowledged", record.lastAcknowledgedCommit], ...(record.inFlightCommit ? [["in_flight", record.inFlightCommit]] as const : [])] as const;
  const match = candidates.find(([, c]) => c.epoch === o.appliedEpoch && c.sequence === o.appliedSequence);
  result.matchedCommit = match ? match[0] : null;
  check("applied epoch/sequence is the run's own last or in-flight commit", !!match, { current: { epoch: o.appliedEpoch, sequence: o.appliedSequence },
    recorded: candidates.map(([k, c]) => ({ kind: k, epoch: c.epoch, sequence: c.sequence })) });
  check("active raw image equals that commit's image exactly", !!match && same(rawInputs.map(k => current.activeImage[k]), rawInputs.map(k => match[1].image[k])));
  for (const n of counterNames) check(`${n} unchanged`, C[`controller.${n}`] === R[`controller.${n}`], { recorded: R[`controller.${n}`], current: C[`controller.${n}`] });
  // Uncertain writes are resolved by observation only (the child has exited, so nothing can land later).
  const unsettled = record.outstandingWrites.atClose === "not_recorded" ? [] : record.outstandingWrites.atClose as { paths: string[] }[];
  for (const w of unsettled) for (const path of w.paths) {
    const resolvable = commitPath.test(path) || /^GVL_BenchWrite\.(SimRequest|SessionResetRequest)$/.test(path) || /^GVL_DemoWrite\.(Start|Stop|Reset|Offer)(Sequence|ItemId|Route)$|^GVL_DemoWrite\.(AutoRequest|CompletionAck)$/.test(path);
    check(`uncertain write ${path} is resolvable by observation`, resolvable);
  }
  const differences: Record<string, [unknown, unknown]> = {};
  for (const k of new Set([...Object.keys(R), ...Object.keys(C)])) if (!same(R[k], C[k]) && !settling(k, C[k])) differences[k] = [R[k], C[k]];
  result.differences = differences;
  // A sequenced command that was in flight (or uncertain) and has since been acknowledged.
  const commandAcks = Object.entries(ackFor).filter(([, ack]) => Object.hasOwn(differences, ack));
  result.landedCommands = commandAcks.map(([action]) => action);
  const inFlight = new Set(record.inFlightCommands.map(c => c.action));
  for (const [action, ack] of commandAcks) check(`${action} acknowledgement changed only for a recorded in-flight ${action}`, inFlight.has(action) && C[ack] === Number(R[ack]) + 1, { recorded: R[ack], current: C[ack] });
  if (Object.hasOwn(differences, "controller.CompletionPending") && C["controller.CompletionPending"] === false) check("completion acknowledgement landed only for a recorded in-flight acknowledgement", inFlight.has("completion_ack"));
  // A late in-flight commit is accepted only when the controller shows no reaction the run never observed.
  if (match?.[0] === "in_flight") check("no controller change after the run's late in-flight commit (its response to that image was never observed by the run)", !Object.keys(differences).length, differences);
  if (refusals.length) return result;

  const only = (allowed: Set<string>) => Object.keys(differences).filter(k => !allowed.has(k));
  const clean = (v: Record<string, unknown>) => baselineMismatches(v).length === 0;
  const image = match![1].image;
  const imageAt = (want: Record<string, RawValue>) => Object.entries(want).filter(([k, v]) => image[k] !== v).map(([k]) => k);
  const R_ = (k: string) => R[`controller.${k}`], C_ = (k: string) => C[`controller.${k}`];
  const choose = (path: string, plan: Step[], basis: string, extra: [string, boolean, unknown?][] = []) => {
    result.path = path; result.evidenceBasis = basis;
    for (const [name, ok, detail] of extra) check(name, ok, detail);
    if (!refusals.length) { result.supported = true; result.plan = plan; }
    return result;
  };
  if (clean(R) && clean(C) && !Object.keys(differences).length)
    return choose("stopped-clean", [], "No controller change since the run's last observation; the next W4 initialize performs its own session reset");
  if (R_("Mode") === 1 && R.Motor_RunCmd === true && R_("FaultCode") === 0 && R_("ItemActive") === false && R_("CompletionPending") === false && !Object.keys(differences).length)
    return choose("held-running", [{ op: "stop" }, { op: "fresh_world" }, { op: "await_stopped" }], "H2 recovery-2026-11-01T15-12-24-875Z (held-running) passed live with this sequence",
      [["held image is the running at-rest image (no carton, no overload)", !imageAt({ ...AT_REST, Drive_RunningFB: true, Drive_Overload: false }).length, imageAt({ ...AT_REST, Drive_RunningFB: true, Drive_Overload: false })]]);
  if (R_("Mode") === 1 && R_("ItemActive") === true && R_("FaultCode") === 0 && R_("CompletionPending") === false) {
    if (!Object.keys(differences).length) {
      result.path = "transit-pending";
      check("tracked carton reached the declared 30 s transit timeout (fault 33)", false, { activeItemId: C_("ActiveItemId"),
        note: "Held Auto with a tracked carton: re-inspect after at least 30 s of held Auto; no write now" });
      return result;
    }
    return choose("transit-timeout", [{ op: "stop" }, { op: "fresh_world" }, { op: "completion_ack", sequence: Number(C_("CompletionSequence")) }, { op: "reset" }],
      "H2 recovery-2026-11-01T14-54-13-612Z (transit-timeout) passed live with this sequence", [
        ["only the recorded transit-timeout fields changed", !only(transitTimeoutKeys).length, only(transitTimeoutKeys)],
        ["fault 33, Faulted, motor and diverts off", C_("FaultCode") === 33 && C_("Mode") === 3 && C.Motor_RunCmd === false && C.D1_ExtendCmd === false && C.D2_ExtendCmd === false],
        ["the run's tracked carton was aborted once with disposition 4 and no exit", C_("ItemActive") === false && C_("CompletionPending") === true
          && C_("CompletionSequence") === Number(R_("CompletionSequence")) + 1 && C_("CompletionItemId") === R_("ActiveItemId") && C_("CompletionDisposition") === 4 && C_("CompletionExit") === 0,
          { recordedItem: R_("ActiveItemId"), completion: { sequence: C_("CompletionSequence"), item: C_("CompletionItemId"), disposition: C_("CompletionDisposition"), exit: C_("CompletionExit") } }],
        ["CountFaulted increased by exactly one", C_("CountFaulted") === Number(R_("CountFaulted")) + 1]]);
  }
  const overloadInjected = record.world.injectedFaults.some(f => f.controlId === "fault.setOverload") && !record.world.clearedFaults.some(f => ["fault.setOverload", "fault.clearAll"].includes(f.controlId));
  if (R_("Mode") === 3 && R_("FaultCode") === 10 && R_("ItemActive") === false && R_("CompletionPending") === false) {
    const resetLanded = result.landedCommands.includes("reset");
    const allowed = new Set(resetLanded ? ["controller.ResetAck", "controller.ResetAccepted"] : []);
    return choose("held-overload", [{ op: "stop" }, { op: "fresh_world" }, { op: "reset" }], "H2 recovery-2026-11-01T15-05-01-135Z (injected-overload) passed live with this sequence", [
      ["the run injected the drive overload and never cleared it", overloadInjected, record.world],
      ["held image carries that overload at rest", !imageAt({ ...AT_REST, Drive_Overload: true }).length, imageAt({ ...AT_REST, Drive_Overload: true })],
      ["only a recorded in-flight Reset was acknowledged (and rejected) since", !only(allowed).length && (!resetLanded || C_("ResetAccepted") === false), only(allowed)]]);
  }
  if (clean(R) && result.landedCommands.length === 1 && result.landedCommands[0] === "start") {
    const allowed = new Set(["controller.StartAck", "controller.StartAccepted", "StackLight_Red", "controller.Mode", "controller.ModeText", "controller.FaultCode", "controller.FaultText"]);
    return choose("start-feedback-timeout", [{ op: "stop" }, { op: "reset" }], "H2 recovery-2026-11-01T14-58-55-527Z (start-feedback-timeout) passed live with this sequence; image unchanged", [
      ["held image is at rest (no running feedback)", !imageAt({ ...AT_REST, Drive_Overload: false }).length, imageAt({ ...AT_REST, Drive_Overload: false })],
      ["fault 11 (motor running feedback missing on start), Faulted", C_("FaultCode") === 11 && C_("Mode") === 3],
      ["only the recorded start-feedback-timeout fields changed", !only(allowed).length, only(allowed)]]);
  }
  check("held state matches a recorded W4 reconciliation path", false, { recorded: controllerKeys(R as Record<string, RawValue>), differences,
    note: "Outside this procedure: preserve the evidence and decide separately with the bench owner" });
  return result;
}

/** Final state every reconciliation path must reach (the connector's stopped baseline). */
export const reconciledMismatches = (values: Record<string, unknown>) => baselineMismatches(values);
