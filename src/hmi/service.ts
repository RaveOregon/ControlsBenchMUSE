// Operator HMI service: one PLC link, operator commands, HMI-recorded alarms, browser client and
// semantic-target registry, and the evidence journal that keeps requested HMI action, delivered
// browser input, rendered screen result and PLC acknowledgement as separate records.

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { TransportEvent } from "../live/m8-opcua.ts";
import { AlarmRecorder, type AlarmFilter } from "./alarms.ts";
import { OperatorCommands, type CommandRequest } from "./commands.ts";
import type { FixtureControl, FixturePlc } from "./fixture.ts";
import { HmiJournal } from "./journal.ts";
import { PlcLink, type TransportFactory } from "./link.ts";
import type { AgentActionView, ClientView, CommandAction, CommandView, HmiStateView, IdentityView, OwnershipView, SnapshotView, TargetRect } from "./protocol.ts";
import { HMI_PROTOCOL_VERSION } from "./protocol.ts";
import { EXPECTED_BUILD_ID, EXPECTED_INTERFACE_VERSION, MAP_VERSION, P, resetPreconditions, startPreconditions } from "./signals.ts";

export type HmiSource =
  | { kind: "live_plc"; transportFactory: TransportFactory; endpoint: string; userConfigured: boolean }
  | { kind: "fixture"; plc: FixturePlc };

export interface HmiServiceOptions {
  source: HmiSource;
  /** Directory for this run's journal and (live only) the persistent alarm history. Omit for memory only. */
  artifactRoot?: string;
  pollIntervalMs?: number;
  /** Poll interval while another lane owns the runtime, so the HMI cannot starve its heartbeat. */
  sharedPollIntervalMs?: number;
  commandPolicy?: "auto" | "enabled" | "disabled";
  /** Repository roots whose runtime-ownership files are honoured. Defaults to this checkout and the main worktree. */
  ownershipRoots?: string[];
  ackTimeoutMs?: number;
  settleMs?: number;
  staleAfterMs?: number;
}

const CHURN = new Set([P.plcCycle, P.outputCaptureCycle, "GVL_BenchRead.PlcHeartbeat", "GVL_BenchRead.PlcTimeUs", "GVL_BenchRead.OutputCaptureTimeUs", "GVL_DemoRead.Status.ScanTimeUs"]);
const ID = /^[A-Za-z0-9:_.-]{1,100}$/;
const str = (v: unknown, max = 200) => typeof v === "string" ? v.slice(0, max) : undefined;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;

export function defaultOwnershipRoots(cwd = process.cwd()): string[] {
  const roots = new Set([resolve(cwd)]);
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8", windowsHide: true }).trim();
    roots.add(resolve(dirname(common)));
  } catch { /* not a git checkout */ }
  return [...roots];
}

