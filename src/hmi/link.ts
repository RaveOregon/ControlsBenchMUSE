// PLC observation link for the operator HMI. Owns one M8 transport session, polls one batched
// read at a fixed interval (no overlap, no catch-up burst), and serialises operator writes and
// acknowledgement reads with the polls. Freshness means "a good read succeeded recently"; an
// unchanged value never becomes stale merely because it did not transition.

import type { M8Sample, M8Transport, TransportEvent } from "../live/m8-opcua.ts";
import type { RawValue } from "../proof/contracts.ts";
import type { LinkState, LinkView, SampleView, Scalar, SnapshotView } from "./protocol.ts";
import { HMI_WRITE_ALLOWLIST, P, hmiReadPaths } from "./signals.ts";
import type { HmiJournal } from "./journal.ts";

export type TransportFactory = (event: TransportEvent) => M8Transport;

export interface PlcLinkOptions {
  transportFactory: TransportFactory;
  journal: HmiJournal;
  endpoint: string;
  securityMode?: string;
  securityPolicy?: string;
  userConfigured?: boolean;
  pollIntervalMs?: number;
  /** Data age at which the link is shown stale. Default max(1500, 4 x interval). */
  staleAfterMs?: number;
  failuresBeforeReconnect?: number;
  /** Nodes per OPC UA Read request. CODESYS rejects large batches with BadTooManyOperations (103 failed; 72 passes). */
  maxNodesPerRead?: number;
  backoffMs?: number[];
  /** Operator write timeout. Default 5 s. A write that outlives it quarantines operator writes. */
  writeTimeoutMs?: number;
  /** After a write timeout, how long nothing else is issued on the session before it is closed. Default 10 s. */
  writeDrainMs?: number;
  nowMs?: () => number;
  onSnapshot?: (snapshot: SnapshotView, previous?: SnapshotView) => void;
  onBootChange?: (from: string, to: string) => void;
  onChange?: () => void;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const AUTH_FAILURE = /BadUserAccessDenied|BadIdentityToken|BadSecurityChecksFailed|BadCertificate/i;
// Deterministic request-shape rejections: a new session cannot fix them, so do not loop on reconnects.
const REQUEST_REJECTED = /BadTooManyOperations/i;

/** A write whose transport operation outlived its timeout. It was not cancelled and may still land. */
export class WriteUnsettledError extends Error {
  readonly paths: string[];
  constructor(paths: string[], timeoutMs: number) { super(`Write to ${paths.join(", ")} did not complete within ${timeoutMs} ms`); this.paths = paths; }
}

export class PlcLink {
  readonly journal: HmiJournal;
  readonly #factory: TransportFactory;
  readonly #options: PlcLinkOptions;
  readonly #now: () => number;
  #transport?: M8Transport;
  #tail: Promise<unknown> = Promise.resolve();
  #generation = 0;
  #view: LinkView;
  #latest?: SnapshotView;
  #latencies: number[] = [];
  #staleTimer?: ReturnType<typeof setInterval>;
  #lastWrite: Array<{ path: string; value: Scalar; status: string }> = [];
  #pollSequence = 0;
  #lastOkMs?: number;
  /** Reference for the scan check: compared only across >= 100 ms so two reads inside one 20 ms PLC cycle never look frozen. */
  #scanRef?: { cycle: string; atMs: number };
  #stopped = false;
  #wake?: () => void;
  /** Holds the queue after a write timeout until that write settles or the drain deadline passes. */
  #draining?: Promise<void>;
  #quarantineSettledMs?: number;

  constructor(options: PlcLinkOptions) {
    this.#options = options; this.#factory = options.transportFactory; this.journal = options.journal;
    this.#now = options.nowMs ?? (() => Date.now());
    const interval = options.pollIntervalMs ?? 250;
    this.#view = { state: "connecting", detail: "Not started", endpoint: options.endpoint, securityMode: options.securityMode ?? "SignAndEncrypt",
      securityPolicy: options.securityPolicy ?? "Basic256Sha256", userConfigured: options.userConfigured ?? false, pollIntervalMs: interval,
      staleAfterMs: options.staleAfterMs ?? Math.max(1500, 4 * interval), totalPolls: 0, failedPolls: 0, consecutiveFailures: 0, reconnects: 0, plcScanning: null };
  }

