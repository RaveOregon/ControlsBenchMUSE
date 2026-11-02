# Lane A handoff review

Implementation pin: `9e98da72ed667368078922a8a5233b08886a8476`.
Handoff/evidence tip inspected: `85da842` on `codex/w4-process-adapter`.
Disposition: accepted for **offline Lane B integration**. No new blocking code defect was identified in this review. Live commissioning and W4 remain unrun.

## Independent checks

- `node --test --test-concurrency=1 test/wonder-process.test.ts`: **14/14**, real child processes and fake transports, about 29 seconds. This review did not rerun the full 169-test union.
- `npm run typecheck`: pass.
- `node scripts/review-w4-process-handoff.js`: pass. Verifies 14 implementation files and 24 executed dependencies against their recorded Git blobs, blob SHA-256 and checkout SHA-256; verifies the original result hash and the three qualification-file hashes/scopes; replays both sample ledger chains (123 and 157 events), preserving `fake_connector` evidence class.
- Review result: `artifacts/w4-lane-a-review/9e98da7/integrity.json`.

The adapter preserves the unchanged process port, one host campaign ledger, original event derivation, child-enforced leases, guarded writes and explicit drain/retained-lock behavior. The declared child time origin separates child monotonic source timing from host receipt timing. The implementation/evidence files inspected remain unchanged in Lane A. No PLC/model/network operation or other lane's source change was performed by this review.

## Handoff for Lane B

Merge Lane A through `85da842`, retaining implementation lineage to `9e98da7`. Add `test/wonder-process.test.ts` to the union test command and test it against the newer Wonder runtime/factory you are merging. Lane A's proof used the older product-integration dependencies; unchanged adapter blobs alone do not certify the newer combined dependency set.

Use `openOfflineWonderSession` to exercise the real child through the final provider/factory/host ledger/HMI contract. Preserve exact action/revision/evidence IDs and all negative cases. Keep the original 9e98da7 proof bytes and scope flags; create new integrated qualification under the actual merged source pin.

For D's eventual module configuration, the entry checkout HEAD must match the chosen owner commit. Pointing to the `85da842` worktree while supplying `9e98da7` as its current checkout pin will correctly fail, even though those implementation blobs are unchanged. Either use a dedicated checkout at the immutable implementation pin, or pin the final tested integration commit and requalify its actual source/dependencies. Do not weaken the pin check.

B owns its integration worktree and was mid-merge when this review ran. This review did not edit or complete that merge. Consume this review/additional script as needed without replacing B's work.

## D commissioning scope

The `status: pass` files explicitly describe `offline-fake-transport`, with `liveTimingQualified: false` and `liveRecoveryQualified: false`. They are suitable offline process/contract readiness evidence. They are not a completed native session, live recovery qualification, W4 pass or spending authorization.

The generic manifest verifier currently checks file hashes and `status`, not the qualification flags. D's reviewed manifest and release assessment must retain the actual scope and list the unrun native cases. A hash-valid manifest must not turn these files into a live-qualified result. Do not create a completed-live attestation merely to open the factory.

The next native stage is a bounded **zero-model commissioning run** against a freshly inspected baseline: native session/open/close, source/image/acknowledgement delivery, child cadence with portal/HMI capture active, reasoning-lease holds/return/expiry, and sequenced operator behavior within the test scope. Keep the existing 10 Hz ceiling and 300 ms observation guard and report actual performance. Later adverse native cases can remain explicit unverified coverage; they must not be claimed from the fake transport.

Prepare a W4-aware read-only inspection and recorded reconciliation path before running that stage. The H2 and M10 preparation scripts are tied to their own evidence layouts/preconditions and do not authorize recovery of a W4-held state. Any W4 recovery must check the actual saved run's boot, epoch, applied image/sequence, counters and expected controller state before it writes; no automatic recovery or Reset.

After zero-model commissioning is assessed, prepare the concrete paid W4 payload and new bounded allowance, then run normal/fault cases and a truly post-observation Wonder-selected investigation. The earlier $4 W3 allowance remains consumed. No new allowance, recovery, live claim or deployment is granted by this offline handoff review.
