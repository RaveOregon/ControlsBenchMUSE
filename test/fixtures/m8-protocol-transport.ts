import assert from "node:assert/strict";
import type { M8Sample, M8Transport } from "../../src/live/m8-opcua.ts";
import { requiredSignals, rawInputs, writeSignals } from "../../src/live/m8-map.ts";
import type { RawValue } from "../../src/proof/contracts.ts";

// Protocol fixture only: never an oracle for M8 conveyor behavior.
export class ProtocolTransport implements M8Transport {
  values: Record<string, RawValue> = {};
  writes: { path: string; value: RawValue }[][] = [];
  torn = false; badQuality = false; boot = "boot-1"; build = 8001;
  readSizes: number[] = [];
  rejectedCommands = new Set<string>();
  constructor() {
    for (const s of requiredSignals) this.values[s.iecPath] = s.iecType === "ULINT" ? "0" : s.iecType.startsWith("STRING") ? "" : s.iecType === "BOOL" ? false : 0;
    Object.assign(this.values, { "GVL_DemoRead.BuildId": 8001, "GVL_DemoRead.InterfaceVersion": 1, "GVL_BenchRead.SimApplied": true });
  }
  opens = 0; closes = 0;
  async open() { this.opens++; }
  async close() { this.closes++; }
  async read(paths: string[]) {
    this.readSizes.push(paths.length);
    this.values["GVL_BenchRead.PlcBootIdentity"] = this.boot; this.values["GVL_DemoRead.BuildId"] = this.build;
    const at = new Date().toISOString();
    return Object.fromEntries(paths.map(p => [p, { value: this.values[p], status: this.badQuality ? "Bad" : "Good", sourceTimestamp: at, serverTimestamp: at, receivedAtIso: at }])) as Record<string, M8Sample>;
  }
  async write(items: { path: string; value: RawValue }[]) {
    const allow = new Set(writeSignals.map(s => s.iecPath)); items.forEach(i => assert(allow.has(i.path)));
    this.writes.push(structuredClone(items)); for (const i of items) this.values[i.path] = i.value;
    if (items.some(i => i.path === "GVL_BenchWrite.SimRequest")) this.values["GVL_BenchRead.SimApplied"] = this.values["GVL_BenchWrite.SimRequest"];
    if (items.some(i => i.path.endsWith("SessionResetRequest") && i.value === true)) {
      const n = "GVL_BenchRead.SessionResetCount"; this.values[n] = String(BigInt(String(this.values[n])) + 1n);
      this.values["GVL_BenchRead.AppliedEpoch"] = "0"; this.values["GVL_BenchRead.AppliedSequence"] = "0";
    }
    if (items.some(i => i.path === "GVL_BenchWrite.RequestedSequence" && i.value !== "0")) {
      const slot = Number(this.values["GVL_BenchWrite.RequestedSlot"]);
      assert.equal(this.values[`GVL_BenchWrite.Slot${slot}_Valid`], true);
      for (const k of rawInputs) this.values[`GVL_BenchRead.Active_${k}`] = this.values[`GVL_BenchWrite.Slot${slot}_${k}`];
      if (this.torn) this.values["GVL_BenchRead.Active_Encoder_Count"] = 999;
      this.values["GVL_BenchRead.AppliedEpoch"] = this.values["GVL_BenchWrite.RequestedEpoch"];
      this.values["GVL_BenchRead.AppliedSequence"] = this.values["GVL_BenchWrite.RequestedSequence"];
      this.values["GVL_BenchRead.ActiveSlot"] = slot;
    }
    const c = "GVL_DemoRead.Status.";
    for (const name of ["Start", "Stop", "Reset"]) if (items.some(i => i.path === `GVL_DemoWrite.${name}Sequence`)) {
      this.values[`${c}${name}Ack`] = this.values[`GVL_DemoWrite.${name}Sequence`];
      if (name !== "Stop") this.values[`${c}${name}Accepted`] = !this.rejectedCommands.has(name.toLowerCase());
    }
    if (items.some(i => i.path === "GVL_DemoWrite.OfferSequence")) {
      this.values[`${c}OfferAckSequence`] = this.values["GVL_DemoWrite.OfferSequence"];
      this.values[`${c}OfferAckItemId`] = this.values["GVL_DemoWrite.OfferItemId"]; this.values[`${c}OfferAccepted`] = !this.rejectedCommands.has("offer");
    }
  }
}
