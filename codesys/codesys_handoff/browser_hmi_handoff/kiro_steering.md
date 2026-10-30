---
inclusion: manual
---

# Kiro / agent steering — CODESYS browser HMI demo

If you're an AI assistant working on this project, this file collects the
patterns and pitfalls another agent already paid for. Save the operator
the iteration cost we did.

## What this project is

A two-architecture demo of driving a custom browser HMI from a CODESYS
PLC. Two paths exist side by side:

- **MQTT bridge** in `stoplight/` + custom POU on the PLC (`Mqtt_Bridge`).
- **OPC UA + relay** in `opcua_relay/` + Symbol Configuration on the PLC.

See `HANDOFF.md` and `docs/README.md` for the full picture.

## Tools available

The user has the **CODESYS Development System MCP Server** running. It
gives you 19 tools that read/write the project's textual content:

- `browse_project_tree`, `search_path_by_glob`, `search_in_files_by_regex`
- `get_structured_text_content`, `create_or_replace_structured_text_object`,
  `replace_text_in_structured_text`
- `add_program_call_to_task`, `add_library`, `create_folder`, `remove_object`
- `check_for_errors` (precompile by default; `compile=true` for full build)
- `get_active_app_as_path`, `get_active_path_and_selection`
- `get_libraries_referenced_in_application`, `get_available_libraries_list`,
  `get_library_documentation`, `get_detailed_library_documentation`,
  `search_libraries_for_type`
- `get_device_and_io_configuration`

What the MCP **cannot** do:

- Live runtime values (no online login, no read/write at runtime, no force).
- Project lifecycle (open / close / save / archive).
- Graphical languages (SFC, LD, FBD, CFC) — ST only.
- Visualization authoring or property editing — limited via IronPython
  scripts; only 19 element-type primitives reachable.
- Static-analysis or build settings.
- Device tree mutation (read-only via `get_device_and_io_configuration`).
- Symbol Configuration creation or toggling.
- IO mapping changes.

If the user asks for any of those, the path is usually:

1. Tell them what's not reachable.
2. Offer to author an IronPython script (the user runs it via
   **CODESYS → Tools → Scripting → Execute Script File…**).
3. Or describe the click sequence in CODESYS.

## Proven patterns

### When you need to write ST

Use `create_or_replace_structured_text_object` with a fully-formed POU
(declarations + body). Include any methods/properties as nested under
the parent — the tool handles the structure.

### When checking errors

Always run `check_for_errors(compile=false)` first (faster precompile).
If that comes back clean, optionally `check_for_errors(compile=true)` for
a full build.

### When the static analyzer screams "always FALSE" or "Cognitive Complexity"

These are precompile-only false positives in standalone POUs whose inputs
are never written elsewhere in source. They don't block actual codegen.

- Try `{attribute 'analysis' := '-33,-11'}` at the POU header.
- If the pragma doesn't suppress, run `check_for_errors(compile=true)` to
  confirm the full compile passes anyway. If it does, move on.

### When `VAR_INPUT` rejects writes

