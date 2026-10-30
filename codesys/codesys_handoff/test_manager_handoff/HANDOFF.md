# CODESYS Test Manager — Handoff

A working pattern for **automated CODESYS tests** using the built-in
**CODESYS Test Manager** (PDE feature). Tests are XML files that drive the
real PLC runtime: load a project, log in, write/read variables, assert
state transitions, run pass/fail reports.

Built and verified May 2026 against **CODESYS V3.5 SP22.20** on Windows 11.

## What this folder is

A teammate-shareable bundle that captures everything we figured out
about the Test Manager's XML script format. The CODESYS docs cover most
of it, but several things bit us hard during iteration that aren't
obvious from the docs alone (variable path format, schema requirements,
project-state side effects).

## What you can demo in 5 minutes

If everything is in place:

1. Open CODESYS, have a project open with a stoplight-style POU.
2. **Tools → Test Manager** → import `examples/StopLightTest (1.0).tsd.xml`.
3. Right-click the script → Run.
4. Report shows 6 test cases passing, ~13 second runtime.

Total cost to set up the first time: 30 minutes if you've never seen
Test Manager before. Cost for each subsequent test: ~5 minutes if you
adapt this template.

## Why use Test Manager instead of writing a watch list manually

- **Repeatable.** Same script, same project, same outcome. No human in the
  loop.
- **Reportable.** Test Manager produces an HTML report you can commit to
  git, share via email, or feed into a CI pipeline.
- **Free with PDE.** No additional license, no third-party tool to wrangle.
- **Tests run against the real runtime.** Not a simulator wrapper, not a
  unit test harness — the actual PLC code on the actual virtual / real
  device.

## What's in here

```
test_manager_handoff/
├── HANDOFF.md                       ← you are here
├── docs/
│   ├── README.md                    ← architecture / overview
│   ├── 01-getting-started.md        ← first test from scratch (copy this if new)
│   ├── 02-script-format.md          ← XML structure, the 3 things that matter
│   ├── 03-actions-reference.md      ← actions we've actually used, with config keys
│   ├── 04-troubleshooting.md        ← every dead end with the fix
│   ├── 05-patterns.md               ← reusable templates
│   └── 06-methodology.md            ← MCP + TM playbook for new projects
├── examples/
│   ├── StopLightTest (1.0).tsd.xml  ← the working test
│   ├── PathProbe2 (1.0).tsd.xml     ← diagnostic probe (use this if your variable
│   │                                   paths come back "Invalid Expression")
│   └── DEPLOYMENT_PLAN_TEMPLATE.md  ← copy this per-project to plan your test deployment
├── kiro_steering.md                 ← steering for an AI agent picking this up
└── reference/
    ├── Examples.CounterTest (5.0.0.0).tsd.xml      ← CODESYS-shipped sample
    ├── Examples.ApplicationTest (5.0.0.0).tsd.xml  ← shipped sample
    ├── Examples.CounterTestTable (5.0.0.0).tsd.xml ← shipped sample
    └── Examples.IecUnitTest (5.0.0.0).tsd.xml      ← shipped sample
```

## Two big lessons captured here

These are the two that took multiple iterations to figure out:

### 1. The variable path format is `Device.Application.<POU>.<var>`

Despite what some samples imply, the canonical full path is required.
Wrong forms produce confusing errors:

- `Application.StopLight.qState` → "application Application.StopLight not found"
- `Device.StopLight.qState` → "application Device.StopLight not found"
- `Device.Plc Logic.Application.StopLight.qState` → "application Device.Plc Logic not found"
- ✅ `Device.Application.StopLight.qState` → works

The format is `<resourcename>.<applicationname>.<path>`, where the device
node is the resource name and `Application` is the application name. The
intermediate `Plc Logic` node is not part of the address.

### 2. Test Manager LoadProject can wipe your unsaved work

If you have CODESYS open with an unsaved project and run a Test Manager
script that does `LoadProject`, **the in-memory project is discarded and
replaced with whatever is on disk**. We lost an hour of POU work this way.

**Always save the project (Ctrl+S) before running a Test Manager script.**

This is captured in `docs/04-troubleshooting.md` along with everything
else.

## When to use this pattern

- You want regression tests for a CODESYS project that survive across
  development sessions.
- You want an HTML report to share pass/fail results with non-CODESYS
  users (managers, QA).
- You're testing state-machine transitions, timing windows, or alarm
  classification logic.
- You want CI-style automation (Test Manager has command-line invocation;
  see the `Command-Line Commands` doc in CODESYS help).

## When NOT to use this pattern

- For pure unit tests of a single FB → use the **`Test Manager IEC Unit
  Test`** library instead (different product). Tests live in ST inside
  the application.
- For testing things that need real hardware → Test Manager runs against
  what's online; it can't simulate fieldbus IO. (You can use simulation
  modes inside the project, but TM itself isn't a simulator.)
- For ultra-fast iteration → Test Manager startup is slow (~30–60s per
  run). For TDD-style work, use the IEC Unit Test approach.

## Caveats

- Test Manager isn't free across all CODESYS tiers. Verify the target
  install has PDE.
- Some actions require specific configuration entries even when their
  value is unused (`SetCommunicationPath` requires `LoginUsername` even
  when `UseCredentials=False`). Captured in the actions reference.
- Strict-typed enums require literal value comparisons, not integer
  equivalents. (`E_LightState.Red`, not `0`.)

## If you're an AI agent reading this

Open `kiro_steering.md`. Conventions, gotchas, working patterns —
everything an agent needs to write a Test Manager script first-try
instead of going through the iteration loop we did.
