# Wonder campaign lane

The subsequent convergence review and production-path corrections are documented in [wonder-review-fixes.md](wonder-review-fixes.md). That document supersedes the original portal scope/label and owner-entry assumptions below. The separately authorized real model run is documented in [wonder-w3-checkpoint.md](wonder-w3-checkpoint.md): W3 partial, three generation calls, two grounded findings, no novel adaptive follow-up, $4 conservative allowance consumed. W4 remains unrun.

Base: verified `codex/m10-convergence` `13c55b3` (66 runtime/host/view and 51 UI tests; preserved 302-ack M10 replay). The original checkout's uncommitted task packet and other edits remain untouched. Codex implements; `muse-wonder-1.0`, Standard mode, high reasoning is the product model.

## W0: frozen integration boundary

The six-case M10 executor selects its own sequence and deliberately never calls a provider. The M9 `WonderProvider` allows one preserved-M7 call. Neither proves Wonder-directed live experimentation. Keep both as regressions. `CampaignRuntime` already owns authorization, turn scheduling, plan transitions, semantic tool dispatch, evidence validation, cancellation, budgets, ledger projection and report. Extend that loop rather than implementing another executor.

The new Responses provider submits one `campaign_decision` function per turn: the existing bounded Decision (plan/completion plus up to eight semantic calls), optionally selecting the next reasoning lease. The runtime validates and applies it. The following API turn pairs the originating `call_id` with exact terminal tool results, current revision and bounded evidence. The provider has no PLC authority or experiment policy. Unsupported/text/malformed/incomplete/repeated responses cause a visible hold; no silent retry. Raw request/response bytes are durable before interpretation. Abandoned responses remain artifacts and never execute effects.

Context contains the accepted spec (requirements and assumptions), logical signals/device capabilities, selected scope, current plan/experiment/revision, budget/evidence class, recent relevant outcomes and exact evidence IDs. A bounded evidence-window tool retrieves older exact records. Recorded source IDs, times and hashes remain available. Blind contexts use the existing public observation allowlist, including tool-result filtering; no source events, fault truth or raw model responses. Connection endpoints and credentials never become model context. World truth, requested stimulus, acknowledged raw image, PLC outputs, HMI observations and inference retain distinct types. Prose is interpretation, not certified coverage.

### Process interface for Claude/integrator

This lane does not edit `src/live`, HMI code, PLC programs, credential watchers or recovery. A live factory must consume a completed isolated-process adapter handoff with:

- One host-owned `CampaignLedger`, original coordinator events and exact derived evidence; no parallel ledger.
- Structural CampaignDriver operations: initialize/start/hold/apply/reset/exit, confirmed evidence/snapshot/image, freshness, quarantine and observation subscription. Declared observed signal IDs replace runtime access to coordinator internals.
- A decision-lease controller: begin(policy, originating revision, cancellation), finish(receipt, originating revision, cancellation). Policies are hold, bounded continue, or condition/deadline; hold on expiration/interruption, with a terminal receipt and evidence refs. The child enforces deadlines independently of model/portal event loops. PLC time always continues. Holding the simulated image/world is explicit and logged, never a clock freeze or physics rewrite.
- Sequenced controller/operator actions, original acknowledgements, exclusive ownership, explicit passthrough observation and bounded disposal remain the runtime owner's responsibility. Late or mismatched lease receipts invalidate the decision before any model effect.

No compatible completed handoff existed at W0 inspection (`codex/hmi-process-isolation` at `e6bbf3a`). An injected offline adapter proves campaign-level contract behavior; it cannot certify child isolation or live timing. These signatures are a proposed campaign adapter seam, not Claude's child wire protocol. The convergence owner confirmed the requirements in `922159c:docs/wonder-convergence-interface.md` and received a follow-up with the implemented seam and remaining dependency.

