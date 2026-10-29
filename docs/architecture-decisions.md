# ControlsBench Architecture Decisions

Updated 2026-10-29 during the pre-build design review.

This is the current decision record for the executable world, run orchestration, PLC boundary, autonomy, and learning architecture. It distinguishes decisions the user has accepted from recommendations and unresolved questions. Do not silently convert a recommendation into a settled decision.

Status vocabulary:

- **Settled:** explicitly accepted or corrected by the user.
- **Provisional:** recommended direction awaiting explicit acceptance.
- **Open:** requires a design decision before implementation.

## Settled Decisions

### Product and intelligence boundary

- ControlsBench is an engineering-workstation product, not a small embedded edge appliance.
- Hosted Muse Wonder is the primary model for the first complete proof because capability matters more than using the smallest or easiest model.
- Muse Glimmer is the relevant future local Muse model. A suitably powerful workstation can use it for a persistent, lower-latency, offline agent. Llama is not part of the selected product story.
- The agent should have broad authority inside the sequestered simulated bench. Conventional narrow allowlists must not reduce the product to canned testing.
- The PLC program under test remains unchanged during validation. A future repair mode is a separate activity.

### Workstation owns the simulated world

The workstation owns:

- the logical signal manifest and transport mappings;
- world-to-PLC and PLC-to-world signal images;
- the generated world implementation;
- world entities, state, parameters, timers, and scheduling;
- interactive stimuli, generated runs, faults, and later run variants;
- trace capture, evidence, agent state, and training trajectories;
- connector behavior and OPC UA translation.

The PLC should remain light. Its bench integration is limited to what is required to:

- deliberately select hardware or simulated inputs;
- expose writable simulated-input variables;
- expose PLC outputs and useful status;
- confirm that simulation mode is active;
- optionally acknowledge an applied input revision and expose a lightweight link diagnostic.

The PLC does not initially own signal schedules, run programs, event buffers, simulated entities, fault logic, or evidence processing. Add scan-resident behavior only if measured transport limitations prove it necessary for a specific test.

### Controls-engineer-installed interceptor library

- ControlsBench is a bench-testing tool for controls engineers. Installing the PLC-side library is an intentional engineering step, not a zero-touch attachment to an arbitrary binary controller.
- The interceptor sits immediately after the platform acquires its raw input image and before application logic consumes those values. Application logic uses the interceptor output rather than reading the hardware image directly.
- In normal mode the interceptor is transparent: raw hardware values pass through unchanged.
- In simulation mode the interceptor selects the workstation-supplied raw image while preserving the same application-facing types and structure.
- The ideal default organization is by I/O class rather than one monolithic wrapper or a separate block for every individual point:
  - **DI interceptor:** raw discrete inputs;
  - **AI interceptor:** raw analog/counter/numeric inputs;
  - **DO interceptor/tap:** application discrete-output commands;
  - **AO interceptor/tap:** application analog/numeric-output commands.
- Adding an I/O point should require a small, repeatable mapping step into the appropriate type-oriented block. Tooling may later generate or verify that mapping.
- The output side must expose the raw application command to the workstation so the simulated device/world can respond before any convenient engineering-unit interpretation hides PLC output behavior.
- Platform adapters may use another layout when the PLC runtime, I/O model, language, or task structure cannot support centralized type wrappers. Supported alternatives may include device/assembly wrappers, per-module wrappers, or selected per-signal interceptors, but they implement the same workstation contract.

The common contract matters more than identical PLC code across vendors. Vendor-specific libraries remain thin: selection/tapping, mapping, status, and transport exposure stay in the PLC; world behavior and campaign intelligence stay on the workstation.

### Physical output behavior during simulation

