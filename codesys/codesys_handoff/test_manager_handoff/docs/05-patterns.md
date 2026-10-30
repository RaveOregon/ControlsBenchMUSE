# 05 — Reusable patterns

Templates for common test-script shapes. Copy / adapt these instead of
starting from scratch.

## The "boilerplate prepare" snippet

Every script needs project-load + login + start. Copy this block as
the first `<TestCase>` in any script. Update `ProjectPath` and you're
done.

```xml
<Assign Variable="ProjectPath">C:\path\to\your.project</Assign>

<TestCase definesScope="False">
  <Information><Title>Prepare</Title></Information>
  <Actions>
    <Action>
      <Information><Title>CloseProject</Title></Information>
      <Settings>
        <Entry Name="Condition" />
        <Entry Name="ExecutionDelay">0</Entry>
        <Entry Name="ForceEvaluation">False</Entry>
        <Entry Name="IgnoreResults">False</Entry>
        <Entry Name="ResultVariable" />
        <Entry Name="RetryOnError">0|0</Entry>
      </Settings>
      <Command TestRunner="TestManager.Projects" Verb="CloseProject" />
      <Configuration>
        <Entry Name="FailNoProject">False</Entry>
      </Configuration>
    </Action>

    <Action>
      <Information><Title>LoadProject</Title></Information>
      <Settings>
        <Entry Name="Condition" />
        <Entry Name="ExecutionDelay">0</Entry>
        <Entry Name="ForceEvaluation">False</Entry>
        <Entry Name="IgnoreResults">False</Entry>
        <Entry Name="ResultVariable" />
        <Entry Name="RetryOnError">0|0</Entry>
      </Settings>
      <Parameters>
        <Inputs>
          <Parameter Name="ProjectPath" Variable="ProjectPath" />
        </Inputs>
      </Parameters>
      <Command TestRunner="TestManager.Projects" Verb="LoadProject" />
      <Configuration>
        <Entry Name="DisableProjectInspection">True</Entry>
        <Entry Name="FailOnMissingLibraries">False</Entry>
        <Entry Name="OtherMessageBoxes">ReportAsError</Entry>
        <Entry Name="PathToProject">{ProjectPath}</Entry>
        <Entry Name="UpdateAllVersions">False</Entry>
        <Entry Name="UpdateCompilerVersion">False</Entry>
        <Entry Name="UpdateLibraryVerions">False</Entry>
        <Entry Name="UpdateStorageFormate">True</Entry>
        <Entry Name="UpdateVisualisationProfile">False</Entry>
      </Configuration>
    </Action>

    <Action>
      <Information><Title>SetCommunicationPath</Title></Information>
      <Settings>
        <Entry Name="Condition" />
        <Entry Name="ExecutionDelay">0</Entry>
        <Entry Name="ForceEvaluation">False</Entry>
        <Entry Name="IgnoreResults">False</Entry>
        <Entry Name="ResultVariable" />
        <Entry Name="RetryOnError">0|0</Entry>
      </Settings>
      <Command TestRunner="TestManager.Devices" Verb="SetCommunicationPath" />
      <Configuration>
        <Entry Name="CertificateHandling">1</Entry>
        <Entry Name="DeviceID" />
        <Entry Name="DeviceName">Device</Entry>
        <Entry Name="DeviceType" />
        <Entry Name="GatewayName">Gateway-1</Entry>
        <Entry Name="LocalPlc">True</Entry>
        <Entry Name="LoginCredentialsScope">Device</Entry>
        <Entry Name="LoginUsername"></Entry>
        <Entry Name="LoginPassword"></Entry>
        <Entry Name="UseCredentials">False</Entry>
      </Configuration>
    </Action>

    <Action>
      <Information><Title>SetActiveApplication</Title></Information>
      <Settings>
        <Entry Name="Condition" />
        <Entry Name="ExecutionDelay">0</Entry>
        <Entry Name="ForceEvaluation">False</Entry>
        <Entry Name="IgnoreResults">False</Entry>
        <Entry Name="ResultVariable" />
        <Entry Name="RetryOnError">0|0</Entry>
      </Settings>
      <Command TestRunner="TestManager.Projects" Verb="SetActiveApplication" />
      <Configuration>
        <Entry Name="AppName">Device.Plc Logic.Application</Entry>
      </Configuration>
    </Action>

    <Action>
      <Information><Title>Login + Start</Title></Information>
      <Settings>
        <Entry Name="Condition" />
        <Entry Name="ExecutionDelay">0</Entry>
        <Entry Name="ForceEvaluation">False</Entry>
        <Entry Name="IgnoreResults">False</Entry>
        <Entry Name="ResultVariable" />
        <Entry Name="RetryOnError">0|0</Entry>
      </Settings>
      <Command TestRunner="TestManager.Online" Verb="Login" />
      <Configuration>
        <Entry Name="AllowReinitPersVars">True</Entry>
        <Entry Name="ApplicationState">Start</Entry>
        <Entry Name="DeleteUnknownApps">True</Entry>
        <Entry Name="OnlineChange">Never</Entry>
      </Configuration>
    </Action>
  </Actions>
</TestCase>
```