export class HmiService {
  readonly serviceSessionId = `hmi-svc-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  readonly startedAtIso = new Date().toISOString();
  readonly journal: HmiJournal;
  readonly link: PlcLink;
  readonly commands: OperatorCommands;
  readonly alarms: AlarmRecorder;
  readonly source: HmiSource;
  readonly runDir?: string;
  url = "";
  readonly #o: HmiServiceOptions;
  readonly #listeners = new Set<(state: HmiStateView) => void>();
  readonly #clients = new Map<string, ClientView & { label: string }>();
  readonly #targets = new Map<string, { route: string; viewport: { width: number; height: number }; publishedAtIso: string; targets: TargetRect[] }>();
  readonly #agentActions = new Map<string, AgentActionView>();
  #agentSequence = 0;
  #ownership: OwnershipView;
  #ownershipTimer?: ReturnType<typeof setInterval>;
  #lastKeyframeMs = 0;
  #notifyTimer?: ReturnType<typeof setTimeout>;
  #claimFile?: string;

  constructor(options: HmiServiceOptions) {
    this.#o = options; this.source = options.source;
    const stamp = this.startedAtIso.replace(/[:.]/g, "-");
    this.runDir = options.artifactRoot ? join(options.artifactRoot, "runs", `${stamp}-${options.source.kind}`) : undefined;
    this.journal = new HmiJournal({ file: this.runDir ? join(this.runDir, "journal.jsonl") : undefined });
    this.#ownership = { commandsEnabled: false, policy: options.commandPolicy ?? "auto", reasons: ["Ownership not yet checked"], owners: [] };
    const source = options.source;
    const factory: TransportFactory = source.kind === "fixture" ? (event: TransportEvent) => source.plc.transport(event) : source.transportFactory;
    this.link = new PlcLink({ transportFactory: factory, journal: this.journal, endpoint: source.kind === "fixture" ? "fixture://m10-recorded" : source.endpoint,
      securityMode: source.kind === "fixture" ? "None (fixture)" : "SignAndEncrypt", securityPolicy: source.kind === "fixture" ? "None (fixture)" : "Basic256Sha256",
      userConfigured: source.kind === "live_plc" && source.userConfigured, pollIntervalMs: options.pollIntervalMs ?? 250, staleAfterMs: options.staleAfterMs,
      onSnapshot: (s, prev) => this.#onSnapshot(s, prev), onBootChange: (from, to) => this.alarms.bootChanged(from, to, new Date().toISOString()),
      onChange: () => { if (!this.link.connected) this.alarms?.linkLost(`PLC link ${this.link.view.state}`); this.#notify(); } });
    this.alarms = new AlarmRecorder({ journal: this.journal, serviceSessionId: this.serviceSessionId,
      historyFile: options.artifactRoot && source.kind === "live_plc" ? join(options.artifactRoot, "live", "alarm-history.jsonl") : undefined, onChange: () => this.#notify() });
    this.commands = new OperatorCommands({ link: this.link, journal: this.journal, ownership: () => this.#ownership, identityProblem: () => this.#identityProblem(),
      ackTimeoutMs: options.ackTimeoutMs, settleMs: options.settleMs, onChange: () => this.#notify() });
  }

  get identity(): IdentityView {
    const s = this.source;
    return { protocolVersion: HMI_PROTOCOL_VERSION, serviceSessionId: this.serviceSessionId, startedAtIso: this.startedAtIso,
      source: s.kind === "fixture"
        ? { kind: "fixture", label: `FIXTURE · ${s.plc.fixtures.states.find(x => x.id === s.plc.stateId)?.title ?? s.plc.stateId}`, fixtureId: s.plc.stateId,
            fixtureBasis: `recorded ${s.plc.fixtures.states.find(x => x.id === s.plc.stateId)?.recordedAtIso ?? "?"} in ${s.plc.fixtures.source.file} (sha256 ${s.plc.fixtures.source.sha256.slice(0, 12)}…)${s.plc.emulate ? "; command acknowledgements emulated by the fixture, not M8" : "; no command emulation"}` }
        : { kind: "live_plc", label: `Live PLC · ${s.endpoint}` },
      machine: { id: "CV-1", name: "Sort conveyor", description: "Single lane · divert D1 to exit A · divert D2 to exit B · straight runout" },
      mapVersion: MAP_VERSION, expectedBuildId: EXPECTED_BUILD_ID, expectedInterfaceVersion: EXPECTED_INTERFACE_VERSION, url: this.url,
      journal: this.journal.file };
  }

  #identityProblem(): string | undefined {
    const v = this.link.values();
    if (v[P.buildId] !== EXPECTED_BUILD_ID || v[P.interfaceVersion] !== EXPECTED_INTERFACE_VERSION)
      return `controller identity is BuildId ${String(v[P.buildId])}/Interface ${String(v[P.interfaceVersion])}, not ${EXPECTED_BUILD_ID}/${EXPECTED_INTERFACE_VERSION}`;
    return undefined;
  }

  async start(): Promise<void> {
    if (this.source.kind === "live_plc" && this.#o.artifactRoot) this.#claim();
    this.journal.append("service.started", { identity: this.identity, commandPolicy: this.#ownership.policy, alarmHistoryLoaded: this.alarms.loadedFromHistory, alarmPersistence: this.alarms.persistence });
    this.#checkOwnership();
    this.#ownershipTimer = setInterval(() => this.#checkOwnership(), 2000);
    this.link.start();
  }

  async stop(): Promise<void> {
    if (this.#ownershipTimer) clearInterval(this.#ownershipTimer);
    await this.link.stop();
    this.journal.append("service.stopped", {});
    this.journal.close();
    if (this.source.kind === "fixture") this.source.plc.close();
    if (this.#claimFile && existsSync(this.#claimFile)) { try { const c = JSON.parse(readFileSync(this.#claimFile, "utf8")); if (c.serviceSessionId === this.serviceSessionId) unlinkSync(this.#claimFile); } catch { /* leave for inspection */ } }
  }

  /** Announces this live HMI to other lanes (artifacts/hmi/runtime-claim.json) and refuses a second live HMI. */
  #claim(): void {
    const file = join(this.#o.artifactRoot!, "runtime-claim.json");
    if (existsSync(file)) {
      const other = JSON.parse(readFileSync(file, "utf8")) as { pid: number; serviceSessionId: string };
      let alive = false; try { process.kill(other.pid, 0); alive = true; } catch { /* stale claim */ }
      if (alive) throw new Error(`Another live HMI service (${other.serviceSessionId}, pid ${other.pid}) holds ${file}`);
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ serviceSessionId: this.serviceSessionId, pid: process.pid, startedAtIso: this.startedAtIso, writes: "GVL_DemoWrite Start/Stop/ResetSequence and AutoRequest only", url: this.url }, null, 2) + "\n");
    this.#claimFile = file;
  }

  #checkOwnership(): void {
    const owners: OwnershipView["owners"] = [];
    for (const root of this.#o.ownershipRoots ?? defaultOwnershipRoots()) {
      const lock = join(root, "artifacts/m10/live.lock");
      if (existsSync(lock)) owners.push({ id: "m10-live-runner", file: lock, detail: "M10 campaign runner holds the live lock" });
      for (const [id, rel] of [["m10-watch-runner", "artifacts/m10/operator-status.json"], ["m8-smoke-operator", "codesys/demo/operator-status.json"]] as const) {
        const file = join(root, rel);
        try { const s = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { active?: boolean; running?: boolean }; if (s.active) owners.push({ id, file, detail: s.running ? "running" : "active (holding credentials, idle)" }); } catch { /* absent */ }
      }
    }
    const policy = this.#o.commandPolicy ?? "auto";
    const reasons = policy === "disabled" ? ["HMI started with commands disabled (read-only)"] : policy === "auto" && owners.length ? owners.map(o => `runtime owned by ${o.id} (${o.detail})`) : [];
    const next: OwnershipView = { commandsEnabled: reasons.length === 0, policy, reasons, owners };
    if (JSON.stringify(next) !== JSON.stringify(this.#ownership)) {
      this.#ownership = next;
      this.journal.append("ownership.changed", next as unknown as Record<string, unknown>);
      this.link.setPollInterval(owners.length ? this.#o.sharedPollIntervalMs ?? 1000 : this.#o.pollIntervalMs ?? 250);
      this.#notify();
    }
  }

  #onSnapshot(snapshot: SnapshotView, previous?: SnapshotView): void {
    const t = Date.parse(snapshot.receivedAtIso);
    if (!previous || t - this.#lastKeyframeMs >= 15_000) {
      this.#lastKeyframeMs = t;
      this.journal.append("plc.keyframe", { sequence: snapshot.sequence, receivedAtIso: snapshot.receivedAtIso, latencyMs: snapshot.latencyMs, sameScanBracket: snapshot.sameScanBracket,
        values: Object.fromEntries(Object.entries(snapshot.values).map(([p, s]) => [p, [s.value, s.status, s.sourceTimestamp]])) });
    } else {
      const changes: Record<string, unknown> = {};
      for (const [p, s] of Object.entries(snapshot.values)) {
        const before = previous.values[p];
        if (!CHURN.has(p) && (!before || before.value !== s.value || before.good !== s.good)) changes[p] = s.good ? s.value : [s.value, s.status];
      }
      if (Object.keys(changes).length) this.journal.append("plc.change", { sequence: snapshot.sequence, receivedAtIso: snapshot.receivedAtIso, changes });
    }
    this.alarms.observe(snapshot);
    this.commands.observe(snapshot);
    this.#notify();
  }

  state(): HmiStateView {
    const active = this.alarms.active();
    const recent = this.alarms.query({ limit: 12 });
    const values = this.link.values();
    return { identity: this.identity, serverNowIso: new Date().toISOString(), link: this.link.view, snapshot: this.link.latest, ownership: this.#ownership,
      commands: this.commands.list(12), preconditions: { start: startPreconditions(values), reset: resetPreconditions(values) }, alarms: { active, recent: recent.alarms, total: recent.total, persistence: this.alarms.persistence }, clients: [...this.#clients.values()] };
  }

  subscribe(listener: (state: HmiStateView) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }

  #notify(): void {
    if (this.#notifyTimer) return;
    this.#notifyTimer = setTimeout(() => { this.#notifyTimer = undefined; const s = this.state(); for (const l of this.#listeners) l(s); }, 50);
  }

  registerClient(body: Record<string, unknown>): ClientView {
    const label = (str(body.label, 60) ?? "browser").replace(/[^A-Za-z0-9 _.:-]/g, "") || "browser";
    const clientSessionId = `hmi-client-${this.#clients.size + 1}-${randomUUID().slice(0, 8)}`;
    const at = new Date().toISOString();
    const width = num((body.viewport as Record<string, unknown> | undefined)?.width), height = num((body.viewport as Record<string, unknown> | undefined)?.height);
    const client = { clientSessionId, label, connectedAtIso: at, lastSeenAtIso: at, viewport: width && height ? { width, height } : undefined };
    this.#clients.set(clientSessionId, client);
    this.journal.append("client.registered", { ...client, userAgent: str(body.userAgent, 300), pageUrl: str(body.pageUrl, 300) });
    this.#notify();
    return client;
  }

