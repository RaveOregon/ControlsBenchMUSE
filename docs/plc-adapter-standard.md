# ControlsBench PLC adapter and library standard — draft 0.1

Status: prototype contract 0.1, 2026-11-01. The product direction is accepted. A separate CODESYS library and independent consumers have been built offline; runtime conformance, a released v1 contract and additional vendor support remain unproven. Preserve the frozen live demo until a separately identified library consumer passes deployment regression.

## Product promise and current gap

An engineer installs a vendor-appropriate ControlsBench library, instantiates its blocks at the raw I/O boundary, and maps the machine's signals. A versioned adapter manifest connects those instances to the workstation. The same campaign/world interfaces operate across conforming PLC implementations; vendor-specific code and transport bindings implement the common semantics.

Current `codesys/demo/source/FB_BenchIntercept.st` is an in-project implementation. It directly reads/writes singleton `GVL_BenchWrite` and `GVL_BenchRead`, uses conveyor-named `ST_BenchInputImage`, includes conveyor diagnostic range checks, and derives stale timing from a fixed number of scans. `PLC_PRG` instantiates it, but that instance does not make it a reusable, independently instantiable library. DO/AO tapping is also wired in the demo program. The separate `codesys/library/` prototype now supplies that packaging boundary: `ControlsBench Core` 0.1.0.0, namespace `CB`, source and compiled artifacts, and independent Library Manager consumers. It does not change the in-project live implementation.

The measured M8/M10 behavior is valid evidence for the in-project implementation. The library's build evidence proves compilation and consumption only. Runtime conformance, live library deployment and automatic onboarding to other PLC products remain unfinished. Do not describe them as shipped.

## Architecture layers

| Layer | Owns |
|---|---|
| Common adapter standard | Raw-signal identity/representation, authority, image/session/acknowledgement semantics, observations, diagnostics and conformance |
| Vendor library | Native data types, instance-owned state, scan-boundary selection/tapping, coherent publication and required platform services |
| Workstation transport | OPC UA or other mapping, discovery, typed transfer, quality/timestamps, authenticated connection and measured cadence |
| Machine integration generated from spec/I/O map | Channel allocation, machine-specific typed structures/wrappers, library instances, I/O wiring and manifest bindings |
| Generated world and campaign | Physics, device behavior, faults, scenarios, adaptive decisions and evidence/report |

Specification-to-library integration means producing machine-specific wiring and configuration against a stable vendor library. It does not require regenerating the tested library core for every machine. Where native type constraints require generated wrappers or typed FB variants, retain the stable session contract and validate the generated boundary. A vendor implementation may use an AOI/UDT or other native packaging instead of an IEC library; it must pass the same applicable conformance gates. Support for each product is earned through that implementation and its evidence.

## Required behavioral contract

The following preserve accepted architecture decisions and define the extraction target:

- **Placement:** intercept after raw hardware/device acquisition and before application consumption. Sample actual application outputs before any optional physical-sink suppression. Record task/call ordering and output-capture phase.
- **Default authority:** cold startup uses transparent hardware passthrough. Simulation selection is explicit, observed, and scoped to a declared complete image/authority domain.
- **Simulation entry:** initialize all simulated fields to their raw zero immediately; application execution continues. Configured normal conditions arrive through later explicit commits. RunReady is metadata, not a gate hiding zero-image behavior.
- **Complete input ownership:** all configured DI/AI channels in the domain use the selected source. DI and AI instances share the same accepted revision when a complete image spans them. Multi-task domains declare independent boundaries and timestamps rather than implying cross-task scan atomicity.
- **Raw representation:** preserve BOOL, integer/word/counter widths, signedness, device encoding, rollover and raw status. The PLC retains scaling, debounce/filtering and engineering conversion. Unsupported types are declared; no silent conversion or omission.
- **Validation:** enforce representation, dimensions, contract compatibility and transaction integrity. Do not embed conveyor-specific physics or silently clamp fault stimuli. Process ranges and supported unusual raw values belong to explicit channel capabilities/policies; reject unsupported encodings visibly rather than substituting plausible data.
- **Image publication:** stage a complete candidate independently; application logic consumes either the prior complete revision or the newly accepted complete revision. No torn image. Echo the actual consumed session epoch/revision with capture cycle/time and boot identity.
- **CODESYS OPC UA profile:** retain the proven inactive-slot invalidation, complete payload/metadata, valid flag, and write-last RequestedSequence predicate during extraction. Specify duplicate, stale, skipped, invalid, epoch-transition and restart behavior exactly. Other transports may encode differently while preserving these semantics.
- **Link loss:** retain the last applied simulated image and simulation selection; expose bench-link stale. Reconnect/heartbeat freshness alone does not publish staged input. Require an explicit complete accepted commit to change the image.
- **Outputs:** workstation observation always retains authentic raw application commands. Optional suppression changes only the physical sink and is explicit configuration with visible applied state.
- **Stop/reset/exit:** campaign Stop holds for inspection; workstation simulation reset zeros the simulated image while remaining simulated; Exit Simulation deliberately restores passthrough. PLC machine Reset is a separate operator request and is never issued implicitly by the library.
- **Timing:** accept/configure time services or an explicit monotonic time input. Describe timeout units, task requirements, counter wrap and boot behavior. Avoid a hidden 25-scan timeout that changes meaning when a customer changes the task period.
- **No embedded plant:** the default library contains no machine physics, carton routing, test plan, campaign agent, model key or fault campaign. A scheduled raw-signal player remains an optional later capability requiring separate evidence.

