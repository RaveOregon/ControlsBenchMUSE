# W4 execution packet — 2026-11-01

These are dispatch prompts, not evidence that W4 has run. Start A, B and C concurrently. Kiro continues its existing library/submission work. D is the single live commissioning owner after the offline handoffs are merged and reviewed.

## Common context for every lane

Repository: `C:\Users\steve\Documents\ControlsBenchMuse`.
Application worktree: `.worktrees/product-integration`, branch `codex/product-integration`, recorded tip `44b12aa`. Verify current heads/status before editing. Use a dedicated worktree/branch for your lane; do not switch, clean or overwrite another agent's worktree. Commit only your lane's changes and explicit evidence.

Read the application's `docs/product-integration.md`, `HANDOFF.md`, `src/campaign/process-port.ts`, `src/campaign/runtime.ts`, `src/host/wonder-campaign-factory.ts`, the corrected HMI implementation, and the relevant lane handoffs. Latest reviewed Wonder work is on `codex/wonder-campaign` at `91c868d`; its `docs/wonder-review-fixes.md` and `docs/wonder-w3-checkpoint.md` supersede the original W3-unrun notes. Independent review is on `codex/m10-convergence` at `de0a796`.

Product goal: Muse constructs believable external process behavior from a specification/raw I/O contract, actively experiments around real executing PLC logic, chooses useful investigations from actual observations, and reports traceable evidence in one workstation. Preserve the generated world and its physical dynamics; do not replace it with a timed signal script, force an instant stop or manufacture a follow-up just to satisfy an oracle.

Current proof: integrated preview at `44b12aa` passes 155 runtime tests, 51 UI tests, 13 preserved-M10 browser checks and 10 preview browser checks. The later Wonder lane independently passes its expanded 89/51/13 gate. These are different source/test sets; merge the union and report fresh counts. W3 is partial: three real generation responses, six applied semantic actions, two findings/30 exact historical PLC claims, but every inspection was selected initially. No novel post-observation follow-up was demonstrated. W4 has not run.

The main checkout has a modified `codesys/conveyordemo.project` and a separate File-Based Storage conversion. Preserve both; do not overwrite/revert/download to satisfy a hash guard. The integration worktree retains the frozen demo. Library/PID/recording extensions remain separate from this core gate; no library swap is needed.

Only D may own a real PLC/model commissioning session. A–C do offline work with fake transports, recorded evidence and local browser fixtures. No native PLC connection, credential watcher, recovery, download, paid call or new endpoint is needed for A–C. Do not send messages to other people/services. Publish interface/commit/evidence handoffs in the repo and report them to the user.

Use ephemeral or lane-specific loopback ports and artifact directories. Stop only your own test processes. If simultaneous full browser/CPU gates create contention, schedule those heavy checks sequentially rather than changing PLC timing bounds or killing another lane's work.

The previous W3 approval was specifically $4 in conservative accounting and is fully consumed. It is not W4 spending authority. Preserve its durable charges/locks; never reset them to obtain another run. D must prepare the actual W4 payload and bounded cost proposal before requesting any missing data-transfer/spend approval. This limit comes from the explicit W3 checkpoint allowance, not an instruction to restrict the agent's authorized bench experiments.

## Lane A — isolated runtime adapter

Agent: the existing Claude HMI/isolation chat; keep its current coding model and use extended thinking. Its process-isolation/recovery context is valuable here.

Execute this task:

Build the missing implementation of `controlsbench.wonder-process.v1` for the existing Wonder campaign. Start from the product integration base, use `codex/w4-process-adapter` in a new worktree, and consume the corrected HMI `8e9d325` as the process-isolation reference. Deliver `createWonderSession(context)` against the existing typed contract. Build and prove it offline now; do not operate the PLC.

Ownership: new process-adapter/IPC implementation under `src/live/wonder-process/`, its child launcher under `scripts/`, dedicated `test/wonder-process*.test.ts`, and `docs/w4-process-handoff.md`. Preserve HMI source, provider loop, portal UI, machine controller and generated package bytes. Freeze the existing `process-port.ts` interface initially; explicitly document any necessary interface change for B before depending on it.

Requirements:

