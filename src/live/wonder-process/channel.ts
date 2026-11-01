// Parent-side IPC channel to the isolated Wonder child (scripts/wonder-process-child.js).
// Stream rule: records must arrive exactly once, in order, from the one child session.
// - seq === last + 1: ingest.
// - seq <= last with byte-identical content: a duplicate; dropped and journaled.
// - seq <= last with different content, seq > last + 1 (missing or reordered), a foreign nonce,
//   or a reply whose throughSeq is ahead of the ingested stream: integrity fault. Nothing after
//   the fault is ingested; there is no reassembly, replay or retry.
import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { constants, getPriority, setPriority } from "node:os";
import { fileURLToPath } from "node:url";
import { canonical } from "../../campaign/ledger.ts";
import type { ChildIdentity, ChildMessage, FailureOutcome, StreamRecord } from "./protocol.ts";

export class ChannelFailure extends Error {
  readonly outcome: FailureOutcome;
  constructor(outcome: FailureOutcome, message: string) { super(message); this.outcome = outcome; }
}
export interface Reply<T> { value: T; boundaryRevision: number; throughSeq: number }
export interface ChannelOptions {
  offline: boolean;
  env: NodeJS.ProcessEnv;
  journalDirectory?: string;
  onRecord(record: StreamRecord, seq: number): void;
  onIntegrity(message: string): void;
  onExit(code: number | null, signal: NodeJS.Signals | null): void;
  onBoundary(revision: number): void;
  knownCampaignRevision(): number;
  pingMs?: number;
  script?: string;
}
const RECENT = 512;

export class WonderProcessChannel {
  readonly child: ChildProcess;
  readonly options: ChannelOptions;
  identity?: ChildIdentity;
  priority?: number | string;
  lastSeq = 0;
  duplicates = 0;
  integrityFault?: string;
  exited = false;
  exit?: { code: number | null; signal: NodeJS.Signals | null };
  #next = 0;
  #pending = new Map<number, { op: string; sentAt: number; resolve: (r: Reply<any>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  #recent = new Map<number, string>();
  #ready: Promise<ChildIdentity>;
  #ping?: ReturnType<typeof setInterval>;
  #exitWaiters = new Set<() => void>();

