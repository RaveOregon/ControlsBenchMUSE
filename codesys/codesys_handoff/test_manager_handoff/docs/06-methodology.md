# 06 — Methodology: deploying tests to a new project

How to use the **CODESYS MCP** + **Test Manager** together to deploy
appropriate, project-specific tests. The MCP gives an AI agent
read access to the project's structure (POUs, GVLs, libraries, device
tree). The Test Manager runs assertions against the live runtime.
Combined, they let an agent discover what's worth testing before
writing a single line of XML.

This doc is the playbook. Use it when you (or an agent) sit down with
a new CODESYS project and ask "what should I test?".

## The five-phase loop

```
┌────────────────────┐   ┌──────────────────┐   ┌────────────────┐
│ 1. RECON           │ → │ 2. PROBE         │ → │ 3. AUTHOR      │
│    (MCP read-only) │   │ (TM IgnoreResults│   │ (TM real test) │
└────────────────────┘   └──────────────────┘   └────────────────┘
                                                       │
                                                       ▼
                                ┌──────────────────────────────┐
                                │ 4. RUN + READ REPORT         │
                                └──────────────────────────────┘
                                                       │
                                                       ▼
                                ┌──────────────────────────────┐
                                │ 5. ITERATE or COMMIT         │
                                └──────────────────────────────┘
```

Each phase has a clear input and output. Skipping phases costs you
iterations.

## Phase 1: Recon

**Input:** a CODESYS project, MCP connected to the IDE.
**Output:** a list of "things worth testing" with their variable paths.

Use the MCP read tools — never write. The goal is to understand the
project's surface area without touching it.

### What to look for

In rough priority order:

1. **Device + application.** What runtime is this project for? `Win V3
   x64`? `Linux SL`? `RTE x64`? The Test Manager script's `Login`
   action will fail loud if the project's device doesn't match the
   gateway's runtime. Use `mcp_codesys_ide_browse_project_tree` with
   `rootPath=""` to see the device node name.
2. **Active application.** Most projects have one application
   (`Device.Plc Logic.Application`); some have more. Note the full path
   for `SetActiveApplication`.
3. **Top-level POUs.** Browse `Device.Plc Logic.Application` to see the
   main programs. These are usually the `Main`/`PLC_PRG`-style
   orchestrators. State machines and control logic often live here or
   in nested POUs.
4. **Global Variables Lists (GVLs).** Look for `GVL`, `GVL_*`. These are
   the project's public surface — what other code reads and writes.
   Tests should drive inputs and read outputs from GVLs.
5. **Feature flags / mode toggles.** Look for `GVL_FeatureFlags`,
   `GVL_Simulation`, anything with `Enabled` in the name. These let you
   put the project into a deterministic state for testing (sim mode is
   especially useful).
6. **Enums.** Find type definitions (`E_State`, `enum*`). State-machine
   tests use these as compare values; with `attribute 'strict'`, the
   compare value must be the qualified literal (`E_State.Foo`), not an
   integer.
7. **Libraries.** Use
   `mcp_codesys_ide_get_libraries_referenced_in_application`. Some
   projects depend on Amazon-internal libraries (`amznCGCore`,
   `AmznLogger`). If a GVL is library-scoped, it may need a namespace
   prefix in variable paths — but in practice we've seen the bare form
   works because the libraries expose names globally.
8. **Tasks.** Browse `Task Configuration`. `MainTask` usually runs the
   primary control POU. If the project has multiple tasks (e.g.
   `SimulationTask`, `VISU_TASK`, `ScadaOeeTask`), tests may need
   delays between writes for the right task to pick up the change.

### Useful MCP commands for recon

```
# Top-level structure
mcp_codesys_ide_browse_project_tree(rootPath="", maxItems=100)

# Drill into the application
mcp_codesys_ide_browse_project_tree(
  rootPath="Device.Plc Logic.Application",
  maxItems=200,
  listSubSignatures=False
)

# Inspect a GVL
mcp_codesys_ide_get_structured_text_content(
  path="Device.Plc Logic.Application.GVL.GVL_FeatureFlags"
)

# Inspect an enum or struct
mcp_codesys_ide_get_structured_text_content(
  path="Device.Plc Logic.Application.E_LightState"
)

# Find a global by name
mcp_codesys_ide_search_libraries_for_type(searchString="GVL_Simulation")

# Find references to a variable
mcp_codesys_ide_search_in_files_by_regex(
  pattern="GVL_Foo\\.someBool"
)

# Confirm what libraries are referenced
mcp_codesys_ide_get_libraries_referenced_in_application()
```

### Recon output

A short doc (or chat message) with:

- Device runtime: `<runtime>` (e.g. `CODESYS Control Win V3 x64`)
- Active application: `Device.Plc Logic.Application` (or other)
- Top-level POUs to test: `[POU1, POU2, ...]`
- Mode/feature flags worth toggling: `GVL_*.SomeFlag`
- Enum types in play: `E_State` with values `[Idle, Running, ...]`
- Open question: anything you couldn't determine from MCP alone

## Phase 2: Probe

**Input:** recon output.
**Output:** confirmed canonical variable paths and test fixtures
(things the test can rely on existing and being reachable).

Variable path forms are the silent killer. Wrong paths produce
"Invalid Expression" errors that look like the variable doesn't exist
when actually it's just the path format. Probe scripts settle this
question once.

### Probe template

The bundled `examples/PathProbe2 (1.0).tsd.xml` and
`examples/IbisPathProbe (1.0).tsd.xml` are starting points. Both:

1. Run the standard Prepare snippet (load, login, start, settle).
2. Have probe test cases where every action has `IgnoreResults=True`.
3. Try multiple path forms for each variable.
4. End with Cleanup (logout).

Authoring a probe takes ~5 minutes; running takes ~1 minute. The
output report shows green for paths that resolve and orange ("Ignored
error") for paths that don't, with the exception text telling you
which form is right.

### What to probe

1. **App-level GVLs.** Use `Device.Application.<GVL>.<var>`. Confirm
   reads work for at least 2–3 vars.
2. **Library-scoped GVLs (namespaced).** If the project uses a library
   that exposes a GVL (e.g. `GVL_Simulation` from `amznCGCore`), try
   both `Device.Application.GVL_Simulation.SimulationEnabled` and
   `Device.Application.amznCGCore.GVL_Simulation.SimulationEnabled` to
   see which the runtime resolves.
3. **POU-internal vars.** Use `Device.Application.<POU>.<var>`. POU
   internals (private vars, locals) usually work the same way.
4. **Enum compares.** Read a state variable with a strict enum;
   confirm the qualified literal works and the integer does not.
5. **Write capability.** Pick a benign flag (a feature flag, a sim
   mode bit) and write to it. Read back the value to confirm. Restore
   the original value at the end.

### Probe output

A confirmed table:

| What | Path form that works | Notes |
|---|---|---|
| App-level GVL var | `Device.Application.GVL_X.var` | |
| Library-scoped GVL var | `Device.Application.GVL_Y.var` | bare form, no namespace |
| POU-internal var | `Device.Application.POUName.localVar` | |
| Strict enum compare | `E_State.Idle` | `0` does not work |
| Sim mode toggle | `GVL_Simulation.SimulationEnabled` | needs sim task to settle, ~500ms |

This table feeds Phase 3.

## Phase 3: Author

**Input:** probe-confirmed paths + a list of behaviors worth testing.
**Output:** a `.tsd.xml` test script that asserts those behaviors.

### Choosing what to test (in order)

1. **Smoke** — the application loads, logs in, starts. (One test
   case, no real assertions.)
2. **Defaults** — confirm post-startup state matches design (initial
   GVL values, enum default state). Catches "the project compiles but
   doesn't initialize correctly" bugs.
3. **Mode transitions** — write a mode flag, verify the state machine
   reflects it. (Sim mode on/off, auto/manual mode, alarm
   acknowledgement.)
4. **State machine sequences** — drive the inputs that should make
   the machine transition through its states; assert each state in
   turn. Use `CompareTimeout` to wait for transitions.
5. **Error / edge cases** — drive bad inputs, assert the system
   rejects them or moves to a fault state.

A good first test for a new project covers **smoke + defaults +
one mode transition**. That gives you confidence the rig works
end-to-end before you write more.

### Modular design — one script per behavior, not per project

Don't make one giant `MyProjectTest.tsd.xml`. Break it up:

```
test_scripts/
├── MyProj_Smoke (1.0).tsd.xml          ← can the project come up at all?
├── MyProj_FeatureFlags (1.0).tsd.xml   ← are defaults correct?
├── MyProj_SimMode (1.0).tsd.xml        ← does sim toggle work?
├── MyProj_StateMachine_X (1.0).tsd.xml ← FB X: state transitions
├── MyProj_Alarms (1.0).tsd.xml         ← do alarm conditions raise?
└── MyProj_PerfBaseline (1.0).tsd.xml   ← are timings within budget?
```

Benefits:

- **Triage:** when something fails, you know which area without
  reading 200 lines of XML.
- **Skip what's irrelevant:** a project may not have an alarm system;
  drop that test, keep the rest.
- **Parallelism:** multiple authors can work on separate scripts
  without merge conflicts.
- **Reuse:** copying `MyProj_Smoke` to `OtherProj_Smoke` is a 5-line
  edit (project path + device name).

### Reuse the boilerplate

Each script's `Prepare` and `Cleanup` test cases are nearly identical
across projects. Copy from `docs/05-patterns.md` once, then change:

- `<Assign Variable="ProjectPath">` to point at the project
- `<Entry Name="DeviceName">` if your device isn't named `Device`
- `<Entry Name="GatewayName">` if not the default `Gateway-1`

The middle test cases (the actual test logic) are project-specific.

## Phase 4: Run + read report

**Input:** the script you authored.
**Output:** a pass/fail HTML report.

### Operator workflow

1. Save the project (`Ctrl+S`) — `LoadProject` discards unsaved
   changes.
2. Test Manager → Import → pick the script.
3. Right-click → Run.
4. After it finishes, right-click the result → Export → HTML →
   save to `test_scripts/`.

### What to look at first in the report

1. **Top-line summary.** "Total / Succeeded / Failed". Are all the
   green-bar cases really green?
2. **Prepare succeeded.** If Prepare failed (esp. Login), nothing
   else can pass. Fix Prepare first; the rest is unreliable.
3. **First red item.** The first failure usually cascades — once
   Login fails, every CompareVariable fails with "must be logged in".
   Fix the first thing red; the rest may fix itself.
4. **Compiler warnings table.** Test Manager reports up to 20 warnings
   from project compile. Most are noise (notation casing, complexity,
   unused vars). But look for real errors: missing libraries, broken
   references, syntax errors. Those will block runtime startup.

### Common failure patterns and where they live

See `docs/04-troubleshooting.md` for the symptom-to-fix table. The
top three:

| Symptom | Fix |
|---|---|
| Login + Start fails with "device does not match" | Project's device differs from the gateway's runtime. Fix the device in the project (`Update Device`) |
| `LoginUsername is missing` | Add empty `LoginUsername`/`LoginPassword` entries to `SetCommunicationPath` |
| `Required configuration entry DelayTime is missing` | The Delay action's entry is `DelayTime`, not `Delay` |

## Phase 5: Iterate or commit

**Input:** report.
**Output:** either a passing test (commit it) or an updated script
(go back to Phase 4).

### When to iterate

- Anything red. Fix the actions that failed.
- Cases that "passed" but did the wrong thing (compare value matched
  by accident — initial value happened to equal expected).
- Slow tests. If a Compare polled for the full timeout, dial it down.

### When to commit and move on

A test is "done" when:

- All cases green.
- Run time is reasonable for the scope (~10–60 seconds for a small
  test, 1–5 minutes for a state-machine sequence).
- Manually breaking the system causes the test to go red. (Spot-check
  this: change the expected value to something wrong, run, confirm it
  fails. Then revert.)
- The test name + descriptions are self-documenting. Someone reading
  the report should know what was being tested.

### Committing

The test script lives alongside the project (or in a separate
`test_scripts/` repo). Commit:

- The `.tsd.xml` file.
- A reference HTML report (so reviewers can see what passing looks
  like).
- A short README per script: "this tests X, expected runtime Y, run
  with project at version Z".

The HTML reports stay small (typically &lt; 50KB), so they are fine to
keep in git. Old reports help diagnose regressions ("this was passing
in v1.4, broke in v1.5").

## Project-specific deployment plan template

Use this when picking up a new project:

```markdown
# <ProjectName> — Test Manager deployment plan

## Recon (Phase 1)
- Runtime: <runtime>
- Application path: Device.Plc Logic.Application
- Top-level POUs: [...]
- Feature flags / mode toggles: [...]
- Enums in play: [...]
- Libraries: [...]
- Open questions: [...]

## Probe (Phase 2)
Run: `<ProjectName>_Probe.tsd.xml`
Confirmed paths:
| Variable | Path |
|---|---|
| ... | ... |

## Test plan (Phase 3)
- [ ] <ProjectName>_Smoke
- [ ] <ProjectName>_Defaults
- [ ] <ProjectName>_SimMode
- [ ] <ProjectName>_<FeatureA>
- [ ] <ProjectName>_<FeatureB>
- [ ] <ProjectName>_PerfBaseline

## Status
- Probe: <green/amber/red> (<date>)
- Smoke: <not started / draft / passing>
- ...

## Notes
- <gotchas specific to this project>
```

This sits in the project's docs folder or in a `test_scripts/`
sibling directory. Each row gets ticked off as the corresponding
script lands and goes green.

## Anti-patterns

Things we've seen waste time:

### "I'll write the perfect test first"

Don't. Write a 3-line smoke test, get it green, then add cases. Each
new case is 5 minutes; getting the rig wrong wastes 30. The Test
Manager's iteration cost (~2 minutes per run including
project-load) means you want short feedback loops.

### "I'll skip the probe, I know the paths"

You don't. Even on a project you wrote yourself, if the device or
runtime version changed, paths and behavior shift. Probe takes 5
minutes. Wrong paths waste hours.

### "One mega-script tests everything"

Don't. When `LoadProject` takes 60s and Login takes 30s, you pay that
on every run. Six small scripts let you re-run only the one that
covers the area you're working on. Plus, when one fails, you know
where without reading 1000 lines of XML.

### "I'll fix the script when I see it pass"

It's already passing — accidentally. Manually break a thing the test
covers and confirm the test goes red. Otherwise you have a green test
that proves nothing.

### "Test Manager is broken; the assertion didn't catch the bug"

Read the assertion. The compare value might be wrong, the path might
be a sibling variable, or the timing might race. Test Manager is a
mechanical tool; failures are almost always your script.

## When to escape to IronPython

The XML action vocabulary covers ~80% of test patterns. The other 20%:

- Computing expected values from inputs (math, string manipulation).
- Reading and asserting against an array (Test Manager's
  CompareVariable handles single values, not array contents).
- Conditionally skipping cases based on an environment variable.
- Provisioning device-level state (user accounts, security settings).

For those, drop into `TestManager.Scripting Verb="ExecuteScript"`
with IronPython. The CounterTest sample shows the full pattern. See
`docs/05-patterns.md` "extract complex logic to IronPython".

## Testing on offline copies (transport vs. reaction)

When the project is an offline / dev copy with no real hardware or
network, project-internal state machines that wait on real I/O may
hang. We saw this on the IBIS project: writing
`GVL_Simulation.SimulationEnabled := TRUE` triggers the
`Simulation` POU's `configureDevices()` method, a 9-state machine
that calls `_ReconfigureEthernet(xExecute := TRUE)`. With no real
network, that state machine hangs at "waiting for `xDone` or
`xError`" forever, and the latch variable `_prevSimEnabled` never
flips.

That's not a path problem; it's a **hardware-dependence** problem.

**Distinguish two test modes:**

- **Transport tests** — write accepted by runtime, read returns the
  written value. Verifies variable reachability and Test Manager
  plumbing. **Reliable on any environment, including offline copies.**
- **Reaction tests** — the project's state machine advances after
  your write, an output flag changes, an alarm raises. **Requires
  the path to work without external hardware**, OR requires actual
  hardware/network present.

Heuristic: if your `CompareTimeout` polling never matches, **don't
crank the timeout up to 60s and hope**. Instead read the project's
ST code (via MCP `get_structured_text_content`) to find what's
supposed to drive the change. You'll usually find a hardware-gated
state machine.

When that's the case, retarget the assertion. Find a code path that
doesn't go through hardware:

- A boolean GVL flag the simulation logic reads directly per scan
- A counter that increments unconditionally
- A timestamp that updates every cycle

Test those instead.

## Worked example: IBIS project

We applied this methodology to a real Amazon production IBIS project
(offline test copy). The full filled-in plan is at
`test_scripts/IBIS_TEST_PLAN.md`. Highlights:

**Recon caught:**
- 40+ libraries including a custom `AmazonCodesysCGCoreLibrary`
  that owns `GVL_Simulation`
- `Main` POU has SFC content; MCP can't read or author it
- 22 unit machines indexed via `enumUnitMachine` (PackML state in
  `GVL_IBIS.state[1..22]`)

**Probe found:**
- `Device.Application.GVL_Simulation.SimulationEnabled` (bare path)
  AND `Device.Application.amznCGCore.GVL_Simulation.SimulationEnabled`
  (namespaced) BOTH work — library exposes names globally
- `Device.Application.GVL_FeatureFlags.*` and
  `Device.Application.GVL_SCADA.*` work
- Login fails with an "unexpected message" exception because the
  unlicensed Win V3 SoftPLC sends a demo-mode warning prompt;
  marking the Login action `IgnoreResults=True` lets us proceed
  (runtime actually does start)

**Probe tried and rejected:**
- `InstallMessageHandler` / `UninstallAndCheckMessageHandler` — the
  schema accepts an empty `Messages` entry, but Login's pre-check
  happens before the handler can intercept the demo prompt
- Watching `Simulation._prevSimEnabled` for `TRUE` after writing
  `SimulationEnabled := TRUE` — `configureDevices()` hangs on
  Ethernet reconfigure with no network present

**Phase 3 plan (Smoke / Defaults / SimMode / PackML state machine
per Unit Machine)** — open at the time of writing.

If you're debugging similar issues, read the IBIS plan first; it
saves the iteration cost.

## Summary

The methodology:

1. **Recon** with MCP — read-only, understand the project's surface.
2. **Probe** with a TM IgnoreResults script — confirm path forms work.
3. **Author** modular test scripts — one per behavior, not one mega.
4. **Run + read report** — fix the first red thing, iterate.
5. **Commit** when green and breaking it makes it red.

This loop keeps the agent honest: it can't make up paths or
assertions, because every step produces a report that confirms or
denies. And it scales — tests deploy project-by-project with
predictable effort (~30 min per script after the first).
