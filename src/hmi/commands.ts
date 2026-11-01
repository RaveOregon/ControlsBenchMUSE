// Operator commands as sequenced M8 requests. One command at a time. A command is applied or
// rejected only from the PLC's own acknowledgement (sequence echo plus accepted flag) or, for the
// retained AutoRequest bit that has no acknowledgement field, from an explicit readback that is
// labelled as such. A refused request never reached the PLC. A timed-out request may still apply.

import type { CommandAction, CommandOrigin, CommandView, OwnershipView, ResultingStateView, Scalar, SnapshotView } from "./protocol.ts";
import { HmiJournal } from "./journal.ts";
import type { PlcLink } from "./link.ts";
import { P, active, resetPreconditions, startPreconditions } from "./signals.ts";

export interface CommandRequest {
  requestId: string;
  action: CommandAction;
  origin: CommandOrigin;
  clientSessionId?: string;
  target?: string;
  uiActionRef?: string;
  agentActionRef?: string;
}

export interface OperatorCommandOptions {
  link: PlcLink;
  journal: HmiJournal;
  ownership: () => OwnershipView;
  /** Reason the controller identity forbids commands, if any. */
  identityProblem: () => string | undefined;
  ackTimeoutMs?: number;
  ackPollMs?: number;
  settleMs?: number;
  stableMs?: number;
  onChange?: (command: CommandView) => void;
}

const ACTIONS: CommandAction[] = ["start", "stop", "reset", "auto_on", "auto_off"];
const SEQ: Record<"start" | "stop" | "reset", { seq: string; ack: string; accepted?: string }> = {
  start: { seq: P.startSeq, ack: P.startAck, accepted: P.startAccepted },
  stop: { seq: P.stopSeq, ack: P.stopAck },
  reset: { seq: P.resetSeq, ack: P.resetAck, accepted: P.resetAccepted }
};
const STATE_PATHS = [P.mode, P.modeText, P.faultCode, P.motorCmd, active("Drive_RunningFB"), P.autoRequest];
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const now = () => new Date().toISOString();

function stateFrom(values: Record<string, Scalar>, observedAtIso: string): ResultingStateView {
  return { observedAtIso, mode: values[P.mode] ?? null, modeText: values[P.modeText] ?? null, faultCode: values[P.faultCode] ?? null,
    motorRunCmd: values[P.motorCmd] ?? null, driveRunningFb: values[active("Drive_RunningFB")] ?? null, autoRequest: values[P.autoRequest] ?? null };
}
const sameState = (a: ResultingStateView, b: ResultingStateView) =>
  a.mode === b.mode && a.faultCode === b.faultCode && a.motorRunCmd === b.motorRunCmd && a.driveRunningFb === b.driveRunningFb;

export class OperatorCommands {
  readonly #o: OperatorCommandOptions;
  readonly #records = new Map<string, CommandView>();
  #inFlight?: string;
  readonly #settling = new Map<string, { untilMs: number; stableSinceMs: number; last?: ResultingStateView }>();

