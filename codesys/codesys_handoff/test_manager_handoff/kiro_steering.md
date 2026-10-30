---
inclusion: manual
---

# Test Manager / Kiro steering

If you're an AI agent picking this folder up, here's what other agents
already paid for. Save the operator the iteration cost.

## What this folder is

A handoff bundle for the **CODESYS Test Manager** — the GUI test
orchestration tool bundled with PDE. Tests are XML files driving the
running PLC runtime via Monitor / Online interfaces; output is a
pass/fail HTML report.

**Not** to be confused with `Test Manager IEC Unit Test` (a separate
ST library). This is the GUI tool at `Tools → Test Manager`.

See `HANDOFF.md` and `docs/README.md` for the full picture.

## What you can do

The CODESYS MCP bridge does NOT have direct Test Manager support. You
can't:

- Import / export test scripts via MCP
- Run tests via MCP
- See test results via MCP

What you CAN do:

- Author `.tsd.xml` test scripts as files (regular file write tools).
- Read run reports the user exports (HTML files in the workspace).
- Author IronPython scripts that get embedded inside Test Manager
  `ExecuteScript` actions.
- Edit POUs in CODESYS via MCP that the tests then exercise.

## Working pattern

The proven loop:

1. **Operator saves the project** (`Ctrl+S` in CODESYS) — critical, see
   pitfalls below.
2. You write/update `.tsd.xml` in the workspace.
3. Operator imports it into Test Manager and runs it.
4. Operator exports the HTML report to the workspace.
5. You read the HTML, parse the failure (if any), update the script.
6. Repeat.

## Methodology for new projects

If you're picking up a new CODESYS project and need to deploy tests
to it: **read `docs/06-methodology.md` first**. It describes the
five-phase loop (recon → probe → author → run + read → iterate or
commit) using the MCP for project introspection and Test Manager for
runtime assertions. Skipping recon and probe wastes hours; doing
them costs ~15 minutes.

## Things already paid for (don't repeat)

| Symptom | Real cause | Fix |
|---|---|---|
| `Required configuration entry LoginUsername is missing` | Some entries are required even when unused | Add `<Entry Name="LoginUsername"></Entry>` and `<Entry Name="LoginPassword"></Entry>` to `SetCommunicationPath` even when `UseCredentials=False` |
| `Required configuration entry DelayTime is missing` | The `Delay` action's entry is `DelayTime`, not `Delay` | Use `<Entry Name="DelayTime">5000</Entry>` |
| `Invalid Expression: Device.Application.Foo.bar` | Wrong path format | Use `Device.Application.<POU>.<var>` exactly. NOT `Device.Plc Logic.Application....`, NOT `Application....`, NOT `Device....` |
| `The expected value is not equal. Current is E_MyEnum.X, compare value is 0` | Strict-typed enums need qualified literals, not ints | `<Entry Name="CompareValue">E_MyEnum.X</Entry>` not `0` |
| In-memory project work disappears after running a test | `LoadProject` discards unsaved changes | **Always have the operator save (`Ctrl+S`) before running anything that does `LoadProject`** |
| Test Manager hangs waiting for a value | `CompareTimeout` is the polling window — high values mean long waits | Use `CompareTimeout` ≤ 6000ms for state-transition waits; ≤ 500ms for sanity checks |
| `Skipped due to a previous error` on every action after the first failure | Default `IgnoreResults=False` short-circuits the test case | For diagnostic probes, set `IgnoreResults=True` on each action so they all run |
| Build error / load error refers to typo'd config keys | CODESYS config entries have typos baked in (`UpdateLibraryVerions`, `UpdateStorageFormate`) | Don't fix typos. Spell them as the schema expects |
| Login fails with "device does not match" | Project's device type ≠ the gateway's runtime | Have the operator do `Update Device` in CODESYS (project tree → right-click device). For Win V3 SoftPLC pick `CODESYS Control Win V3 x64`, not `Linux SL` or `RTE V3 x64`. Then save |
| Login fails with `unexpected messages have been received` (e.g. demo mode multi-core warning) | Runtime sent a blocking prompt that Login's pre-check caught | Set Login's `IgnoreResults=True`. The runtime actually does start; subsequent reads/writes work. The orange "ignored error" badge is acceptable. (`InstallMessageHandler`/`UninstallAndCheckMessageHandler` doesn't help because Login's own pre-check fires first) |
| Wait-for-state never matches even with high `CompareTimeout` | Project-internal state machine you're waiting on is gated on real hardware that isn't there | Don't crank timeout higher; **read the project's ST source** to find the gate. Retarget the assertion. See "Testing on offline copies" in `docs/06-methodology.md` |

## Variable path canonical form

```
Device.Application.<POU>.<var>
```

That's the answer. The intermediate `Plc Logic` node is implicit; do
not include it. Other forms produce different errors but all fail.

## Action vocabulary we've used

See `docs/03-actions-reference.md`. Briefly:

- **Setup**: `TestManager.Projects.{CloseProject,LoadProject,SetActiveApplication}`,
  `TestManager.Devices.SetCommunicationPath`, `TestManager.Online.Login`
- **Per-test**: `TestManager.Monitoring.{WriteVariable,CompareVariable}`,
  `TestManager.System.Delay`
- **Cleanup**: `TestManager.Online.Logout`
- **Escape hatch**: `TestManager.Scripting.ExecuteScript` (IronPython)

## Conventions for new tests

- File on disk: `MyTest (1.0).tsd.xml` — `.tsd.xml` extension matters
  for import.
- Always include a `Cleanup` test case with Logout.
- Always start with the boilerplate Prepare snippet from
  `docs/05-patterns.md`.
- For probe / diagnostic test cases, put each action in its own
  `<Action>` with `IgnoreResults=True` so they all run.
- Use script-level `<Assign Variable="ProjectPath">...</Assign>` for
  the project file path; reference as `{ProjectPath}` in the
  LoadProject configuration.

## When in doubt

Read `reference/Examples.CounterTest (5.0.0.0).tsd.xml`. It's the
ground truth from CODESYS itself. Each action in there has its full
configuration shape; copy verbatim when implementing the same verb.

The other reference files (ApplicationTest, CounterTestTable,
IecUnitTest) demonstrate different patterns: heavy ExecuteScript usage,
test tables (data-driven testing), embedded IEC unit tests via the
`Test Manager IEC Unit Test` library. Reach for those when you need
their flavor.

For a worked example of applying the methodology to a real production
project (Amazon CG IBIS workcell), see
`../test_scripts/IBIS_TEST_PLAN.md` — recon findings, probe results,
and project-specific quirks. Saves repeat iteration cost on similar
Amazon CG projects.

## When to stop iterating and tell the operator

After 3 attempts at a test that won't pass, stop and ask the operator
to:

- Open the variable in the CODESYS Watch List manually (Online → Watch
  → Watch 1) — confirms the variable path is real.
- Run the project's POU from the IDE's monitor view to confirm the
  state transitions actually happen at the timing the test expects.

Don't burn 10 attempts trying combinations of the same fix. The
real-world feedback loop (operator + IDE) is faster than blind iteration.
