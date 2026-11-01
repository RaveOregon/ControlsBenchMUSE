# M10 lane B: hosted portal, command acknowledgement and actual HMI tile

Convergence update: `codex/m10-convergence` now includes the qualified M8 factory and promoted Lane C view mount. `npm run host:m8` is the later masked launch; `npm run verify:convergence` verifies all three lanes offline. Read `docs/m10-convergence.md` for the current proof, ownership, custom three-page HMI connection and live limitations. The lane-specific status below is historical.

Branch `ui/m10-portal-host` from `m10-base`. This lane adds a host process and portal adapters. It does not change `codesys/`, `src/live/`, `src/campaign/` or lane A's M8 connector. Until the M10 connector is merged, every hosted run uses the deterministic fake connector and is labeled `fake_connector`.

## Run

```powershell
cd ui; npm run build; cd ..
npm run host                                   # http://127.0.0.1:5179, fixture campaign
npm run host -- --hmi-url http://<plc>:8080/webvisu.htm --artifacts artifacts/portal-host
npm run host:adaptive                          # fixture campaign with an adaptive follow-up
```

For UI development, run the host and `npm run dev` in `ui/`. Vite proxies `/api` to the host. A hosted portal opens on Live. Replay still plays the preserved Gate A–D and M0–M7 evidence. Without a host, Live falls back to the V1 `window.controlsBenchPortal` bridge.

`--hmi-url` (or **Setup → PLC HMI / WebVisu source**) launches a dedicated, visible Edge/Chrome profile on that URL. The engineer operates that window directly. `--hmi-headless` hides it. `CONTROLSBENCH_HMI_BROWSER` selects the browser executable. `--artifacts` preserves each campaign ledger (`<campaignId>/campaign.jsonl`), every HMI frame and `hmi/hmi-session.jsonl`.

## Architecture

| Piece | File | Role |
|---|---|---|
| Wire protocol | `src/host/protocol.ts` | Types shared by host and portal: envelopes, projection mirror, commands, acknowledgements, HMI session/frame/action |
| Integration seam | `src/host/campaign-factory.ts` | `CampaignFactory.create({ ledger, hmi, scope })` returns `{ runtime, simulationExit?, dispose? }`. The fixture factory and the future M10 factory share this shape. |
| Campaign host | `src/host/campaign-host.ts` | One active `CampaignRuntime`; ledger fan-out; command execution; evidence-backed acknowledgements |
| HMI hub | `src/host/hmi.ts` | Session state, timestamped frames, engineer inputs, stale/disconnect detection, M9 `HmiAdapter` |
| WebVisu source | `src/host/cdp-webvisu.ts` | Controlled browser over the DevTools protocol. No extra dependency. |
| Transport | `src/host/http.ts` | SSE `/api/stream`, `POST /api/commands`, `/api/host`, `/api/campaign/report`, `/api/campaign/ledger`, `/api/hmi/frames/<session>/<n>`, built portal |
| Envelope check | `ui/src/adapters/host/envelope.ts` | Version, campaign ID, contiguous sequence, ID format, WebCrypto hash chain, dedupe; a conflicting duplicate is an integrity error |
| M9 adapter | `ui/src/adapters/host/m9-adapter.ts` | Envelope → portal events; every event keeps its campaign event ID |
| Hosted session | `ui/src/adapters/host/hosted-session.ts` | Portal `CampaignSource`: projection, commands, acknowledgements, HMI state, skew-corrected host clock |
| Views | `CampaignTruthPanel.tsx`, `HmiSurface.tsx`, `model/hmi-tile.ts` | M9 record shown verbatim; actual-HMI tile |

### Campaign truth

The host sends M9 envelopes plus `ledger.state` with every batch. The portal validates the envelopes and shows that projection verbatim. It does not re-derive campaign state. Raw images, acknowledgements and outputs come from the derived public `world.raw_image`, `plc.acknowledged` and `plc.output` events, which the ledger already checked against their flattened coordinator source. Ingestion time and source time stay separate. Truth-lane world events feed only the engineer's simulated world view. Unknown additive v1 types, such as lane A's `controller.action`, appear as generic records without a portal change. M9 states never become requirement verdicts. While hosted, the M9 record replaces the built-in plan's experiment and finding cards.

Evidence classes stay distinct. `fake_connector` outputs are labeled surrogate. `preserved_live_plc` is shown in replay mode as "PLC · recorded". `live_plc` is the only class shown as live PLC.

### Command acknowledgement bridge

1. The portal records the command as `pending` and changes no displayed state.
2. `POST /api/commands` returns 202. That means the host received it, not that it applied.
3. The host runs commands one at a time and calls the runtime.
4. The host sends `applied` only when the ledger shows the effect, citing those event IDs:

| Command | Applied when | Cited evidence |
|---|---|---|
| start | ledger reaches `running` | `campaign.authorized`, `campaign.state` |
| pause / resume | ledger shows the state change | that `campaign.state` |
| stop | the run is finalized | `campaign.state`, `report.finalized` |
| reset_simulation | the zero image is acknowledged | `coordinator.event`, `simulation.reset` |
| exit_simulation | passthrough is observed | `simulation.exited`, `connector.state` |
| review_finding | the review is recorded | `finding.accepted` or `finding.rerun_requested` |
| configure_hmi | the first frame is captured | `hmi-frame:<session>:1` |

