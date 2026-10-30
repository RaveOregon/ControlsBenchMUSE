# CODESYS side — adding the MQTT bridge

This is where most of the real-world friction is. The MQTT Client SL library
is well-documented but a few patterns aren't obvious from the docs alone, and
one omission (`xEnable`) silently kills the whole thing.

## 1. Install the IIoT Libraries package

CODESYS Store → **CODESYS IIoT Libraries SL**. Free download with a CODESYS
account. After install, restart CODESYS.

The package gives you several libraries; for this recipe you need:

- **MQTT Client SL** (required) — the actual MQTT FBs.
- **JSON Utilities SL** (optional) — only if you need to send/receive
  structured payloads. For BOOL/INT/STRING values, simple string payloads
  work fine without it.

## 2. Add the library reference

In your project: open the **Library Manager** (under your application).
Click **Add Library** → search for `MQTT Client SL` → add. Namespace will be
`MQTT`. Same drill for JSON Utilities if you want it (namespace `JSON`).

> Adding the library to the system-wide repository (CODESYS Installer) is
> not the same as referencing it in your project. Both steps are required.

## 3. Build a Mqtt_Bridge POU

Pattern: one program (or FB) that owns the broker connection and a
publisher per topic and a subscriber per command. Keep it focused on
plumbing — don't put application logic in here.

### Skeleton

```iecst
PROGRAM Mqtt_Bridge
VAR
    sHost   : STRING(80) := '127.0.0.1';
    client  : MQTT.MQTTClient;

    pubFoo  : MQTT.MQTTPublish;
    subBar  : MQTT.MQTTSubscribe;

    // ⚠ Topics MUST be WSTRING(1024). The library's VAR_IN_OUT
    // parameters demand exactly that size — anything smaller fails with
    // "String variable too short".
    topicFoo : WSTRING(1024) := "plant/foo";
    topicBar : WSTRING(1024) := "plant/bar/set";

    abBarBuf : ARRAY[0..63] OF BYTE;
    sFooPayload : STRING(64);
END_VAR

// ⚠ xEnable := TRUE is REQUIRED. MQTTClient extends LCon, which is idle
// until xEnable goes high. If you skip this, the FB compiles fine, the
// PLC accepts the download, and absolutely nothing happens at runtime.
client(
    xEnable       := TRUE,
    sHostname     := sHost,
    uiPort        := 1883,
    xUseTLS       := FALSE,
    uiKeepAlive   := 5,
    xCleanSession := TRUE);

// Publishers fire on rising edge of xExecute. To publish on change,
// detect the change yourself and pulse xExecute for one scan.
sFooPayload := 'hello';
pubFoo(
    mqttClient     := client,
    wsTopicName    := topicFoo,
    xExecute       := someChangePulse,
    eQoS           := MQTT.MQTT_QOS.QoS0,
    xRetain        := TRUE,
    pbPayload      := ADR(sFooPayload),
    udiPayloadSize := TO_UDINT(LEN(sFooPayload)));

// Subscribers also need xEnable.
subBar(
    xEnable           := TRUE,
    mqttClient        := client,
    wsTopicFilter     := topicBar,
    eSubscribeQoS     := MQTT.MQTT_QOS.QoS0,
    pbPayload         := ADR(abBarBuf),
    udiMaxPayloadSize := SIZEOF(abBarBuf));

IF subBar.xReceived THEN
    // abBarBuf now holds the message. Parse as needed.
    // subBar.udiPayloadSize tells you how many bytes are valid.
    ;
END_IF

END_PROGRAM
```

### Publish-on-change pattern

For each value you want to publish, track the last value and pulse
`xExecute` when it changes.