  get view(): LinkView { return { ...this.#view }; }
  get latest(): SnapshotView | undefined { return this.#latest; }
  get connected(): boolean { return !!this.#transport && (this.#view.state === "connected" || this.#view.state === "stale"); }
  /** A good read completed within the stale threshold. */
  get fresh(): boolean { return this.#view.state === "connected" && this.#lastOkMs !== undefined && this.#now() - this.#lastOkMs <= this.#view.staleAfterMs; }
  get lastWrite() { return this.#lastWrite.map(w => ({ ...w })); }
  get quarantine(): LinkView["quarantine"] { return this.#view.quarantine && { ...this.#view.quarantine }; }

  values(): Record<string, Scalar> {
    return Object.fromEntries(Object.entries(this.#latest?.values ?? {}).filter(([, s]) => s.good).map(([p, s]) => [p, s.value]));
  }

  /** Starts the next poll now (after a command acknowledgement, so the whole page reflects the new PLC state). */
  pollSoon(): void { this.#wake?.(); }

  /** Changes the poll rate. Without an explicit staleAfterMs the stale threshold follows it, and a faster rate applies at once. */
  setPollInterval(ms: number): void {
    if (ms === this.#view.pollIntervalMs) return;
    const faster = ms < this.#view.pollIntervalMs;
    this.journal.append("link.poll_interval", { from: this.#view.pollIntervalMs, to: ms });
    this.#view.pollIntervalMs = ms;
    if (this.#options.staleAfterMs === undefined) this.#view.staleAfterMs = Math.max(1500, 4 * ms);
    if (faster) this.pollSoon();
    this.#options.onChange?.();
  }

  start(): void {
    this.#stopped = false;
    const generation = ++this.#generation;
    this.#staleTimer = setInterval(() => this.#checkStale(), 250);
    void this.#loop(generation);
  }

  async stop(): Promise<void> {
    this.#stopped = true; this.#generation++;
    if (this.#staleTimer) clearInterval(this.#staleTimer);
    await this.#closeTransport("HMI service stopping");
    this.#set("stopped", "HMI service stopped; no further observation.");
  }

  /**
   * Runs a transport operation in order with polls and other operations. A hung read fails visibly
   * after the timeout and the queue moves on. A hung write (writePaths given) is not cancelled by its
   * timeout: it may still land, so operator writes are quarantined and nothing further is issued on
   * the session until the write settles or the drain deadline closes the session.
   */
  serial<T>(operation: (transport: M8Transport) => Promise<T>, timeoutMs = 5000, writePaths?: string[]): Promise<T> {
    const result = this.#tail.then(() => {
      if (!this.#transport) throw new Error("PLC link not connected");
      const op = operation(this.#transport);
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!writePaths) return reject(new Error(`PLC operation exceeded ${timeoutMs} ms`));
          this.#quarantineWrite(op, writePaths, timeoutMs);
          reject(new WriteUnsettledError(writePaths, timeoutMs));
        }, timeoutMs);
        op.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
      });
    });
    this.#tail = result.catch(() => {}).then(() => this.#draining);
    return result;
  }

  /** Reads in batches of at most maxNodesPerRead nodes, in order, as one serialised operation. */
  async read(paths: string[]): Promise<Record<string, M8Sample>> {
    const size = this.#options.maxNodesPerRead ?? 60;
    return this.serial(async t => {
      const samples: Record<string, M8Sample> = {};
      for (let i = 0; i < paths.length; i += size) Object.assign(samples, await t.read(paths.slice(i, i + size)));
      return samples;
    });
  }

  /** Operator write. Refuses anything outside the four M8 operator request paths. */
  async write(items: { path: string; value: RawValue }[]): Promise<Array<{ path: string; value: Scalar; status: string }>> {
    for (const item of items) if (!HMI_WRITE_ALLOWLIST.has(item.path)) throw new Error(`HMI write refused outside operator allowlist: ${item.path}`);
    if (this.#view.quarantine) throw new Error(`HMI write refused: operator writes held (${this.#view.quarantine.reason})`);
    this.#lastWrite = [];
    await this.serial(t => t.write(items), this.#options.writeTimeoutMs ?? 5000, items.map(i => i.path));
    return this.lastWrite;
  }

  #quarantineWrite(op: Promise<unknown>, paths: string[], timeoutMs: number): void {
    this.#quarantineSettledMs = undefined;
    this.#view.quarantine = { reason: `write to ${paths.join(", ")} did not complete within ${timeoutMs} ms and may still land`,
      sinceIso: new Date(this.#now()).toISOString(), paths };
    this.journal.append("link.quarantined", this.#view.quarantine);
    const settled = op.then(() => "completed", e => `failed: ${e instanceof Error ? e.message : String(e)}`).then(settledAs => {
      this.#quarantineSettledMs = this.#now();
      if (this.#view.quarantine) this.#view.quarantine = { ...this.#view.quarantine, settledAtIso: new Date(this.#quarantineSettledMs).toISOString(), settledAs };
      this.journal.append("link.write_settled", { paths, settledAs });
      this.#options.onChange?.();
    });
    const drainMs = this.#options.writeDrainMs ?? 10_000;
    const expired = new Promise<boolean>(r => { const t = setTimeout(() => r(true), drainMs); t.unref?.(); });
    this.#draining = Promise.race([settled.then(() => false), expired]).then(async timedOut => {
      this.#draining = undefined;
      if (!timedOut) return;
      // Closing the session does not prove the write cannot land; the quarantine stays until it settles.
      this.journal.append("link.drain_expired", { paths, drainMs });
      await this.#closeTransport(`Outstanding write to ${paths.join(", ")} did not settle within ${drainMs} ms`);
    });
    this.#options.onChange?.();
  }

  #transportEvent: TransportEvent = (kind, data) => {
    if (kind === "opc.read") return; // derived snapshots are journaled instead
    if (kind === "opc.write") {
      const items = (data.items as Array<{ path: string; value: Scalar; status: string }> | undefined) ?? [];
      this.#lastWrite = items.map(i => ({ path: i.path, value: i.value, status: String(i.status) }));
    }
    const recorded = kind === "symbols.resolved"
      ? { resolvedCount: (data.resolved as unknown[] | undefined)?.length ?? 0, readGroupWritableWarnings: data.readGroupWritableWarnings, writePolicy: data.writePolicy,
          nodeIds: Object.fromEntries(((data.resolved as Array<{ iecPath: string; nodeId: string }> | undefined) ?? []).map(r => [r.iecPath, r.nodeId])) }
      : data;
    this.journal.append(`transport.${kind}`, recorded);
  };

  async #loop(generation: number): Promise<void> {
    let attempt = 0;
    while (generation === this.#generation && !this.#stopped) {
      if (!this.#transport) {
        const opened = await this.#connect(generation, attempt);
        if (!opened) {
          if (this.#view.state === "disconnected") return; // authentication or explicit refusal: do not hammer
          const backoff = this.#options.backoffMs ?? [1000, 2000, 5000, 10_000, 15_000];
          await sleep(backoff[Math.min(attempt, backoff.length - 1)]); attempt++;
          continue;
        }
        attempt = 0;
      }
      const started = this.#now();
      await this.#poll(generation);
      const elapsed = this.#now() - started;
      await new Promise<void>(resolve => { const t = setTimeout(resolve, Math.max(0, this.#view.pollIntervalMs - elapsed)); this.#wake = () => { clearTimeout(t); resolve(); }; });
      this.#wake = undefined;
    }
  }

  async #connect(generation: number, attempt: number): Promise<boolean> {
    this.#set(attempt === 0 && this.#view.reconnects === 0 && !this.#view.sessionOpenedAtIso ? "connecting" : "reconnecting",
      `Opening OPC UA session to ${this.#options.endpoint}${attempt ? ` (attempt ${attempt + 1})` : ""}`);
    const transport = this.#factory(this.#transportEvent);
    try {
      await transport.open();
      if (generation !== this.#generation) { await transport.close().catch(() => {}); return false; }
      this.#transport = transport;
      if (this.#view.sessionOpenedAtIso) this.#view.reconnects++;
      this.#view.sessionOpenedAtIso = new Date(this.#now()).toISOString();
      this.#view.consecutiveFailures = 0; this.#view.lastError = undefined;
      this.journal.append("link.opened", { endpoint: this.#options.endpoint, reconnects: this.#view.reconnects });
      this.#set("connected", "Session open; awaiting first read");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await transport.close().catch(() => {});
      this.#view.lastError = message;
      this.journal.append("link.open_failed", { message, attempt });
      if (AUTH_FAILURE.test(message)) this.#set("disconnected", `PLC rejected the HMI credential or security (${message}). Restart the HMI service with the correct credential; no automatic retry.`);
      else this.#set("reconnecting", `Cannot open PLC session: ${message}. Retrying with backoff.`);
      return false;
    }
  }

  async #poll(generation: number): Promise<void> {
    const requestedMs = this.#now(), requestedAtIso = new Date(requestedMs).toISOString();
    this.#view.totalPolls++;
    try {
      const samples = await this.read(hmiReadPaths);
      if (generation !== this.#generation) return;
      const receivedMs = this.#now();
      const values: Record<string, SampleView> = {};
      for (const path of hmiReadPaths) {
        const s = samples[path];
        values[path] = s ? { value: s.value, status: s.status, good: s.status.startsWith("Good") && !!s.sourceTimestamp && !!s.serverTimestamp, sourceTimestamp: s.sourceTimestamp, serverTimestamp: s.serverTimestamp, receivedAtIso: s.receivedAtIso }
          : { value: null, status: "Missing", good: false, sourceTimestamp: "", serverTimestamp: "", receivedAtIso: new Date(receivedMs).toISOString() };
      }
      const latency = receivedMs - requestedMs;
      const snapshot: SnapshotView = { sequence: ++this.#pollSequence, requestedAtIso, receivedAtIso: new Date(receivedMs).toISOString(), latencyMs: latency,
        sameScanBracket: values[P.plcCycle]?.value !== null && values[P.plcCycle]?.value === values[P.outputCaptureCycle]?.value, values };
      const previous = this.#latest;
      this.#latencies.push(latency); if (this.#latencies.length > 200) this.#latencies.shift();
      const sorted = [...this.#latencies].sort((a, b) => a - b);
      Object.assign(this.#view, { lastPollOkAtIso: snapshot.receivedAtIso, lastPollLatencyMs: latency, p95PollLatencyMs: sorted[Math.floor(0.95 * (sorted.length - 1))], consecutiveFailures: 0 });
      this.#lastOkMs = receivedMs;
      if (values[P.plcCycle]?.good) {
        const cycle = String(values[P.plcCycle].value);
        if (!this.#scanRef) this.#scanRef = { cycle, atMs: receivedMs };
        else if (receivedMs - this.#scanRef.atMs >= 100) { this.#view.plcScanning = cycle !== this.#scanRef.cycle; this.#scanRef = { cycle, atMs: receivedMs }; }
      }
      const boot = values[P.boot]?.good ? String(values[P.boot].value) : undefined;
      if (boot && this.#view.bootIdentity && boot !== this.#view.bootIdentity) {
        const from = this.#view.bootIdentity;
        Object.assign(this.#view, { previousBootIdentity: from, bootChangedAtIso: snapshot.receivedAtIso });
        this.journal.append("link.boot_changed", { from, to: boot, observedAtIso: snapshot.receivedAtIso });
        this.#options.onBootChange?.(from, boot);
      }
      if (boot) this.#view.bootIdentity = boot;
      this.#latest = snapshot;
      if (this.#view.quarantine && this.#quarantineSettledMs !== undefined && requestedMs > this.#quarantineSettledMs) {
        this.journal.append("link.quarantine_cleared", { ...this.#view.quarantine, freshReadRequestedAtIso: requestedAtIso, snapshotSequence: snapshot.sequence });
        this.#view.quarantine = undefined;
      }
      this.#set("connected", this.#view.plcScanning === false ? "Reads succeed but PlcCycle is not advancing: the PLC application may not be scanning." : "Polling");
      this.#options.onSnapshot?.(snapshot, previous);
    } catch (error) {
      if (generation !== this.#generation) return;
      const message = error instanceof Error ? error.message : String(error);
      this.#view.failedPolls++; this.#view.consecutiveFailures++; this.#view.lastError = message;
      this.journal.append("link.poll_failed", { message, consecutiveFailures: this.#view.consecutiveFailures });
      if (REQUEST_REJECTED.test(message)) {
        await this.#closeTransport(`Server rejected the read request shape: ${message}`);
        this.#set("disconnected", `PLC server rejected the HMI read request (${message}). This is a configuration limit, not a lost link; no automatic retry.`);
        this.#generation++;
      } else if (this.#view.consecutiveFailures >= (this.#options.failuresBeforeReconnect ?? 3)) {
        await this.#closeTransport(`Read failed ${this.#view.consecutiveFailures} times: ${message}`);
        this.#set("reconnecting", `PLC link lost (${message}). Last values held and marked stale; reconnecting.`);
      } else this.#checkStale();
    }
  }

  #checkStale(): void {
    if (this.#view.state !== "connected" || this.#lastOkMs === undefined) return;
    const age = this.#now() - this.#lastOkMs;
    if (age > this.#view.staleAfterMs) this.#set("stale", `No good PLC read for ${Math.round(age)} ms (threshold ${this.#view.staleAfterMs} ms). Values held.`);
  }

  async #closeTransport(reason: string): Promise<void> {
    const transport = this.#transport; this.#transport = undefined;
    if (!transport) return;
    this.journal.append("link.closed", { reason });
    await transport.close().catch(() => {});
  }

  #set(state: LinkState, detail: string): void {
    // A successful poll after stale returns to connected; stale only from connected.
    const changed = state !== this.#view.state;
    this.#view.state = state; this.#view.detail = detail;
    if (changed) this.journal.append("link.state", { state, detail });
    this.#options.onChange?.();
  }
}
