# First-Proof Contract

Status: **Complete; CP-0 through CP-12 (Gates A-D) implemented and passed against the first Wonder-generated package on 2026-10-29. The real connector spike is next.**

Updated 2026-10-29. This contract defines the smallest generic chassis and staged validation needed to determine whether Muse can generate, repair, and actively operate the complete accepted conveyor world before ControlsBench invests in PLC connectors, product UI, or a broader platform.

## 1. Decision This Proof Must Enable

The proof must answer:

> Can Muse Wonder generate and self-repair a complete, causal, continuous, raw-I/O conveyor world as TypeScript against a small generic ControlsBench contract, and can that same generated world support active experimentation, faults, evidence, and hot reload without human-written conveyor behavior?

This is a falsifiable engineering gate, not a polished demo.

If the answer is no, stop and revise the prompt, contract, model choice, or code-primary architecture before building the PLC connector or workspace.

## 2. Hypotheses Under Test

### H1 — Executable generation

Wonder can transform the full accepted specification and raw I/O contract into a complete manifest, TypeScript world module, generated tests, assumptions, and evidence declarations.

### H2 — Causal world behavior

The generated world responds to controlled PLC outputs. It does not advance cartons, actuators, or feedback merely because a scenario timer says the expected result should occur.

### H3 — Physical-to-raw modeling

The world maintains physical truth such as position and velocity, then produces the raw values the PLC would receive: booleans, encoder counts/pulses, raw feedback, limit states, and device status.

### H4 — General chassis sufficiency

The generic context API is expressive enough for the full conveyor without adding conveyor-specific behavior to the runtime.

### H5 — Self-repair

Wonder can use compiler, contract-test, invariant, and runtime diagnostics to repair its generated package without a human writing or modifying conveyor behavior.

### H6 — Active campaign control

Muse can remain involved, choose meaningful stimuli and execution policies, add follow-up investigations, and operate within visible time/token/cost budgets.

### H7 — Evidence and change provenance

Every PLC-facing effect, fault, world revision, hot reload, and conclusion is attributable and preserved without treating world expectation as PLC evidence.

## 3. What Muse Generates

Wonder receives the complete accepted conveyor specification in `docs/conveyor-machine-spec.md`, the generated-world contract, and the contract-test descriptions. It generates the full machine, not a toy subsystem.

The generated package contains at least:

```text
generated-world/
  world.manifest.json
  world.ts
  world.test.ts
  assumptions.md
  generation.json
```

### `world.manifest.json`

The labeled wiring contract, containing:

- package and state-schema versions;
- raw PLC-to-world outputs and world-to-PLC inputs;
- raw types, ownership, normal/zero representation, and device association;
- physical entities and externally inspectable state;
- parameters and declared assumptions;
- supported fault capabilities;
- evidence emitted by the world;
- snapshot/migration capabilities;
- generated package hashes/provenance.

The manifest is not a second behavior language. TypeScript remains the behavioral source of truth.

### `world.ts`

The complete generated conveyor behavior, including:

- belt/drive physical state;
- continuous carton position and velocity;
- entry, approach, and exit sensor geometry;
- both diverts and straight runout;
- raw drive and actuator feedback;
- raw encoder/count behavior when the declared package uses it;
- downstream readiness and capacity behavior;
- fault mechanisms required by the accepted specification;
- snapshot, restore, migration, and cleanup behavior;
- evidence and activity events.

### `world.test.ts`

Muse-generated tests for its own assumptions, physical invariants, device behavior, fault cleanup, and snapshot/migration behavior. Platform-owned contract tests remain independent.

### `assumptions.md`

Missing dimensions, timing, device, and physical details that Wonder inferred. Each assumption is identified as specified, inferred, configurable, or unresolved.

### `generation.json`

Model/provider/mode, response lineage, input hashes, timestamps, token/cost usage, repair attempts, compiler/test outcomes, and final package hashes.

## 4. What ControlsBench Provides

ControlsBench provides only a general-purpose chassis. It must not contain conveyor routing, sensor placement, divert timing, carton logic, or expected conveyor sequences.

The chassis consists of:

1. a generated-world module interface;
2. an instrumented `WorldContext`;
3. a scheduler/clock abstraction;
4. serializable state and hot-reload support;
5. raw signal state and event capture;
6. a surrogate PLC-output driver;
7. contract tests and checkpoint fixtures;
8. a CLI activity/status surface for this proof.

