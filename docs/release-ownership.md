# Tonight's work split

Claude's active lane is `codex/spec-onboarding` from22b3179. It owns import/paste, persistent project/version records, actual preparation jobs, a spec-derived reviewable plan, acceptance criteria, mapping validation, selected-world wiring and project/run navigation. Read the updated onboarding handoff and workflow acceptance checklist; pre-Start planning was added after the initial prompt commit. Claude returns a reviewable implementation/model-preparation checkpoint; no live PLC changes or user-host restart in that lane.

Codex owns independent acceptance, integration, live qualification and demo/submission closure. While onboarding is active, Codex owns its independent acceptance scripts, release documentation and the leaf UI components SteeringBox.tsx / RawIoPanel.tsx. Those components now disable host steering and physical-sink overrides that CampaignHost explicitly rejects, with visible explanations. Replay-local and the separate window-bridge controls retain their existing behavior. Launcher/profile polish and recovery integration remain final-integration items. Project generation, planning and project selection remain with Claude to avoid overlapping edits.

## Independent lifecycle witness

`node scripts/check-workflow-lifecycle.js [output-directory]`

Starts its own fixture-only HMI/campaign servers on ephemeral loopback ports. Uses the real production UI, HTTP commands, SSE, campaign runtime, generated example world and report renderer. It makes no Meta or PLC connection and never connects to5190–5193. The UI must already be built (`npm run build --prefix ui`).

It exercises real browser clicks through Start → Pause → Resume → Stop → new Start → completed report, reloads the browser, verifies the second report's identity, downloads standalone HTML, and rechecks the independently saved first ledger. All hosts/capture browsers close at the end.

Initial witness `artifacts/workflow-acceptance/2026-11-04T01-24-02-724Z/result.json`: **25/25 passed**, fixture class, zero PLC/model calls. The harness subsequently gained self/production-entry hashes; a final witness is recorded separately rather than overwriting this first result.

Final source-bound witness `artifacts/workflow-acceptance/2026-11-04T01-25-30-779Z/result.json`: **25/25 passed** with exact harness and production-entry hashes. Initial and final attempts are both retained.

Control-cleanup witness `artifacts/workflow-acceptance/2026-11-04T01-31-39-040Z/result.json`: **27/27 passed**, adding real-browser checks that unsupported steering and physical-sink overrides are disabled with explanations while raw values stay visible. UI suite57/57 and production build/typecheck passed. No host/runtime/PLC behavior changed. Future hosts implementing those commands should replace the leaf components' current host-version restriction with their advertised capability.

The refreshed video edit plan is `docs/submission/demo-three-minute-cut.md`. Its onboarding shot is conditional on a genuine new acceptance result; existing W4/S2/normal-operation clips are separately identified.

This qualifies only the existing fixture lifecycle and report continuity. It does not establish generated-project selection, server-restart history, actual PLC recovery, HMI congruence or live timing. Those remain explicit gates after onboarding integration.

## Final integration sequence

1. Review Claude's changes and genuine model-preparation evidence, especially that changed input changes the loaded world and that the plan exists before Start.
2. Verify mapping, expected/observed verdicts, source identity across child/Muse/view/report, and persistence/run history. Implement small capability/launcher fixes without masking missing behavior.
3. Run affected tests and the production walkthrough sequentially, without CPU-heavy rendering during timing-sensitive engine checks. Preserve failed attempts.
4. Freeze an exact new candidate and inspect the actual PLC boot/state before a live run; reuse existing ownership/hold/recovery semantics. Qualified example evidence does not transfer automatically to a fresh world.
5. Qualify one integrated live user path and a valid subsequent run as applicable. Preserve partial states/reports if it stops. No blind replay of uncertain writes.
6. Refresh the clean review app, update submission claims to actual status, then capture the short edited demo and publish the final intended submission branch when authorized.