- Application DO/AO commands remain the authentic commands produced by the PLC program and are always exposed to the workstation world and trace.
- Entering simulation mode does not suppress physical outputs globally by default. On a normal sequestered bench there should be nothing harmful to actuate, and preserving normal output behavior helps the PLC application, attached indicators, and HMI present the same state they ordinarily would.
- The output interceptor is downstream of the application command so suppressing a physical channel never rewrites or conceals the command Muse and the engineer are evaluating.
- A controls engineer may configure a per-channel or per-group physical-output override when attached bench hardware should be ignored.
- Suppression affects only the physical sink. The workstation still receives the original raw application command, and the run record identifies that the corresponding hardware output was suppressed.
- Platform implementations may express suppression as a mask, output gate, remapping, or vendor-specific equivalent while retaining the same semantics.

### Complete workstation ownership of inputs in simulation mode

- Input selection is global for the simulated raw image in the initial product: hardware mode supplies the hardware DI/AI image; simulation mode supplies the complete workstation DI/AI image.
- Do not mix uncontrolled physical input channels into a simulated run. Hidden physical changes would make Muse's world state incomplete, weaken causality, and confuse evidence attribution.
- The workstation maintains the authoritative complete input image even when the connector optimizes transport by writing only changed values.
- Every input transition during simulation is attributable to the generated world, an explicit Muse/engineer action, or a recorded workstation/runtime event.
- Physical inputs may be observed separately for diagnostics in a future platform adapter, but they do not feed application logic while full simulation mode is active.
- Partial hardware-in-the-loop or mixed-I/O testing may be designed later as an explicit separate mode with clear ownership metadata. It is not part of the initial simulation contract.

This intentionally differs from outputs: simulated runs take complete ownership of DI/AI, while application DO/AO continues to the workstation and normally to physical bench outputs unless an engineer suppresses selected sinks.

### Simulation activation initializes a zero raw image

- When simulation mode is enabled, the application-facing simulated input image immediately initializes to the zero value for every supported raw type: `false` for booleans, numeric zero for integer/word/real channels, empty/zeroed values for strings or composites where supported.
- ControlsBench does not preload configured "normal" or "safe" field conditions before making simulation active.
- The PLC continues scanning against this zero image while the workstation, generated world, and Muse prepare the run.
- `SimulationActive` and `RunReady`/`WorldReady` are distinct states. The latter is coordination metadata; it must not gate or conceal the PLC application's response to the zero image.
- Trace and evidence capture begins at or before the simulation-mode transition so startup faults, permissive loss, alarms, mode behavior, and recovery requirements are visible.
- If the application requires a particular permissive or safe field condition before it can operate, Muse must establish that condition through explicit raw inputs or evaluate the PLC's inability to reach it. This behavior is part of bench testing.
- A later connector loss still holds the last simulated input image; it does not re-zero the image.

### Inject at the raw hardware-image boundary

- ControlsBench supplies the raw signal representation the PLC application would receive from its hardware or device interface.
- Boolean field inputs are supplied as booleans at the corresponding raw input boundary.
- Analog, counter, encoder, and network-device values are not pre-normalized into engineering units before entering the PLC logic.
- The workstation world maintains physical truth in appropriate engineering units, while a generated transducer/device model converts that truth into raw PLC-facing values.
- PLC application logic remains responsible for scaling, normalization, filtering, debounce, range checks, rollover handling, status decoding, and engineering-unit conversion.
- This boundary is required so ControlsBench can find defects in scaling, signedness, resolution, quantization, saturation, endianness, count rollover, missing/doubled pulses, noise, drift, dropout, stale values, filtering, and device-status handling.
- PLC outputs should likewise be observed at the actual application/device boundary appropriate to the test. A world may decode raw output words, counts, or commands into physical actuator behavior rather than consuming an already-corrected semantic value.

The signal contract therefore distinguishes:

1. **Physical truth:** the workstation world's actual position, speed, pressure, temperature, and other simulated facts.
2. **Device/transducer behavior:** encoder pulses, analog conversion, quantization, noise, status words, protocol fields, and faults.
3. **Raw PLC image:** the boolean/integer/word/array values injected into or observed from the PLC program at the hardware cut point.
4. **PLC-derived engineering state:** normalized values and decisions calculated by the program under test; these may be observed as read-only evidence but are never substituted for raw stimulus.

Example: belt speed exists in the world as m/s, but an encoder channel is delivered to the PLC as changing counts or pulses according to resolution, geometry, sample time, direction, wrap behavior, and injected faults. The PLC must calculate speed correctly.

### Progressive PLC observability

ControlsBench's current interception architecture requires access to an editable and rebuildable PLC project. A vendor-specific ControlsBench library or integration layer must be inserted at the raw hardware/device image so the application can deliberately select simulated inputs and expose the required signals. An untouched compiled/protected controller is not currently a supported target.

Distinguish two kinds of source access:

1. **Integration access is required:** an engineer or integrator can open, modify, rebuild, and download the PLC project to install and configure the interceptor library.
2. **Machine-readable Muse access is optional:** the IDE may not offer MCP, a useful export, symbols, or a source format that ControlsBench can easily provide to Muse during a campaign.

After interceptor installation, campaign execution must work from the specification, configured raw signal contract, connector, and observed PLC behavior. It must not require Muse to read the source on every supported platform.

Use four explicit observability levels:

1. **Black-box I/O:** raw injected inputs, observed raw outputs/status, connection quality, and timestamps.
2. **Gray-box signals:** optional read-only internal tags, scaled values, state-machine states, timers, diagnostics, and other variables that the customer publishes through a connector or instrumentation library.
3. **Source-aware diagnosis:** PLC source, exported project representation, symbol information, and libraries are available for static analysis and correlation with the observed trace, but internal online execution is not directly visible.
4. **White-box runtime:** a future vendor/debug connection supplies live internal values, execution state, or other online-monitoring evidence.

The current CODESYS path may optionally combine source-aware access with connector-observed signals, but raw-I/O execution and evidence remain the required product proof after the interceptor has been installed.

Reports must label evidence origin:

- **observed raw I/O**;
- **observed internal signal**;
- **static source fact**;
- **inferred execution path or diagnosis**.

Muse may use available source after a behavior has been demonstrated to identify likely rungs, networks, Structured Text branches, scaling functions, state transitions, or timers responsible for the symptom. It must not describe an inferred path as live-observed execution.

Generic static code review is explicitly outside the ControlsBench core. Required source access for interceptor installation does not make source review the product. Source-aware functionality is valuable only when a usable export or IDE connection exists and it closes the loop from a ControlsBench-observed behavior and injected ground truth to a likely implementation location. Do not spend first-proof time building a standalone PLC source-review feature.

Long term, vendor-specific installation tooling may automate library insertion and signal mapping through an IDE API, project transformation, or supported export/import workflow. Until then, installation may include manual project changes guided by ControlsBench. External hardware-in-the-loop interception of an untouched compiled controller would be a different future architecture and is not part of the current claim.

### Connector boundary and transport roadmap

- The execution coordinator operates only on logical signals and transport capabilities. It does not depend on OPC UA node identifiers or OPC UA-specific timing.
- OPC UA is the accepted first/demo connector because it is available, inspectable, and sufficient to prove the workstation workflow.
- OPC UA is not assumed to be the preferred high-performance production transport.
- A production connector may use EtherNet/IP cyclic I/O or another vendor/platform transport when it provides better update cadence, jitter, integration, or deployment fit.
- Connector replacement must not change generated worlds, run definitions, agent tools, evidence concepts, or coordinator policy.
- Every connector reports measured capabilities and behavior rather than claiming a universal timing guarantee.

The connector contract should expose, as supported by each implementation:

- discovery and versioned logical-signal mapping;
- connection and simulation-mode status;
- reads, subscriptions, sparse writes, and coordinated frame writes;
- readback or applied-revision acknowledgement;
- timestamps, quality, sequence information, and stale detection;
- measured update cadence, latency, and jitter;
- transport-specific diagnostics and capability flags.

