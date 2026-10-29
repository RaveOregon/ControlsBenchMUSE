# Current Checkpoint — Gates A, B, and C Passed

Updated 2026-10-29. This checkpoint exists so work can resume on another computer without reconstructing the design conversation.

## Resume Here

Read in this order:

1. `HANDOFF.md` — concise project state and next sequence.
2. `docs/architecture-decisions.md` — authoritative settled/provisional/open design register.
3. `docs/conveyor-machine-spec.md` — accepted first-machine specification.
4. `docs/model-selection.md` — Wonder versus Spark evaluation and primary-model decision.
5. `docs/hackathon-brief.md` — event requirements, judging, resources, and submission checklist.
6. `docs/frontier-roadmap.md` — local Glimmer, broad autonomy, and adaptive-weight upside.
7. `docs/first-proof-contract.md` — accepted generated-world chassis contract, Gate A result, checkpoint matrix, and later go/no-go gates.

Gates A, B, and C are implemented and passed. Do not rebuild them or begin PLC/UI work without first reading the preserved generated package and results.

## Product Goal

ControlsBench Muse is a controls-engineer workstation for autonomous bench testing of executing PLC logic. The engineer supplies a functional specification, raw I/O/device information, and an editable PLC project in which a thin vendor-specific interceptor library is installed. Muse creates a believable external world and active campaign, supplies the PLC's raw input image, observes raw PLC outputs, changes course from evidence, and produces a grounded report.

The differentiator is not static PLC source review, a hand-built conveyor simulator, a fixed test list, or graphics. It is a Muse-authored, continuously adaptive, closed-loop campaign around the real executing controller.

## Work Completed

- Repository and historical handoff reviewed.
- Hackathon participant guide, event page, rules, Model API documentation, and official cookbooks reviewed and consolidated.
- Entry strategy selected: Indie Developer, Build for Your World.
- Primary model selected through direct comparison: `muse-wonder-1.0`, Standard mode, high reasoning.
- Wonder and Spark artifacts preserved in `artifacts/model-spikes/`.
- Wonder first call: 163.2 seconds, 6,972 input tokens, 19,048 output tokens, approximately $0.4088 estimated; user observed the matching credit debit.
- Spark comparison: 83.0 seconds and approximately $0.0809 estimated; it was cheaper/faster but missed explicit requirement coverage that Wonder included.
- Model spike runner added at `scripts/run-model-spike.js` and exposed as `npm run spike:model`.
- Official cookbook lessons recorded in `docs/model-api-playbook.md`.
- Frontier local-model and adapter-training path recorded in `docs/frontier-roadmap.md`.
- Extensive pre-build product decisions captured in `docs/architecture-decisions.md`.
- The generic Gate A chassis, strict manifest validation, instrumented `WorldContext`, platform tests, bounded generation, repair lineage, and independent runner are implemented.
- Wonder generated the complete conveyor package under `artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/`.
- CP-0 through CP-4 pass: compile/generated tests, zero-image startup, drive causality, raw encoder behavior, carton geometry/photoeye behavior, physical deceleration, and post-stop hold.
- CP-5 through CP-7 pass against the same restored world with no additional model call: A actual-position routing, missed-A runout, B routing, unassigned runout, sensor stuck/bounce, missing drive feedback, divert jam, and cleanup/recovery.
- The preserved passing coast was 57.6 mm over 260 ms. An attempted instant-stop rewrite was rejected after engineer clarification and the original generated source restored byte-for-byte.
- Behavioral repair now has a formal guardrail: classify accepted requirement, declared-assumption defect, unresolved assumption, or faulty oracle before changing generated physics.
- CP-8 passed with an honestly inconclusive sealed verdict: Wonder identified `sensor.entry` and a stuck-high mechanism but retained `unknown` taxonomy because the raw trace could not exclude a held object.
- CP-9 passed with a genuinely Muse-authored bounded belt-motion follow-up through the same world; confidence rose from 0.35 to 0.78 and the useful discrepancy was exposed.
- CP-10 passed: the evidence-only candidate preserved the live state hash, activated after shadow health, and a deliberately failing successor rolled back. Structural wrapper repairs never modified conveyor behavior.
- CP-11 passed: request timeout, repair failure escalation, campaign stop, stale heartbeat, valid condition wait, and wait timeout were distinguished while the healthy world stayed active.
- Gate C conservatively accounts $3.25 across six calls, including one completed response rejected before persistence. This is warning level under the accepted limits and below the $5 hard stop.

## Most Important Settled Decisions

