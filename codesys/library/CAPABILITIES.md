# Capability matrix — ControlsBench Core 0.2.0.0

The machine-readable copy is `capabilities` in `adapter-profile.json`; `scripts/audit-build.mjs` checks that every claimed capability has existing evidence and every deferred one has a gate.

| Status | Meaning |
|---|---|
| implemented | Delivered and exercised by executed host-side checks, or by a CODESYS conversion and compile round trip, in this lane |
| compiled-only | PLC source compiled into the library and both consumers with zero errors and zero warnings; never executed |
| runtime-validated | Executed on a PLC runtime with retained evidence. **No library capability has this status.** |
| planned | Accepted requirement with a reserved extension point or a recorded limitation, and an acceptance gate |
| unsupported | Deliberately not provided by this profile; rejected or absent, never emulated |

Compiled-only evidence for every PLC row is `builds/prototype-0.2.0.0/result.json` plus the cited source. The in-project M8 interceptor's live M2/M5/M10 evidence does **not** transfer to this library.

## Raw I/O integration

| Capability | Status | Evidence | Gate |
|---|---|---|---|
| Hardware passthrough by default; exit always restores it | compiled-only | `FB_CB_Session`, harness cases 1, 29, 36 | G-RT-1 |
| Simulation entry at raw zero; staged data never applies | compiled-only | harness 3, 34, 40 | G-RT-1 |
| Coherent two-slot commits, write-last sequence, one revision across banks | compiled-only | harness 5, 15, 19 | G-RT-1, then G-DEP-1 |
| Rejected, incomplete, mismatched, duplicate, stale, skipped, epoch and idle requests with latched acknowledgement | compiled-only | `ST_CB_Status`, harness 2, 6–16, 20, 21 | G-RT-1 |
| Native width, REAL non-finite policy and unconfigured-zero enforcement | compiled-only | `F_CB_CheckImage`, harness 6–8, 32, 41–43 | G-RT-1 |
| Link-loss hold, elapsed-microsecond staleness, heartbeat-only recovery | compiled-only | harness 17–19, 33, 46 | G-RT-1, then G-DEP-1 |
| Session reset, Simulation Reset, Exit Simulation and Reinitialize kept distinct; machine Reset never issued | compiled-only | harness 22–24, 29, 37, 38 | G-RT-1 |
| Boot, backward-clock and configuration changes latch and block | compiled-only | harness 35, 38, 39, 40 | G-RT-1 |
| Output taps: authentic commands observed, explicit suppression with substitute values, applied masks | compiled-only | `FB_CB_DO`, `FB_CB_AO`, harness 26 | G-RT-1 |
| Output capture with consumed revision and seqlock revision | compiled-only | `FB_CB_OutputCapture`, harness 26 | G-RT-1, G-ACQ-1 |
| Independent domains with distinct maps, timeouts and schemas | compiled-only | harness 31–34, `examples/application/PLC_PRG.st` | G-RT-1 |
| Machine maps: validation, typed wrappers, fingerprints, manifest | implemented | `scripts/cb-map.mjs`, `mappings/` | G-RT-1 runs the generated code; G-DEP-1 binds a transport |
| Build provenance, immutable promotion and Git-based audit | implemented | `scripts/`, `builds/index.json` | CI; G-REL-1 |
| Native File-Based Storage round trip and consumer rebuild | implemented | `builds/prototype-0.2.0.0/result.json` (`fbs`), `ControlsBenchCore.fbslib/` | G-FBS-2 |

## Acquisition and analysis foundation

