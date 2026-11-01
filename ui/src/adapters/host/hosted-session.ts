// Portal source backed by the ControlsBench host (src/host). The host's M9 ledger is campaign
// truth: envelopes are integrity-checked, mapped to portal events with their original IDs, and
// the host projection is shown verbatim. Commands are pending until the host acknowledges them
// on the same stream, after the ledger events that evidence the outcome.

import type { CampaignEnvelope, HmiActionRef, HmiFrameRef, HmiSessionView, HostAcknowledgement, HostCommand, HostEvidenceClass, HostInfo, HostStreamMessage, ProjectionView } from "../../../../src/host/protocol.ts";
import type { EngineerCommand, MuseEvent, SourceMode } from "../../model/events.ts";
import type { CommandResult, WorkspaceStore } from "../../model/workspace-store.ts";
import type { CampaignSource } from "../source.ts";
import { EnvelopeIntegrityError, EnvelopeLog } from "./envelope.ts";
import { CampaignEventMapper } from "./m9-adapter.ts";

export interface HostTransport { send(command: HostCommand): Promise<void> | void }

export interface HostedSessionOptions {
  /** `live` for a running host; `replay` when re-presenting a preserved ledger. */
  mode?: SourceMode;
  /** Wall clock, epoch ms. */
  clock?: () => number;
  transport?: HostTransport;
}

export class HostedSession implements CampaignSource {
  readonly mode: SourceMode;
  readonly label: string;
  readonly store: WorkspaceStore;
  transport: HostTransport | null;
  info: HostInfo | null = null;
  #clock: () => number;
  #offsetMs = 0;
  #originEpochMs: number | null = null;
  #frozenAtMs = 0;
  #log?: EnvelopeLog;
  #mapper?: CampaignEventMapper;
  #campaign?: { campaignId: string; evidenceClass: HostEvidenceClass; label: string; diagnosisMode: "known" | "blind" };
  #queue: Promise<void> = Promise.resolve();
  #request = 0;
  #prefix = crypto.randomUUID();
  #connected = false;

  constructor(store: WorkspaceStore, options: HostedSessionOptions = {}) {
    this.store = store;
    this.mode = options.mode ?? store.state.mode;
    if (this.mode !== store.state.mode) throw new Error("Hosted session mode must match its workspace");
    this.label = this.mode === "live" ? "ControlsBench host" : "Recorded M9 campaign";
    this.#clock = options.clock ?? (() => Date.now());
    this.transport = options.transport ?? null;
  }

