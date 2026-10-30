# 01 — Getting started

Your first Test Manager test, end to end. Estimated time: 10 minutes
once you've read this once.

## Prerequisites

- CODESYS V3.5 SP recent with **Professional Developer Edition**
  installed (Test Manager is a PDE feature).
- A project with at least one POU you want to test. We'll use the
  StopLight from the demo as the example, but any POU works.

## Step 1: Open Test Manager

In CODESYS: **Tools → Test Manager**.

The Test Manager pane opens, usually at the bottom or as a tab. On the
left you'll see a script tree under "Test Repository" with whatever's
already in there (CODESYS ships 4 example scripts).

## Step 2: Save your project before doing anything

⚠ **This is the single most important step.** Test Manager's
`LoadProject` action will reload the project from disk; if you have
unsaved changes, they're discarded silently.

`Ctrl+S` in CODESYS now.

## Step 3: Import the example test script

From this handoff folder:

1. Right-click anywhere in the Test Manager script tree.
2. Pick **Import Test Script**.
3. Navigate to `examples/StopLightTest (1.0).tsd.xml` and open.
4. The script appears as `StopLightTest 1.0` in the tree.

## Step 4: Run

Right-click `StopLightTest 1.0` → **Run**.

A test progress window opens. You'll see each test case execute
sequentially: Prepare (load project, login, start) → InitialState →
Red→RedYellow → RedYellow→Green → Green→Yellow → Yellow→Red →
Cleanup.

Total runtime ~60 seconds. The bulk is project loading; the actual
state-machine cycle is 13 seconds.

## Step 5: View the report

When the run finishes, a report tab shows pass/fail per test case.

You can also export the report: right-click the run result → **Save
Report As HTML**. Useful for sharing with non-CODESYS users or for
checking in to git.

## What the script actually does

```
1. Prepare:
   - CloseProject (any open project)
   - LoadProject (Untitled1.project)
   - SetCommunicationPath (local PLC, anonymous)
   - SetActiveApplication (Device.Plc Logic.Application)
   - Login + Start (auto-downloads, starts the PLC)

2. Initial state:
   - Assert StopLight.qState = E_LightState.Red within 2s
   - Assert qRed = TRUE, qYellow = FALSE, qGreen = FALSE

3. Red → RedYellow (wait up to 6s for the timer):
   - Assert qState = E_LightState.RedYellow
   - Assert qRed and qYellow both TRUE

4. RedYellow → Green (within 2s):
   - Assert qState = E_LightState.Green
   - Assert qGreen TRUE, qRed FALSE

5. Green → Yellow (within 6s):
   - Assert qState = E_LightState.Yellow
   - Assert qYellow TRUE, qGreen FALSE

6. Yellow → Red (cycle complete, within 3s):
   - Assert qState = E_LightState.Red
   - Assert qRed TRUE, qYellow FALSE

7. Cleanup:
   - Logout
```

Each `Assert` is a `CompareVariable` action. The `CompareTimeout`
controls how long to poll until the value matches — we use longer
timeouts (5–6s) for state transitions and shorter (~500ms) for value
sanity checks.

## Adapting it for your own POU

The minimum to change:

1. **Project path** — line near the top, `<Assign Variable="ProjectPath">`.
2. **Variable paths** — every `<Entry Name="CompareVariable">` should be
   `Device.Application.<YourPOU>.<yourVar>`.
3. **Compare values** — match the type of your variable (BOOL is
   `TRUE`/`FALSE`, strict enums are qualified literals like
   `E_MyEnum.SomeValue`, plain INTs are `42`, etc.).
4. **Timeouts** — set per-action based on how long your transitions
   actually take.

The Prepare and Cleanup sections work as-is for any project. Don't
modify them unless your project requires authenticated login (in which
case copy the `User` / `Pwd` setup from `reference/Examples.CounterTest`
which has the full auth pattern).

## What can go wrong (read this BEFORE running for the first time)

See `04-troubleshooting.md`. The common failures all have known fixes:

- Variable path wrong format → "Invalid Expression" or "application not found"
- Strict enum vs int compare value mismatch
- Project on disk is empty or stale
- Required config entry missing (`LoginUsername` etc.)

If the test fails, **export the HTML report** (Test Manager → right-click
the run → Save As HTML) and check the troubleshooting doc against the
exact error message.