## Library API and instance contract

Preferred public blocks are DI selection, AI/counter/device selection, DO tap/gate and AO tap/gate, coordinated by a session/image-domain block. `codesys/library/README.md` and `adapter-profile.json` define the built CODESYS prototype API, capacities and limitations. Other vendors implement the same semantics with native packaging. A released v1 API still requires runtime conformance; a compiled prototype is not that certification.

Each instance receives or references explicit configuration, request/staging storage, hardware/application values and timing/session services. It returns selected input values or physical output values plus observed commands and status. Caller-provided structures through `VAR_IN_OUT`, typed arrays or equivalent vendor constructs are implementation choices; the core must not reach into conveyor-named application globals.

All mutable state, diagnostics, staging slots and applied revision belong to the instance/domain. Two instantiated domains must not share singleton session state, overwrite each other's buffers, or couple simulation selection. Individual point/group instances in one domain deliberately share its coordinated revision. Shared immutable definitions are permitted; any shared boot/time service must be explicit and must not collapse independent domain authority.

The engineer should connect an added point through a documented, repeatable mapping step. Capacity overflow, duplicate logical identities, missing mappings and incompatible library/manifest versions fail setup visibly. Only the installed integration's explicit writable interface is a stimulus surface.

## Versioned onboarding manifest

Required metadata, with exact serialization to be frozen alongside executable tests:

- standard version, vendor/profile, library version, target/runtime/compiler versions and supported capabilities;
- application/build and adapter-instance/domain identities, schema/map hash and required task/call order;
- transport binding/version, required types/access rights and discovery paths (opaque endpoint node IDs can be resolved per deployment);
- per channel: stable logical ID, direction, group/instance/domain, native type/width, signedness, encoding/byte order where relevant, index/path, raw unit, zero/normal values, inversion and configured representation restrictions;
- separate optional engineering scale/device metadata, never a replacement for raw values;
- read/write ownership, actual output versus physical sink, optional suppression capability and observation quality/timestamp support;
- complete-image revision/capture semantics, heartbeat/timeout units, boot/session transitions, counts/capacities and explicit limitations;
- specification/I/O source references, inferred assumptions and mapping validation results.

An adapter reports capability limitations before a campaign starts. Transport cadence is measured separately per deployment/load. A portable interface does not imply identical performance across PLC products.

## Data acquisition and future analysis — accepted product direction

The installed library is also the foundation for streaming and recording machine signals for later PID tuning, signal processing, filtering and other engineering tools. It must remain useful during normal hardware passthrough; acquisition does not require enabling simulated input authority. The hackathon slice does not establish those analysis features or their sampling performance.

Design and version the following now, implementing only the capabilities explicitly included in the current delivery:

- **Signal provenance:** distinguish acquired raw hardware inputs, the selected inputs actually consumed by the application, authentic application outputs and physical-sink values after optional suppression. A recording must identify which of these it contains, including simulation/suppression state. Never present generated or substituted values as hardware measurements.
- **Engineering context:** retain stable signal identities and raw native representations, plus separately versioned units, scaling, ranges, polarity and counter rollover metadata. PID profiles may map setpoint, process variable, controller output and controller mode through explicitly configured observation taps. Internal signals are not automatically part of the raw-I/O interface or a writable stimulus surface.
- **Sampling and alignment:** define boot identity, task/domain, source cycle/time, capture phase, sample sequence and quality. Record source/sample time separately from workstation receipt time and acknowledge clock uncertainty. Do not imply simultaneous cross-task sampling. Coherent snapshots and fresh-value reads alone do not prove that every source sample was acquired.
- **Delivery and gaps:** declare requested versus achieved sample rate, transport decimation, missing samples, counter discontinuities, duplicates and buffer overruns. Preserve gaps; reconstructed/interpolated values must be labelled as derived. Select sampling requirements from the process/analysis need and qualify the actual target/transport; the existing demo's OPC UA cadence is not a general PID acquisition qualification.
- **Bounded acquisition:** provide explicit enable/disable and resource limits. A slow/disconnected workstation must not block PLC application execution or silently change control authority. A later bounded PLC-side sample buffer/batch exporter may be evaluated if transport polling misses source dynamics; it is distinct from the deferred stimulus playback feature and is not implemented by this prototype.
- **Independent use:** passive observation/recording, simulation input selection and physical output suppression are separate capabilities. No PID excitation, tuning-parameter write or controller modification follows merely from permission to observe or record. Later active analysis tools use explicit, versioned interfaces and capability declarations.

