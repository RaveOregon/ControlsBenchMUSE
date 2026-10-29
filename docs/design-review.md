# ControlsBench: reuse audit and proposed foundation

Status: working design record. The conveyor demo defaults in `docs/conveyor-machine-spec.md` were accepted on 2026-10-29; no live Muse, OPC UA, or CODESYS validation is claimed by this document.

This document carries forward the handoff and the subsequent discussion. Confirmed requirements, findings from source inspection, and new proposals are distinguished below. It supersedes the architectural assumptions in the initial scaffold. The Machine Agent findings were corrected after inspecting the current GitHub `main` branch; the local checkout is substantially older.

## Confirmed direction

ControlsBench is a Windows engineering workstation whose first capability is autonomous bench testing of actual executing PLC applications. The engineer supplies a specification, signal information, and any existing tests or other useful context. Muse constructs and operates the simulated external environment, devises tests, observes the PLC response, investigates failures, and produces an evidence-backed report. The engineer can follow along, accept findings, and request additional testing.

Two separate connector families form the foundation:

- **PLC platform integration:** vendor-specific interception and instrumentation, implementing a shared logical contract. Startup defaults to hardware passthrough; entering simulation is deliberate. Implementation may differ between PLC vendors.
- **Workstation communication:** OPC UA initially, with other transports later. Higher-level engineering functions use logical signals rather than vendor node paths.

The simulated environment includes equipment below the controller and missing systems above it, such as a WCS or BACnet peers. HMI observation and operation provide another interaction surface. Future PID and signal-processing capabilities share the instrumentation foundation; neither is part of this hackathon build.

For the first submission:

- CODESYS Control Win is the selected target; Raspberry Pi/touchscreen is a stretch goal. Unitronics is excluded.
- The demo machine is a single main conveyor with two sequential diverts and a straight runout/jackpot. The exact fault campaign remains open; contradictory input combinations matter alongside conventional equipment faults. See `docs/conveyor-machine-spec.md` for the proposed I/O and behavior contract.
- A new public repository will focus on the hackathon. Machine Agent and HMaI are user-owned and available for reuse. The older local ControlsBench project is unrelated and excluded.
- Indie is the likely track. No particular repository license has been selected.
- The agent may control simulated bench conditions autonomously. It does not modify the PLC application during validation.
- Signal streams may be executed using generated behavior, timed sequences, or arrays where appropriate. Feedback from PLC outputs remains essential for interactive machine behavior.
- Exact repetition of every campaign is not required. Evidence about what actually occurred is required.
- A clear architecture and readable repository are sufficient to explain the implementation; special demonstrations aimed at proving honesty are unnecessary.
- The interface should be a clean engineering workspace. HMI vision remains valuable and cuttable. Hosted delivery is optional; Windows/local operation is the immediate target.

## What has actually been found

The audit inspected local source and the current GitHub `main` source in a temporary clone. It did not run the applications or test a live CODESYS connection. GitHub shows Machine Agent's `main` at `5a11581` (August 30, 2026), while the local `IPCagent` checkout is at `0666195`, based on the initial demo and one local documentation commit. Its `origin/main` reference is stale. Terminal Git's default sandbox could not reach GitHub, but the authorized read-only Git connection succeeded outside that restriction. No source project was modified.

| Local project | Verified Git remote | Inspected revision | Scope established |
|---|---|---|---|
| Machine Agent (`IPCagent` locally) | `https://github.com/RaveOregon/industrialintelligence.git` | GitHub `main` `5a11581`; local `0666195` | Full Node-based mixer learning-agent demo: direct OPC UA subscriptions and bounded write/readback, local edge/outbox, compatibility OPC UA simulator, cloud investigation/approval/outcome service, portal, and tests. It is not an Electron desktop application. |
| hmiplatform | `https://github.com/RaveOregon/HMaI.git` | `3b7505f` | Electron/React/TypeScript HMI engineering workspace, tag intake, project persistence, model/tool-call plumbing, and local process simulation. |

HMaI has an existing untracked portfolio document. It was left untouched. Neither source project was modified.

The signed-in GitHub browser and terminal Git established access to the private Machine Agent repository. No authenticated GitHub connector tools were exposed to this task; the plugin directory reports that the GitHub connector is available but not installed. The browser account lists no separate repository literally named `Machine Agent`; the `industrialintelligence` README identifies itself as **Machine Agent — Industrial Learning Demo**. If another Electron product exists, it remains unidentified, but it is no longer needed to locate the Machine Agent work relevant to OPC UA.

CODESYS MCP tools are exposed, but the read-only active-project query could not reach the IDE bridge. That does not establish anything about the controller runtime or OPC UA endpoint being available. Live integration remains unverified.

## Reuse map

### OPC UA: adapt Machine Agent's direct adapter first

Evidence: current GitHub `src/edge/opcua-machine-adapter.js`, `src/opcua/tag-map.js`, and `test/opcua-machine-adapter.integration.test.js`; older local `server.js` and `opcua-browse.js` only as secondary references.

