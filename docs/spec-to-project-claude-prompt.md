# Claude lane — complete specification-to-project onboarding

Use the same Claude coding thread that delivered the bench report, with high reasoning / extended thinking. Own this as a complete full-stack feature. We aim to finish the submission tonight. Implement, verify and commit the feature; a mock upload button, design-only response or disconnected generation script does not complete the task.

## Product goal

An engineer should be able to supply a machine specification and I/O information in ControlsBench, have Muse prepare a real reactive world, review the assumptions and PLC mapping, select the resulting project, and run a campaign that produces the existing bench report.

The current app loads a prebuilt conveyor. The generation/repair tools genuinely used Muse but are separate scripts with fixed conveyor paths and assumptions. Connect the missing product workflow. Keep **Load example conveyor** alongside **Create project from specification**. The example remains useful and must be labelled as a prepared example with its own historical evidence.

The first integrated target is our existing CODESYS M8 conveyor interface. Preparation should consume the actual uploaded text rather than substitute the example. Other machine specifications may produce drafts, missing-information questions or an explicit compatibility failure; they must not silently become the conveyor or acquire an unearned live-ready status.

## Checkout and ownership

- Repository: `C:\Users\steve\Documents\ControlsBenchMuse`.
- Canonical integration: `C:\Users\steve\Documents\ControlsBenchMuse\.worktrees\product-integration`.
- Start from integration commit **3120053** or its verified descendant. Your report lane df8908c is already integrated, followed by its handoff f1ee619 and a small independent fix3120053: currently running experiments must not say Interrupted. Retain that fix.
- Create a new isolated branch/worktree, e.g. `codex/spec-onboarding` in `.claude/worktrees/spec-onboarding`. Read applicable steering files. The root checkout is older and has unrelated user PLC changes; leave it alone.
- You own UI, preparation service, project artifacts and the selected-project runtime seam. Coordinating Codex owns final integration and fresh live PLC commissioning. Do not download/change the PLC, modify existing immutable runtime pins, or restart the user's app on5192/5193 or live observer on5190/5191.
- Use independent preview ports. Do not merge into integration yourself; return a reviewable commit and precise handoff.

## Read before changing code

- Latest `HANDOFF.md`, `docs/architecture-decisions.md`, `docs/first-proof-contract.md`.
- `docs/s2-hmi-proof.md`, `docs/w4-live-proof.md`, `docs/bench-report.md`.
- `ui/src/App.tsx`, `ui/src/components/Portal.tsx` (ContextPanel), `ui/src/adapters/replay/fixtures-browser.ts` (currently static spec/view data).
- `src/host/http.ts`, `src/host/campaign-host.ts`, `src/host/campaign-factory.ts`, `src/host/protocol.ts`.
- `scripts/generate-world-package.js`, `scripts/repair-world-package.js`, related targeted repair scripts. Their fixed paths, conveyor-specific developer prompt, relative imports, latest.json updates and required Gate A roles need deliberate refactoring; wrapping the existing command is insufficient.
- `src/proof/contracts.ts`, `manifest.ts`, `world-context.ts`, `hot-reload.ts` and `scripts/run-gate-a.js`.
- `src/live/wonder-process/session.ts`, `protocol.ts`, `index.ts` and child implementation. session.ts currently fixes worldPath to the old generated conveyor and projectPath to the frozen demo.
- `src/host/wonder-campaign-factory.ts` currently fixes the source spec, world manifest and baseline. `src/campaign/conveyor-bindings.ts`, `src/live/m8-map.ts`, `codesys/demo/signal-map-v1.json`.
- `scripts/build-machine-view-contract.js`, `scripts/generate-machine-view.js` and machine-view validators: these also have prepared-conveyor assumptions.
- Existing model provider, timeout, exchange-journal, durable-account and pricing helpers; reuse useful pieces without changing prior accounting.

## User workflow

