# M10 deterministic M8 integration

This lane starts from the unified `m10-base` (`fa8d2ee`) on `codex/m10-live-integration`. It connects the preserved Muse world 0.5.0, the M9 `CampaignRuntime` and actual M8 build 8001/interface 1. No model request is enabled in this runner. Live verdicts are available only when a timestamped run and its independent audit pass.

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
- `src/campaign/m10-rehearsal.ts` executes the six deterministic experiments through M9 tools and the independent 100 ms driver. Its provider is a zero-cost fixture that throws if called: no model or raw scan generation can enter this proof path.

Controller observations include mode, faults, release/offer/completion status, identities and counts, in addition to the authentic five raw outputs. Optional encoder-derived LREAL diagnostics remain in timestamped native samples; they are not substituted for raw encoder input or world physics. The inherited counter-reset/rollover ambiguity remains an M8 limitation. Assertions use scenario-relative counters and continuity within this campaign.

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

The current offline suite tests the protocol with an injected transport, not a software copy of the conveyor controller. Only new live M10 artifacts can establish the six controller/world scenarios. HMI authoring/capture and portal UI are separately owned. Wonder remains disabled pending the completed deterministic live audit and a later explicit authorization.