  get unavailableReason(): string | undefined {
    if (this.mode === "replay") return "Recorded campaign: read-only evidence; no PLC or model commands.";
    if (!this.transport) return "No portal host transport.";
    if (!this.#connected) return "Portal host stream disconnected; reconnecting. Commands are disabled until it returns.";
    const integrity = this.store.state.hosted?.integrityError;
    return integrity ? `Campaign evidence integrity failure: ${integrity}` : undefined;
  }

  get campaignId(): string | undefined { return this.#campaign?.campaignId; }
  get lastSequence(): number { return this.#log?.lastSequence ?? 0; }
  getEnvelope(id: string): CampaignEnvelope | undefined { return this.#log?.get(id); }

  nowMs(): number {
    if (this.mode === "replay" || this.#originEpochMs === null) return this.#frozenAtMs;
    return this.#clock() + this.#offsetMs - this.#originEpochMs;
  }

  /** Host wall clock (epoch ms), corrected for browser/host skew. Used for frame age. */
  nowEpochMs(): number {
    if (this.mode === "replay") return (this.#originEpochMs ?? 0) + this.#frozenAtMs;
    return this.#clock() + this.#offsetMs;
  }

  advance(): void {
    if (this.mode !== "live") return;
    for (const c of Object.values(this.store.state.commands)) if (c.outcome === "pending" && this.nowMs() >= c.deadlineMs) {
      this.#outcome(c.requestId, "timed_out", "No host acknowledgement before the deadline; applied state is unknown. Inspect the campaign record before retrying.");
    }
  }

  #serverTime(iso: string | undefined): void {
    const server = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(server)) return;
    this.#offsetMs = server - this.#clock();
    this.#originEpochMs ??= server;
  }

  setConnected(connected: boolean, detail = connected ? "Connected to portal host" : "Portal host stream lost; reconnecting"): void {
    this.#connected = connected;
    this.store.setHostLink({ state: connected ? "connected" : "reconnecting", detail, info: this.info ?? undefined });
  }

  /** Applies one host stream message. Messages are processed strictly in arrival order. */
  receive(message: HostStreamMessage): Promise<void> {
    const work = this.#queue.then(() => this.#receive(message));
    this.#queue = work.catch(() => {});
    return work;
  }

  async #receive(message: HostStreamMessage): Promise<void> {
    switch (message.type) {
      case "hello":
        this.info = message.info;
        this.#serverTime(message.info.serverNowIso);
        this.#connected = true;
        this.store.setHostLink({ state: "connected", detail: `Host ${message.info.hostId} · ${message.info.factory.label}`, info: message.info });
        this.store.setHmiSession(message.hmi);
        return;
      case "heartbeat":
        this.#serverTime(message.serverNowIso);
        return;
      case "campaign":
        this.#beginCampaign(message);
        return;
      case "events":
        this.#serverTime(message.serverNowIso);
        await this.ingestEnvelopes(message.campaignId, message.events, message.projection);
        return;
      case "ack":
        this.#serverTime(message.serverNowIso);
        this.acknowledge(message.ack);
        return;
      case "hmi":
        this.#serverTime(message.serverNowIso);
        this.store.setHmiSession(message.hmi);
        if (message.frame) this.#hmiFrame(message.hmi, message.frame);
        if (message.action) this.#hmiAction(message.hmi, message.action);
        return;
    }
  }

  #beginCampaign(c: { campaignId: string; evidenceClass: HostEvidenceClass; label: string; diagnosisMode: "known" | "blind" }): void {
    if (this.#campaign?.campaignId === c.campaignId) return;
    this.#campaign = { campaignId: c.campaignId, evidenceClass: c.evidenceClass, label: c.label, diagnosisMode: c.diagnosisMode };
    this.#log = new EnvelopeLog(c.campaignId);
    this.#mapper = undefined;
    this.store.resetForNewCampaign({ keepCommands: true });
    this.store.setHosted({ campaignId: c.campaignId, label: c.label, evidenceClass: c.evidenceClass, diagnosisMode: c.diagnosisMode, throughSequence: 0 });
  }

  /**
   * Validates and applies envelopes for `campaignId`. Used by the live stream and to re-present a
   * preserved ledger (replay mode). Integrity failures quarantine the campaign view.
   */
  async ingestEnvelopes(campaignId: string, events: readonly CampaignEnvelope[], projection?: ProjectionView, campaign?: { evidenceClass: HostEvidenceClass; label?: string; diagnosisMode?: "known" | "blind" }): Promise<MuseEvent[]> {
    if (!this.#campaign || this.#campaign.campaignId !== campaignId) {
      if (!campaign) throw new Error(`Events for unannounced campaign ${campaignId}`);
      this.#beginCampaign({ campaignId, evidenceClass: campaign.evidenceClass, label: campaign.label ?? campaignId, diagnosisMode: campaign.diagnosisMode ?? "known" });
    }
    const log = this.#log!, meta = this.#campaign!;
    let accepted: CampaignEnvelope[];
    let failure: string | undefined;
    try { accepted = await log.accept(events); }
    catch (error) {
      accepted = (error as { accepted?: CampaignEnvelope[] }).accepted ?? [];
      failure = error instanceof EnvelopeIntegrityError ? error.message : String(error);
    }
    if (accepted.length && this.#originEpochMs === null) this.#originEpochMs = Date.parse(accepted[0]!.atIso);
    this.#mapper ??= new CampaignEventMapper({ mode: this.mode, evidenceClass: meta.evidenceClass, originEpochMs: this.#originEpochMs ?? Date.parse(accepted[0]?.atIso ?? new Date(0).toISOString()),
      requestTimeoutMs: this.info?.limits.requestTimeoutMs ?? 300_000, label: meta.label, diagnosisMode: meta.diagnosisMode });
    const mapped = accepted.flatMap(e => this.#mapper!.map(e, id => log.get(id)));
    if (accepted.length === log.length && accepted.length && this.info) {
      // First batch of a campaign: declared budget limits precede model activity.
      const l = this.info.limits;
      mapped.unshift({ kind: "budget.limits", limits: { ...l }, id: `${campaignId}:limits`, atMs: mapped[0]?.atMs ?? 0, lane: "system", summary: "Budget limits", provenance: { mode: this.mode, evidenceClass: "audit", source: "host", clock: this.mode === "live" ? "live_wall" : "recorded_wall" } });
    }
    if (mapped.length) {
      this.store.applyEvents(mapped);
      this.#frozenAtMs = Math.max(this.#frozenAtMs, ...mapped.map(e => e.atMs));
    }
    const current = this.store.state.hosted;
    this.store.setHosted({ campaignId, label: meta.label, evidenceClass: meta.evidenceClass, diagnosisMode: meta.diagnosisMode,
      projection: failure ? current?.projection : projection ?? current?.projection, throughSequence: log.lastSequence, integrityError: failure ?? current?.integrityError });
    return mapped;
  }

  #hmiFrame(view: HmiSessionView, frame: HmiFrameRef): void {
    this.store.applyEvents([{ kind: "hmi.observation", observation: "frame", sourceId: view.sourceId ?? "hmi", capturedAt: frame.capturedAtIso, mediaUrl: frame.mediaUrl,
      reference: frame.reference, sessionId: frame.sessionId, sha256: frame.sha256, origin: "host_capture", periodic: true,
      note: `Frame ${frame.frameSequence} of ${frame.pageUrl} (${frame.byteLength} bytes, sha256 ${frame.sha256.slice(0, 12)}…)`,
      id: frame.reference, atMs: this.#atFromIso(frame.capturedAtIso), lane: "hmi", summary: `HMI frame ${frame.frameSequence}`,
      provenance: { mode: this.mode, evidenceClass: "plc_measurement", source: `hmi:${view.sourceId ?? "hmi"}`, ref: frame.reference, clock: this.mode === "live" ? "live_wall" : "recorded_wall", recordedAt: frame.capturedAtIso } }]);
  }

  #hmiAction(view: HmiSessionView, action: HmiActionRef): void {
    const where = action.kind === "pointer" ? ` at (${action.x ?? "?"}, ${action.y ?? "?"}) of ${action.viewportWidth ?? "?"}×${action.viewportHeight ?? "?"}` : " (key value not recorded)";
    this.store.applyEvents([{ kind: "hmi.observation", observation: "action", sourceId: view.sourceId ?? "hmi", capturedAt: action.atIso, reference: action.reference, sessionId: action.sessionId, origin: "engineer_browser",
      note: `Engineer ${action.kind} input delivered to the WebVisu page${where}. Visible result and PLC effect are separate evidence.`,
      id: action.reference, atMs: this.#atFromIso(action.atIso), lane: "hmi", summary: `HMI ${action.kind} input`,
      provenance: { mode: this.mode, evidenceClass: "engineer_local", source: `hmi:${view.sourceId ?? "hmi"}`, ref: action.reference, clock: this.mode === "live" ? "live_wall" : "recorded_wall", recordedAt: action.atIso } }]);
  }

  #atFromIso(iso: string): number {
    const t = Date.parse(iso);
    return Number.isFinite(t) && this.#originEpochMs !== null ? t - this.#originEpochMs : this.nowMs();
  }

