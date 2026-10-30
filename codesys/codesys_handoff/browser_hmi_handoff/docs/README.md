# CODESYS → MQTT → Browser HMI

A reusable recipe for **building a custom web-based HMI for a CODESYS PLC**
that bypasses the CODESYS Visualization entirely. Lets you use any modern
web tech (HTML/CSS/JS, React, Vue, whatever) for the operator UI while the
PLC stays the source of truth.

This was figured out by trial and error in May 2026 against
**CODESYS V3.5 SP22.20 (Professional Developer Edition)** on Windows. Most
of it should transfer to other recent V3.5 SP releases. Older versions may
have differences in the IIoT library.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          PLC (CODESYS)                            │
│                                                                   │
│  ┌──────────────┐         ┌────────────────────────────┐          │
│  │ Application  │ values  │ Mqtt_Bridge POU            │          │
│  │ logic POUs   ├────────▶│   - MQTTClient (xEnable)   │          │
│  │ (e.g. state  │         │   - MQTTPublish per topic  │          │
│  │  machines,   │ commands│   - MQTTSubscribe per cmd  │          │
│  │  IO logic)   │◀────────┤                            │          │
│  └──────────────┘         └────────────┬───────────────┘          │
└─────────────────────────────────────────┼────────────────────────┘
                                          │ TCP 1883 (MQTT)
                                          ▼
                            ┌────────────────────────────┐
                            │  MQTT broker (Mosquitto)   │
                            │   - listener 1883 TCP      │
                            │   - listener 9001 WS       │
                            └────────────┬───────────────┘
                                          │ WebSocket 9001
                                          ▼
                            ┌────────────────────────────┐
                            │  Browser (any HTML page)   │
                            │   - Paho.js MQTT client    │
                            │   - subscribes for state   │
                            │   - publishes commands     │
                            └────────────────────────────┘
```

The PLC publishes state changes (one MQTT topic per signal). The browser
subscribes to those topics and renders. The browser publishes user actions
(button clicks etc.) to "command" topics. The PLC subscribes to those and
acts on them. Mosquitto sits in the middle as the dumb pipe.

## What's in this folder

- `README.md` — you are here.
- `01-broker-setup.md` — how to install and configure Mosquitto on Windows
  with both TCP (for the PLC) and WebSocket (for the browser) listeners.
- `02-codesys-side.md` — how to add the IIoT MQTT library, write a
  `Mqtt_Bridge` POU, and the gotchas (especially `xEnable` and string-size
  matching).
- `03-browser-side.md` — how to build an HTML page that talks to the broker
  via Paho.js, subscribe and publish, render with CSS.
- `04-troubleshooting.md` — the snags we hit and how to find them again.
- `05-portability.md` — what changes when you move from a sandbox PLC to
  a real one (security, network paths, broker placement).
- `06-opcua-side.md` — alternate path: expose PLC variables via OPC UA
  (built into the runtime, no POU code, ideal for "drop in for test"
  workflows). Includes the auth-config snag.
- `07-opcua-relay.md` — once OPC UA is exposed, the OPC UA → WebSocket
  relay (Node.js) plus a browser HMI that uses plain WebSocket. Same
  beautiful stoplight UI as the MQTT version, completely different
  plumbing under the hood.
- `08-source-listing.md` — full ST source for the demo project so you
  can recreate it from scratch in CODESYS without needing the
  `.project` file.
- `09-drop-in-checklist.md` — short, focused recipe for adding either
  bridge to **your own existing project** (skipping the demo content).

## Files used in the demo project

- `StopLight` — a four-state stoplight POU (Red/RedYellow/Green/Yellow).
- `E_LightState` — the state enum.
- `Mqtt_Bridge` — connects to the broker and bridges StopLight outputs to
  MQTT topics + a switch command back from MQTT.
- `PLC_PRG` — wires the IO byte to the StopLight switch input.
- `stoplight/stoplight.html` — the browser HMI.

## Result

The PLC cycles the stoplight state machine. A browser tab shows three big
realistic CSS lamps that turn red / yellow / green in lockstep with the PLC,
with smooth glow transitions. Connection status is shown in a side panel.
Latency is sub-100 ms on localhost. The browser can also send a "switch"
command to start/restart the cycle.

## When to use this pattern

- You want a custom-styled HMI (your branding, modern web stack, mobile-friendly).
- You want to consume PLC data from non-HMI consumers too (dashboards, data
  pipelines, AI agents, etc.) — MQTT broadcasts, anyone can subscribe.
- You want to publish multiple PLCs to one place.
- You don't mind running a broker alongside the PLC.

## When NOT to use this pattern

- The CODESYS Visu would already do the job and you don't care about the look.
- You have hard real-time control requirements through the HMI (MQTT is
  reliable but adds 10–100 ms; not for safety-critical control).
- Your environment forbids running new processes on PLC-adjacent hosts.
- You have cyber-security requirements that aren't covered by this recipe
  (this assumes localhost / trusted LAN; production needs TLS + auth).
