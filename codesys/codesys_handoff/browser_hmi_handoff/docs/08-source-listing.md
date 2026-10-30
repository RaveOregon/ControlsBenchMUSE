# Source listing — recreate the demo project from scratch

If you don't have the `.project` file, you can rebuild the entire demo
in CODESYS from the source code below. Tested on V3.5 SP22.20.

This file is also the canonical reference for **what the bridge POU
actually looks like** if you want to copy the pattern into your own
project rather than the demo.

## What you're rebuilding

A simple PLC with:

- A 4-state stoplight state machine (Red → Red+Yellow → Green → Yellow).
- IO byte/bit/real exposed for testing.
- An MQTT bridge POU that publishes the lamp states and lets a browser
  toggle the start switch.
- A Symbol Configuration that exposes the same variables via OPC UA.

## Step 0: Project setup

1. CODESYS → **File → New Project → Standard Project**.
2. Name: anything (`stoplight_demo` works). Location: anywhere.
3. **Device**: `CODESYS Control Win V3 x64` (the free SoftPLC). PLC_PRG
   language: **Structured Text**.
4. Click "OK". CODESYS creates a project with `Device → Plc Logic →
   Application → PLC_PRG` and a `MainTask`.

## Step 1: Add libraries

Open **Library Manager** under Application. Click **Add Library** and
add (one at a time):

- `MQTT Client SL` (namespace `MQTT`)
- `JSON Utilities SL` (namespace `JSON`) — optional; not required for
  this minimal demo, but useful if you want structured payloads later.

## Step 2: Add the simulated IO devices (optional)

The demo references `Digital_IO` and `Analogue_IO` simulated devices
from the CODESYS Academy library. If you have them, add them to the
device tree as siblings of the PLC. If not, skip this step and remove
the IO mapping references in PLC_PRG. The stoplight + MQTT will still
work without IO devices.

## Step 3: Add the enum

Right-click `Application` → **Add Object → DUT** → Name: `E_LightState`
→ type: **Enumeration**. Replace the default content with:

```iecst
{attribute 'qualified_only'}
{attribute 'strict'}
TYPE E_LightState :
(
    Red       := 0,  // Default state. Wait for xSwitch to start the cycle.
    RedYellow := 1,  // Prep before green.
    Green     := 2,  // Go.
    Yellow    := 3   // Slow down before red.
) := Red;
END_TYPE
```

## Step 4: Add the StopLight POU

Right-click `Application` → **Add Object → POU** → Name: `StopLight`,
Type: **Program**, Language: **Structured Text**.

Replace the default content with:

```iecst
{attribute 'analysis' := '-33,-11'}
PROGRAM StopLight
VAR_INPUT
    xSwitch : BOOL;
END_VAR
VAR_OUTPUT
    qRed    : BOOL;
    qYellow : BOOL;
    qGreen  : BOOL;
    qState  : E_LightState;
END_VAR
VAR
    _state : E_LightState := E_LightState.Red;

    RdTimer : TON;
    RyTimer : TON;
    GnTimer : TON;
    YlTimer : TON;

    _switchEdge : R_TRIG;
    _cycleArmed : BOOL := TRUE;  // auto-start; set FALSE if you want the switch to gate

    _runRd : BOOL;
    _runRy : BOOL;
    _runGn : BOOL;
    _runYl : BOOL;
END_VAR

_switchEdge(CLK := xSwitch);
IF _switchEdge.Q THEN
    _cycleArmed := TRUE;
END_IF

_runRd := (_state = E_LightState.Red) AND _cycleArmed;
_runRy := (_state = E_LightState.RedYellow);
_runGn := (_state = E_LightState.Green);
_runYl := (_state = E_LightState.Yellow);

RdTimer(IN := _runRd, PT := T#5S);
RyTimer(IN := _runRy, PT := T#1S);
GnTimer(IN := _runGn, PT := T#5S);
YlTimer(IN := _runYl, PT := T#2S);

CASE _state OF
    E_LightState.Red:
        qRed    := TRUE;  qYellow := FALSE; qGreen := FALSE;
        IF RdTimer.Q THEN _state := E_LightState.RedYellow; END_IF
    E_LightState.RedYellow:
        qRed    := TRUE;  qYellow := TRUE;  qGreen := FALSE;
        IF RyTimer.Q THEN _state := E_LightState.Green; END_IF
    E_LightState.Green:
        qRed    := FALSE; qYellow := FALSE; qGreen := TRUE;
        IF GnTimer.Q THEN _state := E_LightState.Yellow; END_IF
    E_LightState.Yellow:
        qRed    := FALSE; qYellow := TRUE;  qGreen := FALSE;
        IF YlTimer.Q THEN _state := E_LightState.Red; END_IF
END_CASE

qState := _state;
```

## Step 5: Add the Mqtt_Bridge POU

Right-click `Application` → **Add Object → POU** → Name: `Mqtt_Bridge`,
Type: **Program**, Language: **Structured Text**.

