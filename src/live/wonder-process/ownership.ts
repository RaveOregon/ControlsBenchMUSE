// Exclusive runtime ownership of the M8 write session (the shared main-checkout live.lock).
// Acquired by the child at Start, released only after its outstanding work drained. A lock that
// cannot be proven drained is retained for explicit reconciliation; nothing here deletes another
// owner's lock or a lock whose write outcome is uncertain.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface OwnershipRecord { owner: "wonder-process-v1"; campaignId: string; childPid: number; parentPid: number; nonce: string; acquiredAtIso: string }

export class ProcessOwnership {
  readonly path: string;
  #fd?: number;
  #record?: OwnershipRecord;
  constructor(path: string) { this.path = resolve(path); }
  get held(): boolean { return this.#fd !== undefined; }
  acquire(record: Omit<OwnershipRecord, "owner" | "acquiredAtIso">): OwnershipRecord {
    if (this.#fd !== undefined) throw new Error("Ownership already held by this process");
    mkdirSync(dirname(this.path), { recursive: true });
    let fd: number;
    try { fd = openSync(this.path, "wx"); }
    catch (error) {
      const current = existsSync(this.path) ? readFileSync(this.path, "utf8").trim().slice(0, 400) : "";
      throw new Error(`Runtime ownership is held (${this.path}${current ? `: ${current}` : ""}); no PLC contact made. Reconcile the previous owner explicitly; do not delete the lock to retry`, { cause: error });
    }
    const full: OwnershipRecord = { owner: "wonder-process-v1", ...record, acquiredAtIso: new Date().toISOString() };
    writeSync(fd, JSON.stringify(full) + "\n");
    this.#fd = fd; this.#record = full;
    return full;
  }
  /** Releases only our own lock. Returns a description of what happened. */
  release(): "released" | "not_held" | "replaced" {
    if (this.#fd === undefined) return "not_held";
    closeSync(this.#fd); this.#fd = undefined;
    const ours = this.#record!; this.#record = undefined;
    let current: Partial<OwnershipRecord> | undefined;
    try { current = JSON.parse(readFileSync(this.path, "utf8")); } catch { current = undefined; }
    if (current?.nonce !== ours.nonce) return "replaced";
    unlinkSync(this.path);
    return "released";
  }
  /** Keep the lock file on disk (uncertain outcome) but stop holding the descriptor. */
  retain(): void { if (this.#fd !== undefined) { closeSync(this.#fd); this.#fd = undefined; } }
}
