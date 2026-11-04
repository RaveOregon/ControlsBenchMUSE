# Tonight's work split

Claude's active lane is `codex/spec-onboarding` from22b3179. It owns import/paste, persistent project/version records, actual preparation jobs, a spec-derived reviewable plan, acceptance criteria, mapping validation, selected-world wiring and project/run navigation. Read the updated onboarding handoff and workflow acceptance checklist; pre-Start planning was added after the initial prompt commit. Claude returns a reviewable implementation/model-preparation checkpoint; no live PLC changes or user-host restart in that lane.

Codex owns independent acceptance, integration, live qualification and demo/submission closure. While onboarding is active, Codex's changes stay in its independent acceptance scripts and release documentation. Control-capability cleanup (unsupported steering/suppression and misleading status), launcher/profile polish and any recovery integration are final-integration items; they are not yet claimed delivered. Project generation and new plan schema changes remain with Claude to avoid overlapping edits.

## Independent lifecycle witness

`node scripts/check-workflow-lifecycle.js [output-directory]`

Starts its own fixture-only HMI/campaign servers on ephemeral loopback ports. Uses the real production UI, HTTP commands, SSE, campaign runtime, generated example world and report renderer. It makes no Meta or PLC connection and never connects to5190–5193. The UI must already be built (`npm run build --prefix ui`).

It exercises real browser clicks through Start → Pause → Resume → Stop → new Start → completed report, reloads the browser, verifies the second report's identity, downloads standalone HTML, and rechecks the independently saved first ledger. All hosts/capture browsers close at the end.

Initial witness `artifacts/workflow-acceptance/2026-11-04T01-24-02-724Z/result.json`: **25/25 passed**, fixture class, zero PLC/model calls. The harness subsequently gained self/production-entry hashes; a final witness is recorded separately rather than overwriting this first result.

Final source-bound witness `artifacts/workflow-acceptance/2026-11-04T01-25-30-779Z/result.json`: **25/25 passed** with exact harness and production-entry hashes. Initial and final attempts are both retained.

This qualifies only the existing fixture lifecycle and report continuity. It does not establish generated-project selection, server-restart history, actual PLC recovery, HMI congruence or live timing. Those remain explicit gates after onboarding integration.

## Final integration sequence

1. Review Claude's changes and genuine model-preparation evidence, especially that changed input changes the loaded world and that the plan exists before Start.
2. Verify mapping, expected/observed verdicts, source identity across child/Muse/view/report, and persistence/run history. Implement small capability/launcher fixes without masking missing behavior.
3. Run affected tests and the production walkthrough sequentially, without CPU-heavy rendering during timing-sensitive engine checks. Preserve failed attempts.
4. Freeze an exact new candidate and inspect the actual PLC boot/state before a live run; reuse existing ownership/hold/recovery semantics. Qualified example evidence does not transfer automatically to a fresh world.
5. Qualify one integrated live user path and a valid subsequent run as applicable. Preserve partial states/reports if it stops. No blind replay of uncertain writes.
6. Refresh the clean review app, update submission claims to actual status, then capture the short edited demo and publish the final intended submission branch when authorized.