| Requirement | Status | What exists now | Gate |
|---|---|---|---|
| Passive observation without simulation authority or suppression | compiled-only | `FB_CB_Observation`: one bounded frame per cycle, no write path; harness 27, 30 | G-ACQ-1 |
| Raw hardware vs selected inputs vs authentic commands vs physical sink, with simulation and suppression state | compiled-only | Frame images `RawInputs`, `SelectedInputs`, `Commands`, `Physical`, mask `Suppressed`, flags `SimApplied`, `AnySuppressed` | G-ACQ-1 |
| Stable signal identity and raw representation; separately versioned units, scaling, ranges, polarity, rollover | implemented (host) | Map channel IDs and native types; `engineering` blocks hashed into `engineeringSha256`, never into wire fingerprints | G-REC-1 consumes them |
| PID setpoint, process variable, output and mode observation taps, including internal signals | compiled-only | Map `taps` with roles and loop IDs, `MAP_<P>_PackTaps`, `Frame.Taps`, own `TapSchemaId`; no request field can write a tap | G-ACQ-2 |
| Source task/domain, boot, cycle/time, capture phase, sequence, quality | compiled-only | Frame header fields; the domain-to-task binding is declared in the map and must be one task per domain | G-ACQ-1 |
| Source time separate from receipt time; clock uncertainty and cross-task limits | planned | Frame carries only PLC monotonic `SourceTimeUs`; the recording draft reserves receipt time and an alignment statement. No cross-task simultaneity claim | G-REC-1 |
| Requested vs achieved sampling, decimation, missing samples, overruns, preserved gaps, labelled derived values | planned | Source-side `FrameSequence`, `MissedCycles`, `RepeatedCycles`; recording draft defines gap and derived records | G-ACQ-1, G-REC-1 |
| Sampling qualified per process and transport | planned | Nothing qualified. The demo's 10 Hz OPC UA commit qualification does not cover frame acquisition, PID or signal-processing use | G-ACQ-1, G-ACQ-2 |
| Bounded PLC resources, never blocking control when the workstation slows or disconnects | compiled-only | Fixed-size copy, no allocation or waits, `Enable` input. Cost not yet measured | G-RT-2 |
| Bounded source-side sample buffer | planned (evaluate only) | Not implemented; only if G-ACQ-1 measurements show polling misses source dynamics. Distinct from stimulus playback | G-ACQ-3 |
| Recording format | planned | `schemas/recording.draft.schema.json`, version reserved, no writer or reader | G-REC-1 |
| PID tuning, filtering, signal-processing tools | planned | None; they will consume recordings through their own capabilities | G-TOOL-1 |
| PID excitation, gain writes or controller changes as a side effect of observation | unsupported | Observation has no write path; a future active tool needs its own explicit capability and tests | — |

## Explicit limitations

| Item | Status | Notes |
|---|---|---|
| LINT, ULINT, LWORD, LREAL, TIME/LTIME, date types, STRING, WSTRING, arbitrary structures | unsupported | Map validation rejects them; a later profile is required. Never narrowed. |
| More than 64 BOOL, 32 signed, 32 unsigned or 16 REAL channels per domain | unsupported | Split into more domains or wait for a larger profile. |
| Cross-task or cross-domain atomic snapshots | unsupported | One task per domain. |
| Wire compatibility with the frozen M8 map | unsupported | New map, identity and regression required. |
| PLC stimulus playback | unsupported | Simulation runs on the workstation. |
| Other PLC vendors | planned | Standard is vendor-neutral; only CODESYS is implemented, and only offline. G-VEN-1. |
| Live deployment replacing the demo's integrated interceptor | planned | G-DEP-1. |

## Acceptance gates

| Gate | Passes when |
|---|---|
| G-RT-1 | The 46-case harness runs on a separate CODESYS test target (not the live demo controller) with `Done`, `Passed` and `FailedCase = 0` read back and retained, under explicit authorization for that target. |
| G-RT-2 | Task cost of session, taps, capture and observation is measured on a real task at the intended period and load, against a disconnected baseline, with the M6 method. |
| G-ACQ-1 | A workstation reader reads frames with the guarded revision policy over the real transport, at a declared requested interval, and reports achieved rate, decimation, torn-read retries and gaps from `SourceCycle` and the gap counters, for one domain in passthrough and in simulation. |
| G-ACQ-2 | For a named process and analysis use (for example, one PID loop's bandwidth), the sampling requirement is derived and the transport is shown to meet it, or the gap is recorded and G-ACQ-3 is evaluated. |
| G-ACQ-3 | Measurements justify a source buffer; its capacity, overrun reporting, task cost and non-blocking behaviour are specified and tested. Never mixed with stimulus playback. |
| G-REC-1 | The recording format is frozen as version 1 with a writer and reader, round-trip tests, gap and derived-value records, receipt timestamps and the manifest copy in its header. |
| G-TOOL-1 | Each analysis tool declares its own capability, consumes recordings only, and has its own tests. Any active excitation or parameter write is a separate, explicitly authorized capability. |
| G-DEP-1 | A consumer with a new build identity and generated map replaces the integrated interceptor on a separate deployment, then M2-, M5- and M10-class regressions and task cost pass. The frozen demo and its hash guards stay unchanged until then. |
| G-VEN-1 | Another vendor implementation passes the applicable conformance gates with its own evidence. |
| G-FBS-2 | The next version is edited in a copy of the promoted native project; the builder takes the native project as its source and Git text sources are derived from it or retired. |
| G-REL-1 | A non-prototype release: API and protocol frozen, G-RT-1 and G-RT-2 passed, licence and publication decided. |