1. A separate child process owns the world/connector timing. Reuse proven connector/world behavior without importing H2's fixed plan or private campaign ledger. The host remains the one authoritative campaign-ledger owner; stream original ordered coordinator/world source events and derive their evidence through the existing verified machinery.
2. Implement initialize/start/hold/apply/reset/exit, confirmed image/snapshot/evidence/freshness, subscription/failure state, declared observed output IDs, and sequenced controller actions. Construction is read-only; real connection/simulation initialization belongs to Start.
3. Preserve original action IDs, originating campaign revision and distinct child boundary revision. Ordinary sampling ticks must not invalidate every reasoning turn. Reject stale or duplicate interventions without silently replaying them.
4. Implement hold, bounded continue and condition/deadline reasoning leases enforced by the child, using monotonic time, even while the parent/model event loop stalls. Return terminal evidence-backed receipts. PLC scanning/timers continue during a world/image hold; state that fact in evidence.
5. Define event sequence/gap/deduplication and cancellation/parent-loss behavior. Timed-out writes remain uncertain until reconciled; no overlapping later writes, silent retry, automatic machine Reset or implicit passthrough. Drain bounded outstanding work before releasing shared ownership. Preserve the 10 Hz ceiling and 300 ms observation guard; record timing failures rather than raising the bounds to make a test pass.
6. Use the existing main-checkout runtime ownership path. Publish the actual loaded world/build identities. Keep boot/epoch/image acknowledgements, raw types, output quality and source timing authentic.

Test in a real child process with fake transports: deliberate parent event-loop stall, lease expiry, unmet/met conditions, stale revision, duplicate ID, missing/reordered source records, child exit, parent loss, delayed write, drain/stop, reset versus exit, and original evidence lineage. Do not use a software copy of PLC behavior as the correctness oracle.

Deliver a pinned implementation commit, stable module path, explicit protocol/API handoff, test commands/results and source hashes. Explain which existing recovery evidence remains applicable and which new live cases remain unverified. Keep qualification scopes explicit; do not label an offline fixture as live timing/recovery qualification or create a circular self-pin. B/D will assemble the reviewed manifest using the immutable implementation pin and exact evidence files. Finish all offline code/tests before reporting readiness.

## Lane B — Wonder/core convergence

Agent: existing Wonder Codex chat, GPT-6.1 Sol, High reasoning. This is the only owner of application integration merges.

Execute this task:

Integrate the latest reviewed Wonder work and the upcoming Lane A runtime adapter into the product application. Use a dedicated `codex/w4-convergence` worktree from current `codex/product-integration`; do not edit the original Wonder or HMI worktree. Read the common context first.

Start now with the work that does not depend on A:

1. Merge `codex/wonder-campaign` through reviewed `91c868d` and consume the review at convergence `de0a796`. Reconcile its complete category-selection/browser-bootstrap/recorded-evidence/entry-pinning corrections with the earlier integration fixes. Preserve the reviewed implementation's semantics and one coherent schema; do not accumulate two competing historical-evidence flags or scope adapters.
2. Retain Claude's corrected HMI `8e9d325`, all generated-view integration, all commands and the union of runtime/UI/HMI/Wonder tests. Preserve the one-command launcher on :5190/:5191. Kiro's library and submission changes are outside your ownership.
3. Run the real-Wonder reply replay with networking disabled, verifying native response/tool-result lineage, six applied actions, two findings/30 claims and the explicit absence of a new adaptive follow-up. Preserve all original checkpoint bytes and the consumed conservative account.
4. Exercise the actual production browser Start payload, narrowed scope, current-versus-recorded timestamps/labels/health, and pinned entry rejection. Keep current review/HMI activity distinct from historical PLC evidence.
5. Prepare the controller/world/observation tool capabilities needed for W4. Make unsupported behavior explicit; do not route direct sequenced commands through an HMI-click label. Preserve model budget/error/cancellation handling and immutable DUT/world bytes.

When A supplies its pinned handoff, merge the adapter and wire it into the existing factory/launcher using the exact host ledger and HMI object. Review evidence/manifest scope before admitting a live path; no fabricated passing files or boolean-only qualification. Test the whole provider/driver/controller/lease/source-event path with an injected zero-cost provider and fake transport. Keep the model decision logic real and separate from test-fixture policies.

Own `src/campaign/`, `src/host/`, necessary portal contract/bootstrap changes, shared package/test configuration, launcher wiring and integration docs. Do not independently implement or overwrite A's child/IPC code. If the typed process boundary must change, publish a small explicit contract revision and reconcile with A before changing consumers.

Run the union of offline checks and production builds, the real-response replay, saved H2 audits and production browser checks. Commit a tested integration candidate and report the exact source pin, manifest/module readiness, evidence paths and remaining live gates. Do not spend or acquire the real PLC in this lane. A missing dependency is not permission to use H2's fixed executor as a Wonder adapter.

## Lane C — product and repeatability QA

Agent: separate Codex QA chat, GPT-6.1 Terra, High reasoning; GPT-6.1 Sol High is a suitable substitute if Terra is unavailable.

Execute this task:

Test the engineer's actual workflow through the integrated application, using local fixtures and recorded evidence. Create `codex/w4-product-qa` from current product integration. Begin now, then rerun against B's pinned merged candidate before final signoff. Do not open a native PLC connection, call Meta, take over the user's desktop or modify another lane's implementation.

Read the common packet and `docs/product-integration.md`. Use the full-path launcher, production UI build and dedicated headless Chrome capture. Check:

- Launch from another PowerShell directory; one documented location/command; useful errors for occupied ports/missing configuration; no legacy server launched by accident.
- Setup/scope to Start, visible updating activity, Pause/Resume/Stop, new campaign, Results/export and evidence links. Confirm displayed changes follow authoritative acknowledgements.
- The Muse-generated machine view and actual captured HMI page remain separate. Verify the HMI fixture/live identity is visible, timestamps/hashes match, stale frames are marked, and no placeholder is called a current PLC measurement.
- Recorded reviews label historical physical evidence correctly while current provider activity remains current. No phantom live heartbeat/freshness claims.
- Operation/Alarms/Engineering pages, narrow viewport and readable controls, alarms versus bench diagnostics, rejected/unconfirmed commands and disconnect presentation.
- Repeat preview/recorded launches and disconnects, including normal portal navigation/capture load. Confirm your own processes/ports/captures close. Local repetition does not qualify PLC timing.

Own new QA scripts/tests and `docs/w4-product-qa.md`, plus curated screenshots/results with source pins. Report product-code defects with reproduction and precise file/line references to B; do not race B by rewriting shared UI/provider files. Distinguish cosmetic issues from broken workflows. Do not alter source behavior or weaken an oracle merely to make the report green. Finish with a short must-fix list and a repeatable regression command, then requalify the final merged candidate.

## Lane D — live W4 commissioning (after A/B/C handoffs)

Agent: the integration owner in this Codex chat, GPT-6.1 Sol High. One live owner; do not start another concurrent live runner. This prompt can be queued after the offline handoffs are ready.

Execute this task:

Commission the integrated Wonder-directed campaign around the real M8 PLC. First consume A's immutable process module/evidence, B's tested integration pin and C's remaining issues. Verify the actual owner/module/manifest bytes and meaningful qualification scopes. Check runtime ownership and inspect the current controller read-only; historical clean-state notes are not a current observation. The main checkout's project/File-Based Storage work must be preserved and reconciled with the intended DUT identity; do not overwrite/download/reset it to satisfy a guard.

Before paid generation, prepare a concrete reviewable W4 payload preview and conservative aggregate spend cap (suggest $5 for the first attempt) against the current Meta API/pricing. W3's specific $4 allowance is exhausted; obtain any missing new spend/data-transfer authorization once the exact action is ready. Keep credentials local and masked. Never reuse/delete a watcher/account lock to bypass this. Finish all offline/preflight work that is independent of the approval first.

After applicable prerequisites are met, run one coherent campaign from the production portal with the generated machine view and the same actual HMI capture session present. Opening the app alone must not start the campaign. Start Campaign authorizes the chosen bench scope; do not introduce per-experiment prompts within it.

Prove a normal operation, a fault case, and a Wonder-chosen investigation that is genuinely prompted by returned PLC evidence. Do not preselect all inspections, require a token follow-up regardless of observations, seed a canned model reply, change the controller to make a finding or flatten world physics to satisfy an assertion. Distinguish planned observations from new adaptive decisions in the final adjudication.

Record source identities, raw commits/acknowledgements, authentic outputs/quality/timing, current HMI frames, native model/tool-result lineage, UI command outcomes, reasoning-lease receipts and conservative/actual usage separately. Keep the qualified timing limits; expose late steps and held states rather than relabeling a failure. Stop on an unexplained state, retain the evidence, and use only a separately applicable recorded recovery with matching preconditions; no silent retry or recovery.

Independently audit the saved run. Report pass/partial/fail against each W4 obligation, spend, limitations, final observed PLC state, runtime ownership and cleared credentials. Keep older W3 partial and all failed attempts intact. After a genuine W4 pass, the first stretch is Muse operating the same actual HMI session; it gets its own scoped checkpoint/evidence rather than being assumed from a browser click seam.

## Kiro status addendum

Continue the existing submission and library work; no core runtime ownership or library swap. Update the claims matrix/storyboard to W3 partial and W4 pending. Real Wonder's three-call checkpoint produced two findings/30 exact historical claims but no new post-observation follow-up. Platform-neutral architecture, the CODESYS prototype library, future passive recording/PID/signal-processing requirements and actual shipped vendor support must remain distinct. Prepare the demo story with replaceable slots for the upcoming W4 evidence. Do not publish, fabricate final screenshots/results or claim live autonomous coverage while waiting. Commit your scoped deliverables for the integrator.
