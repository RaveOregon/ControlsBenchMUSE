# ControlsBench Core — reusable CODESYS raw I/O library

Prototype **0.2.0.0**, namespace `CB`, title `ControlsBench Core`, company `ControlsBench`. API 0.2, adapter protocol 2, observation frame format 1. See `CHANGELOG.md`, `VERSIONING.md` and `CAPABILITIES.md`.

The library sits at a machine's raw I/O boundary. It passes hardware through by default, gives the workstation complete input authority only when simulation is requested, observes authentic output commands before any physical suppression, and publishes a passive observation frame that later recording and analysis tools can read during normal operation. It contains no conveyor names, plant model, campaign code, transport client or credentials. Machines connect through generated maps.

**Status: compiled only.** The core, a consumer library and a consumer application compile with zero errors and zero warnings, against both the binary-built and the File-Based-Storage-built core. Nothing has run on a PLC. The library is not deployed, the demo does not use it, and it is not wire-compatible with the frozen M8 adapter map.

## Layout

| Path | Contents |
|---|---|
| `source/` | Core DUT, GVL, function and FB sources, one object per file (Git text, LF) |
| `library.json` | Package identity, interface versions and the ordered object lists the builder uses |
| `mappings/*.map.json` | Machine maps: `conveyor-m8` (the M8 raw signal set) and `tank-loop` (non-conveyor example with PID taps) |
| `mappings/generated/` | Generated manifests: channel allocation, wire fingerprints, engineering metadata hash |
| `examples/` | Conformance harness, consumer application program, generated map wrappers |
| `schemas/` | Machine map schema; recording format draft (reserved, not implemented) |
| `scripts/` | Builder, headless launcher, map generator, promotion, audit, File-Based Storage probe |
| `builds/` | Immutable promoted builds and `index.json`; `prototype-0.1.0.0` is preserved |
| `adapter-profile.json` | Machine-readable profile: banks, semantics, result codes, capabilities |

## Build and verify

Offline only, on the configured workstation:

```powershell
node codesys/library/scripts/cb-map.mjs check          # generated wrappers match the maps
powershell -NoProfile -ExecutionPolicy Bypass -File codesys/library/scripts/build-library.ps1
node codesys/library/scripts/promote-build.mjs         # clean-tree builds only; refuses to overwrite
node codesys/library/scripts/audit-build.mjs           # Git + Node; no CODESYS or PLC needed
```

`build-library.ps1` records the Git commit and dirty paths, then starts its own hidden `--noUI` CODESYS process. It never attaches to an open IDE and never logs in to a controller. The build:

1. creates `ControlsBenchCore.library` from `source/`, compiles it, saves the compiled library, reopens the saved library and compares every declaration and implementation with Git;
2. converts a **copy** to native File-Based Storage (`ControlsBenchCore.fbslib`), reopens it with `fbs.open`, compares again, compiles it, saves a second compiled library, and proves the cache-free Git subset reopens and compiles on its own;
3. installs the binary-built library into a dedicated development repository (`repository/`, ignored), builds the consumer library and the consumer application, reopens both and compares their sources;
4. installs the FBS-built library over it and rebuilds both consumers;
5. checks the consumer template (`codesys/conveyordemo.project`) is byte-identical before and after.

Any compiler error or warning fails the build. `result.json` records every step, message, source hash, artifact hash and the FBS file hashes. The consumer application is a copy of the frozen M8 project template, used only for its Control Win device and task configuration; its project title marks it offline-only and the inherited M8 POUs are not called.

## Public API

| Object | Purpose |
|---|---|
| `FB_CB_Session` | One per authority domain. Coherent two-slot commits, source selection, raw-zero entry, staleness, resets, acknowledgement, diagnostics |
| `FB_CB_DI`, `FB_CB_AI` | Whole-bank source selection used inside the session |
| `FB_CB_DO`, `FB_CB_AO` | Output taps: authentic commands observed; explicit per-channel suppression with substitute values changes only the physical sink |
| `FB_CB_OutputCapture` | Authentic commands with the consumed input revision, after the application, with a publication seqlock |
| `FB_CB_Observation` | Passive per-cycle frame for monitoring and later recording; no write path |
| `F_CB_CheckImage` | Representation check the session applies to every candidate image; usable by consumers before staging |
| `ST_CB_Image`, `ST_CB_Numeric` | Raw banks: 64 BOOL, 32 DINT, 32 UDINT, 16 REAL |
| `ST_CB_Config` | Domain and schema IDs, timeout, channel counts, native width per integer channel, non-finite policy per REAL channel |
| `ST_CB_Request`, `ST_CB_Slot` | Workstation-writable request storage owned by one domain |
| `ST_CB_Status` | Read-only status, acknowledgement and counters |
| `ST_CB_ImageMask`, `ST_CB_NumericMask` | Per-channel masks for suppression |
| `ST_CB_ObservationFrame` | Frame layout, format 1 |
| `GVL_CB` | Versions, capacities, result codes, bank and phase codes |
| `U_CB_Real32` | REAL/DWORD view for bit-exact encoding checks |

