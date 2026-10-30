# 04 — Troubleshooting

Every error message we hit during the StopLight pilot, with the exact
fix. Read this when something goes wrong; the symptom-to-fix table at
the end is the fastest path.

## Diagnostic chain — when nothing works

If your first run fails entirely:

### 1. Did the prepare phase succeed?

Look at the first test case ("Prepare" or similar). All 5 setup
actions should pass:
- CloseProject
- LoadProject
- SetCommunicationPath
- SetActiveApplication
- Login + Start

If any of these fail, fix that before doing anything else. The compare/
write actions further down can't work if the PLC isn't logged in.

### 2. Is the PLC actually running?

After Login + Start, the PLC should be in RUN mode. If you can see the
CODESYS window, the bottom-right indicator should show RUN (green play
icon). If it's STOP, the `Login` action's `ApplicationState=Start`
didn't apply or got rejected.

Manual check: leave the test running, switch to the CODESYS window,
look at the device tree.

### 3. Are the variable paths correct?

Run the bundled `examples/PathProbe2 (1.0).tsd.xml` against your
project (after editing the `ProjectPath` Assign at the top). It tries
multiple path forms with `IgnoreResults=True` so they all run, and the
report shows which one resolved.

The canonical answer: `Device.Application.<POU>.<var>`.

## Symptom-to-fix table

