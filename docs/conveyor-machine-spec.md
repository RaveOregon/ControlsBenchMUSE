# Conveyor bench machine specification — demo baseline

Status: **accepted as the hackathon demo baseline**. Version 0.5, 2026-10-29. The user approved using the proposed defaults without perfecting the fictional machine. Details and acceptance thresholds may be tuned against actual model and PLC behavior; do not treat these choices as production conveyor standards. It is not a safety design, a wiring drawing, or a claim that OPC UA can exchange every PLC scan.

The user's request governs the product direction. This document defines the agreed starting machine and test contract. The final controller under test is actual CODESYS Control Win logic. Muse supplies and operates the external world and upstream service, not a replacement controller. Model-generation work can start before CODESYS is available; surrogate tests must be labeled as such.

## 1. Demo objective and boundaries

**Machine:** one infeed/main lane, one powered belt, two sequential two-position diverts, and a straight runout (jackpot). Divert 1 sends a carton to exit A; if it passes that point, divert 2 can send it to exit B; otherwise it continues straight to runout. An unassigned carton goes to runout as a normal disposition. A carton assigned A or B that misses its divert and reaches runout is a **misroute**, not a successful sort. Cartons are virtual physical objects with position and motion; sensors are derived from that state. A belt stop freezes their position. Each actuator moves with travel time, and cartons follow its **actual** position at the decision point—not the intended route.

**What is under test:** the CODESYS PLC application handles start/stop, route assignment, timing, diverter command/feedback, jam and fault responses, WCS handshake, and operator indications. ControlsBench injects simulated field inputs and upstream messages, observes the PLC outputs and state, and judges behavior against this spec and later engineer-supplied tests. It does not edit PLC logic during a validation campaign.

**First live proof:** the same Muse-authored environment drives a carton to A, a carton to B, an unroutable carton to runout, and a fault/contradictory-input scenario through the real running PLC via the connector. The report shows the requirement, injected condition, PLC response, timing/evidence, and whether the outcome matched the agreed expectation. A pure software copy of the PLC logic cannot satisfy this proof.

**Explicit non-goals for this slice:** physical motors and safety-rated hardware, PID tuning, signal-processing optimization, vendor-general connectors, BACnet, production WCS integration, or guaranteed scan-synchronous OPC UA. Raspberry Pi and touchscreen are stretch goals.

## 2. Physical and logical layout

```text
Virtual feed → PE-ENTRY → belt → PE-D1-APPROACH → DIV-01 ─────→ PE-D2-APPROACH → DIV-02 ─────→ PE-RUNOUT
                                                   │                              │
                                                   └─ extended → PE-EXIT-A        └─ extended → PE-EXIT-B
```

The machine may have one carton in the baseline run. The model should be capable of two cartons in flight for a spacing/queue scenario, but that scenario can be deferred if the real PLC slice is not ready. For the initial model, carton length, spacing, speed, photoeye beam width, **each** actuator's travel, and response delays are configuration values, not hidden constants. Suggested starting values for visualization only: carton length 0.30 m, belt speed 0.50 m/s, divert travel 0.35 s each, and at least 0.8 m between cartons. These values are **not acceptance thresholds** until checked against the controller task and transport cadence.

Nominal cycle: WCS may offer item ID and route → PLC acknowledges any offer → PLC indicates release readiness → feeder places a carton at entry → entry/approach photoeyes change with travel → PLC positions the relevant divert and checks feedback → the carton occupies exactly one of exit A, exit B, or runout → PLC reports completion/disposition and increments the matching count. A carton can enter without a valid destination and then go to runout. This chronology is the observable contract, not an instruction for how the PLC must organize its code.

The simulated plant owns physical truth: carton positions, sensor obstruction, motor/drive feedback, both divert positions, and downstream occupancy. The PLC owns commands and decisions. Muse may inject faults into plant components or message delivery. The test report must distinguish the fault Muse injected from what the PLC could actually observe.

