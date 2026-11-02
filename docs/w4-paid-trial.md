# First live Wonder trial — approved, launch pending

The user explicitly approved **one $4 live trial** on 2026-11-02. `authorization.json` beside the packet preserves that answer and exact packet hash. Source/packet/account recheck passed after approval, with zero new calls or charges. Next: the prepared local launcher, masked PLC credential and Start Campaign. Do not interpret this approval as a second run or a reset of W3 accounting.

This integration chat owns the trial. There is no task to delegate before launch. Zero-model commissioning has passed; the remaining product proof is real Wonder choosing experiments and a new investigation from live PLC observations, then producing grounded findings/report.

Prepared packet: `artifacts/w4-paid/2026-11-02T13-42-05-152Z/packet.json`.

**Packet SHA-256: `2b7363876810fe6df81ce0a7fcd06d97bbc5edae67b3f8815ba2d9af17be7bf9`.** This proposal does not authorize itself. User approval applies to this packet and one campaign; the matching launch flag plus Start Campaign records execution authorization.

## What runs

- Model: `muse-wonder-1.0`, high reasoning, Standard mode.
- Source `a63f4b7` adds the paid composition; its production files are individually hashed in the packet. It wraps the unchanged immutable engine at `e3469af897949721a3fe02340e34d8dd70e0071c`.
- The original `CampaignHost`, `CampaignRuntime`, provider, ledger, controller/world tools, streaming child, raw signals and PLC code remain unchanged. The wrapper's `run()` delegates to the actual provider loop; it is not a fixed conveyor executor.
- The engineer objective asks for a normal trial, a declared fault trial and a genuinely new evidence-dependent follow-up. Wonder chooses hypotheses, fault, actions and verdicts. It is asked to finish Stopped, fault-free, with no item/completion pending. No automatic cleanup changes its outcome.
- All three categories (normal, faults, adaptive) must be selected. HMI capture stays visible; autonomous HMI operation, world/PLC rewrites and higher-rate qualification are outside this first trial.

## Cost envelope and data transfer

**At most four generation attempts and $4 new conservative reservations for one campaign.** Failures, token-count failures and uncertain calls retain their reservations. Actual billed usage is separate from this conservative ceiling. Existing W3 accounting is $4; the new aggregate ceiling is $8, below the existing $15 session limit. No account/lock is deleted or reset.

Runtime `maxTurns=4` stops before any fifth reservation. This was tested with real `CampaignRuntime` and isolated simulated paid accounting. The native provider's token-count admission still bounds each request to $1 and 4,000 output tokens including reasoning, with its five-minute request timeout. The generic campaign guard remains $5; the four-turn trial envelope is tighter. A second campaign is refused once any charge changes the reviewed account baseline.

Rates rechecked 2026-11-02: Standard Wonder input $4/M tokens and output $20/M tokens; the admission guard assumes no cache discount. These match the pinned provider's `2026-11-01` pricing version tag. Source: [Meta pricing](https://dev.meta.ai/docs/pricing-rate-limits).

Meta receives the accepted conveyor spec, logical I/O/tool contracts, engineer objective, fresh live PLC observations and diagnostics, experiment state, action results, evidence IDs and subsequent findings/investigations. It does not receive credentials, PLC code/binaries, opaque addresses/node IDs, generated world source or HMI pixels/video.

Read `static-payload.json` and `example-request.json` beside the packet. The example is the actual provider HTTP shape captured through a **local stub**, using clearly labelled **recorded commissioning observations**. It is not the exact future live request or a real model response/token count. Actual live IDs, times, revisions, observations and paired outcomes will be new; their data classes are explicit in the packet. The real factory does not import the example observations into the new campaign.

## Recovery preparation

After the bounded loop ends, the wrapper stops campaign progression, disposes the original child, then derives `held-state.json` from that campaign's original journals and ledger. It writes a saved report and `result.json` alongside them. Exact owner-entry and approval bytes are bound into the record. `status: held` describes the retained input image; `campaignStatus` preserves whether the agent completed, stopped or failed. This is not a W4 verdict.

The existing pinned `recover-w4-held.js` accepts that format. Inspection remains read-only; reconciliation still requires its exact record SHA and matching boot/epoch/sequence/image/commands/counters/fault/ownership. Its `--artifacts` must be the paid campaign's parent directory. Stop the owner host before recovery. Unknown states, missing terminal-exit proof and incomplete initialization require separate inspection rather than a fabricated recovery record. No live W4 recovery is yet qualified.

