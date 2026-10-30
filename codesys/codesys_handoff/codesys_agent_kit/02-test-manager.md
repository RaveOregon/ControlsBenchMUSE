---
inclusion: manual
---

# CODESYS Test Manager — quick reference

Test Manager is the GUI test orchestration tool bundled with CODESYS
PDE (Tools → Test Manager). Tests are XML files (`.tsd.xml`) that
drive the running PLC runtime and produce HTML pass/fail reports.

This doc is the agent-side cheat sheet. For the full handoff with
worked examples, see the `test_manager_handoff/` bundle separately.

## NOT to be confused with

- **`Test Manager IEC Unit Test`** library — separate product. ST
  library you reference in your application that runs unit tests at
  scan time. Different mental model.
- **CODESYS Application Composer** — different product entirely.

This doc is about the GUI tool at **Tools → Test Manager**.

## What the agent can / can't do

| | Capability |
|---|---|
| ✓ | Author `.tsd.xml` test scripts as regular files |
| ✓ | Read exported HTML reports to parse pass/fail |
| ✓ | Embed IronPython scripts inside `ExecuteScript` actions |
| ✗ | Import scripts into Test Manager (operator must do this) |
| ✗ | Run tests (operator) |
| ✗ | Export reports (operator) |

The loop is: agent writes `.tsd.xml` → operator imports + runs +
exports report → agent reads report → agent updates script. Repeat.

## Workflow rules

1. **Operator saves the project** (`Ctrl+S`) before every test run.
   `LoadProject` discards unsaved in-memory changes. We've lost POU
   work to this. Non-negotiable.
2. **Always include a Cleanup case with Logout.** Re-runs without
   logout fail because the previous session is still active.
3. **Always start with a Prepare case** (CloseProject + LoadProject +
   SetCommunicationPath + SetActiveApplication + Login). Without it,
   nothing else works.

## Action vocabulary (the subset we actually use)

### Setup actions

```xml
<!-- Close any current project -->
<Command TestRunner="TestManager.Projects" Verb="CloseProject" />
<Configuration><Entry Name="FailNoProject">False</Entry></Configuration>

<!-- Load the project under test -->
<Command TestRunner="TestManager.Projects" Verb="LoadProject" />
<Configuration>
  <Entry Name="DisableProjectInspection">True</Entry>
  <Entry Name="FailOnMissingLibraries">False</Entry>
  <Entry Name="OtherMessageBoxes">ReportAsError</Entry>
  <Entry Name="PathToProject">{ProjectPath}</Entry>
  <Entry Name="UpdateAllVersions">False</Entry>
  <Entry Name="UpdateCompilerVersion">False</Entry>
  <Entry Name="UpdateLibraryVerions">False</Entry>      <!-- typo in schema -->
  <Entry Name="UpdateStorageFormate">True</Entry>       <!-- typo in schema -->
  <Entry Name="UpdateVisualisationProfile">False</Entry>
</Configuration>

<!-- Pick the gateway/device -->
<Command TestRunner="TestManager.Devices" Verb="SetCommunicationPath" />
<Configuration>
  <Entry Name="CertificateHandling">1</Entry>
  <Entry Name="DeviceID" />
  <Entry Name="DeviceName">Device</Entry>
  <Entry Name="DeviceType" />
  <Entry Name="GatewayName">Gateway-1</Entry>
  <Entry Name="LocalPlc">True</Entry>
  <Entry Name="LoginCredentialsScope">Device</Entry>
  <Entry Name="LoginUsername"></Entry>     <!-- REQUIRED even if empty -->
  <Entry Name="LoginPassword"></Entry>     <!-- REQUIRED even if empty -->
  <Entry Name="UseCredentials">False</Entry>
</Configuration>

<!-- Pick which application -->
<Command TestRunner="TestManager.Projects" Verb="SetActiveApplication" />
<Configuration>
  <Entry Name="AppName">Device.Plc Logic.Application</Entry>
</Configuration>

<!-- Log in and start -->
<Command TestRunner="TestManager.Online" Verb="Login" />
<Configuration>
  <Entry Name="AllowReinitPersVars">True</Entry>
  <Entry Name="ApplicationState">Start</Entry>
  <Entry Name="DeleteUnknownApps">True</Entry>
  <Entry Name="OnlineChange">Never</Entry>
</Configuration>
```

### Per-test actions

```xml
<!-- Write a value -->
<Command TestRunner="TestManager.Monitoring" Verb="WriteVariable" />
<Configuration>
  <Entry Name="WriteValue">TRUE</Entry>
  <Entry Name="WriteVariable">Device.Application.PLC_PRG.someBool</Entry>
</Configuration>

<!-- Compare a value (poll for up to CompareTimeout ms) -->
<Command TestRunner="TestManager.Monitoring" Verb="CompareVariable" />
<Configuration>
  <Entry Name="CompareTimeout">2000</Entry>
  <Entry Name="CompareType">=</Entry>      <!-- = != < > <= >= -->
  <Entry Name="CompareValue">E_State.Idle</Entry>
  <Entry Name="CompareVariable">Device.Application.PLC_PRG.qState</Entry>
</Configuration>

<!-- Wait a fixed time -->
<Command TestRunner="TestManager.System" Verb="Delay" />
<Configuration>
  <Entry Name="DelayTime">2000</Entry>     <!-- entry is DelayTime, NOT Delay -->
</Configuration>
```

### Cleanup

```xml
<Command TestRunner="TestManager.Online" Verb="Logout" />
<Configuration />
```

### Escape hatch: IronPython