  touchClient(id: string): void { const c = this.#clients.get(id); if (c) c.lastSeenAtIso = new Date().toISOString(); }

  #client(id: unknown): ClientView & { label: string } {
    const c = typeof id === "string" ? this.#clients.get(id) : undefined;
    if (!c) throw Object.assign(new Error("Unknown clientSessionId; reload the HMI page"), { status: 409 });
    return c;
  }

  publishTargets(body: Record<string, unknown>): { count: number } {
    const client = this.#client(body.clientSessionId);
    const route = str(body.route, 40) ?? "";
    const vp = body.viewport as Record<string, unknown> | undefined;
    const targets = (Array.isArray(body.targets) ? body.targets : []).slice(0, 100).flatMap((t: Record<string, unknown>) => {
      const id = str(t.id, 80), x = num(t.x), y = num(t.y), w = num(t.width), h = num(t.height);
      return id && ID.test(id) && x !== undefined && y !== undefined && w !== undefined && h !== undefined ? [{ id, label: str(t.label, 80) ?? id, x, y, width: w, height: h, enabled: t.enabled === true, route }] : [];
    });
    this.#targets.set(client.clientSessionId, { route, viewport: { width: num(vp?.width) ?? 0, height: num(vp?.height) ?? 0 }, publishedAtIso: new Date().toISOString(), targets });
    return { count: targets.length };
  }

