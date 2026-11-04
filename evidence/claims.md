# Claim-to-evidence map

| Claim | Best evidence | Scope |
| --- | --- | --- |
| Muse generated executable machine behavior from specification and raw I/O information. | [Original generated package](../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/), [proof contract](../docs/first-proof-contract.md) | Generated source, tests, repair and independent physics checks. Continuous motion, derived sensors and encoder counts; no claim of a measured physical twin. |
| A local engine exchanges raw inputs and controller outputs with executing PLC logic. | [Normal-operation result](records/normal-operation-result.json), [audit](records/normal-operation-audit.json), [implementation](../docs/m10-live-integration.md) | Live CODESYS Control Win / M8 over OPC UA. Target 10 Hz, not hard real-time model inference. PLC scanning/timers remain independent. |
| Muse actively chooses experiments and adapts to returned evidence. | [W4 report](reports/adaptive-plc-investigation.pdf), [audit](records/w4-audit.json), [engineering review](records/w4-engineering-review.json) | One completed fault/adaptive campaign, two findings and 31 exact claims. D1 follow-up absent from initial plan. Normal sorting is a separate campaign. |
| Muse can operate the demonstrated browser HMI and interpret its actual pixels. | [S2 report](reports/muse-hmi-operation.pdf), [audit](records/s2-audit.json), [engineering review](records/s2-engineering-review.json) | Known labelled controls, 17 received images, scoped Start/Stop/fault/Reset support. Stale/disconnect inconclusive; one extra citation invalid and retained. |
| An engineer can review and export an evidence-linked bench report. | [W4 HTML](reports/adaptive-plc-investigation.html), [S2 HTML](reports/muse-hmi-operation.html), [report implementation](../docs/bench-report.md) | Saved reports preserve observations, findings, screenshots, gaps and provenance. “Completed” and “Observed” do not mean every requirement passed. |
| The architecture separates model, engine, connection and PLC-platform adapters. | [Architecture](../docs/submission-diagrams/controlsbench-architecture.md), [PLC integration contract](../docs/submission-diagrams/controlsbench-plc-integration.md) | Agnostic interface design with populated demonstration bindings. Additional vendors, deployed reusable library and local-model training are not demonstrated features. |

## Final workflow acceptance

The remaining integration check is **spec upload → generated-world/plan review → exact selected world on the live bench → linked report**. Offline onboarding acceptance and the prepared conveyor's live proofs are distinct evidence. Add the final live run here only after it exists; no retrospective relabelling of a fixture run.

## Reading the verdicts

Use the original report and its separate audit/review together. An acknowledged command proves the acknowledged action, not all resulting machine behavior. An exact signal claim is stronger than an uncited model explanation. The partial HMI attempt is retained alongside the successful retry.
