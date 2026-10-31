export interface Clock {
  now(): number;
  iso(): string;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}
export const systemClock: Clock = {
  now: () => performance.now(), iso: () => new Date().toISOString(),
  setTimer: (callback, ms) => setTimeout(callback, ms), clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>)
};
export class ManualClock implements Clock {
  #now = 0; #id = 0; #timers = new Map<number, { at: number; callback: () => void }>();
  now() { return this.#now; }
  iso() { return new Date(Date.UTC(2026, 9, 31) + this.#now).toISOString(); }
  setTimer(callback: () => void, ms: number) { const id = ++this.#id; this.#timers.set(id, { at: this.#now + ms, callback }); return id; }
  clearTimer(timer: unknown) { this.#timers.delete(timer as number); }
  advance(ms: number) {
    this.#now += ms;
    for (const [id, timer] of [...this.#timers]) if (timer.at <= this.#now) { this.#timers.delete(id); timer.callback(); }
  }
}
export class DeadlineError extends Error { constructor() { super("Operation deadline exceeded"); } }
export function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, ms: number, clock: Clock, parent?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = clock.setTimer(() => { controller.abort(); done(new DeadlineError()); }, ms);
    const abort = () => { controller.abort(); done(new Error("Operation cancelled")); };
    let finished = false;
    function done(error?: unknown, value?: T) {
      if (finished) return; finished = true; clock.clearTimer(timer); parent?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value as T);
    }
    if (parent?.aborted) { abort(); return; }
    parent?.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => operation(controller.signal)).then(value => done(undefined, value), error => done(error));
  });
}