```iecst
{attribute 'analysis' := '-33,-11,-26'}
PROGRAM Mqtt_Bridge
VAR
    sHost   : STRING(80) := '127.0.0.1';
    client  : MQTT.MQTTClient;

    pubRed    : MQTT.MQTTPublish;
    pubYellow : MQTT.MQTTPublish;
    pubGreen  : MQTT.MQTTPublish;
    pubState  : MQTT.MQTTPublish;
    pubArmed  : MQTT.MQTTPublish;

    subSwitch : MQTT.MQTTSubscribe;
    abSwitchPayload : ARRAY[0..63] OF BYTE;

    // ⚠ MUST be WSTRING(1024); the lib's VAR_IN_OUT requires exact size.
    topicRed       : WSTRING(1024) := "plc/stoplight/red";
    topicYellow    : WSTRING(1024) := "plc/stoplight/yellow";
    topicGreen     : WSTRING(1024) := "plc/stoplight/green";
    topicState     : WSTRING(1024) := "plc/stoplight/state";
    topicArmed     : WSTRING(1024) := "plc/stoplight/armed";
    topicSwitchSet : WSTRING(1024) := "plc/stoplight/switch/set";

    _connected  : BOOL;

    _lastRed    : BOOL;
    _lastYellow : BOOL;
    _lastGreen  : BOOL;
    _lastState  : E_LightState := E_LightState.Yellow; // != initial state so first scan fires
    _lastArmed  : BOOL;

    _triggerRed    : BOOL;
    _triggerYellow : BOOL;
    _triggerGreen  : BOOL;
    _triggerState  : BOOL;
    _triggerArmed  : BOOL;

    sPayloadRed    : STRING(8);
    sPayloadYellow : STRING(8);
    sPayloadGreen  : STRING(8);
    sPayloadState  : STRING(16);
    sPayloadArmed  : STRING(8);

    _firstScan : BOOL := TRUE;
END_VAR
VAR_OUTPUT
    qSwitchFromBrowser : BOOL;
    qConnected : BOOL;
END_VAR

// ⚠ xEnable := TRUE is REQUIRED. Without it, MQTTClient (which extends
// LCon) stays idle, no connection, no errors. The silent killer.
client(
    xEnable       := TRUE,
    sHostname     := sHost,
    uiPort        := 1883,
    xUseTLS       := FALSE,
    uiKeepAlive   := 5,
    xCleanSession := TRUE);

_connected := client.xConnectedToBroker;

IF _connected THEN
    IF _firstScan OR (StopLight.qRed <> _lastRed) THEN
        IF StopLight.qRed THEN sPayloadRed := 'true'; ELSE sPayloadRed := 'false'; END_IF
        _triggerRed := TRUE;
        _lastRed := StopLight.qRed;
    END_IF

    IF _firstScan OR (StopLight.qYellow <> _lastYellow) THEN
        IF StopLight.qYellow THEN sPayloadYellow := 'true'; ELSE sPayloadYellow := 'false'; END_IF
        _triggerYellow := TRUE;
        _lastYellow := StopLight.qYellow;
    END_IF

    IF _firstScan OR (StopLight.qGreen <> _lastGreen) THEN
        IF StopLight.qGreen THEN sPayloadGreen := 'true'; ELSE sPayloadGreen := 'false'; END_IF
        _triggerGreen := TRUE;
        _lastGreen := StopLight.qGreen;
    END_IF

    IF _firstScan OR (StopLight.qState <> _lastState) THEN
        CASE StopLight.qState OF
            E_LightState.Red:       sPayloadState := 'Red';
            E_LightState.RedYellow: sPayloadState := 'RedYellow';
            E_LightState.Green:     sPayloadState := 'Green';
            E_LightState.Yellow:    sPayloadState := 'Yellow';
        ELSE
            sPayloadState := 'Unknown';
        END_CASE
        _triggerState := TRUE;
        _lastState := StopLight.qState;
    END_IF

    IF _firstScan OR (PLC_PRG.byDigInByte.0 <> _lastArmed) THEN
        IF PLC_PRG.byDigInByte.0 THEN sPayloadArmed := 'true'; ELSE sPayloadArmed := 'false'; END_IF
        _triggerArmed := TRUE;
        _lastArmed := PLC_PRG.byDigInByte.0;
    END_IF

    _firstScan := FALSE;
END_IF

pubRed(    mqttClient := client, wsTopicName := topicRed,
           xExecute := _triggerRed,    eQoS := MQTT.MQTT_QOS.QoS0, xRetain := TRUE,
           pbPayload := ADR(sPayloadRed),    udiPayloadSize := TO_UDINT(LEN(sPayloadRed)));
pubYellow( mqttClient := client, wsTopicName := topicYellow,
           xExecute := _triggerYellow, eQoS := MQTT.MQTT_QOS.QoS0, xRetain := TRUE,
           pbPayload := ADR(sPayloadYellow), udiPayloadSize := TO_UDINT(LEN(sPayloadYellow)));
pubGreen(  mqttClient := client, wsTopicName := topicGreen,
           xExecute := _triggerGreen,  eQoS := MQTT.MQTT_QOS.QoS0, xRetain := TRUE,
           pbPayload := ADR(sPayloadGreen),  udiPayloadSize := TO_UDINT(LEN(sPayloadGreen)));
pubState(  mqttClient := client, wsTopicName := topicState,
           xExecute := _triggerState,  eQoS := MQTT.MQTT_QOS.QoS0, xRetain := TRUE,
           pbPayload := ADR(sPayloadState),  udiPayloadSize := TO_UDINT(LEN(sPayloadState)));
pubArmed(  mqttClient := client, wsTopicName := topicArmed,
           xExecute := _triggerArmed,  eQoS := MQTT.MQTT_QOS.QoS0, xRetain := TRUE,
           pbPayload := ADR(sPayloadArmed),  udiPayloadSize := TO_UDINT(LEN(sPayloadArmed)));

_triggerRed    := FALSE;
_triggerYellow := FALSE;
_triggerGreen  := FALSE;
_triggerState  := FALSE;
_triggerArmed  := FALSE;

subSwitch(
    xEnable           := TRUE,
    mqttClient        := client,
    wsTopicFilter     := topicSwitchSet,
    eSubscribeQoS     := MQTT.MQTT_QOS.QoS0,
    pbPayload         := ADR(abSwitchPayload),
    udiMaxPayloadSize := SIZEOF(abSwitchPayload));

qSwitchFromBrowser := subSwitch.xReceived;
qConnected := _connected;
```

