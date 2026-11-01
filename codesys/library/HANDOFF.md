# Reusable library handoff — 2026-11-01

User authorized building reusable libraries now while leaving the proven running demo in place. Work is isolated on `codex/plc-library`, based on `m10-base`. Claude retains ownership of live HMI process isolation and held-PLC recovery; this work does not contact that runtime or the active editing IDE.

Delivered `ControlsBench Core` prototype 0.1.0.0, namespace `CB`: public raw-image/config/request/status types, DI/AI selectors, DO/AO authentic-command taps with downstream suppression, coherent per-domain session, and post-application output capture. No conveyor globals or controller logic live in the core. Two consumers use Library Manager references, not copied core code. Saved core text is reopened and checked against source.

User clarification: these same hooks are the foundation for later passive streaming/recording, PID tuning, filtering/signal processing and other engineering tools during normal hardware passthrough. Version-control the blocks and common specification; track API/protocol/map/recording compatibility and explicitly flag deferred capabilities. `docs/plc-adapter-standard.md`, profile metadata 0.1.1 and `docs/library-build-lane-prompt.md` now capture this accepted direction. No acquisition pipeline or analysis service is claimed implemented; no FB source or compiled binary was changed for this clarification.

The preserved `builds/prototype-0.1.0.0/result.json` records five compiler checkpoints, original demo hashes before/after, source/artifact hashes and no PLC/deployment. Its consumer harness has fourteen cases and two separately configured session instances. It is compiled **only**; neither instance isolation nor other runtime behavior is claimed tested. Start with `README.md` and `node codesys/library/scripts/audit-build.mjs`.

Remaining gates:

1. Review the prototype API/profile against `docs/plc-adapter-standard.md`. It is not a drop-in replacement for M8 symbols/wire layout.
2. Extend and execute conformance on a separate target: duplicate/stale/epoch/boot/clock transitions, raw boundaries, mixed-bank coherence, output capture/suppression, reset semantics, multiple task periods and independent domains.
3. Generate machine-specific mapping and a new connector manifest from spec/raw I/O; supply platform boot/time services. The fixed banks do not silently narrow 64-bit channels or arbitrary device structs.
4. Schedule a deliberate new-identity consumer deployment and repeat M2/M5/M10 plus task-cost checks before replacing the live interceptor.
5. Native File-Based Storage is desired but the probed CODESYS profile lacks its API/add-on. Follow `FILE-BASED-STORAGE.md`; coordinate add-on installation/restart with the active IDE owner, pilot on this new library, then convert a separate demo copy. Exported ST is not native FBS.

No runtime password was requested, read or persisted. Only the unreleased ControlsBench package is installed into an explicitly scoped development library repository. The current IDE project may have unsaved changes; do not close or convert it as part of this lane. No new product licensing/publication decision was made.