1. **Create project.** Give it a name. Upload a Markdown/plain-text specification or paste it. Optionally add a separate raw I/O list as CSV/JSON/text; use embedded I/O when the spec supplies it. Show supported formats clearly. Preserve original bytes and a SHA-256; persist/reopen the project after refresh. Do not claim PDF/DOCX support unless implemented and tested.
2. **Prepare with Muse.** The server sends this project's actual specification, I/O information and world contract to Wonder. Extract equipment/signals and prepare the executable world with declared assumptions. Meaningful missing information should become a question or a review item, not invented PLC behavior. Present a compact project summary and expandable I/O, assumptions and test-plan groups.
3. **Generate and validate.** Generate real TypeScript, manifest, tests and assumptions under a project/version-specific artifact directory. Compile and validate in an isolated worker. Return diagnostic errors to Muse for bounded structural/compiler repair, preserving every attempt. Show status, elapsed time, last activity, request/repair count and usage/accounting while it works. No model reasoning text needs to be exposed. No spinner alone or fake percentage progression.
4. **Review.** Display the extracted I/O with direction, native type, roles, normal/default values, units/scaling when supplied, mapping result and assumptions/questions. Display validation results and the planned test categories. Engineer editing/correction should create a new revision, keeping previous artifacts and evidence.
5. **Use project.** Select an exact validated version as the active campaign source. Freeze that selection for the campaign. The app, runtime, Muse campaign context, world view and report must all use that project's actual specification, signal map and world hash. A visible mismatch must block activation rather than fall back to the old example.
6. **Campaign and report.** Reuse existing engine/campaign/report surfaces. Preserve the original JSON/ledger exports and new HTML/print report. Link each campaign to the exact imported spec and generated version. Preparation progress is distinct from campaign execution; generation alone must never say PLC tests passed.

**The campaign must populate before execution.** Preparation must produce and persist an initial spec-derived test plan for review before Start Campaign is enabled: grouped I/O, functional, normal-operation, fault/alarm and HMI checks as applicable. Each planned check has an objective, the relevant spec/requirement reference when available, intended stimulus, expected observation or an explicit unspecified criterion, and its applicable evidence source. Show the real planned checks in Setup/Campaign, not the legacy static conveyor checklist. After Start, stream statuses, new Muse-selected follow-ups and findings into that same project/campaign presentation. Follow-ups remain within the engineer's selected categories and are labelled as additions based on evidence. Reopening a prepared project retains its plan; it must not require touching the PLC to populate it. Add a browser assertion that the imported project's actual plan is visible before execution and that no PLC write occurred merely to prepare/display it.

## Breakpoints and completion requirements

### A — Import and job lifecycle

Implement persistent project/version records plus a real asynchronous preparation job. Same-origin API, bounded uploads, server-generated identifiers and contained artifact paths. No arbitrary client-supplied filesystem paths or shell commands. A job survives browser reconnect and exposes honest queued/running/needs-information/validating/ready/failed/cancelled state, as appropriate. Cancel terminates or aborts the actual model/worker activity and records the outcome. Use an injected fake provider for early offline tests, visibly labelled as a fixture.

### B — Real generation and independent validation

Turn fixed generation into a reusable service with explicit project inputs and output paths. Preserve request/response/model/hash/repair lineage. Do not overwrite the accepted conveyor specification, package, latest-pointer history, previous runs or immutable pins. Keep the physical-world contract: real actuator-driven motion and deceleration, sensors derived from physical state, raw/native feedback and encoder counts. The PLC remains responsible for its scaling and application logic. Do not copy the controller's routing/alarm state machine into the generated world to make a check pass.

Separate generic compile/contract/initialization/direction/finite-value/snapshot checks from conveyor-specific physics checks. Existing Gate A assertions tied to old geometry or speed are not universal acceptance criteria. A failing test does not authorize changing legitimate physical behavior or the uploaded spec; classify compiler/structural defects, stated assumptions and actual behavioral contradictions. Never weaken a test merely to green the job.

