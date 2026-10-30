---
inclusion: always
---

# Deployment methodology — recon → probe → author → run → iterate

How to deploy CODESYS tests to a project you've never seen, using the
MCP for read-only project intelligence and Test Manager for runtime
assertions.

## The five-phase loop

```
┌────────────────────┐   ┌──────────────────┐   ┌────────────────┐
│ 1. RECON           │ → │ 2. PROBE         │ → │ 3. AUTHOR      │
│  (MCP read-only)   │   │ (TM IgnoreResults│   │ (TM real test) │
└────────────────────┘   └──────────────────┘   └────────────────┘
                                                       │
                                ┌──────────────────────┘
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

## Phase 1: Recon (MCP read-only)

**Input:** project open in CODESYS, MCP connected.
**Output:** a list of "things worth testing" with their paths.

What to collect, in priority order:

1. **Device runtime** — match this against the gateway. Mismatches
   between project device (Linux SL / RTE / Win V3) and gateway
   runtime fail Login loud.
2. **Active application path** — usually `Device.Plc Logic.Application`.
3. **Top-level POUs** — main programs, state machines.
4. **Global Variables Lists (GVLs)** — the project's public surface.
   Tests drive inputs and read outputs from GVLs.
5. **Feature flags / mode toggles** — `GVL_FeatureFlags`,
   `GVL_Simulation`, anything `*Enabled`. These let you put the
   project into a deterministic state.
6. **Enums** — state machine state types. Note `attribute 'strict'`.
7. **Libraries** — list of references + namespaces.
8. **Tasks** — to know which task runs your test target.

MCP commands for recon:

```
mcp_codesys_ide_browse_project_tree(rootPath="", maxItems=100)
mcp_codesys_ide_browse_project_tree(rootPath="Device.Plc Logic.Application", maxItems=200)
mcp_codesys_ide_get_libraries_referenced_in_application()
mcp_codesys_ide_get_structured_text_content(path="Device.Plc Logic.Application.GVL.GVL_FeatureFlags")
mcp_codesys_ide_search_libraries_for_type(searchString="GVL_Simulation")
mcp_codesys_ide_search_in_files_by_regex(pattern="GVL_X\\.someVar")
```

## Phase 2: Probe (Test Manager with IgnoreResults)

**Input:** recon output.
**Output:** confirmed canonical paths for every variable the test
will touch.

A probe is a Test Manager script where every assertion has
`IgnoreResults=True`, so all of them run regardless of which fail.
The report shows green for paths that resolved and orange ("Ignored
error") for paths that didn't, with exception text saying why.

Probe template:

```xml
<TestScript>
  <Information><Name>MyProj_Probe</Name><Version>1.0</Version></Information>
  <Sequence>
    <Assign Variable="ProjectPath">C:\path\to\project.project</Assign>

    <TestCase definesScope="False">
      <Information><Title>Prepare</Title></Information>
      <Actions>
        <!-- standard prepare: CloseProject, LoadProject, SetCommunicationPath, SetActiveApplication, Login -->
      </Actions>
    </TestCase>

    <TestCase definesScope="False">
      <Information><Title>Probe paths</Title></Information>
      <Actions>
        <Action>
          <Information><Title>A: bare GVL form</Title></Information>
          <Settings>
            <Entry Name="Condition" />
            <Entry Name="ExecutionDelay">0</Entry>
            <Entry Name="ForceEvaluation">False</Entry>
            <Entry Name="IgnoreResults">True</Entry>     <!-- key -->
            <Entry Name="ResultVariable" />
            <Entry Name="RetryOnError">0|0</Entry>
          </Settings>
          <Command TestRunner="TestManager.Monitoring" Verb="CompareVariable" />
          <Configuration>
            <Entry Name="CompareTimeout">1000</Entry>
            <Entry Name="CompareType">=</Entry>
            <Entry Name="CompareValue">TRUE</Entry>
            <Entry Name="CompareVariable">Device.Application.GVL_X.someFlag</Entry>
          </Configuration>
        </Action>
        <Action>
          <Information><Title>B: namespaced form</Title></Information>
          <Settings><!-- same Settings, IgnoreResults=True --></Settings>
          <Command TestRunner="TestManager.Monitoring" Verb="CompareVariable" />
          <Configuration>
            <Entry Name="CompareTimeout">1000</Entry>
            <Entry Name="CompareType">=</Entry>
            <Entry Name="CompareValue">TRUE</Entry>
            <Entry Name="CompareVariable">Device.Application.namespace.GVL_X.someFlag</Entry>
          </Configuration>
        </Action>
      </Actions>
    </TestCase>

    <TestCase definesScope="False">
      <Information><Title>Cleanup</Title></Information>
      <Actions>
        <!-- Logout -->
      </Actions>
    </TestCase>
  </Sequence>