```iecst
VAR
    _lastVal : BOOL;
    _trigger : BOOL;
    sPayload : STRING(8);
END_VAR

// Detect change
IF SomePOU.someBool <> _lastVal THEN
    IF SomePOU.someBool THEN sPayload := 'true'; ELSE sPayload := 'false'; END_IF
    _trigger := TRUE;
    _lastVal := SomePOU.someBool;
END_IF

// Fire publisher
pubFoo(
    mqttClient     := client,
    wsTopicName    := topicFoo,
    xExecute       := _trigger,
    ...
    pbPayload      := ADR(sPayload),
    udiPayloadSize := TO_UDINT(LEN(sPayload)));

// Clear trigger after publish
_trigger := FALSE;
```

Use `xRetain := TRUE` for state values (so a new browser tab gets the
current value immediately on connect). Use `xRetain := FALSE` for
event-style signals (a button press, an alarm trigger).

### Subscribing — the two flavors

```iecst
// "Was something received this scan?"
IF subBar.xReceived THEN
    // The byte array abBarBuf is valid. Length = subBar.udiPayloadSize.
    // For STRING-typed payloads, a quick way to use it:
    //   pBuf : POINTER TO STRING(64);
    //   pBuf := ADR(abBarBuf);
    //   IF pBuf^ = 'start' THEN ... END_IF
END_IF

// xReceived is only TRUE for one scan per message.
// subBar.wsLastTopic tells you which topic produced the message
//   (useful when wsTopicFilter contains wildcards).
```

### Multiple topics, one client

`MQTTClient` should be instantiated **once**. Every `MQTTPublish` and
`MQTTSubscribe` shares that single client via the `mqttClient` VAR_IN_OUT
parameter. Don't create a new client per topic — that opens a new TCP
connection per topic.

## 4. Hook it into a task

Add the POU to **MainTask** (or a dedicated comms task running every 50 ms
or so — MQTT comms doesn't need to run at the control-loop cadence).

If you want the bridge isolated from control-loop jitter, use a separate
cyclic task at 100 ms with a lower priority than the control loop.

## 5. Pitfalls

| Symptom | Cause |
|---|---|
| Compiles fine, PLC runs, but nothing publishes and `client.xConnectedToBroker` stays FALSE | Forgot `xEnable := TRUE` on the MQTTClient call |
| Subscriber never fires | Forgot `xEnable := TRUE` on the MQTTSubscribe call |
| Build error: "String variable 'topicFoo' too short for VAR_IN_OUT parameter 'wsTopicName'" | Topic strings must be `WSTRING(1024)` exactly, not smaller |
| Publishers fire continuously instead of on change | `xExecute` is held TRUE — the library wants a rising edge. Pulse it for one scan |
| Browser sees stale value when first loading the page | Set `xRetain := TRUE` on publishers for state-style signals |
| Receive payload looks like garbage | Wrong-sized buffer, or you're reading bytes outside `udiPayloadSize`. The buffer isn't auto-zero-terminated for non-string payloads |
| `qConnected` analyzer error "Read access to output variable" | CODESYS treats VAR_OUTPUT as write-only. Use a private VAR, then assign to qConnected at the end of the scan |
| "Cognitive Complexity > 20" precompile error | The analyzer's complexity check is flagging the FB. Suppress with `{attribute 'analysis' := '-26'}` at the POU header, or split into methods. Doesn't block actual codegen |
| "Expression always FALSE" precompile errors on `client.xConnectedToBroker`, etc. | Dataflow analyzer false positive. Suppress with `{attribute 'analysis' := '-33,-11'}` at the POU header. Doesn't block actual codegen — verify with `check_for_errors(compile=true)` |

## 6. Verifying the PLC side independently

Once the PLC is logged in and running, confirm publishing without involving
a browser at all:

```powershell
& "C:\Program Files\mosquitto\mosquitto_sub.exe" -h localhost -t "plc/#" -v
```

If you see your PLC's messages appearing in real time, the PLC side works.
If the window is silent, the PLC isn't publishing — check `client.xConnectedToBroker`
in the CODESYS monitor and verify `xEnable := TRUE`.
