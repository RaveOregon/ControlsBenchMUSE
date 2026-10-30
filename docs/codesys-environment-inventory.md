# CODESYS Environment Inventory

Status: **M0-M2 passed; native MCP, live typed OPC UA exchange, and coherent ordered image commits established**. Initial inventory captured 2026-10-29 and updated 2026-10-30. This does not claim an M3 sustained-rate tier or any M4-M7 output-observation, recovery, task-impact, or closed-loop verdict.

## Detected installation

| Component | Version | Path |
|---|---:|---|
| CODESYS Development System | 3.5.22.30 | `C:\Program Files\CODESYS 3.5.22.30\CODESYS\Common\CODESYS.exe` |
| CODESYS Control service executable | 3.5.22.30 | `C:\Program Files\CODESYS 3.5.22.30\GatewayPLC\CODESYSControlService.exe` |
| CODESYS Gateway service executable | 3.5.22.30 | `C:\Program Files\CODESYS 3.5.22.30\GatewayPLC\GatewayService.exe` |
| CODESYS Installer | 2.6.1.0 metadata | `C:\Program Files (x86)\CODESYS\APInstaller` |

ProgramData contains managed and documented OPC UA server/client libraries, the Datasource OPC UA library, and OPC UA information models.

The shipped `CODESYSControl.cfg` points to an instance working directory under `CODESYS\CODESYSControlWinV3x64\26DDB80B`. No corresponding initialized working directory was found in the current user or ProgramData location during this read-only check. Windows service status could not be read without additional privileges.

Windows service registration is present for all three local components:

| Service | Startup registration | Executable |
|---|---|---|
| CODESYS Control Win V3 - x64 | manual (`Start=3`) | `CODESYSControlService.exe` |
| CODESYS Gateway V3 | automatic (`Start=2`) | `GatewayService.exe` |
| CODESYS ServiceControl | automatic (`Start=2`) | `ServiceControl.exe` |

The registration values do not prove that any service is currently running. Both Service Control Manager status queries returned `Access is denied` in the current session.

## First M0 launch attempt

On 2026-10-29 the exact installed IDE executable reached the **Ready** start page and exposed the expected CODESYS menus, including device login, License Manager, scripting, and OPC UA information-model tooling. Before a project could be created, the IDE process exited and its captured window stopped accepting input. A subsequent process check found no running CODESYS IDE process. No project or runtime configuration was created, and the cause of exit was not observable because Windows event-log access was also denied.

This is a real M0 breakpoint, not a connector failure: the development environment is installed, but a stable IDE session and live Control Win instance still need to be established before measuring OPC UA behavior.

## 2026-10-30 MCP and project checkpoint

- The CODESYS Professional Developer Edition license and official **CODESYS Development System MCP Server 1.1.0.0** are installed.
- `codesys/gngnf.project` opens as a standard project targeting **CODESYS Control Win V3 x64**, with `Device.Plc Logic.Application`, `PLC_PRG`, and `MainTask` present.
- The IDE MCP backend is enabled and its 20 project tools are allowed.
- The exact MCP Bridge is registered globally in Codex as `codesys-ide`.
- An unsandboxed read-only handshake discovered all 20 tools, connected to the running IDE on the first attempt in 20 ms, and returned the active application `Device.Plc Logic.Application`.
- A shell-sandboxed Bridge process sees the two static resources but no dynamic IDE tools because its local application-data path is redirected. This is a diagnostic property of the command sandbox, not a CODESYS failure. Native MCP availability must be verified from a new Codex task because an existing task does not hot-load servers added after it began.

The imported prior-learning bundle is under `codesys/codesys_handoff/`. Its central constraints are accepted for this spike: MCP browse paths include `Plc Logic`, runtime variable addresses do not; Symbol Configuration, device changes, visualization editing, and Test Manager execution remain manual/UI operations; probe paths before authoring full tests.

## 2026-10-30 native MCP verification and M0 read-only recon

The new Codex task loaded the native `codesys-ide` MCP surface successfully. All 20 expected tools were present. The native `get_active_app_as_path` call completed in 0.3 seconds and returned `Device.Plc Logic.Application`; this is no longer only a separate stdio-probe result.

Read-only native MCP recon returned:

