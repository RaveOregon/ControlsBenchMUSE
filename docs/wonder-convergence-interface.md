# Wonder lane: convergence base and process boundary

Coordination snapshot: 2026-11-01. This document records verified interfaces and integration requirements. It is **not** a completed coordinator IPC API or permission to acquire/recover the PLC.

The later W1/W2 and H2 update at the end supersedes the earlier recorded HMI-state snapshot below. Historical snapshots remain for attribution.

## Base and proof

Use `13c55b3` as the verified implementation base for `codex/wonder-campaign`. The subsequent convergence coordination commit is documentation only; no code rebase is required to start W0–W2. The qualifying code is `bad693d`; `13c55b3` adds the handoff and proof. `artifacts/m10-convergence/latest.json` selects the retained gate: 66 runtime/view tests, 51 UI tests, all typechecks/build, and 13 mounted-view browser checks.

The base contains A `3ab99ff`, B `7886dfd`, and C `042cc6a`. The M8 factory is the fixed six-scenario executor, not a Wonder campaign. It still runs coordinator/host code in one process. Isolation and decision-lease support must not be inferred from its offline convergence pass.

## Current contracts to retain

- `CampaignFactory.create({ledger, hmi, scope, artifactDirectory})` must construct the runtime on the **exact host-provided ledger** and use the host HMI adapter. The host checks ledger identity. One campaign must not acquire a second independently authored campaign history.
- `HostedCampaign.run()` is optional. Its presence selects the deterministic/custom executor instead of `runtime.runAgent()`. A Wonder factory should ordinarily omit it and reuse the existing bounded provider loop; adding a provider to the deterministic M8 factory alone does not make it agentic.
- `CampaignProvider.decide(context, signal)` returns a `ProviderReply`; `CampaignRuntime` already handles bounded asynchronous turns, decision validation, raw response evidence, cost settlement, stale originating revisions, repeat detection and tool execution. Extend compact context/provider behavior rather than duplicate those responsibilities.
- The event contract remains `controlsbench.campaign.v1`; preserve exact IDs, references and the flat coordinator `commit.acknowledged` shape. Optional `outputQuality` is already accepted. A lightweight `inspectLink()` has no output values and cannot substitute for a correlated full output receipt.
- Carton publications/removals are coordinator truth records, separate from the public M9 projection. The engineer's generated-view mount needs them and their world time/evidence references. Keep them out of blind diagnosis context.
- Start authorizes selected scope once. The existing M8 factory accepts only its complete fixed six-case scope; the separately selected Wonder factory needs its own truthful scope handling. Portal steering and Muse HMI action/clip capabilities currently report unsupported/inconclusive; do not advertise them as implemented.
- Preserve the common main-checkout `artifacts/m10/live.lock` ownership boundary, no automatic baseline repair, the 10 Hz ceiling and 300 ms elapsed-step guard. Provider/network/host work must not sit in the child coordinator's timing path.
- Accepted limits remain $1/request, $2/repair episode, $3 campaign warning, $5 campaign stop, $15 session limit and a five-minute request timeout. The base's in-memory guard/report is not durable accounting across fresh runtimes or process restarts. Durable session accounting is still a Wonder-lane requirement.

## Claude's handoff status

The checked committed references were:

| Reference | What it establishes |
|---|---|
| `hmi/m10-operator-hmi` at `deb70bf` | An H2-specific child-process implementation, explicit recovery script and runner changes. Its parent handle is `src/hmi/coordinator-process.ts`; the child is `scripts/hmi-h2-coordinator.js`. |
| `codex/hmi-process-isolation` at `e6bbf3a` | The earlier committed HMI live-results handoff. No completed Wonder-facing isolation/lease handoff was found on this checked tip. Do not infer the status of uncommitted owner work from that tip. |
| `docs/m10-operator-hmi.md` on those branches | Two separately audited H2 passes, followed by an H2 failure involving a parent-event-loop stall and a held PLC state. These are HMI-lane results, not a combined convergence/Wonder pass. |

The H2-specific committed RPC is a draft reuse candidate, **not the requested Wonder contract**. It exposes `start`, `tool`, `cartons`, `expect-fault`, `stop` and failure notices. It creates its own child ledger/runtime/fixed H2 plan, generates tool IDs locally, and does not supply the required hold/continue/condition-deadline lease or originating-revision contract. A successful IPC reply alone is not campaign/PLC application evidence.

There is therefore no completed Wonder-facing handoff location to consume yet. Consume a pinned owner commit plus its versioned protocol, offline results and explicit launch/recovery limitations when Claude supplies them. Do not edit the HMI/isolation implementation, invoke its watcher or run its recovery script to fill the gap.

The historical M10 final fault-23 note in `docs/m10-convergence.md` is not the newest recorded machine observation. Claude's later HMI handoff records attempt `2026-11-01T14-08-43-860Z` leaving Auto/item 301, held inputs and ConnectorStale; fault 33 afterward is expected **but was not observed in that handoff**. No current PLC state was read in this coordination. Claude owns reconciliation; neither state authorizes a stale-trial recovery procedure from another run.

## Required boundary to agree before live consumption

These are requirements for the owner handshake, not invented method signatures:

