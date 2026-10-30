# CODESYS Test Manager — overview

## What it is

A test orchestration tool bundled with CODESYS Professional Developer
Edition. Scripts are XML, drive the running CODESYS runtime via the
Monitor / Online interfaces, and produce HTML pass/fail reports.

## What it isn't

Don't confuse it with the **`Test Manager IEC Unit Test`** library.
That's a separate product — IEC ST library you reference in your
application that runs unit-test-style FBs at PLC scan time. Different
mental model. Confusing they share a name.

This handoff is about the **GUI / orchestration tool**, the one at
`Tools → Test Manager` in CODESYS.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                       CODESYS IDE (PDE)                               │
│                                                                       │
│  Tools → Test Manager (this tool)                                     │
│   │                                                                   │
│   │   Reads:                                                          │
│   │   ┌─────────────────────────────┐                                 │
│   │   │ <TestScript>                 │                                │
│   │   │   <Sequence>                  │                               │
│   │   │     <TestCase>                │                               │
│   │   │       <Action>                │  ← XML, hand-written or       │
│   │   │         <Command Verb=…/>     │     auto-generated            │
│   │   │       </Action>               │                               │
│   │   │     </TestCase>               │                               │
│   │   └─────────────────────────────┘                                 │
│   │                                                                   │
│   ▼                                                                   │
│  Drives via:                                                          │
│   - TestManager.Projects (LoadProject, SetActiveApplication, …)       │
│   - TestManager.Devices (SetCommunicationPath, …)                     │
│   - TestManager.Online (Login, Logout, …)                             │
│   - TestManager.Monitoring (CompareVariable, WriteVariable)           │
│   - TestManager.System (Delay, PromptUser, …)                         │
│   - TestManager.Scripting (ExecuteScript via IronPython)              │
│   - TestManager.Libraries (InstallLibrary, …)                         │
│   - TestManager.FileIO, TestManager.Testreport, …                     │
│                                                                       │
└─────────────────────────┬────────────────────────────────────────────┘
                          │
                          ▼
                  CODESYS Runtime (Win V3 or other)
                  - Application loads / starts / runs
                  - Variables read/written via Monitor service
                  - Output: pass/fail per action → aggregated → HTML
```

## File format

Test scripts are XML files with extension `.tsd.xml`. Versioned:
typical naming is `MyTest (1.0).tsd.xml`. Stored in a Test Repository
at `%LOCALAPPDATA%\CODESYS Test Manager\Test Repository\`.

Internal repository format keeps each version under its own
`Examples/<name>/<version>/entry/entry` path. The `entry` file (no
extension) is the same XML — Test Manager stores it without an
extension internally but exports as `(name) (version).tsd.xml`.

## Where to start

If you're new to this:

- `01-getting-started.md` — first test from scratch, ~10 minutes.
- `02-script-format.md` — the XML, demystified.

If you're trying to fix a script that won't work:

- `04-troubleshooting.md` — every error message we hit and the fix.

If you're writing a script for an unfamiliar action:

- `03-actions-reference.md` — actions we've used with their exact
  configuration entries.

If you want to write a CI-runnable test suite:

- `05-patterns.md` — templates and patterns that scale.

If you're deploying tests to a brand-new CODESYS project (with the MCP
bridge giving you read access to the project, and Test Manager giving
you the runtime):

- `06-methodology.md` — the recon → probe → author → run → iterate
  loop. Read this before starting on a new project.

## Discoverable on your machine

CODESYS ships sample test scripts at:

```
%LOCALAPPDATA%\CODESYS Test Manager\Test Repository\TestScripts\Examples\
  ApplicationTest\5.0.0.0\entry\entry
  CounterTest\5.0.0.0\entry\entry
  CounterTestTable\5.0.0.0\entry\entry
  IecUnitTest\5.0.0.0\entry\entry
```

These are the canonical reference. We've copied them into
`reference/` for offline access.

The official online docs are at:

- https://content.helpme-codesys.com/en/CODESYS%20Test%20Manager/_tm_start_page.html

The action reference tree (every `TestRunner.Verb` combo) is here:

- https://content.helpme-codesys.com/en/CODESYS%20Test%20Manager/_tm_struct_reference_test_drivers.html
