// Child-side guard around the M8 transport. It tracks every write until the transport settles it
// and, once the session is quarantined, refuses all later writes. The M8 connector's own serial
// queue would otherwise run a queued operation after a timed-out write eventually succeeds.
import type { M8Sample, M8Transport } from "../m8-opcua.ts";
import type { RawValue } from "../../proof/contracts.ts";
import type { UncertainWrite } from "./protocol.ts";

interface Outstanding { paths: string[]; startedAtIso: string; startedAtMs: number }

export class WriteGate implements M8Transport {
  readonly inner: M8Transport;
  #refusal?: string;
  #next = 0;
  #outstanding = new Map<number, Outstanding>();
  #settled = new Set<() => void>();
  onSettledAfterRefusal?: (write: { paths: string[]; outcome: "completed" | "failed"; message?: string; heldMs: number }) => void;
  constructor(inner: M8Transport) { this.inner = inner; }
  get refused(): boolean { return this.#refusal !== undefined; }
  /** Writes still owned by the transport. After a timeout their PLC effect is unknown. */
  outstanding(): UncertainWrite[] {
    const now = performance.now();
    return [...this.#outstanding.values()].map(w => ({ paths: [...w.paths], startedAtIso: w.startedAtIso, ageMs: Math.round(now - w.startedAtMs) }));
  }
  /** Permanently refuse further writes; nothing is retried or replayed. */
  refuse(reason: string): void { this.#refusal ??= reason; }
  open(): Promise<void> { return this.inner.open(); }
  read(paths: string[]): Promise<Record<string, M8Sample>> { return this.inner.read(paths); }
  async write(items: { path: string; value: RawValue }[]): Promise<void> {
    if (this.#refusal) throw new Error(`Write refused: ${this.#refusal}; no later write after an uncertain one`);
    const id = ++this.#next, paths = items.map(i => i.path);
    this.#outstanding.set(id, { paths, startedAtIso: new Date().toISOString(), startedAtMs: performance.now() });
    let outcome: "completed" | "failed" = "completed", message: string | undefined;
    try { await this.inner.write(items); }
    catch (error) { outcome = "failed"; message = error instanceof Error ? error.message : String(error); throw error; }
    finally {
      const w = this.#outstanding.get(id)!; this.#outstanding.delete(id);
      if (this.#refusal) this.onSettledAfterRefusal?.({ paths, outcome, ...(message ? { message } : {}), heldMs: Math.round(performance.now() - w.startedAtMs) });
      if (!this.#outstanding.size) for (const resolve of this.#settled) resolve();
    }
  }
  /** Resolves true when no write is outstanding, false at the deadline. */
  drained(timeoutMs: number): Promise<boolean> {
    if (!this.#outstanding.size) return Promise.resolve(true);
    return new Promise(resolve => {
      const done = (value: boolean) => { clearTimeout(timer); this.#settled.delete(settle); resolve(value); };
      const settle = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      this.#settled.add(settle);
    });
  }
  close(): Promise<void> { return this.inner.close(); }
}