Unsupported native types (64-bit integers, LREAL, time and date types, strings, structures) are rejected by map validation, never narrowed. See `adapter-profile.json`.

## Per-cycle call order

Call everything for one domain once per cycle, in one task:

1. Pack raw acquisition into a hardware image (`MAP_<P>_PackInputs`).
2. Call the domain's `FB_CB_Session` with its `Config` (`MAP_<P>_Config`), monotonic `NowUs`, nonzero `BootId` and its own `ST_CB_Request`.
3. The application consumes `Session.Image` (`MAP_<P>_UnpackInputs`). All banks share one applied revision.
4. Pack the application's commands (`MAP_<P>_PackOutputs`) and pass them through `FB_CB_DO`/`FB_CB_AO`. Drive the physical sink from `Physical` (`MAP_<P>_UnpackOutputs`).
5. Call `FB_CB_OutputCapture` and, if used, `FB_CB_Observation` with the session status, the session's `Hardware` input, its `Image`, the commands, the physical image, the applied masks and the packed taps.

`examples/application/PLC_PRG.st` shows two independent domains wired this way. `BootId` and `NowUs` are platform services the consumer supplies; the example uses `SysTimeCore.SysTimeGetUs` and the first-cycle time as boot identity. `Status.Cycle` counts calls of that domain, not PLC scans. `Reinitialize` is local application authority and must not be exposed to the workstation.

## Commit protocol (adapter protocol 2)

Writer (one per domain):

1. Pick the inactive slot (`RequestedSlot <> Status.ActiveSlot`). Clear its `Valid`, write the complete image and `DomainId`, `SchemaId`, `Epoch`, `Sequence`, then set `Valid`.
2. Write `RequestedSlot` and `RequestedEpoch`, then **`RequestedSequence` last**. The sequence must differ from the previous request, also across an epoch change. Changing only the epoch, slot or payload is not a commit.
3. Wait until `Status.ConsumedSequence` echoes the request before reusing that slot. `ConsumedResult` gives the outcome; `AppliedEpoch/Sequence` change only on `ACCEPTED`.
4. `RequestedEpoch = 0, RequestedSequence = 0` is the idle request (`IDLE_CLEARED`), used after a reset.

Session rules: incomplete, mismatched, duplicate, stale, wrongly-represented and wrong-slot requests keep the prior image and increment their own counter; skipped sequences are accepted and counted. A new epoch is accepted only with no prior epoch, after an explicit reset, or when the link was already stale at the start of the cycle. Each request edge is consumed once; repair needs a new sequence.

Reader of output capture or frames: read `PublicationRevision`, then the fields, then the revision again, with fresh ordered reads. Accept only equal, nonzero, even revisions. This needs a qualified transport read policy; it is not a claim of OPC UA atomicity.

## Representation

`ST_CB_Config` declares each configured integer channel's native width (signed 8/16/32, unsigned 1–32) and each REAL channel's non-finite policy. A candidate image is rejected, with `RejectBank` and `RejectIndex`, if a value is outside its width, a finite-only REAL is NaN or infinite (checked on the bit pattern), or an unconfigured channel is not zero. Raw values are copied bit for bit; the PLC application keeps all scaling, filtering, debounce and engineering conversion. A configured channel without a valid width makes the configuration invalid.

## Authority and resets

| Event | Image | Metadata | Simulation |
|---|---|---|---|
| Cold start | hardware | cleared | off |
| Simulation entry (`SimRequest` rises) | raw zero | cleared; staged request consumed | on |
| Complete accepted commit | new revision | applied epoch/sequence | on |
| Link loss (no heartbeat change for more than `TimeoutUs`) | held | kept; `ConnectorStale` | stays on |
| Heartbeat only | unchanged | unchanged | unchanged |
| Session reset (`SessionResetRequest` rises) | kept | cleared; staged request consumed | unchanged |
| Simulation Reset (`SimulationResetRequest` rises) | raw zero | cleared; staged request consumed | stays on |
| Exit Simulation (`SimRequest` falls) | hardware | kept | off, always honoured |
| Configuration, boot or backward-clock change | held | `ReconfigureRequired` latched; requests refused | unchanged |
| Local `Reinitialize` rises | raw zero if simulated | cleared; config and boot re-pinned | unchanged |

The library never issues a machine Reset.

## Passive observation