The current direct adapter already performs a batched initial read and uses `node-opcua` monitored-item subscriptions, with configurable sampling (default 100 ms) and publishing (default 250 ms) intervals. It tracks OPC UA status per tag, detects missing tags, emits value/status events, writes typed controls from a fixed map, and reads written values back. A separate action executor narrows the agent's authority. An integration test starts an actual OPC UA compatibility server and proves subscription, completed-cycle aggregation, and write/readback **against that server**. This is the strongest existing transport foundation, though it does not prove CODESYS Control Win or scan-synchronous exchange.

Changes required for ControlsBench:

- Replace the fixed CODESYS namespace and mixer tag list with a mapping between logical signals and connection-specific addresses.
- Retain the batched initial read and monitored subscriptions; measure whether they meet the conveyor test's required event timing. The existing intervals are requests, not a PLC scan guarantee.
- Preserve per-value quality and source/server timestamps in addition to host receipt time. The current adapter stores status and value but discards the OPC UA timestamps from `DataValue`.
- Return write acknowledgements and account for stale observations and connection interruptions.
- Keep the continuous exchange loop separate from UI refresh and model inference.
- Replace Machine Agent's fixed `Mixer01`/`Mixer02`, `GVL_AgentVisible`, `GVL_Operator`, and CODESYS node prefix assumptions with logical signal maps and capabilities. Its `CONTROL_TYPES` contains demo fault and hidden-health controls, so copying the map without a new bench-specific authority boundary would be incorrect.

The legacy browser HMI requests state every 500 ms, but the newer direct Machine Agent adapter is independent of that HMI. Neither its 100/250 ms requested intervals nor the HMI polling prove scan-rate or scan-synchronous I/O transport.

The mixer Structured Text also contains simulated level, temperature, and device feedback within the PLC program. It demonstrates CODESYS integration, but does not provide the intended separation between a real controller under test and an AI-created external world.

### Machine Agent workflow: reuse evidence patterns, not its objective

Evidence: current GitHub `src/edge/cycle-aggregator.js`, `baseline-detector.js`, `action-executor.js`, `src/storage`, `src/cloud`, and `docs/architecture.md`.

Machine Agent is already an agent-to-industrial-system vertical slice. Its local edge process normalizes telemetry, aggregates cycles, detects drift against a frozen baseline, queues evidence offline, and can execute a narrowly approved setpoint action. Cloud services support an evidence-grounded investigation, a human decision, and post-write outcome classification. These demonstrate useful separation between machine communications, deterministic measurement, AI reasoning, and human-readable evidence.

ControlsBench has a different job: author a process environment from a spec, inject simulated **inputs** into an executing PLC, observe **outputs**, adapt a test campaign, and report requirement coverage. Machine Agent's human approval-before-write policy is appropriate to its tuning demo but must not be imported as a blanket limit on an isolated bench. Its cycle/drift logic and mixer-specific action vocabulary are not the ControlsBench test engine. Reuse contracts, storage/outbox and causality ideas selectively; build the simulation/test orchestration around the new requirements.

### Desktop and project experience: extract HMaI patterns

Evidence: `packages/engineering-workspace/src/main/main.ts`, `src/preload/preload.ts`, and `src/main/project-session.ts`.

Reusable foundations include the Electron shell, typed IPC, project folders, saved specification/tag inputs, Word text extraction, and project/session restoration. Adapt these selectively so ControlsBench does not inherit the entire HMI editor and its dependencies.

### Signal mapping and evidence references: adapt HMaI

Evidence: `packages/tag-mapping/src/parser.ts`, `reconciler.ts`, and `packages/hmi-project-model/src/provenance.ts`.

The tag parser records original names and source line references, validates basic types/access, and supports reconciliation. It currently recognizes BOOL, INT, REAL, and STRING; richer PLC types will need explicit treatment. Its source-reference pattern can connect a finding to a requirement, imported signal, assumption, or agent-created artifact.

The validation package contains HMI design checks and report structures. Those structures may be useful, but its existing rules do not validate temporal PLC behavior.

### Agent plumbing: adapt, relocate the live loop

Evidence: `packages/engineering-workspace/src/main/openai-copilot.ts`.

HMaI has request/result conversion for a Responses-style model and tool-call transcript. Its existing provider and instructions are specific to HMI editing and OpenAI. They require a new Meta provider and ControlsBench tools.

The HMaI renderer owns the tool loop. Proposed ControlsBench placement is a local runtime process so UI rendering and long model calls do not govern I/O continuity.

### Simulation: reuse small primitives, build the new behavior contract

Evidence: `packages/simulation-engine/src/types.ts`, `engine.ts`, and `models.ts`.

HMaI includes useful examples of ramps, delayed valve feedback, and tank/process calculations. Its engine has fixed tank/pump/valve categories and also decides pump permissives, commands, and system state. Importing it wholesale would mix control decisions into the simulated plant.

Muse therefore needs a new, general execution interface. Equipment-specific behavior must be supplied by Muse or selected components through that interface, rather than embedded as the only supported machine in the engine.

### HMI vision: new work

The inspected sources contain an HTML HMI and browser-based visual regression tests. The current Machine Agent README explicitly calls its HMI a separate demo/control surface outside the agent's data path. No VNC integration or visual agent operating an external HMI was found. HMaI's `gateway-server` and `spec-analyzer` package entry points are placeholders; the implemented specification workflow lives in its desktop application.

