# ControlsBench Core — offline reusable CODESYS library

Version: prototype 0.1.0.0, namespace `CB`, title `ControlsBench Core`, company `ControlsBench`.

This is a separately built library with caller-owned request storage and instance-owned state. It contains no conveyor signal names, application GVL dependencies, PLC transport client, physics, campaign or model credential. It is being built in parallel with the live demo; the deployed `conveyordemo.project` remains unchanged.

## Build

From this worktree on the configured engineering workstation:

```powershell
powershell -ExecutionPolicy Bypass -File codesys/library/scripts/build-library.ps1
```

The script starts a separate hidden CODESYS `--noUI` process using the installed profile. It never logs in to a controller. It builds timestamped artifacts, installs the prototype into a dedicated workspace repository named `ControlsBench Offline Development`, and compiles two separate consumers referencing the installed library through Library Manager. Existing system/customer libraries are not overwritten. Development rebuilds may replace this unreleased 0.1.0.0 prototype in that dedicated repository; a release must use immutable versioning.

`artifacts/latest.json` identifies the newest local build result; transient runs/caches are ignored by Git. `builds/prototype-0.1.0.0/` preserves the reviewed successful snapshot. Successful outputs include:

- `ControlsBenchCore.library` and `ControlsBenchCore.compiled-library`;
- `ControlsBenchConsumer.library` and its compiled form, with only a dependency reference and consumer checks;
- `ControlsBenchConsumer.project`, a separate application using the known M8 target/task template, whose `PLC_PRG` calls the library consumer harness. Inherited M8 machine POUs remain uncalled template content, not library implementation;
- `result.json` with compiler messages, source/artifact hashes, untouched-demo hashes and build status.

Verify the preserved snapshot without CODESYS or a PLC:

```powershell
node codesys/library/scripts/audit-build.mjs
```

The audit checks all twelve source hashes, the consumer source, five built files, the profile identity and the recorded offline scope. The builder also reopens the saved core source library and compares every declaration/implementation before compiling its consumers. CODESYS emitted an unrelated Application Composer license warning during startup; the core and both consumer compiler summaries report zero errors and zero warnings. This is not a runtime/Control Win license failure.

All runtime conformance checks in the consumer are **compiled only** until explicitly executed on a separate test target. Compilation and library consumption do not certify live transport, task impact, deployed behavior or other vendors.

## Public blocks

| Block | Use |
|---|---|
| `FB_CB_Session` | Per-domain coherent staging/commit, zero simulation entry, source selection, heartbeat/stale status, epoch/revision/capture and diagnostics |
| `FB_CB_DI` | Typed discrete source selection, used within Session or explicitly with a coordinated accepted image |
| `FB_CB_AI` | Typed raw numeric source selection; no scaling or physical range filtering |
| `FB_CB_DO` | Observe all original BOOL commands; apply explicit physical suppression mask downstream |
| `FB_CB_AO` | Observe all original numeric commands; apply explicit physical masks/substitution values downstream |
| `FB_CB_OutputCapture` | Publish original output image with the consumed input revision and end-of-application capture phase |

`ST_CB_Image` has a fixed 64-BOOL bank plus raw numeric banks: 32 DINT, 32 UDINT and 16 REAL. Configuration declares used counts within those capacities. The complete fixed-capacity image is selected/published atomically; mapping must not expose unused elements as configured signals. This prototype does not directly represent LINT/ULINT channels, LREAL channels, strings, dynamic arrays or arbitrary device structs. ULINT session counters are metadata, not an advertised ULINT field-I/O bank. Wider/native types need an explicit later profile; do not narrow silently.

## Call and commit contract

1. Acquire hardware raw values into a machine-specific mapping of `ST_CB_Image`.
2. Call a distinct `FB_CB_Session` for each authority domain, with `Config`, a monotonic microsecond `NowUs`, a nonzero platform-provided `BootId`, hardware image and domain-specific `ST_CB_Request` storage through `VAR_IN_OUT`.
3. Application logic consumes `Session.Image`. All banks share its applied revision. It is an integration error to call point selectors with staging data outside this accepted domain image.
4. Tap application DO/AO commands with the typed blocks. Suppression changes the physical sink; the observed command stays authentic.
5. Call output capture after application computation, in the same task and domain cycle, with original commands and `Session.Status`.