| Error in the report | Fix |
|---|---|
| `Required configuration entry LoginUsername is missing` | Add `<Entry Name="LoginUsername"></Entry>` and `<Entry Name="LoginPassword"></Entry>` to the `SetCommunicationPath` action's `<Configuration>`, even if `UseCredentials=False` |
| `The application Application.<X> has not been found` | Variable path missing the `Device.` prefix. Use `Device.Application.<POU>.<var>` |
| `The application Device.<X> has not been found` | Variable path missing the `.Application.` after Device. Same fix |
| `The application Device.Plc Logic has not been found` | Don't include `Plc Logic` in variable paths. The address skips that node |
| `The expression <X> does not have the required format <resourcename>.<applicationname>.path` | Variable path needs at minimum 3 dotted parts: `Device.Application.something` |
| `Invalid Expression: <X>` | Could be path, could be that the variable doesn't exist in the running app. Verify by adding it to the CODESYS Watch List manually |
| `The expected value of <X> is not equal to the current value. The current value is E_MyEnum.Foo, the compare value is 0` | For strict-typed enums, `CompareValue` must be the qualified literal (`E_MyEnum.Foo`), not the underlying integer |
| `The application Device.Application must be logged in` | Login action didn't succeed earlier. Look at the prepare-phase results for the real error |
| Test runs but variable comparisons happen too early | Increase `CompareTimeout` for the first comparison after Login. Add a `TestManager.System Delay` action with 1000–2000 ms if the PLC needs a beat |
| **Sequential checks fail because state changed mid-test** | The `CompareTimeout` poll lands at *some* moment within a state's window. By the time the next sequential check runs, the state may have already transitioned. Especially likely for short-duration states (~1s or less). Fix: lengthen the state's duration in code, OR check fewer redundant invariants per case (rely on `qState` to characterize the state, don't separately re-verify what the lamps are) |
| Project changes silently disappear after running a test | **Save the project (`Ctrl+S`) before running tests with `LoadProject`.** That action discards in-memory unsaved changes |
| `MissingTestActionConfigurationEntryException` (any flavor) | The action requires a `<Entry Name="...">` you didn't include. Find a sample using the same verb in `reference/` and copy the missing keys |
| `Required configuration entry DelayTime is missing` | The `TestManager.System Verb="Delay"` action's entry name is **`DelayTime`**, not `Delay`. Use `<Entry Name="DelayTime">5000</Entry>` |
| Login fails with `unexpected messages have been received... [type: <Prompt>...]` (e.g. demo mode multi-core warning) | The runtime sent a blocking dialog Test Manager couldn't dismiss. Two options: **(a)** Wrap Login in `InstallMessageHandler` / `UninstallAndCheckMessageHandler` (Identifier + empty Messages + `OtherMessages=Acknowledge`). May not help if the prompt fires inside Login's own pre-check. **(b)** Mark the Login action `IgnoreResults=True` — the runtime starts despite the bookkeeping failure; subsequent reads and writes work. We've used (b) for IBIS demo mode |
| Test runs but report shows ALL test cases failed even though some clearly should have passed | The first action failed, and subsequent actions are skipped due to `IgnoreResults=False` (the default). Fix the first failure, the rest will pass on their own |

## Common subtle issues

### Issue: Two test runs in a row produce different results

**Cause**: Test Manager keeps the device logged in unless you have a
`Logout` action. The next run fails on Login because already logged in.

**Fix**: Always end your script with a `Cleanup` test case containing
`TestManager.Online Verb="Logout"`. The example StopLightTest does this.

### Issue: BOOL compares fail unexpectedly

**Cause**: Inconsistent boolean literals. `True`, `TRUE`, `true`, `1`
may all be accepted, but the runtime returns one canonical form.

**Fix**: Use uppercase `TRUE` / `FALSE` (matches CounterTest sample
convention). If a compare fails with "current value is True, compare
value is TRUE" the case-sensitivity is biting you — match exactly.

### Issue: Numeric tolerance for REAL/LREAL comparisons

**Cause**: Floating-point values rarely compare exactly equal.

**Fix**: Use `CompareType` other than `=`:
- `>=` and `<=` for ranges
- See if your CompareVariable supports `CompareEndRange` (the
  CounterTestTable sample uses it)

### Issue: Test Manager hangs on a CompareVariable

**Cause**: The variable path is valid but the value never changes to
match. With a long `CompareTimeout`, the test sits there polling.

**Fix**: Lower the timeout so failures fail fast. Use `Delay` actions
between meaningful state transitions to give the PLC time, not
multi-second `CompareTimeout` values.

### Issue: First run after CODESYS install asks about user management

**Cause**: The CODESYS Win V3 SoftPLC has device user management on by
default in some versions; the test can't login without an account.

**Fix**: Either follow the CounterTest pattern (PromptUser +
ExecuteScript that calls `online.set_credentials_for_initial_user`) or
disable user management at the device level (Device editor → Security
Settings sub-menu).

## Errors NOT actually errors

| Test Manager output | What it really means |
|---|---|
| `Cleanup - Succeeded` even when the rest failed | Cleanup is in its own test case; it runs regardless. Good news, not a bug |
| `Skipped due to a previous error` | Sequential actions in the same case are short-circuited by the first failure. Look at the first `Failed` for the real cause |
| `Ignored error` (orange) | An action with `IgnoreResults=True` failed. Intentional in probes; bug if you didn't expect it |

## When all else fails

1. Open `reference/Examples.CounterTest (5.0.0.0).tsd.xml` — that's the
   ground truth from CODESYS itself. Compare action by action with
   yours; copy entries verbatim.
2. The CODESYS docs sidebar has a page per action with its full
   Configuration tab. Read the page for the action that's failing.
3. The Test Manager UI has a debugger (right-click a script → Debug
   Test Script). You can step through actions one at a time and see
   per-action error messages live. Use this when the report alone isn't
   enough.

## Quick sanity script

When in doubt, run this minimal test against any project to verify
basic plumbing works:

```xml
<TestScript>
  <Information><Name>Smoke</Name><Version>1.0</Version></Information>
  <Sequence>
    <Assign Variable="ProjectPath">C:\path\to\my.project</Assign>

    <TestCase>
      <Information><Title>Smoke</Title></Information>
      <Actions>
        <!-- (full set of standard prepare actions, copied from StopLightTest) -->
        <!-- (one CompareVariable against a known variable, with IgnoreResults=True) -->
        <!-- Logout -->
      </Actions>
    </TestCase>
  </Sequence>
</TestScript>
```

If this passes, your prepare/login plumbing is correct and any failures
in your real test are about the variables or values, not the
infrastructure.
