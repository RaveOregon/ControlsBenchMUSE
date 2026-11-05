# Reusable PLC library build lane

Paste the following into the library-building agent. It includes the user's direction to preserve the wider acquisition/analysis ecosystem while finishing the offline CODESYS library.

```text
Build and package the reusable ControlsBench PLC library foundation. Do not deploy it or switch the running demo to use it.

Repository: C:\Users\steve\Documents\ControlsBenchMuse
Existing lane: codex/plc-library, worktree .worktrees/plc-library.
Inspect the current branch and status before changing anything; preserve other agents' work.

Read:
- codesys/library/HANDOFF.md and README.md
- codesys/library/adapter-profile.json
- codesys/library/FILE-BASED-STORAGE.md
- docs/plc-adapter-standard.md
- Existing source, consumer checks, build scripts and preserved results

PRODUCT PURPOSE
ControlsBench's installed vendor blocks are an enduring raw-signal integration layer. They support the current AI-generated closed-loop bench world and must also support later passive streaming/recording for PID tuning, signal processing, filtering and other engineering tools. They must remain useful during normal hardware passthrough. The current conveyor is one consumer, not the library's data model.

DELIVER NOW
1. Review and complete the existing CODESYS prototype rather than restarting it. Deliver reusable DI/AI/DO/AO blocks with coordinated session/image domains and independent instances.
2. Align the actual API, source, common standard, adapter profile and onboarding/mapping requirements. Use machine-specific mappings against a stable core; avoid hardcoded conveyor globals or physics.
3. Build editable and compiled libraries. Compile separate Library Manager consumers, including independent domains and a non-conveyor mapping. Preserve build provenance and exact artifact hashes.
4. Version-control the specification, FB/DUT sources, schemas/profiles, mappings, examples and conformance checks. Add a changelog and explicit compatibility/version policy. Distinguish package/API, adapter protocol, machine map and future recording format versions. Released artifacts are immutable; preserve old proofs.
5. Produce a capability matrix: implemented, compiled-only, runtime-validated, planned or unsupported, with evidence/issue references. For each future requirement, implement a small justified extension point now or explicitly record the limitation and later acceptance gate. Do not build an entire analysis platform in this lane or call a reserved capability implemented.

CURRENT BEHAVIOR TO PRESERVE
- Hardware passthrough by default; explicit simulation gives complete configured input authority to the workstation.
- Simulation entry/Simulation Reset produces raw zero while remaining simulated.
- Link loss holds the last image and exposes bench staleness. Session reset, Simulation Reset, machine Reset and Exit Simulation remain distinct.
- Raw native values/encoding remain intact; PLC scaling, filtering, debounce and normalization stay under test.
- Complete coherent commits, boot/epoch/sequence acknowledgements, output provenance and documented capture/read coherence.
- Observe authentic application commands before optional downstream physical suppression.
- Instance-owned state and diagnostics; no cross-domain coupling, campaign code, plant model or credentials in the core.
- Unsupported native types/capacities are explicit. Never silently narrow, omit or reinterpret a field.

FUTURE ACQUISITION AND ANALYSIS CONTRACT
- Passive observation/recording must not require simulation authority or suppression.
- Distinguish raw hardware inputs, selected application inputs, authentic output commands and physical sinks after suppression. Record source and simulation/suppression state.
- Provide stable signal identities with raw representation and separately versioned units/scaling/ranges/polarity/rollover metadata.
- Reserve explicitly configured observation taps for PID setpoint, process variable, controller output and mode, including internal signals where needed. Monitoring a signal does not automatically make it writable.
- Specify source task/domain, boot, cycle/time, capture phase, sequence and quality. Separate source timestamps from receipt time and declare clock uncertainty/cross-task alignment limits.
- Define requested versus achieved sampling, decimation, missing samples and buffer overruns. Preserve gaps; label interpolation or derived values.
- Sampling must be qualified for the target process and transport. Do not claim the demo OPC UA cadence is sufficient for all PID or signal-processing uses.
- Acquisition must have bounded PLC resource use and must not block control execution when the workstation slows/disconnects. Flag a bounded source-side acquisition buffer as a possible later extension if measurements justify it; do not confuse it with stimulus playback.
- No automatic PID excitation, gain writes or controller changes follow from observation/recording permission. Those future tools need explicit capabilities and their own tests.

VERIFICATION
Review/extend the existing consumer harness for raw boundaries, coherence, rejected/partial/duplicate/stale commits, boot/epoch/clock/config changes, reset semantics, output capture/suppression and independent domains. Build in a dedicated headless IDE process. Reopen saved library source and compare it with Git's text sources; validate all artifact/source hashes. Label compilation versus actual runtime execution precisely. Reserve acquisition-rate, dropped-sample, buffering, timestamp/quality, analysis and task-overhead tests as explicit future gates when their implementation is deferred.

FILE-BASED STORAGE
Native CODESYS File-Based Storage is the intended sharing format. Probe availability. If available, convert a COPY of the new library, reopen it and rebuild its consumers. Otherwise record the dependency/migration steps and continue with version-controlled ST plus reproducible binary builds. Do not invent native metadata, install/restart under another agent's active IDE session, or convert the live demo.

BOUNDARIES
No PLC login/download/online change/recovery/live writes. No credential watcher. No changes to the frozen controller, live connector/map, HMI or Wonder campaign lanes to adopt the new library. Keep the common standard vendor-neutral, but claim only implemented/qualified vendor support. No automatic expansion into PID algorithms, tuning UI, a historian or unrelated controller logic.

FINISH
Commit focused work on the library branch. Report artifact locations, consumer/compiler results, source/build provenance, compatibility/version matrix, future capabilities and explicit gaps, File-Based Storage status, and commit hash. List the later conformance/deployment gates without swapping anything into the live demo. Proceed with the offline work; do not stop at an uncompiled collection of blocks or a design document.
```
