// Campaign host: owns at most one active M9 CampaignRuntime, fans its ledger out to portal
// clients, and turns portal commands into runtime calls with evidence-backed acknowledgements.
//
// Acknowledgement rule: a command is `applied` only when the runtime's ledger (or the HMI
// session) shows the requested effect; the ack cites those event IDs and is emitted after the
// events themselves. Transport receipt is never an acknowledgement. A request ID is executed at
// most once; repeats return the recorded outcome.

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CampaignEvent, EventType } from "../campaign/contracts.ts";
import type { HmiAdapter } from "../campaign/driver.ts";
import { CampaignLedger, report } from "../campaign/ledger.ts";
import type { CampaignFactory, HostedCampaign } from "./campaign-factory.ts";
import { CdpWebVisuSource, type CdpWebVisuOptions } from "./cdp-webvisu.ts";
import type { HmiActionRef, HmiCaptureSource } from "./hmi.ts";
import { HmiHub, validateHmiUrl } from "./hmi.ts";
import type { CampaignEnvelope, HmiFrameRef, HmiSessionView, HostAcknowledgement, HostCommand, HostInfo, HostStreamMessage, ProjectionView } from "./protocol.ts";
import { HOST_COMMAND_TYPES, HOST_PROTOCOL_VERSION } from "./protocol.ts";
import { acceptedBudgetLimits } from "../campaign/budget.ts";

/** Ledger that notifies the host of every durable append without changing M9 semantics. */
class ObservedLedger extends CampaignLedger {
  onAppend?: (event: CampaignEvent) => void;
  override append(type: EventType, data: Record<string, unknown>, visibility: CampaignEvent["visibility"] = "public"): CampaignEvent {
    const event = super.append(type, data, visibility);
    this.onAppend?.(event);
    return event;
  }
}

interface ActiveCampaign {
  campaignId: string;
  ledger: ObservedLedger;
  hosted: HostedCampaign;
  agent?: Promise<void>;
  flushed: number;
}

export interface CampaignHostOptions {
  factory: CampaignFactory;
  /** Each campaign ledger is written to `<artifactDir>/<campaignId>/campaign.jsonl` when set. */
  artifactDir?: string;
  commandTimeoutMs?: number;
  hmi?: HmiHub;
  /** Builds the capture source for `configure_hmi`; defaults to the CDP WebVisu source. */
  hmiSourceFactory?: (url: string) => HmiCaptureSource;
  hmiBrowser?: CdpWebVisuOptions;
}

type Listener = (message: HostStreamMessage) => void;
const TERMINAL = new Set(["stopped", "completed", "failed"]);

export class CampaignHost {
  readonly hostId = `host-${randomUUID()}`;
  readonly factory: CampaignFactory;
  readonly hmi: HmiHub;
  readonly commandTimeoutMs: number;
  readonly #artifactDir?: string;
  readonly #hmiSourceFactory: (url: string) => HmiCaptureSource;
  #active?: ActiveCampaign;
  #listeners = new Set<Listener>();
  #acks = new Map<string, HostAcknowledgement>();
  #inFlight = new Set<string>();
  #queue: Promise<void> = Promise.resolve();
  #flushScheduled = false;
  #campaignCount = 0;

  constructor(options: CampaignHostOptions) {
    this.factory = options.factory;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 15_000;
    this.#artifactDir = options.artifactDir;
    this.hmi = options.hmi ?? new HmiHub({ artifactDir: options.artifactDir ? join(options.artifactDir, "hmi") : undefined });
    this.#hmiSourceFactory = options.hmiSourceFactory ?? (url => new CdpWebVisuSource(url, options.hmiBrowser));
    this.hmi.onChangeListener = (view, change) => this.#hmiChanged(view, change);
  }

  get info(): HostInfo {
    const f = this.factory;
    return { protocolVersion: HOST_PROTOCOL_VERSION, hostId: this.hostId,
      factory: { id: f.id, label: f.label, evidenceClass: f.evidenceClass, claimBoundary: f.claimBoundary, connectorId: f.connectorId, supportsExitSimulation: f.supportsExitSimulation },
      limits: f.limits ?? { ...acceptedBudgetLimits }, commandTimeoutMs: this.commandTimeoutMs, outputIds: f.outputIds, serverNowIso: new Date().toISOString() };
  }

