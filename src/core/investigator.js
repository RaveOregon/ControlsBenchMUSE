export class Investigator {
  constructor(engine) {
    this.engine = engine;
    this.active = false;
    this.phase = "idle";
    this.phaseStartedAt = 0;
    this.baselineCount = 0;
    this.chatterRunState = null;
  }

  start(now) {
    this.active = true;
    this.baselineCount = this.engine.outputs.packageCount;
    this.transition("baseline", now, "First establish a known-good closed-loop transfer before injecting faults.");
    this.engine.pulse("start", 300);
  }

  stop() {
    this.active = false;
    this.phase = "idle";
    this.engine.setFault("none");
  }

  transition(next, now, reason) {
    this.phase = next;
    this.phaseStartedAt = now;
    this.engine.record("agent", next === "complete" ? "pass" : "active", reason, {
      phase: next
    });
  }

  step(now) {
    if (!this.active) return;
    const elapsed = now - this.phaseStartedAt;
    const { outputs } = this.engine;

    if (this.phase === "baseline" && outputs.packageCount > this.baselineCount) {
      this.engine.record("observation", "pass", "Baseline package completed; the process is responsive to PLC output.");
      this.engine.setFault("chatter");
      this.chatterRunState = outputs.conveyorRun;
      this.transition("chatter", now, "A nominal cycle passed. Next, probe entry-sensor noise because the specification identifies chatter as plausible.");
      return;
    }

    if (this.phase === "chatter" && elapsed >= 4500) {
      const passed = outputs.conveyorRun === this.chatterRunState && !outputs.jamAlarm;
      this.engine.record("assertion", passed ? "pass" : "fail", passed
        ? "Sensor chatter caused no false jam or unsafe stop."
        : "Sensor chatter changed the run state or caused a false jam.");
      this.engine.setFault("none");
      this.transition("settle", now, "Noise behavior is characterized. Let the process settle before a sustained obstruction test.");
      return;
    }

    if (this.phase === "settle" && elapsed >= 1800) {
      this.engine.setFault("stuck-entry");
      this.transition("stuck-entry", now, "Inject a sustained blocked sensor to verify the specified three-second jam response.");
      return;
    }

    if (this.phase === "stuck-entry" && outputs.jamAlarm) {
      const tripMs = elapsed;
      const passed = tripMs >= 2900 && tripMs <= 3400;
      this.engine.record("assertion", passed ? "pass" : "fail", `Jam alarm latched after ${(tripMs / 1000).toFixed(1)} s.`, {
        expected: "3.0 s ± 0.4 s",
        observedMs: tripMs
      });
      this.engine.pulse("reset", 300);
      this.transition("blocked-reset", now, "Try Reset while the obstruction remains. The controller should reject it.");
      return;
    }

    if (this.phase === "blocked-reset" && elapsed >= 900) {
      const passed = outputs.jamAlarm;
      this.engine.record("assertion", passed ? "pass" : "fail", passed
        ? "Reset was correctly rejected while the entry sensor remained blocked."
        : "Jam cleared while the obstruction was still present.");
      this.engine.setFault("none");
      this.engine.pulse("reset", 300);
      this.transition("recovery", now, "Clear the obstruction, reset the latch, and verify that operation can resume.");
      return;
    }

    if (this.phase === "recovery" && elapsed >= 700 && !outputs.jamAlarm) {
      this.engine.pulse("start", 300);
      this.transition("resume", now, "The jam latch cleared. Restart and require one completed package as recovery proof.");
      this.baselineCount = outputs.packageCount;
      return;
    }

    if (this.phase === "resume" && outputs.packageCount > this.baselineCount) {
      this.engine.record("assertion", "pass", "Conveyor completed a package after fault recovery.");
      this.transition("complete", now, "Investigation complete: nominal operation, noise tolerance, jam timing, reset interlock, and recovery are evidenced.");
      this.active = false;
    }
  }
}
