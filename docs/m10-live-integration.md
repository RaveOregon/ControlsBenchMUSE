# M10 deterministic M8 integration

**Live deterministic M10 passed on 2026-10-31.** All six scenarios passed against M8, and the independent saved-evidence audit passed 10 checks over 302 coherent images. Evidence: `artifacts/m10/2026-11-01T00-58-43-185Z/` (UTC directory timestamp). Both earlier failed attempts and the explicit baseline reconciliation remain preserved.

This lane starts from the unified `m10-base` (`fa8d2ee`) on `codex/m10-live-integration`. It connects the preserved Muse world 0.5.0, the M9 `CampaignRuntime` and actual M8 build 8001/interface 1. No model request is enabled in this runner.

## Reproduce

```powershell
npm.cmd run proof:m10:live
npm.cmd run proof:m10:audit
```

The first command runs TypeScript checking and all offline tests, then prompts for the PLC password as a SecureString. Credentials exist only in the child process environment and authenticated OPC session; they are not stored in evidence. Run with the unchanged M8 application already in RUN, build 8001/interface 1, a stopped/no-carton baseline and no unacknowledged completion. A dirty baseline is an unexplained result, not permission for automatic recovery. Only this lane may own the live runtime. `artifacts/m10/live.lock` excludes other invocations of this runner; legacy runners and manual editor operations must be coordinated separately.

The runner never downloads, edits or compiles the PLC. A read-only official MCP precheck is preserved. The local project SHA-256 must remain `6c2a1eb6c9c83485b75cb9bcefc1be237a94c8727ecf8098ad57a4d680516628`. The on-controller BuildId/InterfaceVersion and boot identity are checked independently. A build ID is not a remote cryptographic measurement of compiled bytes; provenance also relies on the frozen M8 deployment and exclusive runtime ownership.

## Implementation and integration

- `src/live/m8-map.ts` consumes the exact versioned M8 IEC map. It adds read-only controller status declarations to a manifest wrapper, preserving every generated world behavior function and the original artifact bytes. The original world manifest/source remain untouched.
- `src/live/m8-native-transport.ts` discovers exact IEC paths and rejects missing/ambiguous symbols, UA type mismatch, insufficient access and bad/missing timestamp quality. It logs actual resolved node IDs. Only mapped read/write fields in `GVL_BenchWrite` and `GVL_DemoWrite` are writable. M8's previously authorized read-group exposure exception is recorded; it does not enlarge the write allowlist.
- `src/live/m8-opcua.ts` is a reusable, transport-injected `BenchConnector`. Each complete image is Float32/UDINT normalized and read back. Invalidation, payload/metadata, validity, requested slot/epoch, and requested sequence are five separate completed writes. Sequence is always last. Commit starts are at least 100 ms apart, including timer rounding; there is no catch-up burst. Every observation uses the M8 PLC/capture-cycle bracket and stable boot. Close retains simulation and its input image.
- `src/campaign/m8-bindings.ts` binds `assign_route`, `operator_action(start|stop|reset)` and `acknowledge_completion` to sequenced M8 requests. Payload precedes the WCS sequence; accepted/rejected status and identity are checked. These are supervisory PLC actions, not HMI clicks. New v1 payload schemas are additive; existing events and flattened coordinator acknowledgements retain their shape.
- `src/campaign/m10-rehearsal.ts` executes the six deterministic experiments through M9 tools and the independent 100 ms requested driver clock. Connected stepping uses actual elapsed time, with a declared 300 ms maximum observation gap; pause time is excluded. Its provider is a zero-cost fixture that throws if called: no model or raw scan generation can enter this proof path.

The optional `BenchConnector.inspectLink()` returns a lightweight fresh session/boot/staleness check; the M8 implementation reads 12 fields instead of repeating the 72-field complete image/status read before every tick. This link check emits no PLC-output evidence. `observe()` and acknowledged commits still produce full bracketed controller observations and active-image verification. Existing connectors fall back to `observe()`, preserving compatibility and the existing flattened coordinator event shape.

