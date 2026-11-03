import { randomBytes } from "node:crypto";
import type { BenchConnector, ConnectorObservation, CommitReceipt, RawSignalImage } from "./connector.ts";
import { boolInputs, realInputs, rawInputs, observedSignals, signalByLeaf, validateM8Image, byLogical } from "./m8-map.ts";
import type { RawValue } from "../proof/contracts.ts";

export interface M8Sample { value: RawValue; status: string; sourceTimestamp: string; serverTimestamp: string; receivedAtIso: string }
export interface M8Transport {
  open(): Promise<void>;
  read(paths: string[]): Promise<Record<string, M8Sample>>;
  write(items: { path: string; value: RawValue }[]): Promise<void>;
  close(): Promise<void>;
}
export type TransportEvent = (kind: string, data: Record<string, unknown>) => void;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** A coherent acknowledgement with Accepted=false: the write outcome is known. */
export class ConfirmedCommandRejection extends Error {
  readonly action: string; readonly actionId: string; readonly expected: number; readonly observation: ConnectorObservation;
  constructor(action: string, actionId: string, expected: number, observation: ConnectorObservation) {
    super(`${action} acknowledged but rejected by PLC`);
    this.action = action; this.actionId = actionId; this.expected = expected; this.observation = observation;
  }
}
export class M8OpcUaConnector implements BenchConnector {
  readonly id = "m8-opcua-v1";
  readonly transport: M8Transport;
  readonly event: TransportEvent;
  #epoch = BigInt(`0x${randomBytes(6).toString("hex")}`) || 1n;
  #sequence = 0; #heartbeat = 0n; #slot = 255; #boot?: string;
  #lastCommitAt = -Infinity; #tail: Promise<unknown> = Promise.resolve(); #poisoned = false;
  latest?: ConnectorObservation;
  readonly requireStoppedBaseline: boolean;
  constructor(transport: M8Transport, event: TransportEvent = () => {}, options: { requireStoppedBaseline?: boolean } = {}) {
    this.transport = transport; this.event = event; this.requireStoppedBaseline = options.requireStoppedBaseline ?? false;
  }
  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(async () => { if (this.#poisoned) throw new Error("M8 connector quarantined; no retry"); return operation(); });
    this.#tail = result.catch(error => { if (!(error instanceof ConfirmedCommandRejection)) this.#poisoned = true; }); return result;
  }
  async #read(names: string[]) {
    const paths = names.map(n => n.startsWith("GVL_") ? n : n.startsWith("controller.") ? byLogical.get(n)!.iecPath : signalByLeaf(n).iecPath);
    const samples = await this.transport.read(paths);
    for (const p of paths) { const s = samples[p]; if (!s || !s.status.startsWith("Good") || !s.sourceTimestamp || !s.serverTimestamp || !s.receivedAtIso) throw new Error(`Bad quality/timestamp ${p}`); }
    return Object.fromEntries(names.map((n, i) => [n, samples[paths[i]].value]));
  }
  async #write(values: Record<string, RawValue>) { await this.transport.write(Object.entries(values).map(([name, value]) => ({ path: signalByLeaf(name).iecPath, value }))); }
  async #snapshot(linkOnly = false): Promise<ConnectorObservation> {
    const names = ["BuildId", "InterfaceVersion", "SimApplied", "ConnectorStale", "ActiveSlot", "AppliedEpoch", "AppliedSequence", "PlcBootIdentity", "PlcCycle", "PlcTimeUs", "OutputCaptureCycle", "OutputCaptureTimeUs",
      ...(linkOnly ? [] : [...rawInputs.map(n => `Active_${n}`), ...observedSignals.map(s => s.logical)])];
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline) {
      const before = await this.#read(["PlcCycle", "OutputCaptureCycle"]);
      if (before.PlcCycle !== before.OutputCaptureCycle) continue;
      const v = await this.#read(names);
      const after = await this.#read(["PlcCycle", "OutputCaptureCycle"]);
      if (before.PlcCycle !== after.PlcCycle || after.PlcCycle !== after.OutputCaptureCycle || v.PlcCycle !== after.PlcCycle || v.OutputCaptureCycle !== v.PlcCycle) continue;
      if (v.BuildId !== 8001 || v.InterfaceVersion !== 1) throw new Error("Refuse controller other than M8 build 8001/interface 1");
      if (this.#boot && String(v.PlcBootIdentity) !== this.#boot) throw new Error("PLC boot changed; stop and reconcile");
      this.#boot = String(v.PlcBootIdentity); this.#slot = Number(v.ActiveSlot);
      const o: ConnectorObservation = { observedAtIso: new Date().toISOString(), observedAtMonotonicMs: performance.now(),
        bootIdentity: this.#boot, appliedEpoch: String(v.AppliedEpoch), appliedSequence: String(v.AppliedSequence), plcCycle: String(v.PlcCycle), plcTimeUs: String(v.PlcTimeUs),
        outputCaptureCycle: String(v.OutputCaptureCycle), outputCaptureTimeUs: String(v.OutputCaptureTimeUs),
        connectorStale: v.ConnectorStale === true, simulationApplied: v.SimApplied === true,
        values: linkOnly ? {} : Object.fromEntries(observedSignals.map(s => [s.logical, v[s.logical]])),
        ...(!linkOnly ? { outputQuality: Object.fromEntries(observedSignals.map(s => [s.logical, "good" as const])) } : {}) };
      if (linkOnly) this.event("link.observation", { observation: o });
      else {
        this.latest = o; this.#activeImage = Object.fromEntries(rawInputs.map(n => [n, v[`Active_${n}`]]));
        this.event("observation", { observation: o, activeImage: this.#activeImage });
      }
      return o;
    }
    throw new Error("Cannot obtain coherent PLC/capture-cycle bracket");
  }
  #activeImage: RawSignalImage = {};
  open(): Promise<ConnectorObservation> { return this.#serial(async () => {
    await this.transport.open(); const observation = await this.#snapshot();
    if (this.requireStoppedBaseline) {
      const required: Record<string, RawValue> = { "controller.Mode": 0, "controller.FaultCode": 0, "controller.ItemActive": false,
        "controller.CompletionPending": false, Motor_RunCmd: false };
      for (const [name, value] of Object.entries(required)) if (observation.values[name] !== value) throw new Error(`Require clean stopped M8 baseline before any write: ${name}=${observation.values[name]}`);
    }
    return observation;
  }); }
  resetSession(): Promise<ConnectorObservation> {
    return this.#serial(async () => {
      const v = await this.#read(["WorkstationHeartbeat", "SessionResetCount"]);
      this.#heartbeat = BigInt(String(v.WorkstationHeartbeat));
      await this.#write({ SimRequest: true, SessionResetRequest: false }); await sleep(100);
      await this.#write({ SessionResetRequest: true, WorkstationHeartbeat: String(++this.#heartbeat) });
      const deadline = performance.now() + 2000;
      let reset = false;
      while (performance.now() < deadline) {
        const a = await this.#read(["SessionResetCount", "AppliedEpoch", "AppliedSequence"]);
        if (BigInt(String(a.SessionResetCount)) > BigInt(String(v.SessionResetCount)) && a.AppliedEpoch === "0" && a.AppliedSequence === "0") { reset = true; break; }
        await sleep(20);
      }
      if (!reset) throw new Error("Explicit session reset not acknowledged");
      await this.#write({ SessionResetRequest: false, RequestedSequence: "0", RequestedEpoch: "0" });
      this.#sequence = 0; this.#epoch = BigInt(`0x${randomBytes(6).toString("hex")}`) || 1n;
      return this.#snapshot();
    });
  }
  commit(candidate: Readonly<RawSignalImage>): Promise<CommitReceipt> {
    const image = validateM8Image(candidate);
    return this.#serial(async () => {
      while (performance.now() - this.#lastCommitAt < 100) await sleep(Math.max(1, 100 - (performance.now() - this.#lastCommitAt)));
      const sentAtMonotonicMs = performance.now(), sentAtIso = new Date().toISOString();
      this.#lastCommitAt = sentAtMonotonicMs;
      const slot = this.#slot === 0 ? 1 : 0, sequence = this.#sequence + 1, epoch = this.#epoch.toString();
      this.event("commit.requested", { epoch, sequence: String(sequence), image, sentAtMonotonicMs, sentAtIso });
      // Separate completed writes: invalidate -> complete payload -> valid -> metadata -> sequence LAST.
      await this.#write({ [`Slot${slot}_Valid`]: false });
      await this.#write({ ...Object.fromEntries(rawInputs.map(n => [`Slot${slot}_${n}`, image[n]])), [`Slot${slot}_Epoch`]: epoch, [`Slot${slot}_Sequence`]: String(sequence) });
      await this.#write({ [`Slot${slot}_Valid`]: true });
      await this.#write({ RequestedSlot: slot, RequestedEpoch: epoch, WorkstationHeartbeat: String(++this.#heartbeat) });
      await this.#write({ RequestedSequence: String(sequence) });
      const deadline = performance.now() + 2000;
      while (performance.now() < deadline) {
        const o = await this.#snapshot();
        if (o.appliedEpoch === epoch && o.appliedSequence === String(sequence)) {
          if (!o.simulationApplied || o.connectorStale) throw new Error("Acknowledgement is stale or simulation inactive");
          for (const n of rawInputs) if (this.#activeImage[n] !== image[n]) throw new Error(`Active image differs at ${n}`);
          this.#sequence = sequence;
          const receipt: CommitReceipt = { ...o, workstationEpoch: epoch, workstationSequence: String(sequence), slot,
            sentAtIso, sentAtMonotonicMs, acknowledgedAtIso: new Date().toISOString(), acknowledgedAtMonotonicMs: performance.now(), latencyMs: performance.now() - sentAtMonotonicMs, image };
          this.event("commit.acknowledged", { receipt }); return receipt;
        }
        await sleep(5);
      }
      throw new Error("Commit acknowledgement deadline; retain last image and stop");
    });
  }
  observe(): Promise<ConnectorObservation> { return this.#serial(() => this.#snapshot()); }
  inspectLink(): Promise<ConnectorObservation> { return this.#serial(() => this.#snapshot(true)); }
  exitSimulation(): Promise<ConnectorObservation> {
    return this.#serial(async () => {
      await this.#write({ SimRequest: false });
      const deadline = performance.now() + 2000;
      while (performance.now() < deadline) {
        const observation = await this.#snapshot();
        if (!observation.simulationApplied) { this.event("simulation.exited", { observation }); return observation; }
        await sleep(20);
      }
      throw new Error("Hardware passthrough was not observed; simulation exit is inconclusive");
    });
  }
  action(action: "start" | "stop" | "reset" | "offer" | "completion_ack", parameters: Record<string, unknown>, actionId: string): Promise<ConnectorObservation> {
    return this.#serial(async () => {
      this.event("command.requested", { actionId, action, parameters });
      let ack: string, expected: number;
      if (action === "offer") {
        const old = await this.#read(["OfferSequence"]); expected = Number(old.OfferSequence) + 1; ack = "controller.OfferAckSequence";
        if (!Number.isInteger(parameters.itemId) || Number(parameters.itemId) < 1 || Number(parameters.itemId) > 0xffffffff || ![0, 1, 2].includes(Number(parameters.route))) throw new Error("Invalid WCS offer payload");
        if (expected > 0xffffffff) throw new Error("WCS sequence wrap requires explicit new session");
        await this.#write({ OfferItemId: Number(parameters.itemId), OfferRoute: Number(parameters.route) });
        await this.#write({ OfferSequence: expected });
      } else if (action === "completion_ack") {
        expected = Number(parameters.sequence); ack = "controller.CompletionPending";
        const before = await this.#snapshot();
        if (expected !== before.values["controller.CompletionSequence"]) throw new Error("Refuse acknowledgement of a different completion");
        await this.#write({ CompletionAck: expected });
      } else {
        const prefix = action[0].toUpperCase() + action.slice(1), name = `${prefix}Sequence`;
        expected = Number((await this.#read([name]))[name]) + 1; ack = `controller.${prefix}Ack`;
        if (expected > 0xffffffff) throw new Error("Operator sequence wrap requires explicit new session");
        if (action === "start") await this.#write({ AutoRequest: true });
        await this.#write({ [name]: expected });
      }
      const deadline = performance.now() + 2000;
      while (performance.now() < deadline) {
        const o = await this.#snapshot();
        if (o.values[ack] === (action === "completion_ack" ? false : expected)) {
          if (action === "offer" && o.values["controller.OfferAckItemId"] !== parameters.itemId) throw new Error("Offer acknowledgement item differs; outcome requires reconciliation");
          const accepted = action === "start" ? "controller.StartAccepted" : action === "reset" ? "controller.ResetAccepted" : action === "offer" ? "controller.OfferAccepted" : undefined;
          if (accepted && typeof o.values[accepted] !== "boolean") throw new Error("Command acceptance is not a Boolean; outcome requires reconciliation");
          if (action === "start" && o.values["controller.StartAccepted"] === false || action === "reset" && o.values["controller.ResetAccepted"] === false || action === "offer" && o.values["controller.OfferAccepted"] === false) {
            this.event("command.rejected", { actionId, action, expected, observation: o });
            throw new ConfirmedCommandRejection(action, actionId, expected, o);
          }
          this.event("command.applied", { actionId, action, expected, observation: o }); return o;
        }
        await sleep(10);
      }
      throw new Error(`${action} acknowledgement deadline; no retry`);
    });
  }
  async close(): Promise<void> { await this.#tail; await this.transport.close(); /* retain simulation/image */ }
}