### A generated run is not initially a replay

There is no captured production machine sequence to replay in the first product slice. Muse creates the situation that will be executed.

Use these terms:

- **World model:** the external machine and system behavior presented to the PLC.
- **Run definition:** Muse's generated initial conditions, entities, conditional stimuli, timing, fault strategy, observations, agent re-entry points, and stop conditions.
- **Run execution:** the workstation applying that definition against the executing PLC logic.
- **Run record:** the definition plus actual trace, interventions, parameter revisions, evidence, conclusions, model identity, and generated-code version.
- **Run variant:** a later run derived from a saved run record or definition.

Only a later execution of a captured run should be called a re-run or replay.

The product should support three related styles:

1. **Interactive probe:** set conditions, observe, and choose the next step methodically.
2. **Generated run:** Muse authors a reactive run definition that the workstation executes.
3. **Adaptive run:** Muse authors the initial run and modifies it in response to meaningful PLC observations.

The adaptive run is the flagship. A generated definition must not turn the product into a static test-script generator.

### Muse remains actively involved

- Muse should remain active throughout a run rather than authoring a complete script and returning only for exceptional events.
- Muse chooses nearly every meaningful external stimulus, experiment transition, fault, branch, and response to observed PLC behavior.
- The workstation continuously presents relevant events and evidence to the active agent and accepts new actions while the run is in progress.
- Generated code and the local runtime handle only timing-critical continuity, physical evolution, already-issued actions, and scan-rate signal production between model decisions.
- A run definition supplies the objective, initial conditions, available world, and starting strategy; it is not a fully predetermined sequence.
- This active-agent posture is selected because it is more impressive for the hackathon and offers more product upside than reducing Muse to an offline test generator.

### Per-action execution policies

ControlsBench supports all three policies; they are not mutually exclusive run modes:

1. **Hold:** freeze workstation world evolution and retain the last PLC input image while the PLC continues scanning.
2. **Continue:** allow the generated local world to evolve under its current behavior while Muse reasons.
3. **Decision lease:** authorize behavior until a condition, event, deadline, or unexpected observation returns control to Muse. The lease declares whether expiration or interruption holds or continues the world.

The normal default is a decision lease that holds on expiration, but Muse or the engineer may select another policy for each meaningful action. Events occurring while the model reasons are queued and summarized. Model actions carry the state revision on which they were based so delayed, stale actions can be rejected or reconsidered.

### Variation is a testing capability

- Runs do not need to be identical. Variation and surprise are useful when testing PLC logic against situations users may create in the field.
- Uncontrolled loss of provenance is not useful. ControlsBench records the generated implementation, initial state, seeds, distributions, parameter changes, stimuli, agent interventions, and actual signal trace.
- Exploration may be intentionally stochastic. When an interesting result appears, ControlsBench can create a controlled run variant or re-run for confirmation.
- Exact wall-clock reproduction is not required for every finding. The system must preserve enough evidence to explain what actually occurred.

### Model authority versus timed execution

- Muse may semantically control the simulated world: create behavior, select stimuli, inject faults, modify parameters or topology, and alter the run.
- Autoregressive model inference is not assumed to meet a PLC scan-time contract, even when the model is local.
- Muse can author or revise executable behavior; the local workstation runtime executes that behavior at the required cadence.
- Methodical interactions may wait for the model between steps. Faster operating behavior is executed from generated code or a workstation-owned schedule and remains responsive to PLC outputs.

### First-proof world fidelity

