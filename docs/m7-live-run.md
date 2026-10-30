# M7 Live Closed-Loop Run

Status: **live PLC execution and deterministic audit passed on 2026-10-30**.

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

## 2026-10-30 result

The authenticated live run completed in 3.864 seconds and passed all four M7 checkpoints. It preserved 181 coordinator events and 282 world events across 88 coherent acknowledged input revisions.

- The normal initial image was applied at PLC cycle 43,947 with simulation active and the connector fresh.
- The recorded start stimulus caused the PLC to assert `Motor_RunCmd`; the generated drive reached 0.5 m/s and encoder count 83 during acceleration.
- The modeled carton reached the physical entry photoeye at 0.5107 m. After authority was handed from the explicit hold to physical geometry, the raw photoeye cleared and the PLC removed the motor command at applied sequence 62 / PLC cycle 44,039.
- The belt was still moving at 0.5 m/s when command was removed. It coasted 0.05536 m and produced 56 further encoder counts before stopping.
- Carton position and encoder count remained unchanged through a 519 ms stationary hold.
- All 88 output-capture cycles equaled their correlated PLC cycles. Commit latency was min 13.683 ms, p50 16.431 ms, p95 32.497 ms, p99/max 34.031 ms. This short closed-loop slice is not an M3 sustained-rate verdict.

`npm.cmd run proof:m7:audit` passed 12 deterministic checks covering artifact identity, event ordering, sequence/epoch/boot continuity, output-cycle correlation, PLC motor decisions, photoeye causality, acceleration/encoder behavior, and deceleration/hold behavior.

The run used world SHA-256 `A467A4589850BA19BDB1CAA80D30387B387B8861077013AFB8974933C520B5D6` and the frozen M2 PLC project SHA-256 `1A13DAEF6048E6B7A2491285D82848CC98DA09090278DA40068ED443D8364D64`. The working project changed afterward under the separately owned M3-M6 lane; the audit discloses that post-run difference and does not attribute it to the live result.

Artifacts:

- `artifacts/m7/m7-live-result.json`;
- `artifacts/m7/m7-live-trace.json`;
- `artifacts/m7/m7-audit.json`.