Controller observations include mode, faults, release/offer/completion status, identities and counts, in addition to the authentic five raw outputs. Optional encoder-derived LREAL diagnostics are declared in the source M8 map but are not used as oracles or substituted for raw encoder input/world physics. The inherited counter-reset/rollover ambiguity remains an M8 limitation. Assertions use scenario-relative counters and continuity within this campaign.

## Deterministic oracles

| Experiment | Required causal evidence |
|---|---|
| A sort | WCS item 101/A accepted; physical entry, D1 command and modeled travel; A beam from geometry; one PLC completion A/Sorted and only A count increment. |
| B sort | Item 102/B accepted; physical entry, D2 command/travel; B beam; one B/Sorted completion and only B count increment. |
| Unassigned runout | No offer; physical unassigned carton; runout beam; item 0/RunoutUnassigned and runout count increment. |
| Assigned-runout misroute | Readiness A explicitly blocked, item 103/A offered; modeled runout; PLC Runout/Misrouted with misroute count and no false A success. |
| Stop/coast | A tracked moving carton, sequenced Stop acknowledged with motor off; world coasts and advances raw encoder/position; then zero speed, stationary raw count/position and PLC Stopped. Resume the same retained carton to unassigned runout so the world is empty before the next trial. |
| Failed divert | Committed D1-jam truth; item 201/A accepted; real D1 command, absent modeled travel/extended feedback; PLC fault 23, motor off, exactly one Faulted/Unknown completion, no successful exit count. Final expected fault/image stays simulated and held for inspection. |

After each normal completion, physical carton departure and no duplicate completion are observed before WCS acknowledgement and the next feed. Six experiments yield six completions because the Stop carton subsequently clears through runout. Expected count deltas are A +1, B +1, Runout +3, Misroute +1, Faulted +1; initial counters need not be zero.

Any other fault, rejected/timed-out tool, stale receipt, bad cycle correlation, wrong active image, missing observation deadline or oracle mismatch stops the campaign. There is no automatic retry, fault reset or next scenario after unexplained behavior. PLC scanning and timers continue against the held image. A transport operation already issued cannot be assumed unapplied on timeout. The M9 driver quarantines that uncertainty for inspection.

## Artifacts and audit

Every invocation creates a new `artifacts/m10/<UTC timestamp>/` and updates `latest.json` with its truthful status, including failures. It preserves the JSONL campaign ledger, compressed timestamped OPC transport trace, read-only precheck, result and report when available. Successful execution also produces `audit.json`. Original M7/M8/M9 evidence is not overwritten.

The ledger keeps command intent/outcome, accepted controller acknowledgements, world controls/effects/entities, complete images, the existing flattened coordinator acknowledgements and correlated PLC responses. Transport evidence separately preserves write batches, Good status/timestamps, exact active-image readback and cycle brackets. The independent audit replays and checks hash identities, all six experiments/findings, commit continuity/coherence, 10 Hz ceiling, write ordering/allowlist, command acknowledgements, exit completions/counts, Stop/coast/hold and the failed-divert chain. It rejects a failed run rather than inferring a pass from a report summary.

The current offline suite passes 38 tests and tests the protocol with an injected transport, not a software copy of the conveyor controller. The separate live M10 evidence establishes the six controller/world scenarios. HMI authoring/capture and portal UI are separately owned. Wonder remains disabled and requires later explicit authorization.

## First connection attempt

`artifacts/m10/2026-11-01T00-42-56-378Z/` stopped in initialization with `BadUserAccessDenied`, as preserved in the campaign ledger. There were no logged OPC value-read/write batches, raw commits, controller commands or PLC boot observation. The original result contains a generic setup assertion; the ledger retains the underlying denial. The runner now propagates that original cause, records connection phases and zero activity explicitly, and exports a report even on startup failure. It also checks the stopped/no-fault/no-carton/no-pending-completion baseline before its first simulation write. The user separately reported a PLC timeout/restart; this attempt cannot establish its cause or boot identity.