- The first conveyor proof uses continuous, spatially coherent physical state rather than reducing the machine to logical events such as `carton reached PE1`.
- Muse should envision a plausible real machine from the specification and signal/device information: geometry, equipment placement, material flow, sensor zones, actuator locations, and physical relationships.
- The minimum physical model includes carton identity/size/position/velocity, conveyor geometry and speed, acceleration or startup delay where relevant, divert location and motion, sensor detection geometry, runout, and raw encoder/device behavior.
- World behavior advances continuously against connected wall-clock time and derives raw PLC inputs from physical state through generated device/transducer models.
- Realism includes transport delay, actuator travel, obstruction, overlapping sensor zones, quantization, noise, missed pulses, bounce, drift, and mechanically possible/impossible states where applicable.
- The first proof does not require a general 3D rigid-body, CAD, or intensive graphics engine. A continuous one-dimensional material-flow model may use a lightweight schematic view when it faithfully represents the machine behavior being tested.
- Muse's inferred dimensions, device characteristics, and layout assumptions remain visible and versioned. The engineer may correct material misunderstandings through natural language without being asked to author the simulation.
- Visualization is diagnostic support, not a generated product surface or evidence substitute. The first view need only make cartons, sensors, diverts, runout, active faults, raw states, and current actions understandable.

### Lightweight visualization scope

- Use a small reusable schematic renderer, such as SVG or Canvas, driven by the live world-state snapshot.
- Do not ask Muse to generate custom renderer code for the first proof.
- Do not build a general scene editor, 3D environment, physics renderer, animation framework, or asset pipeline.
- Prioritize the campaign plan, live activity, signal trace, evidence, and adaptive-agent behavior over visual polish.
- The visualization may expose simple diagnostic interaction such as selecting a sensor or carton to see its physical truth, raw signal value, last transition, and active fault.
- HMI screen capture remains a separate observation source and does not require recreating the HMI inside the world view.

### Time semantics with an executing PLC

- During a connected bench run, PLC execution and wall-clock time are authoritative.
- ControlsBench does not claim that it can accelerate the actual PLC scan, PLC timers, or application behavior while preserving a valid live-PLC result.
- The workstation world advances against measured wall-clock time and observed PLC events.
- Hold mode may freeze workstation world evolution and retain input values, but the PLC continues scanning and its timers continue advancing.
- ControlsBench may slow or delay external stimuli intentionally; that is a test condition, not paused PLC time.
- Accelerated time is permitted for disconnected world-model validation, surrogate execution, generated-run exploration, and training rollouts. Evidence from an accelerated surrogate must never be presented as live-PLC evidence.
- PLC cycle counters and transport timestamps may supplement wall-clock evidence but do not create a virtual PLC clock.

### Connector loss while simulation is active

If the workstation or connector disappears:

- the PLC holds the last simulated input state;
- simulation mode remains active;
- the PLC does not fall back to hardware inputs;
- simulated inputs are not forced to configured normal values;
- PLC logic and timers may continue from the held condition;
- a lightweight `BenchLinkStale` or equivalent diagnostic may be exposed;
- this diagnostic is not a machine fault or HMI alarm;
- the workstation records the disconnect and treats the unobserved interval as an evidence gap after reconnection.

A heartbeat may be used to make the condition visible, but the bench does not require production-style fault recovery.

### Learning direction

- Explicit plant/world parameters may adapt during a run.
- Run trajectories should be captured in a training-ready form from the beginning.
- Muse Glimmer adapter training is a real product path: SFT or QLoRA for domain/tool behavior and GRPO when ControlsBench can compute programmatic campaign rewards.
- Candidate adapters should be evaluated against held-out seeded benches and promoted or rolled back with provenance.
- Broad bench authority and weight adaptation are hackathon stretch items after the first functioning environment supplies executable runs and objective rewards.

## Generated Runtime Contract and Provisional Recommendations

### Generated artifact: code-primary, contract-wrapped hybrid

Status: **Settled.**

Recommended shape:

