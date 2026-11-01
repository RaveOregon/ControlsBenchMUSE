# M10 convergence proof index

`latest.json` selects the delivered offline verification. Its directory contains per-check logs, `result.json` with tested source hashes/commit and credential-free preflight, `audit.json` checking those hashes/merge ancestry/frozen paths, and the mounted-view browser witness under `view/`.

Final code revision: `bad693d`. Final gate: `2026-11-01T03-47-44-339Z`, all eight check stages pass, 66 runtime/view tests, 51 UI tests and 13 browser checks. The final handoff/proof commit changes documentation and these new artifacts only. Frozen PLC projects, generated world and historical M8/M10 evidence have no diff from Lane A `3ab99ff`.

The browser uses the promoted package selected by `artifacts/machine-view/latest.json` and authentic preserved M10 ledger `artifacts/m10/2026-11-01T00-58-43-185Z/campaign.jsonl`. A/B carton states come from coordinator entity records. The screenshot quality legend honestly leaves five historical PLC channels unknown-quality, while their recorded values remain available in the ledger. Current M8 receipts explicitly carry verified quality.

Selection, link-loss and fallback probes are labeled presentation/protocol checks. They are not new PLC evidence or human HMI operations. No live PLC/model/paid request ran. Chrome is used because installed Edge exited before DevTools during an earlier local test.

Earlier convergence attempts are retained:

| Directory | Meaning |
|---|---|
| `2026-11-01T03-35-34-871Z` | Browser-script failure: the selection probe used a signal ID instead of the contract's equipment ID. Package/render checks passed; corrected to `peEntry`. |
| `2026-11-01T03-36-44-682Z` | Browser-only check, 13/13. |
| `2026-11-01T03-38-00-845Z` | Full offline gate before final source commits, pass. |
| `2026-11-01T03-41-02-399Z` | 65/66 runtime tests: a pre-existing HMI assertion compared an old UI frame against a newer in-flight frame. Corrected to the host's last valid frame at the stale transition; byte/hash checks remain. |
| `2026-11-01T03-43-39-024Z` | Full gate after HMI test correction, pass. |
| `2026-11-01T03-46-41-557Z` | Full gate with conservative unknown-quality handling, pass. |

See `docs/m10-convergence.md` for reproducible commands and the separate, not-yet-executed live rehearsal.
