---
inclusion: always
---

# CODESYS variable paths — the canonical reference

This is the single most expensive lesson we paid for. Read it once.

## The answer

For Test Manager actions (`CompareVariable`, `WriteVariable`) the
variable address is:

```
Device.Application.<POU or GVL>.<var>
```

Examples:

| Path | What it addresses |
|---|---|
| `Device.Application.PLC_PRG.qState` | A var in program `PLC_PRG` |
| `Device.Application.GVL_FeatureFlags.Enabled` | A var in GVL `GVL_FeatureFlags` |
| `Device.Application.Main._initsDone` | A private var in program `Main` |
| `Device.Application.GVL_Simulation.SimulationEnabled` | A library-scoped GVL exposed globally |

## Forms that DON'T work

| Form | Error you get |
|---|---|
| `Application.PLC_PRG.qState` | `application Application not found` |
| `Device.PLC_PRG.qState` | `application Device not found` |
| `Device.Plc Logic.Application.PLC_PRG.qState` | `application Device.Plc Logic not found` |
| `PLC_PRG.qState` | `expression does not have required format <resource>.<application>.path` |

## Why `Plc Logic` is in the tree but not in addresses

The CODESYS Devices tree shows the device hierarchy:

```
Device
  └── Plc Logic              ← intermediate node, IS in browse paths
        └── Application       ← THIS is what the runtime addresses
              └── PLC_PRG
                    └── qState
```

`Plc Logic` is a structural node in the Devices tree. The runtime's
Monitor service (which Test Manager uses) addresses the Application
directly: `<resource>.<application>.path`. So the address
**collapses past `Plc Logic`**.

But `SetActiveApplication`'s `AppName` config IS the full tree
path including `Plc Logic`:

```xml
<Command TestRunner="TestManager.Projects" Verb="SetActiveApplication" />
<Configuration>
  <Entry Name="AppName">Device.Plc Logic.Application</Entry>     <!-- here Plc Logic IS included -->
</Configuration>
```

Confusing but consistent: AppName is a tree path; variable paths are
runtime addresses.

## MCP paths (browse / read) DO include `Plc Logic`

For `mcp_codesys_ide_*` calls, paths include `Plc Logic`:

```
mcp_codesys_ide_browse_project_tree(
  rootPath="Device.Plc Logic.Application.GVL"
)

mcp_codesys_ide_get_structured_text_content(
  path="Device.Plc Logic.Application.GVL.GVL_FeatureFlags"
)
```

So:

- **MCP paths**: `Device.Plc Logic.Application.<...>` (full tree path)
- **TM variable paths**: `Device.Application.<POU>.<var>` (runtime address, no `Plc Logic`)

These are two different namespaces. Don't mix them.

## Multi-application projects

If the project has multiple apps under `Plc Logic`:

```
Device
  └── Plc Logic
        ├── Application
        └── SubApplication
```

Use the right one in `SetActiveApplication`:

```xml
<Entry Name="AppName">Device.Plc Logic.SubApplication</Entry>
```

And variables are addressed `Device.SubApplication.<POU>.<var>`.

## Library-scoped GVLs

When a GVL is defined in a library (e.g. `GVL_Simulation` in
`AmazonCodesysCGCoreLibrary`, namespace `amznCGCore`), there are
two possible forms:

```
Device.Application.GVL_Simulation.SimulationEnabled               ← bare
Device.Application.amznCGCore.GVL_Simulation.SimulationEnabled    ← namespaced
```

Which works depends on whether the library exposes names globally.
Most Amazon CG libraries do, so the bare form works. Probe both
when in doubt — see `04-deployment-methodology.md` for the probe
pattern.

## Strict enums

A var declared as a strict-typed enum (`{attribute 'strict'}`) needs
its compare value as a qualified literal:

```xml
<Entry Name="CompareValue">E_LightState.Red</Entry>     ✓
<Entry Name="CompareValue">0</Entry>                    ✗ — fails even if Red := 0
```

Without `strict`, the integer form might work but the literal is
always safe. Use the literal.

## Booleans

```xml
<Entry Name="CompareValue">TRUE</Entry>      ✓ canonical
<Entry Name="CompareValue">FALSE</Entry>     ✓ canonical
<Entry Name="WriteValue">TRUE</Entry>        ✓ canonical
```

The runtime accepts variants (`True`, `1`) on write but reads back
as canonical `TRUE`/`FALSE`. Use uppercase to match what the report
will show.

## REAL / LREAL

Use range comparisons, not equality:

```xml
<Entry Name="CompareType">>=</Entry>
<Entry Name="CompareValue">3.14</Entry>
```

Floating-point exact compares rarely match.

## Arrays

`CompareVariable` operates on single values. To check an array
element:

```xml
<Entry Name="CompareVariable">Device.Application.GVL.someArray[1]</Entry>
```

To check a struct member:

```xml
<Entry Name="CompareVariable">Device.Application.GVL.someStruct.member</Entry>
```

For full-array assertions, drop into IronPython
(`TestManager.Scripting Verb="ExecuteScript"`).

## Quick decision tree

You need to address a variable. Pick:

```
Is it a project-defined variable?
├── In a POU → Device.Application.<POU>.<var>
├── In a project GVL → Device.Application.<GVL>.<var>
└── In a library-scoped GVL?
    └── Try bare first: Device.Application.<GVL>.<var>
        └── If it fails → Device.Application.<namespace>.<GVL>.<var>
```

When unsure, run a probe. See `04-deployment-methodology.md`.
