# <ProjectName> — Test Manager deployment plan

Copy this file to your project as `<ProjectName>_TEST_PLAN.md` and
fill in the blanks. See `docs/06-methodology.md` for the full
methodology behind each phase.

For a real worked example to compare against, see
`../../test_scripts/IBIS_TEST_PLAN.md` (the IBIS production project,
filled in through Phase 2).

## Recon (Phase 1)

Use MCP read-only tools to collect this:

- **Runtime:** `<e.g. CODESYS Control Win V3 x64>`
- **Active application path:** `Device.Plc Logic.Application`
- **Top-level POUs to test:**
  - `<POU 1>`
  - `<POU 2>`
- **Mode / feature flags worth toggling:**
  - `<GVL_FeatureFlags.someFlag>`
  - `<GVL_Simulation.SimulationEnabled>`
- **Enums in play:**
  - `<E_State>` with values `[<v1>, <v2>, ...]`
- **Libraries referenced:**
  - `<lib1>`
  - `<lib2>`
- **Tasks of interest:**
  - `<MainTask>` runs `<POU>`
  - `<SimulationTask>` runs `<POU>`
- **Open questions:**
  - `<things you couldn't determine from MCP alone>`

## Probe (Phase 2)

Run: `<ProjectName>_Probe.tsd.xml`

Confirmed paths:

| Variable | Path that worked | Notes |
|---|---|---|
| `<App-level GVL var>` | `Device.Application.GVL_X.var` | |
| `<Library GVL var>` | `Device.Application.GVL_Y.var` | bare form |
| `<POU-internal var>` | `Device.Application.POU.localVar` | |
| `<Strict enum compare>` | `E_State.Idle` | `0` does not work |
| `<Sim toggle>` | `GVL_Simulation.SimulationEnabled` | settles in ~500ms |

## Test plan (Phase 3)

Tick off as scripts land and go green:

- [ ] `<ProjectName>_Smoke (1.0).tsd.xml` — load + login + start
- [ ] `<ProjectName>_Defaults (1.0).tsd.xml` — post-startup state matches design
- [ ] `<ProjectName>_SimMode (1.0).tsd.xml` — sim toggle works
- [ ] `<ProjectName>_<FeatureA> (1.0).tsd.xml` — feature A behavior
- [ ] `<ProjectName>_<FeatureB> (1.0).tsd.xml` — feature B behavior
- [ ] `<ProjectName>_Alarms (1.0).tsd.xml` — alarm conditions raise
- [ ] `<ProjectName>_PerfBaseline (1.0).tsd.xml` — timings within budget

## Status

| Item | Status | Last run | Notes |
|---|---|---|---|
| Probe | <green/amber/red> | <date> | |
| Smoke | <not started / draft / passing> | | |
| Defaults | | | |
| SimMode | | | |
| ... | | | |

## Project-specific notes

- `<gotchas, deviations from the standard pattern, library-specific
  behavior, etc.>`
- `<e.g. "the device must be Win V3 x64, not RTE V3 x64 or Linux SL.">`
- `<e.g. "GVL_Simulation lives in amznCGCore namespace, but bare path
  works because library exposes names globally.">`

## How to re-run

1. Save the project (`Ctrl+S` in CODESYS) — `LoadProject` discards
   unsaved changes.
2. Tools → Test Manager → import the script.
3. Right-click → Run.
4. Right-click result → Export → HTML → save to `test_scripts/`.
