// Offline M8 transport for the isolated Wonder child. Protocol fixture only: it is never an oracle
// for M8 conveyor behavior. On top of ProtocolTransport it adds what the boundary tests need:
// scan counters that advance with each acknowledged commit, scripted values, and write
// delays/hangs, all driven from the test through the child's offline-only `fixture` op.
import { ProtocolTransport } from "./m8-protocol-transport.ts";
import { byLogical, signalByLeaf } from "../../src/live/m8-map.ts";
import type { RawValue } from "../../src/proof/contracts.ts";

type Stall = { match?: string; ms?: number; release?: () => void; started?: boolean };
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const bump = (value: RawValue, by: bigint) => String(BigInt(String(value ?? "0")) + by);

export class ChildFixtureTransport extends ProtocolTransport {
  #stall?: Stall;
  #hang?: Stall;
  started: { atMs: number; paths: string[] }[] = [];
  settled: { atMs: number; paths: string[] }[] = [];
  async write(items: { path: string; value: RawValue }[]): Promise<void> {
    const paths = items.map(i => i.path);
    this.started.push({ atMs: performance.now(), paths });
    const matches = (s?: Stall) => s && !s.started && (!s.match || paths.some(p => p.includes(s.match!)));
    if (matches(this.#stall)) { const stall = this.#stall!; stall.started = true; this.#stall = undefined; await sleep(stall.ms!); }
    if (matches(this.#hang)) { const hang = this.#hang!; hang.started = true; await new Promise<void>(resolve => { hang.release = resolve; }); }
    await super.write(items);
    this.settled.push({ atMs: performance.now(), paths });
    if (items.some(i => i.path === "GVL_BenchWrite.RequestedSequence" && i.value !== "0")) {
      // One modeled scan per acknowledged commit, so held commits show PLC time advancing.
      for (const leaf of ["PlcCycle", "OutputCaptureCycle"]) this.values[signalByLeaf(leaf).iecPath] = bump(this.values[signalByLeaf(leaf).iecPath], 1n);
      for (const leaf of ["PlcTimeUs", "OutputCaptureTimeUs"]) this.values[signalByLeaf(leaf).iecPath] = bump(this.values[signalByLeaf(leaf).iecPath], 100_000n);
    }
  }
  control(command: Record<string, unknown>): unknown {
    switch (command.action) {
      case "rejectCommand": this.rejectedCommands.add(String(command.name)); return { rejectedCommand: command.name };
      case "acceptCommand": this.rejectedCommands.delete(String(command.name)); return { acceptedCommand: command.name };
      case "stats": return { opens: this.opens, closes: this.closes, completedWrites: this.writes.length, started: this.started.length, settled: this.settled.length,
        lastStarted: this.started.at(-1) ?? null, hangActive: !!this.#hang?.started && !!this.#hang.release,
        plcCycle: this.values[signalByLeaf("PlcCycle").iecPath], simRequest: this.values["GVL_BenchWrite.SimRequest"], simApplied: this.values["GVL_BenchRead.SimApplied"] };
      case "set": {
        const path = byLogical.get(String(command.signal))?.iecPath ?? String(command.signal);
        this.values[path] = command.value as RawValue; return { path, value: command.value };
      }
      case "delayNextWrite": this.#stall = { ms: Number(command.ms), ...(command.match ? { match: String(command.match) } : {}) }; return { armed: "delay" };
      case "hangNextWrite": this.#hang = { ...(command.match ? { match: String(command.match) } : {}) }; return { armed: "hang" };
      case "releaseHang": { const release = this.#hang?.release; this.#hang = undefined; release?.(); return { released: !!release }; }
      case "writesSince": return this.started.filter(w => w.atMs >= Number(command.atMs)).map(w => w.paths);
    }
    throw new Error(`Unknown fixture command ${String(command.action)}`);
  }
}
export function createTransport(options: { boot?: string } = {}): ChildFixtureTransport {
  const transport = new ChildFixtureTransport();
  if (options.boot) transport.boot = options.boot;
  return transport;
}