## 3. Operating contract

### Modes and state

The proposed PLC modes are `Stopped`, `Auto`, `Stopping`, and `Faulted`. A separate `BenchSimulationActive` status indicates which input source is selected. Manual/jog mode is optional and not required for the first campaign. Functional stop and simulated E-stop/guard indications must not be presented as validation of a safety-rated circuit.

1. On startup, outputs are off and the **existing, intentional interceptor pattern** defaults to physical I/O passthrough. A deliberate action selects simulated inputs. The exact block grouping and selection UI are implementation details, not a question of whether the interceptor exists.
2. In `Auto`, the virtual feeder can release a carton when the PLC is ready and space is available. A WCS route may already be assigned, may arrive late, or may never arrive.
3. An A assignment must command divert 1 early enough for actual actuator travel. A B assignment passes divert 1 and must command divert 2 early enough. If no usable route exists at a divert decision point, the carton continues on the main lane; if no usable route exists by divert 2, it reaches runout. A route arriving after its reachable decision point must not retroactively count as a successful sort. An unassigned carton at runout is normal; an A/B-assigned carton at runout is misrouted. The proposed demo can also make runout unavailable to test backpressure; the response policy is listed for approval in section 11.
4. Operator Stop stops new feed and commands the belt off immediately; cartons already on the belt halt in place. It does **not** drain the line. A serious machine fault may also stop the belt; a routine unroutable carton does not itself fault-stop the line.
5. Reset acknowledges a cleared fault; it does not automatically restart the belt. WCS and HMI must show the resulting state.

No acceptance test should be scored against an unspecified timing or stop policy. The draft test matrix below separates firm mechanical/interaction expectations from proposed thresholds.

## 4. PLC field I/O contract

Direction is relative to the **PLC application**. `DI` values are produced by the simulated machine during bench mode; `DO` values are read from the executing PLC. The PLC-side integration maps these logical identities to real or simulated I/O without changing the program's core decision logic. Signal names are proposed, not CODESYS node IDs.

| ID | PLC signal | Type | Meaning and simulation rule |
|---|---|---|---|
| DI-01 | `PE_Entry` | BOOL | Carton blocks the entry beam; derived from its position and length. |
| DI-02 | `PE_D1Approach` | BOOL | Carton enters the decision window before divert 1. |
| DI-03 | `PE_D2Approach` | BOOL | Carton continues on the main lane toward divert 2. |
| DI-04 | `PE_ExitA` | BOOL | Carton passes diverted exit A. |
| DI-05 | `PE_ExitB` | BOOL | Carton passes diverted exit B. |
| DI-06 | `PE_Runout` | BOOL | Carton passes the straight runout/jackpot. |
| DI-07 | `D1_HomeFB` | BOOL | Divert 1 is fully home. False during travel or failure. |
| DI-08 | `D1_ExtendedFB` | BOOL | Divert 1 is fully extended. Both D1 limits true is an injectable contradiction. |
| DI-09 | `D2_HomeFB` | BOOL | Divert 2 is fully home. |
| DI-10 | `D2_ExtendedFB` | BOOL | Divert 2 is fully extended. Both D2 limits true is an injectable contradiction. |
| DI-11 | `Drive_RunningFB` | BOOL | Actual drive-running feedback, delayed after `Motor_RunCmd` and suppressible on failure. |
| DI-12 | `Drive_Overload` | BOOL | Simulated overload/trip input; normally false. |
| DI-13 | `ExitA_Ready` | BOOL | Destination A can accept a carton. |
| DI-14 | `ExitB_Ready` | BOOL | Destination B can accept a carton. |
| DI-15 | `Runout_Ready` | BOOL | Runout can accept a carton; normally true. |
| DO-01 | `Motor_RunCmd` | BOOL | Command to belt drive. Cartons move only if the simulated drive actually runs. |
| DO-02 | `D1_ExtendCmd` | BOOL | Extend divert 1 to exit A; deassert returns home. |
| DO-03 | `D2_ExtendCmd` | BOOL | Extend divert 2 to exit B; deassert returns home. |
| DO-04 | `StackLight_Red` | BOOL | Optional visible machine-fault indication if inexpensive to implement. |
| DO-05 | `StackLight_Green` | BOOL | Optional visible running/ready indication. |

