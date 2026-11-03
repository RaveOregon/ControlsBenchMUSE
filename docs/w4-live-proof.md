# Live Muse fault and adaptive proof — passed November 3, 2026

Muse Wonder 1.0 planned and executed live PLC fault tests, chose a new physical investigation from the returned evidence, recorded grounded findings and completed its report. No engineer supplied the test sequence or intervened during the campaign.

| Step | Observed result |
| --- | --- |
| Drive-feedback failure | Actual M8 PLC reported fault 12, motor command off and no completion. |
| Clear and Reset | PLC returned to Stopped, fault 0, without automatically restarting. |
| Evidence-dependent follow-up | After seeing fault 12 and recovery, Muse proposed D1 contradictory-limit feedback as a distinct feedback-consistency test. It was absent from the initial plan. |
| Physical follow-up | Muse started the PLC, injected contradictory D1 limits, and observed distinct fault 21 with motor and D1 commands off. |
| Follow-up recovery | Muse cleared the contradiction and issued Reset. PLC returned to Stopped, fault-free, with no active item, offer or pending completion. |
| Report | Two findings, 31 exact PLC claims, both experiments completed. |

Campaign: `portal-20261103131442735-1`. Immutable runtime commit: `503abd3b895cb2fc03853a9ec2d75166544e2a59`. PLC boot: `1751589051509`. Nine model generation requests completed successfully; no service retries or invalid-decision repairs were needed. Reported token usage costs approximately **$3.50 at uncached rates**; actual invoicing/caching may differ. The $45 added conservative reservations are admission accounting, not the bill.

The first same-turn follow-up attempt lacked an active experiment and was refused; its observation waits timed out. Muse corrected the sequencing on the next turn and completed the physical follow-up. All unsuccessful actions remain in the evidence.

The offline audit reconstructs the report, verifies the journals and model response/tool lineage, and checks every exact claim. The additional scoped engineering review traces all 31 claims through the original child source records to native acknowledged transport receipts, verifies that follow-up evidence predates the proposal, verifies actual interventions and completion, and confirms a fresh Good final PLC observer state. Runtime ownership is released; no command or input commit remains in flight.

Evidence directory:

`artifacts/w4-paid/2026-11-03T13-11-03-480Z/live-host/runs/2026-11-03T13-12-52-676Z-live_plc/portal-host/portal-20261103131442735-1/`

Key files: `report.json`, `campaign-audit.json`, `engineering-review.json`, `campaign.jsonl`, `wonder-exchanges.jsonl`, and the original `wonder-process/` journals. The packet directory also contains native commissioning evidence and `final-observer.json`.

Reproduce the offline source-to-wire review against an unreviewed copy using `scripts/w4-paid/review-completed-proof.mjs <campaign-directory> <packet-directory>`. It writes once and refuses to overwrite the saved review. The general audit is `scripts/w4-paid/audit-campaign.mjs <campaign-directory> <launch-configuration>`.

The result is deliberately scoped. Normal A sorting was proved in an earlier, separately labelled live campaign. This run did not repeat it. The follow-up did not introduce a carton or establish divert timing/misroute handling. Detection deadlines were not measured. One stationary virtual carton remains in the preserved world while the PLC has no tracked item. The new rejection-handling fix passed offline tests but this successful run did not exercise a rejected PLC command. **Muse HMI operation remains outstanding.**

Next: prove Muse can observe and operate the actual browser HMI through the existing portal action seam, retaining requested action, delivered/trusted page input, PLC acknowledgement and rendered outcome. Then package one repeatable demonstration and its report for submission. Reusable library adoption and file-based CODESYS migration remain separate work.