Later read-only consumption: `hmi/m10-operator-hmi` `1a4a9864c09d2486e3ae85190358134261fbc7a8` records H2 attempt 13 (`2026-11-01T15-12-23-772Z`) passing 13/13 with an isolated coordinator, plus four explicit reconciliations. Its recorded final state is Stopped, fault-free, no item/pending completion, simulation held, lock released, watcher credential cleared. This supersedes the older failed-H2 state; it is not a current observation. Its H2 RPC still creates a private child ledger/fixed plan and lacks Wonder leases/revision/source streaming. It therefore supplies isolation/recovery evidence, not a compatible Wonder adapter. No owner code, watcher or recovery was operated or modified here. W4 awaits that adapter and runtime-owner scheduling.

### Spend boundary and API references

Keep $1 request admission, $3 warning, $5 campaign hard stop, five-minute timeout and $15 durable session cap. Reserve durably before networking, charge uncertain calls fully and block reuse after a crash. Before generation, count the complete rendered input (including stored history), bound output tokens and use the verified Standard rates with no cache discount to reject a request whose maximum exceeds $1. No hosted tools or automatic retry. Reverify pricing before executing W3; a local reservation alone is not a provider billing cap.

Primary docs checked 2026-11-01: [Responses](https://dev.meta.ai/docs/protocols/responses), [tool calling](https://dev.meta.ai/docs/tool-calling), [token counting](https://dev.meta.ai/docs/token-counting), [pricing](https://dev.meta.ai/docs/pricing-rate-limits), [models](https://dev.meta.ai/docs/models). Wonder Standard input $4/M tokens and output $20/M tokens; max output includes reasoning. The [Meta context cookbook](https://github.com/meta-models/meta-model-cookbook/blob/main/02_agent_patterns/03_managing_context/README.md) supports compact running state and selective retrieval. Current task instructions supersede the older playbook's retry and behavior-IR suggestions.

## Gates and launch

| Gate | Result | Evidence and limit |
|---|---|---|
| W0 | Pass | This contract, `src/campaign/process-port.ts`, and `representative-context.json` in the retained proof. Child API agreement remains a W4 dependency. |
| W1 | Pass | Ten new offline tests exercise four native Responses turns, exact tool-result pairing and observations, a novel evidence-dependent follow-up, grounded finding/report, different hypotheses for different outputs, malformed/incomplete/text/repeated/stale replies, duplicate actions, cancellation/late responses, timeout, request admission, campaign/session stops, blind-result filtering and unsupported claims. Lease tests verify campaign contract handling with an injected boundary; they do not qualify child scheduling. |
| W2 | Pass | All 302 historical M10 acknowledgements/outputs retain exact values and source lineage. Six original findings remain in the separate source report; the new review has its own findings. Recorded physical proposals cannot execute. Production `CampaignHost`/`HostedSession`/`WorkspaceStore` show the one authoritative activity/actions/cost/findings projection. |
| W3 | Partial | Three real Wonder generation responses completed a recorded-M10 review, with six applied semantic actions, two findings and 30 exact PLC claims. Raw native lineage and five exact delivered tool results are preserved. All inspections were selected initially; a new evidence-dependent investigation was not demonstrated. Failed preflight plus successful decisions consumed the approved $4 conservative allowance. See the checkpoint handoff. |
| W4 | Prepared adapter/factory, live not run | Provider-loop factory omits `HostedCampaign.run()`. Offline injection proves ledger/HMI identity and forwarded action revisions. It refuses launch without the compatible pinned owner adapter, child leases, observed signals, handoff evidence and common ownership. Normal/fault/live Wonder-selected follow-up remain unverified. |

Original offline verification: `2026-11-01T17-36-24-146Z`, against code commit `1979835f0096a7b268183d718b2f442791b9e720`: TypeScript pass, **81/81 root tests**, offline artifact generation pass. This preserved run did not cover the three defects identified in the later convergence review. `artifacts/wonder-verification/latest.json` selects the newest verification; see the correction handoff for its result. The older full UI/build/browser-view convergence proof remains recorded in `artifacts/m10-convergence`; it is not represented as a new live test.

`artifacts/wonder/latest.json` selects the representative proof. It contains `stub-campaign.jsonl`, `stub-exchanges.jsonl`, `stub-report.json`, `representative-context.json`, `recorded-campaign.jsonl`, `recorded-context.json`, `recorded-report.json`, `recorded-source-report.json`, and `result.json`. The stub uses the real Responses framing with an injected transport and a zero-cost provider label. Four stub generation responses, **zero real model calls, $0 real spend, zero PLC contacts**. Cost-stop tests simulate paid accounting; their $1 reservations are not real invoices. Import lineage is world/evidence metadata, never a fabricated model response.

Retained proof directory: `artifacts/wonder/2026-11-01T17-38-38-589Z`. Source recorded-M10 ledger SHA-256: `e7f7fa9810e017f5d4430a87454600d8c54d42517e69b84fbdae33b9b8cb7829`. This lane's implementation commits are W0 `560a8c0`, W1–W2 `4a2ce22`, W3/W4 preparation `1979835`; the evidence/handoff commit follows those. The source packet and all original-checkout edits remain in place. No `codesys/`, `src/live/`, generated world or generated view file differs from the convergence base in this branch.

### Offline launch

From the dedicated worktree (install dependencies only if absent):

```powershell
npm ci
npm --prefix ui ci
npm run proof:wonder
npm --prefix ui run build
npm run host:wonder:recorded
```

Open `http://127.0.0.1:5179`, then Start Campaign. This is an explicitly labeled recorded-M10 review with a deterministic stub provider, not live Wonder. No PLC credentials or Meta key are needed. The host persists each campaign under `artifacts/wonder-portal/`. A deselected/partial recorded-fixture scope is rejected; the fixture reviews evidence/adaptive scope only. The read-only source can also be inspected directly in the retained JSON reports.

Pause/Stop use the existing runtime semantics and bounded adapter drain. Stop retains the last confirmed image; Exit Simulation is explicit and separately observed. Reset requires a new campaign. Steering is explicitly rejected as unsupported and its text is not delivered to Muse. HMI actions/clips and actual branch execution/world rewriting remain unsupported; a branch checkpoint alone is not a new executed branch.

### W3 launch, separately scheduled with integrator

The completed checkpoint and consumed allowance are recorded in [wonder-w3-checkpoint.md](wonder-w3-checkpoint.md). The command below documents the launcher for a future separately authorized run; it does not extend or reset that allowance. `--max-decisions=3` narrows the default four-decision bound.

Recheck the linked primary Meta pricing first. The current admission constants are $4/M input and $20/M output with **no cache discount**; counting includes server history. Every generation is limited to 4,000 total output/reasoning tokens. No hosted tools, hidden repair calls or retry. A preflight failure also retains a conservative $1 reservation. At most four admitted decisions reserve $4, below the campaign $5 hard stop; incomplete work finalizes as incomplete/stopped rather than a fabricated pass.

Using the existing local key file, without copying/printing credentials:

```powershell
$env:CONTROLSBENCH_WONDER_PRICING_REVIEWED = '2026-11-01'
node --env-file=../../.env scripts/run-wonder-checkpoint.js --authorize-paid-wonder-checkpoint
```

Or set `MODEL_API_KEY` privately in the launch environment and use `npm run proof:wonder:checkpoint -- --authorize-paid-wonder-checkpoint`. The command reruns all offline checks immediately before any network call. It reviews recorded M10 only. Inspect `checkpoint-*/result.json`, report, full raw exchanges, actual native tool results, response IDs, usage/cached/reasoning tokens, evidence references and whether Wonder really selected a novel follow-up before declaring W3 passed. Completion alone is not a quality verdict.

All paid factories/checkpoints share the main checkout's `artifacts/wonder/session.jsonl` and exclusive `.lock`, independent of worktree. Charges are append-only/fsynced **before** networking; cancellation/malformed/failed calls cannot free them. A crash retains both charges and lock. Reconcile the durable account explicitly; do not delete the lock to retry. Normal disposal releases only the account ownership lock, never refunds a charge. Raw late replies remain in the independent exchange artifact and cannot cause effects after cancellation/finalization. Exact provider invoices remain separate from conservative accounting.

### W4 owner adapter and launch

The owner supplies a module exporting `createWonderSession(context): Promise<IsolatedWonderSession>` as typed in `process-port.ts`. Construction must be read-only; `driver.initialize()` establishes the qualified session only after Start. It must forward the original action IDs and `basedOnRevision`, reject stale child/campaign revisions, enforce bounded leases independently of parent progress, stream original ordered coordinator/world events into the exact host ledger, and return terminal evidence-backed action/hold/stop results. No import/copy of the H2 private ledger as a live host campaign. Handle parent loss, gaps, uncertain writes and duplicate IDs without retry/recovery; keep the shared `artifacts/m10/live.lock` until drained. Its handoff carries the full pinned commit, verified isolation/recovery evidence, actual build/world provenance, shared ownership path and declared observed output IDs. The host HMI adapter remains the same object.

Boolean verification flags alone cannot open the live gate. Supply a separately reviewed JSON handoff manifest, pin its exact SHA-256, and pin the full 40-character owner commit. The factory verifies unchanged owner `src`/`scripts` at that commit before importing the adapter. The manifest shape is `{ "contract": "controlsbench.wonder-process.v1", "ownerCommit": "<full commit>", "checks": { "isolation": { "file": "<passing result JSON>", "sha256": "<64 hex>" }, "recovery": { "file": "<passing result JSON>", "sha256": "<64 hex>" }, "campaignPort": { "file": "<passing adapter qualification JSON>", "sha256": "<64 hex>" } } }`. Evidence paths resolve relative to the manifest; each exact file must have `status: "pass"`. The session's `handoff.evidenceRef` must be `sha256:<manifest hash>`. Hash validation preserves the owner's reviewed qualification; it does not independently establish that a generic passing file qualifies this campaign port. The runtime owner must review that scope before pinning. No such Wonder-compatible manifest/qualification exists in the consumed H2 handoff.

After the owner supplies and verifies that adapter and schedules the live gate:

```powershell
$env:CONTROLSBENCH_WONDER_PROCESS_MODULE = '<absolute path to owner Wonder adapter module>'
$env:CONTROLSBENCH_WONDER_PROCESS_COMMIT = '<full verified owner commit>'
$env:CONTROLSBENCH_WONDER_HANDOFF = '<absolute path to reviewed owner handoff JSON>'
$env:CONTROLSBENCH_WONDER_HANDOFF_SHA256 = '<exact reviewed manifest SHA-256>'
$env:CONTROLSBENCH_WONDER_PRICING_REVIEWED = '2026-11-01'
# Supply MODEL_API_KEY and the owner's normal private process configuration in the environment.
npm run host:wonder
```

The portal loads before Start; opening the host is not PLC authorization. The host advertises an explicit category-selection mode, displayed by the production browser. Start forwards those exact category booleans, including every deselection. Historical check-ID selections remain separate; a previously narrowed checklist cannot silently authorize categories. Direct check-ID and empty scope payloads are rejected. Categories are `io`, `startup`, `functional`, `runtime`, `faults`, `normal`, `edge`, `adaptive`, within the configured 10 Hz bench only; higher-rate qualifications and recovery are excluded. Optional HMI observer/capture load must follow the owner's qualified settings and timing limits. No credential watcher, recovery launcher or native PLC fallback is wired into this lane. Owner handoff records a narrow timing margin; this factory does not relax the 300 ms guard or requalify timing.

The factory checks the frozen PLC hash. Historical world LF hash is `a467a4589850ba19bdb1caa80d30387b387b8861077013afb8974933c520b5d6`; verified convergence's Git/Windows CRLF checkout hash is `277992048f8ca9a8b36f2f90c0d4c33ef479cb8b3c355d6a2233a272850698f5`. Both are explicitly pinned. The owner must report the actual loaded bytes, not substitute the historical hash. No generated world/view file was edited or normalized by this lane.

W4 acceptance still requires a new normal case and fault case, a Wonder-chosen follow-up dependent on observed M8 evidence, grounded final report, real portal actions/budget activity and qualified process/HMI correlation. Until those run, this is a launch gate and tested campaign adapter contract, not a proven live Wonder campaign.
