# M9 campaign runtime handoff

Implemented 2026-10-31. M9-A through M9-E pass deterministically. **M9-F has not run; no paid Meta call or new live PLC campaign was made.**

## Run and inspect

```powershell
npm.cmd run proof:m9
```

This runs TypeScript checking, the complete offline test suite, and three headless campaigns: a normal fake-connector experiment, an adaptive fake-connector investigation, and an evidence-only review of preserved M7. It needs no model, network, PLC, credentials, or UI. Each invocation writes a new directory under `artifacts/m9/`; `artifacts/m9/latest.json` identifies the latest result. Each campaign has a JSONL ledger and a deterministic JSON report.

`src/campaign/contracts.ts` is the v1 contract source. `npm.cmd run proof:m9:contracts` exports JSON schemas and per-event examples. Golden replay fixtures are changed only by the explicit development command `node scripts/export-campaign-contract.js --update-golden`; normal tests never regenerate their expected results.

## Proof matrix

| Breakpoint | Result | Proof and limits |
|---|---|---|
| M9-A | Pass | Versioned event/tool schemas; strict validation; append-before-effect journal; exclusive-create JSONL writer with fsync; sequence/hash-chain validation; golden reconstruction of campaign projection. |
| M9-B | Pass | Fake provider creates a plan and introduces an unassigned carton through the preserved Wonder world and actual `LiveWorldCoordinator`, using a fake `BenchConnector`. Every executed action has an outcome; the world intervention cites its complete image, acknowledgement and PLC-output evidence. |
| M9-C | Pass | A missing expected output produces a discrepancy. The fake provider derives a new persistence experiment from the observed signal/value, adds it to the plan, executes a longer observation and records a grounded finding. Initial plan contains no follow-up. Experiment selection lives entirely in the provider fixture; the runtime has no conveyor investigator. This proves the loop, not Wonder's diagnostic quality. |
| M9-D | Pass | Independent 100 ms scheduler while a provider is pending; Pause/resume; Stop with pending requests/actions; zero reset; explicit passthrough exit; stale/boot/acknowledgement checks; quarantined timeouts; request/check/repair/campaign/session budgets; warning at $3, hard stop at $5; no silent retries; malformed/repeating decision limits. |
| M9-E | Pass | The same `CampaignRuntime`, ledger, projection, finding validator and completion oracle review all **181 original coordinator events and 88 acknowledgements** from preserved M7 without contacting a PLC. Provenance retains the historical PLC/world hashes. This is historical measurement-DUT evidence, not final conveyor-controller coverage. |
| M9-F | Not run | Optional one-call Wonder checkpoint is implemented and requires explicit user authorization plus its command flag. Deterministic checks run again before spending. |

The tests in `test/campaign.test.ts` include the actual flattened `commit.acknowledged` event emitted by `src/live/coordinator.ts`, rejection of the incompatible nested-`receipt` shape, altered derived evidence, all event payloads, every bounded tool's arguments, all six outcome states, adaptive behavior, golden replay, cancellation and cost exhaustion. Existing proof-chassis, budget and live-coordinator tests remain in the default suite.

## Runtime boundary

`CampaignRuntime` asks a `CampaignProvider` for a bounded decision at experiment/tool-result boundaries. The provider can create/update a plan, complete the active experiment, and request up to eight tools. The runtime starts the next proposed experiment automatically. Follow-ups need a novel objective, existing evidence citations and an authorized category; they need no additional engineer approval.

`CoordinatorCampaignDriver` owns the independent 10 Hz timer. It serializes interventions at coordinator boundaries, then steps the existing generated world and correlates the commit receipt. A model never writes individual scan values. Timing overruns are visible and never cause catch-up bursts. Virtual-clock tests prove scheduling independence; they do not requalify the transport's sustained rate. The existing M3/M6 10 Hz qualification remains the transport evidence.

The driver is an adapter around the existing `src/live` contract. No live connector or coordinator file was changed. The original coordinator event is preserved unchanged inside `coordinator.event.data.source`. Derived raw-image, acknowledgement and output events must exactly match that source. Held/reset commits use the same flattened shape, with envelope origin `campaign-driver`; imported M7 uses `preserved-m7`. Source sequence numbers are local to their origin; campaign sequence is the ordering authority.

All raw, physical, fault, model-response and original-source records remain available in the full ledger. A diagnosing provider gets a filtered view, never the full ledger. PLC findings require exact signal/value claims against `plc.output` IDs. The report keeps fault truth, world references, observed PLC claims, inference, assumptions and uncertainty separate. Experiment conclusions are `observed` or `inconclusive`; this lane does not fabricate requirement passes from a model's prose. Finding acceptance means an engineer reviewed it; it is not an automatic controller-coverage verdict.

## Operator semantics

