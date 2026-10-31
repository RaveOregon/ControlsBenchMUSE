# M8 demo conveyor controller

Project: `codesys/conveyordemo.project` (operator-selected name). Interface: `signal-map-v1.json`, version `m8-conveyor-1.0.2`. Build ID 8001; interface version 1.

This is the actual single-carton hackathon PLC controller. It is separate from the frozen `codesys/gngnf.project` measurement fixture. The new project began as a Save As of that fixture to retain the qualified runtime/task, communication manager, symbols, and complete-image handshake. No M0–M7 artifact is an M8 behavior result.

## Execution and raw boundary

The existing MainTask calls PLC_PRG at 20 ms. Its first call is FB_BenchIntercept, followed by FB_DemoConveyor. Hardware acquisition belongs in GVL_DemoHardware.Inputs. This Control Win application has no commissioned physical I/O modules: that struct is the explicit adapter boundary, not a claim that real modules are wired.

Cold-start SimRequest is FALSE. The interceptor selects the entire hardware struct unchanged. A FALSE-to-TRUE simulation request zeros the private simulated image, clears applied epoch/sequence, and invalidates the active slot. It does not preload normal home/ready permissives. Application code immediately sees those zero inputs and continues scanning. A new complete commit is required.

In simulation, the private complete image is the only field-input source. The controller consumes the same selected struct in hardware and simulation modes. Commands are copied both to GVL_BenchRead and the physical output sink globals, with no hidden output suppression. Uncalled FB_BenchTiming and GVL_M0Probe objects inherited from Save As are historical fixture objects; they do not execute in this program and are not M8 signals.

The proven M2 inactive-slot / Valid / epoch / sequence predicate is retained. Invalidate the inactive slot in one completed operation, write every payload field and matching metadata, set Valid in a later completed operation, write requested slot/epoch, then write RequestedSequence LAST in a separate completed operation. Wait for the exact applied pair and unchanged boot identity before reusing a slot. SessionResetRequest is a rising edge. Workstation restart requires a fresh nonzero epoch; a PLC restart requires a fresh session after observing the new boot identity. Epoch transition rules remain the measured fixture rules; M8 does not claim a new exhaustive M2 requalification or unbounded replay-history storage.

Output correlation uses AppliedEpoch/AppliedSequence and a bracket that requires PlcCycle = OutputCaptureCycle both before and after observation, with no intervening cycle change. The inherited OutputSourceSequence compatibility placeholder is not published by the existing symbol set and is not required. Optional compatibility fields are marked in the map; their absence does not remove the applied-image or completed-scan checks.

ConnectorStale is the retained diagnostic after more than 25 task scans without a changed workstation heartbeat (nominally just over 500 ms at 20 ms). It does not create a machine fault, change the raw image, fall back to hardware, or disable commands. PLC timers continue against held inputs. Clear freshness with an explicit frame/heartbeat; staged data alone never applies. The logical BenchSimulationActive alias maps to GVL_BenchRead.SimApplied.

Only 10 Hz is qualified. Raw transitions must remain observable for at least a complete 100 ms update, and test fixtures should budget at least 300 ms beam windows/transport margin. There is no PLC pattern player. A methodical test can deliberately hold inputs; that is not paused PLC time.

## Modes, commands, and stop

Mode codes: 0 Stopped, 1 Auto, 2 Stopping, 3 Faulted. Status.ModeText and FaultText are for operators. Sequence commands are retained requests, not narrow BOOL pulses:

- Set AutoRequest TRUE and increment StartSequence. StartAck echoes the request; StartAccepted reports whether it took effect. Start requires Stopped, clear healthy divert limits, runout available, no unacknowledged completion, and clear beams (or an existing tracked carton). A stopped tracked carton may resume with its selected divert verified extended.
- Increment StopSequence, or withdraw AutoRequest. StopAck echoes explicit Stop. Motor_RunCmd is removed in the consuming scan and ReleaseReady is inhibited. Stopping remains until external running feedback is false and raw encoder counts have stayed unchanged for 200 ms. Stop does not drain or delete the tracked carton. Divert position commands for that carton remain held.
- The external world owns drive delay, belt/carton deceleration, raw encoder motion, and running feedback. The PLC does not manufacture motion or clear feedback on Stop.
- Increment ResetSequence after clearing the cause. ResetAck echoes it; ResetAccepted requires a non-running mode, overload clear, home limits verified, all beams clear, motor feedback off, runout ready, and the completion acknowledged. Reset clears the latch and pending offer and returns Stopped. It never generates a Start request.

Sequences must change for each new command. Keep them monotonic within a PLC boot; restart the session before UDINT sequence wrap. No pulse-width dependence exists for operator/WCS requests.

Motor start feedback timeout is 1500 ms. After feedback has been seen, dropout timeout is 500 ms. Stop-feedback/stationarity timeout is 4 s. These are declared M8 demo settings, not production tuning.

## Cartons, routing, and completion

Capacity is one physical carton. ReleaseReady requires Auto, actual drive-running feedback, clear beams, both diverts verified home, runout ready, no active carton, and no unacknowledged completion. An offer is not required for release. A second/unexpected entry faults visibly.

Route: 0 unknown, 1 A, 2 B. Divert 1 serves A; divert 2 serves B; exit code 3 is straight runout. An offer prepositions its selected divert when the carton enters. A late assignment may change the effective route only before the relevant approach window has been consumed. D1 approach freezes A reachability; D2 approach freezes B reachability. Approach signals must be placed far enough upstream for the declared actuator travel and the measured 10 Hz transport margin.