1. **Identity and ownership:** versioned protocol; campaign/session/boot/epoch identity; stable command/action/decision IDs; exactly one campaign-ledger owner. Prefer child coordinator/world/connector source records streamed to the host's authoritative ledger. If another ownership scheme is selected, reconcile it explicitly with the host ledger-identity check before implementation.
2. **Revisions:** carry the provider decision's originating campaign revision through admission, plus any distinct child boundary revision. Check it before an intervention. Never silently replace it with the revision current when a delayed reply arrives. Ordinary 10 Hz ticks must not invalidate every reasoning turn.
3. **Execution policy:** explicit hold, bounded continue, and condition/deadline leases enforced by the child independently of parent/model progress. Specify condition vocabulary, time basis, maximum duration, expiry disposition and acknowledgement of held/current state. Holding world/raw inputs does not freeze PLC scanning or PLC timers.
4. **Evidence:** original ordered coordinator/world records, exact images and correlated acknowledgements/outputs, quality/freshness, entities and world time; defined sequence/gap/deduplication/reconnect behavior. Preserve source identity and do not relabel historical M10 data as new live observations.
5. **Interventions and operator path:** forward original action IDs/revisions and return applied/rejected/timed_out/stale/inconclusive with exact evidence. Make the configured direct controller adapter versus HMI operator adapter explicit; never treat a browser input delivery or an IPC send as a PLC acknowledgement.
6. **Cancellation and failure:** stop/hold acknowledgements after draining bounded in-flight work; an explicit policy for parent loss, lease expiry, child exit, stale boot/session and ambiguous timed-out writes. Retain last valid state, forbid silent retry/recovery, and never release exclusive ownership based only on transport acceptance.

W0–W2 may proceed with a deterministic stub of this boundary and preserved M10 evidence, with the missing live dependency stated. W3 spending and W4 live use remain separately gated under the Wonder task packet and runtime-owner coordination. No PLC, credential, recovery, network/model operation or other lane's implementation change was performed for this note.

## Later coordination: Wonder W1/W2 and isolated H2

The Wonder lane reports implemented W1/W2, a prior 80/80 offline suite and a final source-hashed rerun in progress. Its W0 contract commit is `560a8c0`, based on `13c55b3`; the checked committed branch tip still identifies W0. Its working-tree `src/campaign/process-port.ts` was read for interface coordination only. W1/W2 implementation, final evidence and handoff must be pinned to their forthcoming commits before convergence imports them. These reported results do not extend the existing convergence proof.

The reported implementation includes a four-turn native Responses stub with an evidence-dependent follow-up, replay of all 302 preserved M10 outputs/source IDs into compact context and the authoritative portal/report, a separate provider-loop factory, durable main-checkout session accounting and admission checks, and an optional recorded-evidence W3 launcher. This coordination did not execute them, call a model or contact the PLC.

Claude's newer committed HMI handoff is now `hmi/m10-operator-hmi` at `1a4a986`. Read `docs/m10-operator-hmi.md` at that commit and `artifacts/hmi/h2/2026-11-01T15-12-23-772Z/`. The saved audit reports 13/13 passing checks for an isolated-coordinator H2 run; the document records four explicit reconciliations and a final Stopped/no-fault/no-item/completion-acknowledged state, simulated inputs held at rest, ConnectorStale after coordinator shutdown, released lock and cleared watcher credential. This **supersedes** the older held-Auto snapshot as the latest recorded outcome examined here. It is not a fresh PLC observation or permission to operate it.

The H2 pass demonstrates the recorded isolated H2 composition. Its handoff explicitly retains narrow timing margin and possible late-tick failures. It does not qualify a Wonder adapter or justify changing the 10 Hz ceiling/300 ms observation bound. The H2 RPC still creates a private child campaign ledger and fixed H2 plan and lacks the proposed Wonder lease/revision/source-stream protocol.

### Adapter request for Claude / runtime owner

The proposed campaign-level structural contract is named `controlsbench.wonder-process.v1`. This is a Wonder-side proposal, not an agreed child wire API. Its current shape is:

- `IsolatedWonderSession`: exact host ledger; provenance; shared ownership path; structural driver; explicit sequenced controller adapter; simulation-exit adapter; bounded disposal; pinned owner handoff commit/evidence.
- `CampaignDriver`: initialize/start/hold/apply/reset/exit, observation subscription and confirmed snapshot/image/evidence/freshness/quarantine/fault state. Declared observed-output IDs replace runtime access to coordinator internals.
- `decisionLeases.begin(policy, basedOnRevision, signal)` and `finish(receipt, signal)`. The receipt carries stable ID, originating revision, validity/reason and evidence references. Hold, bounded continue and condition/deadline behavior must be implemented and enforced by the isolated child, including parent stalls/loss and interrupted or late receipts.
- `controller.execute(call, signal, basedOnRevision)` preserves original action identity and revision and returns terminal outcome/evidence through the existing runtime pairing. It must not silently use the revision current on arrival.

The owner adapter must also define ordered coordinator/world source delivery into the host ledger, exact derived evidence and entity/world time, source gap/deduplication behavior, boot/epoch identity, drained cancellation/stop, explicit passthrough observation and exclusive ownership. A private H2 child ledger cannot be relabeled as this host campaign. Handoff `isolationVerified`/`recoveryVerified` flags must be checked against pinned owner evidence and compatibility tests; self-asserted booleans alone do not establish qualification.

The intended W4 factory fails closed without a compatible pinned owner adapter and recorded handoff. Keep W3/W4 not run until their separate execution gates are satisfied. The convergence/runtime owner accepts the structural-adapter direction for continued offline work; Claude's implementation and final wire agreement remain separately owned. No other lane's worktree, recovery path or live implementation was changed here.

Final handoff review: the Wonder lane subsequently supplied `e435a02` and its retained 81-test proof. `docs/wonder-review-e435a02.md` records two reproduced portal-contract defects and an owner-entry pinning gap. Changes are requested before convergence; this does not replace the existing M10 proof or authorize paid/live execution.
