export const demoSpecification = `
The machine is a single-zone package conveyor. The operator starts and stops it from an HMI.
Packages arrive at the infeed, cross an entry photoeye, travel on the belt, and cross an exit
photoeye. The controller must run the conveyor after Start, stop immediately after Stop, count
completed packages, detect an entry photoeye that remains blocked for 3 seconds while running,
latch a jam alarm, and require the obstruction to clear before Reset can restore operation.
The entry photoeye may chatter in a real plant and should not create an unsafe response.
`;

export const demoModel = {
  schemaVersion: 1,
  name: "Single-zone conveyor",
  summary: "Package transfer with jam detection, sensor noise, and operator recovery.",
  tickMs: 100,
  process: {
    beltTravelMs: 5200,
    packageIntervalMs: 6800,
    entryWindow: [0.04, 0.16],
    exitWindow: [0.84, 0.96]
  },
  signals: [
    { id: "start", label: "Start command", direction: "input", type: "boolean" },
    { id: "stop", label: "Stop command", direction: "input", type: "boolean" },
    { id: "reset", label: "Fault reset", direction: "input", type: "boolean" },
    { id: "entryPE", label: "Entry photoeye", direction: "input", type: "boolean" },
    { id: "exitPE", label: "Exit photoeye", direction: "input", type: "boolean" },
    { id: "conveyorRun", label: "Conveyor run", direction: "output", type: "boolean" },
    { id: "jamAlarm", label: "Jam alarm", direction: "output", type: "boolean" },
    { id: "packageCount", label: "Package count", direction: "output", type: "integer" }
  ],
  experiments: [
    {
      id: "sensor-chatter",
      title: "Entry sensor chatter",
      hypothesis: "Short input noise must not stop the conveyor or create a false jam.",
      fault: "chatter",
      durationMs: 4500
    },
    {
      id: "stuck-entry",
      title: "Entry sensor stuck active",
      hypothesis: "A blocked entry sensor must latch the jam alarm within the specified timeout.",
      fault: "stuck-entry",
      durationMs: 5200
    },
    {
      id: "recovery",
      title: "Jam recovery",
      hypothesis: "Reset is rejected while blocked and succeeds only after the obstruction clears.",
      fault: "recovery",
      durationMs: 4000
    }
  ]
};

export function cloneDemoModel() {
  return structuredClone(demoModel);
}