  get campaignId(): string | null { return this.#active?.campaignId ?? null; }
  get runtime() { return this.#active?.hosted.runtime; }
  get events(): CampaignEvent[] { return this.#active?.ledger.events ?? []; }
  get projection(): ProjectionView | undefined { return this.#active?.ledger.state as ProjectionView | undefined; }
  report(): ReturnType<typeof report> | undefined { return this.#active ? report(this.#active.ledger.events) : undefined; }

  /**
   * Subscribes a client. It receives hello, then every event after `after` for the current
   * campaign (all events when the campaign ID differs), then the recent acknowledgements.
   */
  subscribe(listener: Listener, resume?: { campaignId?: string; after?: number }): () => void {
    this.#flush();
    listener({ type: "hello", info: this.info, campaignId: this.campaignId, hmi: this.hmi.view });
    const active = this.#active;
    if (active) {
      listener(this.#campaignMessage(active));
      const after = resume?.campaignId === active.campaignId ? Math.max(0, Math.floor(resume.after ?? 0)) : 0;
      const events = active.ledger.eventsSince(after) as unknown as CampaignEnvelope[];
      if (events.length) listener({ type: "events", campaignId: active.campaignId, events, projection: active.ledger.state as ProjectionView, serverNowIso: new Date().toISOString() });
    }
    for (const ack of [...this.#acks.values()].slice(-50)) listener({ type: "ack", ack, serverNowIso: new Date().toISOString() });
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #broadcast(message: HostStreamMessage): void {
    for (const listener of this.#listeners) { try { listener(message); } catch { /* a broken client must not stop the runtime */ } }
  }

  #campaignMessage(active: ActiveCampaign): HostStreamMessage {
    return { type: "campaign", campaignId: active.campaignId, evidenceClass: this.factory.evidenceClass, label: this.factory.label, diagnosisMode: active.hosted.runtime.diagnosisMode };
  }

  #scheduleFlush(): void {
    if (this.#flushScheduled) return;
    this.#flushScheduled = true;
    setImmediate(() => { this.#flushScheduled = false; this.#flush(); });
  }

  #flush(): void {
    const active = this.#active;
    if (!active) return;
    const events = active.ledger.eventsSince(active.flushed) as unknown as CampaignEnvelope[];
    if (!events.length) return;
    active.flushed = events.at(-1)!.sequence;
    this.#broadcast({ type: "events", campaignId: active.campaignId, events, projection: active.ledger.state as ProjectionView, serverNowIso: new Date().toISOString() });
  }

  #hmiChanged(view: HmiSessionView, change: { frame?: HmiFrameRef; action?: HmiActionRef }): void {
    this.#broadcast({ type: "hmi", hmi: view, frame: change.frame, action: change.action, serverNowIso: new Date().toISOString() });
  }

  /** The runtime's HMI capability; resolves the live session at call time. */
  get hmiAdapter(): HmiAdapter { return this.hmi.runtimeAdapter(); }

  /**
   * Accepts a portal command. Returns once it is queued (transport receipt). The
   * acknowledgement is broadcast later, after the evidence it cites.
   */
  submit(command: HostCommand): { received: true; duplicate: boolean } {
    if (!command || command.contractVersion !== 1 || typeof command.requestId !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(command.requestId)) throw new Error("Invalid command envelope");
    if (!(HOST_COMMAND_TYPES as readonly string[]).includes(command.type)) throw new Error(`Unsupported command type ${String(command.type)}`);
    if (command.payload !== undefined && (typeof command.payload !== "object" || command.payload === null || Array.isArray(command.payload))) throw new Error("Command payload must be an object");
    const recorded = this.#acks.get(command.requestId);
    if (recorded) { this.#broadcast({ type: "ack", ack: recorded, serverNowIso: new Date().toISOString() }); return { received: true, duplicate: true }; }
    if (this.#inFlight.has(command.requestId)) return { received: true, duplicate: true };
    this.#inFlight.add(command.requestId);
    this.#queue = this.#queue.then(() => this.#run(command));
    return { received: true, duplicate: false };
  }

  /** Resolves when every queued command has been acknowledged (tests and shutdown). */
  idle(): Promise<void> { return this.#queue; }

  async #run(command: HostCommand): Promise<void> {
    let ack: Omit<HostAcknowledgement, "requestId" | "atIso">;
    // No host-side race: an operation that outlives the portal deadline still reports its real
    // outcome later. The portal shows timed_out (applied state unknown) and ignores the late ack;
    // the projection shows what actually happened.
    try {
      ack = await this.#execute(command);
    } catch (error) {
      ack = { outcome: "rejected", detail: error instanceof Error ? error.message : String(error), evidenceRefs: [] };
    }
    this.#flush();
    const full: HostAcknowledgement = { ...ack, requestId: command.requestId, campaignId: this.campaignId ?? undefined, throughSequence: this.#active?.ledger.state.sequence, atIso: new Date().toISOString() };
    this.#acks.set(command.requestId, full);
    if (this.#acks.size > 500) this.#acks.delete(this.#acks.keys().next().value!);
    this.#inFlight.delete(command.requestId);
    this.#broadcast({ type: "ack", ack: full, serverNowIso: new Date().toISOString() });
  }

  #lastOfType(type: string, since = 0): CampaignEvent | undefined {
    return this.#active?.ledger.eventsSince(since).filter(e => e.type === type).at(-1);
  }

  async #execute(command: HostCommand): Promise<Omit<HostAcknowledgement, "requestId" | "atIso">> {
    const p = command.payload ?? {};
    const active = this.#active, runtime = active?.hosted.runtime;
    const reject = (detail: string) => ({ outcome: "rejected" as const, detail, evidenceRefs: [] });
    const mark = active?.ledger.state.sequence ?? 0;
    const stateEvent = () => this.#lastOfType("campaign.state", mark);
    switch (command.type) {
      case "start": {
        if (active && !TERMINAL.has(active.ledger.state.status)) return reject(`Campaign ${active.campaignId} is already ${active.ledger.state.status}`);
        const next = await this.#create(p.scope as Record<string, boolean> | undefined);
        await next.hosted.runtime.start(true);
        this.#flush();
        const running = this.#lastOfType("campaign.state");
        if (next.hosted.runtime.status !== "running") return { outcome: "rejected", detail: `Campaign did not start: ${String(running?.data.reason ?? next.hosted.runtime.status)}`, evidenceRefs: running ? [running.id] : [] };
        this.#runAgent(next);
        const authorized = this.#lastOfType("campaign.authorized");
        return { outcome: "applied", detail: `Campaign ${next.campaignId} running under ${this.factory.label}`, evidenceRefs: [authorized?.id, running?.id].filter((x): x is string => Boolean(x)) };
      }
      case "pause": {
        if (!runtime || runtime.status !== "running") return reject("Only a running campaign can pause");
        await runtime.pause("Engineer paused campaign from the portal");
        const e = stateEvent();
        return (runtime.status as string) === "paused" && e ? { outcome: "applied", detail: "Paused: world evolution frozen; held image refreshed; PLC keeps scanning", evidenceRefs: [e.id] } : reject(`Pause not confirmed (status ${runtime.status})`);
      }
      case "resume": {
        if (!runtime || !active || runtime.status !== "paused") return reject("Only a paused campaign can resume");
        // The cancelled model request must settle (including its cost) before resuming.
        if (active.agent) await active.agent;
        runtime.resume();
        const e = stateEvent();
        this.#runAgent(active);
        return e ? { outcome: "applied", detail: "Resumed from the held image", evidenceRefs: [e.id] } : reject("Resume not recorded");
      }
      case "stop": {
        if (!runtime || TERMINAL.has(runtime.status)) return reject("No active campaign to stop");
        await runtime.stop("Engineer stopped campaign from the portal");
        const e = stateEvent(), finalized = this.#lastOfType("report.finalized", mark);
        return TERMINAL.has(runtime.status) && e ? { outcome: "applied", detail: "Stopped: run record finalized; final image held for inspection", evidenceRefs: [e.id, finalized?.id].filter((x): x is string => Boolean(x)) } : reject("Stop not confirmed");
      }
      case "reset_simulation": {
        if (!runtime) return reject("No campaign simulation to reset");
        await runtime.resetSimulation();
        const reset = this.#lastOfType("simulation.reset", mark);
        return reset ? { outcome: "applied", detail: "Complete zero raw image acknowledged by the connector; simulation remains selected and held. Start a new campaign to evolve a new world.", evidenceRefs: [String(reset.data.sourceId), reset.id] } : reject("Reset not acknowledged by the connector");
      }
      case "exit_simulation": {
        if (!runtime || !active) return reject("No campaign simulation to exit");
        if (!active.hosted.simulationExit) return reject("This campaign factory has no passthrough adapter; hardware passthrough cannot be selected or confirmed from the portal");
        await runtime.exitSimulation(active.hosted.simulationExit);
        const exited = this.#lastOfType("simulation.exited", mark), passthrough = this.#lastOfType("connector.state", mark);
        return exited ? { outcome: "applied", detail: "Passthrough observed by the connector (simulation deselected)", evidenceRefs: [exited.id, passthrough?.id].filter((x): x is string => Boolean(x)) } : reject("Passthrough not confirmed");
      }
      case "enter_simulation":
        if (active && !TERMINAL.has(active.ledger.state.status)) return reject("Stop the active campaign first");
        return { outcome: "applied", detail: "Simulation selected for the next campaign. The interceptor is only confirmed simulated after the next campaign's connector observation.", evidenceRefs: [] };
      case "set_output_suppression":
        return reject("Campaign runtime v1 exposes no physical-sink suppression. Configure suppression at the interceptor; PLC commands are still observed.");
      case "steer":
        return reject("Campaign runtime v1 has no steering channel. The text was not delivered to Muse.");
      case "review_finding": {
        if (!runtime) return reject("No campaign");
        const review = p.review === "accepted" ? "accepted" : p.review === "rerun_requested" ? "rerun_requested" : undefined;
        if (!review || typeof p.id !== "string") return reject("review_finding needs id and review accepted|rerun_requested");
        runtime.reviewFinding(p.id, review, typeof p.reason === "string" && p.reason.trim() ? p.reason.trim().slice(0, 2000) : review === "accepted" ? "Engineer accepted finding in portal" : "Engineer requested rerun in portal");
        const e = this.#lastOfType(review === "accepted" ? "finding.accepted" : "finding.rerun_requested", mark);
        return e ? { outcome: "applied", detail: review === "accepted" ? "Finding review recorded; verdicts unchanged" : "Rerun request recorded; nothing executed", evidenceRefs: [e.id] } : reject("Review not recorded");
      }
      case "configure_hmi": {
        const url = validateHmiUrl(p.url);
        const frame = await this.hmi.connect(this.#hmiSourceFactory(url));
        return { outcome: "applied", detail: `Controlled WebVisu session observing ${url}; first frame captured`, evidenceRefs: [frame.reference] };
      }
      case "disconnect_hmi":
        await this.hmi.disconnect();
        return { outcome: "applied", detail: "HMI capture stopped; last frame held under disconnected overlay", evidenceRefs: [] };
    }
    return reject(`Unsupported command ${command.type}`);
  }

  async #create(scope: Record<string, boolean> | undefined): Promise<ActiveCampaign> {
    const previous = this.#active;
    if (previous) {
      previous.ledger.close();
      await previous.hosted.dispose?.().catch(() => {});
    }
    const campaignId = `portal-${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${++this.#campaignCount}`;
    let file: string | undefined;
    if (this.#artifactDir) { const directory = join(this.#artifactDir, campaignId); mkdirSync(directory, { recursive: true }); file = join(directory, "campaign.jsonl"); }
    const ledger = new ObservedLedger(campaignId, { file });
    this.#active = undefined;
    let hosted: HostedCampaign;
    try {
      hosted = await this.factory.create({ ledger, hmi: this.hmiAdapter, scope: { ...(scope ?? {}) } });
      if (hosted.runtime.ledger !== ledger) throw new Error("the runtime must be built on the host-provided ledger");
    } catch (error) {
      ledger.close();
      throw new Error(`Campaign factory failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const active: ActiveCampaign = { campaignId, ledger, hosted, flushed: 0 };
    ledger.onAppend = () => { if (this.#active === active) this.#scheduleFlush(); };
    this.#active = active;
    this.#broadcast(this.#campaignMessage(active));
    this.#flush();
    return active;
  }

  #runAgent(active: ActiveCampaign): void {
    const tracked: Promise<void> = active.hosted.runtime.runAgent().catch(() => {}).finally(() => {
      if (active.agent === tracked) active.agent = undefined;
      this.#flush();
    });
    active.agent = tracked;
  }

  async close(): Promise<void> {
    await this.#queue.catch(() => {});
    const active = this.#active;
    if (active && !TERMINAL.has(active.hosted.runtime.status)) await active.hosted.runtime.stop("Host shutting down");
    if (active?.agent) await active.agent;
    this.#flush();
    active?.ledger.close();
    await active?.hosted.dispose?.().catch(() => {});
    await this.hmi.disconnect("Host shutting down");
    this.#listeners.clear();
  }
}
