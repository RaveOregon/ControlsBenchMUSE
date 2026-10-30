---
inclusion: manual
---

# CODESYS MCP — what works, what doesn't

The CODESYS MCP bridge gives you tools prefixed `mcp_codesys_ide_*`.
This is what we've learned about using them effectively.

## What works reliably

- **`browse_project_tree`** — tree navigation. Always works.
- **`get_structured_text_content`** — read POUs, GVLs, structs, enums,
  methods. Works on most ST text. Returns the raw declaration +
  implementation.
- **`search_in_files_by_regex`** — full-text search across all ST in
  the project. Great for "where is `GVL_Foo.bar` referenced?".
- **`search_libraries_for_type`** — find which library a type lives
  in. Use this to confirm namespaces.
- **`get_libraries_referenced_in_application`** — list of libraries +
  namespaces. Always check this when paths fail; library namespaces
  matter.
- **`check_for_errors`** — run pre-compile checks. Use `compile=False`
  for fast static checks; `compile=True` only when you suspect
  linker/layout issues. Most "errors" you'll see are static-analysis
  noise (unused vars, notation casing, complexity warnings) — not
  real compile errors.
- **`get_active_app_as_path`** — confirms the active application path.
  Should be `Device.Plc Logic.Application` for most projects.
- **`replace_text_in_structured_text`** — targeted ST edits. Faster
  and safer than rewriting whole POUs for small changes.
- **`create_or_replace_structured_text_object`** — creates POUs / GVLs
  / enums / structs. Works on most projects.

## What doesn't work

- **POUs with SFC content** — `get_structured_text_content` and
  `create_or_replace_structured_text_object` throw
  `NullReferenceException` on POUs that contain SFC actions or
  graphical elements. The bridge can't serialize those.
- **Visualization elements** — the bridge can't author or read .visu
  objects, change visu element properties, or modify the visu interface
  editor. These are CODESYS-UI manual steps.
- **Symbol Configuration changes** — to expose variables for OPC UA,
  you have to add them via the Symbol Configuration editor in the IDE.
  The bridge can't.
- **Device type changes** — switching from Linux SL to Win V3 x64 (etc.)
  is a manual `Update Device` action in CODESYS. Don't try to script it.
- **Static analysis settings** — modifying which warnings are errors
  is UI-only.
- **Test Manager itself** — running tests, importing scripts, exporting
  reports. The MCP bridge has no Test Manager interface. You author
  `.tsd.xml` files via regular file write tools; the operator imports
  and runs them in CODESYS.

## When the bridge throws NullReferenceException

It's almost always: the POU/object you're touching contains some
non-ST element type the bridge can't serialize. Common cases:

- POU with SFC actions
- POU with action diagrams
- POU references inside a Library Manager that the bridge can't
  enumerate
- **Whole-project authoring quirks** — on some projects (we saw this
  on a real Amazon IBIS production project), even creating a brand-new
  empty POU under `Application` throws NullRef. The bridge's authoring
  paths can fail project-wide. If you hit this, the project's
  read paths usually still work; treat the bridge as read-only and
  have the operator paste new POUs manually.

Workarounds, in order of preference:

1. **Read a different POU** for the info you need. The data you want
   is often in a related GVL or struct.
2. **Search by regex** instead of reading. `search_in_files_by_regex`
   often gives you what `get_structured_text_content` can't.
3. **Tell the operator to do it manually.** If the bridge can't
   create a POU under `Device.Plc Logic.Application.Project`, write
   out the ST source and have the operator paste it in. Costs the
   operator 30 seconds; saves you a wasted retry loop.

## What the bridge sees vs. what CODESYS shows

The MCP tree shows objects with **dotted paths**. The CODESYS
Devices tree shows the same hierarchy with intermediate nodes (like
`Plc Logic`) that **do** appear in browse paths but **don't** appear
in variable addresses. See `03-variable-paths.md`.

## Useful patterns

### "What is at the application root?"

```
mcp_codesys_ide_browse_project_tree(
  rootPath="Device.Plc Logic.Application",
  maxItems=200
)
```

### "Where is variable X used?"

```
mcp_codesys_ide_search_in_files_by_regex(
  pattern="GVL_Foo\\.bar",
  maxMatches=20
)
```

### "What library defines type Y?"

```
mcp_codesys_ide_search_libraries_for_type(searchString="GVL_Simulation")
```

Returns the library name + namespace. Useful when the project uses a
type that doesn't appear in the project's own ST.

### "Did my last edit break anything?"

```
mcp_codesys_ide_check_for_errors(
  path="Device.Plc Logic.Application.MyPOU",  # narrow scope
  compile=False
)
```

Narrow `path` to the object you just edited; widen scope only after
that's clean.

## Don't do

- **Don't read multiple files in series when you can search.** A
  regex search across the project is one call. Reading 20 POUs to
  find the one with the variable is 20 calls.
- **Don't use `compile=True` for routine error checks.** Pre-compile
  (`compile=False`) catches 95% of issues and runs in seconds.
- **Don't try to author SFC.** Tell the operator. Same for Visu and
  Symbol Configuration.
- **Don't trust that an MCP tool will work everywhere.** The bridge
  has project-specific quirks (SFC POUs, library-internal objects).
  If a call fails, try a less-specific approach (browse instead of
  read; search instead of browse).
