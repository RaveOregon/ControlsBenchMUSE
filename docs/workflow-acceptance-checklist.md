# Workflow closure — tonight's acceptance checklist

Audit baseline: canonical integration3120053 plus onboarding handoff22b3179. The onboarding implementation is active on codex/spec-onboarding; this is a source audit of integration, not a verdict on that unfinished lane.

The core product path is: create/reopen project → import specification and I/O → prepare world and test plan → review assumptions, expected results and mapping → preflight configured bench → run selected campaign → observe PLC and optional HMI → review/export report → run again or reopen prior results.

## Core seams to close

1. **Real project selection.** The uploaded text and selected generated world must reach the actual child runtime, Muse context, machine view and report. Existing integration fixes these to the prepared conveyor in several places. Onboarding must prove a meaningful changed-spec result; an upload viewer or newly generated files alone does not close this seam.
2. **Reviewable plan before Start.** Persist the actual spec-derived checks and selected categories. Initial preparation must not require PLC writes. Current integration generates its campaign plan after Start; legacy check cards are not the uploaded project's plan.
3. **Expected results and verdicts.** Bench reports currently disclose that most experiments have no explicit acceptance criterion and are Observed rather than requirement passes. The new plan needs source-linked expected behavior and recorded observations for the exercised checks. Carry criteria through execution and reporting; do not infer pass from action acknowledgement or experiment completion. Leave missing thresholds unspecified and outcomes inconclusive where appropriate. Add this without rewriting historical campaigns or fabricating coverage for all requirements.
4. **Bench profile and capability preflight.** For tonight, clearly select the existing M8/CODESYS interface and show compatible I/O, actual PLC/link identity, simulation state and available HMI/WCS functions. Compiler success is distinct from mapping compatibility and live qualification. Existing initialization/connect logic is real but much of the operator setup remains launcher/config driven; a known configured profile is acceptable for the demo if the app clearly reports it.
5. **One coherent requested campaign.** Raw-I/O/physics, supervisory commands and the WCS peer must remain coordinated, with actual PLC receipts. The default Wonder factory and the S2 HMI-capable proof wrapper are separate compositions today. A new project selecting HMI checks must route to a genuinely HMI-capable campaign; a screenshot-only adapter is not HMI operation. Expose or disable checks according to capabilities, and qualify the resulting composition.
6. **Completion, failure and repeat use.** On success or Stop, show the final recorded PLC/held-image state and next permitted action. Preserve partial reports, cancellation and failures. A held/faulted or uncertain state requires an explicit recorded recovery or blocked status, not a blind restart. Verify one subsequent run from a valid baseline. Preserve the established hold-last-input/bench-diagnostic behavior and running PLC scan/timers.
7. **Persistence and useful history.** Reopen the prepared project after refresh; keep each campaign linked to its project/version, spec/world/map hashes and report. Provide discoverable links for prior run reports. Files on disk and the report's manual bundle opener are useful existing mechanisms but do not constitute an integrated project/run history.
8. **Honest controls.** Current host explicitly refuses natural-language steer with “no steering channel; text not delivered to Muse,” while a Send direction control exists. Either implement acknowledged delivery at the model boundary, or clearly disable it for this release. Apply the same principle to unsupported HMI, suppression, hot-reload and connection actions. Avoid decorative controls that imply work happened.

## Existing substantial pieces

Reactive Muse-generated world, isolated raw-I/O engine, actual CODESYS Control Win connector/interceptor, native command acknowledgement, prepared normal/fault campaigns, evidence-dependent live Muse follow-up, controlled HMI operation and pixel input, and the new engineer-facing report each have preserved evidence. Their existing qualification is scoped; the newly assembled uploaded-project workflow needs its own acceptance run.

## Tonight's minimum finish gate

- A user supplies the supported conveyor spec/I/O from the app, sees genuine preparation progress, reviews the resulting world assumptions, source-linked checks and compatible M8 mapping.
- Start runs that exact approved project version. Preparation and execution use correctly labelled real/fixture/historical sources. The app shows progress, actual PLC response and HMI evidence when those checks were selected.
- Results describe expected/observed outcomes, incomplete checks and scope limits, export a readable portable report, and remain discoverable after reopening the project.
- Stop/terminal state and another valid run are verified. Unsupported controls are visibly unavailable. No manual substitution of the prepared example is hidden in this path.

Codex owns independent integration, live commissioning and demo capture; the onboarding lane owns implementation and its offline/model preparation proof. Other PLC vendors, reusable-library deployment, local model/weight training, CAD graphics and blind HMI-defect discovery remain separate extensions.