No product UI, OPC UA, CODESYS, Ethernet/IP, HMI driver, video analysis, or intensive visualization belongs in this gate.

## 5. Draft Generated-World Interface

Exact TypeScript names may change during review, but the responsibility boundary must remain.

```ts
export interface GeneratedWorldModule {
  readonly manifest: WorldManifest;

  initialize(ctx: WorldContext, request: InitializeRequest): Promise<void>;
  onPlcFrame(ctx: WorldContext, frame: PlcOutputFrame): Promise<void>;
  tick(ctx: WorldContext, tick: WorldTick): Promise<void>;

  snapshot(ctx: WorldContext): Promise<WorldSnapshot>;
  migrate(
    ctx: WorldContext,
    previous: WorldSnapshot,
    request: MigrationRequest
  ): Promise<WorldSnapshot>;

  dispose(ctx: WorldContext, reason: DisposeReason): Promise<void>;
}
```

The connected product later uses wall-clock time. The proof chassis may also provide deterministic virtual time for fast contract testing, but virtual-time results are labeled surrogate evidence.

## 6. Draft `WorldContext` Responsibilities

Generated code may compute and structure its internal world freely. All PLC-facing and evidence-bearing effects pass through the context.

```ts
export interface WorldContext {
  time: WorldTime;
  random: SeededRandom;

  plc: {
    readRawOutput(signalId: string): RawValue;
    writeRawInput(effect: RawInputEffect): void;
    currentOutputFrame(): PlcOutputFrame;
    currentInputState(): RawSignalState;
  };

  schedule: {
    at(request: ScheduledAction): string;
    cancel(actionId: string): void;
  };

  entities: {
    publish(snapshot: EntitySnapshot): void;
    remove(entityId: string, reason: string): void;
  };

  evidence: {
    append(event: EvidenceEvent): void;
  };

  status: {
    report(update: ActivityUpdate): void;
  };
}
```

The chassis supplies seeded randomness, time, scheduling, raw signal state, activity, evidence, and snapshots. It does not supply conveyor behavior primitives such as `moveCarton`, `triggerPhotoeye`, or `extendDivert`.

## 7. Raw Signal Rules

- PLC-facing values use the raw hardware/device representation, not convenient engineering values.
- Physical truth remains separate from raw PLC-visible state.
- Enabling simulation resolves the complete workstation input state to false/zero before world preparation.
- Generated world writes are attributable effects, not direct mutation of transport/vendor variables.
- The proof surrogate records logical workstation frames and acknowledgement, but does not claim real OPC UA or scan timing.
- The future connector streams changed/current raw values. The proof does not send a runtime or playback array to a PLC.
- A PLC-resident pattern player remains deferred until connector measurements justify it.

## 8. Surrogate PLC-Output Driver

The surrogate is deliberately small. It does not reproduce the CODESYS program or decide whether conveyor requirements pass.

It can only:

- publish controlled raw PLC output frames;
- acknowledge workstation input frames;
- advance or expose a surrogate cycle counter;
- record all commands, raw input responses, timestamps, and sequence IDs.

Example controlled outputs include motor command, divert commands, and reset/mode commands that the real PLC would later produce. These outputs are fixtures used to test the generated world's causality.

## 9. Independent Contract Rules

Platform-owned tests verify that:

- the manifest is valid and all referenced raw signals exist;
- generated code compiles without human behavior edits;
- PLC-facing reads/writes use `WorldContext`;
- all raw effects carry time, cause, world version, and state revision;
- physical truth is not substituted for a PLC observation;
- seeded random choices and resolved fault parameters are recorded;
- world state serializes and restores;
- a candidate hot reload can migrate or explicitly declare a branch/reset;
- failed activation restores the prior module and snapshot;
- fault cleanup restores declared effects;
- activity and heartbeat status remain visible;
- generated tests cannot replace platform-owned contract tests;
- model calls obey request, repair, campaign, session, timeout, and failure budgets.

### Repair classification guardrail

Before any generated behavior is changed in response to a failed checkpoint, the failure must be classified as one of:

1. a violation of an explicit accepted requirement or platform contract;
2. a generated implementation defect against the world's own declared assumption;
3. an ambiguous or missing physical/process assumption requiring engineer confirmation; or
4. a defective or over-specific independent test harness/oracle.

