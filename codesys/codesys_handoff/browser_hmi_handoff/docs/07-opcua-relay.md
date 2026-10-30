# OPC UA → WebSocket relay + browser HMI

This is the third path: keep PLC-side as simple as OPC UA Symbol
Configuration ticking (see `06-opcua-side.md`), then add a small Node.js
relay on the engineering machine that translates OPC UA traffic into
browser-friendly WebSocket. Browsers can talk OPC UA *only* through such
a relay; they can't connect to OPC UA directly.

Verified May 2026 against CODESYS V3.5 SP22.20 + Node.js v18+ on Windows 11.

## When to use this vs. the MQTT bridge

If the goal is "browser HMI for a PLC," you have two options:

- **MQTT bridge** (`docs/02-codesys-side.md` + `docs/03-browser-side.md`).
  Heavier on the PLC side (custom POU, change-detect blocks per variable,
  publishers and subscribers); lighter and more web-native on the browser
  side (Paho.js, no relay process).
- **OPC UA + relay** (this file). Almost no PLC code (tick boxes in
  Symbol Configuration); a Node.js relay on the engineer's box translates
  OPC UA TCP to browser WebSocket. Adds one process to keep alive.

The OPC UA + relay path has a meaningful advantage for **drop-in test
work on existing projects**: tick variables, no POU edit, no library
reference, generic relay.

## Files in `opcua_relay/`

```
opcua_relay/
├── package.json          ← Node deps (node-opcua, ws)
├── relay.js              ← long-running OPC UA -> WebSocket bridge
├── dump_nodeids.js       ← one-shot tool: discover variables, write nodeids.json
├── stoplight_opcua.html  ← demo browser HMI driven by the relay
└── nodeids.json          ← cache of discovered node IDs (regenerated as needed)
```

## Setup

### 1. PLC side

Already done if you followed `06-opcua-side.md`. Symbol Configuration
exposes the variables you want, the runtime's OPC UA server is up on
port 4840, anonymous + None security is enabled (sandbox), runtime has
been restarted to pick up endpoint changes.

### 2. Install Node deps

```powershell
cd <project>\opcua_relay
npm install
```

This pulls `node-opcua` and `ws`.

### 3. Discover node IDs

The relay needs to know the OPC UA node ID strings for the variables you
want to expose. They look like:

```
ns=4;s=|var|CODESYS Control Win V3 x64.Application.PLC_PRG.byDigInByte
```

You can read them off in opcua-commander or UaExpert by hand, or run the
discovery script:

```powershell
node dump_nodeids.js
```

This connects to the OPC UA server, walks the address space, and writes
all variables matching a list of names (`qRed`, `qYellow`, `byDigInByte`,
etc.) into `nodeids.json`. Edit the `WANTED` array in
`dump_nodeids.js` to extend the search.

### 4. Run the relay

```powershell
node relay.js
```

You should see:

```
2026-... OPC connected: opc.tcp://localhost:4840
2026-... OPC session created
2026-... OPC subscription created
2026-... WS server listening on ws://0.0.0.0:9876
```

Leave it running.

### 5. Open the browser HMI

The HMI uses plain WebSocket (no library) to talk to the relay. Either:

- **Direct file open**: double-click `stoplight_opcua.html`. May or may
  not work depending on the browser's `file://` security policy for
  WebSocket connections.
- **Served via HTTP** (more reliable):
  ```powershell
  npx --yes http-server -p 8090 -c-1 .
  ```
  Then open `http://localhost:8090/stoplight_opcua.html`.

The page connects to `ws://127.0.0.1:9876`, subscribes to the listed
variables, and renders a live stoplight that mirrors the PLC.

## Wire protocol between browser and relay

The relay accepts JSON messages of these shapes:

### Subscribe

```json
{ "action": "subscribe", "id": "qRed", "nodeId": "ns=4;s=..." }
```

`id` is browser-chosen (used to label the value back), `nodeId` is the
OPC UA node ID. Idempotent: subscribing twice with the same `id` is a
no-op.

### Unsubscribe

```json
{ "action": "unsubscribe", "id": "qRed" }
```

### Write

```json
{
  "action": "write",
  "id": "switch",
  "nodeId": "ns=4;s=...",
  "value": 1,
  "dataType": "Byte"
}
```

