# CODESYS Measurement Project

This directory contains the disposable Control Win project and measurement artifacts used to execute M0-M7 from `docs/codesys-opcua-measurement-plan.md`.

It is a connector/runtime proof fixture, not the final platform-specific interceptor library.

## Current fixture

- `gngnf.project` is the minimal CODESYS Control Win V3 x64 project.
- `codesys_handoff/` is the imported prior-learning bundle for the official CODESYS MCP Server, Test Manager, variable paths, deployment methodology, and OPC UA/browser relay patterns.
- `scripts/probe-codesys-mcp.mjs` performs a read-only stdio handshake against the installed Bridge. On 2026-10-30 it discovered 20 tools and returned the active application `Device.Plc Logic.Application` when run outside the command sandbox.

The installed Bridge is:

`C:\Program Files\CODESYS 3.5.22.30\CODESYS\CODESYS MCP Server\1.1.0.0\CodesysMCPBridge\CodesysMCPBridge.exe`

Codex has this registered globally as `codesys-ide`. On 2026-10-30 a new task loaded all 20 native tools, returned `Device.Plc Logic.Application`, browsed the minimal project, and completed an application-scoped precompile with no diagnostics. The remaining runtime and OPC UA questions from that checkpoint were closed by M0 below.

## M0 result

M0 passed on 2026-10-30. The Control Win target executed the 20 ms fixture; the local Gateway and OPC UA endpoint were reachable; a self-signed server certificate enabled signed/encrypted username endpoints; and a trusted Node OPC UA client completed authenticated browse/read/write/access-right checks. A 50 ms requested publish interval and 20 ms requested sampling interval were both revised to 100 ms.

Immediately after M0, a reversible configuration experiment set `ItemMinSamplingRate=20`. The server then accepted 20 ms publishing and 20 ms sampling without revision. This permits a 50 Hz negotiated cadence but is not an M3 sustained-rate or M6 task-impact pass.

- Probe: `scripts/probe-opcua-m0.cjs`
- Masked credential wrapper: `scripts/run-opcua-m0.ps1`
- Reversible sampling-floor setter: `scripts/set-opcua-min-sampling.ps1`
- Logical signal map: `artifacts/m0-opcua-signal-map.json`
- Non-secret raw result: `artifacts/m0-opcua-session.json`
- Sampling comparison: `artifacts/opcua-sampling-experiment.json`
- Full inventory and verdict: `../docs/codesys-environment-inventory.md`

This is installation and transport evidence only; the completed M1 result is recorded separately below.

## M1 result

M1 passed on 2026-10-30 against the live Control Win application over the authenticated `Basic256Sha256` / `SignAndEncrypt` OPC UA session. The probe resolved 86 published scalar nodes and exercised the application-visible active image rather than merely reading the staging slots.

- all 15 BOOL inputs passed zero, one, patterned, and rapid-alternation cases;
- all four REAL inputs round-tripped at Float32 bit width with representative finite and boundary values;
- the UDINT encoder passed `0`, `1`, `2^32-2`, `2^32-1`, and declared rollover;
- negative speed, non-finite current, and out-of-range position were rejected without changing the active image and incremented the invalid-payload diagnostic;
- the five PLC-to-world fixture outputs were exposed as BOOL; their transition/observation behavior remains an M4 measurement;
- PLC boot identity was nonzero and monotonic PLC time advanced.

The non-secret result is `artifacts/m1-opcua-result.json` (SHA-256 `6A54C413D177CD77B23786D35D0772EF40777FA6AF4AE736DF37EBD1C60A6531`). The tested project snapshot before M2-only instrumentation had SHA-256 `DDB03B56D2358EC57527747C3501C57A091EBF06E2C268E8364ED496305B3F01`.

## M2 result

M2 passed on 2026-10-30. The pre-restart phase applied and verified 10,000 deterministic alternating images with zero torn active images, complete sequence coverage from 1 through 10,000, and strictly increasing downstream output-capture cycles. The duplicate, stale, skipped-sequence, invalid-slot, incomplete-slot, premature-valid, mismatched-metadata, reconnect-before-explicit-commit, old-epoch, and workstation-new-epoch cases all left or changed state exactly as contracted and incremented the exact expected diagnostic counter once.

The operator then performed an explicit CODESYS cold reset. The post-restart phase observed the boot identity change from `1419486354154` to `1419755446149`, confirmed cleared epoch/sequence state, and accepted sequence 1 in a new epoch. The result is therefore complete rather than a pre-restart-only pass.

The 10,000-image verification latency was min 1.732 ms, p50 15.502 ms, p95 30.976 ms, p99 31.353 ms, and max 43.854 ms. These bounded M2 measurements are useful evidence but are not an M3 sustained-rate tier verdict.

- Driver: `scripts/probe-m2.cjs`
- Masked credential wrapper: `scripts/run-m2.ps1`
- Final result: `artifacts/m2-opcua-result.json`, SHA-256 `ACAF85FCE770DFBD3A480BC717B2F75A801F43606CE9230780AC40E032364317`
- Raw trace: `artifacts/m2-coherence-trace.jsonl`, 10,000 rows, SHA-256 `1D0CD4A604C767E2419C18512855BA6435D70D78833FC9B5B3D54D6B3A85241A`
- Final M2 project: `gngnf.project`, SHA-256 `1A13DAEF6048E6B7A2491285D82848CC98DA09090278DA40068ED443D8364D64`

`RequestedSequence` is the single write-last commit edge. Six already-configured symbol members are retained as compatibility placeholders after CODESYS preserved their structured symbol-type membership; M2 does not rely on them.
