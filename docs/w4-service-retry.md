# Bounded Meta service-error recovery

The five-request live trial ended on HTTP 503, `server_error`, "persistence service error", after two valid decisions and one grounded normal-sort finding. This change lets the coordinator recover from that specific error inside a campaign. Muse continues to choose experiments; the coordinator owns leases, execution and spending.

## Behavior

Retry is off by default. The provider and runtime must both opt in with `maxTransientRetries`; the paid packet additionally declares its retry allowance. The current paid wrapper permits at most one retry and refuses a runtime/provider pin that lacks the new policy. Existing approved packets keep retry disabled.

A generation response is eligible only when it is an explicit HTTP 503 with a structured `server_error` and no response identity, response status or output. The provider keeps the last valid `previous_response_id` and pending function-call ID. Returned tool results remain exactly paired with the action that produced them. A first-request failure resends the semantic-tool definitions on its next attempt.

The failed request settles its conservative charge before a retry is considered. A retry reserves another ordinary dollar and consumes another provider call and runtime turn. It fits inside the original campaign allowance; it never resets accounting or grants extra calls. A Stop during backoff retains its reservation even if no second generation was sent; this is conservative accounting, not a claim of API billing.

The old decision lease must finish validly. The next attempt begins a fresh **hold** lease, waits under that lease, then builds fresh context. The held image continues to be committed by the independent child while PLC scans and timers continue. After the wait, the runtime checks cancellation, campaign revision and connector health again before sending anything. The returned decision still needs a valid final lease and the original revision checks before any action executes.

Default backoff is one second. A valid short `Retry-After` is honored, with a 250 ms minimum and a 10 s maximum. Longer/invalid values stop the run; they are not shortened. The wait also must fit the existing reasoning deadline. Public status events show scheduling and waiting so the engineer can distinguish recovery from a hung model.

Incomplete output, malformed JSON/errors, partial/duplicate response identity, other HTTP codes, failed token counting, unknown transport outcomes, timeout, cancellation, invalid leases, stale revisions and quarantined connectors remain non-retryable. Repeated eligible errors stop when either opt-in limit or the original request/cost allowance is exhausted.

## Validation and deployment boundary

Implementation checkpoint: `ea2bebf`. `test/wonder-retry.test.ts` contains 17 targeted cases, including native Responses framing with a local stub, durable ten-plus-two accounting, exact response/tool lineage, first-request recovery, cancellation/revision changes, exhausted allowances, and real isolated-child execution over fake transport. The real-child case checks multiple identical acknowledged images with advancing PLC cycles throughout backoff and a fresh hold lease. Invalid lease completion refuses retry and retains the failed charge.

`scripts/check-w4-service-retry.js` records source hashes, typecheck, the full runtime/browser suite, a fully network-disabled retry run with saved child journals, and the paid-wrapper checks. It strips PLC/model credentials, verifies the shared paid account has not changed and verifies all 639 original live-pin file hashes. An initial over-restricted run passed 196/206; its 10 failures were loopback-network/Git-fixture permissions. It is retained as a diagnostic, not passing qualification. The source-bound rerun uses the local access those fixture tests require.

Source-bound proof **passed**: `artifacts/w4-service-retry/2026-11-03T00-35-06-586Z/result.json`. Typecheck is clean; the complete runtime/browser suite passed **206/206, no skips**; a separate fully network-disabled retry run passed **17/17** and retained the real child's journals; paid-wrapper checks passed **13/13**, including explicit refusal to enable retry on the old pin. These extra runs repeat targeted cases and are not additional unique runtime cases. All ten implementation/test/runner hashes stayed unchanged during proof. The shared paid-account bytes and all 639 original runtime/frozen-file hashes also stayed unchanged. No real model call, PLC connection or write occurred.

Factory integration is opt-in via `createCampaignFactory({ maxTransientRetries: 1 })`; if a custom provider is supplied, it must also use `maxTransientRetries: 1`. A paid packet must additionally declare `maxTransientRetries: 1`, and the wrapper requires runtime marker `meta-503-v1` plus a matching provider allowance. A qualifying retry consumes an existing attempt; it does not enlarge that packet's turn or dollar ceiling.

The currently running app still uses immutable `e3469af`. That checkout, the world, PLC project and connector/child timing code are unchanged. This is a parent coordinator/provider change. Before another paid live trial, promote it into a new pinned build and bind its source/proof and retry setting in a new packet. The wrapper explicitly refuses to enable retry against the old pin. The current shared total is $10; $2 remains under the user's $12 ceiling. No extra call is authorized by these tests or this document.