## Offline evidence

- `artifacts/w4-paid/paid-tests.txt`: **5/5** with all Node networking disabled. Checks authorization/source/scope refusal and host metadata, immutable aggregate accounting, no fifth simulated paid charge, rejection of native commissioning as paid evidence, real-child/provider-loop cleanup/export, acceptance by the existing read-only recovery inspector, and missing-exit/overwrite refusal.
- `artifacts/w4-paid/engine-validation.json`: all **253 source and 386 frozen-file hashes** still match the passing live-qualified engine composition. The immutable tracked source was not modified.
- JavaScript syntax checks and PowerShell launcher parsing passed. Zero real API requests, zero new PLC connections and zero new charges occurred during this preparation.
- The earlier `13-36-10` payload preparation is superseded by the packet above; no authorization or real call occurred for it.

## First live attempt — stopped, 2026-11-02

Campaign `portal-20261102181837516-1` returned one real Wonder response, accepted Start and WCS route 1001/A, and introduced its carton. While waiting for completion, a 336 ms world-update gap exceeded the declared 300 ms bound. The connector quarantined, the campaign stopped, and the wrapper saved the exact report, held-state and terminal child journals. No fault or adaptive experiment completed. This is a partial attempt, not a W4 pass.

Conservative accounting is now $5 aggregate: $4 historical plus $1 from this trial. The response used 14,820 input and 1,214 output tokens (estimated $0.08356, not invoiced cost). Do not reset accounting or restart with the old packet. The last saved PLC observation was Auto with motor and D1 commands on and carton 1001 active; a stopped campaign does not establish a stopped PLC. Inspect current state before reconciliation.

Launching from the user's home directory exposed a launcher bug: HMI ownership discovery uses the process working directory, repeatedly failed Git discovery, and could not find the shared runtime lock that selects slower HMI polling. The external launcher now scopes the Node process to the immutable checkout and restores the caller's directory afterward. This correction has not been live-qualified, and timing causation is not yet proven. It changes the launch source hash, deliberately making the original packet unusable for another start.

A fresh read-only HMI GET at 18:21:21 UTC observes Faulted, fault 33 (carton transit timeout), motor command false, completion pending and ConnectorStale true. Exact snapshot saved as `post-stop-hmi-observation.json` in the approved packet directory. The HMI reports a 250 ms polling interval, confirming it did not enter shared-runtime slower polling. This observation is not recovery qualification; no recovery writes occurred.

## Original launch command (historical; do not rerun)

### Remaining-allowance retry — partial and recovered

**Superseded by execution:** user restarted the runtime; this packet executed as `portal-20261102234344698-1` against new boot `1703372672414`. One genuine Wonder decision issued six applied semantic actions and completed carton 101 at A, with PLC Sorted completion and CountExitA=1 (`plc.output` event `:1024`). The second request correctly paired all six exact terminal results with the first function call and response ID. Meta returned HTTP 200 with status `incomplete`, reason `max_output_tokens`: 4,113 reported output tokens including 3,010 reasoning, against the requested 4,000. No second decision was executed. Fault/adaptive/HMI-agent tests and full W4 remain unproved. The uncached token estimate is $0.304784 for this retry (not an invoice); conservative charges remain two dollars, bringing aggregate accounting to $7. One original conservative dollar remains; no further paid request was made.

The held controller had finished the carton but remained Auto with its completion pending. New external recovery narrowly supports this exact completed-A-sort state; it does not change the immutable engine or relax its old recovery paths. Original evidence/child-exit hashes and stock identity/image/counter checks must match, with no unresolved writes, commands, live carton or fault. Inspect is read-only; reconciliation needs the exact held-state SHA and revalidation. It executes Stop, fresh simulated world at rest, acknowledgement of the observed completed item, and await Stopped. It sends neither Start nor Reset and makes no model calls. This explicitly resets bench inputs and is not coast/physics evidence.