  constructor(options: ChannelOptions) {
    this.options = options;
    if (options.journalDirectory) mkdirSync(options.journalDirectory, { recursive: true });
    const script = options.script ?? fileURLToPath(new URL("../../../scripts/wonder-process-child.js", import.meta.url));
    // Detached: on Windows a non-detached child sits in libuv's kill-on-close job and would be
    // terminated with the host, mid-write, without its drain. Detached, a lost parent closes the
    // IPC channel and the child holds the world, drains bounded work and closes the session.
    this.child = fork(script, options.offline ? ["--offline"] : [], { env: options.env, stdio: ["ignore", "inherit", "inherit", "ipc"], serialization: "json", detached: true, windowsHide: true });
    // The child is the bench's timing-critical writer: favour it over host, model and capture work.
    try { setPriority(this.child.pid!, constants.priority.PRIORITY_ABOVE_NORMAL); this.priority = getPriority(this.child.pid!); }
    catch (error) { this.priority = `unchanged (${error instanceof Error ? error.message : String(error)})`; }
    let readyResolve!: (identity: ChildIdentity) => void, readyReject!: (error: Error) => void;
    this.#ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    this.#ready.catch(() => {});
    this.child.on("message", (m: ChildMessage) => {
      if (!m || typeof m !== "object") return;
      if (m.type === "ready") { this.identity = m.identity; this.journal({ kind: "child.ready", identity: m.identity, priority: this.priority }); readyResolve(m.identity); return; }
      if (m.type === "stream") return this.#stream(m);
      if (m.type === "reply") return this.#reply(m);
    });
    const exited = (code: number | null, signal: NodeJS.Signals | null) => {
      if (this.exited) return;
      this.exited = true; this.exit = { code, signal };
      if (this.#ping) clearInterval(this.#ping);
      this.journal({ kind: "child.exit", code, signal, lastSeq: this.lastSeq });
      readyReject(new ChannelFailure("inconclusive", `Isolated child exited before ready (${code ?? signal})`));
      for (const [id, p] of this.#pending) { clearTimeout(p.timer); p.reject(new ChannelFailure("inconclusive", `Isolated child exited (${code ?? signal}) during ${p.op}; outcome unknown`)); this.#pending.delete(id); }
      for (const waiter of this.#exitWaiters) waiter();
      options.onExit(code, signal);
    };
    this.child.on("exit", exited);
    this.child.on("error", error => { this.journal({ kind: "child.error", message: error.message }); if (this.child.exitCode !== null || !this.child.connected) exited(this.child.exitCode, null); });
    this.#ping = setInterval(() => this.#send({ type: "ping", knownCampaignRevision: options.knownCampaignRevision() }), options.pingMs ?? 250);
    this.#ping.unref();
  }

  ready(timeoutMs = 20_000): Promise<ChildIdentity> {
    return Promise.race([this.#ready, new Promise<never>((_, reject) => setTimeout(() => reject(new ChannelFailure("timed_out", `Isolated child not ready within ${timeoutMs} ms`)), timeoutMs).unref())]);
  }

  async request<T = unknown>(op: string, args: Record<string, unknown>, timeoutMs: number): Promise<Reply<T>> {
    await this.ready();
    if (this.exited) throw new ChannelFailure("inconclusive", "Isolated child has exited");
    if (this.integrityFault && !["hold", "status", "close"].includes(op)) throw new ChannelFailure("stale", `Process boundary integrity fault: ${this.integrityFault}`);
    const id = ++this.#next;
    return new Promise<Reply<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        this.journal({ kind: "request.deadline", id, op, timeoutMs });
        reject(new ChannelFailure("timed_out", `Isolated child ${op} reply exceeded ${timeoutMs} ms; its outcome is unknown`));
      }, timeoutMs);
      this.#pending.set(id, { op, sentAt: performance.now(), resolve, reject, timer });
      this.journal({ kind: "request", id, op, ...summarize(op, args) });
      if (!this.#send({ type: "request", id, op, args, knownCampaignRevision: this.options.knownCampaignRevision() })) {
        clearTimeout(timer); this.#pending.delete(id);
        reject(new ChannelFailure("inconclusive", `Could not send ${op} to the isolated child; outcome unknown`));
      }
    });
  }

  /** Close the session in the child, disconnect, and wait for the process to end (kill at the deadline). */
  async close(reason: string, timeoutMs: number): Promise<{ summary?: unknown; error?: string; exit?: WonderProcessChannel["exit"]; killed: boolean }> {
    if (this.#ping) clearInterval(this.#ping);
    let summary: unknown, error: string | undefined, killed = false;
    if (!this.exited) {
      try { summary = (await this.request("close", { reason }, timeoutMs)).value; }
      catch (e) { error = e instanceof Error ? e.message : String(e); }
      try { if (this.child.connected) this.child.disconnect(); } catch { /* already gone */ }
      killed = !(await this.waitForExit(5000));
      if (killed) { this.child.kill(); await this.waitForExit(5000); }
    }
    this.journal({ kind: "closed", reason, summary, error, exit: this.exit, killed });
    return { ...(summary !== undefined ? { summary } : {}), ...(error ? { error } : {}), exit: this.exit, killed };
  }

  waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.exited) return Promise.resolve(true);
    return new Promise(resolve => {
      const done = (value: boolean) => { clearTimeout(timer); this.#exitWaiters.delete(waiter); resolve(value); };
      const waiter = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      this.#exitWaiters.add(waiter);
    });
  }

  journal(entry: Record<string, unknown>): void {
    if (!this.options.journalDirectory) return;
    try { appendFileSync(join(this.options.journalDirectory, "parent-boundary.jsonl"), JSON.stringify({ atIso: new Date().toISOString(), atMonotonicMs: performance.now(), ...entry }) + "\n"); }
    catch { /* journal is best effort; the ledger is authoritative */ }
  }

  #send(message: unknown): boolean {
    try { if (!this.child.connected) return false; this.child.send(message as never); return true; } catch { return false; }
  }

