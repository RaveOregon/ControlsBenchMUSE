# S2 — live Muse HMI operation proof

The scoped operator proof passed with limitations on November 3, 2026. Muse operated the actual browser HMI connected to CODESYS Control Win, received real screenshots, compared them with independently observed PLC state, and completed its report. UI-01 through UI-03 are supported in the exercised scenarios. UI-04 (stale/unknown/WCS-disconnect display) remains inconclusive. One extra screenshot citation was invalid; it is preserved and excluded from the engineering conclusion.

## Demonstrated behavior

Campaign portal-20261103232137992-1 completed five successful Wonder responses, without model-service retries or human intervention during the campaign. Muse chose the actions: Auto On, Start, Stop, Start again, overload injection, overload clear, Reset and Auto Off. Supervisory commands used trusted CDP clicks in the same captured browser session shown by the portal. Raw field inputs remained owned by the isolated world process. Direct semantic PLC Start/Stop/Reset was refused for S2.

The saved Start screen shows RUN commanded while feedback is still STOPPED. The Stop screen shows OFF commanded while feedback is RUNNING during coast. After the injected overload, the Operation page shows Faulted, F10 Drive overload and motor off. Reset is acknowledged, the alarm clears, and the machine remains stopped. Auto is explicitly readback-confirmed, not presented as a PLC mode acknowledgement.

Seventeen image inputs were sent as actual JPEG bytes, with evidence references and SHA-256 hashes. The audit verifies four sequenced Start/Stop/Reset operations (including two Starts), trusted page input, rendered acknowledgements, 28 paired tool results and ten exact PLC finding claims. The separate engineering review traces all ten claims to original child events, native observations and same-cycle Good OPC UA samples. Auto On/Off receipts remain in the original HMI journal.

## Evidence and limits

Run directory:

artifacts/s2/2026-11-03T23-19-41-497Z-live-retry/host/runs/2026-11-03T23-21-03-238Z-live_plc/portal-host/portal-20261103232137992-1

- report.json: original unedited model report.
- s2-audit.json: reference_review_required, because UI-03 cites extra capture :2783 whose pixels were not sent to Muse. It also cites received frame :2798, which independently supports the visible fault text. No original report or response was rewritten to remove the defect.
- engineering-review.json: pass_with_limitations; reviewed Start, Stop, fault and Reset images; ten native claim traces; exact final observer hash.
- hmi-journal-prefix.jsonl: verified hash-chained service journal preserved at export.
- vision-frames/: exact images attached to model requests.
- wonder-exchanges.jsonl: request/response/image lineage.
- wonder-process/: original child, lifecycle and native transport journals.
- held-state.json and result.json: retained-image record after shutdown. The result label held describes preservation of the input image, not a campaign failure verdict.

All original evidence hashes verify. The fresh final observer is in the retry packet directory as final-observer.json. Same PLC boot1787886077538: Stopped, fault0, motor off, no item/offer/completion, retained image at rest. The child drained, exited and released the runtime lock with no uncertain or in-flight writes. ConnectorStale after shutdown is expected bench diagnostics, not a machine alarm.

This is the local Node-served browser HMI, not native CODESYS WebVisu. Actions target known labelled controls, not arbitrary-HMI discovery or free-coordinate navigation. Only drive-overload alarm text was exercised; no carton/divert or stale/WCS-disconnect coverage is claimed. The assessment and finding records remain model-authored; the engineering conclusion is separate.

## First attempt and retry

The earlier campaign portal-20261103231427237-1 is preserved under artifacts/s2/2026-11-03T13-58-03-806Z-live. One successful generation returned a plan, but a real PLC heartbeat lapse stopped execution before any HMI actions. A slow coherent metadata read delayed heartbeat servicing beyond the PLC's unchanged 25-scan (~500ms) freshness limit. This attempt is partial.

The retry reduced observer load: periodic capture 3000ms and shared HMI polling 2000ms while the coordinator owns the session. On-demand command/result captures remained enabled. The physical engine stayed at immutable503abd3; PLC, generated world, 100ms target cadence, 300ms maximum world step and PLC stale threshold were unchanged. These settings produced one successful run, not a repeatability guarantee under arbitrary workstation load.

The original packet's older boot was superseded by an explicit fresh-boot attestation after the user restarted Control Win. No held-state recovery was applied across boots. The retry packet preserved accounting and allowed seven remaining requests, keeping the original total allowance of eight.

## Implementation and validation

Source implementation commit8e1f0e0 on codex/s2-hmi adds the opt-in HMI bridge, exact image inputs, typed assessment records and S2-aware export. Default HMI actions remain unsupported unless the bridge is explicitly installed. The immutable physical engine is503abd3b895cb2fc03853a9ec2d75166544e2a59. Original generated world and PLC project hashes remain unchanged.

Offline qualification includes 163 affected tests, then 41 changed-path tests after final batching/export changes (counts overlap), typecheck and UI production build. The standard npm test command now includes test/s2-hmi.test.ts. Final full suite:231/233 passed; two existing commissioning timing/held-state cases failed during concurrent review work. Both passed on an isolated targeted rerun (2/2), with no code or threshold change. Original failure log is retained. See artifacts/s2/final-validation.json.

## Accounting and operation

The successful retry's known uncached token estimate is USD1.5738; the preceding partial attempt is USD0.09302. These estimates are not invoices and caching can change actual charges. Six requests across the two attempts added USD30 of conservative reservations; aggregate135 is reservation history, not actual spending. No ledger was reset or refunded.

The app remains available at http://127.0.0.1:5190/ with HMI at5191 as a live observer after completion. This proof factory deliberately permits only one campaign per host launch; do not repeatedly press Start or replay a historic packet. Future live runs require a newly inspected baseline and current source/account-bound packet. Build the UI before launching a new worktree (npm run build --prefix ui), because static availability is selected at host startup. Password entry remains local under the earlier automatic-review restriction.

Offline audit commands (write-once output; use an untouched evidence copy to rerun):

node scripts/audit-s2.mjs <campaign-directory> <packet-directory>
node scripts/review-s2-evidence.mjs <campaign-directory> <packet-directory>

Next work is demo/submission integration and optional missing UI-04 stimuli, rather than claiming every HMI requirement passed.
