# W4 live readiness

The next product proof is a real Muse-directed PLC campaign: a normal experiment, a declared fault experiment, and a new investigation selected after observing the PLC, ending in an evidence-backed report. Kiro's submission-claims audit is not a prerequisite for this work.

This lane takes ownership of the commissioning follow-up. Source branch: `codex/w4-live-readiness`; final source pin **`e3469af897949721a3fe02340e34d8dd70e0071c`**. It merges final application integration `80a8019` and commissioning `7c01a3d`. The original `c77553c` launch checkout and all other worktrees remain unchanged.

## Changes

- Recovery corroborates a saved child's PID and nonce with the hash-bound parent journal's terminal exit. A PID alone does not override proof that that exact fork exited. An IPC disconnect without a terminal exit does not suffice. Existing ownership, current PLC state, evidence-hash and reconciliation-authorization checks remain.
- The harness now refuses qualification for missing evidence, observation gaps over 300 ms, child faults, missing child commits during the parent stall, late lease expiry, or empty/changing held images. Stall measurements include both edges, preventing a few nearby samples from hiding a long silent interval.
- 10 Hz remains a requested ceiling, not a promised achieved rate; the 300 ms observation bound is unchanged.
- The commissioning tests are registered in the main test command. Negative cases exercise missing/slow evidence and PID reuse/foreign nonce/disconnect handling.

## Verification so far

- Source typecheck passed.
- Commissioning proof: **11/11**, clean source and preserved boundary at implementation `322c35d`. `artifacts/w4-commissioning/offline-proof/2026-11-02T12-07-10-731Z/`.
- Combined application gate **passed at final source `e3469af`**: **189/189 runtime tests (including those 11 commissioning cases), 51/51 UI tests**, all typechecks, production build, preserved M10 browser, Wonder/preview/recorded browsers, page/narrow-layout capture regressions, all three recorded H2 audits, and network-disabled real-response replay/process integration. Proof: `artifacts/w4-convergence/2026-11-02T12-12-58-705Z/`; nested union: `artifacts/m10-convergence/2026-11-02T12-13-00-054Z/`. All source/frozen-file hashes and the shared account were unchanged.
- The first combined attempt (`12-09-09-624Z`) hit the old three-minute serial-suite timeout. It is retained as failed. Only the offline suite timeout was extended; live deadlines are unchanged.
- Static preflight: frozen project matches, shared runtime lock absent, no recorded active legacy session, native OPC module present, credentials not loaded. No current PLC state is inferred from this filesystem-only preflight.
- No PLC, model or recovery operation has been performed in this lane.

## Next sequence

1. **Done:** combined offline gate, manifest and immutable launch checkout. `.worktrees/w4-commissioning-pin` is detached at `e3469af`, with a clean tracked tree. `artifacts/w4-readiness/e3469af/pin-validation.json` verifies all 253 source files, 386 frozen files and 20 built UI files against the tested bytes. The package's LF representation was matched to the proof and its unchanged Git stat entry refreshed. Manifest SHA-256: `f866b8d7c9d4d7590b7752cd52e47f5ab422f89d8e96b0041d460e6ea20e0343`.
2. Enter the PLC credential at the masked local prompt and inspect the current DUT read-only.
3. Commission with the actual live HMI capture/portal running: normal sort, six decision leases including a 1.5 s parent stall, overload fault/Reset, clean shutdown and final read-only inspection. These are scripted zero-model commissioning steps.
4. Before paid W4, prepare the equivalent held-state export for an actual paid campaign. Existing recovery currently accepts commissioning run records only. Review the exact model payload and a new aggregate spending cap; W3's previous $4 conservative allowance is exhausted.
5. Run the actual Wonder campaign and capture its evidence/report. Autonomous HMI operation remains a separate subsequent checkpoint; direct sequenced controller commands do not prove HMI operation.

The reusable CODESYS library remains independently built and compiled-only; it is not swapped into the running demo by this lane.

## Immediate action: read-only PLC inspection

Run from any PowerShell directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\steve\Documents\ControlsBenchMuse\.worktrees\w4-live-readiness\artifacts\w4-readiness\e3469af\inspect-plc.ps1"
```

The prepared launcher checks the manifest/proof hashes, the pinned HEAD and every tested source/frozen file, then prompts locally for the masked PLC password. It uses the exact tested source and skips repeating the already completed offline suite. The commissioning script still enforces the entry/preflight/ownership/read-only gates. This command makes **no writes**, performs no recovery and makes no model request. It records the current PLC baseline under `.worktrees/w4-commissioning-pin/artifacts/w4-commissioning/`.

The launcher was syntax-checked and the manifest and owner entry verified offline. It has not been executed against a PLC. Share the inspection result, never the password, before the live commissioning run.