Candidate analog/diagnostic signals, not required to operate the first demo: `Belt_SpeedActual` (REAL, m/s), `Drive_Current` (REAL, A), `D1_Position`/`D2_Position` (REAL, 0–100%), and `Encoder_Count` (UDINT). They can support later slip and degradation tests but must not be made mandatory unless the controller actually uses them. If the first demo can only expose Boolean I/O, carton motion may be based on commanded drive plus delayed `Drive_RunningFB`.

### Application status and commands

These are supervisory symbols, not physical I/O. They make the PLC's decisions inspectable without granting ControlsBench authority to edit logic.

| Signal | Direction | Type | Proposed meaning |
|---|---|---|---|
| `Cmd_Start`, `Cmd_Stop`, `Cmd_Reset` | HMI/operator → PLC | BOOL pulse or sequenced request | Operator commands; exact pulse/ack method TBD. |
| `Mode_AutoRequest` | HMI/operator → PLC | BOOL | Request Auto mode. |
| `State_Code` | PLC → observers | UINT/enum | Stopped, Auto, Stopping, Faulted; enumerated values to be frozen. |
| `Fault_Code`, `Fault_Active` | PLC → observers | UINT, BOOL | Active fault identity and status. |
| `Active_ItemId`, `Active_Route` | PLC → observers | STRING/UINT, enum | Current assignment, when present. |
| `Count_ExitA`, `Count_ExitB`, `Count_Runout`, `Count_Misroute` | PLC → observers | UDINT | Exit counts increment on confirmed passage; a commanded A/B item that reaches another exit is additionally a misroute. |
| `BenchSimulationActive` | PLC → observers | BOOL | Confirms simulated input selection. |
| `BenchHeartbeatSeen` | PLC → observers | BOOL | Indicates current workstation stimulus stream; design and timeout TBD. |

The final I/O map must record data type, engineering unit, normal state, writable/read-only access, signal source, owner, OPC UA browse path/node ID, and any inversion. ControlsBench should fail setup visibly on missing, mistyped, or stale required tags—not quietly substitute values.

Normal simulated DI state with no carton: all photoeyes false, both diverts home true and extended false, drive feedback false, overload false, and all three exits ready. The simulator may change readiness, feedback, and fault values only through an explicit scenario or through modeled response to a PLC output. A bench-only `Bench_HostHeartbeat` and a deliberate `Bench_ModeRequest` belong to the instrumentation contract, not to field I/O; exact types and timeout are TBD.

## 5. Upstream and downstream services

### Minimal WCS emulator

Muse acts as a small WCS peer rather than merely flipping a route bit. The first transport may be OPC UA symbols on Control Win, but the logical contract should not depend on those node paths. It must be possible to replace the transport later with a real protocol adapter.

| Message/event | Sender → receiver | Required fields and expected behavior |
|---|---|---|
| `CartonOffer` | WCS → PLC | Unique request sequence, item ID, requested destination A/B or `Unknown`, creation time; one unacknowledged offer at a time in v1. Missing offer is also a testable condition. |
| `OfferAck` | PLC → WCS | Echo sequence and item ID; accepted or rejected with reason. Duplicate sequence must not create a second carton. |
| `ReleaseReady` | PLC → upstream feed | Indicates whether a carton may enter. A valid WCS destination is **not** required to release when runout is available. |
| `RouteComplete` | PLC → WCS | Item ID if known, requested route, observed exit A/B/runout, and disposition (`sorted`, `runout-unassigned`, `misrouted`, or `faulted`); once per carton. A requested A/B item reaching runout is not a successful sort. |
| `MachineStatus` | PLC → WCS | Running/stopped/faulted, fault code, destination availability, and heartbeat or timestamp. |

