import { closeSync, existsSync, fsyncSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";

/** Exclusive campaign owner plus append-only conservative charges. A crash keeps lock and charges. */
export class DurableSessionAccount {
  #lock: number; #closed = false;
  readonly path: string; readonly campaignId: string;
  readonly hardUsd: number;
  spentUsd = 0;
  constructor(path: string, campaignId: string, hardUsd = 15) {
    if (!Number.isInteger(hardUsd) || hardUsd < 1 || hardUsd > 150) throw new Error("Invalid durable session allowance");
    this.hardUsd = hardUsd;
    this.path = path; this.campaignId = campaignId; this.#lock = openSync(`${path}.lock`, "wx");
    // Invalid/incomplete accounting is deliberately fail-closed with lock retained for reconciliation.
    if (existsSync(path)) {
      const text = readFileSync(path, "utf8");
      if (text && !text.endsWith("\n")) throw new Error("Incomplete durable session charge; reconcile account and lock");
      for (const line of text.trim() ? text.trim().split("\n") : []) {
        const record = JSON.parse(line);
        if (!Number.isInteger(record.costUsd) || record.costUsd < 1 || record.costUsd > 5 || record.totalUsd !== this.spentUsd + record.costUsd) throw new Error("Invalid durable session account; reconcile lock");
        this.spentUsd = record.totalUsd;
      }
    }
  }
  charge(requestId: string, costUsd = 1): void {
    if (!Number.isInteger(costUsd) || costUsd < 1 || costUsd > 5) throw new Error("Invalid conservative request reservation");
    if (this.#closed || this.spentUsd + costUsd > this.hardUsd) throw new Error(`Durable $${this.hardUsd} session hard stop`);
    const fd = openSync(this.path, "a");
    try { const bytes = Buffer.from(JSON.stringify({ campaignId: this.campaignId, requestId, costUsd, totalUsd: this.spentUsd + costUsd,
      basis: "conservative_reservation", atIso: new Date().toISOString() }) + "\n");
      let offset = 0; while (offset < bytes.length) { const n = writeSync(fd, bytes, offset, bytes.length - offset); if (!n) throw new Error("Session write stalled"); offset += n; }
      fsyncSync(fd); this.spentUsd += costUsd;
    } finally { closeSync(fd); }
  }
  close(): void { if (!this.#closed) { this.#closed = true; closeSync(this.#lock); unlinkSync(`${this.path}.lock`); } }
}