An unavailable A/B destination uses runout with an exception. A blocked runout while Auto faults and stops the belt. Readiness is evaluated while a route is still reachable; there is no multi-carton accumulation model in this controller.

Only a rising observed PE_ExitA, PE_ExitB, or PE_Runout edge can produce an exit disposition. The requested route does not create a successful sort. A matching A/B exit additionally requires the selected divert's extended feedback true and home feedback false. Fault checks run before exit-success handling.

Disposition codes: 0 None, 1 Sorted, 2 RunoutUnassigned, 3 Misrouted, 4 Faulted. Unknown at runout is normal. An assigned A/B item at runout or another exit is Misrouted, increments the actual exit count and CountMisroute, and exposes a visible exception without stopping solely for misroute.

A guarded Finish method creates exactly one completion per tracked carton, increments only the observed exit count, then removes that carton from active tracking. A held exit cannot repeat completion. A fault aborts an active carton with disposition Faulted and exit Unknown (0), increments CountFaulted, and does not increment a successful exit count. Later exit edges while faulted cannot rewrite that completion. Clear the physical carton explicitly before Reset. Untracked exit edges outside Faulted are machine faults.

## Minimal WCS contract

Write OfferItemId (nonzero UDINT) and OfferRoute, wait for those payload writes, then write the strictly increasing nonzero OfferSequence last. Keep the payload unchanged until OfferAckSequence equals the request. OfferAckItemId echoes identity; OfferAccepted and OfferReason distinguish accepted, busy (1), malformed (2), conflict (3), and stale/replayed sequence (4). Identical sequences never enqueue again; older sequences are rejected. Creation/receipt timestamps are recorded by the workstation peer, not compared against an unsynchronized PLC clock.

One pending offer is stored before entry. A late offer may bind an unknown active carton or repeat its same identity/assignment; conflicting identity/route is rejected. The requested assignment remains recorded even when too late for the physical route, so eventual runout is a misroute.

CompletionSequence, CompletionItemId, CompletionRoute, CompletionExit, and CompletionDisposition remain available until the peer writes CompletionAck equal to the completion sequence. Until then ReleaseReady is false, so another carton cannot overwrite the record. Unknown physical cartons use item ID 0. No production WCS protocol, queue, durable restart recovery, or multi-carton identity matching is claimed.

## Raw counter and optional diagnostics

Encoder_Count is an unmodified UDINT raw count. The PLC calculates modulo-2^32 delta, total travel at 1000 counts/metre, and a speed estimate over at least 100 ms using PLC monotonic microseconds. No workstation-scaled speed is used for control. A source/counter reset is not distinguished from forward rollover in this demo; reset or rebaseline the application before changing encoder sources at a nonzero count.

The four inherited REAL fields (Belt_SpeedActual, Drive_Current, D1_Position, D2_Position) are compatibility/optional diagnostics only. They are not injected substitutes for PLC scaling, motor feedback, or either pair of limits, and the controller does not use them to make decisions. There is no raw analog channel requiring scaling in the accepted minimum conveyor I/O.

## Fault table

| Code | Cause | Controller response |
|---|---|---|
| 10 | Drive overload | Faulted, motor off |
| 11 / 12 | Motor feedback missing at start / lost while running | Faulted, motor off |
| 13 | Drive/encoder did not reach rest within 4 s of Stop | Faulted, motor off |
| 21 / 22 | D1 / D2 home and extended both true | Faulted |
| 23 / 24 | D1 / D2 extended feedback absent after 1200 ms command | Faulted |
| 25 / 26 | D1 / D2 home feedback absent after 1200 ms return while Auto/Stopping | Faulted |
| 27 | Assigned exit observed without verified divert limits | Faulted, no false success |
| 30 | Unexpected entry / capacity exceeded | Faulted |
| 31 / 32 | Multiple exits / exit without an active carton | Faulted |
| 33 | Active carton has no exit for 30 s continuously in Auto | Faulted |
| 34 | Runout unavailable in Auto | Faulted, motor off |

Faulted turns on red, turns off green, removes all drive/divert commands, latches the first fault, and aborts an active carton once. Stop pauses the transit timer by resetting its elapsed interval; on resume a new 30 s transit interval begins. ConnectorStale is deliberately absent from this machine-fault table.

## Publication and evidence

Use the native OPC UA Symbol Set. Publish GVL_BenchWrite and GVL_DemoWrite read/write; publish GVL_BenchRead and GVL_DemoRead including all Status fields read-only. Do not publish the hardware acquisition struct as a workstation control surface. The versioned map includes logical/IEC paths, types, access, owners, units, normal state, and inversion. Numeric node IDs are discovered after deployment and retained in each run's resolved-symbols.json; none are invented in the static map.

The smoke runner requires build 8001/interface 1 and checks exact IEC paths, types, readability, and required interface writability before writing. Read-group overexposure is recorded as a configuration warning: on 2026-10-31 the user explicitly directed the bench to proceed while never writing those fields. A strict write allowlist permits only input/handshake slots and operator/WCS requests, regardless of server flags. The independent artifact audit verifies that no output/read-group field was written. This does not prove server-side read-only enforcement.

It brackets observations with PLC cycle/capture cycle, retains Good status plus source/server/receipt timestamps, checks boot identity, and verifies every committed complete active image. See SMOKE.md and RESULTS.md. Results are methodical real-PLC tests, not a continuous Muse-generated-world campaign and not new rate/impact qualification.

WebVisu is M8-E, after A–D work. It needs a manual CODESYS editor action because the official MCP has no visualization authoring. Required bindings/layout are in WEBVISU.md. No graphical polish is required.
