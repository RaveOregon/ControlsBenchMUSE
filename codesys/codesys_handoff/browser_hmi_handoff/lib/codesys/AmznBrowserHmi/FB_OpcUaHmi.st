// FB_OpcUaHmi — OPC UA-side helper.
//
// In the OPC UA path, the runtime's built-in server does the heavy lifting.
// You don't actually need a function block: just add a Symbol Configuration
// to your Application, tick the variables you want to expose, and rebuild.
//
// This FB exists to:
//   1. Be a clear "marker" that an OPC UA HMI is in use, so anyone
//      reading the project sees the same FB-based shape as the MQTT path.
//   2. Provide a few diagnostic counters that update as long as it's
//      called (useful as a heartbeat for the relay or external clients).
//   3. Optionally carry version metadata about the project's HMI contract,
//      readable via OPC UA, so the browser can refuse to render against
//      an incompatible PLC.
//
// Usage:
//
//   VAR
//       hmi : AmznBrowserHmi.FB_OpcUaHmi(sContractVersion := '1.0');
//   END_VAR
//
//   hmi();   // call once per scan; updates qScanCounter and qHeartbeat
//
// Then in your Symbol Configuration, expose `hmi.qScanCounter`,
// `hmi.qHeartbeat`, and `hmi.qContractVersion` so external tools can see
// the PLC's heartbeat and the contract it expects.

{attribute 'analysis' := '-33,-11'}
FUNCTION_BLOCK FB_OpcUaHmi
VAR_INPUT
    // Optional: pin an HMI contract version that browsers can check.
    // Suggested format: semver-ish "MAJOR.MINOR".
    sContractVersion : STRING(16) := '1.0';

    // Heartbeat period in scans. Default flips qHeartbeat every 100 scans
    // (~1s on a 10ms task; tune for your scan rate).
    uiHeartbeatPeriod : UINT := 100;
END_VAR
VAR_OUTPUT
    // Counters / state visible to any OPC UA client.
    qScanCounter      : UDINT;
    qHeartbeat        : BOOL;
    qContractVersion  : STRING(16);

    // First-scan flag — useful for letting browsers detect a PLC restart.
    qFirstScan        : BOOL := TRUE;
END_VAR
VAR
    _heartbeatTicks : UINT;
END_VAR

qContractVersion := sContractVersion;
qScanCounter     := qScanCounter + 1;

_heartbeatTicks := _heartbeatTicks + 1;
IF _heartbeatTicks >= uiHeartbeatPeriod THEN
    _heartbeatTicks := 0;
    qHeartbeat := NOT qHeartbeat;
END_IF

// qFirstScan stays TRUE for one scan only.
IF qFirstScan THEN
    qFirstScan := FALSE;
END_IF

END_FUNCTION_BLOCK
