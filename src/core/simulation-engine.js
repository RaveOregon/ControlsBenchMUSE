import { EventEmitter } from "node:events";
import { Investigator } from "./investigator.js";

const MAX_EVIDENCE = 120;

export class SimulationEngine extends EventEmitter {
  constructor(model, connector, { now = () => Date.now() } = {}) {
    super();
    this.model = structuredClone(model);
    this.connector = connector;
    this.now = now;
    this.running = false;
    this.startedAt = this.now();
    this.lastTickAt = this.startedAt;
    this.lastSpawnAt = this.startedAt - model.process.packageIntervalMs + 600;
    this.packages = [];
    this.nextPackageId = 1;
    this.fault = "none";
    this.pulses = new Map();
    this.inputs = { start: false, stop: false, reset: false, entryPE: false, exitPE: false };
    this.outputs = connector.readOutputs();
    this.evidence = [];
    this.investigator = new Investigator(this);
    this.record("system", "ready", `${model.name} model loaded.`, { connector: connector.describe() });
  }

  replaceModel(model, source = "bundled") {
    this.model = structuredClone(model);
    this.reset();
    this.record("model", "ready", `${model.name} compiled and loaded.`, { source });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTickAt = this.now();
    this.timer = setInterval(() => this.tick(), this.model.tickMs || 100);
    this.record("system", "active", "Closed-loop runtime started.");
  }

  stop() {
    if (!this.running) return;
    clearInterval(this.timer);
    this.running = false;
    this.record("system", "ready", "Runtime paused.");
  }

  reset() {
    this.investigator.stop();
    this.connector.reset?.();
    this.startedAt = this.now();
    this.lastTickAt = this.startedAt;
    this.lastSpawnAt = this.startedAt - this.model.process.packageIntervalMs + 600;
    this.packages = [];
    this.nextPackageId = 1;
    this.fault = "none";
    this.pulses.clear();
    this.inputs = { start: false, stop: false, reset: false, entryPE: false, exitPE: false };
    this.outputs = this.connector.readOutputs();
    this.evidence = [];
    this.record("system", "ready", "Runtime reset; evidence ledger cleared.");
  }

  pulse(signal, durationMs = 250) {
    this.pulses.set(signal, this.now() + durationMs);
  }

  setFault(fault) {
    if (this.fault === fault) return;
    this.fault = fault;
    this.record("fault", fault === "none" ? "ready" : "active", fault === "none"
      ? "Injected condition cleared."
      : `Injected condition: ${fault}.`);
  }

  startInvestigation() {
    if (!this.running) this.start();
    if (this.investigator.active) return;
    this.investigator.start(this.now());
  }

  record(kind, status, message, detail = {}) {
    const item = {
      id: crypto.randomUUID(),
      at: new Date(this.now()).toISOString(),
      elapsedMs: this.now() - this.startedAt,
      kind,
      status,
      message,
      detail
    };
    this.evidence.unshift(item);
    this.evidence.length = Math.min(this.evidence.length, MAX_EVIDENCE);
    this.emit("evidence", item);
  }

  tick() {
    const now = this.now();
    const deltaMs = Math.min(500, Math.max(0, now - this.lastTickAt));
    this.lastTickAt = now;

    for (const [signal, until] of this.pulses) {
      if (until <= now) this.pulses.delete(signal);
    }

    if (this.outputs.conveyorRun && now - this.lastSpawnAt >= this.model.process.packageIntervalMs) {
      this.packages.push({ id: this.nextPackageId++, position: 0 });
      this.lastSpawnAt = now;
    }

    if (this.outputs.conveyorRun) {
      const advance = deltaMs / this.model.process.beltTravelMs;
      for (const pkg of this.packages) pkg.position += advance;
      this.packages = this.packages.filter((pkg) => pkg.position <= 1.04);
    }

    const [entryStart, entryEnd] = this.model.process.entryWindow;
    const [exitStart, exitEnd] = this.model.process.exitWindow;
    let entryPE = this.packages.some((pkg) => pkg.position >= entryStart && pkg.position <= entryEnd);
    const exitPE = this.packages.some((pkg) => pkg.position >= exitStart && pkg.position <= exitEnd);

    if (this.fault === "stuck-entry") entryPE = true;
    if (this.fault === "chatter") entryPE = Math.floor(now / 160) % 2 === 0;

    this.inputs = {
      start: this.pulses.has("start"),
      stop: this.pulses.has("stop"),
      reset: this.pulses.has("reset"),
      entryPE,
      exitPE
    };

    this.connector.writeInputs(this.inputs);
    this.connector.scan(now);
    this.outputs = this.connector.readOutputs();
    this.investigator.step(now);
    this.emit("tick", this.snapshot());
  }

  snapshot() {
    const passed = this.evidence.filter((item) => item.kind === "assertion" && item.status === "pass").length;
    const failed = this.evidence.filter((item) => item.kind === "assertion" && item.status === "fail").length;
    return {
      runtime: {
        running: this.running,
        elapsedMs: this.now() - this.startedAt,
        fault: this.fault,
        phase: this.investigator.phase,
        investigationActive: this.investigator.active
      },
      model: {
        name: this.model.name,
        summary: this.model.summary,
        experimentCount: this.model.experiments?.length || 0
      },
      connector: this.connector.describe(),
      inputs: { ...this.inputs },
      outputs: { ...this.outputs },
      packages: this.packages.map((pkg) => ({ ...pkg })),
      evidence: this.evidence.slice(0, 40),
      score: { passed, failed }
    };
  }

  report() {
    const snapshot = this.snapshot();
    return {
      generatedAt: new Date(this.now()).toISOString(),
      subject: this.model.name,
      connector: this.connector.describe(),
      result: snapshot.score.failed ? "needs-investigation" : snapshot.score.passed ? "passed" : "incomplete",
      assertions: this.evidence.filter((item) => item.kind === "assertion").reverse(),
      decisions: this.evidence.filter((item) => item.kind === "agent").reverse()
    };
  }
}