### Initial ControlsBench scaffold: experimental only

The scaffold created at the beginning of this conversation is unapproved and untested. Its simulation engine has conveyor-specific behavior; its investigator has a fixed sequence; the generated experiment list does not govern that sequence. It does not demonstrate autonomous creation of the machine behavior. The advertised dashboard and automated tests are absent from the current files.

No code from it should become the foundation by default. It can remain available as a disposable reference until the approved design replaces it.

## Proposed architecture

The following are recommendations, not previously agreed implementation decisions.

### A general runtime with Muse-authored reactive behavior

Use a hybrid model package: readable metadata and assumptions plus executable behavior expressed through a small runtime interface. Muse can use timers, conditions, continuous state updates, schedules, noise, and output-to-input relationships. Tested components can help without becoming the only machines the system can express.

The package describes:

1. State: positions, inventories, actuator travel, queues, timers, and supervisory conversations as needed.
2. Observations: the latest actual PLC output values, quality, and timing information.
3. Evolution: how elapsed time, observed outputs, and injected conditions change the world.
4. Emissions: simulated inputs and external messages for the next exchange.
5. Experiments: the conditions Muse can change and the observations it wants to collect.
6. Expectations: requirement-derived checks, their timing, assumptions, and supporting observations.

The execution representation remains a prototype choice. A bounded generated step function and a data-driven expression/state model are both candidates. Test these against the same small specification before committing to a large domain-specific language. Generated executable behavior must run through an explicitly restricted interface with execution limits; a separate process alone is not a security sandbox.

An illustrative runtime interaction is: receive PLC observations, advance the world, calculate sensor/feedback signals, submit them through the transport, retain results, and repeat. Muse reviews observations and changes the active environment or next experiment while this exchange continues.

For a conveyor, actual motor output drives package movement and actual diverter output drives actuator response. Those states produce photoeyes and feedback. A timed array can express sensor bounce; a persistent state model handles the machine's response to a stop. Both mechanisms can coexist.

### Responsibilities

| Component | Owns |
|---|---|
| Workspace UI | Specification inputs, connection/setup view, agent conversation, machine overview, progress, evidence, reports |
| Muse agent | Interpretation, simulation behavior creation, experiment choices, investigation, explanation |
| Local execution host | Continuing the model between agent calls, scheduling stimuli, applying model changes at explicit boundaries, retaining observations |
| Logical signal contract | Stable identities, types, observation/stimulus roles, value quality, timestamps, and capabilities |
| Transport adapter | Address mapping, connection/session, reads/subscriptions, writes, status, and measured transport performance |
| PLC platform integration | Hardware/simulation input selection, signal exposure, observation of actual application outputs |
| HMI connector | Screenshots and operator interactions attached to the same campaign |

### Timing and instrument types

Record PLC scan timing, requested transport cadence, measured update interval, and observation freshness separately. Aim for the needed cadence and use supported scan-coupled or buffered options where appropriate. Do not label a workstation timer or OPC UA request interval as a guaranteed PLC scan exchange.

The first contract should support digital and numeric signals and leave room for structured supervisory data. Neither vendor identity nor transport addresses belong in the process model. PID tuning later may need stronger sampling capabilities; that can extend the transport capability contract.

### Findings and reporting

Store the specification, assumptions, generated behavior, experiment actions, observations, and decisions needed to explain a result. Use requirement-linked pass/fail checks when the requirement is explicit. When the observation could reflect a modeling assumption or ambiguous requirement, record uncertainty and let Muse investigate further.

Observed trace playback and rerunning a live experiment are different operations. Preserve useful traces without promising identical live reruns. Exact deterministic replay is deferred as requested.

### Implementation recommendation

Electron with a TypeScript UI and local Node-based services is a reasonable starting proposal given the inspected code. Keep model orchestration, process execution, and connector exchange outside the renderer. No Docker requirement is proposed. Meta calls may use the synthetic project material for this prototype; credentials remain application configuration rather than campaign artifacts.

## First engineering milestones after design agreement

1. Agree on one short conveyor specification and signal list. Build the controller and simulated environment as separate artifacts. The demo defect can be chosen afterward.
2. Adapt the current Machine Agent OPC UA adapter to a general signal map, preserving quality and timestamps and separating bench I/O authority from its mixer setpoint policy.
3. Implement the smallest general behavior-execution contract. Ask Muse to create a reactive world from the specification and check that actual output changes influence its inputs.
4. Connect that world through OPC UA to the CODESYS interceptor and real application. Measure the exchange timing and report limitations.
5. Give Muse experiment tools and observations; verify that it chooses and runs follow-up work from the results. Retain evidence and report what occurred.
6. Add HMI screenshot/input operation through WebVisu or VNC if the core campaign is solid. Add the Raspberry Pi only if time permits.

A Meta API key and a reachable CODESYS IDE/runtime are required for later live validation; neither prevents review of this proposal. The remaining design decision that most affects implementation is the conveyor's signal/behavior contract, not another repository URL.
