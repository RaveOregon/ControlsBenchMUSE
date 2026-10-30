# 03 — Actions reference

The actions we've actually used or seen in samples, with their exact
configuration entries. This is the practical subset, not the full Test
Manager catalog.

For the complete list see:
https://content.helpme-codesys.com/en/CODESYS%20Test%20Manager/_tm_struct_reference_test_drivers.html

## TestManager.Projects

### Verb="CloseProject"

Closes any currently open project.

```xml
<Command TestRunner="TestManager.Projects" Verb="CloseProject" />
<Configuration>
  <Entry Name="FailNoProject">False</Entry>  <!-- True = fail if nothing was open -->
</Configuration>
```

### Verb="LoadProject"

Loads a project file from disk. **Will discard unsaved changes in any
currently open project.**

```xml
<Command TestRunner="TestManager.Projects" Verb="LoadProject" />
<Configuration>
  <Entry Name="DisableProjectInspection">True</Entry>
  <Entry Name="FailOnMissingLibraries">False</Entry>
  <Entry Name="OtherMessageBoxes">ReportAsError</Entry>
  <Entry Name="PathToProject">{BasePath}\MyProj.project</Entry>
  <Entry Name="UpdateAllVersions">False</Entry>     <!-- True = let CODESYS upgrade -->
  <Entry Name="UpdateCompilerVersion">False</Entry>
  <Entry Name="UpdateLibraryVerions">False</Entry>  <!-- typo in source CODESYS samples -->
  <Entry Name="UpdateStorageFormate">True</Entry>   <!-- typo in source CODESYS samples -->
  <Entry Name="UpdateVisualisationProfile">False</Entry>
</Configuration>
```

The two typos (`UpdateLibraryVerions`, `UpdateStorageFormate`) are
spelled exactly as CODESYS expects them. Don't fix the typos.

### Verb="SetActiveApplication"

Picks which application to interact with. Multi-app projects need this.

```xml
<Command TestRunner="TestManager.Projects" Verb="SetActiveApplication" />
<Configuration>
  <Entry Name="AppName">Device.Plc Logic.Application</Entry>
</Configuration>
```

The `AppName` here is the **full dotted path including `Plc Logic`**
(unlike variable references later, which skip `Plc Logic`).

## TestManager.Devices

### Verb="SetCommunicationPath"

Configures the gateway / device to connect to.

```xml
<Command TestRunner="TestManager.Devices" Verb="SetCommunicationPath" />
<Configuration>
  <Entry Name="CertificateHandling">1</Entry>
  <Entry Name="DeviceID" />
  <Entry Name="DeviceName">Device</Entry>
  <Entry Name="DeviceType" />
  <Entry Name="GatewayName">Gateway-1</Entry>
  <Entry Name="LocalPlc">True</Entry>
  <Entry Name="LoginCredentialsScope">Device</Entry>
  <Entry Name="LoginUsername"></Entry>           <!-- REQUIRED even if empty -->
  <Entry Name="LoginPassword"></Entry>           <!-- REQUIRED even if empty -->
  <Entry Name="UseCredentials">False</Entry>     <!-- True if you want auth -->
</Configuration>
```

⚠ `LoginUsername` and `LoginPassword` are **required entries even when
`UseCredentials=False`**. Omitting them produces "Required configuration
entry LoginUsername is missing" at run time.

### Verb="UpdateDevice"

Updates the device's firmware / version (rarely needed in practice).
See `reference/Examples.CounterTest.tsd.xml` for the full configuration
shape.

### Verb="ResetOrigin"

Resets the device. Useful between test runs when you want a clean slate.

```xml
<Command TestRunner="TestManager.Devices" Verb="ResetOrigin" />
<Configuration>
  <Entry Name="DevicePath">Device</Entry>
</Configuration>
```

## TestManager.Online

### Verb="Login"

Logs into the running PLC and optionally starts the application.

