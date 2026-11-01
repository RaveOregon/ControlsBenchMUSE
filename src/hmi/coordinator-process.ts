// Parent-side handle for the H2 simulation coordinator child process (scripts/hmi-h2-coordinator.js).
// Separate event loops: nothing the HMI, portal or capture does in the parent can delay the
// coordinator's 10 Hz commits and heartbeat.

import { fork, type ChildProcess } from "node:child_process";
import { constants, getPriority, setPriority } from "node:os";
import { fileURLToPath } from "node:url";

type Reply = { id: number; ok: boolean; value?: unknown; error?: string };
type Notice = { event: string; message?: string; pid?: number };

export class CoordinatorProcess {
  readonly child: ChildProcess;
  failure?: string;
  /** OS scheduling priority applied to the coordinator (above normal when the OS allows it). */
  priority?: number | string;
  unexpectedFault?: string;
  #next = 0;
  #pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  #ready: Promise<void>;
  #exited = false;

  constructor(options: { dir: string; env: Record<string, string | undefined>; fake?: boolean; script?: string }) {
    const script = options.script ?? fileURLToPath(new URL("../../scripts/hmi-h2-coordinator.js", import.meta.url));
    this.child = fork(script, options.fake ? ["--fake"] : [], { env: { ...options.env, H2_DIR: options.dir }, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    // The coordinator is the bench's timing-critical writer: favour it over HMI, portal and capture work.
    try { setPriority(this.child.pid!, constants.priority.PRIORITY_ABOVE_NORMAL); this.priority = getPriority(this.child.pid!); }
    catch (error) { this.priority = `unchanged (${error instanceof Error ? error.message : String(error)})`; }
    let readyResolve!: () => void, readyReject!: (e: Error) => void;
    this.#ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    this.#ready.catch(() => {}); // surfaced through call() and failure
    this.child.on("message", (m: Reply | Notice) => {
      if ("id" in m && typeof m.id === "number") {
        const p = this.#pending.get(m.id); if (!p) return;
        this.#pending.delete(m.id); clearTimeout(p.timer);
        if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error ?? "coordinator error"));
        return;
      }
      const n = m as Notice;
      if (n.event === "ready") readyResolve();
      if (n.event === "failure") this.failure = n.message ?? "coordinator failure";
      if (n.event === "unexpected-fault") this.unexpectedFault = n.message ?? "unexpected fault";
    });
    this.child.on("exit", code => {
      this.#exited = true;
      if (!this.failure && code !== 0) this.failure = `coordinator process exited (${code})`;
      readyReject(new Error("coordinator process exited before ready"));
      for (const p of this.#pending.values()) { clearTimeout(p.timer); p.reject(new Error("coordinator process exited")); }
      this.#pending.clear();
    });
  }

  get exited(): boolean { return this.#exited; }

  async call<T = unknown>(op: string, payload: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    await this.#ready;
    if (this.#exited) throw new Error("coordinator process has exited");
    const id = ++this.#next;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(`coordinator ${op} exceeded ${timeoutMs} ms`)); }, timeoutMs);
      this.#pending.set(id, { resolve: v => resolve(v as T), reject, timer });
      this.child.send({ id, op, ...payload });
    });
  }

  /** Stops the world and closes the coordinator session, then ends the process. Never resets the PLC. */
  async close(reason: string): Promise<void> {
    if (this.#exited) return;
    try { await this.call("stop", { reason }, 20_000); } catch { /* report below via exit */ }
    this.child.disconnect?.();
    await new Promise<void>(resolve => { if (this.#exited) resolve(); else { const t = setTimeout(() => { this.child.kill(); resolve(); }, 5000); this.child.once("exit", () => { clearTimeout(t); resolve(); }); } });
  }
}