- Workstation owns the world, complete raw DI/AI image, scheduling, faults, evidence, and campaign.
- PLC integration requires editable source/build access to install a thin vendor-specific interceptor; compiled-only untouched PLCs are not currently supported.
- Preferred PLC library topology is type-oriented DI, AI, DO, and AO blocks at the raw I/O boundary, with platform-specific alternatives where necessary.
- Hardware passthrough is the default. Simulation mode takes complete ownership of every raw DI/AI value.
- Enabling simulation immediately initializes the complete input image to false/zero; PLC behavior during preparation is valid evidence.
- PLC DO/AO commands remain authentic and normally continue to physical bench outputs while always being exposed to the workstation. Engineers can suppress selected physical sinks.
- Connector loss holds the last simulated input image and may expose a non-HMI bench-link-stale diagnostic.
- OPC UA is the demo connector; EtherNet/IP cyclic I/O or another faster vendor transport is a production path behind the same connector contract.
- Connected PLC/wall-clock time is authoritative. Acceleration is only for disconnected/surrogate/training runs.
- Muse stays actively involved and may use hold, continue, or event/deadline decision leases per action.
- Start Campaign is the single authorization. Muse can branch, inject faults, and add adaptive investigations without per-check approvals; engineer retains Pause/Stop and natural-language steering.
- Generated world is a workshop: a minimal structured manifest labels signals/devices/state/evidence, while Muse-generated TypeScript is the single behavioral source of truth.
- Generated code is not an engineer maintenance task. The engineer sees an expandable campaign plan, live truthful activity text, trace, evidence, and a lightweight schematic.
- First world has continuous 1D physical state: geometry, carton motion, sensor zones, actuator motion, runout, and raw encoder/device behavior. Do not build a general graphics or 3D engine.
- Variation across exploratory runs is a feature; provenance loss is not. Save generated code, world state, seeds, actions, trace, and model identity.
- Generic PLC source review is outside the core. Source may help localize a demonstrated failure when a useful IDE connection/export exists.

## Latest UI Direction

The normal view should contain:

- expandable campaign categories such as I/O, startup/modes, functional, runtime/timing, alarms/fault/recovery, normal operation, edge/stress, and adaptive investigations;
- grounded Codex/Kiro-style activity text showing what Muse/runtime/connector/PLC is doing or awaiting;
- raw I/O trace and evidence;
- a lightweight SVG/Canvas conveyor schematic for orientation, not an intensive graphics package.

Pause freezes the workstation world and holds inputs. Stop finalizes the campaign and holds the final state for inspection. Reset stays in simulation but zeros all inputs. Exit Simulation deliberately returns to hardware passthrough.

## Remaining Design Questions

The authoritative list is at the end of `docs/architecture-decisions.md`. At the time of this checkpoint, the unresolved topics are:

1. Confirm or revise the Muse/world/execution-coordinator/connector/evidence responsibility split.
2. Finish raw signal type/quality/encoding/sample/stale semantics.
3. Decide whether the first CODESYS proof needs input revision/applied acknowledgement or begins with measured sparse OPC UA writes.
4. Finalize truth/evidence structures for the real connector and product report.
5. Define campaign completion and coverage expansion.
6. Lock the real-connector measurement boundary and success criteria.

The live-code-modification question was settled after the original checkpoint: Muse may rewrite and hot-reload generated TypeScript during an active campaign. Candidate code compiles/tests while the incumbent runs, state is snapshotted and migrated, activation is atomic at a coordinator boundary, and failure rolls back automatically. See `docs/architecture-decisions.md` for the full contract.

Automatic generated-code self-repair was also accepted, with visible hard cost/time/token/call budgets. Initial hosted defaults are $1 per request, $2 per repair episode, campaign warning at $3 and hard stop at $5, $15 per session, five-minute request timeout, and failed-repair warning/stop at three/five. Local models retain time/token/failure/compute limits even with no API dollar cost. When a limit is reached, model calls stop and the last valid/held state is preserved until the engineer extends the budget or stops.

Connector synchronization was clarified after the original checkpoint: the workstation owns full world/signal state but streams changed/current raw values, not a complete runtime or playback array. Each update or heartbeat frame gets a workstation sequence that the PLC interceptor echoes after consumption. A PLC-resident scheduled-pattern player remains a deferred timing option only if later measurements justify it.

Known-fault and blind-diagnosis modes were both accepted. `docs/fault-library.md` now defines the spec/core/Muse-generated/learned sources, reusable raw-I/O/device/transport/HMI/alarm families, hidden truth rules, evidence lanes, scoring, and first-proof subset using authoritative vendor, HSE, and ISA sources.

## Immediate Next Work

Gate C is complete. The next checkpoint is Gate D:

1. CP-12 audit the full artifact/evidence package for internal consistency and any provenance gaps.
2. Write and accept the CODESYS/OPC UA measurement plan: interceptor topology, tag contract, sequence echo/heartbeat, timestamps and quality, sparse/multi-signal writes, expected rates, failure modes, and pass/stop thresholds.
3. Only after both are accepted, begin the real CODESYS interceptor/connector spike.

Do not jump directly to a polished UI. Gate D must make the existing proof auditable and define what the live connector experiment will actually prove.

## Local-Only Items

- `.env` is gitignored and is not included in this checkpoint or Git push.
- On the new computer, create `.env` from `.env.example` and set `MODEL_API_KEY` locally.
- Never commit or print the key.
- The repository remains private until the user explicitly chooses public hackathon publication and a license.