```xml
<Command TestRunner="TestManager.Online" Verb="Login" />
<Configuration>
  <Entry Name="AllowReinitPersVars">True</Entry>
  <Entry Name="ApplicationState">Start</Entry>      <!-- or Stop, NoChange -->
  <Entry Name="DeleteUnknownApps">True</Entry>
  <Entry Name="OnlineChange">Never</Entry>          <!-- Allowed | Never -->
</Configuration>
```

⚠ **If your runtime is in demo mode** (e.g. Win V3 SoftPLC without a
license), Login will fail with an "unexpected message" exception
because the runtime sends a multi-core / time-limit warning prompt.
Wrap Login in `InstallMessageHandler` / `UninstallAndCheckMessageHandler`
to auto-acknowledge such prompts. See `TestManager.System` actions
below.

### Verb="Logout"

Logs out cleanly.

```xml
<Command TestRunner="TestManager.Online" Verb="Logout" />
<Configuration />
```

## TestManager.Monitoring

### Verb="WriteVariable"

Writes a value to a PLC variable.

```xml
<Command TestRunner="TestManager.Monitoring" Verb="WriteVariable" />
<Configuration>
  <Entry Name="WriteValue">TRUE</Entry>
  <Entry Name="WriteVariable">Device.Application.PLC_PRG.someBool</Entry>
</Configuration>
```

The `WriteValue` is parsed by the runtime according to the variable's
type — `TRUE`/`FALSE` for BOOL, `42` for INT, `1.5` for REAL, qualified
literals (`E_MyEnum.SomeValue`) for strict enums.

### Verb="CompareVariable"

Asserts that a variable has an expected value, polling for up to
`CompareTimeout` ms.

```xml
<Command TestRunner="TestManager.Monitoring" Verb="CompareVariable" />
<Configuration>
  <Entry Name="CompareTimeout">2000</Entry>      <!-- ms; how long to poll -->
  <Entry Name="CompareType">=</Entry>            <!-- = != < > <= >= -->
  <Entry Name="CompareValue">E_LightState.Red</Entry>
  <Entry Name="CompareVariable">Device.Application.StopLight.qState</Entry>
</Configuration>
```

⚠ **For strict-typed enums, `CompareValue` must be the qualified
literal**, not the underlying integer. `E_LightState.Red` works,
`0` does not.

⚠ **The `CompareVariable` path format is
`Device.Application.<POU>.<var>`.** No `Plc Logic`. Other forms produce
"Invalid Expression" or "application not found" errors.

## TestManager.System

### Verb="Delay"

Waits a fixed number of milliseconds.

```xml
<Command TestRunner="TestManager.System" Verb="Delay" />
<Configuration>
  <Entry Name="DelayTime">5000</Entry>  <!-- 5 seconds. The entry name is DelayTime, NOT Delay -->
</Configuration>
```

Useful when `CompareVariable`'s polling timeout isn't appropriate (e.g.
you just want to wait a fixed time, not "wait until value matches").

⚠ The entry name is `DelayTime`, not `Delay`. Using `Delay` produces
"Required configuration entry DelayTime is missing" at run time.

### Verb="PromptUser"

Pauses the test and shows a confirmation dialog.

```xml
<Command TestRunner="TestManager.System" Verb="PromptUser" />
<Configuration>
  <Entry Name="PromptMessage">About to do destructive thing. Continue?</Entry>
</Configuration>
```

Used in CounterTest sample to confirm before configuring user
management. Use sparingly; breaks unattended automation.

### Verb="StartTimer" / "StopTimer"

Measure elapsed time of arbitrary parts of the script. Each timer has
a name and writes its duration to a log file.

