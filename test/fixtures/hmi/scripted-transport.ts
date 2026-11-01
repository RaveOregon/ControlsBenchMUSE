// Scripted M8 protocol transport for HMI tests. It answers operator sequences exactly as each test
// scripts them; it is not a software copy of the conveyor controller and is never an oracle for it.

import type { M8Sample, M8Transport, TransportEvent } from "../../../src/live/m8-opcua.ts";
import type { RawValue } from "../../../src/proof/contracts.ts";
import { hmiReadSignals } from "../../../src/hmi/signals.ts";

export type AckScript = "accept" | "reject" | "none" | "other-writer";

export class ScriptedPlc {
  values: Record<string, RawValue> = {};
  writes: Array<{ path: string; value: RawValue }> = [];
  ack: AckScript = "accept";
  readFails = false;
  openError?: string;
  opens = 0;
  closes = 0;
  freezeCycle = false;
  /** CODESYS rejected a 103-node Read with BadTooManyOperations on 2026-11-01; 72 nodes passed. */
  maxNodesPerRead = 72;
  readSizes: number[] = [];
  /** Per-path sample fields to override (quality, timestamps, value type), as a server could return them. */
  sampleOverride: Record<string, Partial<M8Sample>> = {};
  /** Paths left out of read responses. */
  omit = new Set<string>();
  #cycle = 1000n;

  constructor() {
    for (const s of hmiReadSignals) this.values[s.iecPath] = s.iecType === "BOOL" ? false : s.iecType.startsWith("STRING") ? "" : s.iecType === "ULINT" ? "0" : 0;
    Object.assign(this.values, { "GVL_DemoRead.BuildId": 8001, "GVL_DemoRead.InterfaceVersion": 1, "GVL_BenchRead.PlcBootIdentity": "boot-1",
      "GVL_DemoRead.Status.Mode": 0, "GVL_DemoRead.Status.ModeText": "Stopped" });
  }

  set(values: Record<string, RawValue>): void { Object.assign(this.values, values); }

  read(paths: string[]): Record<string, M8Sample> {
    if (this.readFails) throw new Error("scripted read failure");
    this.readSizes.push(paths.length);
    if (paths.length > this.maxNodesPerRead) throw new Error(" serviceResult = BadTooManyOperations (0x80100000)");
    if (!this.freezeCycle) this.#cycle += 3n;
    this.values["GVL_BenchRead.PlcCycle"] = this.#cycle.toString(); this.values["GVL_BenchRead.OutputCaptureCycle"] = this.#cycle.toString();
    const at = new Date().toISOString();
    return Object.fromEntries(paths.filter(p => !this.omit.has(p)).map(p => {
      if (!(p in this.values)) throw new Error(`Read of unresolved M8 symbol ${p}`);
      return [p, { value: this.values[p], status: "Good (0x00000000)", sourceTimestamp: at, serverTimestamp: at, receivedAtIso: at, ...this.sampleOverride[p] }];
    }));
  }

  write(items: { path: string; value: RawValue }[]): void {
    this.writes.push(...items.map(i => ({ ...i })));
    for (const i of items) this.values[i.path] = i.value;
    for (const [seq, ack, accepted] of [["StartSequence", "StartAck", "StartAccepted"], ["StopSequence", "StopAck", undefined], ["ResetSequence", "ResetAck", "ResetAccepted"]] as const) {
      const item = items.find(i => i.path === `GVL_DemoWrite.${seq}`);
      if (!item || this.ack === "none") continue;
      setTimeout(() => {
        this.values[`GVL_DemoRead.Status.${ack}`] = this.ack === "other-writer" ? Number(item.value) + 1 : item.value;
        if (accepted) this.values[`GVL_DemoRead.Status.${accepted}`] = this.ack === "accept";
      }, 25);
    }
  }

  transport(event: TransportEvent = () => {}): M8Transport {
    const plc = this;
    return {
      async open() { plc.opens++; if (plc.openError) throw new Error(plc.openError); event("connection.established", { scripted: true }); },
      async read(paths) { await new Promise(r => setTimeout(r, 2)); return plc.read(paths); },
      async write(items) { plc.write(items); event("opc.write", { items: items.map(i => ({ ...i, status: "Good (0x00000000)" })) }); },
      async close() { plc.closes++; }
    };
  }
}

export const waitFor = async (predicate: () => boolean, timeoutMs = 3000, label = "condition") => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`); await new Promise(r => setTimeout(r, 10)); }
};