Compiler errors and structural contract violations may enter automatic repair immediately. A physical-behavior repair may proceed automatically only when the expected behavior is already explicit in the accepted specification or declared world contract. If the expected physics or policy is unspecified, ControlsBench preserves the candidate and asks the engineer instead of silently rewriting behavior. Test assumptions are not product requirements. Every proposed behavior repair remains versioned and reversible until the independent checkpoint passes.

## 10. Checkpoint Matrix

Wonder generates the full world once. The checkpoints activate and verify progressively larger causal slices of that same package.

### CP-0 — Package generation and repair

**Exercise:** Give Wonder the full specification and contract. Compile and run platform/generation tests. Feed diagnostics back automatically.

**Pass:** Final package compiles and passes contract tests without human-written conveyor behavior and within the configured generation/repair budgets.

**Stop:** Human behavior edits are required, repair budget is exhausted, or the contract cannot express the generated world.

### CP-1 — Zero-image startup

**Exercise:** Initialize the complete world-to-PLC image to false/zero and begin trace capture before world readiness.

**Pass:** Generated world starts coherently, declares assumptions/state, produces no unexplained raw effects, and exposes startup activity/evidence.

### CP-2 — Drive causality

**Exercise:** Surrogate holds motor command false, then true, then false.

**Pass:** Belt motion and drive feedback are consequences of observed motor command and generated device dynamics. Removing command initiates the declared stopping/deceleration behavior and ultimately halts motion; feedback and raw motion remain physically consistent, and no internal scenario timer starts the belt independently.

### CP-3 — Encoder/raw numeric behavior

**Exercise:** Run the belt for controlled durations and speed parameters.

**Pass:** Raw count/pulse behavior derives from continuous physical motion and declared device resolution; counts may progress during declared physical coast but stop once motion settles; wrap/quantization behavior is explicit.

### CP-4 — Carton geometry and sensors

**Exercise:** Introduce one carton while the belt is running.

**Pass:** Carton position evolves continuously; photoeye states derive from sensor zones and carton geometry; a stop may decelerate/coast according to declared physics, after which carton position and sensor occupancy remain fixed.

### CP-5 — Divert A

**Exercise:** Command Divert A during a reachable carton window, then omit/delay command.

**Pass:** Actuator motion and raw limits derive from command and travel; carton route depends on actual physical state at the interaction time.

### CP-6 — Divert B and runout

**Exercise:** Exercise B and an unassigned carton.

**Pass:** Geometry and timing allow the appropriate paths; an unassigned carton runs out; the world does not hard-code a successful route from the requested destination.

### CP-7 — Known faults

**Exercise:** Run at least sensor bounce/stuck, missing drive feedback, and failed/delayed divert behavior using the core/spec fault templates.

**Pass:** Committed fault truth changes the physical/device/raw behavior, cleanup works, and requested injection is distinguished from applied effect and PLC observation.

### CP-8 — Blind diagnosis

**Exercise:** A fresh filtered Muse context receives one hidden committed fault and only permitted observations.

**Pass:** Diagnosis is sealed before reveal, evidence citations are valid, and scoring distinguishes correct, incorrect, and insufficient-evidence outcomes.

**Result:** Passed as `insufficient_evidence`. Wonder localized `sensor.entry` and led with a stuck-high mechanism, cited valid observations, and withheld an exact taxonomy because the trace could not exclude a physically held object. The sealed response preceded truth reveal.

### CP-9 — Active adaptive campaign

**Exercise:** Muse receives the result of an unexpected or ambiguous behavior and chooses a follow-up using hold, continue, or a decision lease.

**Pass:** At least one follow-up is not pre-scripted, executes through the same world, and materially reduces uncertainty or exposes a useful discrepancy.

**Result:** Passed. Wonder authored a bounded start/observe/stop experiment, proved belt/encoder motion while the entry indication remained high and all downstream sensors stayed false, and moved confidence from 0.35 to 0.78.

### CP-10 — Rewrite, hot reload, and rollback

**Exercise:** Muse revises a device/fault/world behavior while the incumbent runs. Test a valid migration and a deliberately failing candidate.

**Pass:** Candidate compiles/tests, state migrates or branches explicitly, atomic activation is attributable, and failing activation restores the healthy module/snapshot.

