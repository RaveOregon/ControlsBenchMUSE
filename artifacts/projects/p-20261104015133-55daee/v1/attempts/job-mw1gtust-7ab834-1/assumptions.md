# Assumptions — slow-belt conveyor world (m8-conveyor-1.0.2)

## Specified values used exactly
- Nominal belt speed **0.30 m/s** (§2 variant parameter). This is a physical world parameter, not a PLC acceptance threshold.
- Carton length 0.30 m and divert travel 0.35 s each are the §2 suggested starting values; they are configuration values, not acceptance thresholds.
- Normal no-carton state (§4): all photoeyes false, both diverts home=true/extended=false, drive feedback false, overload false, all three destinations ready.
- Layout order (§2): Entry → D1 approach → Divert 1 → D2 approach → Divert 2 → Runout; extended D1 → Exit A, extended D2 → Exit B.

## Inferred values (labelled `inferred` in physicalParameters)
- **Geometry (inferred, not in spec):** path coordinate `positionM` is the carton leading edge along its travelled path. PE_Entry 0.30 m, PE_D1Approach 1.00 m, D1 decision point 1.40 m, PE_D2Approach 2.00 m (main-lane cartons only), D2 decision point 2.40 m, PE_ExitA 2.00 m on the A branch (0.60 m past D1), PE_ExitB 3.00 m on the B branch (0.60 m past D2), PE_Runout 3.20 m on the main lane. Cartons are removed 0.50 m past their exit/runout sensor (downstream take-away). The spec gives no distances, so these were chosen only to make sensors geometric and sequential; no test oracle should score against them.
- **Drive dynamics (inferred):** acceleration and deceleration 0.60 m/s² (0 → 0.30 m/s in 0.5 s). Stop therefore coasts and then holds position per §3.4; exact accel/decel are not specified.
- **Drive feedback delay (inferred):** Drive_RunningFB asserts 0.10 s after the drive is actually energised and drops when de-energised or when the feedback-failure fault is active. §4 requires a delay but gives no value.
- **Drive failure semantics:** `fault.setDriveFeedbackFailure` is modelled as the drive producing no running state (no belt motion), consistent with R-11's proposed oracle of "no virtual motion". Whether a real feedback-only failure (motor turning, feedback lost) should instead keep cartons moving is an open question below.
- **Divert decision threshold (inferred):** a carton is diverted if the divert's actual position is ≥80 % extended when its leading edge reaches the decision point (§1: cartons follow actual position). No threshold is specified.
- **Encoder (inferred):** 1000 counts per metre of belt travel, floor-quantised, UDINT wrap at 2^32. The PLC owns any scaling (§ world rules; spec lists Encoder_Count as candidate diagnostic).
- **Drive_Current (inferred):** 0 A stopped, ramping proportionally to speed up to ~2.0 A at nominal speed, 8 A while the overload fault is active. Diagnostic only.
- **Carton jam:** `fault.setCartonJam` holds all present cartons stationary while the belt/encoder continue to move underneath (a physical jam), until cleared.
- **Sensor bounce:** toggles the affected boolean input on alternate 100 ms ticks while active. §7 notes sub-100 ms bounce may not be observable over the transport; bounce rate/debounce expectations are not specified.
- **Multi-carton:** cartons are introduced at position 0 regardless of spacing; the 0.8 m spacing in §2 is a scenario suggestion, not enforced physics. Introduction is never blocked by the world — release gating is PLC logic.

## Deliberately not modelled in the world
- PLC sequencing, route assignment, counting, alarms, misroute judgement, WCS handshake and stack-light logic are the system under test and are never implemented in world.ts.
- WCS offers, operator Start/Stop/Reset and mode requests are supervisory symbols (§4/§5), not part of the 25-signal bench map; they appear only in the test plan as operator/WCS actions for the campaign harness.
