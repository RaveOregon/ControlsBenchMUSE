# 02 — Script format

The XML structure of a `.tsd.xml` test script. Skip this if you just
want to copy a template; read it if you want to write scripts from
scratch or fix tooling.

## File extension

- On disk: `<Name> (<Version>).tsd.xml`. The `.tsd.xml` matters when
  you import; Test Manager filters its file picker.
- In the Test Repository: each version is stored under
  `Examples/<Name>/<Version>/entry/entry` (no extension on the inner
  `entry` file). It's the same XML.

## Top-level shape

```xml
<?xml version="1.0" encoding="utf-8"?>
<TestScript>
  <Information>
    <Name>MyTest</Name>
    <Version>1.0</Version>
    <Author>Optional</Author>
    <Description>Optional</Description>
  </Information>
  <Sequence>
    <Assign Variable="..." />        <!-- script-level variables -->
    <TestCase definesScope="False">
      <Information><Title>...</Title></Information>
      <Actions>
        <Action>...</Action>
        <Action>...</Action>
      </Actions>
    </TestCase>
    <TestCase>...</TestCase>
  </Sequence>
</TestScript>
```

Three things to know:

1. **`<Sequence>` is the only direct child of `<TestScript>` besides
   `<Information>`.** No alternative top-level structure.
2. **`<Assign>` elements live directly inside `<Sequence>`** — they're
   how you set script variables. They run in document order *before*
   any `<TestCase>` runs.
3. **Each `<TestCase>` has `<Information>` and `<Actions>`.** The
   `definesScope` attribute controls variable scoping; default `False`
   shares the script-level scope.

## The `<Action>` element

Every action has the same shape:

```xml
<Action>
  <Information>
    <Title>Human-readable title shown in reports</Title>
  </Information>

  <Settings>
    <Entry Name="Condition" />              <!-- expression; empty = always run -->
    <Entry Name="ExecutionDelay">0</Entry>  <!-- ms before this action runs -->
    <Entry Name="ForceEvaluation">False</Entry>
    <Entry Name="IgnoreResults">False</Entry>  <!-- True = don't fail-fast -->
    <Entry Name="ResultVariable" />         <!-- script var to receive the result -->
    <Entry Name="RetryOnError">0|0</Entry>  <!-- retries|delay-between-ms -->
  </Settings>

  <Parameters>
    <Inputs>
      <Parameter Name="someParam" Variable="someScriptVar" />
    </Inputs>
    <Outputs>
      <Parameter Name="someResult" Variable="someScriptVar" />
    </Outputs>
  </Parameters>

  <Command TestRunner="TestManager.<DriverName>" Verb="<ActionName>" />

  <Configuration>
    <Entry Name="..."> ... </Entry>
    <Entry Name="..."> ... </Entry>
  </Configuration>
</Action>
```

The two parts that vary per action: the `<Command>` (which driver +
which verb) and the `<Configuration>` (which entries are required for
this verb). See `03-actions-reference.md` for the actions we've used.

## Variable interpolation

Inside `<Configuration>` entries, you can reference script variables
with curly braces: `{ProjectPath}`. Example:

```xml
<Entry Name="PathToProject">{BasePath}\MyProject.project</Entry>
```

Variables are defined either at script level via `<Assign>`:

```xml
<Assign Variable="ProjectPath">C:\path\to.project</Assign>
<Assign Variable="BasePath" Expression="true">$REPO.PARENTPATH</Assign>
```

`Expression="true"` means evaluate the right-hand side as an
expression (here: pull `$REPO.PARENTPATH`, which is the script's parent
folder).

Or via action `<Parameters>/<Inputs>/<Parameter>` blocks, which scope
to that single action.

## Action settings — the cross-cutting ones

These appear in every `<Settings>` block and affect any action:

| Setting | Effect |
|---|---|
| `Condition` | If non-empty, action only runs when the expression is TRUE |
| `ExecutionDelay` | Milliseconds to sleep before running the action |
| `ForceEvaluation` | Forces re-evaluation of inputs (rarely needed) |
| `IgnoreResults` | If True, action fails are reported but don't fail-fast the rest of the script |
| `ResultVariable` | Script variable to receive the action's primary output |
| `RetryOnError` | `count\|delayms`; how many retries on failure |

Use `IgnoreResults=True` for diagnostic actions where you want to see
whether something works *without* aborting the rest of the script. We
used this in `PathProbe2` to test multiple variable path forms in a
single run.

## Test case scoping

`<TestCase definesScope="False">` shares variables with siblings.
`definesScope="True"` would create an isolated scope (script variables
defined inside the case don't leak outward). For most tests `False` is
right.

## File encoding

UTF-8. Sample files we extracted include unicode characters like the
em-dash (e.g. `RED — STOP` in tooltips). Don't accidentally save as
ASCII.

## Sample structure (annotated)

```xml
<?xml version="1.0" encoding="utf-8"?>
<TestScript>                           <!-- root -->
  <Information>
    <Name>SmokeTest</Name>
    <Version>1.0</Version>
  </Information>
  <Sequence>
    <Assign Variable="ProjectPath">C:\proj.project</Assign>

    <TestCase definesScope="False">
      <Information>
        <Title>Setup</Title>
      </Information>
      <Actions>

        <Action>                       <!-- close any open project -->
          <Information><Title>Close</Title></Information>
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

        <Action>                       <!-- load -->
          <Information><Title>Load</Title></Information>
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
            <Entry Name="PathToProject">{ProjectPath}</Entry>
            <!-- ... other entries ... -->
          </Configuration>
        </Action>

      </Actions>
    </TestCase>

    <!-- more test cases here -->

  </Sequence>
</TestScript>
```

That's it. The schema is verbose because every action carries the same
boilerplate `<Settings>` block, but the meaningful information is
small: which `<Command>`, which `<Entry>` keys in `<Configuration>`.