- project tree: `Device` -> `Plc Logic` -> `Application` -> `PLC_PRG` and `Task Configuration` -> `MainTask` -> `PLC_PRG`;
- device type: **CODESYS Control Win V3 x64**;
- no configured device I/O channels or connector parameters;
- referenced libraries: `IoStandard`, `3SLicense`, `CAA Device Diagnosis`, `Standard`, and `Breakpoint Logging Functions`;
- `PLC_PRG`: an empty `PROGRAM PLC_PRG` with an empty `VAR` section;
- application-scoped precompile with warnings enabled: no diagnostics returned;
- no active editor selection, which is informational only.

Local read-only version/hash inventory returned:

| Item | Observed value |
|---|---|
| CODESYS Development System | 3.5.22.30 |
| CODESYS Control service executable | 3.5.22.30 |
| CODESYS Gateway service executable | 3.5.22.30 |
| CODESYS MCP Bridge | 1.1.0.0 |
| CODESYS Communication add-on | 4.8.0.0 |
| Node.js | v24.15.0 |
| Node OPC UA client | 2.173.1 |
| Windows registry version/build | 25H2 / 26200.9711 |
| `codesys/gngnf.project` SHA-256 after M0 | `5742E1FC5908F84990DB859895D5429A30206BACA3A4526DBC98885A4A5BF1EE` |

Service Control Manager and CIM status queries remain inaccessible to the Codex shell session, so absence of shell service output is not evidence that the runtime or Gateway is stopped. Runtime state must be observed in CODESYS/Control Win by the operator.

An operator-provided CODESYS Communication Settings screenshot then established the live local communication path:

- Gateway: `Gateway-1`, `localhost`, port `1217`, green/reachable;
- selected device: local **CODESYS Control Win V3 x64**, active and green/reachable;
- device address: `0301.30CD`;
- target ID/type/vendor: `0000 0004` / `4096` / `CODESYS`;
- target version: `3.5.22.30`.

This proves Gateway-to-target reachability. It does not yet prove that the application has been downloaded, logged in, or is running, and it does not prove that an OPC UA endpoint is listening.

The operator then opened `Task Configuration.MainTask` and established:

- task group: `IEC-Tasks`;
- type: cyclic;
- interval: `20 ms`;
- priority: `1` (CODESYS range `0..31`);
- watchdog: disabled;
- call list: `PLC_PRG` only.

These are the initial fixture settings, not yet a measured task-cycle or jitter baseline.

After a diagnostic-free full application compile, the operator logged in, downloaded, and started the minimal application. The online CODESYS view established:

- `Device [connected]`;
- `Application [run]`;
- `MainTask` actively cycling;
- status bar: `RUN`, `Program loaded`, and `Program unchanged`;
- device user: `PLC`.

This proves that the selected Control Win runtime executes the disposable project. It does not yet establish OPC UA server operation, symbol publication, negotiated sampling/subscription values, or a task timing baseline.

The operator logged out and manually added the CODESYS Communication hierarchy that the MCP cannot author:

- `Application.Communication Manager`;
- `Communication Manager.OPC UA Server`;
- `OPC UA Server.IEC Symbol Publishing`;
- the server's `Symbol Set` object.

For a bounded M0 endpoint/authentication smoke test, native MCP then added `GVL_M0Probe` with three `UDINT` scalars:

- `WriteProbe`: intended OPC UA read/write input;
- `EchoProbe`: intended OPC UA read-only PLC echo;
- `PlcCycle`: intended OPC UA read-only IEC scan counter.

`PLC_PRG` increments `PlcCycle` and copies `WriteProbe` to `EchoProbe` every 20 ms scan. Application precompile and full compile both returned no diagnostics. These disposable variables prove transport and access configuration only; they are explicitly not the M1/M2 interceptor contract or typed-signal acceptance evidence.

The operator added all three variables to IEC Symbol Publishing with user-management access enforcement enabled. The declared OPC UA rights are:

| Symbol | IEC type | Symbol access |
|---|---|---|
| `GVL_M0Probe.WriteProbe` | `UDINT` | Read/Write |
| `GVL_M0Probe.EchoProbe` | `UDINT` | Read |
| `GVL_M0Probe.PlcCycle` | `UDINT` | Read |

A post-configuration full compile returned no diagnostics. Runtime symbol rights, endpoint security, authentication, and an actual OPC UA client read/write remain to be proven.

After download/start, a read-only TCP check connected to `127.0.0.1:4840`. A Node.js `node-opcua` endpoint discovery returned two equivalent local URLs (host name and loopback) with:

- security mode: `None`;
- security policy: `SecurityPolicy#None`;
- security level: `0`;
- no advertised user identity tokens.