PROGRAMs and POUs can't write to their own `VAR_INPUT` from inside
methods. If you find yourself wanting convenience methods that "set the
input," accept that the caller writes the input directly (`Main.iCommand
:= ...`). Don't try to work around it with self-modifying tricks.

### When a tool fails with "Object mapping is not supported"

Some object types (Visualization, Symbol Configuration, Task config)
aren't supported by the MCP. Don't try to read or write them — fall back
to scripting (IronPython) or guide the user through clicks.

## Known pitfalls (already paid for; please don't repeat)

| Symptom | Cause | Fix |
|---|---|---|
| MQTT bridge compiles but nothing publishes | Forgot `xEnable := TRUE` on `MQTTClient` | Add `xEnable := TRUE` |
| "String variable too short for VAR_IN_OUT" | Topic strings in MQTT lib must be exactly `WSTRING(1024)` | Declare as `WSTRING(1024)` |
| OPC UA `Cannot find ANONYMOUS user token policy` | Server doesn't accept anonymous yet | Device editor → Security Settings sub-menu → enable Anonymous + None policy. Then **restart the runtime via system-tray icon, not just the application** |
| OPC UA endpoint settings ignored after change | Online change doesn't apply OPC UA endpoint config | Stop application, stop runtime via tray, restart runtime, redownload |
| Browser WebSocket "connecting…" forever | Another process bound to the relay's port (Quickwork agent on this user's machine grabs 8765) | Check `netstat -ano \| Select-String ":<port>"`. Pick a less-common port like 9876. Bind relay to `0.0.0.0` and connect using `127.0.0.1` (avoids IPv4/IPv6 lottery) |
| Visu lamps render grey instead of red/yellow/green | Lamp on/off colors aren't reachable via Visu scripting API | Edit by hand in CODESYS, or use the browser-side custom HMI |
| Bar Display widget "missing" from Visu script | The script-engine `VisualElementType` enum has 19 primitives; advanced widgets not exposed | Drag from the toolbox by hand, or build the visual using primitives + browser CSS |
| Multiple node.exe holding the same port | Old relay processes weren't killed cleanly | Use `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` to enumerate, kill explicitly with `Stop-Process -Id <pid> -Force` |
| `sc query mosquitto` returns nothing | PowerShell aliases `sc` to `Set-Content` | Use `sc.exe query mosquitto` |
| **Test Manager `LoadProject` wipes in-memory project state** | If the project is open with unsaved changes, `LoadProject` reloads from disk and throws away your unsaved POUs/Visus/Symbol Configs | **Always save the project (`Ctrl+S`) before running a Test Manager script that does `LoadProject`.** Best practice: don't run Test Manager against a project that's actively being edited; close the editing IDE session first or save and reload manually |
| Test Manager `CompareVariable` "Invalid Expression" | Wrong path form | Format is `Device.<ProgramName>.<varname>`, NOT `Device.Application.<...>` (the Application part is implied by `SetActiveApplication`) |
| Test Manager `SetCommunicationPath` "Required configuration entry LoginUsername is missing" | Some configs are required even when `UseCredentials=False` | Add empty `LoginUsername` and `LoginPassword` entries |

## Iterative workflow that works

When something doesn't work the first time, the pattern that consistently
helps:

1. **Probe before building.** If unsure of a property name or API shape,
   add a throwaway element/test, write to a log file (`flush_log()`), then
   read the log on the human's machine to learn what's available.
2. **Log to a known file path.** The CODESYS Scripting message view is
   sometimes empty; `flush_log()` to a workspace file is reliable.
3. **Clear and rebuild.** Don't try to incrementally edit Visu elements;
   wipe with `remove_id()` and re-place. Idempotent runs.
4. **Pin the unknown.** When the property name dictionary is undocumented,
   try ~20 candidates with `try/except` and log which succeeded. Real
   answers are better than guessing.
5. **Don't loop on a fix.** If the same approach has failed twice, step
   back. The right move is usually a different architecture, not another
   tweak.

## Conventions used in this project

### Naming

- Enums prefixed `E_` (`E_LightState`, `E_SystemCommand`).
- Enums use `{attribute 'qualified_only'}` and `{attribute 'strict'}`.
- POU inputs prefixed `i` (BOOL: `iSwitch`, INT: `iCommand`).
- POU outputs prefixed `q` (`qRed`, `qConnected`).
- Internal members prefixed `_` (`_state`, `_lastVal`).
- Methods PascalCase (`TransitionTo`, `RaiseFault`).
- Private to a POU → use `PRIVATE` keyword on methods.

### File structure

- IronPython scripts for CODESYS Visu live in
  `../codesys_project_notes/visu_scripts/`.
- Script logs go to the same folder as the script (`*.log`).
- Browser HMI code lives in folders named after the path
  (`stoplight/` for MQTT, `opcua_relay/` for OPC UA).
- Documentation lives in `docs/`.

## When in doubt

Read `docs/04-troubleshooting.md` and the relevant `0X-*.md` for the
component you're working on. They were written immediately after the
problems they describe. The author won't have remembered details a
month later — but the docs do.

## Things that haven't been built yet

See `../codesys_project_notes/CODESYS_SCRIPTING_BACKLOG.md`. If the operator says
"go do X from the backlog," that's where the current ideas are tracked.
