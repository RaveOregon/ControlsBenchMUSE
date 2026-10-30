# codesys_agent_kit

A minimal steering bundle for using an AI agent (Kiro, Cursor, etc.)
with **CODESYS** projects via the **CODESYS MCP bridge** + **CODESYS
Test Manager**.

## What this is

5 markdown files. Each captures a distinct domain. Drop the whole
folder into your workspace, point your agent at it, and skip the
hundred-iteration learning curve we paid for.

```
codesys_agent_kit/
├── README.md                       ← you are here
├── 01-codesys-mcp.md               ← what the MCP can / can't do
├── 02-test-manager.md              ← TM XML format, gotchas, action vocab
├── 03-variable-paths.md            ← canonical variable path forms
├── 04-deployment-methodology.md    ← recon → probe → author loop for new projects
└── 05-browser-hmi.md               ← optional: pipe PLC data to a web HMI
```

## How to use it

### Option 1: Steering folder (Kiro / similar)

Drop `codesys_agent_kit/` into `.kiro/steering/` (or your agent's
equivalent). Most files use `inclusion: manual` so they only fire
when you context-include them with `#` in chat. The methodology and
variable-paths files use `inclusion: always` because they apply to
every CODESYS task.

### Option 2: Plain repo docs

Drop `codesys_agent_kit/` anywhere. Tell your agent: "before working
on this CODESYS project, read codesys_agent_kit/README.md and the
appropriate sub-docs." Works in any agent that can read files.

## Prerequisites

For your agent to actually drive CODESYS:

- **CODESYS V3.5 SP22+** with the **CODESYS MCP bridge** installed
  (the MCP server that exposes `mcp_codesys_ide_*` tools).
- **CODESYS Professional Developer Edition (PDE)** for Test Manager.
- A working CODESYS runtime/gateway (Win V3 x64 SoftPLC is the most
  common; Linux SL and RTE V3 also work but pick one consistently).

For the optional browser HMI bits:

- **Mosquitto** MQTT broker (if using the MQTT path).
- **Node.js** with `node-opcua` and `ws` (if using the OPC UA WebSocket
  relay path).

## Why this exists

Working with CODESYS via an agent is high-leverage but full of subtle
traps. Variable paths look obvious but aren't (`Device.Plc Logic`
shows up in the tree but doesn't appear in addresses). The MCP can
read most things but not POUs with SFC content. Test Manager has
typos baked into its schema that you can't fix. Strict enums need
qualified literals.

This kit captures the lessons. ~30 minutes to read; saves hours of
iteration.

## What's NOT in here

The full handoff bundles (with worked examples, validated test
scripts, source listings) live separately:

- `test_manager_handoff/` — Test Manager pilot with passing
  StopLightTest 7/7, validated against CODESYS V3.5 SP22.
- `browser_hmi_handoff/` — MQTT + OPC UA paths to a browser HMI,
  with reusable `FB_MqttHmi` library and JS widget API.

If your colleague wants those, share them too. But for "just teach
my agent what to know," this kit is enough.

If you have access to the full workspace, see `SHARING_GUIDE.md`
at the top level — it explains which bundle to send to which
audience.