An attempted anonymous session was rejected because the endpoint description contains no anonymous token policy. This is useful evidence that anonymous access is not silently available, but the server is not yet ready for the product path: with no server certificate it cannot advertise a signed/encrypted endpoint or safely offer username authentication. Certificate generation and secure server settings are the next M0 actions.

The operator generated a self-signed OPC UA Server certificate with a 3072-bit key and 365-day validity. Before hardening, the live `CmpOPCUAServer` settings were:

| Setting | Initial value |
|---|---|
| `CommunicationPolicy` | `POLICY_AES128SHA256RSAOAEP` |
| `CommunicationMode` | `SECURE_IF_POSSIBLE` |
| `Activation` | `ACTIVATED` |
| `UserAuthentication` | `ENABLED` |
| `AllowUserPasswordOnPlaintext` | `NO` |
| `SendCertificateChains` | `YES` |
| `EnableCRLChecks` | `YES` |
| `CreateWithCAFlag` | `NO` |
| `DeactivateApplicationAuthentication` | `NO` |

The certificate identity location and IP/DNS alternative-name fields were initially empty. For this sequestered hackathon bench, the engineer explicitly declined maximum-security hardening. M0 therefore retains the practical CODESYS defaults: `SECURE_IF_POSSIBLE`, `UserAuthentication=ENABLED`, no plaintext password transport, CRL checks enabled, and the generated self-signed certificate. Enforced sign-and-encrypt, enforced non-anonymous authentication, and certificate identity/SAN hardening are not M0 requirements for this fixture. The measured endpoint advertisement and actual session behavior remain authoritative.

After restarting Control Win, endpoint discovery advertised only signed or signed-and-encrypted endpoints for `Aes128_Sha256_RsaOaep`, `Basic256Sha256`, and `Aes256_Sha256_RsaPss`. Every endpoint advertised username authentication with encrypted password transport; no `None` endpoint or anonymous token remained. The M0 client selects `Basic256Sha256` with `SignAndEncrypt` for compatibility. Its first secure-channel attempt was rejected as expected pending one-time trust of the Node OPC UA client certificate in the controller certificate store.

The operator moved the `NodeOPCUA-Client` certificate from the controller quarantine store to trusted. A retry then established the secure channel successfully with `SignAndEncrypt` and `Basic256Sha256`. Username-authenticated session creation and the bounded symbol read/write/access-right smoke remain outstanding; credentials are entered only through a masked local prompt and are not persisted in the result artifact.

The masked local credential run then completed the authenticated M0 smoke:

- a username session opened over `SignAndEncrypt` / `Basic256Sha256`;
- all three `UDINT` nodes browsed and read with `Good` status;
- writing `23130` to `WriteProbe` returned `Good` and `EchoProbe` became `23130`;
- `PlcCycle` advanced from `548` to `557` during the bounded check;
- writes to `EchoProbe` and `PlcCycle` both returned `BadNotWritable`;
- node and user access masks were `3` (read/write) for `WriteProbe` and `1` (read) for the other two nodes.

Subscription negotiation requested 50 ms publishing and 20 ms sampling. The server revised both to 100 ms, with lifetime count 100 and max keepalive count 10. This establishes the effective configured OPC UA sampling floor as 100 ms for M0; no explicit active-runtime override was accessible, and the measured revision matches the documented/default configuration. It is not an M3 rate-tier pass.

### Post-M0 sampling-floor experiment

Before beginning M1/M2, the engineer authorized a reversible attempt at a faster OPC UA cadence. `codesys/scripts/set-opcua-min-sampling.ps1` created a timestamped backup of the active Control Win configuration and set only `CmpOPCUAServer.ItemMinSamplingRate=20`; Control Win was then restarted.

Two authenticated negotiation checks followed:

| Runtime setting | Requested publish | Revised publish | Requested sample | Revised sample |
|---|---:|---:|---:|---:|
| Default/implicit floor | 50 ms | 100 ms | 20 ms | 100 ms |
| `ItemMinSamplingRate=20` | 50 ms | 60 ms | 20 ms | 20 ms |
| `ItemMinSamplingRate=20` | 20 ms | 20 ms | 20 ms | 20 ms |

The tuned server therefore accepts a negotiable 50 Hz publish/sampling cadence. Preserve the 20 ms setting for M1/M2 and measure it under sustained load in M3/M6. Negotiation alone does not prove applied-image rate, latency distribution, loss/coalescing, PLC task health, or any product tier.