> ⚠ The listing above was hand-typed from the running PLC; if any
> spelling looks off, the CODESYS-side compile will catch it. The
> actual deployed code in this demo compiles clean.

## Step 6: Replace PLC_PRG body

Open the default `PLC_PRG`. Replace contents with:

```iecst
PROGRAM PLC_PRG
VAR
    xDigInBool   : BOOL;
    xDigOutBool  : BOOL;

    byDigInByte  : BYTE;
    byDigOutByte : BYTE;

    rAnaInReal   : REAL;
    rAnaOutReal  : REAL;

    _browserLatch : BOOL;
END_VAR

// Forward MQTT browser switch into a local latch.
IF Mqtt_Bridge.qSwitchFromBrowser THEN
    _browserLatch := TRUE;
END_IF

// Drive the StopLight switch from local IO bit 0 OR the browser latch.
StopLight.xSwitch := byDigInByte.0 OR _browserLatch;

// Reset the latch one scan after the local switch is released.
IF _browserLatch AND NOT byDigInByte.0 THEN
    _browserLatch := FALSE;
END_IF

// Mirror lamp states onto LAMPS for the IO sim panel.
byDigOutByte.0 := StopLight.qRed;
byDigOutByte.1 := StopLight.qYellow;
byDigOutByte.2 := StopLight.qGreen;
```

## Step 7: Add programs to MainTask

Open **Task Configuration → MainTask**. Add program calls in this order:

1. `PLC_PRG`
2. `StopLight`
3. `Mqtt_Bridge`

The order matters: PLC_PRG sets `StopLight.xSwitch` from inputs;
StopLight runs the state machine; Mqtt_Bridge publishes the result.

## Step 8: Symbol Configuration (for OPC UA)

Right-click `Application` → **Add Object → Symbol Configuration**. In
the dialog, **check "Support OPC UA features."** Then open the Symbols
object and tick:

| Variable | Access |
|---|---|
| `StopLight.qRed`, `qYellow`, `qGreen`, `qState` | read |
| `StopLight.xSwitch` | read |
| `PLC_PRG.byDigInByte` | read+write |
| `PLC_PRG.byDigOutByte` | read |

(Add others as you want.)

## Step 9: Allow OPC UA anonymous (sandbox only)

Double-click **Device** → drop down to **Settings → Security Settings**.
Enable security policy **None** and user token policy **Anonymous**. See
`06-opcua-side.md` for the runtime restart needed.

## Step 10: Build, login, run

- `Ctrl+B` to build
- `Alt+F8` to login (it'll prompt to download)
- `F5` to start

The PLC is now publishing to MQTT (assuming Mosquitto is running) and
exposing variables via OPC UA. Browser HMIs in `stoplight/` and
`opcua_relay/` should both work.

## Adapting for your own project

The above produces the demo. For *your* project, the steps that transfer
verbatim are:

- The MQTT publisher pattern in `Mqtt_Bridge` — copy the FB and adapt
  the variables, topics, and change-detect blocks.
- The Symbol Configuration step — just tick whatever variables you want
  to expose.
- The browser HMIs — change topic names / node IDs to match your project.

What you'll need to change:

- Variable names and types (your project won't have `StopLight.qRed`).
- Topic names (use a hierarchy that matches your project's domain).
- Change-detect logic (one block per variable; pattern in
  `02-codesys-side.md`).

For the OPC UA side, almost nothing is project-specific — the relay
script doesn't care what variables are; it forwards whatever the browser
asks for.
