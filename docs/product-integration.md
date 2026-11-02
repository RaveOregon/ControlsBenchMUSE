# Integrated ControlsBench application

Branch: `codex/product-integration`.
Current workstation folder: `C:\Users\steve\Documents\ControlsBenchMuse\.worktrees\product-integration`.

This is the application integration location. The main checkout remains an older Lane A worktree with independent user/agent modifications, including the PLC/File-Based Storage work. No root project file, active PLC application, credential watcher, library deployment or Kiro submission file was changed by this integration.

## Run from any PowerShell directory

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\steve\Documents\ControlsBenchMuse\.worktrees\product-integration\scripts\run-product.ps1"
```

Or, from the integration folder:

```powershell
npm start
```

Dependencies are already installed on this workstation. For a new checkout run `npm ci` and `npm --prefix ui ci` first. The launcher builds the UI; `-SkipBuild` reuses a current production build. Use `-Port` and `-HmiPort` together to choose another pair if needed. Defaults are portal `http://127.0.0.1:5190/` and HMI `http://127.0.0.1:5191/`. Existing unrelated hosts on other ports are left alone. Ctrl+C stops the launched services.

The default preview combines the real portal/host, the preserved Muse-generated machine view, a fake connector/provider adaptive campaign, and captured pixels from the labelled browser HMI fixture. The HMI fixture is a recorded/emulated presentation, not observations from the preview's fake connector and not a live PLC. Its own identity is visible on the page. This is integration testing, not a real Muse/PLC campaign. Opening the application does not start a campaign; use Start Campaign.

## Other modes

- `npm run app:recorded`: hosted review of the 302 preserved M10 acknowledgements using a deterministic provider fixture. Physical events retain historical source mode/timestamps and have no current PLC health expectations. Current review/model-fixture activity remains current. No paid model or new PLC connection.
- `npm run app:m8`: masked PLC-password prompt, actual HMI observation and the existing deterministic six-case M8 campaign factory. HMI operator controls are disabled so the campaign is the single operator-command owner. Start Campaign performs the controller/campaign initialization; the HMI observation service itself connects on launch. The clean baseline and shared lock remain enforced. This combined live composition has not been newly qualified by the offline integration proof.
- `npm run app:wonder`: gated live Wonder factory. Lane A's actual `controlsbench.wonder-process.v1` adapter is now integrated; its stable module defaults to `src/live/wonder-process/index.ts`. It requires a clean checkout at the exact owner pin, reviewed manifest/hash, private model configuration and pricing review before launch. The adapter has offline real-child/fake-transport evidence; H2 is separate historical support, not this adapter's live qualification. Missing configuration stops before a PLC password prompt/connection. Live W4, current DUT/lock checks, applicable recovery and new paid/export authorization belong to D. The old W3 $4 allowance is consumed.

The generated machine view and actual browser-HMI capture are distinct surfaces. The agent-operation endpoint belongs to the HMI service; it is not interchangeable with an accepted PLC command. Headless capture is the default; `-HeadedHmi` is available but the previously disclosed Windows scaling limitation for scripted headed clicks remains.

## Integrated commits and fixes

The integration began from convergence `dbafddc` (portal, live factory, generated view and review notes), merged Wonder `e435a02`, and merged Claude's corrected HMI `8e9d325`. The UI workspace branch's prior work was already in the convergence history; it required no second copy of the UI.

The four merge conflicts were resolved by retaining the union of commands/tests and TypeScript includes, both sets of scoped ignores, the fixed displayed-frame snapshot assertion and the stale-frame hold check. Tests run sequentially to avoid unrelated cross-file browser/CPU contention.

Claude's correction contains command quality/timestamp validation, timed-out-write draining/quarantine, and required cited-frame validation with the supplemental frames preserved. Wonder integration corrections add:

- The host advertises explicit Wonder category choices; actual browser Start forwards those exact booleans and every deselection. Historical check selections remain separate and cannot silently broaden category authorization. Legacy check/rate IDs and empty scope are rejected. The fixed recorded fixture requires both evidence/adaptive categories.
- A single `Provenance.evidenceMode` distinguishes recorded physical observations from current review transport/activity. Timeline, Inspector, raw metadata, machine view and component health preserve original source timestamps and unknown quality without implying a new PLC observation. The replay/live event-channel guard is unchanged.
- One verifier checks the actual regular module entry's exact pinned bytes and rejects redirects/untracked/changed files, including outside `src/scripts`. It rechecks immediately before import and preserves the SHA-256/Git blob in server-side and ledger evidence.