**Result:** Passed after bounded structural self-repair. The final evidence-only candidate compiled, preserved the incumbent state hash, passed shadow health, activated as `0.5.1-gate-c`, and emitted contracted revision evidence. A deliberately failing `0.5.2-failing` migration rolled back while retaining the healthy active version. No conveyor physics was changed.

### CP-11 — Budget and not-hung behavior

**Exercise:** Simulate a slow request, repeated failed repair, exhausted budget, stalled world heartbeat, and held condition wait.

**Pass:** CLI status distinguishes each case, shows elapsed time and spend, aborts at hard limits, and preserves the last valid/held state.

**Result:** Passed. The guard distinguished active/timed-out requests, repair warning/hard-stop states, campaign exhaustion, stale world heartbeat, valid condition wait, and condition timeout while preserving the active world. Conservative campaign accounting was $3.25, warning level but below the $5 hard stop.

### CP-12 — Artifact and evidence audit

**Exercise:** Inspect the completed proof package.

**Pass:** Code, manifest, assumptions, generation lineage, repairs, versions, state changes, fault truth, raw effects, surrogate outputs, activity, costs, evidence lanes, and verdicts are complete and internally consistent.

**Result:** Passed 12 deterministic checks over 3,802 preserved trace events. Final package and candidate hashes, repair chains, blind-truth commitment/seal ordering, evidence citations, hot-reload state hashes, model-call accounting, and CP-0 through CP-11 verdicts are internally consistent. Six warnings disclose evolving-spec provenance, unavailable rejected outputs, conservative rather than exact dollar billing, and one unsupported adversarial verdict; none changes accepted code or a checkpoint verdict.

## 11. Budgets for the Proof

Initial hosted limits follow the accepted development defaults:

- $1.00 per request;
- $2.00 per repair episode;
- campaign warning at $3.00 and hard stop at $5.00;
- $15.00 session hard limit;
- five-minute request timeout;
- failed-repair warning at three and hard stop at five unless explicitly extended.

No automatic extension is allowed. All usage and extensions are recorded.

## 12. Truth and Evidence Lanes

The proof preserves independently:

1. specification expectation;
2. physical world truth;
3. fault intervention truth;
4. logical surrogate transport/frame truth;
5. surrogate PLC output fixtures and raw input effects;
6. Muse hypotheses/actions;
7. generated package/compiler/test history;
8. adjudicated checkpoint result.

This proof does not claim live PLC evidence. Every artifact is labeled surrogate/contract evidence until the real CODESYS connector gate.

## 13. Go/No-Go Gates

### Gate A — Generation viability

Requires CP-0 through CP-4. Failure means stop before building actuator, campaign, connector, or UI work.

### Gate B — Full-world viability

Requires CP-5 through CP-7. Failure means revise generated-world contract or physical/device modeling before active-agent work.

### Gate C — Agentic viability

Requires CP-8 through CP-11. Failure means reassess prompt/context, model latency/cost, truth isolation, hot reload, or hosted/local model strategy.

**Result:** Passed on 2026-10-29. This is still surrogate/contract evidence, not a live PLC claim.

### Gate D — Ready for real connector

Requires CP-12 plus accepted measurement plan for CODESYS/OPC UA. Only then begin the real interceptor/connector spike.

**Result:** Passed on 2026-10-29. The accepted M0-M7 plan is `docs/codesys-opcua-measurement-plan.md`. This authorizes a measured connector spike and does not claim live CODESYS/OPC UA performance.

## 14. Invalid Proofs

The proof is invalid if:

- a human writes or silently repairs conveyor behavior;
- platform code contains conveyor routing, geometry, or expected sequences;
- a static timeline substitutes for output-responsive world behavior;
- normalized engineering values bypass raw PLC input behavior;
- the world model's own expected state is used as PLC evidence;
- a known fault is labeled blind to the same context that created it;
- missing artifacts or evidence gaps are treated as passes;
- surrogate timing/results are presented as CODESYS or OPC UA evidence;
- graphics or a polished report conceal a failed causal checkpoint.

## 15. Post-Proof Handoff

The generated package, module/context boundary, staged gates, budgets, repair guardrail, and connector-readiness criteria have been exercised and accepted. Preserve these artifacts as surrogate/contract evidence. The next work is the measured M0-M7 CODESYS/OPC UA connector spike; do not relabel surrogate evidence as live PLC evidence or bypass the measurement plan to build product UI first.
