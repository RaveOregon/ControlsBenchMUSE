# Wonder handoff review: e435a02

Reviewed pin: `e435a02d51ad422224fd8a66a2e3fd44db4a5e92`, with implementation pin `1979835f0096a7b268183d718b2f442791b9e720`. Review disposition: **changes requested before convergence**. No implementation was merged or modified, and no paid/model/PLC/HMI live operation was performed.

The retained handoff reports 81/81 root tests, TypeScript and offline artifact generation passing, with zero actual model calls/spend. The code keeps the provider loop separate from deterministic M10, retains exact historical evidence and source reports, adds durable accounting and a guarded owner-adapter path. Those are useful proofs. This review inspected the pinned code/artifacts and ran two targeted offline contract probes; it did not rerun or independently certify the full 81-test suite or external Meta API behavior.

Probe output is retained at `artifacts/wonder-review/e435a02/probes.json`. The factory probe imports the actual pinned factory from a temporary `git archive`, passes the portal's real `defaultScope()`, and forbids fetch. The recorded-data probe uses the unchanged production browser client construction and the pinned recorded ledger prefix through its first `plc.output`. It constructs no native connector/provider/HMI session.

## Findings

### P1: normal portal Start cannot pass the live factory scope check

`src/host/wonder-campaign-factory.ts:43`–44 treats each `context.scope` key as an engineering category and rejects all keys outside `io/startup/functional/runtime/faults/normal/edge/adaptive`. The actual portal's `HostedSession.start()` forwards `WorkspaceStore.scope`, built by `defaultScope()` from **check IDs** such as `IO-1`, `SM-1`, `FN-1`, `NO-2` and `EV-1`. No host translation is added in this branch.

The probe's ordinary default selection fails with `Wonder scope must select supported engineering categories`, before any owner/provider construction. Thus providing the completed owner adapter later will not make the documented portal Start path work. Current factory tests pass manually constructed category maps; the portal test submits Start without a scope payload and never covers the real browser command.

Reconcile the declared factory scope with the actual portal contract. Either provide an explicit category-selection mode or safely map check selections to authorized categories/requirements. Do not silently discard individual deselections or authorize higher-rate qualification checks. Exercise the actual `HostedSession.start()` payload, including narrowed selections, through the host/factory.

### P1: the documented recorded host labels historical PLC output as live

`test/wonder-portal.test.ts:14`–15 constructs a replay-mode store/session. The production browser at `ui/src/App.tsx:53` constructs a **live-mode** `HostedSession` whenever a host is detected. `host:wonder:recorded` uses that normal browser entry point and does not change the client construction.

The production mapper derives event mode from the session and treats non-fake PLC evidence as `plc_measurement`. The probe therefore imports an authenticated historical output with hosted class `preserved_live_plc`, but its event provenance is `mode: live`, and `evidenceTag` renders **PLC · live** with the tooltip **Observed now from the attached coordinator**. A separate recorded badge/report does not correct that per-event claim. Historical liveness expectations also need to remain distinct from the current review/provider activity.

Preserve the distinction between a currently hosted review and the recorded PLC evidence it reads. Verify the actual browser/bootstrap mode, per-event labels, source timestamps and liveness behavior for `host:wonder:recorded`; keep current review activity and command acknowledgements truthful. Do not weaken the existing rule that arbitrary replay events cannot simply be inserted into a live workspace to hide this mismatch.

### P2: the owner pin does not cover the configured module entry file

`src/host/wonder-campaign-factory.ts:53`–57 checks the containing checkout's HEAD and only the dirty paths under `src` and `scripts`. It subsequently imports the supplied `processModule` path, without checking that this entry file is tracked in the pinned commit or that its bytes match that commit/manifest.

For example, an untracked or modified `<ownerRoot>/adapter.ts` outside `src/` and `scripts/` leaves the checked status empty and can be imported under an otherwise correct owner HEAD and reviewed handoff. The gate then cannot establish which adapter implementation ran. This is a static finding; no untrusted owner adapter was executed in this review.

Before import, resolve the actual entry file and verify it belongs to the pinned owner source tree and matches the reviewed bytes (or a manifest-pinned entry hash with equivalent provenance). Cover untracked, changed and redirected entry paths, in addition to the existing manifest hash/status tests. Keep import and construction read-only until Start.

## Next handoff

Return pinned correction commits and focused regression evidence for these boundaries. The compatible isolated Wonder adapter remains a separate W4 dependency; Claude's recorded H2 pass does not supply the missing campaign lease/revision/source-stream API. No W3 paid checkpoint or W4 live execution is requested by this review.