  constructor(options: OperatorCommandOptions) { this.#o = options; }

  list(limit = 30): CommandView[] { return [...this.#records.values()].reverse().slice(0, limit).map(c => structuredClone(c)); }
  get(requestId: string): CommandView | undefined { const c = this.#records.get(requestId); return c && structuredClone(c); }
  get inFlight(): string | undefined { return this.#inFlight; }

  #journal(type: string, command: CommandView, extra: Record<string, unknown> = {}): void {
    const record = this.#o.journal.append(type, { requestId: command.requestId, action: command.action, origin: command.origin, outcome: command.outcome, ...extra });
    command.evidenceRefs.push(HmiJournal.ref(record));
    this.#o.onChange?.(structuredClone(command));
  }

  /** Validates, journals and executes one request. Duplicate request IDs return the recorded outcome. */
  async submit(request: CommandRequest): Promise<CommandView> {
    if (typeof request.requestId !== "string" || !/^[A-Za-z0-9:_.-]{6,100}$/.test(request.requestId)) throw new Error("requestId must be 6-100 characters [A-Za-z0-9:_.-]");
    if (!ACTIONS.includes(request.action)) throw new Error(`Unsupported HMI action ${String(request.action)}`);
    const existing = this.#records.get(request.requestId);
    if (existing) return structuredClone(existing);
    const values = this.#o.link.values();
    const command: CommandView = { requestId: request.requestId, action: request.action, origin: request.origin, clientSessionId: request.clientSessionId,
      target: request.target, uiActionRef: request.uiActionRef, agentActionRef: request.agentActionRef, requestedAtIso: now(), outcome: "pending",
      detail: "Requested; not yet written to the PLC", evidenceRefs: [],
      preconditions: request.action === "start" ? startPreconditions(values) : request.action === "reset" ? resetPreconditions(values) : undefined };
    this.#records.set(command.requestId, command);
    this.#journal("command.requested", command, { clientSessionId: command.clientSessionId, target: command.target, uiActionRef: command.uiActionRef,
      agentActionRef: command.agentActionRef, preconditions: command.preconditions, snapshotSequence: this.#o.link.latest?.sequence });

    const refusal = this.#refusal();
    if (refusal) return this.#finish(command, "refused", `Not sent to the PLC: ${refusal}`);
    this.#supersede(command.requestId);
    this.#inFlight = command.requestId;
    try {
      if (command.action === "auto_on" || command.action === "auto_off") await this.#auto(command, command.action === "auto_on");
      else await this.#sequenced(command, command.action);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const delivered = !!command.deliveredAtIso;
      this.#finish(command, delivered ? "timed_out" : "failed", delivered
        ? `Written, but acknowledgement could not be read: ${message}. The PLC may have applied it; inspect before retrying.`
        : `Write did not complete: ${message}. Whether the PLC received it is unconfirmed; inspect before retrying.`);
    } finally { this.#inFlight = undefined; }
    return structuredClone(command);
  }

  #refusal(): string | undefined {
    const ownership = this.#o.ownership();
    if (!ownership.commandsEnabled) return ownership.reasons.join("; ") || "commands disabled";
    if (this.#inFlight) return `command ${this.#inFlight} is still awaiting its PLC acknowledgement`;
    const link = this.#o.link;
    if (!link.fresh) return `PLC data is not fresh (link ${link.view.state})`;
    if (link.view.plcScanning === false) return "PlcCycle is not advancing; the PLC application may not be scanning";
    return this.#o.identityProblem();
  }

  async #auto(command: CommandView, value: boolean): Promise<void> {
    command.writes = await this.#o.link.write([{ path: P.autoRequest, value }]);
    command.deliveredAtIso = now(); command.outcome = "delivered"; command.detail = `AutoRequest := ${value} written; reading back`;
    this.#journal("command.delivered", command, { writes: command.writes });
    const samples = await this.#o.link.read(STATE_PATHS);
    const values = Object.fromEntries(Object.entries(samples).map(([p, s]) => [p, s.value]));
    command.ackKind = "readback"; command.acknowledgedAtIso = samples[P.autoRequest].receivedAtIso;
    command.atAck = stateFrom(values, command.acknowledgedAtIso);
    if (values[P.autoRequest] !== value) return void this.#finish(command, "failed", `Readback AutoRequest=${String(values[P.autoRequest])} differs from the written ${value}`);
    this.#finish(command, "applied", `AutoRequest readback is ${value}. M8 has no Auto acknowledgement field: this confirms the request variable, not a mode change.${!value && values[P.mode] === 1 ? " Withdrawing Auto stops the conveyor while in Auto." : ""}`);
  }

  async #sequenced(command: CommandView, action: "start" | "stop" | "reset"): Promise<void> {
    const paths = SEQ[action];
    const before = await this.#o.link.read([paths.seq, paths.ack]);
    const current = Number(before[paths.seq].value);
    if (!Number.isInteger(current) || current < 0) throw new Error(`Unreadable ${paths.seq}`);
    const expected = current + 1;
    if (expected > 0xffffffff) return void this.#finish(command, "refused", "Sequence would wrap; a new PLC session is required");
    Object.assign(command, { expectedSequence: expected, ackField: paths.ack, acceptedField: paths.accepted, ackKind: paths.accepted ? "plc_sequence_ack" : "plc_sequence_echo" });
    command.writes = await this.#o.link.write([{ path: paths.seq, value: expected }]);
    command.deliveredAtIso = now(); command.outcome = "delivered"; command.detail = `${paths.seq} := ${expected} written; awaiting ${paths.ack}`;
    this.#journal("command.delivered", command, { writes: command.writes, previousSequence: current, previousAck: before[paths.ack].value });
    const deadline = Date.now() + (this.#o.ackTimeoutMs ?? 2000);
    while (Date.now() < deadline) {
      const samples = await this.#o.link.read([paths.ack, ...(paths.accepted ? [paths.accepted] : []), ...STATE_PATHS]);
      const ack = Number(samples[paths.ack].value);
      if (ack === expected) {
        // Ack and accepted are set in the same scan; a second read cannot straddle that scan.
        const confirm = paths.accepted ? await this.#o.link.read([paths.ack, paths.accepted]) : samples;
        const values = Object.fromEntries(Object.entries(samples).map(([p, s]) => [p, s.value]));
        command.acknowledgedAtIso = samples[paths.ack].receivedAtIso;
        command.atAck = stateFrom(values, command.acknowledgedAtIso);
        if (!paths.accepted) {
          this.#settle(command);
          return void this.#finish(command, "applied", `PLC echoed ${paths.ack}=${expected}: Stop consumed. Mode at acknowledgement: ${String(values[P.modeText])}.`);
        }
        const accepted = confirm[paths.accepted].value === true && Number(confirm[paths.ack].value) === expected;
        command.accepted = accepted;
        if (!accepted) command.preconditions = action === "start" ? startPreconditions({ ...this.#o.link.values(), ...values }) : resetPreconditions({ ...this.#o.link.values(), ...values });
        this.#settle(command);
        return void this.#finish(command, accepted ? "applied" : "rejected", accepted
          ? `PLC acknowledged ${paths.ack}=${expected} with ${paths.accepted.split(".").at(-1)}=TRUE. Mode at acknowledgement: ${String(values[P.modeText])}.`
          : `PLC acknowledged ${paths.ack}=${expected} with ${paths.accepted.split(".").at(-1)}=FALSE: request refused by the controller. See observed preconditions.`);
      }
      if (ack > expected) return void this.#finish(command, "failed", `PLC acknowledged a later ${paths.ack}=${ack}: another writer issued a request; this request's effect is ambiguous`);
      await sleep(this.#o.ackPollMs ?? 40);
    }
    this.#finish(command, "timed_out", `No ${paths.ack}=${expected} within ${this.#o.ackTimeoutMs ?? 2000} ms. The write was delivered and may still apply; inspect before retrying.`);
  }

  #finish(command: CommandView, outcome: CommandView["outcome"], detail: string): CommandView {
    command.outcome = outcome; command.detail = detail;
    if (outcome !== "refused") this.#o.link.pollSoon();
    this.#journal(`command.${outcome}`, command, { detail, expectedSequence: command.expectedSequence, accepted: command.accepted, atAck: command.atAck,
      preconditions: outcome === "rejected" ? command.preconditions : undefined, acknowledgedAtIso: command.acknowledgedAtIso });
    return command;
  }

  #settle(command: CommandView): void {
    const t = Date.now();
    this.#settling.set(command.requestId, { untilMs: t + (this.#o.settleMs ?? 5000), stableSinceMs: t, last: command.atAck });
  }

  /** A new command ends earlier follow-up windows, so later effects are never attributed to an earlier command. */
  #supersede(by: string): void {
    for (const [id, s] of this.#settling) {
      const command = this.#records.get(id)!;
      this.#settling.delete(id);
      if (!s.last) continue;
      command.resulting = { ...s.last, settled: false, supersededBy: by };
      const record = this.#o.journal.append("command.resulting_state", { requestId: id, resulting: command.resulting });
      command.evidenceRefs.push(HmiJournal.ref(record));
      this.#o.onChange?.(structuredClone(command));
    }
  }

  /** Follows resulting PLC state after an acknowledgement until it is stable or the window ends. */
  observe(snapshot: SnapshotView): void {
    for (const [id, s] of this.#settling) {
      const command = this.#records.get(id)!;
      const values = Object.fromEntries(Object.entries(snapshot.values).filter(([, v]) => v.good).map(([p, v]) => [p, v.value]));
      const state = stateFrom(values, snapshot.receivedAtIso);
      const t = Date.parse(snapshot.receivedAtIso);
      if (!s.last || !sameState(s.last, state)) { s.last = state; s.stableSinceMs = t; }
      const stable = t - s.stableSinceMs >= (this.#o.stableMs ?? 1000) && state.mode !== 2;
      if (stable || t >= s.untilMs) {
        this.#settling.delete(id);
        command.resulting = { ...state, settled: stable };
        const record = this.#o.journal.append("command.resulting_state", { requestId: id, resulting: command.resulting, snapshotSequence: snapshot.sequence });
        command.evidenceRefs.push(HmiJournal.ref(record));
        this.#o.onChange?.(structuredClone(command));
      }
    }
  }
}