</TestScript>
```

Authoring takes ~5 min, running takes ~1 min. After the probe, you
have a confirmed table:

| What | Path that worked |
|---|---|
| App-level GVL var | `Device.Application.GVL_X.var` |
| Library-scoped GVL var | `Device.Application.GVL_Y.var` (bare) |
| POU-internal var | `Device.Application.POU.localVar` |
| Strict enum compare | `E_State.Idle` |

This feeds Phase 3.

## Phase 3: Author (modular Test Manager scripts)

**Input:** probe-confirmed paths + behaviors worth testing.
**Output:** one or more `.tsd.xml` test scripts.

### Test selection in priority order

1. **Smoke** — the app loads, logs in, starts. (No real assertions.)
2. **Defaults** — post-startup state matches design.
3. **Mode transitions** — sim toggle, auto/manual mode, alarm ack.
4. **State machine sequences** — drive inputs, assert state transitions.
5. **Error / edge cases** — bad inputs, fault states.

A good first deliverable is **smoke + defaults + one mode transition**.

### Modular: one script per behavior, NOT one mega

```
test_scripts/
├── MyProj_Smoke (1.0).tsd.xml          ← does it come up at all?
├── MyProj_Defaults (1.0).tsd.xml       ← are defaults correct?
├── MyProj_SimMode (1.0).tsd.xml        ← does sim toggle work?
├── MyProj_StateMachineX (1.0).tsd.xml  ← FB X transitions
├── MyProj_Alarms (1.0).tsd.xml         ← do alarms raise?
└── MyProj_PerfBaseline (1.0).tsd.xml   ← timings within budget
```

Why modular:

- **Triage** — failure tells you the area without reading 200 lines
- **Skip irrelevant** — drop tests that don't apply, keep the rest
- **Parallelism** — multiple authors in separate scripts
- **Reuse** — copying `_Smoke` to another project is a 5-line edit

## Phase 4: Run + read report

Operator workflow:

1. Save the project (`Ctrl+S`)
2. Test Manager → Import → pick the script
3. Right-click → Run
4. Right-click result → Export → HTML → save to `test_scripts/`

Agent reads the HTML and parses pass/fail.

What to look at first:

1. **Top-line summary**: total / succeeded / failed
2. **Prepare succeeded?** If not, fix that first; everything else
   is unreliable
3. **First red item** — failures cascade; fix the first
4. **Compiler warnings table** — most are noise (notation, complexity);
   look for missing libraries / broken refs

## Phase 5: Iterate or commit

Commit when:

- All cases green
- Run time reasonable (~30s smoke, 1–5 min state machine)
- Manually breaking the system makes the test go red (spot-check this)
- Test names + descriptions self-document what was tested

## Anti-patterns we paid for

### "I'll write the perfect test first"

Don't. Write a 3-line smoke, get green, then add. Iteration cost is
~2 min/run including project-load.

### "I'll skip the probe, I know the paths"

You don't. Even on familiar projects, device/runtime drift breaks
paths. Probe takes 5 min; wrong paths waste hours.

### "One mega-script tests everything"

Don't. LoadProject is 60s, Login is 30s. Six small scripts let you
re-run only the affected one.

### "I'll fix the script when I see it pass"

It's already passing — accidentally. Manually break a thing the test
covers; confirm it goes red. Otherwise you have a useless test.

### "Test Manager is broken; the assertion didn't catch the bug"

Read the assertion. The compare value, path, or timing is wrong.
Test Manager is mechanical; failures are nearly always your script.

## Testing on offline copies

When the project is an offline test copy (no real hardware/network),
project-internal state machines that wait on real I/O will hang. We've
seen `configureDevices()`-style methods stuck at "waiting for
EtherNet/IP reconfigure done" forever because there's no network.

**Implication for tests:** distinguish between testing the **transport**
(write accepted, read returns the value) and testing the **application's
reaction** (state machine advances, output flags change). Transport
tests are reliable on offline copies. Reaction tests need either real
hardware or a project where the reaction isn't gated on hardware that
isn't there.

A useful heuristic: if your `CompareTimeout` polling poll never
matches, **don't crank the timeout up to 60 seconds and hope** — read
the project code to figure out *what's supposed to drive the change*.
You'll almost always find a hardware-gated state machine in the way.

## Project-specific deployment plan template

Copy this per-project:

```markdown
# <ProjectName> — Test Manager deployment

## Recon
- Runtime: <e.g. CODESYS Control Win V3 x64>
- Application: Device.Plc Logic.Application
- Top POUs: <...>
- Mode flags: <...>
- Enums: <...>
- Libraries: <...>

## Probe
Run: <ProjectName>_Probe.tsd.xml
| Variable | Path that works |
|---|---|
| ... | ... |

## Tests planned
- [ ] Smoke
- [ ] Defaults
- [ ] SimMode
- [ ] <FeatureA>
- [ ] PerfBaseline

## Project-specific notes
<gotchas, deviations>
```

## When to escape to IronPython

Most tests fit the XML action vocabulary. Drop to IronPython
(`TestManager.Scripting Verb="ExecuteScript"`) for:

- Computing expected values from inputs (math, string ops)
- Asserting array contents
- Conditional cases
- Provisioning device state (user accounts, security settings)

CODESYS-shipped CounterTest sample is the canonical reference for
the Python pattern.
