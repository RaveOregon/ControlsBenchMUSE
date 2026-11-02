// Offline M8 bench fixture for the W4 commissioning harness and held-state recovery tests.
// Lane A's protocol fixture plus a short, hand-written table of scripted controller reactions so the
// harness's declared steps can run end to end. It is NOT an M8 behavior model and never an oracle
// for the PLC: every reaction below is written here, and only live commissioning qualifies the real
// controller. State persists in a JSON file so a run, its child and a later recovery process all see
// the same fixture "PLC"; tests edit that file to stand in for a held state evolving on the bench.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { ChildFixtureTransport } from "./wonder-process-transport.ts";
import { byLogical, rawInputs } from "../../src/live/m8-map.ts";
import type { TransportEvent } from "../../src/live/m8-opcua.ts";
import type { RawValue } from "../../src/proof/contracts.ts";

export interface BenchOptions {
  stateFile?: string;
  /** Every completed write from this process, one JSON line each. */
  writesFile?: string;
  boot?: string;
  /** Latch this fault once a tracked carton has been committed this many times. */
  unexpectedFault?: { code: number; text: string; afterItemCommits: number };
  /** The first write matching this path after N applied commits never settles. */
  hangWriteMatch?: string; hangAfterCommits?: number;
  /** The child process exits abruptly once this many commits were applied. */
  exitAfterCommits?: number;
}
export const signalPath = (logical: string) => {
  const signal = byLogical.get(logical) ?? byLogical.get(`controller.${logical}`);
  if (!signal) throw new Error(`Unknown fixture signal ${logical}`);
  return signal.iecPath;
};
/** Test helper: edit the persisted fixture PLC (logical names, or raw IEC paths). */
export function editBenchState(stateFile: string, edit: { boot?: string; values?: Record<string, RawValue> }): void {
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  if (edit.boot) state.boot = edit.boot;
  for (const [name, value] of Object.entries(edit.values ?? {})) state.values[name.includes(".") && name.startsWith("GVL_") ? name : signalPath(name)] = value;
  writeFileSync(stateFile, JSON.stringify(state));
}
export const readBenchValue = (stateFile: string, logical: string): RawValue => JSON.parse(readFileSync(stateFile, "utf8")).values[logical.startsWith("GVL_") ? logical : signalPath(logical)];