`FB_CB_Observation` publishes one fixed-size frame per cycle: `RawInputs` (hardware values presented to the session, in either mode), `SelectedInputs` (what the application consumed), `Commands` (authentic), `Physical` (after suppression), `Suppressed` masks, `Taps` (map-declared internal signals such as PID setpoint, process variable, output and mode), identity (`BootIdentity`, `DomainId`, `SchemaId`, `TapSchemaId`), `SourceCycle`, `SourceTimeUs`, `CapturePhase`, quality flags, and gap counters (`FrameSequence`, `MissedCycles`, `RepeatedCycles`). It needs no simulation authority, writes nothing back and never waits on a transport.

This is an extension point, not an acquisition system. No reader, recording format, sampling qualification or analysis tool exists yet; `CAPABILITIES.md` lists their gates. The demo's 10 Hz OPC UA qualification does not cover frame acquisition, PID or signal-processing use.

## Onboarding a machine

1. Write `mappings/<id>.map.json` from the machine's specification and raw I/O list: one channel per raw signal with its native type, optional unsigned bit width, REAL non-finite policy and separately versioned engineering metadata; taps for internal signals to observe.
2. Run `node scripts/cb-map.mjs generate`. Unsupported types, duplicates and capacity overflow fail visibly. The generator writes `examples/mappings/<id>/` and `mappings/generated/<id>.manifest.json`.
3. Add the generated objects to the consumer project, wire the per-cycle call order, and bind the request (writable) and status/frame (read-only) through the transport.
4. The workstation checks `Status.ProtocolVersion`, `Status.SchemaId` and `Frame.TapSchemaId` against the manifest before it writes or interprets data.

Channels are allocated contiguously per bank in declaration order; append new channels to keep existing indices.

## Build record: prototype-0.2.0.0

Built 2026-11-02 02:31–02:32 UTC from clean commit `1eb0f4a6b76b012bffbd5f0d83666ac73190277e` with CODESYS 3.5.22.30, profile `CODESYS V3.5 SP22 Patch 3`, File-Based Storage 1.0.0.0. All eleven compiler checkpoints report zero errors and zero warnings. Consumer template `codesys/conveyordemo.project` SHA-256 `6c2a1eb6c9c83485b75cb9bcefc1be237a94c8727ecf8098ad57a4d680516628` before and after. `builds/prototype-0.2.0.0/result.json` lists all 58 source hashes, 9 artifacts and 26 native files.

| Artifact | SHA-256 |
|---|---|
| `ControlsBenchCore.library` | `f93830deb88470aa40c80cfc457a33ad37e5cc7c888554859c3e84265956a939` |
| `ControlsBenchCore.compiled-library` (from binary) | `ddc166e68db2f58753be5175e129dde58ab822904142e96aa83f957de6393796` |
| `ControlsBenchCore.fbs.compiled-library` (from native FBS) | `a93114d5d3dae9a8dbadde99a4696748edc211aa2e07e03677e0bc4b0f6a0cab` |
| `consumers-binary/ControlsBenchConsumer.library` | `ce2da66dc188071d7c2d8a704198f2a57eef914031fce87c6af04aa4636bc551` |
| `consumers-binary/ControlsBenchConsumer.compiled-library` | `fdb1d6992f55dd11d84070d776c7d8ddef30151e6166542ce28d4d74ce92d0f7` |
| `consumers-binary/ControlsBenchConsumer.project` | `7cba9d5e418c09f076b412d875e71315f8fb157a9d1c2c25446c1f92b962745e` |
| `consumers-fbs/ControlsBenchConsumer.library` | `7b751e5238feb4baa7c3bf1dfa48acd9faaca4b195c9b6535d42ef102b336be8` |
| `consumers-fbs/ControlsBenchConsumer.compiled-library` | `8d4e7414d51e3af817d6d10901140151d7ef02bfb14ab330b59111007007d5bf` |
| `consumers-fbs/ControlsBenchConsumer.project` | `82c3bbd650ddd0f28b0e7688f3115afcd17e10c18f240a6578886f8cc73da964` |

Generated map identities: `conveyor-m8` SchemaId `16#C69AC9A1`, no taps; `tank-loop` SchemaId `16#908F6F3C`, TapSchemaId `16#A7F251A8`.

## Verification scope

`examples/FB_CB_ConsumerChecks.st` has 46 cases across five session instances: passthrough and exact raw boundaries, raw-zero entry, every rejection class, representation limits, NaN bit preservation, timeouts at two call periods, heartbeat-only recovery, epoch rules, idle requests, all resets, exit, reinitialization, boot/clock/config latches, invalid configuration, output taps and suppression, capture, observation provenance and gap counters, independent domains, and both generated maps. It sets `Done`, `Passed`, `FailedCase` and `CasesRun` **when executed**. This lane compiled it; it has not been executed (gate G-RT-1).

Executed in this lane: the map generator and its freshness check, the headless builds with source readback, the File-Based Storage conversion and reopen, and the Git-based audit of all promoted builds.
