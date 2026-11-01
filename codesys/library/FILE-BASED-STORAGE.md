# File-Based Storage migration

User direction: prefer native file-based CODESYS projects for sharing, review and source control. Build new libraries separately now; do not convert or deploy the proven demo during isolation/recovery.

The installed headless probe reports no `fbs` global and no `convert_to_fbs` project method. The installation inventory also did not find a FileBasedStorage component. Therefore native conversion is **not performed**. Plain `.st` source and generated `.library` files must not be presented as a native file-based CODESYS project.

Official API reference:
https://content.helpme-codesys.com/en/CODESYS%20File-Based%20Storage/_fbstrge_scripting.html

The add-on supplies `validate_for_fbs()`, `convert_to_fbs(destination, native_import_handler, update_flags=...)` and `fbs.open(...)`. Objects are stored as text where supported, with XML for other objects. It is an add-on to the current CODESYS installation; migrating to CODESYS 4 is a different decision and unnecessary just to evaluate this sharing format.

## Migration gates

1. Schedule add-on installation with the IDE/runtime owner; preserve the current project and unsaved editor state before an IDE restart. Do not install/restart under another lane's active recovery session.
2. Re-run `scripts/probe-library.py` in an independent headless instance. Record add-on/version and actual FBS API capability; the absence of a method is a blocker, not permission to invent file metadata.
3. Validate a copy of the new library first. Record every conversion warning/error; resolve the actual import-handler API against the installed version. Convert only into a new empty destination.
4. Reopen the converted project with `fbs.open`, compare DUT/FB declarations and implementations to the original source hashes, and rebuild the compiled library and independent consumers. Check namespace/version/dependency resolution and required non-ST object coverage.
5. Add the native source directory and appropriate generated-cache exclusions to Git. Preserve the converted project's real metadata and library-reference/lock files; do not hand-author an allegedly native project around exported ST.
6. Only after this pilot passes, convert a separate copy of the demo/consumer project. Verify tasks, device configuration, symbol publication, timing settings and ST readback. Any later deployment gets a new project/build identity and live regression evidence.

The current binary demo and its old evidence stay available throughout migration. A native file-format change, source export and controller download are separate operations.
