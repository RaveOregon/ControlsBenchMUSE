# M8 controller acceptance

**M8-A–D passed on the actual running Control Win PLC on 2026-10-31.** Independent artifact audits passed. M8-E WebVisu is deferred; the versioned symbol map is delivered.

## Build and evidence

Project: `codesys/conveyordemo.project`, SHA-256 `6c2a1eb6c9c83485b75cb9bcefc1be237a94c8727ecf8098ad57a4d680516628`. Build 8001, interface 1, map `m8-conveyor-1.0.2`, existing 20 ms task. Both accepted runs retained boot identity `1512266335626`.

- `evidence/2026-10-31T18-45-47-430Z-All/`: A–D, 104 complete acknowledged images under epoch `236412899406893`; nine independent audit checks passed.
- `evidence/2026-10-31T18-50-43-488Z-B/`: supplemental Start/Stop, missing motor feedback, overload, and Reset; seven audit checks passed.
- Each breakpoint retains the official MCP application precheck response. Full compilation returned no diagnostics. `evidence/source-readback.json` verifies all ten IDE ST objects against versioned source.

Images were complete, observations passed PLC/capture-cycle brackets, and retained samples had Good status with source/server/receipt timestamps. Every recorded write stayed in GVL_BenchWrite or GVL_DemoWrite.

## Observed behavior

| Scenario | Actual PLC evidence | Verdict |
|---|---|---|
| A: default / zero / hold | Hardware was the cold-start selection and outputs were off. Simulation entered with the full zero image. A normal image applied. Heartbeat silence asserted stale while retaining simulation and the exact image; complete commit restored freshness. | Pass |
| B: Start / Stop | Start commanded motor; external feedback enabled release. Stop removed command while feedback remained on and retained Stopping during explicit encoder coast; external rest produced Stopped. | Pass |
| B: missing feedback | Fault 11 latched and removed motor command. | Pass |
| B supplement: overload | Fault 10 removed command, invented no completion, and cleared-cause Reset left Stopped without restart. | Pass |
| C: A | Item 101 → observed A, Sorted; completion 1 / applied sequence 41. | Pass |
| C: B | Item 102 → observed B, Sorted; completion 2 / sequence 52. | Pass |
| C: unknown | Unoffered item 0 → runout, RunoutUnassigned; completion 3 / sequence 61. | Pass |
| C: assigned runout | A-assigned item 103 with A unavailable → runout, Misrouted; completion 4 / sequence 71. | Pass |
| C: exactly once | Held exit signals did not repeat completion; only the observed exit count advanced. | Pass |
| D: failed divert | Item 201 with D1 between limits produced fault 23 at sequence 96, motor off, one Faulted completion with exit Unknown. | Pass |
| D: no false success / reset | Later runout did not rewrite/duplicate completion or increment exit counts. Explicit cause/carton clearance, acknowledgement and Reset returned Stopped without restart. | Pass |
| E: WebVisu | Minimal binding instructions supplied; screen not authored or visually tested. | Deferred |

Primary final counts: A=1, B=1, Runout=2, Misroute=1, Faulted-carton=1; completion sequence 5. Final observation: Stopped, FaultCode=0, motor off, completion acknowledged, ResetAccepted=true, encoder-derived speed zero.

## Limits and exception

The server reports both access flags as 3 on 68 intended read-only fields, despite the operator confirming Read settings and cleanly redeploying. The user authorized proceeding without writing them. A strict write allowlist and independent audit enforce that direction. Server-side read-only enforcement is not proven.

Hardware passthrough is source-verified complete-struct selection; arbitrary nonzero physical I/O was not tested on this unwired Control Win project. These are methodical raw-I/O tests, not continuous generated-world/physics evidence, a new transport-rate or task-impact qualification, or a physical commission. No 20/50 Hz run, PLC scheduled player, or paid model call was added.

The UDINT decoder treats a backward counter change as rollover. Explicit bench/image resets to zero can therefore create transient large speed and accumulated-travel increments; final speed settled to zero. Physical speed/travel across counter resets is unqualified. No workstation-scaled speed bypasses the PLC decoder.

Multi-carton handling, every late-route/readiness/timer combination, durable WCS recovery, HMI/video, and a continuous Muse campaign against this final controller remain unproven. Earlier failed setup/discovery runs stopped before stimulus writes and are preserved.

The frozen `gngnf.project` remains SHA-256 `2e9774d1782e82fff0a9383779be517ee94afc1a48cdfcdce6ee6c5fa31a73b7`. M0–M7 artifacts and other lanes were not modified.
