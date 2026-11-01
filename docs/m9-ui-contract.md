# Campaign v1 UI integration

This contract is additive to `src/live`; it does not require changes to the Claude UI worktree. The TypeScript source is `src/campaign/contracts.ts`. Machine-readable exports are `docs/contracts/campaign-v1.schema.json` and `docs/contracts/campaign-tools-v1.schema.json`.

## Consumption

An event envelope contains `schemaVersion: "controlsbench.campaign.v1"`, `campaignId`, `id`, monotonic **campaign** `sequence`, ingestion `atIso`, `type`, `visibility`, `data`, `previousHash` and `hash`. Events are append-only. Reconnect by requesting sequence greater than the last accepted campaign sequence. Deduplicate by `(campaignId, sequence)`; a duplicate ID with different bytes is an integrity error. Reject unsupported versions, sequence gaps, invalid hashes and incomplete JSONL records. Do not infer state from arrival timing or re-sort by source timestamps.

`replay(events)` reconstructs campaign state without a model, network or PLC. `CampaignLedger.state` provides the same projection during execution. `report(events)` derives the report; do not invent a second UI truth model. Raw source timestamps and local source sequence/monotonic values remain in `coordinator.event.data.source`. `origin` distinguishes live coordinator, campaign-driver hold/reset commits and preserved M7. Campaign and source timestamps answer different questions: when this runtime ingested the evidence, and when its original source observed it.

The original acknowledgement shape is:

```json
{
  "sequence": 4,
  "atIso": "2026-10-31T00:00:00.000Z",
  "atMonotonicMs": 100,
  "lane": "connector",
  "data": {
    "action": "commit.acknowledged",
    "cause": "world.tick:1",
    "workstationEpoch": "fixture-epoch-1",
    "workstationSequence": "1",
    "slot": 1,
    "latencyMs": 0,
    "bootIdentity": "fixture-boot-1",
    "plcCycle": "1",
    "outputCaptureCycle": "1",
    "image": { "PE_Entry": false },
    "outputs": { "Motor_RunCmd": false }
  }
}
```

There is no `data.receipt`. Derived `world.raw_image`, `plc.acknowledged` and `plc.output` events cite the source wrapper's campaign ID in `sourceId`. They cannot silently alter the values in the original event.

## UI mappings

| UI surface | Event/projection source |
|---|---|
| Preparing, running, paused, stopped, completed, failed | `campaign.state`; `state.status` |
| Selected scope | `campaign.authorized.categories`; one authorization per campaign |
| Plan and adaptive investigations | `plan.created`, `plan.updated`, `experiment.proposed/started/completed`, `followup.added`; `state.experiments` |
| Activity text and request elapsed time | `agent.activity`, `agent.request`; request start timestamp plus client elapsed time. A model request is separate from connector/world health. |
| Action status | `action.requested` plus exactly one terminal `action.*` outcome; stable action ID and based-on revision |
| Connector quality | `connector.state`: fresh, stale, quarantined or passthrough, with reason and age. Held simulation is different from passthrough. |
| Raw image and PLC output | `world.raw_image`, `plc.output`; preserve epochs, applied sequences, PLC cycle and capture cycle |
| HMI evidence | `hmi.action`, `hmi.evidence`: reference, timestamp and frame/clip kind. No adapter means not visually tested. |
| Discrepancies and findings | Exact evidence IDs; keep observations, injected truth, inference, assumptions, uncertainty and review status visibly separate |
| Budget | `budget.accounted`, `budget.warning`, `budget.hard_stop`; show reserved and settled request costs plus check/repair/campaign/session totals |
| Final report | `report.finalized.throughSequence` identifies the finalized prefix. Later engineer finding reviews or explicit Reset/Exit events extend the audit trail. |
| Provenance/evidence badge | `provenance.recorded`; always show `fake_connector`, `preserved_live_plc` or `live_plc` prominently |

Model summaries, titles and inference are authored interpretation. Only exact cited signal/value claims are mechanically checked. `finding.accepted` is engineer review, and `finding.rerun_requested` is a recorded request; it does not automatically execute another run. No requirement pass/fail coverage is inferred from these states.

## Commands and outcomes

Host integration calls `runtime.start()`, `runAgent()`, `pause()`, `resume()`, `stop()`, `resetSimulation()`, `exitSimulation(adapter)` and `reviewFinding(...)`. Start authorizes the selected categories and adaptive work. Resume resumes the held runtime; the host calls `runAgent()` again after the cancelled request has settled. Show explicit Reset and Exit controls. A reset requires a new world/campaign before further evolution in v1.

Agent tools are bounded by the exported argument schemas. Every action carries a stable ID and campaign revision. Normal world ticks do not increment that decision revision; interventions/lifecycle/plan changes do. Thus a long model response is not automatically stale on every 100 ms tick, while a response based on a superseded operator state is rejected. IDs are never retried automatically after an uncertain outcome.

| Outcome | Meaning |
|---|---|
| `requested` | Intent durably journaled; no application claim yet |
| `applied` | Tool-specific success evidenced. For a world intervention, control ran and a complete raw image was acknowledged. This alone does not prove fault efficacy or PLC correctness. |
| `rejected` | Invalid, unsupported, out-of-scope or otherwise inadmissible request |
| `timed_out` | Declared deadline elapsed; an already-issued external operation may still have applied |
| `stale` | State revision, connector freshness, session/boot or capture correlation cannot support application/observation |
| `inconclusive` | Interrupted action, missing capability or insufficient evidence; no pass implied |

A requested record lacking a terminal outcome after a crash must remain **unresolved**. Inspect actual world/PLC state before any retry. The ledger opener intentionally refuses to append to an existing run file; offline replay remains available. Quarantine cannot be cleared by pressing Resume.

## Truth isolation and fixtures

Full ledgers and reports are engineer artifacts. `visibility: truth` includes unfiltered coordinator sources, generated-world evidence, fault truth, checkpoints and raw provider responses. Do not forward those records to blind diagnosis. `runtime.agentContext()` and `inspect_recent_evidence` use the same blind allowlist; source causes and fault names are stripped by selecting only derived raw-image/PLC/HMI/observation events. The UI may display truth to the engineer in a distinct pane, but must not feed it into the diagnosis request.

- `test/fixtures/campaign-contract-examples.json`: independent payload shape examples for every event type; not a single executable history.
- `test/fixtures/campaign-golden.jsonl`: complete normal fake campaign through the real coordinator contract.
- `test/fixtures/campaign-golden-projection.json`: exact expected projection.
- `artifacts/m9/latest.json`: index to normal, adaptive and preserved-M7 ledgers/reports.

These are integration fixtures, not invented live connection state. No UI files or PLC files were edited by this lane.

## M10 convergence additions

The optional `HostedCampaign.run()` hook executes the fixed M10 deterministic campaign instead of the provider loop. Resume continues that single executor; it must not restart the plan. Host commands still cite the same ledger, and the public projection/report do not gain simulator entities. The engineer view consumes separate truth-lane coordinator entity publications, their world time and exact evidence references; they remain excluded from blind model context.

New flat `commit.acknowledged` source records may include optional `outputQuality: Record<signal, "good" | "bad" | "unknown">`. M8 supplies it only after checked Good samples. The original flat keys and derived event/reference shapes are unchanged; absence in historical ledgers stays unknown. Held-image receipts carry the same metadata. See `docs/m10-convergence.md` for the promoted-view mount, runtime ownership and later live launch.
