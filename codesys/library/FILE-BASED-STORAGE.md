# File-Based Storage

**Status: available and piloted on the library.** CODESYS File-Based Storage 1.0.0.0 is installed in the `CODESYS V3.5 SP22 Patch 3` profile of CODESYS 3.5.22.30. The user enabled it on 2026-11-01 at about 12:40 EST; the profile file changed at 12:40:56. The negative probe recorded earlier that day (10:12) predates the installation and is superseded.

Official references: [scripting API](https://content.helpme-codesys.com/en/CODESYS%20File-Based%20Storage/_fbstrge_scripting.html) and [storage format](https://content.helpme-codesys.com/en/CODESYS%20File-Based%20Storage/_fbstrge_storage_format.html).

## Probe (`scripts/probe-fbs.py`)

An independent headless process created a throwaway library with a structure, a union, a constant GVL, a function block and a function, then converted a copy.

- The `fbs`, `FBSValidationStatus`, `NativeImportHandler` and `NativeImportResolve` globals and the `validate_for_fbs` and `convert_to_fbs` methods exist.
- `convert_to_fbs` rejects a bare directory ("Path is outside a project"). A destination named `<name>.fbslib` works.
- After conversion CODESYS opens an empty primary project, which the script closes. `fbs.open` on the `.fbslib` directory reopens the library; declarations and implementations read back exactly, and it compiles.

## Library pilot (every build)

`build-library.py` converts a **copy** of the binary core library, never the original:

1. `validate_for_fbs` reports one warning: "Project integrity check is enabled. This setting is not supported in a file-based project." No errors.
2. `convert_to_fbs` completes with no conflict, skipped object or import exception.
3. `fbs.open` reopens it; all 19 objects match Git's `source/` text; project info keeps title, company, version 0.2.0.0, namespace `CB` and placeholder `ControlsBenchCore`.
4. The native library compiles with zero errors and warnings and is saved as `ControlsBenchCore.fbs.compiled-library`.
5. A copy without `.sidecars/` and `.auxiliaries/` (the Git subset) reopens and compiles; no file changed on reopen.
6. Both consumers are rebuilt against the FBS-built compiled library.

Format observations for these library objects: object files are plain ST with the declaration followed by the implementation and terminator, and no `(* METADATA *)` header was written. A GVL is stored with a `NAMESPACE <name>` … `END_NAMESPACE` wrapper; the IDE's textual declaration does not contain it. `scripts/audit-build.mjs` compares every native object file with the reviewed source on that basis.

## What is in Git

`builds/prototype-0.2.0.0/ControlsBenchCore.fbslib/` is the native editable form of 0.2.0.0, exactly as CODESYS wrote it:

- object files (`*.fb.st`, `*.fn.st`, `*.struct`, `*.union`, `*.gvl`);
- `ProjectInfo.json`, `Workspace.fbsws`, `Preferences/*.prefs.json`;
- `Project Settings.workspace.xml.v3` (project settings in CODESYS's own XML serialization);
- `.FBS_Project_Related/` (profile and plug-in requirements CODESYS records with the project).

Excluded: `.sidecars/` (per-user `.opt` files and precompile cache) and `.auxiliaries/` (precompile and save-context caches). `.gitignore` also excludes them if someone opens the snapshot in place. No native metadata was written by hand.

The snapshot is immutable evidence. To edit natively, copy it elsewhere, open the copy (File → Open, or `fbs.open`), and start a new version (gate G-FBS-2).

## Not done in this lane

- `source/*.st` remains the edited source for 0.2.0.0; the native project is produced from it and verified identical. Making the native project the edited source is gate G-FBS-2.
- The consumer projects remain binary. They are build outputs, not shared sources.
- The live demo was not converted here. The main checkout holds the user's own conversion, `codesys/FileBasedConveyorDemo/conveyordemo.fbsproj` (untracked); this lane only read its layout. If it is committed, consider excluding its `.sidecars/` (per-user `.opt`, about 6 MB each of `.compileinfo` and `.bootinfo`) and `.auxiliaries/`. Its project-hash relationship to the frozen demo evidence is a separate integration decision.
- No add-on was installed and no IDE was restarted by this lane.
