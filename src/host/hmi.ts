// HMI observation hub: owns one controlled WebVisu capture session, its timestamped frames and
// engineer-input observations, and the stale/disconnected state shown by the portal tile.
//
// Pixels only ever come from an HmiCaptureSource that rendered the configured page. Nothing here
// reads OPC UA values or draws an HMI; with no source the state is `not_configured` and the
// portal shows "HMI not observed/tested".

import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolCall } from "../campaign/contracts.ts";
import { ToolFailure } from "../campaign/driver.ts";
import type { HmiAdapter } from "../campaign/driver.ts";
import type { HmiActionRef, HmiFrameRef, HmiSessionState, HmiSessionView } from "./protocol.ts";
export type { HmiActionRef } from "./protocol.ts";

export interface HmiFrameCapture {
  bytes: Uint8Array;
  contentType: string;
  requestedAtIso: string;
  capturedAtIso: string;
  /** URL the browser was actually displaying. */
  pageUrl: string;
}

/** Engineer input delivered to the controlled browser page. Key values are never recorded. */
export interface HmiInputObservation {
  kind: "pointer" | "key";
  atIso: string;
  x?: number;
  y?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  pageUrl: string;
}

export interface HmiSessionInfo { sessionId: string; browser: string }

export interface HmiCaptureSource {
  readonly id: string;
  readonly kind: "webvisu";
  readonly url: string;
  open(onInput: (input: HmiInputObservation) => void, onClosed: (reason: string) => void): Promise<HmiSessionInfo>;
  capture(): Promise<HmiFrameCapture>;
  close(): Promise<void>;
}

interface StoredFrame { ref: HmiFrameRef; bytes: Uint8Array }

export interface HmiHubOptions {
  captureIntervalMs?: number;
  staleAfterMs?: number;
  maxFramesInMemory?: number;
  /** When set, every frame and the session log are preserved here. */
  artifactDir?: string;
  nowIso?: () => string;
  onChange?: (view: HmiSessionView, change: { frame?: HmiFrameRef; action?: HmiActionRef }) => void;
  /** Explicit opt-in to the same controlled session's trusted action bridge. */
  agentAction?: HmiAdapter["perform"];
}

export function validateHmiUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("HMI URL must be a string");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("HMI URL must use http or https");
  if (url.username || url.password) throw new Error("Do not embed credentials in the HMI URL");
  return url.href;
}

export class HmiHub {
  readonly captureIntervalMs: number;
  readonly staleAfterMs: number;
  readonly #maxFrames: number;
  readonly #artifactDir?: string;
  readonly #nowIso: () => string;
  readonly #onChange?: HmiHubOptions["onChange"];
  readonly #agentAction?: HmiHubOptions["agentAction"];
  /** Set by the host to fan session changes out to portal clients. */
  onChangeListener?: HmiHubOptions["onChange"];
  #source?: HmiCaptureSource;
  #view: HmiSessionView;
  #frames = new Map<string, StoredFrame>();
  #frameSequence = 0;
  #actionSequence = 0;
  #awaitingFrame: HmiActionRef[] = [];
  #timer?: ReturnType<typeof setTimeout>;
  #staleTimer?: ReturnType<typeof setInterval>;
  #capturing?: Promise<HmiFrameRef>;
  #generation = 0;

  constructor(options: HmiHubOptions = {}) {
    this.captureIntervalMs = options.captureIntervalMs ?? 1000;
    this.staleAfterMs = options.staleAfterMs ?? Math.max(3000, 3 * this.captureIntervalMs);
    this.#maxFrames = options.maxFramesInMemory ?? 900;
    this.#artifactDir = options.artifactDir;
    this.#nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.#onChange = options.onChange;
    this.#agentAction = options.agentAction;
    this.#view = { state: "not_configured", recording: false, frameCount: 0, detail: "No HMI source configured. HMI not observed/tested.", changedAtIso: this.#nowIso() };
  }