## The "cleanup logout" snippet

End every script with this:

```xml
<TestCase definesScope="False">
  <Information><Title>Cleanup</Title></Information>
  <Actions>
    <Action>
      <Information><Title>Logout</Title></Information>
      <Settings>
        <Entry Name="Condition" />
        <Entry Name="ExecutionDelay">0</Entry>
        <Entry Name="ForceEvaluation">False</Entry>
        <Entry Name="IgnoreResults">False</Entry>
        <Entry Name="ResultVariable" />
        <Entry Name="RetryOnError">0|0</Entry>
      </Settings>
      <Command TestRunner="TestManager.Online" Verb="Logout" />
      <Configuration />
    </Action>
  </Actions>
</TestCase>
```

## Pattern: assert one variable equals an expected value

```xml
<Action>
  <Information><Title>Check qState = Red</Title></Information>
  <Settings>
    <Entry Name="Condition" />
    <Entry Name="ExecutionDelay">0</Entry>
    <Entry Name="ForceEvaluation">False</Entry>
    <Entry Name="IgnoreResults">False</Entry>
    <Entry Name="ResultVariable" />
    <Entry Name="RetryOnError">0|0</Entry>
  </Settings>
  <Command TestRunner="TestManager.Monitoring" Verb="CompareVariable" />
  <Configuration>
    <Entry Name="CompareTimeout">2000</Entry>
    <Entry Name="CompareType">=</Entry>
    <Entry Name="CompareValue">E_LightState.Red</Entry>
    <Entry Name="CompareVariable">Device.Application.StopLight.qState</Entry>
  </Configuration>
</Action>
```

## Pattern: write then verify

```xml
<!-- write -->
<Action>
  <Information><Title>Set trigger</Title></Information>
  <Settings>...</Settings>
  <Command TestRunner="TestManager.Monitoring" Verb="WriteVariable" />
  <Configuration>
    <Entry Name="WriteValue">TRUE</Entry>
    <Entry Name="WriteVariable">Device.Application.PLC_PRG.xTrigger</Entry>
  </Configuration>
</Action>

<!-- verify it took effect -->
<Action>
  <Information><Title>Verify trigger</Title></Information>
  <Settings>...</Settings>
  <Command TestRunner="TestManager.Monitoring" Verb="CompareVariable" />
  <Configuration>
    <Entry Name="CompareTimeout">500</Entry>
    <Entry Name="CompareType">=</Entry>
    <Entry Name="CompareValue">TRUE</Entry>
    <Entry Name="CompareVariable">Device.Application.PLC_PRG.xTrigger</Entry>
  </Configuration>
</Action>
```

## Pattern: wait for a state transition

The `CompareTimeout` polls — so for "wait up to 6 seconds for the
state to flip to RedYellow":

```xml
<Action>
  <Information><Title>Wait for RedYellow</Title></Information>
  <Settings>...</Settings>
  <Command TestRunner="TestManager.Monitoring" Verb="CompareVariable" />
  <Configuration>
    <Entry Name="CompareTimeout">6000</Entry>     <!-- 6 second poll window -->
    <Entry Name="CompareType">=</Entry>
    <Entry Name="CompareValue">E_LightState.RedYellow</Entry>
    <Entry Name="CompareVariable">Device.Application.StopLight.qState</Entry>
  </Configuration>
</Action>
```

If the value matches in 100 ms, the action passes immediately. If it
takes 5.9s, still passes. If it never matches in 6s, fails.

## Pattern: probe (run all checks even if some fail)

For diagnostic test cases where you want to see all results:

```xml
<TestCase definesScope="False">
  <Information><Title>Probes</Title></Information>
  <Actions>
    <Action>
      <Information><Title>Try variant A</Title></Information>
      <Settings>
        <Entry Name="Condition" />
        <Entry Name="ExecutionDelay">0</Entry>
        <Entry Name="ForceEvaluation">False</Entry>
        <Entry Name="IgnoreResults">True</Entry>     <!-- key change -->
        <Entry Name="ResultVariable" />
        <Entry Name="RetryOnError">0|0</Entry>
      </Settings>
      <Command TestRunner="TestManager.Monitoring" Verb="CompareVariable" />
      <Configuration>...</Configuration>
    </Action>
    <Action>
      <Information><Title>Try variant B</Title></Information>
      <Settings>
        <!-- same Settings with IgnoreResults=True -->
      </Settings>
      <Command ... />
      <Configuration>...</Configuration>
    </Action>
  </Actions>
</TestCase>
```

The `examples/PathProbe2 (1.0).tsd.xml` is a complete worked example
of this — six different variable path forms tested in one run.

## Pattern: parameterize a script for multiple projects

Use a script-level `<Assign>` for the project path so the test runs
against any project of the same shape:

```xml
<Sequence>
  <Assign Variable="ProjectPath">{computed-or-fixed}</Assign>
  <Assign Variable="DeviceName">Device</Assign>

  <!-- ... use {ProjectPath} in LoadProject's PathToProject ... -->
</Sequence>
```

Or for paths relative to where the script lives, use the special
`$REPO.PARENTPATH` variable (CODESYS sets it for you):

```xml
<Assign Variable="BasePath" Expression="true">$REPO.PARENTPATH</Assign>
<!-- ...later... -->
<Entry Name="PathToProject">{BasePath}\MyProject.project</Entry>
```

This is what the CODESYS samples (CounterTest, etc.) use. Means a
script can ship alongside its project and stay portable.

## Pattern: timing the test

Use `StartTimer` / `StopTimer` actions to measure elapsed time:

```xml
<Action>
  <Information><Title>Start cycle timer</Title></Information>
  <Settings>...</Settings>
  <Command TestRunner="TestManager.System" Verb="StartTimer" />
  <Configuration>
    <Entry Name="TimerName">FullCycle</Entry>
  </Configuration>
</Action>

<!-- ... actions that exercise the cycle ... -->

<Action>
  <Information><Title>Stop cycle timer</Title></Information>
  <Settings>...</Settings>
  <Command TestRunner="TestManager.System" Verb="StopTimer" />
  <Configuration>
    <Entry Name="TimerName">FullCycle</Entry>
  </Configuration>
</Action>
```

The timer's start/stop/duration go to a log file. Useful for
performance regression tracking.

## Pattern: extract complex logic to IronPython

When the test logic doesn't fit the action vocabulary cleanly, drop into
Python:

```xml
<Action>
  <Information><Title>Compute expected based on inputs</Title></Information>
  <Settings>...</Settings>
  <Command TestRunner="TestManager.Scripting" Verb="ExecuteScript" />
  <Configuration>
    <Entry Name="Command">
import math

# Test variables are accessible directly by name.
# Outputs go back via the Outputs Parameters block.
expected = math.sqrt(InputValue) * 2.0
print("Computed expected:", expected)
    </Entry>
    <Entry Name="ImplicitImport">True</Entry>
    <Entry Name="ShowTabs">True</Entry>
  </Configuration>
</Action>
```

See the CounterTest sample's user-management script for the full
pattern, including how to access `online`, `projects`, etc. from inside
the Python.

## Putting it together

Skeleton for a complete test:

```
<TestScript>
  <Information>...</Information>
  <Sequence>
    <Assign Variable="ProjectPath">...</Assign>

    <TestCase>Prepare</TestCase>           <!-- boilerplate from above -->
    <TestCase>InitialChecks</TestCase>     <!-- assert post-startup state -->
    <TestCase>FunctionA</TestCase>         <!-- exercise + verify -->
    <TestCase>FunctionB</TestCase>
    <TestCase>EdgeCase1</TestCase>
    <TestCase>EdgeCase2</TestCase>
    <TestCase>Cleanup</TestCase>           <!-- logout -->
  </Sequence>
</TestScript>
```

Each meaningful test case usually has 1 setup action + 1–3 compares.
For a complex POU you might have 10–20 test cases, each with 5+
actions. The StopLight test has 7 cases and ~20 actions; that's a
reasonable size. Bigger and you'd want to break it into multiple
scripts that one umbrella script calls.