The WCS emulator should support late route, duplicate offer, conflicting route for the same item, unavailable destination, silence/timeout, and recovery after disconnect. The PLC may route A only while the carton can still reach divert 1 and B only while it can still reach divert 2; otherwise it should use runout and report why. A late route must not rewrite the recorded outcome after the carton passes its reachable divert. Which irregularities the PLC alarms on versus the test harness merely reports remains a review decision.

### Downstream peers

`ExitA_Ready`, `ExitB_Ready`, and `Runout_Ready` are the first downstream-service surface. Muse can switch any to blocked and model carton accumulation. A downstream message protocol is deferred; readiness bits suffice to test blocked-route handling. If runout is blocked and no destination is available, the proposed behavior is stop upstream release and expose a hold condition, not divert blindly. BACnet is a future connector example, not part of this conveyor.

## 6. HMI requirements

**PLC HMI under test (CODESYS WebVisu first candidate; VNC is an alternative):** show a simple main lane with divert A, divert B, and straight runout; live photoeyes; motor command versus running feedback; both divert commands versus each pair of limit switches; current item ID/requested route/actual exit; WCS link/offer state; mode; three destination readiness states and counts; and active fault with plain-language text. Provide Start, Stop, Reset, and Auto request. Every control should have a stable label and a visible result so a vision-based agent can operate and verify it. Acknowledge controls should not erase the fault cause or auto-restart. Display stale/unknown signal quality rather than a plausible-looking false value.

**ControlsBench workspace:** separate from the PLC HMI. Show imported spec and I/O map, connection and bench-mode status, machine visualization, Muse's current plan/assumptions, running test and injected fault, live evidence timeline, findings, coverage, and an engineer-facing report. The user can pause/cancel a campaign and request a follow-up test. The workspace should remain readable and modern, not imitate an industrial panel. HMI screenshot/action evidence attaches to the same test timeline as OPC UA and WCS observations.

| ID | UI acceptance requirement |
|---|---|
| UI-01 | PLC HMI Start/Stop/Reset/Auto controls have stable visible labels, distinct states, and a visible acknowledgement or resulting state. |
| UI-02 | PLC HMI distinguishes commanded motor/divert state from feedback; it does not paint a device as moving solely because a command is on. |
| UI-03 | PLC HMI shows active fault text and machine mode without requiring navigation away from the main machine view. |
| UI-04 | PLC HMI indicates stale/unknown values and WCS disconnect, rather than displaying a normal-looking value as current. |
| UI-05 | ControlsBench shows each running experiment, Muse's active hypothesis or plan, what it is currently injecting, and the PLC response. |
| UI-06 | ControlsBench lets the engineer inspect evidence and mark a finding accepted or request a targeted rerun/follow-up. |
| UI-07 | The final report distinguishes observed PLC evidence, simulated ground truth, inferred diagnosis, and assumptions. |

Vision-driven HMI operation is a high-value goal, not a dependency for first live I/O validation. If cut for time, direct operator-command symbols may exercise the same behavior, and the report must state that the HMI was not visually tested.

## 7. Connectivity and PLC-side instrumentation

ControlsBench's **decided architecture** has two replaceable layers: a vendor-specific PLC-side I/O interceptor/instrumentation library and an independently selectable workstation transport. The interceptor lets the ordinary application consume hardware or simulated I/O and defaults to hardware passthrough at startup. The PLC continues to execute its real logic each scan; transport updates occur at their own cadence. A one-scan apparent I/O delay is an acceptable design target, not a requirement that OPC UA communicate every scan. For Control Win, the implementation may expose `BenchInputs` (workstation-writable), `ObservedOutputs` and statuses (readable), the deliberate input-source selector, and a versioned signal map via CODESYS symbols. Per-signal versus grouped blocks is still a prototype choice. The bench connector must not overwrite controller logic, force arbitrary internal variables, or use the Machine Agent mixer's hidden-fault controls as a generic test interface.

