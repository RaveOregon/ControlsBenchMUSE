# ControlsBench engineering portal

The UI replays preserved Gate A–D and M0–M7 evidence. Live mode is an attachment interface and remains unavailable until a real transport is attached. No PLC or model commands are issued by replay.

```powershell
cd ui
npm install
npm run dev        # http://localhost:5178
npm test           # 40 tests, including every real M7 acknowledgement
npm run build      # typecheck + production build
```

## Walkthrough

1. **Setup:** review the imported v0.5 conveyor specification, 25-signal raw I/O map, world v0.5.0 assumptions, selected checks, and optional HMI source.
2. **Campaign:** choose **Play recorded campaign**. Current check, Muse investigation/hypothesis, manipulation, PLC revision/cycle, and finding share one view. Speed and skip affect playback only.
3. **Observe:** Simulated World and PLC HMI/WebVisu are separate surfaces. Geometry/assumptions expand on request. Device buttons open the signal's trace evidence. HMI is explicitly **HMI not observed/tested** until actual timestamped evidence arrives.
4. **Inspect:** protocol, budget and raw I/O are collapsible. Signal inspectors retain quality, freshness and source/server/workstation timestamps. Unknown metadata remains unknown; unchanged values do not become stale merely from lacking transitions.
5. **Results:** inspect passed/failed/inconclusive/not-run coverage by evidence class; all final routing requirements remain untested. Accept a finding separately from its verdict, record/request a targeted follow-up, or export the JSON report. The exported UI trace is bounded; full raw evidence remains in the cited preserved artifacts.

## Evidence truth

- M3: 10 Hz passed; 20 Hz and 50 Hz failed. 10 Hz is the demo operating point.
- M4 output visibility and M5 practical loss/recovery passed. Physical Ethernet and server-only loss were not independently isolated.
- Reduced-scope M6 passed at 10 Hz; full matrix and 20/50 Hz task impact remain deferred.
- M7 passed live with the measurement DUT (`PE_Entry` drives `Motor_RunCmd`), with 88 acknowledged revisions. It does not pass final routing requirements.
- Surrogate/world-contract checks, connector qualification, measurement-DUT tests, and final PLC requirement tests stay separate.
- The world schematic projects generated physical truth. It is neither the HMI nor independent proof of PLC correctness.
- M7 acknowledgement record time and latency are preserved; flattened V1 send timing is explicitly derived. Missing quality and source/server timestamps are never synthesized. M4 provides actual Good status and all three timestamps.
- Hash verification uses LF-normalized preserved text and hashes recorded in Gate D and `codesys/README.md`. M7 files without an independent frozen hash are labeled accordingly.

## Live attachment contract V1

`window.controlsBenchPortal` exposes:

```ts
attachCoordinator({ send(command) { /* forward to real coordinator */ } })
detachCoordinator()
ingestCoordinatorEvents(records) // current src/live flattened CoordinatorEvent shape
acknowledge({ requestId, outcome: 'applied' | 'rejected', detail? })
ingestEvidence(events)           // live-labeled MuseEvent[] for plan/model/finding/world data
ingestHmi(observation)           // registered source ID, mode, capturedAt, action/frame/clip
```

Commands carry `{ contractVersion: 1, requestId, type, payload? }`. Transport delivery is not an application acknowledgement. Emit `applied` only after the coordinator applies the requested action. Pending commands keep confirmed displayed state unchanged; rejection, disconnect, send errors and a five-second timeout are visible. Unknown/duplicate/late acknowledgements do not silently apply state. Reset and simulation changes additionally require real connector observations to update the applied raw image or `SimulationApplied`. Physical-sink suppression changes only after acknowledgement.

The adapter explicitly maps flattened `commit.acknowledged` records from `src/live/coordinator.ts`; it also accepts full receipts/observations. `ui/test/live-contract.test.ts` checks the preserved M7 trace field by field. The UI clock and projected coordinator timestamps share one campaign clock; replay uses its frozen playhead.

For HMI, configure a WebVisu URL or an external capture source ID in Setup. A WebVisu iframe hosts the actual configured page. A configured URL alone does not establish observed/tested status. External capture supplies `{ sourceId, mode, capturedAt, observation: 'action' | 'frame' | 'clip', note, mediaUrl?, endAt? }`. Frames/clips require real media; every accepted observation gets its own timeline lane and source timestamp. Vision-driven operation and an external capture/command server are not implemented in this UI lane.

## Hosted mode (M10 lane B)

`npm run host` from the repository root serves the built portal with an M9 campaign host. In hosted mode, Live shows:
- the authoritative M9 projection, with evidence class, experiments, actions, findings and report;
- command outcomes acknowledged only after the ledger evidence they cite;
- the actual-HMI tile fed by a controlled WebVisu browser session.

See `../docs/m10-portal-host.md`. The V1 window bridge below remains for unhosted use.

## Accessibility and validation

Buttons/disclosures replace clickable layout containers; SVG devices support Enter/Space. Inspectors trap focus, close on Escape and restore focus. Focus outlines and reduced-motion styling are included. Desktop screenshots and verification notes are in `docs/screenshots/` and `HANDOFF.md`.

The additive M9 runtime is documented in `../docs/m9-ui-contract.md`. This UI bridge V1 is not a `controlsbench.campaign.v1` ledger decoder. A host integration must consume the authoritative M9 projection/report and explicitly adapt it; raw ledger envelopes cannot be passed to `ingestCoordinatorEvents`.
