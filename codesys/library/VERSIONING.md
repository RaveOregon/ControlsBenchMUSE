# Versioning and compatibility policy

Five interfaces change at different rates, so each has its own version. One library version does not prove the others compatible. A consumer records all of them.

| Interface | Identifier | Where it lives | Current | Breaking change means |
|---|---|---|---|---|
| Package | CODESYS library version `major.minor.build.revision` | `library.json`, library project info | `0.2.0.0` | Any change to compiled content. Every promoted build has a unique package version. |
| Public API | `GVL_CB.API_VERSION_MAJOR.MINOR` | `source/GVL_CB.st` | `0.2` | Removing or retyping a public FB pin, DUT member or constant, or changing a documented meaning. Adding optional members is additive. |
| Adapter protocol | `GVL_CB.PROTOCOL_VERSION`, echoed in `Status.ProtocolVersion` | `source/GVL_CB.st`, `ST_CB_Status` | `2` | Changing request, slot or status layout or semantics that a workstation writer or reader relies on. |
| Observation frame | `GVL_CB.FRAME_FORMAT_VERSION`, echoed in `Frame.FrameFormat` | `source/GVL_CB.st`, `ST_CB_ObservationFrame` | `1` | Changing the frame layout or the meaning of any frame field. |
| Machine map | map format `controlsbench.machine-map/0.1`; per map `mapVersion`, `SchemaId`, `TapSchemaId`, `engineeringVersion` | `mappings/*.map.json`, `mappings/generated/*.manifest.json` | format `0.1` | `SchemaId` changes whenever the raw input/output wire shape changes; `TapSchemaId` whenever the tap list changes. Engineering metadata changes never change either fingerprint. |
| Recording | `controlsbench.recording/<version>` | `schemas/recording.draft.schema.json` | `0.1-draft`, reserved | Not implemented. Gate G-REC-1 freezes version 1 with executed tests. |

The profile `controlsbench.codesys.raw-banks/0.2` names the combination of API, protocol, frame format and bank capacities that a CODESYS consumer may assume.

## Rules

1. **Promoted builds are immutable.** `builds/<label>/` and its `builds/index.json` entry are never edited after commit. `promote-build.mjs` refuses to overwrite, and `build-library.py` refuses to build a version that is already promoted. A fix gets a new package version.
2. **Promotion needs a clean tree.** The build records the Git commit and any dirty library paths; only a clean build can be promoted. The audit then checks every recorded source hash against that commit, so a build stays verifiable after the sources move on.
3. **Old evidence stays.** `prototype-0.1.0.0` remains in place and is re-audited against commit `3d86189`. New results never overwrite or reinterpret old ones.
4. **Prototype versions (`0.x`) may break between minor versions.** The changelog lists every break. From `1.0.0.0`, API and protocol breaks need a major version and a migration note.
5. **Wire identity is computed, not typed in.** `cb-map.mjs` derives `SchemaId` and `TapSchemaId` from the map. A workstation compares them with `Status.SchemaId` and `Frame.TapSchemaId` before writing or interpreting data.
6. **Development rebuilds** of an unpromoted version may replace that version in the dedicated development repository (`repository/`, ignored by Git). Consumers record the hash of the exact compiled library they compiled against.
7. **Native File-Based Storage** snapshots are promoted with each build. Edit a copy, never the promoted snapshot; the audit detects any change to it.

## Compatibility matrix

| Package | API | Protocol | Frame | Map format | Recording | Toolchain | Consumers compiled | Runtime evidence | M8 wire-compatible |
|---|---|---|---|---|---|---|---|---|---|
| 0.1.0.0 | prototype 0.1 | 1 | none | none | none | CODESYS 3.5.22.30 | consumer library, consumer application | none | no |
| 0.2.0.0 | 0.2 | 2 | 1 | 0.1 | 0.1-draft (reserved) | CODESYS 3.5.22.30, SP22 Patch 3 profile, FBS 1.0.0.0 | consumer library and application, each against the binary-built and the FBS-built core | none | no |

The in-project M8 interceptor (`codesys/demo/source/FB_BenchIntercept.st`, signal map `m8-conveyor-1.0.2`, interface 1) is a separate protocol family. Its interface number is unrelated to the library's protocol number. Moving the demo to the library needs a new map, a new build identity and the deployment gates in `CAPABILITIES.md`.