export class BenchTransport extends ChildFixtureTransport {
  readonly options: BenchOptions;
  readonly event: TransportEvent;
  #commits = 0; #itemCommits = 0; #hung = false;
  #prev: Record<string, RawValue> = {};
  #offer?: { itemId: number; route: number };
  constructor(options: BenchOptions, event: TransportEvent) {
    super();
    this.options = options; this.event = event;
    if (options.stateFile && existsSync(options.stateFile)) {
      const state = JSON.parse(readFileSync(options.stateFile, "utf8"));
      this.values = state.values; this.boot = state.boot; this.#offer = state.offer;
    } else {
      if (options.boot) this.boot = options.boot;
      Object.assign(this.values, { [signalPath("ModeText")]: "Stopped", [signalPath("ReleaseReady")]: true });
    }
    this.#prev = this.#active();
  }
  #active(): Record<string, RawValue> { return Object.fromEntries(rawInputs.map(k => [k, this.values[`GVL_BenchRead.Active_${k}`]])); }
  #get(name: string): RawValue { return this.values[signalPath(name)]; }
  #set(values: Record<string, RawValue>) { for (const [name, value] of Object.entries(values)) this.values[signalPath(name)] = value; }
  persist(): void { if (this.options.stateFile) writeFileSync(this.options.stateFile, JSON.stringify({ boot: this.boot, values: this.values, offer: this.#offer })); }
  async open(): Promise<void> { await super.open(); this.event("connection.established", { fixture: "w4-bench-transport" }); }
  async close(): Promise<void> { this.persist(); await super.close(); }
  async write(items: { path: string; value: RawValue }[]): Promise<void> {
    const o = this.options;
    if (o.hangWriteMatch && !this.#hung && this.#commits >= (o.hangAfterCommits ?? 0) && items.some(i => i.path.includes(o.hangWriteMatch!))) {
      this.#hung = true; this.event("fixture.write_hung", { paths: items.map(i => i.path) });
      await new Promise<void>(() => {});
    }
    await super.write(items);
    this.event("opc.write", { items: items.map(i => ({ ...i, status: "Good" })) });
    if (o.writesFile) appendFileSync(o.writesFile, JSON.stringify({ atIso: new Date().toISOString(), items }) + "\n");
    this.#react(items);
    this.persist();
    if (o.exitAfterCommits && this.#commits >= o.exitAfterCommits) process.exit(70);
  }
  #fault(code: number, text: string) {
    if (this.#get("ItemActive") === true) this.#abort();
    this.#set({ FaultCode: code, FaultText: text, Mode: 3, ModeText: "Faulted", Motor_RunCmd: false, D1_ExtendCmd: false, D2_ExtendCmd: false, StackLight_Red: true, StackLight_Green: false });
  }
  #abort() {
    this.#set({ ItemActive: false, Disposition: 4, CompletionSequence: Number(this.#get("CompletionSequence")) + 1, CompletionPending: true,
      CompletionItemId: this.#get("ActiveItemId"), CompletionRoute: this.#get("RequestedRoute"), CompletionExit: 0, CompletionDisposition: 4,
      CountFaulted: Number(this.#get("CountFaulted")) + 1 });
  }
  #react(items: { path: string; value: RawValue }[]) {
    const wrote = (leaf: string) => items.some(i => i.path === `GVL_DemoWrite.${leaf}`);
    const faulted = Number(this.#get("FaultCode")) !== 0;
    if (wrote("StartSequence")) {
      if (faulted) this.#set({ StartAccepted: false });
      else this.#set({ Mode: 1, ModeText: "Auto", Motor_RunCmd: true, StackLight_Green: true, StackLight_Red: false });
    }
    if (wrote("StopSequence") && this.#get("Mode") === 1) this.#set({ Mode: 0, ModeText: "Stopped", Motor_RunCmd: false, D1_ExtendCmd: false, D2_ExtendCmd: false, StackLight_Green: false });
    if (wrote("ResetSequence")) {
      if (this.values["GVL_BenchRead.Active_Drive_Overload"] === true) this.#set({ ResetAccepted: false });
      else if (faulted) this.#set({ FaultCode: 0, FaultText: "", Mode: 0, ModeText: "Stopped", StackLight_Red: false });
    }
    if (wrote("OfferSequence")) this.#offer = { itemId: Number(this.values["GVL_DemoWrite.OfferItemId"]), route: Number(this.values["GVL_DemoWrite.OfferRoute"]) };
    if (wrote("CompletionAck") && this.values["GVL_DemoWrite.CompletionAck"] === this.#get("CompletionSequence")) this.#set({ CompletionPending: false });
    if (items.some(i => i.path === "GVL_BenchWrite.RequestedSequence" && i.value !== "0")) {
      this.#commits++;
      const a = this.#active(), p = this.#prev;
      const count = Number(a.Encoder_Count), before = Number(p.Encoder_Count ?? count);
      this.#set({ EncoderDelta: (count - before + 2 ** 32) % 2 ** 32 });
      if (a.Drive_Overload === true && Number(this.#get("FaultCode")) === 0) this.#fault(10, "Drive overload");
      const u = this.options.unexpectedFault;
      if (this.#get("ItemActive") === true && u && ++this.#itemCommits >= u.afterItemCommits && Number(this.#get("FaultCode")) === 0) this.#fault(u.code, u.text);
      if (this.#get("Mode") === 1 && this.#get("ItemActive") !== true && this.#get("CompletionPending") !== true && a.PE_Entry === true && p.PE_Entry !== true) {
        const offer = this.#offer; this.#offer = undefined;
        this.#set({ ItemActive: true, ActiveItemId: offer?.itemId ?? 0, RequestedRoute: offer?.route ?? 0, Disposition: 0,
          D1_ExtendCmd: offer?.route === 1, D2_ExtendCmd: offer?.route === 2 });
      }
      if (this.#get("ItemActive") === true) {
        const exit = a.PE_ExitA === true && p.PE_ExitA !== true ? 1 : a.PE_ExitB === true && p.PE_ExitB !== true ? 2 : a.PE_Runout === true && p.PE_Runout !== true ? 3 : 0;
        if (exit) {
          const route = Number(this.#get("RequestedRoute")), disposition = route === exit ? 1 : route === 0 && exit === 3 ? 2 : 3;
          const counter = exit === 1 ? "CountExitA" : exit === 2 ? "CountExitB" : "CountRunout";
          this.#set({ ItemActive: false, Disposition: disposition, CompletionSequence: Number(this.#get("CompletionSequence")) + 1, CompletionPending: true,
            CompletionItemId: this.#get("ActiveItemId"), CompletionRoute: route, CompletionExit: exit, CompletionDisposition: disposition,
            [counter]: Number(this.#get(counter)) + 1, ...(disposition === 3 ? { CountMisroute: Number(this.#get("CountMisroute")) + 1 } : {}),
            D1_ExtendCmd: false, D2_ExtendCmd: false, ActualExit: exit });
        }
      }
      this.#prev = a;
    }
    this.#set({ ReleaseReady: this.#get("ItemActive") !== true && this.#get("CompletionPending") !== true && Number(this.#get("FaultCode")) === 0 });
  }
}
export function createTransport(options: BenchOptions = {}, context: { event?: TransportEvent } = {}): BenchTransport {
  return new BenchTransport(options, context.event ?? (() => {}));
}
