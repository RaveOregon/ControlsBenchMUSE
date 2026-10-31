import { randomBytes } from "node:crypto";
import { BudgetLimitError } from "../proof/budget-guard.ts";
import type { CampaignEvent, Decision, Experiment, Finding, Outcome, Provenance, ToolCall, ToolResult } from "./contracts.ts";
import { CAMPAIGN_VERSION, toolSchemas, validate, validateDecision } from "./contracts.ts";
import { CampaignLedger, digest, report } from "./ledger.ts";
import { CampaignBudget } from "./budget.ts";
import { bounded, DeadlineError, systemClock } from "./clock.ts";
import type { Clock } from "./clock.ts";
import { CoordinatorCampaignDriver, ToolFailure } from "./driver.ts";
import type { HmiAdapter, SimulationExit } from "./driver.ts";
import type { AgentContext, CampaignProvider, ProviderReply } from "./provider.ts";

export interface CampaignOptions {
  ledger: CampaignLedger; provider: CampaignProvider; provenance: Provenance;
  evidenceClass: "fake_connector" | "preserved_live_plc" | "live_plc";
  claimBoundary: string; spec: string; signals: unknown; categories: string[];
  driver?: CoordinatorCampaignDriver; budget?: CampaignBudget; clock?: Clock;
  diagnosisMode?: "known" | "blind"; hmi?: HmiAdapter;
  paidAuthorized?: boolean; maxTurns?: number; toolTimeoutMs?: number;
}
const physicalTools = new Set(["introduce_carton", "assign_route", "set_downstream_readiness", "inject_fault", "clear_fault"]);
const blindAllowed = new Set(["world.raw_image", "plc.acknowledged", "plc.output", "hmi.evidence", "observation", "discrepancy"]);
const terminal = new Set(["stopped", "completed", "failed"]);
const usedProviders = new WeakSet<CampaignProvider>();