The first workstation transport is OPC UA. The current Machine Agent code offers a direct `node-opcua` adapter with batched initial read, monitored subscriptions, quality status, typed write and readback. It needs a conveyor signal map, per-value timestamps, write acknowledgement/verification, freshness handling, reconnection, and independent simulation authority. A write to `BenchInputs` is a physical stimulus on the bench; an application-state observation is not a stimulus. HMI and WCS commands must be distinguishable from field-input writes.

**Timing acceptance gate:** configure and record the PLC task period, actual OPC UA sampling/publishing intervals, write-to-PLC application latency, output-observation latency, jitter, dropped updates, and stale-value behavior. Do not claim each scan is mirrored over OPC UA solely because the PLC scans quickly. CODESYS documents a configurable OPC UA minimum sampling rate, with 100 ms shown as the default; sub-100 ms sensor bounce may therefore need a PLC-task-side stimulus queue or a faster connector. A generated timestamped stimulus sequence executed by the PLC-side bridge is acceptable if Muse creates/controls it, the real PLC logic reads it, and the harness observes the response. This is a proposed fallback, not a hidden conversion to offline script testing. See [CODESYS OPC UA server configuration](https://content.helpme-codesys.com/en/CODESYS%20Communication/_comm_opcua_server_config.html) and [IEC symbol configuration](https://content.helpme-codesys.com/en/CODESYS%20Communication/_cds_obj_symbolconfiguration.html).

On workstation disconnect, the bridge should mark input quality invalid and stop introducing new virtual cartons. Exact motor behavior is a PLC program requirement to review; ControlsBench should record the disconnect and mark the affected test inconclusive if it cannot observe the controller. This is bench failure handling, not a blanket refusal to test.

## 8. Muse-generated environment contract

The model Muse creates from this spec should supply:

- **State:** carton IDs, positions, lengths, requested routes, actual exits, belt speed, two divert positions, downstream capacity, actuator and drive states, timers, and active faults.
- **Inputs observed:** actual `Motor_RunCmd`, `D1_ExtendCmd`, `D2_ExtendCmd`, PLC state/route/status, WCS replies, and operator commands where relevant.
- **Time evolution:** carton movement only with actual drive feedback; each actuator's travel with nonzero delay; sensor edges from geometric occupancy; transfer to exactly one exit.
- **Stimuli emitted:** all DI values, upstream messages, and eligible operator actions through their respective connectors.
- **Fault knobs:** sensor bounce/stuck, contradictory sensor combinations, feedback failure, motor trip, either divert jam, carton jam, downstream blocked, route/communication irregularities.
- **Evidence:** effective input values applied, PLC output/status observations, their quality/timestamps, WCS exchange, model state, fault injection, HMI action/screenshot, and test decision.

Muse chooses tests and may revise the environment while the exchange loop continues. Its language-model call is not in the hard-timing path. A known model fault is retained as the ground truth for the bench report, but must not be leaked into the PLC-observation stream as a diagnosis. Exact byte-for-byte replay across campaigns is not required; enough event and trace evidence to explain each result is required.

## 9. Proposed requirement and test matrix

`MUST` means proposed acceptance behavior, still subject to review. `PROBE` means a valuable exploratory test whose expected PLC behavior needs an engineer decision. Times are recorded and compared with approved limits; provisional numbers below are not silently enforced.

| ID | Requirement / scenario | Stimulus and observation | Proposed oracle |
|---|---|---|---|
| R-01 | Start/stop and no motion while stopped | HMI/command Start and Stop; watch motor and carton position | MUST: Stop removes the motor run command and inhibits new feed; cartons halt with drive feedback off. No drain-to-empty behavior. |
| R-02 | Normal A sort | WCS assigns A; release one carton | MUST: D1 actuates in time, one A passage/completion, no B or runout passage, count once. |
| R-03 | Normal B sort | WCS assigns B; release one carton | MUST: carton passes D1, D2 actuates in time, one B completion, count once. |
| R-04 | Normal runout/jackpot | No valid route; release one carton | MUST: it continues straight to runout; report `runout-unassigned`, not a machine fault or successful A/B sort. |
| R-05 | Late or conflicting route | Offer A after D1 is no longer reachable, or change an assigned route in transit | PROBE: do not claim successful A retroactively; use reachable route or runout and report actual disposition. Exact late-B policy TBD. |
| R-06 | Destination not ready | Block A or B before its decision point | PROBE: proposed exception and runout disposition; never count a blocked exit as successful. |
| R-07 | Runout blocked | Set `Runout_Ready` false with an unroutable carton approaching | PROBE: proposed feed inhibit and belt stop before congestion; confirm policy before scoring. |
| R-08 | Duplicate WCS offer | Repeat same sequence/item | MUST: no second carton or second completion. |
| R-09 | Sensor bounce | Short repeated edges on entry or either approach photoeye | PROBE: no duplicate item/count or unstable divert decision. Exact debounce threshold and injection method TBD. |
| R-10 | Stuck/failed photoeye | Hold one PE true or false despite carton movement | PROBE: timeout/plausibility evidence, no invented completion; PLC reaction threshold TBD. |
| R-11 | Motor command without feedback | Suppress `Drive_RunningFB` after run command | MUST: detected drive-start fault, no virtual motion, no false completion. Detection deadline TBD. |
| R-12 | Motor overload/trip | Assert `Drive_Overload` during travel | MUST: motor command removed, new feed stopped, fault shown; no auto-restart after reset. |
| R-13 | D1 fails to move | Assign A; hold D1 home or neither limit despite command | MUST: if carton reaches runout, report misroute, not A completion; fault indication and deadline TBD. |
| R-14 | D2 fails to move | Assign B; hold D2 home or neither limit despite command | MUST: if carton reaches runout, report misroute, not B completion; fault indication and deadline TBD. |
| R-15 | Contradictory limits | Assert home and extended feedback simultaneously on D1 or D2 | PROBE: expose inconsistent feedback and avoid a false verified-divert claim. Exact PLC alarm behavior TBD. |
| R-16 | Impossible exit combination | With **one** carton, assert A and B, A and runout, or B and runout photoeyes together | PROBE: no double completion/count; report contradiction and controller response. |
| R-17 | Impossible sequence | Report exit before entry, D2 approach before entry, or a jump from D1 approach to an impossible exit | PROBE: identify suspect sequence and avoid an unearned pass. Do not assume one generic PLC alarm is required. |
| R-18 | Command/feedback disagreement | Report motor running while command is off, or divert extended feedback without its command | PROBE: record diagnostic response; consider whether this reveals an unsafe or incorrectly counted state. |
| R-19 | Carton jam | Hold carton at D1, D2, or runout while drive runs | MUST: timeout/fault or equivalent and no invented completion. Threshold TBD. |
| R-20 | WCS link loss/recovery | Pause messages or heartbeat; resume | PROBE: visible link state, runout/hold according to policy, no duplicate completion on retry. |
| R-21 | Transport interruption | Break/reconnect OPC UA during a run | MUST: stale evidence labeled, no false pass; recovery and PLC response recorded. |
| R-22 | HMI congruence | Operate Start/Stop/Reset via visible HMI | MUST if vision included: button action, displayed state, and actual PLC state agree. |
| R-23 | Multi-carton spacing | Two close cartons with different routes | PROBE/stretch: each carton reaches one correct exit without identity merge or conflicting divert timing. |

**Agent-led exploration beyond this seed matrix:** Muse should infer additional plausible combinations and transition-order faults from the geometry, signal types, and operator/WCS requirements, then choose experiments based on the actual PLC response. The seed list must not become a hidden fixed script. A single carton cannot physically occupy two of the three exits at once, and one divert cannot physically report home and extended simultaneously; however, both divert commands or multiple photoeyes can legitimately be active with multiple cartons. The oracle must use carton count and timing context before calling a combination impossible. For an exploratory condition with no agreed PLC reaction, report observation and uncertainty rather than fabricating a pass or fail.

Common optical-sensor faults such as contamination or misalignment causing faulty switching are grounded in [SICK's conveyor sensor maintenance guidance](https://www.sick.com/media/docs/6/56/456/addendum_to_operating_instructions_vms4300_5300_en_im0106456.pdf). The fault matrix is a design proposal, not a claim that every industrial conveyor must use these exact detectors or reactions.

## 10. Report and demo acceptance

Each test result should identify requirement/test ID, spec version, controller build and connector map, model version/assumptions, stimulus and injected fault, WCS/HMI actions, observed outputs and timing/quality, verdict (`pass`, `fail`, `inconclusive`, or `not run`), and a short explanation citing trace points. The report should expose untested requirements and any assumptions Muse made. It must not call a test passed because the simulator's own expected state looked correct; it needs evidence from the executing PLC.

For the hackathon's minimum credible live sequence: discover/map tags, confirm bench mode, generate the environment, start Control Win, sort A, sort B, run one unassigned carton to runout, inject a failed-divert or noisy-photoeye condition, let Muse choose and execute at least one follow-up (for example an unexpected input combination), and deliver the report. Show actual connection and measured timing in the workspace. If any part uses a fallback simulator or predetermined trace, label it plainly.

## 11. Accepted demo defaults and remaining implementation choices

The PLC-side I/O interceptor and hardware/simulation selector are **already decided**. Only its CODESYS implementation shape—per-signal, grouped by type, or another vendor-appropriate pattern—remains to prototype. The first machine has two diverts plus runout. The user confirmed: unassigned cartons normally run out; assigned cartons that miss their divert and reach runout are misroutes; operator Stop stops the belt and new feed without draining. The live demonstration may include input-combination exploration in addition to a familiar equipment fault.

The following defaults were accepted for this demo, subject to adjustment when measured behavior warrants it:

1. **Misroute response:** default recommendation is a visible exception/event to WCS and HMI, with no automatic belt stop solely because a carton reached runout incorrectly. A failed actuator may separately produce a machine fault.
2. **Blocked destination:** default recommendation is to send a carton assigned to blocked A/B to runout with an exception; if runout itself is blocked, inhibit new feed and stop the belt before congestion. This is a demo policy, not a universal conveyor rule.
3. **WCS scope:** default recommendation is the simple offer/ack/release/completion contract in this document over mapped OPC UA symbols. Do not implement a production WCS protocol for the hackathon.
4. **HMI scope:** CODESYS WebVisu if available, showing the fork, status, and Start/Stop/Reset. Record the HMI video concurrently with a test run and correlate it with the signal trace. Muse's video observations are desirable; vision-driven operation is a stretch after the live I/O loop works. VNC is a fallback, not an initial dependency.
5. **Demo test emphasis:** default recommendation is one A sort, one B sort, one normal runout, a failed divert or bouncing photoeye, and at least one agent-chosen contradictory-input follow-up. One carton at a time is enough for the first live demonstration; multi-carton spacing stays exploratory.

No further machine-design approval is required to begin the first slice. The CODESYS interceptor shape and measured timing remain implementation questions. Before parallel PLC and simulator implementation, record the exact signal interface and any test thresholds that experience shows need tightening; keep changes explicit so the test oracle does not drift silently.
