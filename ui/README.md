# ControlsBench Muse — campaign workspace (UI lane)

A thin engineering workspace for the hackathon demo. Today it **replays preserved evidence** (Gate A–D and M0–M2); the live coordinator attaches later through the same event adapter. It does not operate CODESYS, make model calls, or simulate the conveyor.

## Run

Requires Node.js 22+.

```powershell
cd ui
npm install
npm run dev        # http://localhost:5178
npm test           # 30 focused tests over the real preserved artifacts
npm run build      # typecheck + production bundle in ui/dist
```

Open the page, review the plan scope, and press **Start Campaign**. Replay speed (1×–20×) and **Skip to next record** are replay-only conveniences and are labeled as such.

## What the workspace shows

- **Campaign plan:** summary, single Start Campaign authorization, eight expandable engineering groups plus the closing evidence audit. Each check states what Muse manipulates, what it observes, the pass oracle, and which preserved record backs it. Scope is editable before start and locked after; Muse-added investigations (AI-2) appear mid-run.
- **Live activity:** a headline plus Muse / Coordinator / Connector / World / PLC health, elapsed time on the record's own clock, and the last meaningful activity. `src/model/activity.ts` separates reasoning, healthy waits, paused, connector loss, known PLC restart, PLC staleness, world stall, request timeout, condition timeout, and budget hold.
- **Connection & authority:** transport, negotiated cadence, measured ack latency, workstation vs PLC-applied sequence, outstanding echoes, boot identity changes, heartbeat age against the M5 stale rule, and simulation requested (engineer) vs applied (PLC-reported, or "not reported").
- **Machine:** an SVG schematic drawn only from recorded raw inputs, PLC outputs, carton entities, and injected faults. Geometry is parsed from the generated world's own `CONFIG`; belt marks advance from the raw `Encoder_Count`, so stops show the recorded deceleration and coast.
- **Evidence trace:** swimlanes for world action → raw input commit → PLC acknowledgement → PLC output → fault → agent action → conclusion, plus a key-event list. Every item opens in the inspector with its provenance (mode, evidence class, source file and reference, clock, run, seed, world version).
- **Raw I/O:** all 25 signals as raw values (BOOL 0/1, REAL, UDINT encoder counts), plus per-output physical-sink suppression as engineer configuration.
- **Budget:** campaign spend vs warning and hard stop, in-flight reservation, the request timer against the 5:00 limit, repair-episode spend and failures, and a plain explanation of hard-stop behaviour.
- **Controls:** Start Campaign, Pause (hold image), Stop (finalize and hold), Reset Simulation (zero the DI/AI image, stay simulated), Exit Simulation (confirmed return to hardware), Enter Simulation, and natural-language steering.

## Architecture

```text
preserved artifacts ──► adapters/replay/compose.ts ──► MuseEvent[] ──┐
                                                                    ├──► model/workspace-store.ts ──► React components
live coordinator ────► adapters/live/coordinator-source.ts ─────────┘           │
                                                                    model/activity.ts (derived status)
```

- `src/model/events.ts` — the UI-facing event contract. Every event carries `provenance` (`mode: replay | live`, evidence class, source, reference, clock). Components never see OPC UA node IDs, trace file layouts, or coordinator internals.
- `src/model/workspace-store.ts` — folds events and engineer commands into workspace state and enforces campaign transitions. It **throws if an event's mode differs from the workspace mode**, so recorded evidence cannot be shown as live, or the reverse.
- `src/adapters/replay/` — `fixtures.ts` loads the preserved files (browser via `?raw`, tests via the filesystem) and verifies LF-normalized SHA-256 against the hashes recorded in `gate-d-result.json` and `codesys/README.md`. `compose.ts` turns them into one campaign timeline. `replay-session.ts` plays it against a pausable playhead.
- `src/adapters/source.ts` — the `CampaignSource` interface that both sources implement.

### Truthful replay rules

- Every replayed event derives from a field in a preserved artifact; tests check raw inputs and PLC frames one-to-one against Gate A/B, all 10,000 M2 acknowledgements and latencies, and each model call's recorded duration and cost.
- Each episode declares its clock: `world_virtual` (surrogate trace time), `recorded_wall`, `derived_latency` (the M2 rows record latency but no timestamps), or `discrete` (untimed; spacing is presentation only, so the UI shows "timing not recorded" and never judges staleness). Condensation (M2 ×14.5, PLC restart ×10) is displayed, never hidden.
- Gate A–C world runs are labeled **surrogate** (no PLC). M0–M2 are **PLC · recorded**. CP-11 guard states are labeled **guard exercise**, not live failures. AI-1 is shown as **inconclusive** because Gate C honestly scored it `insufficient_evidence`.
- Hidden fault truth stays sealed until after the sealed diagnosis.
- Checks that need M3–M7 finish as **not run**, with the measurement they await.

## Attaching the live coordinator

`src/adapters/live/coordinator-source.ts` mirrors, structurally, the live lane's `CoordinatorEvent`, `ConnectorObservation`, and `CommitReceipt` (in progress under `src/live/` on main) without importing uncommitted code. `LiveEventMapper` turns them into live-labeled `MuseEvent`s:

| Coordinator record | UI events |
|---|---|
| `ConnectorObservation` | `plc.identity` (on boot change), `plc.heartbeat`, `simulation.state`, `connector.link` (on `connectorStale` change), `plc.output` (manifest outputs only) |
| `CommitReceipt` | changed `raw.input` values, `connector.commit`, `connector.ack` with latency and capture cycle, then the observation mapping |
| `lifecycle` / `control` / `world` lanes | `step` / `world.control` / `world.evidence` |

To attach:

1. Expose coordinator events from the workstation process (SSE or WebSocket in the browser; IPC if this is later wrapped in Electron).
2. Call `liveSession.attach({ send })` with a transport that forwards Start, Pause, Stop, Reset, Exit/Enter Simulation, suppression, and steering commands to the coordinator.
3. Feed received records into `liveSession.ingestCoordinatorEvents(...)`.

Until a transport is attached, Live mode shows nothing and cannot start. The model-call, wait, verdict, and plan-addition events need coordinator equivalents; their shapes are in `events.ts`.

## Known limits

- Local web app, not yet an Electron shell.
- In replay, Pause, Stop, Reset, Exit Simulation, suppression, and steering are recorded locally only. Nothing is sent to a PLC and no model is called.
- Browsers throttle animation in hidden or unfocused windows; the replay advances at most 1 s per frame, so it slows rather than jumping.
- The campaign plan is composed from the preserved records rather than generated by Muse in this build.
