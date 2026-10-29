# Assumptions — Conveyor Demo Baseline World

## Specified facts (from accepted specification v0.5, 2026-10-29)

- One infeed/main lane, one powered belt, two sequential two-position diverts, straight runout.
- Divert 1 extended sends a carton to exit A; divert 2 extended sends a carton to exit B; otherwise the carton continues to runout.
- An unassigned carton reaching runout is a normal disposition. An A/B-assigned carton reaching runout is a misroute in PLC/WCS terms; this world only supplies physical truth (actual path/exit and the carton's requested route) and does not count, alarm, or judge misroutes.
- Cartons are physical objects with position and motion; sensors are derived from that state; a belt stop freezes carton position.
- Each actuator moves with travel time; cartons follow the actuator's **actual** position at the decision point, not the intended/requested route.
- Normal simulated DI state with no carton: all photoeyes false, both diverts home true / extended false, drive feedback false, overload false, all three exits ready.
- PLC owns commands and decisions (`Motor_RunCmd`, `D1_ExtendCmd`, `D2_ExtendCmd` are read from the PLC). The world never implements PLC routing, state-machine, alarm, counting, or acceptance logic.
- Drive feedback is delayed after `Motor_RunCmd` and is suppressible on failure.
- Required first-proof fault families in the specification include: sensor bounce/stuck, contradictory limits, drive feedback failure, motor overload/trip, divert jam, carton jam, and downstream blocked.
- Suggested starting values in the specification are explicitly *not* acceptance thresholds until checked against the controller task and transport cadence.

## Inferred configuration (demo defaults, tunable, not acceptance thresholds)

- Carton length 0.30 m, nominal belt speed 0.50 m/s, divert travel 0.35 s each, minimum entry spacing 0.80 m — taken from the specification's visualization suggestions and used only as world physics configuration.
- Geometry (inferred layout distances): entry PE at 0.50 m, D1 approach PE at 1.20 m, divert 1 decision point at 1.60 m, exit A PE at 2.10 m, D2 approach PE at 2.40 m, divert 2 decision point at 2.80 m, exit B PE at 3.30 m, runout PE at 3.60 m. Cartons are removed shortly after their exit/runout PE.
- Drive start delay 0.20 s, drive stop delay 0.15 s, belt acceleration/deceleration ramp 2.0 m/s^2 — inferred plausible device dynamics; no PLC detection deadline is implied.
- Encoder: 1000 counts per metre of actual belt travel, floored (quantized) to an integer, wrapped modulo 2^32 (UDINT). Inferred diagnostic configuration.
- `Belt_SpeedActual`, `Drive_Current`, `D1_Position`, `D2_Position`, `Encoder_Count` are diagnostic signals supplied by the world; the specification states they must not be made mandatory unless the controller actually uses them.
- Downstream readiness changes, sensor faults, jams, overload, and feedback suppression are injected only through declared `onControl` workstation interventions with concrete causes, or through modeled response to PLC outputs.

## Explicitly not assumed (TBD in the specification)

- No PLC acceptance thresholds are invented: drive-fault detection deadline, jam timeout, debounce threshold, late-route policy details, blocked-destination PLC response, heartbeat timeout, and mode/state enumerations remain TBD as stated in the specification.
- WCS offer/ack/completion semantics, counts, alarms, and dispositions are PLC responsibilities. This world exposes cartons (item ID, requested route, actual path) and raw signals only; `carton.introduce` represents the virtual feeder placing a carton, optionally carrying a requested route as physical/item metadata.
- Simulated E-stop/guard and stack lights are not treated as safety validation.