Maintain a capability/roadmap matrix alongside the actual adapter profile. Each item is marked implemented, compiled-only, runtime-validated, planned or unsupported, with its evidence/issue reference. Identify an extension point or explicit limitation for deferred work; a TODO does not count as a delivered streaming API. This prototype provides raw selection and output capture, but no qualified continuous acquisition/export pipeline, PID tuning service or signal-processing service.

## Version control and compatibility

Git must contain the common specification, vendor block/type source, adapter profile/schema, machine mapping definitions, consumer examples, conformance checks and changelog. Every delivered build binds their exact revisions/hashes to the library binary hashes and compiler/runtime compatibility information. Preserve previous builds and evidence; never update an old proof to describe newly changed blocks.

Track library/package version, public FB/type API version, adapter/wire protocol version, machine map/schema version and future recording format version explicitly. Do not assume that one library version proves all these interfaces compatible. Document additive versus breaking changes, migration requirements and which consumers passed. A released version is immutable; keep prototype snapshots identified as such. Native File-Based Storage remains the preferred CODESYS source format once available; until then the text sources plus reproducible builder remain version-controlled alongside generated build artifacts.

## CODESYS extraction and acceptance gates

1. **Contract freeze:** map each accepted behavior to existing M2/M5/M8/M10 evidence or an unproven conformance test. Resolve capacities/type topology, domain coordination and serialization. Record compatibility with the frozen demo protocol.
2. **Offline extraction:** create a source library project with namespace, version, public types/FBs, explicit instance storage, dependencies and documented call order. Build a library artifact using the supported CODESYS mechanism; retain source/build provenance. No license choice is implied by this draft.
3. **Independent consumer:** a fresh application references the installed library through Library Manager and declares ordinary instances. It must not copy the library implementation into application POUs. Keep machine controller logic and machine-specific mapping in the consumer.
4. **Reusability proof:** instantiate at least two independent domains and exercise distinct mappings and channel counts. Changing one domain's mode, commit, timeout or output suppression must not affect the other. Include a small non-conveyor mapping to expose hardcoded device assumptions; a whole second machine world is unnecessary.
5. **Boundary conformance:** verify passthrough, zero entry, raw type boundaries/rollover, configured invalid encodings, coherent mixed-group commits, duplicate/stale/skipped/partial commits, boot/epoch changes, hold/reconnect, output authenticity and configured suppression. Include multiple task-period timeout checks.
6. **Live regression:** deploy a new consumer build under a new recorded identity, then repeat relevant coherence/recovery and M10 world/controller tests. Check added task cost. Never weaken frozen project-hash guards to make extraction appear equivalent.
7. **Release/onboarding:** deliver installable artifact, source project, versioned manifest/schema, example consuming project, mapping instructions, conformance results, migration notes and tested-version matrix.

## Sequencing for the current hackathon

The user authorized offline library construction now, independently of Claude's process isolation/recovery and the Wonder campaign. The library lives on `codex/plc-library` in an isolated worktree. Its compiler proof covers the core, an independently compiled consumer library, and a separate consumer application with two declared domain instances. The conformance harness has been compiled, not executed; instance isolation is still a runtime gate.

Next: run the prototype's conformance harness on a separate target, extend boundary/epoch/clock cases, validate the machine-generated mapping/profile, then schedule a new-identity demo deployment and live M2/M5/M10 regression. No project-hash guard or existing connector map is changed for this extraction. Native File-Based Storage is a separate migration, documented in `codesys/library/FILE-BASED-STORAGE.md`; its add-on/API is unavailable in the probed profile.

Public/demo copy may say: "The demo uses an integrated CODESYS interceptor. A separate reusable CODESYS library and consumer applications now compile; live library deployment and other vendor implementations are next." Do not present the new bank layout as wire-compatible with the existing live adapter.