`dataType` is one of: `Boolean`, `Byte`, `Int16`, `Int32`, `UInt16`,
`UInt32`, `Float`, `Double`, `String`. Default is `Boolean`.

### Browse (optional)

```json
{ "action": "browse", "nodeId": "ns=0;i=85" }
```

Returns the immediate children. Useful for building a generic explorer.

### Server -> Browser messages

```json
{ "type": "ready", "endpoint": "opc.tcp://localhost:4840" }
{ "type": "value", "id": "qRed", "value": true, "ts": 1717... }
{ "type": "write_ack", "id": "switch", "status": "Good (0x00000000)" }
{ "type": "browse", "nodeId": "...", "children": [...] }
{ "type": "error", "msg": "..." }
```

The browser is expected to handle disconnects with auto-reconnect (the
demo HMI does so with a 2-second backoff).

## Building your own HMI on the relay

The demo `stoplight_opcua.html` is a pattern you can copy. The structure:

```javascript
const ws = new WebSocket('ws://127.0.0.1:9876');

ws.onopen = () => {
    // Subscribe to as many variables as you want
    ws.send(JSON.stringify({
        action: 'subscribe', id: 'mySignal',
        nodeId: 'ns=4;s=|var|...|MyVar'
    }));
};

ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'value') {
        // m.id is your handle. m.value is the current value.
        document.getElementById(m.id).textContent = m.value;
    }
};

// Writing back:
function send(id, nodeId, value, dataType) {
    ws.send(JSON.stringify({
        action: 'write', id, nodeId, value, dataType
    }));
}
```

For a polished UI: see `stoplight_opcua.html`'s CSS for the lamp glow
effects, side panel layout, and connection-status pill.

## Pitfalls (we hit all of these)

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find ANONYMOUS user token policy` | OPC UA server isn't accepting anonymous | Enable Anonymous + None policy in **Device → Security Settings** sub-menu, then restart the runtime via system tray |
| Relay reports "connected" but browser shows "connecting…" forever | Another process is bound to the same port (e.g. the user's machine had `quickwork-agent` on 8765) | Check listeners with `netstat -ano \| Select-String ":<port>"`. Move the relay to an unused port like 9876 |
| Two `node.exe` processes both bound to the same port | An earlier relay wasn't killed cleanly | Enumerate with `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`, kill stale PIDs with `Stop-Process -Id <pid> -Force` |
| Browser connects via IPv6 ::1 to a different process than IPv4 127.0.0.1 | The relay bound to one only; resolution lottery sent traffic to the other | Bind relay to `0.0.0.0` (we did `host: '0.0.0.0'` in `WebSocket.Server`); have the page connect via `127.0.0.1` literal |
| `EADDRINUSE` on `npx http-server -p 8080` | CODESYS WebVisu uses 8080 | Use 8090 or another free port |
| `file://` browser refuses WebSocket connection | Browser security policy | Serve via `http-server` and visit `http://localhost:8090/...` |
| `node-opcua` complains about cert validation | Cert auto-generation on first run | First run takes ~10s while it generates a self-signed cert in `%APPDATA%\opcua-commander-nodejs\Config\pki`. Subsequent runs are fast |
| Variables not in the OPC UA address space | Symbol Configuration didn't tick them, or wasn't rebuilt + redownloaded | In CODESYS: open Symbols, tick boxes, build, login, redownload |

## Performance notes

- Each subscribed variable consumes negligible PLC and relay resources.
  We've tested ~12 variables with no measurable load.
- For high-rate variables (many Hz), tune `samplingInterval` and
  `publishingInterval` in `relay.js` (currently 100 ms each). Lower for
  more responsive UI; higher to reduce CPU.
- The relay's per-message overhead is tiny (< 1 ms on this hardware). The
  bottleneck for a real HMI will be browser DOM updates, not the relay.

## What's missing for production

- TLS on both legs (PLC ↔ relay, relay ↔ browser).
- Authentication on both legs.
- The relay should run as a service (Windows Service or systemd) so it
  survives reboots.
- A reverse proxy in front of the relay if it'll be exposed on a network.

See `docs/05-portability.md` for the broader picture.
