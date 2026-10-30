---
inclusion: manual
---

# Browser HMI — piping PLC data to a web page

Optional. Skip this doc if your project doesn't need a browser HMI.

This is a quick reference for two patterns we've validated for getting
PLC variables out to a web page. Pick one — they're complementary,
not stacked.

For the full handoff with reusable libraries, working examples, and
worked walkthroughs, see the `browser_hmi_handoff/` bundle separately.
This is the agent-side cheat sheet.

## Two paths

### Path A: MQTT bridge

```
PLC (FB_MqttHmi) → Mosquitto broker → browser (Paho.js MQTT client)
```

- **Bidirectional** by default (publish + subscribe).
- Needs Mosquitto running on the network (`localhost:1883` TCP,
  `localhost:9001` WebSocket).
- Needs the **CODESYS IIoT Libraries SL** package (free, has the
  MQTT client FB).
- Browser uses Paho.js, no additional Node service needed.

### Path B: OPC UA + WebSocket relay

```
PLC (Symbol Configuration) → OPC UA server → Node.js relay → browser (WebSocket)
```

- Read-only by default (writes possible but more setup).
- No broker needed; OPC UA is built into CODESYS.
- Requires a small Node.js relay (`relay.js`) bridging OPC UA to a
  plain WebSocket for the browser.
- Symbol Configuration is **CODESYS UI manual setup** — MCP can't do it.
- Default OPC UA port `4840` needs anonymous + None policy enabled
  in Device → Security Settings.

## Picking between them

| Factor | Path A (MQTT) | Path B (OPC UA) |
|---|---|---|
| Bidirectional control | Yes | Read-only easier |
| Per-project setup time | ~10 min | ~15 min (Symbol Config in UI) |
| Runtime services needed | Mosquitto | Node relay |
| Industrial standard | OK (MQTT widely used) | Better (OPC UA is the standard) |
| Browser code complexity | Paho.js (~50 lines) | Plain WebSocket (~30 lines) |

For "internal dev / quick HMI", MQTT is faster. For "production
SCADA", OPC UA is the right answer.

## What the agent can / can't author

| | MQTT path | OPC UA path |
|---|---|---|
| FB / POU code | ✓ | ✓ (publisher side) |
| GVL with shared vars | ✓ | ✓ |
| `Symbol Configuration` entries | ✗ (UI) | ✗ (UI) |
| Device → Security Settings | ✗ (UI) | ✗ (UI) |
| Browser HTML/JS | ✓ | ✓ |
| Node relay code | n/a | ✓ |

The agent writes the ST + JS + relay code; the operator does the
two CODESYS-UI manual steps when applicable.

## Reusable bits

If you're starting fresh, the `browser_hmi_handoff/` bundle has:

- **`AmznBrowserHmi`** — CODESYS library with `FB_MqttHmi` (slot-pool
  publisher / subscriber for BOOL / INT / DINT / REAL / STRING) and
  `FB_OpcUaHmi` (heartbeat + marker for the OPC UA path).
- **`browser-hmi.js`** — single-file widget API (lamp / numeric /
  text / indicator / button) supporting both transports, ~400 lines.
- **3 working examples** — `minimal.html`, `stoplight.html`,
  `dashboard.html`.

Drop the library into the project, use the JS widgets in your HTML,
done.

## Common gotchas

### MQTT path

- **Mosquitto must be configured to listen on both 1883 and 9001**
  (TCP and WebSocket). Default install only does 1883.
- **The `quickwork-agent` process grabs port 8765** on some systems.
  Don't use 8765 for anything new — pick 9876 instead.
- **PLC client connects to broker at the broker's IP, not localhost**
  unless the broker is on the same machine.

### OPC UA path

- **Default OPC UA security rejects anonymous connections.** Enable
  in CODESYS: Device → Security Settings → endpoint → allow
  Anonymous + None policy.
- **Symbol Configuration must include the variables** before they
  show up over OPC UA. Empty Symbol Config = nothing exposed.
- **opcua-commander** (Node CLI) is a fine alternative to UaExpert
  for browsing the server. Connect to `opc.tcp://localhost:4840`.
- **The Node relay must NOT use port 8765** (see above) — pick 9876
  or another free port.

## When to use this kit

If a colleague is building a CODESYS project and asks "how do I get
this on a browser?", point them at this doc. If they want copy-paste
code, point them at the `browser_hmi_handoff/` bundle. If they want
to learn the why, both.