  // ---------------------------------------------------------------- commands

  #outcome(requestId: string, outcome: "applied" | "rejected" | "timed_out", detail?: string, evidenceRefs?: string[]): void {
    const c = this.store.state.commands[requestId];
    if (!c || c.outcome !== "pending") return;
    this.store.applyEvents([{ ...c, kind: "command.outcome", outcome, detail, evidenceRefs, id: `${requestId}-${outcome}`, atMs: this.nowMs(), lane: "system",
      summary: `${c.command} ${outcome}${detail ? `: ${detail}` : ""}`, provenance: { mode: this.mode, evidenceClass: "engineer_local", source: "host:ack", ref: evidenceRefs?.join(", "), clock: "live_wall" } }]);
  }

  /** Applies a host acknowledgement. Unknown, duplicate and late acknowledgements change nothing. */
  acknowledge(ack: HostAcknowledgement): void {
    this.advance();
    this.#outcome(ack.requestId, ack.outcome, ack.detail, ack.evidenceRefs);
  }

  #forward(type: string, command?: EngineerCommand, payload?: Record<string, unknown>): CommandResult {
    const unavailable = this.unavailableReason;
    if (unavailable) return { ok: false, reason: unavailable };
    if (Object.values(this.store.state.commands).some(c => c.outcome === "pending")) return { ok: false, reason: "Awaiting the host acknowledgement of the pending command." };
    if (command) { const allowed = this.store.can(command); if (!allowed.ok) return allowed; }
    const requestId = `${this.#prefix}-${++this.#request}`, now = this.nowMs();
    this.store.applyEvents([{ kind: "command.outcome", requestId, command: type, payload, outcome: "pending", deadlineMs: now + (this.info?.commandTimeoutMs ?? 15_000), id: `${requestId}-pending`, atMs: now, lane: "system",
      summary: `${type} pending host acknowledgement`, provenance: { mode: this.mode, evidenceClass: "engineer_local", source: "workspace", clock: "live_wall" } }]);
    try {
      void Promise.resolve(this.transport!.send({ contractVersion: 1, requestId, type, payload })).catch(e => this.#outcome(requestId, "rejected", `Not delivered to host: ${e instanceof Error ? e.message : String(e)}`));
    } catch (e) { this.#outcome(requestId, "rejected", String(e)); return { ok: false, reason: String(e) }; }
    return { ok: true };
  }

  start(): CommandResult { return this.#forward("start", "start", { scope: this.store.campaignScope() }); }
  pause(): CommandResult { return this.#forward("pause", "pause"); }
  resume(): CommandResult { return this.#forward("resume", "resume"); }
  stop(): CommandResult { return this.#forward("stop", "stop"); }
  resetSimulation(): CommandResult { return this.#forward("reset_simulation", "reset_simulation"); }
  exitSimulation(): CommandResult { return this.#forward("exit_simulation", "exit_simulation"); }
  enterSimulation(): CommandResult { return this.#forward("enter_simulation", "enter_simulation"); }
  setSuppression(outputId: string, suppressed: boolean): CommandResult { return this.#forward("set_output_suppression", undefined, { outputId, suppressed }); }
  steer(text: string): CommandResult { return text.trim() ? this.#forward("steer", undefined, { text: text.trim() }) : { ok: false, reason: "Write a direction for Muse first." }; }
  reviewFinding(id: string, review: "accepted" | "rerun_requested", reason?: string): CommandResult { return this.#forward("review_finding", undefined, { id, review, reason }); }
  configureHmi(url: string): CommandResult { return this.#forward("configure_hmi", undefined, { url }); }
  disconnectHmi(): CommandResult { return this.#forward("disconnect_hmi"); }
}