The frozen logical signal map is `codesys/artifacts/m0-opcua-signal-map.json`, SHA-256 `C2C0BD4738DC52A9B77EEBF0656D8E245CA6ED8F362894D2C22C7AFF3817D430`. The raw non-secret session result is `codesys/artifacts/m0-opcua-session.json`.

## M0 verdict

**Pass on 2026-10-30.** IDE/runtime/add-on/client versions, task configuration, live target identity, endpoint and authentication policy, exported scalar types and rights, project and signal-map hashes, and requested/revised timing parameters are reproducible. The application executes on Control Win and the authenticated OPC UA client can read, write, observe the PLC echo, and enforce read-only symbols.

The next gate was M1/M2 fixture construction and measurement. Do not interpret the 100 ms M0 smoke, three disposable `UDINT` symbols, or the successful echo as typed-signal coverage, atomic image coherence, rate acceptance, or closed-loop conveyor evidence.

## Remaining after M2

- task-cycle/jitter baseline;
- M3-M7 rate, output-observation, disconnect, task-impact, or closed-loop evidence;
- whether the accepted 20 ms OPC UA cadence survives sustained M3/M6 load within the required latency and task-health thresholds.

The smallest double-buffered epoch/sequence interceptor was then built behind the frozen logical contract and its exact scalar fields were exported before connecting the generated conveyor world.

## M1 typed-scalar result

**Pass on 2026-10-30.** The live authenticated client resolved 86 exported scalar nodes from the two qualified GVL symbols and completed 25 accepted commits. It covered all 15 BOOL inputs, all four REAL inputs using Float32-exact comparison, and the UDINT encoder at zero, one, `2^32-2`, `2^32-1`, and declared rollover. Twenty rapid alternating complete images also matched the application-visible active image.

Three invalid payloads were rejected and attributed without advancing the applied revision: negative belt speed, non-finite drive current, and position above the declared fixture range. The five fixture outputs were type-checked as BOOL, the PLC boot identity was nonzero, and monotonic PLC time advanced. Output-transition visibility remains reserved for M4.

The non-secret result is `codesys/artifacts/m1-opcua-result.json`, SHA-256 `6A54C413D177CD77B23786D35D0772EF40777FA6AF4AE736DF37EBD1C60A6531`. The exact tested project snapshot before M2-only instrumentation was SHA-256 `DDB03B56D2358EC57527747C3501C57A091EBF06E2C268E8364ED496305B3F01`.

## M2 coherence and ordering result

**Pass on 2026-10-30.** The authenticated pre-restart phase applied and verified 10,000 deterministic alternating images with zero torn active images. Sent sequences 1 through 10,000 and the downstream output-capture cycles were both strictly monotonic. Every accepted image matched one complete deterministic revision.

Adversarial cases covered duplicate, stale, skipped sequence, invalid slot, incomplete slot, premature valid, mismatched slot metadata, reconnect before explicit commit, old epoch after reconnect, and explicit workstation reset/new epoch. Rejected revisions left the active image unchanged. Counter deltas were exact: 10,004 applied commits, two session resets, and one each for duplicate, stale, skipped, invalid-slot, invalid-payload, metadata-mismatch, and epoch-rejected attribution.

The operator then performed `Online -> Reset Cold` and restarted RUN. The short post-restart phase observed boot identity change from `1419486354154` to `1419755446149`, observed cleared epoch/sequence state, and accepted sequence 1 under new epoch `117530907357098065`. Both phases passed, so M2 is complete.

The 10,000-image verification latency distribution was min 1.732 ms, p50 15.502 ms, p95 30.976 ms, p99 31.353 ms, and max 43.854 ms. This is M2 coherence-driver timing, not an M3 sustained-rate or M6 task-impact verdict.

The final result is `codesys/artifacts/m2-opcua-result.json`, SHA-256 `ACAF85FCE770DFBD3A480BC717B2F75A801F43606CE9230780AC40E032364317`. The 10,000-row raw trace is `codesys/artifacts/m2-coherence-trace.jsonl`, SHA-256 `1D0CD4A604C767E2419C18512855BA6435D70D78833FC9B5B3D54D6B3A85241A`. The tested final project is SHA-256 `1A13DAEF6048E6B7A2491285D82848CC98DA09090278DA40068ED443D8364D64`.

The final contract uses `RequestedSequence` as the single write-last commit edge. Six fields created during an attempted richer capture revision remain published as compatibility placeholders because CODESYS retained them in the structured symbol type; no M2 assertion depends on those placeholders.