  get view(): HmiSessionView { return structuredClone(this.#view); }
  get observing(): boolean { return this.#view.state === "observing"; }

  frame(sessionId: string, sequence: number): StoredFrame | undefined {
    return this.#frames.get(`hmi-frame:${sessionId}:${sequence}`);
  }

  #notify(view: HmiSessionView, change: { frame?: HmiFrameRef; action?: HmiActionRef }): void {
    this.#onChange?.(view, change);
    this.onChangeListener?.(view, change);
  }

  #set(state: HmiSessionState, detail: string, patch: Partial<HmiSessionView> = {}, change: { frame?: HmiFrameRef; action?: HmiActionRef } = {}): void {
    const changed = state !== this.#view.state || detail !== this.#view.detail;
    this.#view = { ...this.#view, ...patch, state, detail, changedAtIso: changed ? this.#nowIso() : this.#view.changedAtIso };
    this.#log({ type: "session", state, detail, atIso: this.#nowIso() });
    this.#notify(this.view, change);
  }

  async connect(source: HmiCaptureSource): Promise<HmiFrameRef> {
    await this.disconnect("Replaced by a new HMI source");
    const generation = ++this.#generation;
    this.#source = source;
    this.#frameSequence = 0; this.#actionSequence = 0; this.#awaitingFrame = [];
    this.#view = { state: "connecting", sourceId: source.id, sourceKind: source.kind, url: source.url, recording: false, frameCount: 0,
      captureIntervalMs: this.captureIntervalMs, staleAfterMs: this.staleAfterMs, detail: "Opening controlled browser session", changedAtIso: this.#nowIso() };
    this.#notify(this.view, {});
    try {
      const info = await source.open(input => this.#input(generation, input), reason => this.#closed(generation, reason));
      if (generation !== this.#generation) throw new Error("HMI source replaced while opening");
      this.#view = { ...this.#view, sessionId: info.sessionId, browser: info.browser, startedAtIso: this.#nowIso() };
      this.#log({ type: "session.opened", sourceId: source.id, url: source.url, sessionId: info.sessionId, browser: info.browser, atIso: this.#nowIso() });
      const first = await this.captureNow();
      this.#schedule(generation);
      this.#staleTimer = setInterval(() => this.#checkStale(), Math.min(1000, this.staleAfterMs));
      return first;
    } catch (error) {
      if (generation === this.#generation) {
        this.#set("error", `HMI session failed to open: ${error instanceof Error ? error.message : String(error)}`, { recording: false });
        await source.close().catch(() => {});
        this.#source = undefined;
      }
      throw error;
    }
  }

  async disconnect(reason = "Engineer disconnected HMI source"): Promise<void> {
    this.#generation++;
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#staleTimer) clearInterval(this.#staleTimer);
    this.#timer = undefined; this.#staleTimer = undefined;
    const source = this.#source; this.#source = undefined;
    if (!source) return;
    await source.close().catch(() => {});
    // The last frame stays visible under the disconnected overlay.
    this.#set("disconnected", `${reason}. Last frame held; no further observation.`, { recording: false });
  }

  #schedule(generation: number): void {
    if (generation !== this.#generation) return;
    this.#timer = setTimeout(() => {
      void this.captureNow().catch(() => {}).finally(() => this.#schedule(generation));
    }, this.captureIntervalMs);
  }

  /** Captures one frame now. Concurrent callers share the in-flight capture. */
  captureNow(): Promise<HmiFrameRef> {
    if (this.#capturing) return this.#capturing;
    const source = this.#source, generation = this.#generation;
    if (!source || !this.#view.sessionId) return Promise.reject(new Error("No observing HMI session"));
    const sessionId = this.#view.sessionId;
    this.#capturing = (async () => {
      try {
        const capture = await source.capture();
        if (generation !== this.#generation) throw new Error("HMI session ended during capture");
        if (!capture.bytes.byteLength) throw new Error("Capture returned no pixels");
        const sequence = ++this.#frameSequence;
        const reference = `hmi-frame:${sessionId}:${sequence}`;
        const ref: HmiFrameRef = { reference, sessionId, frameSequence: sequence, capturedAtIso: capture.capturedAtIso, requestedAtIso: capture.requestedAtIso,
          contentType: capture.contentType, byteLength: capture.bytes.byteLength, sha256: createHash("sha256").update(capture.bytes).digest("hex"),
          mediaUrl: `/api/hmi/frames/${encodeURIComponent(sessionId)}/${sequence}`, pageUrl: capture.pageUrl };
        this.#frames.set(reference, { ref, bytes: capture.bytes });
        if (this.#frames.size > this.#maxFrames) this.#frames.delete(this.#frames.keys().next().value!);
        this.#preserve(ref, capture.bytes);
        for (const action of this.#awaitingFrame.splice(0)) action.followingFrame = reference;
        this.#set("observing", `Observing ${source.url}`, { recording: true, frameCount: this.#view.frameCount + 1, lastFrame: ref }, { frame: ref });
        return ref;
      } catch (error) {
        if (generation === this.#generation) {
          const message = error instanceof Error ? error.message : String(error);
          this.#set(this.#view.lastFrame ? "stale" : "error", `Capture failed: ${message}. ${this.#view.lastFrame ? "Last frame held." : "No frame observed."}`, { recording: false });
        }
        throw error;
      } finally { this.#capturing = undefined; }
    })();
    return this.#capturing;
  }

  #checkStale(): void {
    const last = this.#view.lastFrame;
    if (this.#view.state !== "observing" || !last) return;
    const age = Date.parse(this.#nowIso()) - Date.parse(last.capturedAtIso);
    if (age > this.staleAfterMs) this.#set("stale", `No frame for ${Math.round(age)} ms (threshold ${this.staleAfterMs} ms). Last frame held.`, { recording: false });
  }

  #input(generation: number, input: HmiInputObservation): void {
    if (generation !== this.#generation || !this.#view.sessionId) return;
    const sequence = ++this.#actionSequence;
    const action: HmiActionRef = { ...input, reference: `hmi-action:${this.#view.sessionId}:${sequence}`, sessionId: this.#view.sessionId, actionSequence: sequence, origin: "engineer_browser" };
    this.#awaitingFrame.push(action);
    this.#log({ type: "input", ...action });
    this.#notify(this.view, { action });
    // Capture promptly so the visible result is timestamped close to the input.
    setTimeout(() => { void this.captureNow().catch(() => {}); }, 150);
  }

  #closed(generation: number, reason: string): void {
    if (generation !== this.#generation) return;
    this.#generation++;
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#staleTimer) clearInterval(this.#staleTimer);
    this.#source = undefined;
    this.#set("disconnected", `Browser session closed: ${reason}. Last frame held.`, { recording: false });
  }

  #log(record: Record<string, unknown>): void {
    if (!this.#artifactDir) return;
    mkdirSync(this.#artifactDir, { recursive: true });
    appendFileSync(join(this.#artifactDir, "hmi-session.jsonl"), `${JSON.stringify(record)}\n`);
  }

  #preserve(ref: HmiFrameRef, bytes: Uint8Array): void {
    if (!this.#artifactDir) return;
    const directory = join(this.#artifactDir, "hmi-frames", ref.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_"));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${String(ref.frameSequence).padStart(6, "0")}.${ref.contentType === "image/png" ? "png" : "jpg"}`), bytes);
    this.#log({ type: "frame", ...ref });
  }

  /**
   * M9 runtime HMI capability. `capture_hmi_evidence` frames cite the exact captured bytes.
   * HMI operation requires an explicitly installed controlled-session action bridge.
   */
  runtimeAdapter(): HmiAdapter {
    return {
      perform: async (call: ToolCall, signal: AbortSignal) => {
        if (signal.aborted) throw new ToolFailure("inconclusive", "HMI request cancelled before delivery");
        if (call.name === "request_hmi_action") {
          if (!this.#agentAction) throw new ToolFailure("inconclusive", "Muse HMI operation is not implemented; no click was delivered");
          return this.#agentAction(call, signal);
        }
        if (call.arguments.kind !== "frame") throw new ToolFailure("inconclusive", "HMI clip capture is not implemented; request a frame");
        if (!this.observing) throw new ToolFailure("inconclusive", "HMI not observed: no fresh controlled browser HMI session");
        const frame = await this.captureNow();
        if (signal.aborted) throw new ToolFailure("inconclusive", "Capture completed after cancellation");
        return { reference: frame.reference, atIso: frame.capturedAtIso, receipt: { sha256: frame.sha256, sessionId: frame.sessionId } };
      },
      vision: async (signal, reference) => {
        if (signal.aborted || !this.observing) throw new ToolFailure("inconclusive", "No current controlled HMI frame available");
        const ref = reference ? this.#frames.get(reference)?.ref : await this.captureNow();
        const stored = ref && this.frame(ref.sessionId, ref.frameSequence);
        if (signal.aborted || !stored) throw new ToolFailure("inconclusive", "Frame unavailable or capture cancelled");
        return { reference: stored.ref.reference, atIso: stored.ref.capturedAtIso, sha256: stored.ref.sha256, sessionId: stored.ref.sessionId, contentType: stored.ref.contentType, bytes: new Uint8Array(stored.bytes) };
      }
    };
  }
}

export function newHmiSessionId(): string { return `hmi-${randomUUID()}`; }
