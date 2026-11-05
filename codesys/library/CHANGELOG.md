# ControlsBench Core changelog

All builds are offline compilations. No library version has run on a PLC. Version rules are in `VERSIONING.md`; capability status is in `CAPABILITIES.md`.

## 0.2.0.0 (prototype), 2026-11-01

Package 0.2.0.0, API 0.2, adapter protocol 2, observation frame format 1, profile `controlsbench.codesys.raw-banks/0.2`, machine map format `controlsbench.machine-map/0.1`. Recording format `controlsbench.recording/0.1-draft` is reserved, not implemented.

This is a breaking release relative to prototype 0.1.0.0. No consumer of 0.1.0.0 was deployed, so no migration of a running system is needed.

### Session and protocol (protocol 1 → 2)

- **Idle request.** A sequence change to `RequestedEpoch = 0, RequestedSequence = 0` is consumed as `IDLE_CLEARED`. 0.1 counted it as an invalid request. The M8 connector writes exactly this after a reset, so 0.2 matches the in-project behaviour.
- **Consumed-request acknowledgement.** `Status.ConsumedEpoch/Sequence/Slot/Result/Cycle/TimeUs` latch the outcome of every consumed event, accepted or not. 0.1's `LastResult` reset every cycle and was rarely observable at 10 Hz. Result codes are constants in `GVL_CB` and listed in `adapter-profile.json`.
- **Separate counters.** `InvalidCount` is split into `InvalidSlotCount`, `IncompleteSlotCount` and `MetadataMismatchCount`, matching the M2 diagnostic classes. New: `RepresentationRejectedCount`, `NotSimulatedCount`, `BlockedRequestCount`, `IdleClearCount`, `SimulationEntryCount`, `ReinitializeCount`.
- **Representation enforcement.** `ST_CB_Config` declares a native width per signed (8/16/32) and unsigned (1–32) channel and a non-finite policy per REAL channel. Commits with values outside a declared width, NaN or infinity on a finite-only channel, or nonzero data in unconfigured channels are rejected with `RejectBank`/`RejectIndex`. Values are never clamped or narrowed. A missing width makes the configuration invalid.
- **Heartbeat.** Simulation entry no longer clears link freshness; freshness is about the link, not the mode. After initialization a heartbeat must change before the link counts as fresh.
- **Resets.** Session reset and Simulation Reset are processed in hardware mode too, so their counters always reflect the request. Both are refused, visibly, while the domain is blocked.
- **Reinitialize.** New local `Reinitialize` input (application authority, not workstation-writable) re-pins configuration and boot identity, clears `ReconfigureRequired`, zeros the simulated image and consumes staged data. 0.1 had no recovery short of a new instance.
- **Blocked domain.** Requests consumed while the configuration is invalid or `ReconfigureRequired` is latched report `CONFIG_INVALID` or `RECONFIGURE_REQUIRED`. Exit Simulation is always honoured.
- Request words are read once per cycle so every decision uses the same values.

### Blocks and types

- `FB_CB_DO`: new `SuppressedValues` (default FALSE, so 0.1 behaviour is unchanged), `Applied` mask and `SuppressedCount`.
- `FB_CB_AO`: suppression masks are now one `ST_CB_NumericMask` input (breaking); new `Applied` mask and `SuppressedCount`.
- New `FB_CB_Observation` and `ST_CB_ObservationFrame`: a passive, bounded per-cycle frame of raw hardware inputs, selected inputs, authentic commands, physical sink, suppression masks, observation taps, identity, timing, quality and source gap counters. No simulation authority is needed and nothing is written back.
- New `F_CB_CheckImage` (public), `GVL_CB` constants, `U_CB_Real32`, `ST_CB_NumericMask`, `ST_CB_ImageMask`.
- Unchanged: `ST_CB_Numeric`, `ST_CB_Image`, `ST_CB_Slot`, `ST_CB_Request`, `FB_CB_DI`, `FB_CB_AI`, `FB_CB_OutputCapture`.

### Mapping, build and storage

- Machine maps (`mappings/*.map.json`) and `scripts/cb-map.mjs` generate typed wrappers, configuration, wire fingerprints (`SchemaId`, `TapSchemaId`) and a manifest. Two maps: the M8 conveyor signal set and a non-conveyor tank loop with PID observation taps.
- The builder records the Git commit and dirty paths, refuses to rebuild a promoted version, checks compiler warnings as failures and reopens every saved source.
- Native File-Based Storage 1.0.0.0 is available. Each build converts a copy of the core to `.fbslib`, reopens it with `fbs.open`, compares every object with Git, compiles it, proves the cache-free Git subset compiles, and rebuilds both consumers against the FBS-built library.
- Consumers: a consumer library (`CBX`) and a consumer application from the frozen M8 project template, each built against both the binary-built and the FBS-built core.
- The conformance harness grew from 14 to 46 cases. It is compiled, not executed.

## 0.1.0.0 (prototype), 2026-11-01

First offline build: raw-bank image/config/request/status types, DI/AI selectors, DO/AO taps with suppression, per-domain session with coherent two-slot commits, output capture, a 14-case harness and two consumers. Preserved unchanged in `builds/prototype-0.1.0.0/`; its sources are at commit `3d86189`.
