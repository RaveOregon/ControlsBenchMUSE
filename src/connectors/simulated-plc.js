export class SimulatedPlcConnector {
  constructor({ jamTimeoutMs = 3000 } = {}) {
    this.jamTimeoutMs = jamTimeoutMs;
    this.inputs = { start: false, stop: false, reset: false, entryPE: false, exitPE: false };
    this.outputs = { conveyorRun: false, jamAlarm: false, packageCount: 0 };
    this.entryActiveSince = null;
    this.previousExit = false;
  }

  describe() {
    return {
      id: "simulated-plc",
      label: "PLC emulator",
      transport: "in-process",
      realController: false,
      scanMs: 20
    };
  }

  writeInputs(values) {
    this.inputs = { ...this.inputs, ...values };
  }

  scan(now) {
    if (this.inputs.stop) this.outputs.conveyorRun = false;
    if (this.inputs.start && !this.outputs.jamAlarm) this.outputs.conveyorRun = true;

    if (this.inputs.entryPE && this.outputs.conveyorRun) {
      this.entryActiveSince ??= now;
      if (now - this.entryActiveSince >= this.jamTimeoutMs) {
        this.outputs.jamAlarm = true;
        this.outputs.conveyorRun = false;
      }
    } else {
      this.entryActiveSince = null;
    }

    if (this.inputs.reset && !this.inputs.entryPE) {
      this.outputs.jamAlarm = false;
    }

    if (this.inputs.exitPE && !this.previousExit) this.outputs.packageCount += 1;
    this.previousExit = this.inputs.exitPE;
  }

  readOutputs() {
    return { ...this.outputs };
  }

  reset() {
    this.inputs = { start: false, stop: false, reset: false, entryPE: false, exitPE: false };
    this.outputs = { conveyorRun: false, jamAlarm: false, packageCount: 0 };
    this.entryActiveSince = null;
    this.previousExit = false;
  }
}