- **Start Campaign:** one authorization of selected categories, including adaptive investigations within that scope. The campaign pins specification, logical I/O manifest, PLC build, world hash, provider and connector identities. No tool edits a PLC project or program.
- **Pause:** abort the current decision/wait, drain the bounded in-flight coordinator operation, freeze world time and refresh the unchanged raw image. PLC scanning continues. Resume uses the same world and rejects work based on an obsolete campaign revision.
- **Stop:** cancel/drain agent and tool work, settle outstanding cost reservations, finalize the report, stop the campaign clock and retain the last applied input image. It deliberately does **not** call `connector.close()`, because a transport adapter may deselect simulation during close.
- **Reset Simulation:** acknowledge a complete false/zero/empty input image, remain simulated and held. This v1 requires a **new world instance/campaign** before evolution resumes; it does not reuse dirty generated state after a reset.
- **Exit Simulation:** a separate explicit `SimulationExit` capability must select hardware passthrough and return an observation confirming simulation is off. It is never implied by Pause, Stop or Reset.

`BenchConnector` has no cancellation or passthrough API. Consequently a connector timeout quarantines the driver: no new operations, last **confirmed** image/snapshot retained, outcome uncertain, no automatic reconnect/retry. A transport operation already in flight may still complete after a timeout. Reconcile the actual PLC image/session before constructing a new driver; do not describe a timed-out write as definitely unapplied. Callbacks returning late cannot restart campaign actions. Stop waits for bounded initialization too.

The preserved world runs trusted code in-process, as M7 did. Promise deadlines bound asynchronous operations; they cannot preempt a synchronous infinite JavaScript loop. Arbitrary new generated source still needs the separately accepted isolated compilation/validation/hot-reload workflow. M9 adds no code-execution tool and changes no generated-world physics.

## Capabilities and honest limits

The conveyor binding translates semantic tools into declared world controls; it contains no expected sequence or diagnostic policy. Injection parameters are validated, and each injection has salted committed truth. Clearing a fault does not certify recovery; observe PLC behavior separately.

The preserved world lacks WCS route-assignment control, so `assign_route` returns `rejected`. `requestedRoute` on `introduce_carton` is world metadata, not proof that a PLC accepted a WCS offer. Missing HMI adapters return `inconclusive`; connected adapters must supply timestamped action/frame/clip references. Screen evidence is not substituted for PLC evidence.

`branch_or_reset_world(mode=branch)` saves an attributable snapshot/image checkpoint. It does not silently migrate or replace the live world. The preserved generated snapshot omits some fault/device dynamic state, so the checkpoint is **not certified as an exact full-state replay or hot-reload image**. Full snapshot restoration remains in the existing generated-world/hot-reload lane. A zero reset is implemented and evidenced independently.

Blind mode requires a fresh provider instance and separate injector setup before the first diagnosis request. Fault parameters, source controls, raw-effect causes, entity truth, branch snapshots and previous provider responses are excluded from its evidence view. Evidence inspection tools use the same filter. The diagnosing provider cannot inject its own hidden fault. This proves context isolation, not an independently scored blind Wonder diagnosis. The full report/ledger is an engineer artifact and must not be sent back into a still-blind provider context.

## Budget and paid checkpoint

`CampaignBudget` delegates admission and accounting to the accepted `ModelBudgetGuard`. Defaults remain $1 per request, $2 per repair episode, warning $3/campaign, hard $5/campaign, hard $15/session and 300,000 ms/request. The per-check hard bound defaults to $5 and is accounted separately. Request, check, repair, campaign and session totals are ledger events. Provider token/cache/reasoning usage is preserved when available. Fake usage is $0.

Every started hosted request is charged its conservative reservation even on timeout, cancellation, HTTP error or malformed output. Actual reported overruns are retained and stop further calls. Repair failure counting remains the accepted guard's capability; M9 does not add a generated-code repair workflow. Errors, repetition, turn exhaustion and request deadlines pause the agent without implicit retry spending. The world continues during an ordinary model request; a hard budget stop holds the current valid world/image. There is no automatic budget extension.

Only after explicit user authorization:

```powershell
npm.cmd run proof:m9:wonder -- --authorize-paid-wonder-checkpoint
```

This optional command re-runs type checking, all offline tests and the headless proof before making **at most one** `muse-wonder-1.0` request against preserved M7 context. It reserves $1, caps output at 3,000 tokens, uses the accepted five-minute deadline, preserves the response before decision validation, performs no automatic retry and makes no live PLC connection. It is a provider checkpoint, not a complete paid live campaign. Exact dollar billing is unavailable; the report labels the conservative reservation. A durable session reservation and exclusive lock prevent successive/concurrent commands from silently resetting the $15 session cap. After a process crash, reconcile a surviving session lock and account explicitly rather than deleting them to retry.

## Next integration step

The UI can consume [the v1 integration contract](m9-ui-contract.md) now. A future live campaign supplies a qualified `BenchConnector`, the preserved world, its own complete provenance and the driver; it also supplies explicit HMI/Exit capabilities when available. The executable M7 OPC UA adapter remains in its existing script and was not refactored or invoked here. The current M7 measurement DUT cannot support a final routing/alarm/WCS conveyor verdict. The separately owned demo-controller lane must establish that coverage with new evidence.
