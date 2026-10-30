# CODESYS Browser HMI — Handoff

This folder is a working demo of two different ways to drive a custom
browser-based HMI from a CODESYS PLC. Built and verified May 2026 against
**CODESYS V3.5 SP22.20 (Professional Developer Edition)** on Windows 11.

If you've been handed this folder, **start here** and pick a path.

## What you can demo in 10 minutes

If everything is set up, the demo loop is:

1. CODESYS is running with the project loaded → PLC in RUN mode.
2. Open `stoplight/stoplight.html` (the MQTT version) in a browser.
   You see a beautiful glowing stoplight cycling Red → Yellow+Red → Green
   → Yellow → Red on a 13-second loop.
3. Open `opcua_relay/stoplight_opcua.html` (the OPC UA version) in a
   second tab — same stoplight, completely different plumbing under it.
   Both update in lockstep with the PLC.

## What's in here

```
schedule/                                ← (your workspace, may have other folders)
├── browser_hmi_handoff/                 ← this is the demo to share
│   ├── HANDOFF.md                       ← you are here
│   ├── CHEATSHEET.md                    ← the commands you'll need most
│   ├── kiro_steering.md                 ← drop-in steering for another AI agent
│   ├── docs/
│   │   ├── README.md                    ← overall architecture
│   │   ├── 01-broker-setup.md           ← Mosquitto on Windows
│   │   ├── 02-codesys-side.md           ← MQTT bridge POU pattern
│   │   ├── 03-browser-side.md           ← MQTT-side browser HMI
│   │   ├── 04-troubleshooting.md        ← cross-cutting gotchas
│   │   ├── 05-portability.md            ← what changes for production
│   │   ├── 06-opcua-side.md             ← OPC UA exposure on the PLC
│   │   ├── 07-opcua-relay.md            ← OPC UA → WebSocket relay + browser
│   │   ├── 08-source-listing.md         ← full ST source so you can recreate the demo
│   │   └── 09-drop-in-checklist.md      ← short recipe for YOUR project
│   ├── stoplight/
│   │   └── stoplight.html               ← MQTT-driven HMI
│   └── opcua_relay/
│       ├── package.json                 ← Node deps (node-opcua, ws)
│       ├── relay.js                     ← OPC UA → WebSocket bridge
│       ├── dump_nodeids.js              ← discovers OPC UA node IDs
│       ├── stoplight_opcua.html         ← OPC-UA-driven HMI
│       └── nodeids.json                 ← cached output of dump_nodeids
│
├── codesys_project_notes/               ← supplementary notes from this project
│   ├── CODESYS_SCRIPTING_BACKLOG.md     ← scripting wishlist
│   ├── CODESYS_VISU_SCRIPTING_LEARNINGS.md  ← what worked / didn't with Visu
│   ├── visu_scripts/                    ← IronPython scripts for the CODESYS Visu
│   ├── Analogue-IO.csv                  ← IO mapping for the academy device
│   └── Digital-IO.csv
│
└── ibis_workcell_docs/                  ← unrelated earlier work, kept for reference
    ├── PROJECT_MAP.html / .md
    ├── PROJECT_DIAGRAMS.html
    └── PROJECT_DIAGRAMS_DETAILED.html
```

For a clean handoff, the recipient only needs `browser_hmi_handoff/`. The
other two folders are kept here as reference but aren't required to spin
up the demo.

## Two architectures, side by side

```
                                                      ┌────────────────────────┐
PLC                                                   │ stoplight.html         │
  StopLight POU ─┬─ Mqtt_Bridge POU ──── Mosquitto ───┤ Paho MQTT (port 9001)  │
                 │                                    └────────────────────────┘
                 └─ OPC UA Server ──── relay.js (Node.js) ── WebSocket (port 9876)
                                                                  │
                                                      ┌────────────────────────┐
                                                      │ stoplight_opcua.html   │
                                                      │ Plain WebSocket        │
                                                      └────────────────────────┘
```

**Path A — MQTT bridge** (`stoplight/`): the CODESYS-side has a hand-written
POU that publishes to a Mosquitto broker. Browser uses Paho.js. Heavier on
the PLC side; lighter on the browser side; great for fan-out to multiple
consumers.

**Path B — OPC UA + relay** (`opcua_relay/`): the CODESYS-side just exposes
variables via Symbol Configuration. A small Node.js relay translates
between OPC UA and WebSocket. Almost no PLC code; relay is generic.

Pick whichever fits the use case. The contrast is laid out in detail in
`docs/README.md` (the section "When OPC UA wins / When MQTT wins").

## Spinning this up on a fresh machine

If you're starting from scratch (the project file isn't here, only docs +
HMI + relay code), the dependencies you'll install are:

| What | Where to get it | Notes |
|---|---|---|
| CODESYS Development System V3.5 SP recent | https://store.codesys.com/ | Free for development. PDE features (scripting, MCP server) are nice-to-haves. |
| CODESYS IIoT Libraries SL | CODESYS Store | Required only for the MQTT path |
| Mosquitto (or any MQTT broker) | https://mosquitto.org/download/ | Required only for the MQTT path. **Get the Windows installer .exe, not the source ZIP** |
| Node.js v18+ | https://nodejs.org/ | Required only for the OPC UA path |
| `opcua-commander` (optional) | `npm i -g opcua-commander` | Terminal browser for the OPC UA server |
| `UaExpert` (optional) | https://www.unified-automation.com/ | GUI browser for OPC UA |

For each path, the `docs/0X-*.md` files have step-by-step setup.

## "Just spin it up, please"

If you have everything installed and just want this folder running:

1. **Open a CODESYS project.** Two paths:
   - Use the demo `.project` file (if Steve shared it with you).
   - Or build one from `docs/08-source-listing.md` — every POU we
     wrote, in copy-pasteable ST blocks.
2. **Login + run** in CODESYS.
3. **For the MQTT version**: ensure Mosquitto is running with the WebSocket
   listener (see `docs/01-broker-setup.md`); open `stoplight/stoplight.html`.
4. **For the OPC UA version**: in the `opcua_relay/` folder run
   `npm install`, then `node relay.js`, then open
   `opcua_relay/stoplight_opcua.html`.

Specific commands are in `CHEATSHEET.md`.

## "I have my own existing project, just want to add this pattern"

Read `docs/09-drop-in-checklist.md`. Skips the demo content and gives
you the short version of either path adapted for an existing project.

## Caveats

- This is a **lab / sandbox** setup. Anonymous OPC UA, no auth on the MQTT
  broker, no TLS, all on localhost. See `docs/05-portability.md` before
  deploying anywhere with people / production traffic.
- The CODESYS project file isn't included by default; only the source
  files (POU text, Visu scripting, browser HMI, relay code). If the
  recipient needs to recreate the project, they follow the `docs/02-*.md`
  and `docs/06-*.md` files.
- The MQTT bridge POU has spurious "always FALSE" precompile warnings
  from CODESYS's static analyzer. Full compile passes; ignore them.
- The OPC UA security toggles are CODESYS-version-specific. The path that
  worked here may be in a different sub-menu in older / newer SP releases.

## If you're an AI agent reading this

See `kiro_steering.md` for conventions, tool capabilities, and the patterns
that worked vs. failed in this project. Save your operator some of the
iteration cost we already paid.
