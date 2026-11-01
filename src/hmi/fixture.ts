// FIXTURE transport for H0 rendering and offline tests. It replays one recorded M10 controller
// read (test/fixtures/hmi/m10-recorded-states.json) and, when emulation is on, answers operator
// sequences with a small subset of the FB_DemoConveyor acknowledgement rules. It is not a model
// of M8 behaviour and no result produced against it is PLC evidence.

import { readFileSync } from "node:fs";
import type { M8Sample, M8Transport, TransportEvent } from "../live/m8-opcua.ts";
import type { RawValue } from "../proof/contracts.ts";
import type { Scalar } from "./protocol.ts";
import { HMI_WRITE_ALLOWLIST, P, active, hmiReadSignals, resetPreconditions, startPreconditions } from "./signals.ts";

export interface FixtureState { id: string; title: string; description: string; recordedAtIso: string; samples: Record<string, { value: Scalar }>; writeGroup: Record<string, Scalar> }
export interface FixtureFile { label: string; source: { file: string; sha256: string; run: string }; note: string; states: FixtureState[] }

export function loadFixtures(file = new URL("../../test/fixtures/hmi/m10-recorded-states.json", import.meta.url)): FixtureFile {
  return JSON.parse(readFileSync(file, "utf8")) as FixtureFile;
}

export interface FixtureControl { link?: "up" | "down"; connectorStale?: boolean; fault?: { code: number; text: string }; clearCause?: boolean; state?: string; readLatencyMs?: number }

const GOOD = "Good (0x00000000)";
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Shared fixture "PLC": one per HMI service so reconnects see the same state. */
export class FixturePlc {
  readonly fixtures: FixtureFile;
  values: Record<string, Scalar> = {};
  origin: Record<string, "recorded" | "write-group" | "fixture default"> = {};
  stateId = "";
  link: "up" | "down" = "up";
  readLatencyMs = 4;
  readonly emulate: boolean;
  #t0 = Date.now();
  #cycle0 = 0n;
  #timers = new Set<ReturnType<typeof setTimeout>>();
  writes: Array<{ path: string; value: RawValue }> = [];

  constructor(stateId: string, options: { emulate?: boolean; fixtures?: FixtureFile } = {}) {
    this.fixtures = options.fixtures ?? loadFixtures();
    this.emulate = options.emulate ?? true;
    this.load(stateId);
  }

  load(stateId: string): void {
    const state = this.fixtures.states.find(s => s.id === stateId);
    if (!state) throw new Error(`Unknown fixture state ${stateId}; have ${this.fixtures.states.map(s => s.id).join(", ")}`);
    this.stateId = stateId; this.values = {}; this.origin = {};
    for (const s of hmiReadSignals) {
      const recorded = state.samples[s.iecPath];
      if (recorded) { this.values[s.iecPath] = recorded.value; this.origin[s.iecPath] = "recorded"; }
      else if (s.iecPath in state.writeGroup) { this.values[s.iecPath] = state.writeGroup[s.iecPath]; this.origin[s.iecPath] = "write-group"; }
      else { this.values[s.iecPath] = s.iecType === "BOOL" ? false : s.iecType.startsWith("STRING") ? "" : s.iecType === "ULINT" ? "0" : 0; this.origin[s.iecPath] = "fixture default"; }
    }
    // Derived defaults so the fixture is internally consistent; still labelled fixture default.
    const encoder = Number(this.values[active("Encoder_Count")] ?? 0);
    this.values["GVL_DemoRead.Status.TravelMetres"] = encoder / 1000;
    this.values["GVL_DemoRead.Status.ScanTimeUs"] = "184";
    this.values["GVL_BenchRead.PlcHeartbeat"] = String(this.values[P.plcCycle] ?? "0");
    this.values["GVL_BenchRead.AppliedCommitCount"] = String(this.values["GVL_BenchRead.AppliedSequence"] ?? "0");
    this.#cycle0 = BigInt(String(this.values[P.plcCycle] ?? "0")); this.#t0 = Date.now();
  }

  control(c: FixtureControl): void {
    if (c.state) this.load(c.state);
    if (c.link) this.link = c.link;
    if (c.readLatencyMs !== undefined) this.readLatencyMs = c.readLatencyMs;
    if (c.connectorStale !== undefined) this.values[P.connectorStale] = c.connectorStale;
    if (c.fault) this.#trip(c.fault.code, c.fault.text);
    if (c.clearCause) {
      // Fixture stand-in for the external parties: carton removed, limits home, WCS acknowledges.
      for (const n of ["PE_Entry", "PE_D1Approach", "PE_D2Approach", "PE_ExitA", "PE_ExitB", "PE_Runout", "D1_ExtendedFB", "D2_ExtendedFB", "Drive_RunningFB", "Drive_Overload"]) this.values[active(n)] = false;
      for (const n of ["D1_HomeFB", "D2_HomeFB", "Runout_Ready", "ExitA_Ready", "ExitB_Ready"]) this.values[active(n)] = true;
      this.values["GVL_DemoWrite.CompletionAck"] = this.values["GVL_DemoRead.Status.CompletionSequence"];
      this.values[P.completionPending] = false;
    }
  }

  #tick(): void {
    const cycle = (this.#cycle0 + BigInt(Math.floor((Date.now() - this.#t0) / 20))).toString();
    this.values[P.plcCycle] = cycle; this.values[P.outputCaptureCycle] = cycle; this.values["GVL_BenchRead.PlcHeartbeat"] = cycle;
    this.values["GVL_BenchRead.PlcTimeUs"] = (BigInt(Date.now()) * 1000n).toString();
    this.values["GVL_BenchRead.OutputCaptureTimeUs"] = this.values["GVL_BenchRead.PlcTimeUs"];
  }