export class CampaignRuntime {
  readonly options: CampaignOptions;
  readonly ledger: CampaignLedger;
  readonly budget: CampaignBudget;
  readonly clock: Clock;
  #abort = new AbortController();
  #agent?: Promise<void>;
  #results: ToolResult[] = [];
  #turns = 0;
  #started = false;
  #automatic = true;
  #toolBusy = false;
  #pending = new Set<Promise<unknown>>();
  #finalizing?: Promise<void>;
  #budgetBlocked = false;
  #hiddenSetup = false;
  constructor(options: CampaignOptions) {
    if (!options.categories.length) throw new Error("Select campaign scope before Start Campaign");
    if (options.provider.paid && !options.paidAuthorized) throw new Error("Paid provider requires explicit final-checkpoint authorization");
    if (options.diagnosisMode === "blind" && usedProviders.has(options.provider)) throw new Error("Blind diagnosis requires a fresh provider instance/context");
    usedProviders.add(options.provider);
    this.options = options; this.ledger = options.ledger; this.clock = options.clock ?? systemClock;
    this.budget = options.budget ?? new CampaignBudget(this.ledger);
    this.ledger.append("campaign.state", { state: "preparing", reason: "Campaign configured; PLC build immutable" });
    this.ledger.append("provenance.recorded", { provenance: options.provenance, evidenceClass: options.evidenceClass, claimBoundary: options.claimBoundary });
    if (options.driver) options.driver.onFault = error => { void this.pause(`Connector ${error.outcome}; inspect evidence before recovery`); };
  }
  get status() { return this.ledger.state.status; }
  get diagnosisMode() { return this.options.diagnosisMode ?? "known"; }
  async start(automaticClock = true): Promise<void> {
    if (this.#started || this.status !== "preparing") throw new Error("Start Campaign can authorize this run only once");
    this.#started = true; this.#automatic = automaticClock;
    this.ledger.append("campaign.authorized", { categories: this.options.categories, diagnosisMode: this.diagnosisMode });
    try {
      await this.options.driver?.initialize();
      if (this.status !== "preparing") return; // Stop may have drained initialization while it was pending.
      this.ledger.append("campaign.state", { state: "running", reason: "Selected scope authorized, including adaptive investigations" });
      this.options.driver?.start(automaticClock);
    } catch (error) { await this.#finalize("failed", `Initialization failed: ${this.#message(error)}`); }
  }
  runAgent(): Promise<void> {
    if (this.#hiddenSetup) return Promise.reject(new Error("Hidden setup must finish before the fresh diagnosing context starts"));
    if (this.#agent) return this.#agent;
    this.#agent = this.#loop().finally(() => { this.#agent = undefined; }); return this.#agent;
  }
  async #loop(): Promise<void> {
    let repeats = 0, lastFingerprint = "";
    while (this.status === "running") {
      if (++this.#turns > (this.options.maxTurns ?? 40)) { await this.pause("Agent turn limit reached; state preserved"); return; }
      const basedOnRevision = this.ledger.state.revision;
      const checkId = this.ledger.state.activeExperiment ?? "planning";
      const began = this.clock.now();
      let lease;
      try { lease = this.budget.reserve(this.options.provider.estimatedRequestUsd, checkId, began); }
      catch (error) { await this.#budgetStop(error); return; }
      this.ledger.append("agent.request", { requestId: lease.id, phase: "started", model: this.options.provider.id, experimentId: checkId, elapsedMs: 0 });
      this.ledger.append("agent.activity", { phase: "reasoning", summary: "Choosing the next experiment action from recorded evidence", requestId: lease.id });
      let reply: ProviderReply | undefined, failure: unknown;
      try {
        reply = await bounded(signal => this.options.provider.decide(this.agentContext(), signal), this.budget.guard.limits.requestTimeoutMs, this.clock, this.#abort.signal);
        if (reply.rawResponse) this.ledger.append("agent.response", { requestId: lease.id, responseHash: digest(reply.rawResponse), response: reply.rawResponse }, "truth");
        if (reply.error) failure = new Error(reply.error);
      } catch (error) { failure = error; }
      const phase = failure ? (failure instanceof DeadlineError ? "timed_out" : this.#abort.signal.aborted ? "cancelled" : "failed") : "completed";
      this.ledger.append("agent.request", { requestId: lease.id, phase, model: this.options.provider.id, experimentId: checkId,
        elapsedMs: this.clock.now() - began, ...(reply?.usage ? { usage: reply.usage } : {}), ...(reply?.responseId ? { responseId: reply.responseId } : {}) });
      try {
        this.budget.settle(lease, checkId, reply?.costUsd ?? this.options.provider.estimatedRequestUsd,
          reply?.costUsd === 0 ? "fake_zero" : reply?.costUsd === undefined ? "conservative_reservation" : "provider_reported",
          phase === "timed_out" ? "timed_out" : failure ? "failed" : "settled");
      } catch (error) { await this.#budgetStop(error); return; }
      if (this.status !== "running") return;
      if (failure) { await this.pause(`Model ${phase}: ${this.#message(failure)}; no automatic retry`); return; }
      try {
        const decision = validateDecision(reply!.decision);
        const fingerprint = digest({ plan: decision.plan ?? null, complete: decision.completeExperiment ?? null,
          calls: decision.calls.map(c => ({ name: c.name, arguments: c.arguments })) });
        repeats = fingerprint === lastFingerprint ? repeats + 1 : 0; lastFingerprint = fingerprint;
        if (repeats >= 2) { await this.pause("Repeated agent decision; state preserved"); return; }
        await this.applyDecision(decision, basedOnRevision);
      } catch (error) { await this.pause(`Invalid agent decision: ${this.#message(error)}; no automatic retry`); return; }
    }
  }
  agentContext(): AgentContext {
    const s = this.ledger.state;
    return { schemaVersion: CAMPAIGN_VERSION, spec: this.options.spec, signals: structuredClone(this.options.signals),
      capabilities: this.options.driver?.binding.describe ?? { readOnly: true },
      state: { status: s.status, revision: s.revision, ...(s.plan ? { plan: s.plan } : {}), experiments: s.experiments,
        ...(s.activeExperiment ? { activeExperiment: s.activeExperiment } : {}) },
      evidence: this.visibleEvidence(100), results: structuredClone(this.#results), diagnosisMode: this.diagnosisMode };
  }
  visibleEvidence(limit = Number.MAX_SAFE_INTEGER): CampaignEvent[] {
    return this.ledger.recentEvents(limit, e => e.visibility === "public" && (this.diagnosisMode !== "blind" || blindAllowed.has(e.type)));
  }
  async applyDecision(decision: Decision, basedOnRevision: number): Promise<void> {
    validateDecision(decision);
    if (this.status !== "running" || basedOnRevision !== this.ledger.state.revision) throw new ToolFailure("stale", "Agent decision revision is no longer current");
    this.ledger.append("agent.activity", { phase: "decision", summary: decision.summary });
    if (decision.plan) {
      for (const e of decision.plan.experiments) this.#validateExperiment(e);
      if (new Set(decision.plan.experiments.map(e => e.id)).size !== decision.plan.experiments.length) throw new Error("Duplicate experiment ID in plan");
      const all = Object.values(this.ledger.state.experiments).map(({ id, objective, category, requirements }) => ({ id, objective, category, requirements }));
      for (const e of decision.plan.experiments) {
        const existing = this.ledger.state.experiments[e.id];
        if (!existing) all.push(e);
        else if (digest({ id: existing.id, objective: existing.objective, category: existing.category, requirements: existing.requirements }) !== digest(e)) throw new Error("Cannot rewrite an existing experiment; add a follow-up");
      }
      if (all.length > 40) throw new Error("Campaign experiment bound reached");
      this.ledger.append(this.ledger.state.plan ? "plan.updated" : "plan.created", { objective: decision.plan.objective, experiments: all });
      for (const e of decision.plan.experiments) if (!this.ledger.state.experiments[e.id]) this.ledger.append("experiment.proposed", { ...e });
    }
    if (decision.completeExperiment) this.ledger.append("experiment.completed", decision.completeExperiment);
    if (!this.ledger.state.activeExperiment) {
      const next = Object.values(this.ledger.state.experiments).find(e => e.status === "proposed");
      if (next) this.ledger.append("experiment.started", { id: next.id });
    }
    this.#results = [];
    for (const call of decision.calls) {
      if (this.status !== "running") break;
      this.#results.push(await this.executeTool(call, this.ledger.state.revision));
    }
  }
  executeTool(call: ToolCall, basedOnRevision = this.ledger.state.revision): Promise<ToolResult> {
    const work = this.#execute(call, basedOnRevision);
    this.#pending.add(work); void work.finally(() => this.#pending.delete(work)).catch(() => {}); return work;
  }
  async #execute(call: ToolCall, basedOnRevision: number): Promise<ToolResult> {
    // Journal intent before validation or any side effect. Reused IDs fail without another execution.
    this.ledger.append("action.requested", { actionId: call.id, name: call.name, arguments: call.arguments, basedOnRevision,
      experimentId: this.ledger.state.activeExperiment ?? "campaign" }, this.diagnosisMode === "blind" && call.name.includes("fault") ? "truth" : "public");
    let result: ToolResult, finish = false;
    const alreadyBusy = this.#toolBusy;
    try {
      if (!Object.hasOwn(toolSchemas, call.name)) throw new ToolFailure("rejected", "Unknown campaign tool");
      validate(toolSchemas[call.name], call.arguments);
      if (this.status !== "running" || basedOnRevision !== this.ledger.state.revision) throw new ToolFailure("stale", "Campaign state revision changed or campaign is held");
      if (alreadyBusy) throw new ToolFailure("rejected", "Another campaign tool is pending");
      this.#toolBusy = true;
      const timeout = call.name === "wait_for_condition" ? Number(call.arguments.timeoutMs) + 100
        : call.name === "observe_for_duration" ? Number(call.arguments.durationMs) + 100
        : this.options.toolTimeoutMs ?? 10_000;
      const value = await bounded(signal => this.#dispatch(call, signal), timeout, this.clock, this.#abort.signal);
      result = { actionId: call.id, status: "applied", message: value.message, evidenceRefs: value.evidenceRefs, ...(value.value !== undefined ? { value: value.value } : {}) };
      finish = call.name === "finish_campaign";
    } catch (error) {
      result = { actionId: call.id, status: this.options.driver?.failure?.outcome ?? (error instanceof ToolFailure ? error.outcome : error instanceof DeadlineError ? "timed_out" : this.#abort.signal.aborted ? "inconclusive" : "rejected"),
        message: this.#message(error), evidenceRefs: [] };
    } finally { if (!alreadyBusy) this.#toolBusy = false; }
    this.ledger.append(`action.${result.status}` as "action.applied", { ...result });
    if (result.status === "applied" && call.name === "branch_or_reset_world" && call.arguments.mode === "reset") {
      await this.pause("Simulation reset to zero; start a new campaign to initialize a new world");
    }
    // Do not await finalization here (this action is itself in the pending set).
    if (finish) queueMicrotask(() => { void this.#finalize("completed", String(call.arguments.summary)); });
    return result;
  }
  async #dispatch(call: ToolCall, signal: AbortSignal): Promise<{ message: string; evidenceRefs: string[]; value?: unknown }> {
    const p = call.arguments, driver = this.options.driver;
    if (physicalTools.has(call.name)) {
      if (!this.ledger.state.activeExperiment) throw new ToolFailure("rejected", "Start an experiment before a world intervention");
      if (!driver) throw new ToolFailure("inconclusive", "Preserved evidence is read-only; no world or PLC action was applied");
      if (this.diagnosisMode === "blind" && call.name.includes("fault")) throw new ToolFailure("rejected", "Blind diagnosis cannot author or inspect hidden fault truth");
      let injectedTruthRef: string | undefined;
      if (call.name === "inject_fault") {
        // Resolve/validate before committing fault truth, while preserving the already journaled intent.
        driver.binding.translate(call);
        const salt = randomBytes(24).toString("hex"), commitment = digest({ truth: call.arguments, salt });
        this.ledger.append("fault.committed", { commitment });
        injectedTruthRef = this.ledger.append("fault.truth", { commitment, truth: call.arguments, salt }, "truth").id;
      }
      const evidenceRefs = await driver.apply(call, signal);
      return { message: "World control executed and complete raw image acknowledged by connector", evidenceRefs,
        ...(injectedTruthRef ? { value: { injectedTruthRef } } : {}) };
    }
    switch (call.name) {
      case "inspect_spec": return { message: "Accepted specification", evidenceRefs: [], value: this.options.spec };
      case "inspect_signal_contract": return { message: "Configured signal contract", evidenceRefs: [], value: this.options.signals };
      case "inspect_recent_evidence": return { message: "Recorded evidence with original IDs", evidenceRefs: [], value: this.visibleEvidence(Number(p.limit)) };
      case "wait_for_condition": case "observe_for_duration": return this.#wait(call, signal);
      case "branch_or_reset_world": {
        if (!driver) throw new ToolFailure("inconclusive", "No active world to branch/reset");
        if (p.mode === "reset") {
          const refs = await driver.reset();
          // Reset remains held; a new world instance/campaign is required before further evolution.
          return { message: "Complete zero raw image acknowledged; simulation remains active", evidenceRefs: refs };
        }
        const snapshot = driver.lastSnapshot;
        if (!snapshot) throw new ToolFailure("inconclusive", "No confirmed snapshot");
        const e = this.ledger.append("world.branch", { label: p.label, snapshot, rawImage: driver.lastImage }, "truth");
        return { message: "Branch checkpoint preserved; no live world replacement", evidenceRefs: [e.id] };
      }
      case "request_hmi_action": case "capture_hmi_evidence": {
        if (!this.options.hmi) throw new ToolFailure("inconclusive", "HMI capability unavailable; not visually tested");
        const captured = await this.options.hmi.perform(call, signal);
        if (signal.aborted) throw new ToolFailure("inconclusive", "Late HMI response; reconcile before retrying");
        const e = call.name === "request_hmi_action"
          ? this.ledger.append("hmi.action", { actionId: call.id, action: p.action, ...captured })
          : this.ledger.append("hmi.evidence", { actionId: call.id, kind: p.kind, ...captured });
        return { message: "HMI adapter evidence captured; PLC effect requires separate observation", evidenceRefs: [e.id] };
      }
      case "create_followup_experiment": {
        const e = p.experiment as unknown as Experiment; this.#validateExperiment(e);
        const existing = Object.values(this.ledger.state.experiments);
        if (existing.length >= 40 || existing.some(old => old.id === e.id || old.objective.trim().toLowerCase() === e.objective.trim().toLowerCase())) throw new ToolFailure("rejected", "Follow-up must be new and fit the experiment bound");
        this.#requireVisibleRefs(p.evidenceRefs as string[]);
        const addition = this.ledger.append("followup.added", p);
        this.ledger.append("experiment.proposed", { ...e });
        this.ledger.append("plan.updated", { objective: this.ledger.state.plan?.objective ?? e.objective,
          experiments: Object.values(this.ledger.state.experiments).map(({ id, objective, category, requirements }) => ({ id, objective, category, requirements })) });
        return { message: "Provider-authored adaptive investigation added within authorized scope", evidenceRefs: [addition.id] };
      }
      case "record_finding": {
        const finding = p as unknown as Finding;
        this.#requireVisibleRefs(finding.claims.map(c => c.evidenceId));
        if (this.diagnosisMode === "blind" && finding.injectedTruthRefs.length) throw new ToolFailure("rejected", "Blind context cannot cite hidden truth");
        const e = this.ledger.append("finding.created", p);
        return { message: "Finding recorded with exact PLC claims; inference remains unverified", evidenceRefs: [e.id] };
      }
      case "finish_campaign": {
        const experiments = Object.values(this.ledger.state.experiments);
        if (!experiments.length || experiments.some(e => e.status !== "completed")) throw new ToolFailure("rejected", "Completion oracle requires all proposed experiments completed with evidence");
        if (!Object.keys(this.ledger.state.findings).length) throw new ToolFailure("rejected", "Completion oracle requires a grounded finding");
        return { message: "Deterministic completion checks passed; finalizing evidence", evidenceRefs: Object.values(this.ledger.state.findings).flatMap(f => f.claims.map(c => c.evidenceId)) };
      }
    }
    throw new ToolFailure("rejected", "Unsupported tool");
  }
  #wait(call: ToolCall, signal: AbortSignal): Promise<{ message: string; evidenceRefs: string[] }> {
    const driver = this.options.driver;
    if (!driver) return Promise.reject(new ToolFailure("inconclusive", "Cannot wait for future PLC behavior in preserved evidence"));
    const p = call.arguments, condition = call.name === "wait_for_condition";
    if (condition && !driver.coordinator.world.manifest.signals.some(s => s.direction === "plc_to_world" && s.id === p.signal)) return Promise.reject(new ToolFailure("rejected", "Condition must name a declared observed PLC output"));
    const began = this.clock.now(), timeout = Number(condition ? p.timeoutMs : p.durationMs), startSequence = this.ledger.state.sequence;
    this.ledger.append("agent.activity", { phase: condition ? "waiting_condition" : "observing", summary: condition ? `Waiting for ${p.signal} = ${p.equals}; deadline ${timeout} ms` : `Observing for ${timeout} ms` });
    return new Promise((resolve, reject) => {
      let finished = false;
      const cleanup = () => { finished = true; unsubscribe(); this.clock.clearTimer(timer); signal.removeEventListener("abort", abort); };
      const fail = (error: unknown) => { if (!finished) { cleanup(); reject(error); } };
      const abort = () => fail(new ToolFailure("inconclusive", "Observation interrupted"));
      const check = () => {
        if (finished) return;
        if (driver.quarantined || driver.evidenceAgeMs > driver.operationTimeoutMs) { fail(new ToolFailure("stale", "Connector evidence became stale")); return; }
        const evidence = this.ledger.eventsSince(startSequence, "plc.output");
        const matched = condition ? evidence.find(e => (e.data.values as Record<string, unknown>)[String(p.signal)] === p.equals) : undefined;
        if (matched || (!condition && this.clock.now() - began >= timeout && evidence.length)) {
          cleanup(); const refs = matched ? [matched.id] : [evidence[0].id, evidence.at(-1)!.id];
          const event = this.ledger.append("observation", { summary: condition ? `Observed ${p.signal} = ${p.equals}` : `Observation window ${timeout} ms completed`, evidenceRefs: refs });
          resolve({ message: "Fresh connector evidence observed", evidenceRefs: [event.id, ...refs] });
        }
      };
      const unsubscribe = driver.subscribe(check);
      const timer = this.clock.setTimer(() => {
        check();
        if (!finished) {
          const evidence = this.ledger.eventsSince(startSequence, "plc.output");
          if (condition && evidence.length) this.ledger.append("discrepancy", { summary: "Expected PLC condition was not observed within the bounded window",
            evidenceRefs: [evidence.at(-1)!.id], expected: { signal: p.signal, equals: p.equals }, observed: evidence.at(-1)!.data.values });
          fail(new ToolFailure(condition ? "timed_out" : "inconclusive", "Observation deadline reached without sufficient matching evidence"));
        }
      }, timeout);
      signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    });
  }
  async pause(reason = "Engineer paused campaign"): Promise<void> {
    if (this.status !== "running") return;
    this.ledger.append("campaign.state", { state: "paused", reason }); this.#abort.abort();
    await this.options.driver?.hold();
  }
  resume(): void {
    if (this.status !== "paused" || this.#budgetBlocked || this.#toolBusy || this.#agent) throw new Error("Campaign cannot resume while blocked or operations are pending");
    this.options.driver?.start(this.#automatic); this.#abort = new AbortController();
    this.ledger.append("campaign.state", { state: "running", reason: "Engineer resumed held campaign" });
  }
  stop(reason = "Engineer stopped campaign"): Promise<void> { return this.#finalize("stopped", reason); }
  async resetSimulation(): Promise<void> {
    if (!this.options.driver) throw new ToolFailure("inconclusive", "No active simulation");
    await this.pause("Reset Simulation requested"); await this.options.driver.reset();
  }
  async exitSimulation(adapter: SimulationExit): Promise<void> {
    if (!terminal.has(this.status)) await this.stop("Exit Simulation requested");
    if (!this.options.driver) throw new ToolFailure("inconclusive", "No active simulation");
    await this.options.driver.exit(adapter);
  }
  reviewFinding(id: string, review: "accepted" | "rerun_requested", reason: string): void {
    this.ledger.append(review === "accepted" ? "finding.accepted" : "finding.rerun_requested", { id, reason });
  }
  injectHiddenFault(call: ToolCall): Promise<void> {
    if (this.#hiddenSetup) return Promise.reject(new Error("Hidden setup already pending"));
    this.#hiddenSetup = true;
    const work = this.#injectHidden(call).finally(() => { this.#hiddenSetup = false; });
    this.#pending.add(work); void work.finally(() => this.#pending.delete(work)).catch(() => {}); return work;
  }
  async #injectHidden(call: ToolCall): Promise<void> {
    if (this.diagnosisMode !== "blind" || this.#turns || !this.options.driver || call.name !== "inject_fault") throw new Error("Hidden injection requires a fresh blind context before its first provider request");
    validate(toolSchemas.inject_fault, call.arguments);
    const salt = randomBytes(24).toString("hex"), commitment = digest({ truth: call.arguments, salt });
    this.ledger.append("fault.committed", { commitment });
    this.ledger.append("fault.truth", { commitment, truth: call.arguments, salt }, "truth");
    this.ledger.append("action.requested", { actionId: call.id, name: call.name, arguments: call.arguments,
      basedOnRevision: this.ledger.state.revision, experimentId: "blind-setup" }, "truth");
    try {
      const refs = await bounded(signal => this.options.driver!.apply(call, signal), this.options.toolTimeoutMs ?? 10_000, this.clock, this.#abort.signal);
      this.ledger.append("action.applied", { actionId: call.id, status: "applied", message: "Hidden setup control acknowledged", evidenceRefs: refs }, "truth");
    } catch (error) {
      const status = error instanceof ToolFailure ? error.outcome : error instanceof DeadlineError ? "timed_out" : "inconclusive";
      this.ledger.append(`action.${status}`, { actionId: call.id, status, message: "Hidden setup did not complete; reconcile before diagnosis", evidenceRefs: [] }, "truth");
      throw error;
    }
  }
  getReport() { return report(this.ledger.events); }
  async #finalize(status: "stopped" | "completed" | "failed", summary: string): Promise<void> {
    if (this.#finalizing) return this.#finalizing;
    if (terminal.has(this.status)) return;
    this.#finalizing = (async () => {
      this.#abort.abort();
      // Transition immediately to prevent another model turn or action from entering.
      this.ledger.append("campaign.state", { state: status, reason: summary });
      await this.options.driver?.hold(true);
      await Promise.allSettled([...this.#pending]);
      // A running provider owns final cost settlement; its cancellation is bounded.
      await this.#agent;
      this.ledger.append("report.finalized", { summary, throughSequence: this.ledger.state.sequence });
    })();
    return this.#finalizing;
  }
  async #budgetStop(error: unknown) {
    this.#budgetBlocked = true;
    this.ledger.append("budget.hard_stop", { code: error instanceof BudgetLimitError ? error.code : "budget_failure", message: this.#message(error) });
    await this.pause("Budget hard stop; last valid world and image preserved; no automatic retry");
  }
  #validateExperiment(e: Experiment) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,150}$/.test(e.id) || ["constructor", "prototype", "__proto__"].includes(e.id)) throw new ToolFailure("rejected", "Invalid experiment ID");
    if (!this.options.categories.includes(e.category)) throw new ToolFailure("rejected", `Experiment category ${e.category} is outside authorized scope`);
  }
  #requireVisibleRefs(refs: string[]) {
    if (!refs.every(id => { const e = this.ledger.getEvent(id); return e?.visibility === "public" && (this.diagnosisMode !== "blind" || blindAllowed.has(e.type)); })) throw new ToolFailure("rejected", "Evidence is absent or hidden from this diagnosis context");
  }
  #message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
}