```xml
<Command TestRunner="TestManager.Scripting" Verb="ExecuteScript" />
<Configuration>
  <Entry Name="Command">
# IronPython here. Has access to test Variables and CODESYS scriptengine.
print("hello")
  </Entry>
  <Entry Name="ImplicitImport">True</Entry>
  <Entry Name="ShowTabs">True</Entry>
</Configuration>
```

## Action `<Settings>` block

Every action needs this regardless of what it does:

```xml
<Settings>
  <Entry Name="Condition" />
  <Entry Name="ExecutionDelay">0</Entry>
  <Entry Name="ForceEvaluation">False</Entry>
  <Entry Name="IgnoreResults">False</Entry>      <!-- True for probes -->
  <Entry Name="ResultVariable" />
  <Entry Name="RetryOnError">0|0</Entry>
</Settings>
```

`IgnoreResults=True` is critical for diagnostic probe scripts where
you want every action to run even if some fail.

## Things that bit us — fix table

| Symptom | Real cause | Fix |
|---|---|---|
| `Required configuration entry LoginUsername is missing` | Required even when unused | Add empty `LoginUsername` + `LoginPassword` to `SetCommunicationPath` |
| `Required configuration entry DelayTime is missing` | Entry name is `DelayTime`, not `Delay` | Use `<Entry Name="DelayTime">5000</Entry>` |
| Login fails with `unexpected messages have been received` (demo mode runtime sends a prompt) | Runtime sent a blocking prompt | Two options. (a) Wrap Login in `InstallMessageHandler` / `UninstallAndCheckMessageHandler` (`OtherMessages=Acknowledge`, must include empty `Messages` entry). May not work if the prompt is generated by Login's own pre-check (we saw this on Win V3 SoftPLC demo mode). (b) Mark Login `IgnoreResults=True` — the runtime actually does start despite the "failure"; subsequent reads/writes work. Cheap and reliable. |
| `Invalid Expression: Device.Application.X.y` | Wrong path format | See `03-variable-paths.md` |
| `application Device.Plc Logic not found` | Variable paths skip `Plc Logic` | Use `Device.Application.<POU>.<var>` |
| `expected E_X.Foo, got 0` for strict enum | Strict enums need qualified literals | `E_X.Foo`, not `0` |
| Project changes disappear after run | `LoadProject` discards unsaved work | `Ctrl+S` before every run |
| Hangs on a CompareVariable | High `CompareTimeout` + value never matches | Lower timeout (≤6000ms typically) |
| All cases after first failure marked `Skipped` | Default `IgnoreResults=False` short-circuits | Either fix the first failure, or set `IgnoreResults=True` for probes |
| `device 'X' in project does not match device 'Y' you are trying to connect to` | Project's device type ≠ gateway's runtime | Update Device in CODESYS, save, retry |
| Static-analysis warnings show as errors | These are warnings, not real errors | Most are noise (notation, complexity); ignore unless something doesn't run |
| Build error references typo'd config keys | Schema has typos baked in | Don't fix `UpdateLibraryVerions` or `UpdateStorageFormate` — spell as the schema expects |

## Authoring a script — minimum viable

```xml
<?xml version="1.0" encoding="utf-8"?>
<TestScript>
  <Information>
    <Name>SmokeTest</Name>
    <Version>1.0</Version>
  </Information>
  <Sequence>
    <Assign Variable="ProjectPath">C:\path\to\project.project</Assign>

    <TestCase definesScope="False">
      <Information><Title>Prepare</Title></Information>
      <Actions>
        <!-- copy the 5 setup actions from above, each wrapped in <Action><Settings>...</Settings>...</Action> -->
      </Actions>
    </TestCase>

    <TestCase definesScope="False">
      <Information><Title>Smoke check</Title></Information>
      <Actions>
        <Action>
          <Information><Title>Sanity</Title></Information>
          <Settings>(standard)</Settings>
          <Command TestRunner="TestManager.Monitoring" Verb="CompareVariable" />
          <Configuration>
            <Entry Name="CompareTimeout">2000</Entry>
            <Entry Name="CompareType">=</Entry>
            <Entry Name="CompareValue">TRUE</Entry>
            <Entry Name="CompareVariable">Device.Application.SomeFlag</Entry>
          </Configuration>
        </Action>
      </Actions>
    </TestCase>

    <TestCase definesScope="False">
      <Information><Title>Cleanup</Title></Information>
      <Actions>
        <Action>
          <Information><Title>Logout</Title></Information>
          <Settings>(standard)</Settings>
          <Command TestRunner="TestManager.Online" Verb="Logout" />
          <Configuration />
        </Action>
      </Actions>
    </TestCase>
  </Sequence>
</TestScript>
```

For more patterns, see `04-deployment-methodology.md`.

## When in doubt

CODESYS ships sample test scripts on every install at:

```
%LOCALAPPDATA%\CODESYS Test Manager\Test Repository\TestScripts\Examples\
  ApplicationTest\5.0.0.0\entry\entry
  CounterTest\5.0.0.0\entry\entry
  CounterTestTable\5.0.0.0\entry\entry
  IecUnitTest\5.0.0.0\entry\entry
```

Treat them as ground truth. The `entry` files have no extension but
are the same XML format. CounterTest is the most useful — it covers
LoadProject, Login, WriteVariable, CompareVariable, ExecuteScript,
PromptUser, plus user-management provisioning.

Online docs:
- https://content.helpme-codesys.com/en/CODESYS%20Test%20Manager/_tm_start_page.html
- https://content.helpme-codesys.com/en/CODESYS%20Test%20Manager/_tm_struct_reference_test_drivers.html