(See online docs; we haven't exercised these.)

### Verb="InstallMessageHandler" / "UninstallAndCheckMessageHandler"

Wraps a section of the script to auto-handle blocking message boxes
from CODESYS or the runtime. The classic case is the SoftPLC demo
mode warning ("Multi-core license missing! Demo runs only for 120 [min]!")
that fires during Login and would otherwise hang the test.

```xml
<!-- before the action that may produce a prompt -->
<Action>
  <Information><Title>InstallMessageHandler</Title></Information>
  <Settings>(standard)</Settings>
  <Command TestRunner="TestManager.System" Verb="InstallMessageHandler" />
  <Configuration>
    <Entry Name="Identifier">MyHandler</Entry>
    <Entry Name="OtherMessages">Acknowledge</Entry>   <!-- catch-all -->
  </Configuration>
</Action>

<!-- the risky action(s) -->
<Action>
  <Command TestRunner="TestManager.Online" Verb="Login" />
  <Configuration>...</Configuration>
</Action>

<!-- right after the protected section -->
<Action>
  <Information><Title>UninstallAndCheckMessageHandler</Title></Information>
  <Settings>(standard, often with IgnoreResults=True)</Settings>
  <Command TestRunner="TestManager.System" Verb="UninstallAndCheckMessageHandler" />
  <Configuration>
    <Entry Name="Identifier">MyHandler</Entry>
  </Configuration>
</Action>
```

The two actions must always come in pairs with matching `Identifier`.

`OtherMessages` options: `ReportAsError` (fail), `Acknowledge` (answer
with default and continue), `Forward` (display blocking dialog —
breaks unattended automation).

For finer control you can specify expected messages by Type / Key /
Message in the configuration's `Expected messages` table — see the
official docs. For most test scripts, `OtherMessages=Acknowledge` is
all you need.

## TestManager.Scripting

### Verb="ExecuteScript"

Runs IronPython code inside the action. Full access to CODESYS
ScriptEngine.

```xml
<Command TestRunner="TestManager.Scripting" Verb="ExecuteScript" />
<Configuration>
  <Entry Name="Command">
# Python code goes here. Has access to test-script Variables, the
# CODESYS scriptengine modules, etc.
print("hello from python")
  </Entry>
  <Entry Name="ImplicitImport">True</Entry>
  <Entry Name="ShowTabs">True</Entry>
</Configuration>
```

The CounterTest sample uses this to provision device-level user
management on first run. It's the escape hatch for anything Test
Manager doesn't support natively.

## TestManager.Libraries

### Verb="InstallLibrary"

Installs a `.library` file into the project's repository before
loading.

```xml
<Command TestRunner="TestManager.Libraries" Verb="InstallLibrary" />
<Configuration>
  <Entry Name="PathToLibrary">{BasePath}\TestLibraryExample-5.0.0.0.library</Entry>
</Configuration>
```

Useful for projects that depend on libraries the target machine doesn't
have installed.

## Drivers we've seen but haven't used

These appear in the docs sidebar but aren't covered above:

- `TestManager.FileIO` — read/write CSVs, append to log files
- `TestManager.Testreport` — explicit assertions, custom report sections
- `TestManager.Objects` — inspect/manipulate project objects (POUs, GVLs)

When you need one, read its page on helpme-codesys.com first; the
samples in `reference/` plus the docs are usually enough to figure out
the configuration entries.

## Variable path format — the canonical reference

Across all the actions that take variable paths (`CompareVariable`,
`WriteVariable`, etc.):

| Form | Verdict |
|---|---|
| `Device.Application.<POU>.<var>` | ✅ correct |
| `Device.Plc Logic.Application.<POU>.<var>` | ❌ "application Device.Plc Logic not found" |
| `Application.<POU>.<var>` | ❌ "application Application not found" |
| `Device.<POU>.<var>` | ❌ "application Device not found" |
| `<POU>.<var>` (no prefix) | ❌ "expression does not have required format `<resourcename>.<applicationname>.path`" |

The spaces in `Plc Logic` are *part of the path inside CODESYS*, but
Test Manager **doesn't include `Plc Logic` in the address** — the
intermediate node is implicit between Device and Application.
