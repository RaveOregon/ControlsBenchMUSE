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
- `npm run app:wonder`: gated live Wonder factory. It requires the reviewed isolated-process module, full pinned owner commit, pinned qualification/handoff manifest, private model configuration and pricing review before launch. The required Wonder-compatible process adapter is **not delivered by Claude's H2 runner**. This integration does not invent a passing manifest, turn H2's private ledger into the host campaign, relax timing or claim W4 passed. Missing configuration stops before a PLC password prompt/connection. Building/qualifying that shared adapter is the remaining core bridge.

The generated machine view and actual browser-HMI capture are distinct surfaces. The agent-operation endpoint belongs to the HMI service; it is not interchangeable with an accepted PLC command. Headless capture is the default; `-HeadedHmi` is available but the previously disclosed Windows scaling limitation for scripted headed clicks remains.

## Integrated commits and fixes

The integration began from convergence `dbafddc` (portal, live factory, generated view and review notes), merged Wonder `e435a02`, and merged Claude's corrected HMI `8e9d325`. The UI workspace branch's prior work was already in the convergence history; it required no second copy of the UI.

The four merge conflicts were resolved by retaining the union of commands/tests and TypeScript includes, both sets of scoped ignores, the fixed displayed-frame snapshot assertion and the stale-frame hold check. Tests run sequentially to avoid unrelated cross-file browser/CPU contention.

Claude's correction contains command quality/timestamp validation, timed-out-write draining/quarantine, and required cited-frame validation with the supplemental frames preserved. Wonder integration corrections add:

- Portal check-ID to category scope validation: default scope works; whole-group exclusions are respected; partial groups are explicitly refused rather than expanded. CQ checks are identified as preserved qualification references, never permission to re-run higher-rate qualification.
- An independent physical-evidence source mode for a currently hosted historical review. Timeline/Inspector show recorded physical evidence, original timestamps and unknown current freshness. Agent/review activity and commands remain current. The general replay/live workspace event-channel guard is unchanged.
- Actual module-entry verification against the pinned Git tree, including entries outside `src/scripts` and realpath resolution. Its checked-out SHA-256 and Git blob are recorded server-side before import.

## Verification and next core gate

`npm run verify:convergence` runs the combined runtime/HMI/Wonder tests, UI tests, TypeScript configurations, production build, view contract freshness and preserved-M10 browser audit. It records exact source hashes and source commit; it makes no PLC/model connection. `npm run proof:product` checks a running preview/recorded host using a real production browser, mounted generated view, captured HMI frame hashes and the real portal Start path. It refuses other factory identities before clicking anything. Its results, report, ledger and screenshots are under `artifacts/product-integration/`. A first smoke attempt read a partial report too early; that test-oracle error is retained and the corrected check waits for a newly created terminal campaign.

Next core work: finish the isolated Wonder driver/controller/lease/source-stream adapter against `src/campaign/process-port.ts`, qualify its original-event delivery and cancellation/parent-loss behavior, then run the recorded paid Wonder checkpoint and a separately owned full live normal/fault/adaptive campaign. No new live run, PLC recovery, paid checkpoint, public publication or submission was performed by this integration. Kiro's reusable-library and submission lanes remain separate and do not block preview use.
