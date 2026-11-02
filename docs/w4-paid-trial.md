# First live Wonder trial — prepared, awaiting new approval

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

## Launch after approval

Stop the previous observer with Ctrl+C in its PowerShell window to free :5190/:5191. This issues no PLC command. Then run from any directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\steve\Documents\ControlsBenchMuse\.worktrees\w4-live-readiness\scripts\w4-paid\launch.ps1" -Packet "C:\Users\steve\Documents\ControlsBenchMuse\.worktrees\w4-live-readiness\artifacts\w4-paid\2026-11-02T13-42-05-152Z\packet.json" -AuthorizePacket "2b7363876810fe6df81ce0a7fcd06d97bbc5edae67b3f8815ba2d9af17be7bf9"
```

The launcher verifies the packet/source/manifest/proof hashes and pinned checkout before starting. It loads the private model key from the environment or the original repository `.env`, without printing it. The PLC password is entered at a local masked prompt. Open `http://127.0.0.1:5190/`, select all three categories and press Start Campaign once. Merely opening the app does not create a paid campaign.

After the run, preserve the full evidence. This chat audits native response/tool lineage, genuine post-observation follow-up, actual executed effects, grounded findings and final PLC state. A completed report alone does not establish W4. Do not automatically restart on a partial result.
