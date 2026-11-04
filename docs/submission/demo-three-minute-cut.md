# Three-minute submission cut — working edit plan

Target2:50; leave10seconds below the supplied3-minute limit. Use edited screen recordings with voiceover. Cut reasoning/loading waits; add a short “waiting time removed” or speed label when applicable. Keep source labels visible: recorded live CODESYS Control Win evidence, generated-world-only evidence, or fixture preview. A recreated playback of saved results must be labelled as a review/replay, not original live footage.

This replaces the older Kiro storyboard's W4/S2-pending sections. W4 and the scoped S2 proof now exist; app onboarding remains in development. The opening upload/preparation footage is conditional on its genuine acceptance checkpoint. Record the rest while that lane finishes. Do not imply all clips come from one campaign.

| Time | Picture | Voiceover / purpose |
| --- | --- | --- |
|0:00–0:15|Generated machine view next to the actual HMI. Title: ControlsBench Muse.|“Before commissioning, a controls engineer has to simulate the machine, devise tests and explain failures. ControlsBench brings Muse into that bench-testing workflow.”|
|0:15–0:35|Specification/I/O and generation result. Use the new import/review flow only after it genuinely works; otherwise show the source specification and preserved generated package with a preparation label.|“Muse Wonder generated this machine world from the functional specification and raw signal information: belt motion, sensors, diverts and encoder counts, with explicit assumptions.”|
|0:35–0:55|A short recorded normal-sort segment, separately labelled earlier live controller test. Show one meaningful completion and command/feedback.|“A local engine supplies raw inputs to the executing CODESYS Control Win program. The controller's outputs drive the world, which returns the resulting sensor signals.”|
|0:55–1:55|Hero sequence: W4 drive-feedback failure, fault12/recovery, then new D1 contradiction investigation and fault21/recovery. Put Muse's actual follow-up rationale next to the resulting PLC evidence. Remove generation waits.|“Muse observed the first fault and recovery, then chose a different feedback-consistency test that was absent from its initial plan. It executed that follow-up and checked the controller's response. These are actual recorded controller outputs.”|
|1:55–2:15|Separate S2 HMI trial: Start/Stop result frames, Fault10 banner and Reset result.|“In a separate trial, Muse operated the browser HMI. It received these actual screenshots and compared them with independently observed PLC acknowledgements and state.”|
|2:15–2:40|Engineer report: summary, one finding, UI-03 screenshot/evidence panel, visible inconclusive check, HTML export.|“The engineer gets a readable report with evidence-linked findings, screenshots, assumptions and remaining checks. Inconclusive behavior stays visible; completion is not treated as proof that every requirement passed.”|
|2:40–2:50|Clean app/title, project/repository link.|“From engineering information to a reactive test world, an adaptive investigation and a bench report the engineer can review.”|

## Actual evidence for the cuts

- **Normal operation:** `artifacts/m10/2026-11-01T00-58-43-185Z/`; read `docs/m10-live-integration.md`. `/m10-replay.html` re-presents those historical measurements. Do not call a newly recorded replay a fresh PLC run.
- **Adaptive investigation:** campaign `portal-20261103131442735-1`; `docs/w4-live-proof.md` and `artifacts/bench-report/saved-exports/w4-adaptive-plc-investigation/report.html`. The report's model decision trail and evidence-dependent follow-up fields are suitable for a recorded-evidence review when original video footage is unavailable. A fresh live recreation must be separately qualified and labelled as a new run.
- **HMI operation:** campaign `portal-20261103232137992-1`; exact images under its S2 `vision-frames/`. Useful preserved frames: `2-2-action.jpg` (Start), `2-3-action.jpg` (Stop/coast), `3-current.jpg` (overload/F10), `4-2-action.jpg` (Reset/stopped).
- **Report:** `artifacts/bench-report/saved-exports/s2-hmi-operator-trial/report.html`; a shareable PDF also exists under `artifacts/bench-report/captures/s2-hmi-operator-trial.pdf`. These are historical S2 reports, not the normal-sort or W4 campaign.

The local Node-served HMI is not native CODESYS WebVisu. CODESYS Control Win executes the PLC application; no physical PLC CPU or machinery is claimed. S2 UI-04 stale/disconnect remains inconclusive and one extra image citation was invalid; keep the report's limitations visible. No need to narrate every audit detail.

## Capture and edit order tonight

1. Record the report and exact HMI frames now; their source evidence is frozen.
2. Record the short normal-operation playback and W4 evidence/decision review, each with its own source label.
3. Capture newly qualified upload/preparation/review once onboarding passes; otherwise retain the honest separate-preparation shot.
4. Record voiceover separately. Read the script aloud once; trim words rather than rushing the explanation.
5. Assemble and verify runtime below3minutes, readable zooms, audible voice, correct source labels and an accessible uploaded video link.

Keep detailed architecture, transport benchmarks, reusable-library internals and future roadmap in the repository. The video shows the engineer's problem, Muse's active contribution, observed controller/HMI results and the report.
