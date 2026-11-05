# Reusable library handoff — 2026-11-01

Lane `codex/plc-library`, worktree `.worktrees/plc-library`, based on `m10-base`. Offline only: no PLC login, download, online change, recovery or live write; no credential handling. The running demo, the frozen controller project, the live connector/map, the HMI and the Wonder lanes are unchanged and do not use this library. No library swap is needed for W4.

## State

`ControlsBench Core` **0.2.0.0** (prototype) replaces the 0.1.0.0 prototype as the current version; `builds/prototype-0.1.0.0/` is preserved and re-audited. Start with `README.md`, then `CAPABILITIES.md`, `VERSIONING.md`, `CHANGELOG.md` and `FILE-BASED-STORAGE.md`.

- Core sources in `source/` (19 objects), consumer harness (46 cases), two generated machine maps (M8 conveyor signal set, non-conveyor tank loop with PID observation taps) and a two-domain consumer application program.
- The promoted build `builds/prototype-0.2.0.0/` holds the binary and native File-Based Storage forms of the core, compiled libraries from both, and the consumer library and application built against each. `result.json` binds them to a clean source commit.
- `node codesys/library/scripts/audit-build.mjs` re-verifies every build against Git, the current tree against the latest build, the profile against the PLC constants, the maps against their generated code, and the capability matrix against its evidence.
- Native File-Based Storage 1.0.0.0 is available; the library pilot passed on a copy (`FILE-BASED-STORAGE.md`).

Everything PLC-side is **compiled only**. The harness has not been executed. Acquisition, recording and analysis are extension points and gates, not features.

## Next gates (none started)

1. **G-RT-1**: execute the harness on a separate CODESYS test target under explicit authorization. Not the live demo controller.
2. **G-RT-2**: measure task cost against a disconnected baseline.
3. **G-ACQ-1**: a guarded frame reader over the real transport reporting achieved rate, decimation and gaps.
4. **G-DEP-1**: a new-identity consumer generated from the conveyor map, with a new connector manifest, replaces the integrated interceptor on a scheduled deployment, then M2/M5/M10-class regressions and task cost. Until then the frozen project and its hash guards stay as they are.
5. **G-FBS-2**: edit the next version natively in a copy of the promoted `.fbslib`.
6. G-ACQ-2, G-ACQ-3, G-REC-1, G-TOOL-1, G-VEN-1 and G-REL-1 as listed in `CAPABILITIES.md`.

## Notes for the integrator

- The development repository `repository/` (ignored) holds installed 0.1.0.0 and 0.2.0.0 for local consumer builds only. Only the unreleased ControlsBench package is installed there; no system or customer library is touched.
- CODESYS reports "Application Composer: No valid license is available" at startup. It is a tool warning unrelated to the compile results; the compiler summaries report zero errors and zero warnings.
- The user's active CODESYS IDE was never attached to, closed or restarted. Each build runs in its own hidden process.
- No licence or publication decision was made.