  read(paths: string[]): Record<string, M8Sample> {
    if (this.link === "down") throw new Error("FIXTURE link down (simulated)");
    this.#tick();
    const at = new Date().toISOString();
    return Object.fromEntries(paths.map(p => {
      if (!(p in this.values)) throw new Error("Read of unresolved M8 symbol");
      return [p, { value: this.values[p] as RawValue, status: `${GOOD} [fixture: ${this.origin[p] ?? "emulated"}]`, sourceTimestamp: at, serverTimestamp: at, receivedAtIso: at }];
    }));
  }

  write(items: { path: string; value: RawValue }[]): void {
    if (this.link === "down") throw new Error("FIXTURE link down (simulated)");
    for (const i of items) if (!HMI_WRITE_ALLOWLIST.has(i.path)) throw new Error(`FIXTURE refuses write outside operator allowlist ${i.path}`);
    for (const i of items) { this.values[i.path] = i.value as Scalar; this.origin[i.path] = "write-group"; this.writes.push({ ...i }); }
    if (this.emulate) this.#later(30, () => this.#scan(items.map(i => i.path)));
  }

  #later(ms: number, f: () => void): void { const t = setTimeout(() => { this.#timers.delete(t); f(); }, ms); this.#timers.add(t); }

  #set(values: Record<string, Scalar>): void { Object.assign(this.values, values); }

  #trip(code: number, text: string): void {
    if (this.values[P.mode] === 3) return;
    this.#set({ [P.faultCode]: code, [P.faultText]: text, [P.mode]: 3, [P.modeText]: "Faulted", [P.motorCmd]: false, [P.d1Cmd]: false, [P.d2Cmd]: false,
      "GVL_BenchRead.Motor_RunCmd": false, "GVL_BenchRead.D1_ExtendCmd": false, "GVL_BenchRead.D2_ExtendCmd": false,
      "GVL_DemoRead.Status.StackLight_Red": true, "GVL_DemoRead.Status.StackLight_Green": false, "GVL_BenchRead.StackLight_Red": true, "GVL_BenchRead.StackLight_Green": false });
  }

  #run(on: boolean): void {
    this.#set({ [P.motorCmd]: on, "GVL_BenchRead.Motor_RunCmd": on, "GVL_DemoRead.Status.StackLight_Green": on, "GVL_BenchRead.StackLight_Green": on,
      "GVL_DemoRead.Status.StackLight_Red": false, "GVL_BenchRead.StackLight_Red": false });
    this.#later(on ? 300 : 500, () => {
      this.values[active("Drive_RunningFB")] = on;
      if (!on && this.values[P.mode] === 2) this.#set({ [P.mode]: 0, [P.modeText]: "Stopped" });
    });
  }

  /** Emulated subset of the FB_DemoConveyor sequence handling (fixture only). */
  #scan(paths: string[]): void {
    const v = this.values;
    if (paths.includes(P.stopSeq)) { v[P.stopAck] = v[P.stopSeq]; if (v[P.mode] === 1) { this.#set({ [P.mode]: 2, [P.modeText]: "Stopping" }); this.#run(false); } }
    if (paths.includes(P.autoRequest) && v[P.autoRequest] === false && v[P.mode] === 1) { this.#set({ [P.mode]: 2, [P.modeText]: "Stopping" }); this.#run(false); }
    if (paths.includes(P.resetSeq)) {
      const ok = resetPreconditions(v).every(c => c.met === true);
      this.#set({ [P.resetAck]: v[P.resetSeq], [P.resetAccepted]: ok });
      if (ok) this.#set({ [P.faultCode]: 0, [P.faultText]: "", [P.mode]: 0, [P.modeText]: "Stopped", "GVL_DemoRead.Status.ExceptionCode": 0, "GVL_DemoRead.Status.ExceptionText": "",
        "GVL_DemoRead.Status.StackLight_Red": false, "GVL_BenchRead.StackLight_Red": false, "GVL_DemoRead.Status.OfferPending": false });
    }
    if (paths.includes(P.startSeq)) {
      const ok = startPreconditions(v).every(c => c.met !== false);
      this.#set({ [P.startAck]: v[P.startSeq], [P.startAccepted]: ok });
      if (ok) { this.#set({ [P.mode]: 1, [P.modeText]: "Auto" }); this.#run(true); }
    }
  }

  close(): void { for (const t of this.#timers) clearTimeout(t); this.#timers.clear(); }

  /** One transport session over this fixture PLC. */
  transport(event: TransportEvent): M8Transport {
    const plc = this;
    return {
      async open() {
        event("connection.attempt", { endpoint: "fixture://m10-recorded", fixture: plc.stateId });
        await sleep(20);
        if (plc.link === "down") { event("connection.failed", { message: "FIXTURE connection refused (simulated)" }); throw new Error("FIXTURE connection refused (simulated)"); }
        event("connection.established", { authenticated: false, fixture: true });
        event("symbols.resolved", { resolved: hmiReadSignals.map(s => ({ iecPath: s.iecPath, nodeId: `fixture;s=${s.iecPath}` })), readGroupWritableWarnings: [], writePolicy: "FIXTURE: operator allowlist only" });
      },
      async read(paths) { await sleep(plc.readLatencyMs); return plc.read(paths); },
      async write(items) {
        await sleep(plc.readLatencyMs);
        plc.write(items);
        event("opc.write", { items: items.map(i => ({ ...i, status: GOOD })) });
      },
      async close() {}
    };
  }
}
