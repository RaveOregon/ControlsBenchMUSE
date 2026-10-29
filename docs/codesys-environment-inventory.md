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
