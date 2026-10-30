# M7 Live Closed-Loop Run

Status: **runner and independent fixture proof complete; live PLC execution pending**.

M7 connects the preserved Muse-generated conveyor world to the M2-qualified raw-image boundary without changing the generated world or the PLC handshake.

## Responsibility boundary

- `src/live/coordinator.ts` knows only the generated-world contract and the generic `BenchConnector` interface.
- `scripts/run-m7-live.js` is the CODESYS/OPC UA spike adapter. It reuses the exact M2 published nodes, double-buffer transaction, epoch/sequence reset, boot identity, coherent active-image readback, and output-capture correlation.
- The connector transfers complete current raw input images and current PLC outputs. It does not transfer world code, a playback array, or a scripted PLC response.

## Measurement-DUT start strategy

The current PLC fixture deliberately implements only measurement behavior: `Motor_RunCmd` follows `PE_Entry` when no overload is present. It is not represented as a production conveyor controller.

The M7 campaign therefore performs a truthful bounded exercise:

1. initialize and commit the generated world's normal zero/no-carton image;
2. explicitly hold the generated entry sensor high as a recorded start stimulus;
3. observe the PLC assert `Motor_RunCmd`;
4. observe generated drive delay, acceleration, running feedback, and raw encoder motion;
5. introduce one modeled carton;
6. when its geometry reaches the entry photoeye, remove the explicit hold while physical occupancy keeps the raw signal asserted;
7. observe the photoeye clear behind the carton and the PLC remove `Motor_RunCmd`;
8. observe drive delay, physical belt deceleration/coast, encoder progression during coast, final rest, and a 500 ms stationary hold.

This proves the connected causal chain against the current DUT without altering world physics to satisfy an artificial oracle. A later demo PLC program can exercise routing and alarms through the same connector.

## Running

Prerequisites:

- open `codesys/gngnf.project`;
- connect/login to the local Control Win target;
- download the current project if required and put the application in RUN;
- ensure no M3-M6 measurement owns the runtime;
- leave the OPC UA server reachable at `opc.tcp://127.0.0.1:4840`.

From the repository root:

```powershell
npm.cmd run proof:m7:live
```

The wrapper prompts for the PLC password as a `SecureString`, exposes it only to the child process environment, removes it afterward, and never writes it to an artifact.

## Evidence and pass conditions

The run writes:

- `artifacts/m7/m7-live-result.json`;
- `artifacts/m7/m7-live-trace.json`.

It passes only when all of the following are observed through the live connector:

- simulation is applied and not stale;
- the normal initial image is acknowledged;
- the PLC asserts the motor output from the recorded start stimulus;
- the generated world accelerates and advances encoder counts;
- the modeled carton reaches and clears the entry photoeye;
- the PLC removes the motor command after the raw photoeye clears;
- belt/carton/encoder state continues through believable coast, then reaches rest;
- carton position and encoder count remain unchanged during the stationary hold;
- every input revision maps to one acknowledged epoch/sequence and correlated PLC output-capture cycle.
