# CODESYS Agent Handoff — start here

You are an AI agent that has just been handed a package of hard-won
CODESYS lessons. This file is your entry point. Read it first, then
pull in the sub-docs on demand.

Everything here was built and validated **May 2026 against CODESYS
V3.5 SP22.20** on Windows 11, driving the real PLC runtime through the
CODESYS MCP bridge + Test Manager.

## What you've been given

```
<package root>/
├── AGENT_HANDOFF.md            ← you are here
├── SHARING_GUIDE.md            ← human-facing: which bundle for which audience
├── mcp.reference.json          ← working MCP server config (sanitize the path)
│
├── codesys_agent_kit/          ← THE STEERING RULES — read these first
│   ├── README.md
│   ├── 01-codesys-mcp.md         what the MCP can / can't do, NullRef triage
│   ├── 02-test-manager.md        Test Manager XML format, action vocab, gotchas
│   ├── 03-variable-paths.md      canonical variable path forms (critical)
│   ├── 04-deployment-methodology.md  recon → probe → author → run → iterate
│   └── 05-browser-hmi.md         optional: pipe PLC data to a web HMI
│
├── test_manager_handoff/       ← worked Test Manager example (StopLight 7/7)
│   ├── HANDOFF.md
│   ├── docs/ (01–06 + README)
│   ├── examples/ (passing test, probe, deployment-plan template)
│   └── reference/ (4 CODESYS-shipped sample scripts)
│
└── browser_hmi_handoff/        ← two browser-HMI architectures (MQTT + OPC UA)
    ├── HANDOFF.md, CHEATSHEET.md
    ├── docs/ (01–09 + README)
    ├── lib/ (FB_MqttHmi + FB_OpcUaHmi + JS widget API)
    ├── opcua_relay/ (Node.js OPC UA → WebSocket relay)
    └── stoplight/ (MQTT-driven HMI demo)
```

## Your reading order

Don't read everything. Read in this order and stop when you have what
the task needs:

1. **`codesys_agent_kit/README.md`** — orientation + prerequisites.
2. **`codesys_agent_kit/03-variable-paths.md`** — the single most
   expensive lesson. Variable addresses are `Device.Application.<POU>.<var>`;
   `Plc Logic` is in the tree but NOT in addresses. Internalize this
   before touching Test Manager.
3. **`codesys_agent_kit/04-deployment-methodology.md`** — the
   recon → probe → author loop. This is how you approach a project
   you've never seen.
4. **`codesys_agent_kit/01-codesys-mcp.md`** — the MCP tool surface,
   what it can and can't read, and how to triage NullReference errors.
5. Then, task-dependent:
   - Writing tests → `codesys_agent_kit/02-test-manager.md`, then
     `test_manager_handoff/` for worked examples.
   - Browser HMI → `codesys_agent_kit/05-browser-hmi.md`, then
     `browser_hmi_handoff/`.

## The non-negotiable rules (TL;DR of the rules you'll read)

- **Variable paths**: `Device.Application.<POU or GVL>.<var>`. Never
  include `Plc Logic` in a runtime address. MCP browse paths DO include
  `Plc Logic` — two different namespaces, don't mix them.
- **Probe before you author**: run a Test Manager script with
  `IgnoreResults=True` on every assertion to confirm paths resolve
  before writing real tests. ~5 min saves hours.
- **Save before you run**: Test Manager `LoadProject` discards the
  in-memory project and reloads from disk. Ctrl+S first or lose work.
- **Strict enums**: compare with qualified literals (`E_State.Red`),
  not integers.
- **Modular tests**: one script per behavior, not one mega-script.
  LoadProject + Login is ~90s; small scripts let you re-run only the
  affected one.
- **Treat Test Manager failures as your bug**: the runner is mechanical.
  Wrong path, compare value, or timing is nearly always the cause.

## MCP setup

`mcp.reference.json` is the working config from the source machine.
The `command` path is machine-specific:

```
C:\Program Files\CODESYS 3.5.22.20\...\CodesysMCPBridge.exe
```

Your operator needs to point it at wherever their CODESYS MCP bridge
is installed, then drop the config at `.kiro/settings/mcp.json` (or the
host agent's equivalent). The `autoApprove` list is a reasonable
starting set of read + write tools.

## Prerequisites your operator needs

- CODESYS V3.5 SP22+ with the CODESYS MCP bridge installed.
- CODESYS Professional Developer Edition (PDE) for Test Manager.
- A running CODESYS runtime/gateway (Win V3 x64 SoftPLC is most common).
- For the browser-HMI path only: Mosquitto (MQTT) and/or Node.js v18+
  (OPC UA relay).

## What's intentionally NOT in this package

- The source project's proprietary `.project` files. The patterns are
  generic; a full ST source listing to recreate the StopLight demo is
  in `browser_hmi_handoff/docs/08-source-listing.md`.
- Machine-specific test reports and in-progress project notes.

If you need those, ask your operator. Otherwise everything you need to
behave sensibly on a CODESYS project is in the three bundles above.