Offline classification mutation tests plus real connector/write-gate execution with fake transport passed; the eight-test paid/recovery union also passes. Native inspection and reconciliation passed at `completed-recovery-2026-11-02T23-50-25-911Z`. Final state: Stopped, fault 0, motor off, no active item or completion pending, CountExitA=1 and other counters zero; lock released. `paid-retry-audit.json` verifies all seven original hashes, the 3,153-event chain and exact report, response hashes, response/tool lineage and six terminal results, and the cleanup journal/final state. The audit output is write-once; preserve the saved result.

Before another paid trial, address the insufficient output allowance for high reasoning plus structured actions and reduce unnecessary context. Do not automatically retry an incomplete response, reuse this now-consumed packet, or describe the remaining $1 as a fresh allowance.

User authorized the retry with "Go for it". Implementation `45e003b` caps both the runtime and provider at three requests. The new packet is `artifacts/w4-paid/2026-11-02T21-16-08-803Z/packet.json`, SHA `65ef88a88fc36edc5d44ce6bfa058743e0048b97bbefe30291f942d8688a73d6`. This consumes only the remaining original $3 if executed, keeping the existing $5 account and $8 aggregate ceiling. Six offline tests pass, including a real runtime with an isolated seeded-five account stopping after three simulated paid reservations. Preparation verified all 639 engine file hashes and all six launch hashes with networking disabled.

The launch preflight refused before replacing the old observer or requesting a password: the software PLC service is Stopped, :4840 is absent, and the old HMI is reconnecting without fresh values. Windows denied direct service startup; launching the installed tray utility required app approval that timed out. No paid request, credential entry or PLC write occurred. The original retry approval remains valid. `launch-status.json` records the blocker. Start the CODESYS Control Win runtime through its normal controls, then revalidate baseline and packet/account before execution. Do not spend against an offline PLC or reset accounting. The user is away from the computer.

**Superseding outcome:** the masked-prompt recovery passed on the real PLC at 18:27 UTC through the exact supported transit-timeout path (Stop, fresh world, acknowledge completion 1, Reset). The independently verified final state was Stopped, fault 0, motor off, no active item or pending completion, lock released. Original campaign hashes remain intact; `recovery-audit.json` binds the recovery transport and final state. This qualifies this native recovery path once, not every failure path.

The fresh corrected host then passed zero-model commissioning `2026-11-02T18-29-55-042Z`, with live HMI capture active. HMI lock detection and the intended 1,000 ms shared polling were observed directly. The run recorded 199 cadence commits, p95 158 ms/max 181 ms, zero gaps over 300 ms; the 1,501 ms parent stall retained 13 child commits with a maximum 133 ms gap, and the 400 ms lease expired at 401 ms. All phases, including normal sort and overload/reset, passed. Final read-only inspection matched the stopped baseline and the lock was released. Archive and audit: `artifacts/w4-paid/timing-2026-11-02T18-29-41-137Z/` (nine original evidence hashes, 2,039-event chain, exact reconstructed report). One pass does not guarantee future timing.

No additional model calls occurred. The app remains available as a zero-model live M8 observer with HMI commands disabled. Do not click Start expecting Wonder on this observer. A retry needs a fresh packet/source binding and must derive its remaining allowance from the original approval: at most $3 additional conservative charges, never more than $8 aggregate with W3. The original packet cannot be reused or treated as a new $4 allowance.

Stop the previous observer with Ctrl+C in its PowerShell window to free :5190/:5191. This issues no PLC command. Then run from any directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\steve\Documents\ControlsBenchMuse\.worktrees\w4-live-readiness\scripts\w4-paid\launch.ps1" -Packet "C:\Users\steve\Documents\ControlsBenchMuse\.worktrees\w4-live-readiness\artifacts\w4-paid\2026-11-02T13-42-05-152Z\packet.json" -AuthorizePacket "2b7363876810fe6df81ce0a7fcd06d97bbc5edae67b3f8815ba2d9af17be7bf9"
```

The launcher verifies the packet/source/manifest/proof hashes and pinned checkout before starting. It loads the private model key from the environment or the original repository `.env`, without printing it. The PLC password is entered at a local masked prompt. Open `http://127.0.0.1:5190/`, select all three categories and press Start Campaign once. Merely opening the app does not create a paid campaign.

After the run, preserve the full evidence. This chat audits native response/tool lineage, genuine post-observation follow-up, actual executed effects, grounded findings and final PLC state. A completed report alone does not establish W4. Do not automatically restart on a partial result.