No automatic retry follows an access denial or restart. Confirm the unchanged M8 application is in RUN and the current OPC username before a fresh masked prompt. Do not change security settings or the PLC program to bypass a denial. Each retry receives a new directory and epoch; earlier failed evidence is retained unchanged. Subsequent offline checks are timestamped too, with `artifacts/m10/offline/latest.json` pointing to the newest verification.

## Stale A trial, reconciliation and final live proof

The next attempt, `2026-11-01T00-49-30-061Z`, authenticated and acknowledged 39 complete images under stable boot `1534186706133`. It stopped in the A trial when a full pre-step status acquisition repeatedly crossed the 20 ms PLC-cycle bracket, starving the heartbeat. The first observed stale sample followed the last heartbeat by more than 500 ms. No machine fault was observed before the stop. The held active carton subsequently reached M8's declared 30 s transit timeout (fault 33); that later state was observed and preserved by preparation. The trial certifies no completed sort.

The client fix separates lightweight link inspection from complete commit evidence, and feeds measured elapsed time to the unchanged world. `prepare-m10-baseline.js` only reconciles this specific saved stale A trial: matching boot, applied epoch/sequence and exact held image are mandatory, and only the held Auto state or its expected transit timeout are accepted. It records Stop, a declared fresh preserved-world input/counter baseline, completion acknowledgement and Reset. It does not reset arbitrary unexplained faults. Its separate evidence is `preparation-2026-11-01T00-58-28-089Z/`, ending Stopped/fault-free without changing PLC code.

`run-m10-live.ps1 -Watch -PrepareBaseline` is the recorded recovery invocation. Watch mode holds the credential only in its PowerShell process, waits for fixed `run`, `prepare_then_run` or `stop` requests in the ignored `operator-request.json`, and never retries a failure by itself. It clears credentials on close or 30 minutes of idle time. The completed operator session was explicitly stopped and its status is inactive. Ordinary reproduction from a clean stopped baseline still uses `proof:m10:live`. Repeating after the final held fault requires a separate explicit baseline procedure; the runner deliberately refuses a dirty start.

The successful run retained boot `1534186706133`, epoch `196518616187191`, and sequences 1–302, with capture cycle equal to PLC cycle for every acknowledgement. Commit intervals were min **100.106 ms**, median **117.889 ms**, p99 **247.486 ms**, max **266.987 ms**; effective cadence was **6.52 Hz**. This proves the 10 Hz ceiling and the bounded continuous-world exercise, not a new sustained 10 Hz transport qualification. Maximum world step was 265.7505 ms, within the declared 300 ms bound.

| Scenario | Observed new PLC completion / result |
|---|---|
| A | Sequence 2, item 101, A / Sorted |
| B | Sequence 3, item 102, B / Sorted |
| Unassigned runout | Sequence 4, item 0, Runout / RunoutUnassigned |
| Assigned runout | Sequence 5, item 103/A, Runout / Misrouted |
| Stop/coast | Motor-off acknowledgement; carton 0.723351 → 0.839637 m, raw encoder 16709 → 16825, stationary hold; retained carton later cleared as sequence 6 / RunoutUnassigned |
| Failed divert | Sequence 7, item 201, Faulted / Unknown, fault 23, motor off, no successful exit count |

Completion sequence 1 and one faulted-carton count came from the preserved interrupted A trial. The successful campaign therefore has count **deltas** A +1, B +1, Runout +3, Misroute +1 and Faulted +1; cumulative final faulted count is 2. The reset/rebaseline is not credited as physical encoder travel. The final world is stopped at raw encoder 21613 and speed zero, with fault 23 and completion 7 held in simulation for inspection. After transport closure, connector stale may assert as designed without changing the held image.

`audit.json` and the assessments sidecars verify the original evidence hashes, deterministic ledger replay, tested source hashes and linkage to the preparation record. No paid call, HMI operation/capture, UI edit, PLC program change or modification to M8's original evidence occurred.
