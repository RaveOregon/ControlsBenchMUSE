# AmznBrowserHmi — CODESYS library

A CODESYS library that gives you parameterized, reusable function blocks
for browser HMI work. Drop into any project; instantiate with one line;
publish or subscribe with one line per signal.

## Manifest

| Attribute | Value |
|---|---|
| Library namespace | `AmznBrowserHmi` |
| Library title | "Amazon Browser HMI" |
| Version | 0.1.0 (iteration 1, source-form) |
| Vendor | (your team) |
| Compatibility | CODESYS V3.5 SP22 and later |
| Required libraries | `MQTT Client SL` (for FB_MqttHmi only) |
| License | (set by you when packaging) |

## Contents

- `FB_MqttHmi` — full-featured MQTT bridge with typed Publish/Subscribe.
- `FB_OpcUaHmi` — heartbeat / version helper for the OPC UA path.
- `E_HmiPayloadType` — internal enum.

## Why two FBs

The OPC UA and MQTT paths have fundamentally different shapes. OPC UA
exposure happens via the runtime's Symbol Configuration, not POU code,
so `FB_OpcUaHmi` is mostly a marker + diagnostic helper. MQTT requires
real PLC code (a client connection, a publisher per topic, a subscriber
per command), so `FB_MqttHmi` is the meat.

You'll typically use one or the other per project, not both, though
nothing stops you from running them simultaneously.

## Public API summary

### `FB_MqttHmi`

**Constructor (VAR_INPUT)**:
```
sHost        : STRING(80)   := '127.0.0.1'
uiPort       : UINT         := 1883
xUseTLS      : BOOL         := FALSE
uiKeepAlive  : UINT         := 5
sTopicPrefix : STRING(64)   := ''
wsUsername   : WSTRING(255) := ""
wsPassword   : WSTRING(255) := ""
sClientId    : STRING(64)   := ''
```

**Outputs**:
```
qConnected : BOOL          // broker connection status
qPubCount  : UINT          // number of unique publish channels in use
qSubCount  : UINT          // number of unique subscribe channels in use
```

**Methods**:
```
PublishBool(sChannel, xValue)        : BOOL    // returns FALSE if slot pool full
PublishReal(sChannel, rValue)        : BOOL
PublishDInt(sChannel, diValue)       : BOOL
PublishByte(sChannel, byValue)       : BOOL
PublishString(sChannel, sValue)      : BOOL

SubscribeBool(sChannel)              : BOOL    // TRUE for one scan on receive
SubscribePayload(sChannel)
    udiSize  : UDINT (out)
    xReceived: BOOL (out)
    return value : POINTER TO BYTE   // raw buffer
```

**Limits**:
- `MAX_PUB_CHANNELS = 32` (recompile to change)
- `MAX_SUB_CHANNELS = 16`
- Channel names up to 64 chars
- Topic prefix + channel total up to ~120 chars

### `FB_OpcUaHmi`

**Constructor (VAR_INPUT)**:
```
sContractVersion  : STRING(16) := '1.0'
uiHeartbeatPeriod : UINT       := 100
```

**Outputs**:
```
qScanCounter     : UDINT      // increments every scan
qHeartbeat       : BOOL       // toggles every uiHeartbeatPeriod scans
qContractVersion : STRING(16) // mirror of sContractVersion (for OPC UA exposure)
qFirstScan       : BOOL       // TRUE on first scan after PLC start
```

Add these outputs to your Symbol Configuration so external tools can read
them via OPC UA.

## Versioning

Iteration 1 is intentionally source-form — you copy the `.st` files into
your project. This makes it easy to edit if you find a problem before
the API stabilizes. Iteration 2 will package as `.compiled-library` for
proper versioned distribution.

## Notes for production

- `FB_MqttHmi` defaults to **`xRetain := TRUE`** for publishes, so
  fresh browser tabs see the current value immediately. Override
  internally if you publish events you specifically don't want
  retained.
- Auth: pass `wsUsername` / `wsPassword` for non-anonymous brokers.
- TLS: pass `xUseTLS := TRUE`. You'll also need to wire the
  `itfTLSContext` interface — currently this lib uses the underlying
  `MQTT.MQTTClient` defaults; adjust the body if you need cert pinning.