Lane B merges reviewed Wonder `91c868d`, process adapter `85da842` (implementation `9e98da7`), and preliminary product QA `f43dd05`; read [w4-convergence-handoff.md](w4-convergence-handoff.md) for final pins, source-hashed union evidence, module/manifest readiness and limitations. The actual Wonder W3 run is **partial**: three generation calls, two findings/30 exact historical claims, no new investigation after observation. Its original bytes and conservative account remain preserved. C's three presentation findings are corrected, with its failed witnesses retained; a B regression rerun does not grant C's final workflow signoff.

The verified production source is now `c77553c`: **178 runtime/HMI/Wonder/process tests, 51 UI tests, 75 production-browser/capture checks, all typechecks/build and three 13/13 historical H2 audits pass**. C's later exact-source workflow/launcher/export/HMI recheck through `28657a2` is merged and independently adds its scoped 15/21/6/4/13 checks. Hosted Results exports the authoritative report with the correct evidence class; fixture results are not labelled live PLC evidence. A clean prepared launch checkout at `.worktrees/w4-runtime-pin` holds that exact source, dependencies and matching build; the reviewed manifest remains outside it in `artifacts/w4-convergence/handoff-c77553c/`. These are offline results. Native zero-model commissioning and new paid/export approval still precede real W4.

C signed off the requested offline workflow scope at this exact source. Lane B completed the canonical application fast-forward and rebuilt the UI, preserving existing HMI capture files. Future Windows Git checkouts/merges of the retained raw capture history should use `git -c core.longpaths=true`; the already prepared launchers need no extra Git setting. The main checkout's PLC/File-Based Storage edits remain separate and unchanged by B.

## Verification and next core gate

`npm run verify:convergence` runs the combined runtime/HMI/Wonder tests, UI tests, TypeScript configurations, production build, view contract freshness and preserved-M10 browser audit. It records exact source hashes and source commit; it makes no PLC/model connection. `npm run proof:product` checks a running preview/recorded host using a real production browser, mounted generated view, captured HMI frame hashes and the real portal Start path. It refuses other factory identities before clicking anything. Its results, report, ledger and screenshots are under `artifacts/product-integration/`. A first smoke attempt read a partial report too early; that test-oracle error is retained and the corrected check waits for a newly created terminal campaign.

The isolated driver/controller/lease/source-stream adapter is now merged with an unchanged process port. `npm run verify:w4:offline` qualifies the merged offline composition, real-response replay, saved H2 audits and production browsers on ephemeral ports, removing external Meta/OPC configuration. The real live normal/fault/adaptive campaign remains D's gate, with fresh payload/spend approval. This integration makes no new PLC/model contact, recovery, public publication or submission. Kiro's reusable-library and submission lanes remain separate.

## Preserved integration result

Against source commit `de89a87`, `artifacts/m10-convergence/2026-11-01T20-08-23-610Z/` passes all eight verification stages: **155/155 runtime tests, 51/51 UI tests**, all three TypeScript configurations, frozen view contract, production build and **13/13** mounted preserved-M10 browser checks. All three original H2 passing runs still audit **13/13** using the merged corrected auditor; the historical files were not rewritten.

The final direct launcher/browser witness is `artifacts/product-integration/2026-11-01T20-10-12-120Z/`, **10/10**, including the actual production portal Start, a newly created finalized adaptive fixture campaign, a grounded report, mounted generated view, and exact HMI capture bytes. Its ledger/report/frame/screenshot are preserved and explicitly fixture-class. Earlier smoke attempts are retained with their limited scope and the premature-report assertion failure. No PLC or Meta call occurred. The tested integration worktree's frozen PLC project remains SHA-256 `6c2a1eb6c9c83485b75cb9bcefc1be237a94c8727ecf8098ad57a4d680516628`.

The temporary preview server and its HMI capture were stopped after verification, leaving :5190/:5191 free for the user's own launcher. Other services, worktrees and the main checkout's modified PLC project were left alone.