The acknowledgement is sent on the stream after the events it cites, and tests check that ordering. A request ID runs at most once; a repeat returns the recorded outcome. The host has no timeout race. If the portal deadline (15 s) passes, the portal shows `timed_out` with applied state unknown, ignores the late acknowledgement, and the projection shows what actually happened.

Runtime v1 has no steering channel and no physical-output suppression, so the host rejects those commands with that reason. Enter Simulation is accepted only as a selection for the next campaign; SimulationApplied still requires a connector observation. Commands are refused from cross-origin browsers, and requests that are not JSON or exceed 64 KB are rejected. The host binds to loopback.

### HMI tile

- Pixels come only from the controlled browser that rendered the configured page. Each frame carries the request and capture timestamps, page URL, SHA-256 and a stable reference, and is served with its exact bytes.
- With no frame, the tile says exactly **HMI not observed/tested**. That includes the configured, connecting and error states.
- Nothing draws an HMI from OPC UA values.
- On capture failure, loss of the browser, disconnect, or a lost host link, the last frame stays on screen under an overlay: stale, disconnected or host link lost. The portal also marks a frame stale by its age, independent of the host.
- Engineer pointer and key inputs on the controlled page are recorded as HMI actions. Key values are never recorded. An action proves only that the input reached the browser. A visible result and the PLC effect are separate evidence.
- M9 `capture_hmi_evidence(frame)` returns that frame's reference and capture time, which the runtime ledgers as `hmi.evidence`. Clip capture and `request_hmi_action` are inconclusive: Muse HMI operation (S2) is not implemented. `deliverPointer` is the S2 seam.
- The simulated world view and the HMI tile are separate components with separate data. **Expand** enlarges the tile over the page while the campaign view stays loaded behind it.

## Live M8 connector seam (lane A)

Lane A supplies a module exporting `createCampaignFactory(options): CampaignFactory`. It builds the same runtime it already builds for M10, on the host's ledger:

```ts
export function createCampaignFactory(): CampaignFactory {
  return { id: "m8-live", label: "M8 build 8001 · live", evidenceClass: "live_plc", claimBoundary: "…", connectorId: "m8-opcua",
    outputIds: [...], supportsExitSimulation: true,
    async create({ ledger, hmi }) {
      // connector = new M8OpcUaConnector(...); coordinator; driver = new CoordinatorCampaignDriver(coordinator, ledger, m8WorldBindings)
      const runtime = new CampaignRuntime({ ledger, driver, hmi, controller: m8ControllerActions(connector, ledger), evidenceClass: "live_plc", ... });
      return { runtime, simulationExit: /* M8 passthrough select + observe */, dispose: () => connector.close() };
    } };
}
```

Then run `npm run host -- --campaign-module path/to/m8-factory.ts`. The host rejects a runtime built on any other ledger. Credentials stay inside that factory or its environment; they never reach the portal or the ledger. Only one lane may operate the live runtime at a time.

## Verification (2026-10-31)

- Root typecheck passes. Runtime tests: 37/37, including the new host and CDP tests.
- UI typecheck and production build pass. UI tests: 49/49 (40 existing + 9 new).
- Replay integration: the client hash chain reproduces every hash in the golden, normal, adaptive and preserved-M7 ledgers. All 88 M7 PLC acknowledgements map with exact sequence, epoch, latency, capture cycle and source timestamp. Every finding claim opens the exact `plc.output` it cites. The fake connector is never labeled PLC. Gap, tamper, version and conflicting-duplicate cases each quarantine the campaign.
- Live integration (HTTP/SSE, fake connector):
  - Start through completion; the portal projection deep-equals `replay(host ledger)`.
  - Pause, resume, stop, reset, exit and enter, each with the evidence it cites.
  - A duplicate request ID is not re-executed. Cross-origin, unsupported-type and non-JSON requests are refused.
  - Steering and suppression are rejected honestly.
  - A reconnecting client resumes from Last-Event-ID, and redelivered events are deduplicated.
  - A factory that does not use the host ledger is rejected.
- HMI: real headless Edge captured a local stand-in page (not WebVisu): JPEG bytes, timestamps, URL, a delivered pointer input, and stale with the last frame held after the session dropped. Through the host, the stand-in was captured in the portal tile with identity and evidence reference. See `ui/docs/screenshots/hosted-campaign.png`.

## Not done / not claimed

- No WebVisu exists yet (M8-E is unauthored), so no actual WebVisu pixels have been observed. The tile is verified against a labeled stand-in page.
- No live PLC campaign, no M8 connector and no Muse call ran in this lane. The S1 pass gate is open until an engineer operates the real WebVisu while the M10 connector runs.
- Muse operating the HMI (S2), clip capture, browser-side MP4 recording, and lane C's generated machine-view mount are not implemented. The existing diagnostic world schematic is still the simulated view.
- Before merging: shared-file changes are the `package.json` scripts and test list (lane A also edits the test list) and the `tsconfig.json` include for `src/host`.
