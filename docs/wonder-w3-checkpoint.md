# W3: real Wonder recorded-evidence checkpoint

The user explicitly approved transferring the previewed conveyor specification, logical I/O, recorded M10 PLC evidence/runtime identifiers and subsequent review results to `api.meta.ai`, using Muse Wonder 1.0 Standard, up to four generation requests and a **$4 conservative accounting cap**. The approved preview SHA-256 was `8e06045783a2fb0ceddf772d190d9872b11cf8450a67d0062a6b65f7336b7bbd`. No credentials, PLC source, opaque connection addresses or HMI pixels were in the context. This followed the earlier automatic-review rejection; the rejected command never started. That rejection was not bypassed or rerouted.

## Observed result

**Partial W3: provider/orchestration/report mechanics passed; a novel adaptive follow-up was not demonstrated.** W4/live commissioning is not run.

Wonder authored a two-experiment plan from the accepted specification and recorded tail evidence, selected three exact evidence-window inspections, received their terminal results through native `function_call_output` pairing, recorded two findings, completed both experiments and called `finish_campaign`. All six semantic actions were applied. The authoritative ledger validated all **30 exact PLC signal/value claims**; five tool results were delivered unchanged to the subsequent model turns. The native response lineage was checked against each request's `previous_response_id` and originating `call_id`.

The findings identify recorded D1 command/Auto/item-201 observations followed by fault code 23 and stopped commands, plus recorded exit/runout/misroute counts and completion values. Wonder explicitly retained unknown source quality, sparse-window/timing uncertainty and absence of HMI evidence; it did not certify controller requirement coverage or claim a new live trial.

The limit matters: all three evidence windows were selected in the **initial** response. Later turns recorded findings and finished that initial plan. No new post-observation investigation or `create_followup_experiment` action occurred. Therefore this is evidence of real multi-turn planning, tool outcomes and grounded reporting, not proof of the full adaptive live campaign. No further paid calls were made after the approved allowance was consumed.

## Attempts and accounting

1. `artifacts/wonder/checkpoint-2026-11-01T22-10-17-207Z/`: Meta's token-count endpoint returned HTTP 400 for named `tool_choice`; the error states that only `auto` is currently supported. Zero generation requests were sent. The full raw request/response and incomplete report are retained, and the **$1 conservative charge remains**.
2. Compatibility correction `7d8d85a`: use `tool_choice: auto` on both endpoints while retaining exactly-one-new-decision-call validation; tell the model its remaining decision budget; add bounded `--max-decisions=1..4` and unique checkpoint campaign IDs. Offline provider/factory regressions passed. This was a changed, explicitly announced new checkpoint, not an automatic retry.
3. `artifacts/wonder/checkpoint-2026-11-01T22-14-56-275Z/`: a distinct checkpoint was limited to **three** decisions/$3, retaining the initial $1 charge so the user's approved aggregate stayed at $4. All three generation responses completed; the review/report completed with no unresolved actions. Its exact attestation and limits are in `assessment.json`, alongside the unmodified launcher result and durable session-account snapshot.

| Turn | Response ID | Input / cached input | Output / reasoning |
|---|---|---|---|
| 1 | `resp_6ae7b9f984353c4e4a42485c` | 16,387 / 0 | 1,574 / 1,097 |
| 2 | `resp_6ae7ba164034f75534ce49d7` | 54,221 / 16,372 | 3,806 / 1,440 |
| 3 | `resp_6ae7ba25976ca7d6ad3a43ac` | 70,653 / 0 | 793 / 54 |

Total reported usage: **141,261 input tokens**, including 16,372 cached; **6,173 output tokens**, including 2,591 reasoning; 147,434 total. Reasoning is a subset of output and is not counted twice. At the verified [Meta Standard prices](https://dev.meta.ai/docs/pricing-rate-limits), reported generation usage estimates **$0.6262904**; treating every input as uncached gives $0.688504. These are usage-based estimates, **not a verified invoice or credit-balance observation**. The durable conservative account retains **$4**: $1 failed preflight plus $3 successful decisions, no refunds. The approval has **$0 remaining conservative allowance**. All admitted worst-case request bounds were below $1. Four token-count requests and three generation requests were sent in total; no silent retry occurred.

## Retained proof and launch

`artifacts/wonder/w3-latest.json` indexes both attempts and the assessment. The completed checkpoint contains the fsynced raw exchange journal, complete campaign ledger, shared report, model/request/call IDs, usage and conservative account snapshot. Historical M10 source remains labeled recorded throughout. Both immediate pre-spend gates passed 87 root tests, 51 UI tests and 13 production-browser checks: `artifacts/wonder-verification/2026-11-01T22-08-52-063Z/` against `83d473a`, then `2026-11-01T22-13-36-278Z/` against the compatibility correction `7d8d85a`. Their manifests/logs and offline artifacts remain retained. Convergence independently closed the original three portal/owner-pinning findings in `7c1a4dd`; that review predates W3.

`test/wonder-paid-replay.test.ts` injects the recorded HTTP bodies into the same Responses adapter and `CampaignRuntime`, executes the same semantic tools against preserved M10, checks native lineage, exact historical physical data/window references and terminal outcomes, and reproduces the two findings/30 claims and completed report with **zero new model calls or spend**. Replay review timestamps/hashes, provider provenance and finding-event IDs are new; original checkpoint bytes remain untouched. The test also asserts that this observed checkpoint contains no novel follow-up, preserving that limit in regression evidence.

The expanded offline comparison surfaced an error-path defect: a verbose provider failure could overflow the ledger's bounded message schema before the campaign paused. Correction `7641c9a` bounds the display message and tests that a large provider error still retains its conservative charge, pauses and stops without another turn. The checkpoint itself did not encounter that defect. Final post-checkpoint verification is selected by `artifacts/wonder-verification/latest.json` and includes both new regressions.

For another separately authorized checkpoint, use the existing documented launcher; `--max-decisions=3` can narrow a run, while its default remains four. Every invocation repeats the expanded offline gate before networking and conservatively charges each admitted decision durably. This handoff is not authorization to reset or extend the consumed $4 allowance, delete accounting/locks, recover the PLC or run the HMI/PLC live gate. The compatible runtime-owner process adapter remains the W4 dependency.
