# CODESYS Environment Inventory

Status: **pre-spike read-only inventory**. Captured 2026-10-29. This proves installed files, not that the runtime, Gateway, OPC UA endpoint, license, or a ControlsBench project is operational.

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

## Not yet established

- Control Win runtime started and licensed;
- Gateway service started and reachable;
- OPC UA server enabled, configured, secured, and listening;
- actual `ItemMinSamplingRate` or other server overrides;
- device user and OPC UA certificate state;
- a CODESYS project containing the demo PLC and ControlsBench interceptor;
- task interval, task jitter baseline, symbol map, endpoint, or live node IDs;
- any M0-M7 measurement from `docs/codesys-opcua-measurement-plan.md`.

The next live step is M0: start CODESYS deliberately, create/open the first project, inventory the selected Control Win device and runtime, and configure the Communication Manager/IEC Symbol Set without yet claiming timing performance.
