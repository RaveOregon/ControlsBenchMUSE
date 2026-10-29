# CODESYS / OPC UA Connector Measurement Plan

Status: **Accepted Gate D execution baseline for the first connector spike.** Updated 2026-10-29. Passing this plan means the architecture is ready to be measured against CODESYS Control Win; it does not claim that OPC UA timing or a live PLC has already passed.

## Purpose

Determine whether a workstation-owned ControlsBench world can drive and observe a CODESYS bench controller with coherent raw I/O, sufficient timing, explicit liveness, and defensible evidence. The experiment must tell us whether direct streaming is enough and exactly when a PLC-resident scheduled signal player becomes necessary.

The connector transfers current raw signal images and PLC outputs. It does not transfer the world runtime, generated physics, campaign logic, or a preauthored machine replay into the PLC.

## Constraints Established by the Platform

- Use the CODESYS Communication Manager and IEC Symbol Set Configuration for current CODESYS V3.5 SP18+ projects. Symbol access is explicitly read, write, or read/write. [CODESYS OPC UA server configuration](https://content.helpme-codesys.com/en/CODESYS%20Communication/_comm_configuration_and_-commissioning_of_-the_opcua_server.html), [IEC symbol configuration](https://content.helpme-codesys.com/en/CODESYS%20Communication/_cds_obj_symbolconfiguration.html)
- The default server `ItemMinSamplingRate` is 100 ms and can be configured, with server-setting changes requiring a PLC restart. Therefore 10/20/50 Hz behavior must be measured rather than assumed. [CODESYS OPC UA server configuration](https://content.helpme-codesys.com/en/CODESYS%20Communication/_comm_configuration_and_-commissioning_of_-the_opcua_server.html)
- Scalar values up to eight bytes are transferred consistently, while strings, arrays, and structures are not guaranteed coherent as a whole. OPC UA work can run concurrently with IEC tasks and at lower priority. This rules out treating a multi-field OPC UA write as an atomic PLC input image. [CODESYS data consistency](https://content.helpme-codesys.com/en/CODESYS%20Communication/_comm_data_consistency_communication_manager.html)
- CODESYS task monitoring exposes IEC cycle count, cycle time, and jitter. The PLC fixture also records its own cycle and monotonic microsecond timestamp so the evidence does not depend on IDE refresh. [CODESYS task monitoring](https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_obj_task_config_monitor.html), [SysTimeCore](https://content.helpme-codesys.com/en/LibDevSummary/date_time.html)
- Control Win is not a hard real-time target. Timing thresholds below are product tiers, not claims about guaranteed Windows scheduling. [CODESYS timing guidance](https://content.helpme-codesys.com/en/CODESYS%20SoftMotion/_sm_robotics_performance.html)

## First PLC Library Boundary

The controls engineer installs a small vendor-specific library at the raw I/O boundary. Hardware passthrough remains the default. In simulation mode, DI/AI wrappers select the committed ControlsBench raw image; DO/AO wrappers expose authentic PLC commands and optionally suppress selected physical sinks when the engineer configures that override.

The PLC fixture exposes:

- `BenchControl`: simulation request/applied, reset request, connector-stale state, active slot, requested slot, requested workstation epoch/sequence, applied epoch/sequence, workstation heartbeat, PLC heartbeat, PLC boot identity, PLC cycle, and PLC monotonic time;
- `BenchInputSlot[0..1]`: two complete current raw input images plus slot epoch, sequence, and validity marker;
- `BenchOutputs`: current PLC-to-world command image plus PLC cycle/time at capture;
- diagnostic counters for duplicate, stale, skipped, invalid, and applied commits.

For the conveyor demo, the raw image contains explicit typed fields matching the accepted signal contract. The reusable library may internally group DI, AI, DO, and AO, but no normalized speed or already-conditioned application value replaces encoder counts, raw analog integers, or device fields.

## Coherent Commit Handshake

1. The workstation owns the complete current raw input image and creates a nonzero random 64-bit `WorkstationEpoch` on every workstation process start. Ordering is over the pair `(epoch, sequence)`, not sequence alone.
2. It waits until one staging slot is inactive and acknowledged as reusable.
3. In a completed write operation, it sets that slot's `Valid` false before changing any payload member. It then writes the complete next image, slot epoch, and slot sequence. It writes `Valid` true only after all preceding writes have completed successfully.
4. In a later completed operation, it writes `RequestedSlot`, `RequestedEpoch`, and `WorkstationSeq` as the commit. The slot is accepted only if it is inactive, `Valid` is true, slot epoch/sequence equal the requested epoch/sequence, and the pair is newer than the applied pair for the active session.
5. `BenchIntercept_Update` is the first call in the same IEC task that runs the application under test. It copies the accepted slot into private scan-owned state, switches the active image, and sets `AppliedEpoch`/`AppliedSeq` before downstream DI/AI wrappers read that private image in the same scan. The first proof uses one application task; any later multi-task consumer requires an explicitly synchronized per-task latch and a new coherence test.
6. The workstation does not alter or reuse the committed slot until the applied epoch/sequence echoes the commit.
7. Duplicate, stale, out-of-order, incomplete, epoch-mismatched, or invalid commits do not change the active image and increment a diagnostic counter.
8. Reconnection in the same workstation process retains its epoch. A workstation restart requests a new epoch and supplies a complete valid image. The PLC may accept an epoch change only while simulation is deliberately enabled and the prior bench link is stale, or after an explicit bench-session reset. Once a new epoch is active, packets from an older epoch remain rejected.
9. The PLC exposes a boot identity that changes on PLC/application restart. A workstation must observe the new boot identity and open a fresh epoch with a complete image; it cannot infer continuity from an old `AppliedSeq`.

This is a raw-signal image exchange, not PLC playback. Methodical tests may wait for every `AppliedSeq`; continuous operation pipelines at most one unacknowledged image per slot. A scheduled PLC-side player is considered only if direct streaming fails the runtime tier.

## Time and Evidence Contract

Every sent or observed record retains:

- workstation monotonic send and receipt time;
- OPC UA source/server timestamps and status/quality when supplied;
- workstation sequence and slot;
- PLC `AppliedSeq`, IEC cycle count, and monotonic microsecond time;
- the complete logical raw values represented by that revision;
- connector reconnect/session identity;
- requested versus revised subscription/sampling intervals;
- test ID, world version, and cause.

Latency is calculated separately for workstation-to-server write completion, send-to-PLC-application acknowledgement, PLC-output-change-to-client observation, and closed-loop action-to-effect. Clock-domain comparisons use sequence/cycle correlation unless clocks have been explicitly synchronized.

## Measurement Matrix

### M0 — Installation and inventory

Record IDE, runtime, Communication add-on, OPC UA server, Node client, library, Windows, and project versions; PLC task intervals/priorities; endpoint/security policy; configured minimum sampling rate; requested and server-revised subscription values; and signal-map hash.

Pass: the exported symbols, access rights, data types, endpoint identity, and authentication are reproducible. Anonymous access is not required for the product path.

### M1 — Typed scalar correctness

Exercise every accepted manifest signal by direction and IEC/OPC UA type. For the 20 world-to-PLC signals, cover all 15 BOOL fields with zero/one and rapid alternation; all four optional diagnostic REAL fields with Float32-exact representative finite values, zero, and negative values only where physically valid; and `Encoder_Count` as UDINT at 0, 1, 2^32−2, 2^32−1, plus declared rollover. Compare REAL values after explicit Float32 conversion or raw IEEE-754 bit representation rather than JavaScript double formatting. M4 separately covers all five PLC-to-world BOOL outputs. Read back the PLC's application-visible active image, never only the staging slot.

Pass: every mapped signal has a result; values are type-correct and bit-exact at their declared width; unsupported, non-finite, or out-of-range values are rejected and attributed; optional diagnostics are labeled optional and cannot substitute for the authoritative raw encoder/device path; no normalized engineering value bypasses raw PLC logic.

### M2 — Image coherence and ordering

Send 10,000 alternating images whose fields encode the same epoch/sequence pattern. Include duplicate, stale, skipped, invalid-slot, incomplete-slot, premature-valid, mismatched-slot-sequence, reconnect, old-epoch-after-reconnect, workstation-restart/new-epoch, and PLC-restart/new-boot cases.

Pass: zero torn active images; `(AppliedEpoch, AppliedSeq)` is monotonic within an epoch and every epoch transition follows the authorization rules; every accepted image matches one complete sent revision; rejected images leave the active image unchanged and increment the correct counter; downstream application reads in the acceptance scan match the same complete revision.

### M3 — Rate sweep

Run 5, 10, 20, and 50 Hz image updates for ten minutes per rate while recording send-to-applied latency, output-observation latency, notification loss/coalescing, server-revised parameters, CPU, IEC task cycle, and jitter. Repeat at 1x, 2x, and full demo signal counts.

The product tiers are:

- Methodical tier — mandatory: sustained 10 Hz; no unexplained loss; p99 send-to-applied at or below 250 ms.
- Runtime tier — required for direct-streamed conveyor operation: sustained 20 Hz; at least 99.9% applied within 150 ms; no torn images or sequence ambiguity.
- Preferred tier — stretch: sustained 50 Hz; at least 99.9% applied within 60 ms.

If the methodical tier fails, stop and repair the connector/PLC boundary. If methodical passes but runtime fails, retain streaming for methodical tests and implement the deferred PLC-resident scheduled raw-signal player for timing-sensitive operating modes. Do not relax the tier silently or claim scan-synchronous OPC UA.

### M4 — Output observation

Have the PLC produce cycle-tagged command transitions and bounded pulses at known scans. Subscribe to the complete `BenchOutputs` set while input updates are active.

Pass: no steady-state value is silently stale; pulse visibility limits are measured; source/server status and timestamps are retained; observed revisions correlate to PLC cycle/time without inventing scan precision.

### M5 — Disconnect, hold, and recovery

Drop the client, server, network adapter, and subscription independently during simulation. Restart the workstation with sequence reset and restart the PLC with state reset.

Pass: the PLC holds the last committed simulated input image, raises only the bench-link-stale diagnostic, and does not silently return to hardware or zero. Stale is asserted after `max(500 ms, 3 × negotiated publish interval)`. Reconnection does not apply staging data until a complete new image is explicitly committed; simulation authority remains visible.

### M6 — Task impact

Measure IEC task cycle/jitter and watchdog/omitted-cycle diagnostics with OPC UA disconnected, subscribed only, methodical streaming, runtime streaming, and maximum demo load.

Baseline is a ten-minute warmed run with OPC UA disconnected. The PLC fixture records every scan interval with monotonic microsecond time so p50/p95/p99/max cycle interval and absolute jitter can be calculated independently of IDE refresh. Each connected load is run three times against the same project and Windows power/load conditions.

Pass: no watchdog or omitted cycle occurs and application behavior remains correct. A run enters stop-and-investigate if p99 cycle interval exceeds 1.20 × the disconnected baseline p99, if p99 absolute jitter exceeds 1.20 × baseline, or if maximum observed interval reaches the configured task interval/watchdog boundary. It clears only after a recorded cause/configuration change and two of three repeat runs remain under all thresholds. An unexplained result cannot be averaged away or used for M3/M7 acceptance.

### M7 — Closed-loop conveyor slice

Connect the already-proven world to the interceptor. Exercise start, physical acceleration, encoder counts, one carton/photoeye transition, decelerating stop, and stationary hold. The PLC under test must make the output decisions; the workstation supplies raw inputs and observes outputs.

Pass: the live trace shows command → world response → raw image commit → PLC application acknowledgement → resulting PLC output, with every edge attributable. Surrogate and live evidence remain separately labeled.

## Stop Conditions

Stop the connector spike and revise the boundary if any of the following occurs:

- an active PLC image can contain members from different workstation revisions;
- the PLC applies a sequence that the workstation cannot map to one complete image;
- simulation authority changes on disconnect without an explicit engineer action;
- raw values are replaced by normalized application values;
- data quality or reconnect state is discarded;
- direct streaming misses the methodical tier;
- PLC task health degrades without being measurable;
- evidence cannot correlate a world action, connector revision, and PLC cycle.

## Required Artifacts

The spike produces a version inventory, symbol map, PLC library/project hash, client configuration, requested/revised OPC UA parameters, raw trace, sequence/coherence counters, latency distributions, task-cycle/jitter observations, disconnect/reconnect trace, closed-loop trace, and a tier verdict. Any threshold revision is a new plan version with rationale; measurements are never retroactively rescored without preserving the original verdict.

## Adversarial Review Closure

One initial Wonder review returned an unsupported `not_ready` verdict with no findings and was preserved as a failed evaluation artifact. A bounded retry supplied explicit CP-8 through CP-11 adjudication and returned four concrete findings. This revision closes them as follows:

- F1: `WorkstationEpoch`, applied epoch, PLC boot identity, and explicit epoch-transition rules resolve restart versus stale-sequence ambiguity.
- F2: slot invalidation, exact commit predicate, write-operation ordering, and same-task scan-owned publication resolve incomplete-slot and internal tearing ambiguity.
- F3: M1 now enumerates BOOL, REAL, and UDINT coverage across all 25 accepted manifest signals and distinguishes optional diagnostics from authoritative raw behavior.
- F4: M6 now defines the baseline statistic, regression calculation, repeat count, and clearance evidence.

No third paid approval call is required; the deterministic Gate D audit verifies these plan clauses and preserves both model reviews with their costs.