- a machine-readable manifest declares signals, parameters, state, assumptions, entities, capabilities, and evidence obligations;
- generated TypeScript is the authoritative behavior implementation;
- the generated module interacts with the bench through an instrumented `WorldContext`;
- simulation time, seeded randomness, scheduling, signal effects, entity changes, snapshots, and evidence flow through that context;
- module state is serializable so runs can be saved, branched, and potentially hot-reloaded;
- generated tests and invariants accompany the module.

This is preferred over an IR-only runtime because Muse already understands general-purpose code and should be free to invent behavior we did not anticipate. Its main cost is weaker static understanding and more difficult state migration than a purely declarative IR.

The manifest is the wiring diagram and declared contract, not a duplicate behavior language. Generated TypeScript is the single source of truth for world behavior. It may implement unfamiliar devices, continuous dynamics, probabilistic faults, and new experiment mechanisms, while every PLC-facing effect passes through the instrumented workstation context. Compile, test, execute, inspect, and self-repair are part of the expected generation loop.

The intended posture is a workshop for Muse with labels only where the platform needs a dependable connection. The manifest must not grow into a restrictive user-authored behavior language. Generated code is an implementation detail that Muse owns and repairs; controls engineers are not expected to maintain it.

### Engineer experience: campaign, not generated-code project

Status: **Settled direction; exact category labels remain refinable.**

- The normal controls-engineer experience does not present generated TypeScript as a new coding task.
- The primary surface is a concise campaign plan organized into expandable engineering categories.
- Each category shows planned checks, purpose, current status, and resulting evidence without requiring the engineer to inspect implementation code.
- Initial category concepts include:
  - I/O and integration checks;
  - startup, reset, and mode checks;
  - functional/sequence checks;
  - runtime and timing checks;
  - alarm, fault, and recovery checks;
  - normal-operation checks;
  - boundary, contradictory-input, and stress checks;
  - adaptive investigations added from observed behavior.
- An expanded planned check should explain what Muse intends to manipulate, what it will observe, and what would make the result pass, fail, or remain inconclusive.
- Engineers adjust scope through category/check selection and natural-language direction rather than editing generated code.
- Generated implementation may exist in a developer/support inspection view, but it is not part of the ordinary campaign workflow and the UI must not imply that the engineer is responsible for repairing it.

### Campaign authorization and autonomy

- The engineer reviews the campaign summary and authorizes the campaign once by selecting **Start Campaign**.
- That authorization allows Muse to execute all selected categories and checks, choose hold/continue/lease policies, inject simulated faults, branch from observations, and add or execute adaptive investigations without requesting per-check approval.
- Newly created investigations appear in the live campaign plan with their objective and status, but they do not block on approval.
- The engineer may steer Muse through natural language and retains immediate **Pause** and **Stop** controls.
- Category/check selection before start defines scope but is not a sequence of approval gates.
- Physical-output suppression and other bench installation settings remain engineer configuration rather than something silently changed by campaign reasoning.

This single-authorization model is intentional for the sequestered bench and prevents ControlsBench from turning autonomous testing into a repetitive supervision task.

### Pause, stop, reset, and exit

- **Pause:** freeze workstation world evolution and hold the current raw input image. The PLC continues scanning. The campaign may resume.
- **Stop Campaign:** stop agent/campaign activity, finalize the run record, and hold the final raw input image so the engineer can inspect the PLC and HMI state.
- **Reset Simulation:** remain in simulation mode but replace the complete DI/AI image with false/zero and begin a new observable baseline state.
- **Exit Simulation:** deliberately return the interceptor to hardware passthrough. Exiting simulation is separate from stopping a campaign.

### Live activity and not-hung indication