  #fault(message: string): void {
    if (this.integrityFault) return;
    this.integrityFault = message;
    this.journal({ kind: "integrity.fault", message, lastSeq: this.lastSeq });
    this.options.onIntegrity(message);
  }

  #stream(m: Extract<ChildMessage, { type: "stream" }>): void {
    if (this.integrityFault) { this.journal({ kind: "stream.ignored_after_fault", seq: m.seq, recordKind: m.record?.kind }); return; }
    if (!this.identity || m.nonce !== this.identity.nonce) return this.#fault(`Stream record ${m.seq} from an unknown child session`);
    const digest = createHash("sha256").update(canonical(m.record)).digest("hex");
    if (m.seq <= this.lastSeq) {
      if (this.#recent.get(m.seq) === digest) { this.duplicates++; this.journal({ kind: "stream.duplicate_dropped", seq: m.seq, recordKind: m.record.kind }); return; }
      return this.#fault(`Conflicting or out-of-window record for stream seq ${m.seq} (ingested through ${this.lastSeq})`);
    }
    if (m.seq !== this.lastSeq + 1) return this.#fault(`Source stream gap or reorder: expected seq ${this.lastSeq + 1}, received ${m.seq}; nothing after seq ${this.lastSeq} is ingested`);
    this.lastSeq = m.seq; this.#recent.set(m.seq, digest);
    if (this.#recent.size > RECENT) this.#recent.delete(this.#recent.keys().next().value!);
    try { this.options.onRecord(m.record, m.seq); }
    catch (error) { this.#fault(`Ingestion of ${m.record.kind} record seq ${m.seq} failed: ${error instanceof Error ? error.message : String(error)}`); }
    const revision = (m.record as { boundaryRevision?: unknown }).boundaryRevision ?? (m.record as { detail?: { boundaryRevision?: unknown } }).detail?.boundaryRevision;
    if (Number.isSafeInteger(revision)) this.options.onBoundary(revision as number);
  }

  #reply(m: Extract<ChildMessage, { type: "reply" }>): void {
    const p = this.#pending.get(m.id);
    this.journal({ kind: "reply", id: m.id, op: p?.op ?? "late", ok: m.ok, ...(m.ok ? {} : { outcome: m.outcome, message: m.message }),
      boundaryRevision: m.boundaryRevision, throughSeq: m.throughSeq, elapsedMs: p ? Math.round(performance.now() - p.sentAt) : undefined });
    if (!this.integrityFault && m.throughSeq > this.lastSeq) this.#fault(`Reply ${m.id} (${p?.op ?? "late"}) overtook the stream: child sent through seq ${m.throughSeq}, ingested ${this.lastSeq}`);
    if (!p) return;
    this.#pending.delete(m.id); clearTimeout(p.timer);
    if (!this.integrityFault) this.options.onBoundary(m.boundaryRevision);
    if (this.integrityFault && !["hold", "status", "close"].includes(p.op)) { p.reject(new ChannelFailure("stale", `Process boundary integrity fault: ${this.integrityFault}; ${p.op} outcome not ingested`)); return; }
    if (m.ok) p.resolve({ value: m.value, boundaryRevision: m.boundaryRevision, throughSeq: m.throughSeq });
    else p.reject(new ChannelFailure(m.outcome, m.message));
  }
}

function summarize(op: string, args: Record<string, unknown>): Record<string, unknown> {
  const keep = ["actionId", "name", "action", "campaignRevision", "boundaryRevision", "leaseId", "policy", "automatic", "stopClock", "reason", "stream", "kind"];
  const out: Record<string, unknown> = {};
  for (const key of keep) if (Object.hasOwn(args, key)) out[key] = args[key];
  if (op === "apply") out.controlId = (args.control as { id?: unknown } | undefined)?.id;
  return out;
}
