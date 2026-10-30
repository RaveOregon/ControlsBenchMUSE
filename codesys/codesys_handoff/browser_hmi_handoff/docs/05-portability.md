# Portability — moving from sandbox to real

The recipe in `01–04` assumes everything is on `localhost` (PLC runtime,
broker, browser all on the same Windows box). Production needs more thought.

## Where the broker should live

Three sane placements:

| Placement | Pros | Cons |
|---|---|---|
| **On the PLC host** | One less machine to manage. PLC and broker can't desync. | If the PLC reboots, broker dies too. Single point of failure. |
| **On a "control PC" / IPC adjacent to the PLC** | Broker stays up across PLC restarts. Multi-PLC consolidation. | Extra hardware/VM to manage. |
| **In the cloud (HiveMQ Cloud, AWS IoT Core)** | No local infra. Multi-site dashboards trivial. | Internet dependency. Latency. Auth/TLS required. Per-message billing. |

For a single-PLC dev / lab setup → on the PLC host (what we did).
For a workcell with several PLCs → adjacent IPC.
For multi-site monitoring → cloud.

## What changes when the broker moves

### PLC side

Update `sHost` in `Mqtt_Bridge`:

```iecst
sHost : STRING(80) := '192.168.1.50';   // broker IP
```

Or read from a recipe / GVL so the value can be changed without recompiling.

If TLS is required:

```iecst
client(
    xEnable       := TRUE,
    sHostname     := sHost,
    uiPort        := 8883,        // typical TLS port
    xUseTLS       := TRUE,
    itfTLSContext := tlsCtx,      // see CODESYS NBS.TLSContext docs
    ...);
```

The `NBS.TLSContext` setup is a separate body of work — see CODESYS docs on
"NBS.ITLSContext" and certificate handling.

### Browser side

If the broker isn't on `localhost`, change `HOST` in the HTML:

```javascript
const HOST = 'plant-broker.example.com';
const PORT = 9001;
```

If the page is served over HTTPS, you must use `wss://` (TLS WebSocket),
which means the broker needs a TLS-capable WS listener and a real cert:

```
listener 9443
protocol websockets
cafile  /etc/mosquitto/ca.crt
certfile /etc/mosquitto/server.crt
keyfile  /etc/mosquitto/server.key
```

Then in the JS:

```javascript
client.connect({
    useSSL: true,
    ...
});
```

## Authentication

Anonymous access is fine for a sandbox on `localhost`. For anything else,
turn it off:

```
listener 1883
allow_anonymous false
password_file C:\ProgramData\mosquitto\passwords
```

Generate the password file:

```powershell
& "C:\Program Files\mosquitto\mosquitto_passwd.exe" -c C:\ProgramData\mosquitto\passwords plcuser
& "C:\Program Files\mosquitto\mosquitto_passwd.exe" C:\ProgramData\mosquitto\passwords browseruser
```

In the PLC client:

```iecst
client(
    ...
    wsUsername := "plcuser",
    wsPassword := "thepassword",
    ...);
```

In the browser:

```javascript
client.connect({
    userName: 'browseruser',
    password: 'thepassword',
    ...
});
```

## Topic-level access control (optional)

For multi-tenant setups, restrict who can publish/subscribe what. Mosquitto's
ACL file:

```
# /etc/mosquitto/acl
user plcuser
topic write plc/#
topic read  plc/+/cmd/+

user browseruser
topic read  plc/#
topic write plc/+/cmd/+
```

Reference it from `mosquitto.conf`:

```
acl_file C:\ProgramData\mosquitto\acl
```

## Network paths

Things to plan for production:

- **PLC → broker**: usually on the same VLAN / subnet. Open TCP 1883 (or
  8883 for TLS) inbound on the broker host's firewall.
- **Browser → broker**: client side, depends on where users are. If the
  broker is on the plant LAN and users are remote, you need either a VPN,
  a reverse proxy, or a cloud broker.
- **PLC behind NAT**: outbound MQTT is fine (initiated from PLC). Inbound
  doesn't matter — MQTT is client-initiated, so the broker just needs to
  be reachable from the PLC, not vice versa.

## Reliability

For "must not lose messages":

- Use **QoS 1 or 2** (instead of 0) on critical messages.
- Set `xCleanSession := FALSE` and a stable `sClientId` per PLC, so the
  broker queues missed messages while the client is offline.
- Enable broker **persistence** (`persistence true`, `persistence_location`
  in mosquitto.conf) so retained messages survive broker restarts.
- Run two brokers behind a TCP load balancer, or use EMQX/HiveMQ in
  clustered mode for HA.

For a learning project: QoS 0 with retained state is fine.

## Schema / payload format

This recipe used simple string payloads (`"true"` / `"123.45"`). It works
but doesn't scale. For production, consider:

- **JSON payloads** with versioned schemas (use the `JSON Utilities SL`
  library on the PLC side, `JSON.parse()` on the browser side).
- **Sparkplug B**: standardized industrial MQTT payloads, with metric
  metadata and birth/death certificates. Mosquitto supports the
  `mosquitto_sparkplug_aware` plugin that recognizes Sparkplug topics.

For a single PLC and a few signals, plain strings are fine. For a fleet
with dozens of devices, Sparkplug saves a lot of ad-hoc design work.

## What stays the same

The architecture itself. PLC runs the application logic, publishes state,
subscribes to commands. Broker is the dumb pipe. Browser (or any other
consumer) renders. Whether it's localhost-and-hardcoded or a thousand-PLC
fleet on AWS, the shape is identical. Only auth, transport, and payload
schema scale up.
