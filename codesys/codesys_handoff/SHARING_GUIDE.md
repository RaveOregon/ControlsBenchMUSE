# Sharing guide — what to send a colleague

This workspace contains three shareable bundles for working with
**CODESYS** projects via an AI agent. They serve different audiences.
Pick the right one(s) when handing off.

## TL;DR — pick by audience

| Audience | Send | Why |
|---|---|---|
| Colleague's **agent** (Kiro/Cursor/etc.) — they want the lessons but not the worked examples | `codesys_agent_kit/` | 6 markdown files, ~30 min to read. Drops into `.kiro/steering/`. Just the rules. |
| Colleague who wants to **set up Test Manager** for their project | `test_manager_handoff/` + `codesys_agent_kit/` | Worked StopLight test passing 7/7, full action reference, troubleshooting, methodology. ~2 hrs of self-teach. |
| Colleague who wants to **add a browser HMI** to their project | `browser_hmi_handoff/` + `codesys_agent_kit/` | Two architectures (MQTT, OPC UA), reusable library, working examples. ~1–2 hrs to spin up. |
| Colleague who wants **everything** | All three folders | Full set, with `codesys_agent_kit/` as the fast on-ramp. |

## What's in each bundle

### `codesys_agent_kit/` — the steering bundle (~6 files)

A minimal kit of agent steering rules. Drop into a workspace, point the
colleague's agent at it, and skip the iteration learning curve.

```
codesys_agent_kit/
├── README.md                      ← orientation, prereqs
├── 01-codesys-mcp.md              ← MCP can/can't, NullRef triage
├── 02-test-manager.md             ← TM XML format, action vocab, gotchas
├── 03-variable-paths.md           ← canonical variable path forms (always-on)
├── 04-deployment-methodology.md   ← recon → probe → author loop (always-on)
└── 05-browser-hmi.md              ← optional: pipe data to a web HMI
```

Two of the files (`03-variable-paths.md`, `04-deployment-methodology.md`)
use `inclusion: always` so the colleague's agent picks them up on every
CODESYS task. The others are `inclusion: manual` — fired with `#` in
chat when needed.

**Best for:** colleagues who have an AI agent and want it to behave
sensibly with CODESYS without reading a 50-file handoff.

### `test_manager_handoff/` — the Test Manager full handoff

A complete worked example of using **CODESYS Test Manager** (the GUI
test orchestration tool in PDE). Built and validated against StopLight,
then applied to IBIS. Includes:

```
test_manager_handoff/
├── HANDOFF.md, kiro_steering.md, VALIDATION.md
├── docs/
│   ├── 01-getting-started.md       ← first test from scratch
│   ├── 02-script-format.md         ← XML structure
│   ├── 03-actions-reference.md     ← actions with config keys
│   ├── 04-troubleshooting.md       ← errors → fixes
│   ├── 05-patterns.md              ← reusable templates
│   ├── 06-methodology.md           ← MCP + TM playbook for new projects
│   └── README.md
├── examples/
│   ├── StopLightTest (1.0).tsd.xml         ← passing 7/7
│   ├── PathProbe2 (1.0).tsd.xml            ← diagnostic probe
│   └── DEPLOYMENT_PLAN_TEMPLATE.md         ← per-project plan template
└── reference/
    └── 4 CODESYS-shipped sample test scripts
```

**Best for:** colleagues who need to set up regression tests for a
real CODESYS project, including state-machine validation and CI
integration.

### `browser_hmi_handoff/` — the Browser HMI full handoff

Two side-by-side architectures for getting PLC data to a browser:
MQTT bridge and OPC UA + WebSocket relay. Includes a reusable POU
library, JS widget API, working examples.

```
browser_hmi_handoff/
├── HANDOFF.md, CHEATSHEET.md, kiro_steering.md
├── docs/                            ← 9 numbered docs covering both paths
├── lib/
│   ├── codesys/AmznBrowserHmi/      ← FB_MqttHmi + FB_OpcUaHmi
│   └── js/                           ← browser-hmi.js widget API + 3 examples
├── opcua_relay/                     ← Node.js relay (node-opcua + ws)
└── stoplight/                       ← MQTT-driven HMI demo
```

**Best for:** colleagues who want a custom browser-based HMI for
their CODESYS project, beyond what CODESYS Visu gives them.

## How to share each bundle

### Method 1: zip and send

```powershell
# from this workspace folder
Compress-Archive -Path codesys_agent_kit -DestinationPath codesys_agent_kit.zip
Compress-Archive -Path test_manager_handoff -DestinationPath test_manager_handoff.zip
Compress-Archive -Path browser_hmi_handoff -DestinationPath browser_hmi_handoff.zip
```

Send the zip(s). Colleague extracts to their workspace.

### Method 2: copy folder directly

If you're on the same network:

```powershell
Copy-Item -Recurse codesys_agent_kit \\colleague-machine\share\
```

### Method 3: git

If your team has a shared repo, commit the bundles. Each is
self-contained and can live anywhere.

## What the colleague needs on their machine

For the agent kit + Test Manager work:

- **CODESYS V3.5 SP22+** with PDE
- **CODESYS Development System MCP Server** (the bridge that exposes
  `mcp_codesys_ide_*` tools)
- An AI agent with file-read access (Kiro, Cursor, Claude Desktop with
  filesystem MCP, etc.)

For browser HMI work, additionally:

- **Mosquitto** (if MQTT path) — get the Windows installer .exe
- **Node.js v18+** (if OPC UA path)

The handoff docs have specific install pointers in their READMEs.

## Recommended onboarding order for a new colleague

If the colleague is new to all of this, here's the suggested reading
order:

1. **`codesys_agent_kit/README.md`** — overview, prereqs (5 min)
2. **`codesys_agent_kit/04-deployment-methodology.md`** — the
   recon→probe→author loop (15 min)
3. **`codesys_agent_kit/03-variable-paths.md`** — the variable path
   gotcha (10 min)
4. **`test_manager_handoff/HANDOFF.md`** — full TM bundle entry (15 min)
5. **`test_manager_handoff/docs/01-getting-started.md`** — write
   their first test (30 min)

Total: ~75 minutes from "never seen this" to "writing tests against
their own project". After that the docs become reference material
they read on demand.

## What this workspace is NOT meant to share

- The user's specific CODESYS project files (`*.project`) — those are
  proprietary; the patterns are generic
- `codesys_project_notes/` — project-specific notes for the StopLight
  build that aren't useful out of context
- `ibis_workcell_docs/` — earlier IBIS map work, kept for personal
  reference but not part of the handoff
- `test_scripts/` — running test scripts and reports tied to specific
  paths on this machine; not portable

If a colleague wants to recreate the StopLight project, the source
listing is in `browser_hmi_handoff/docs/08-source-listing.md`.

## Maintenance

These bundles are **frozen at the validation date** in their HANDOFF
files (May 2026 against CODESYS V3.5 SP22.20). When CODESYS or the
MCP bridge updates and something changes, update the affected doc
and bump the validation date. Corrections welcome.

## Open work / next steps

`test_scripts/IBIS_TEST_PLAN.md` tracks the IBIS deployment in
progress. Phase 2 (probe) is green; Phase 3 (real tests) is the next
work item. Anyone picking up where we left off should read that plan
first.