- The workspace continuously shows concise updating status text comparable to a coding agent's activity commentary.
- Status is grounded in coordinator, connector, model-request, tool, and PLC events rather than a decorative spinner or invented reassurance.
- The primary status includes the current campaign category/check, current phase, elapsed time, last meaningful activity, and what condition or response is being awaited.
- Representative states include: preparing world, compiling generated behavior, repairing generation error, reasoning about next action, applying stimulus, executing decision lease, waiting for PLC condition, observing outcome, investigating discrepancy, writing evidence, paused, stopped, connector stale, and failed.
- During a long model request, show that Muse is reasoning, the elapsed request time, and any available streamed user-facing progress summary. Do not require disclosure of private reasoning traces.
- During a condition wait, show the actual condition and elapsed wait, for example: `Waiting for Motor_RunCmd = true (12.4 s); PLC and connector active`.
- Separate health indicators track the agent/model request, execution coordinator, connector, and PLC/interceptor heartbeat so the UI can distinguish slow reasoning from a stalled runtime or lost connection.
- If expected activity or heartbeat exceeds its threshold, change the status from active to delayed/stalled and expose appropriate retry, pause, stop, or inspect actions.
- Meaningful statuses and transitions are appended to the run record so the engineer can reconstruct what ControlsBench was doing when an issue occurred.

### Workstation signal images and light acknowledgement

Status: **Provisional details within a settled workstation-owned architecture.**

Recommended workstation structures:

- typed raw `worldToPlc` and `plcToWorld` signal images at the selected hardware/device cut point;
- versioned mapping from logical signals to OPC UA nodes;
- sparse change writes for methodical operation;
- logical frame/revision metadata for coordinated changes;
- actual write, readback, subscription, and observation timestamps.

Recommended optional PLC coordination values:

- `SimulationRequest`;
- `SimulationActive`;
- `WorkstationHeartbeat`;
- `BenchLinkStale`;
- `InputRevision`;
- `AppliedInputRevision`;
- `PlcCycleCounter`.

No PLC-resident event array is assumed.

### Workstation execution coordinator

Status: **Provisional responsibility split; awaiting explicit acceptance.**

Recommended layers:

- **Muse agent:** chooses intent, experiment action, execution policy, stop/interrupt conditions, and follow-up reasoning.
- **Generated world:** translates intent and PLC outputs into simulated entities, physical/logical evolution, and desired logical signal effects.
- **Execution coordinator:** owns hold/continue/lease state, state revisions, deadlines, event queuing, signal images, connector acknowledgements, and recovery from delayed model decisions.
- **Connector:** maps logical signals to vendor nodes and transports reads/writes with measured timestamps and quality.
- **Evidence engine:** independently records what was requested, what was transported, what the PLC exposed, and what conclusion is justified.

Muse may request a direct methodical signal change, but it still passes through the coordinator. This preserves timing and provenance without restricting the agent to a canned test list. The model never needs OPC UA node IDs or transport-specific behavior.

## Open Decisions

Resolve these before implementing the general runtime unless an item is explicitly deferred:

1. **Coordinator responsibility:** accept or revise the proposed Muse/world/coordinator/connector/evidence separation.
2. **Raw signal details:** supported primitive types, arrays/structures, quality, encoding, sample/update behavior, normal values, ownership, and stale semantics.
3. **Write coordination:** whether the first CODESYS proof requires `InputRevision`/`AppliedInputRevision` or begins with direct sparse OPC UA writes and measured behavior.
4. **Hot modification:** what Muse may change during a run and how state is migrated when generated code changes.
5. **Generated-code failure:** compile errors, crashes, hangs, contradictory effects, impossible values, recovery, and agent self-repair.
6. **Truth separation:** exact structures for injected ground truth, observed raw I/O, optional internal observations, static source facts, inferred diagnosis, and final verdict.
7. **Campaign completion:** who defines done, which coverage measures matter, and whether Muse may extend the objective after discovering new behavior.
8. **First-proof boundary:** the smallest generated world and adaptive run that proves the platform rather than a conveyor-specific script.

## Implementation Hold

Do not begin the general world runtime merely from the earlier prose artifact. Finish the high-impact decisions above, then create an accepted execution contract and success criteria. Small read-only investigations and model experiments used to inform these decisions remain appropriate.