For workstation reads, output capture increments `PublicationRevision` to odd before updating fields and to even afterwards. Read the revision, then fields, then the revision again using fresh ordered server reads. Accept only equal nonzero even revisions; otherwise retry. Uncoordinated subscription values or cached reads do not establish a coherent snapshot. This mechanism still requires a qualified transport read/caching policy; it is not a claim of OPC UA network atomicity.

Cold default is hardware. Simulation entry is immediate raw zero; complete subsequent commits establish normal conditions. Config/schema/boot changes or backward time latch `ReconfigureRequired`; reconstruct/reinitialize the domain explicitly. Bad configuration while simulated holds its image and reports the defect rather than silently selecting hardware.

Each inactive slot contains `Valid`, domain/schema ID, epoch, sequence and complete image. Finish invalidation before payload writes, finish payload/metadata before setting Valid, then write requested slot/epoch and **RequestedSequence last**. The sequence must differ from the previous request, including on an epoch transition; changing only epoch or payload is not a commit edge. The session consumes that edge, checks metadata and accepts only a complete inactive slot. Echo the consumed epoch/sequence/cycle/time before slot reuse. Invalid requests are consumed once; repair requires a new request sequence. Use one writer per domain.

Stale/duplicate/invalid updates retain the prior image; skipped sequences are counted. A new epoch requires no prior epoch, an explicitly reset session, or the elapsed stale condition. Staleness is computed from microseconds, independent of task period. A heartbeat can clear link stale without publishing staged data. A rising `SessionResetRequest` clears accepted metadata and retains the image. A rising `SimulationResetRequest` clears metadata and zeros the image while staying simulated. Both consume the currently staged request without applying it; a fresh commit is required. Neither requests a machine Reset. Old epochs are not retained in an unbounded history. Simulation remains selected on link loss; Exit Simulation is the explicit `SimRequest := FALSE` transition.

`BootId` and elapsed time are platform services supplied by the consumer. Use a value that changes on a real application/runtime restart; the synthetic test harness constant is not a production boot-identity generator. Local `Cycle` counts calls to that domain FB, not universal PLC scans. Call exactly once per intended task cycle.

## Example and verification scope

`examples/FB_CB_ConsumerChecks.st` declares two session instances, two independent request structures and different domain/schema IDs. It tests passthrough, zero entry, mixed-bank commit, signed/unsigned boundaries, negative raw REAL, incomplete-slot hold, elapsed timeout, heartbeat-only recovery, skipped sequence, output suppression/capture, passthrough exit and independent B-domain simulation.

The program sets `Done`, `Passed` and the first `FailedCase` (14 cases) when later executed. It also covers separate simulation/session reset semantics and a latched schema change retaining the original domain label. It uses synthetic monotonic timestamps and no hardware mapping. It is a conformance example, not an added task in the active controller. Live M2/M5/M10 regressions and real-time cycle cost remain separate release gates. New library namespaces, bank layouts and symbol paths are deliberately **not wire-compatible** with the frozen M8 adapter map; a later deployment needs new mapping, identity and regression evidence.

## Broader ecosystem and versioning

The user intends these hooks to support later passive signal streaming/recording, PID tuning and signal processing in normal hardware passthrough as well as simulation. These are accepted roadmap requirements, not features certified by the current compiler proof. `adapter-profile.json` identifies the planned capabilities. The common standard defines source provenance, task/time/quality/gap metadata, optional internal PID observation taps, bounded sampling and compatibility/version tracking. The current prototype has no qualified acquisition/export pipeline or analysis service; its raw selectors and output capture are the starting boundary.

Version the blocks, common specification, profile, map and future recording format together through explicit compatibility records and source/build hashes. Add extension points or visible capability limitations now; qualify each later implementation against its own evidence. Passive recording does not automatically enable simulation or authorize parameter changes. See `docs/library-build-lane-prompt.md` for the expanded build-lane instructions.

## File sharing and migration

Text sources in `source/` and `examples/` plus the builder are the editable source for this prototype; generated binary libraries are distributable artifacts. This is useful for Git today, but is not a native File-Based Storage project. See `FILE-BASED-STORAGE.md` for the installed-capability result and conversion plan.
