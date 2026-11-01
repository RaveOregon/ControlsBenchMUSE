// Append-only, hash-chained HMI evidence journal. One file per HMI service session; it refuses
// to append to an existing file. Each record cites its predecessor's hash so edits are detectable.

import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export interface JournalRecord { sequence: number; atIso: string; type: string; data: Record<string, unknown>; previousHash: string; hash: string }

const GENESIS = "0".repeat(64);
const digest = (r: Omit<JournalRecord, "hash">) => createHash("sha256").update(JSON.stringify([r.sequence, r.atIso, r.type, r.data, r.previousHash])).digest("hex");

export class HmiJournal {
  readonly file?: string;
  #fd?: number;
  #sequence = 0;
  #previous = GENESIS;
  readonly #nowIso: () => string;
  readonly tail: JournalRecord[] = [];
  readonly #tailLimit: number;

  constructor(options: { file?: string; nowIso?: () => string; tailLimit?: number } = {}) {
    this.file = options.file;
    this.#nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.#tailLimit = options.tailLimit ?? 500;
    if (this.file) { mkdirSync(dirname(this.file), { recursive: true }); this.#fd = openSync(this.file, "wx"); }
  }

  append(type: string, data: Record<string, unknown>): JournalRecord {
    const base = { sequence: ++this.#sequence, atIso: this.#nowIso(), type, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>, previousHash: this.#previous };
    const record: JournalRecord = { ...base, hash: digest(base) };
    this.#previous = record.hash;
    if (this.#fd !== undefined) writeSync(this.#fd, `${JSON.stringify(record)}\n`);
    this.tail.push(record);
    if (this.tail.length > this.#tailLimit) this.tail.shift();
    return record;
  }

  /** Stable evidence reference for a record. */
  static ref(record: JournalRecord): string { return `hmi-journal:${record.sequence}:${record.hash.slice(0, 12)}`; }

  close(): void { if (this.#fd !== undefined) { closeSync(this.#fd); this.#fd = undefined; } }
}

/** Verifies sequence continuity and the hash chain of a saved journal. */
export function verifyJournal(file: string): { records: number; ok: true } {
  let previous = GENESIS, sequence = 0;
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    const r = JSON.parse(line) as JournalRecord;
    if (r.sequence !== ++sequence) throw new Error(`Journal sequence gap at ${sequence}`);
    if (r.previousHash !== previous) throw new Error(`Journal chain broken at ${r.sequence}`);
    if (digest(r) !== r.hash) throw new Error(`Journal hash mismatch at ${r.sequence}`);
    previous = r.hash;
  }
  return { records: lines.length, ok: true };
}
