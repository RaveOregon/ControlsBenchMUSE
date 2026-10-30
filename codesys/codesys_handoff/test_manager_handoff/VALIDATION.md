# Validation results — Test Manager pilot

What was tested, how, and what was confirmed working. Run on
**2026-05-22**, CODESYS V3.5 SP22.20, Win V3 SoftPLC, Test Manager
(PDE feature).

## Setup

- The CODESYS sandbox project (`Untitled1.project`) containing the
  `StopLight` POU — a 4-state state machine (Red → RedYellow → Green
  → Yellow) with timers per state.
- Test script `examples/StopLightTest (1.0).tsd.xml` — 7 test cases
  (Prepare, InitialState, 4 transitions, Cleanup).

## What was verified

### 1. Script import

- ✅ `.tsd.xml` files import cleanly via Test Manager → right-click →
  Import Test Script.
- ✅ Imported scripts appear in the repository as `<Name> <Version>`.

### 2. End-to-end run

After several iterations (captured in the troubleshooting doc), the
final run produced **7 of 7 test cases passed**:

```
Prepare ............................. ✅ Succeeded
InitialState ........................ ✅ Succeeded
Red → RedYellow (within 6s) ......... ✅ Succeeded
RedYellow → Green (within 4s) ....... ✅ Succeeded
Green → Yellow (within 6s) .......... ✅ Succeeded
Yellow → Red (cycle complete, 3s) ... ✅ Succeeded
Cleanup ............................. ✅ Succeeded
```

Total runtime ~100 seconds (project load is the bulk; the actual state
cycle is 15 seconds).

### 3. Lessons captured during validation

Five real issues hit, all now documented:

1. **Variable path format**: `Device.Application.<POU>.<var>` is the
   only form that works. Other intuitive forms (`Application.<...>`,
   `Device.<...>`, `Device.Plc Logic.Application.<...>`, just
   `<POU>.<var>`) all fail with distinct but unhelpful errors.

2. **`SetCommunicationPath` requires `LoginUsername` and
   `LoginPassword` entries**, even when `UseCredentials=False`. Empty
   strings are accepted; missing entries fail with
   `MissingTestActionConfigurationEntryException`.

3. **Strict-typed enum compares need qualified literals**. CompareValue
   `0` against `qState : E_LightState` fails with "current value is
   E_LightState.Red, compare value is 0". Use `E_LightState.Red`.

4. **`LoadProject` can wipe in-memory unsaved work**. The first run
   discarded ~1 hour of POU edits. Always save the project (`Ctrl+S`)
   before running any Test Manager script.

5. **Sequential lamp checks vs short state durations create a race**.
   Initial test failed because RedYellow lasted only 1s; by the time
   the second sequential check ran, the state had transitioned. Fix:
   lengthened RedYellow to 3s in the StopLight POU. Also recorded the
   pattern in troubleshooting: don't over-verify within short states.

## Verified test action vocabulary

The following actions were exercised and behave as documented in
`docs/03-actions-reference.md`:

- `TestManager.Projects.CloseProject` ✅
- `TestManager.Projects.LoadProject` ✅
- `TestManager.Projects.SetActiveApplication` ✅
- `TestManager.Devices.SetCommunicationPath` ✅
- `TestManager.Online.Login` (with `ApplicationState=Start`) ✅
- `TestManager.Online.Logout` ✅
- `TestManager.Monitoring.CompareVariable` (BOOL, ENUM) ✅
- The `IgnoreResults=True` flag on `<Settings>` for diagnostic
  probe-style test cases ✅

Not yet exercised in this pilot (would be next-iteration work):

- `WriteVariable` — read-only test against an autorunning state machine.
- `Delay` — not needed since `CompareTimeout` polls.
- `ExecuteScript` — not needed for a state-machine test of this size.
- `InstallLibrary`, `UpdateDevice`, `ResetOrigin` — not needed.
- `StartTimer` / `StopTimer` — not needed.
- The `FileIO`, `Testreport`, `Objects`, `Libraries` driver categories.

## Reproducibility

To re-run this validation:

1. Open the demo project in CODESYS.
2. Save (`Ctrl+S`) — critical.
3. Tools → Test Manager → Import → pick
   `examples/StopLightTest (1.0).tsd.xml`.
4. Right-click → Run.
5. Expected: 7/7 succeed in ~100 seconds.
6. Optional: Right-click run → Save Report As HTML for diff with prior
   runs.

## Conclusion

**Phase 1 of Test Manager pilot is validated.** The pattern works,
the gotchas are documented, the worked example passes. Future tests
(other POUs, other projects) can be built on the patterns in
`docs/05-patterns.md` with high confidence the boilerplate is correct.

Phase 2 ideas (deferred):

- Build a test against an IBIS-style production project (longer setup,
  more variables to track).
- Exercise the test-table pattern (`Examples.CounterTestTable`) — data-
  driven testing where each row is one test case.
- Wire Test Manager runs into a CI pipeline using its command-line
  invocation (`CODESYS.exe --runscript`).
- Combine Test Manager (orchestration) with the IEC Unit Test library
  (in-application unit tests) for full coverage.