Use bounded model calls, repairs, request/worker timeouts and cancellation. The user has already authorized available hackathon credits for necessary proof work; use them economically. Keep the existing durable accounting intact and label conservative reservations separately from token-cost estimates. Derive request admission from this job's actual context/output bounds rather than copying an unrelated live W4 allowance. Do not reset history or interpret the current135-dollar conservative reservation total as actual invoice spending. Keys stay server-side and out of requests visible to the browser, artifacts and logs.

### C — Compatibility and selected-project execution

For M8 activation, require the complete PLC-facing input/output mapping with exact direction/native types, required roles and required world-control semantics. Unresolved, extra or incompatible PLC writes must be identified explicitly. A filename match or same signal count is insufficient. The workstation owns the full simulated raw input image; on link loss it holds the last image with bench diagnostics. The local engine owns timing independently of Muse requests.

Remove the fixed world/spec choice only through an explicit project selection seam. Launch the selected validated package in the isolated process with expected hashes; verify what the child actually loaded, and put that identity in campaign provenance. Keep fixed prepared-example mode working. A fresh generated world does not inherit the old world's live qualification because it has the same signal names. Preserve source/pin verification and immutable engine history; prepare a new candidate configuration for Codex's live commissioning rather than loosening checks on an old pin.

The generated visualization should use this project's metadata and state. Where a fresh generated view is unavailable, a clearly labelled signal/equipment view is acceptable for the first checkpoint. Never show the original conveyor drawing as a different uploaded machine or animate independent invented motion.

### D — Prove the actual user path

- Browser-import a spec through the UI and persist/reopen it.
- Show the provider receives the uploaded bytes/text and separate I/O, not the old hardcoded spec.
- Use a changed, interface-compatible conveyor example (such as an explicit physical parameter change) to prove there is no hidden fallback: the new artifact and isolated world behavior must reflect that change. Keep the existing live controller code and accepted world unchanged.
- Exercise the new selected world through a fake/isolated transport campaign and open its real report. Assert source spec hash, world hash and project/version are consistent across preparation, loaded child, campaign context, portal and report.
- Verify incompatible I/O cannot activate as live-ready; ambiguous spec/missing I/O surfaces actionable questions; failed generation/compile/cancel does not replace the active project.
- After offline checks, run at least one genuine Wonder preparation from the UI or the exact same UI API path, using the local key and existing credit authority, with full preserved provenance. Do not stop at an injected-provider success. If external access/key/account state blocks this, identify the exact blocker and still finish all independent work.
- Do not claim live PLC qualification. Return a ready candidate, hashes, commands and the remaining live checklist for coordinating Codex.

## Implementation boundaries

Make the onboarding a small, understandable product flow, not an IDE. Show summaries first with expandable details. Retain the updating status text the engineer asked for. Reuse the report design and current app rather than starting a second UI or replacing the engine. No elaborate graphics work, new PLC platform, local-model installation, model training or reusable-library deployment in this lane.

Generated code executes in the isolated worker using the established context boundary, never in the HTTP/UI process. Keep source imports and artifact directories correct for arbitrary project IDs; do not depend on a fixed three-level relative import or the host's current directory. Run new generation/compile work separately from a streaming live coordinator so it cannot starve its heartbeat.

If the full path reveals a genuine architectural blocker, report it promptly with a concrete narrower implementation plan; do not quietly deliver an upload UI connected to the original world and call onboarding done.

## Validation and handoff

Add meaningful job/provider/mapping/selection/provenance tests, a browser import-to-report witness, and regression checks for the prepared example. Use injected provider/transport for repeatable tests; label the genuine model checkpoint separately. Run affected host/runtime/UI tests, typechecks and UI build. Avoid heavy browser rendering concurrently with timing-sensitive process tests; existing timing-bound failures are preserved in prior qualification records and are not permission to relax thresholds.

Keep screenshots and evidence showing the upload, live preparation status, validation/review, selected world identity and resulting report. Commit the implementation, tests and concise handoff with exact commands, model requests/accounting, source hashes, compatibility limits and next live checkpoint. Do not merge or restart the user's hosts. Return when the connected workflow is implemented and independently reviewable.