  targets(clientSessionId: string) { return this.#targets.get(clientSessionId); }

  /** Browser input that reached a page control. Proves delivery to the page only. */
  recordInput(body: Record<string, unknown>): string {
    const client = this.#client(body.clientSessionId);
    const target = str(body.target, 80) ?? "unknown";
    const record = this.journal.append("ui.input", { clientSessionId: client.clientSessionId, target, isTrusted: body.isTrusted === true, x: num(body.x), y: num(body.y),
      clientAtIso: str(body.atIso, 40), route: str(body.route, 40) });
    const reference = HmiJournal.ref(record);
    // Correlate with an outstanding agent request for the same client and target.
    for (const action of [...this.#agentActions.values()].reverse()) {
      if (action.clientSessionId === client.clientSessionId && action.targetId === target && !action.pageInput && action.status !== "inconclusive"
        && Date.parse(record.atIso) - Date.parse(action.requestedAtIso) < 10_000) {
        action.pageInput = { reference, atIso: record.atIso, isTrusted: body.isTrusted === true, hitTarget: target };
        this.journal.append("agent.action.page_input", { reference: action.reference, pageInput: action.pageInput });
        break;
      }
    }
    return reference;
  }

  async submitCommand(body: Record<string, unknown>): Promise<CommandView> {
    const client = typeof body.clientSessionId === "string" ? this.#client(body.clientSessionId) : undefined;
    const input = body.input as Record<string, unknown> | undefined;
    const uiActionRef = input && client ? this.recordInput({ ...input, clientSessionId: client.clientSessionId }) : undefined;
    const agent = uiActionRef ? [...this.#agentActions.values()].find(a => a.pageInput?.reference === uiActionRef) : undefined;
    const request: CommandRequest = { requestId: String(body.requestId ?? ""), action: body.action as CommandAction,
      origin: agent ? "agent_seam" : body.origin === "test" ? "test" : "operator_browser", clientSessionId: client?.clientSessionId, target: str(body.target, 80),
      uiActionRef, agentActionRef: agent?.reference };
    if (agent) { agent.commandRequestId = request.requestId; }
    return this.commands.submit(request);
  }

  recordRendered(body: Record<string, unknown>): void {
    const client = this.#client(body.clientSessionId);
    this.journal.append("ui.rendered", { clientSessionId: client.clientSessionId, requestId: str(body.requestId, 100), outcomeShown: str(body.outcome, 20), text: str(body.text, 200), clientAtIso: str(body.atIso, 40) });
  }

  reviewAlarm(body: Record<string, unknown>) {
    const client = typeof body.clientSessionId === "string" ? this.#client(body.clientSessionId) : undefined;
    return this.alarms.review(String(body.id ?? ""), client?.clientSessionId);
  }

  queryAlarms(filter: AlarmFilter) { return { ...this.alarms.query(filter), persistence: this.alarms.persistence }; }

  // ---- Controlled-browser operation seam (requested action → delivered input → screen → PLC) ----

  requestAgentAction(body: Record<string, unknown>): AgentActionView {
    const client = this.#client(body.clientSessionId);
    const targetId = str(body.targetId, 80) ?? "";
    const layout = this.#targets.get(client.clientSessionId);
    const rect = layout?.targets.find(t => t.id === targetId);
    const action: AgentActionView = { reference: `hmi-agent-action:${this.serviceSessionId}:${++this.#agentSequence}`, requester: (str(body.requester, 60) ?? "agent").replace(/[^A-Za-z0-9 _.:-]/g, ""),
      targetId, clientSessionId: client.clientSessionId, requestedAtIso: new Date().toISOString(), targetRect: rect,
      status: rect && rect.enabled ? "requested" : "inconclusive",
      detail: !rect ? `Target ${targetId} is not published by ${client.clientSessionId} (route ${layout?.route ?? "unknown"})` : !rect.enabled ? `Target ${targetId} is disabled on screen` : "Requested; not yet delivered to the browser" };
    this.#agentActions.set(action.reference, action);
    this.journal.append("agent.action.requested", action as unknown as Record<string, unknown>);
    return structuredClone(action);
  }

  agentActionDelivered(body: Record<string, unknown>): AgentActionView {
    const action = this.#agentAction(body.reference);
    action.delivered = { atIso: str(body.atIso, 40) ?? new Date().toISOString(), x: num(body.x) ?? -1, y: num(body.y) ?? -1, via: str(body.via, 120) ?? "unknown", browserSession: str(body.browserSession, 120) };
    action.status = "delivered"; action.detail = "Input delivered to the controlled browser. Page receipt, screen result and PLC acknowledgement are separate records.";
    this.journal.append("agent.action.delivered", { reference: action.reference, delivered: action.delivered });
    return structuredClone(action);
  }

  agentActionObserved(body: Record<string, unknown>): AgentActionView {
    const action = this.#agentAction(body.reference);
    action.screen = { frameRef: str(body.frameRef, 200) ?? "", capturedAtIso: str(body.capturedAtIso, 40) ?? "", sha256: str(body.sha256, 64), renderedStatus: str(body.renderedStatus, 200) };
    action.status = "observed";
    this.journal.append("agent.action.screen", { reference: action.reference, screen: action.screen, commandRequestId: action.commandRequestId });
    return structuredClone(action);
  }

  agentAction(reference: string): AgentActionView | undefined { const a = this.#agentActions.get(reference); return a && structuredClone(a); }

  #agentAction(reference: unknown): AgentActionView {
    const a = typeof reference === "string" ? this.#agentActions.get(reference) : undefined;
    if (!a) throw Object.assign(new Error("Unknown agent action reference"), { status: 404 });
    return a;
  }

  fixtureControl(control: FixtureControl): void {
    if (this.source.kind !== "fixture") throw Object.assign(new Error("Fixture controls exist only in fixture mode"), { status: 403 });
    this.source.plc.control(control);
    this.journal.append("fixture.control", control as Record<string, unknown>);
    this.#notify();
  }
}
