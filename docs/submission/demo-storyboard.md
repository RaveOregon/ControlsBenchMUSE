# Demo storyboard: shot-level companion to the three-minute cut

Internal preparation document. Evidence pinned at `codex/product-integration` `9033bae` (2026-11-03 20:54 EST). Claim IDs (C-xx) refer to `claims-checklist.md`; audit findings (F-xx, CUT-xx) to `claims-audit.md`.

The working edit plan is the integrator's `docs/submission/demo-three-minute-cut.md` on `codex/product-integration` (`bb5886a`, unchanged at `9033bae`). It replaces this file's earlier nine-shot plan, which assumed W4 and S2 were pending. This file keeps the cut's seven segments and adds, for each one, the claims it may use, the exact on-screen label, the exact source files, the audited corrections, and what still has to be captured. Where the two files differ, the correction here comes from the audit.

## Rules

- **Length.** Target 2:50; the limit in the brief is three minutes. Confirm it in the signed-in form.
- **No original live footage exists.** None of the live runs was screen-recorded. Every PLC or HMI segment is a review of saved evidence and is labelled as such, with the run's UTC time. Never imply that segments come from one run.
- **Labels** go in the same lower-third position throughout. Add `WAITING TIME REMOVED` or the speed factor to any edited segment.
- **Numbers** come only from `claims-checklist.md` and from the run on screen.

## Labels

| Label | Use for |
|---|---|
| `REVIEW OF RECORDED LIVE PLC RUN · CODESYS Control Win · M8 build 8001 · <UTC time>` | Report, ledger or audit views of a live run (W4, M10) |
| `RECORDED LIVE HMI · 2026-11-03 23:21 UTC · operated by muse-wonder-1.0 (S2, pass with limitations)` | S2 screenshots |
| `RECORDED LIVE HMI · 2026-11-01 14:07 UTC · scripted clicks` | H2 screenshots |
| `RECORDED LIVE PLC RUN · 2026-11-01 00:58 UTC · replay · scripted scenarios, no model call` | `/m10-replay.html` stills |
| `MUSE-GENERATED VIEW · SIMULATED WORLD · NOT THE PLC HMI` | Any generated-view frame |
| `muse-wonder-1.0 · generated 2026-10-29 · preserved artifact` | Generated world package files |
| `GENERATED WORLD ONLY · NO PLC` | Gate A–D evidence, if used |
| `LIBRARY PROTOTYPE · COMPILED ONLY · NOT DEPLOYED`, `ROADMAP · NOT BUILT` | Only if the library or a future capability appears |

## Segments

### 1 · 0:00–0:15 · Opening

- **Picture (cut).** Generated machine view next to the actual HMI.
- **Sources.** No committed capture shows the generated view and the HMI at the same live moment (P-03). Compose two labelled sources: the promoted view still `artifacts/machine-view/2026-11-01T03-07-45-147Z-muse-wonder-1.0-refine-02/audit/a-diverted.clean.png`, or a `npm run view:preview` clip (REC-04); and an S2 frame from `vision-frames/` (choose a neutral one such as `1-current.jpg`; check its content).
- **Labels.** View label on the view; S2 HMI label on the HMI.
- **Voiceover (cut).** "Before commissioning, a controls engineer has to simulate the machine, devise tests and explain failures. ControlsBench brings Muse into that bench-testing workflow." Supported.
- **Correction (CUT-1).** Keep the two labels visible so the split screen does not read as one live moment.

### 2 · 0:15–0:35 · Specification and generated world

- **Picture.** The source spec and the preserved generated package. The app's import/review flow is in development (P-06): show it only after its acceptance checkpoint passes.
- **Sources.** `docs/conveyor-machine-spec.md` sections 2 (layout) and 4 (I/O), which are unchanged since generation; `world.ts`, `assumptions.md` and `generation.json` in `artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/`.
- **Label.** `muse-wonder-1.0 · generated 2026-10-29 · preserved artifact`.
- **Voiceover (cut).** "Muse Wonder generated this machine world from the functional specification and raw signal information: belt motion, sensors, diverts and encoder counts, with explicit assumptions." Supported (C-01).
- **Correction (CUT-6, F-20).** Sections 1, 3, 6 and 9 of the spec changed after generation (coast wording, HMI scope, R-01). Do not show them as what Muse received.

### 3 · 0:35–0:55 · The controller runs against the world

- **Picture (cut).** A short normal-sort segment from an earlier live run, showing one completion and command/feedback.
- **Sources.** `/m10-replay.html` cannot show this: it has three still states (final held, exit A, exit B), 5 of 25 signals are unknown, and the completion is not part of the view (CUT-2). Use two labelled stills instead:
  - world side: `artifacts/m10-convergence/2026-11-01T20-08-23-610Z/view/exitA.png` (carton 101 at divert 1);
  - PLC side: `docs/screenshots/hmi/live-operation-completion.jpg` (H2): M1 RUN with RUNNING feedback, D1 EXTEND with EXTENDED feedback, and the completion record "item 301 · A → Exit A · Sorted". These are different runs; label each.
- **Voiceover (cut).** "A local engine supplies raw inputs to the executing CODESYS Control Win program. The controller's outputs drive the world, which returns the resulting sensor signals." Supported (C-12, C-16).
- **Option.** The Wonder-directed normal sorts (C-23) have ledgers and reports but no committed frames.

### 4 · 0:55–1:55 · Hero: Muse's live fault test and evidence-driven follow-up

- **Picture (cut).** Drive-feedback failure, fault 12 and recovery, then the new D1-contradiction test, fault 21 and recovery, with Muse's follow-up rationale beside the PLC evidence.
- **Sources (C-22).** Report export `artifacts/bench-report/saved-exports/w4-adaptive-plc-investigation/report.html` (decision trail and follow-up fields); captures `artifacts/bench-report/captures/w4-adaptive-plc-investigation-summary.png`, `-findings.png`, `-results.png` and the PDF. Raw lineage: `wonder-exchanges.jsonl` and `campaign-audit.json` in the campaign directory named in C-22.
- **Label.** `REVIEW OF RECORDED LIVE PLC RUN · CODESYS Control Win · M8 build 8001 · 2026-11-03 13:14 UTC`.
- **Voiceover (cut).** "Muse observed the first fault and recovery, then chose a different feedback-consistency test that was absent from its initial plan. It executed that follow-up and checked the controller's response. These are actual recorded controller outputs." Supported.
- **Corrections (CUT-3).**
  - Muse injected both faults itself. Do not call the follow-up a discovery; the review calls it "a modest evidence-dependent extension, not discovery of an unknown fault".
  - Normal sorting was not part of this campaign; segment 3 must stay visibly separate.
  - The report's per-finding badge reads "Unreviewed" (the in-app engineer review). Do not narrate "reviewed" over it; the separate engineering review is a file.
  - HMI frames from this run exist only in the live lane's local capture store (ARC-01).

### 5 · 1:55–2:15 · Muse operates the HMI

- **Sources (C-25).** `vision-frames/` in the S2 campaign directory named in C-25: `2-2-action.jpg` (Start), `2-3-action.jpg` (Stop during coast), `3-current.jpg` (fault 10, drive overload, motor off), `4-2-action.jpg` (Reset, stopped). These are the exact images Muse received.
- **Label.** The S2 HMI label. The frames carry the HMI's own "LIVE PLC" badge from capture time; keep the recorded label visible over them.
- **Voiceover (cut).** "In a separate trial, Muse operated the browser HMI. It received these actual screenshots and compared them with independently observed PLC acknowledgements and state." Supported, with its limitations (CUT-4): browser HMI, not WebVisu; labelled controls; UI-04 inconclusive.

### 6 · 2:15–2:40 · The engineer's report

- **Sources (C-26).** `artifacts/bench-report/saved-exports/s2-hmi-operator-trial/report.html`; captures `s2-hmi-operator-trial-summary.png`, `-findings.png`, `-hmi-ui03.png`, `-results.png` and the PDF in `artifacts/bench-report/captures/`.
- **Label.** `REVIEW OF RECORDED LIVE PLC RUN · … · 2026-11-03 23:21 UTC`.
- **Voiceover (cut).** "The engineer gets a readable report with evidence-linked findings, screenshots, assumptions and remaining checks. Inconclusive behavior stays visible; completion is not treated as proof that every requirement passed." Supported.
- **Correction (CUT-5).** UI-03 cites one frame Muse never received. If the UI-03 panel is on screen, keep that flag visible, or show UI-01 or UI-02 instead.

### 7 · 2:40–2:50 · Close

- **Picture.** Clean app title and `[REPO URL]`, plus "Built during the Meta Global AI Developer Hackathon · see HACKATHON_WORK.md".
- **Voiceover (cut).** "From engineering information to a reactive test world, an adaptive investigation and a bench report the engineer can review." Supported as a summary of separate runs.

## Capture list

### Stills that exist (committed; no capture needed)

| ID | Segment | File | Branch |
|---|---|---|---|
| S-01 | 1 | `artifacts/machine-view/2026-11-01T03-07-45-147Z-muse-wonder-1.0-refine-02/audit/a-diverted.clean.png` | `view/m10-machine-view` |
| S-02 | 1, 5 | S2 `vision-frames/1-current.jpg`, `2-2-action.jpg`, `2-3-action.jpg`, `3-current.jpg`, `4-2-action.jpg` | `codex/product-integration` |
| S-03 | 3 | `artifacts/m10-convergence/2026-11-01T20-08-23-610Z/view/exitA.png`, `exitB.png` | `codex/product-integration` |
| S-04 | 3 | `docs/screenshots/hmi/live-operation-completion.jpg` (hash in `live-index.json`) | `hmi/m10-operator-hmi` |
| S-05 | 4 | `artifacts/bench-report/captures/w4-adaptive-plc-investigation-*.png`, `.pdf` | `codex/product-integration` |
| S-06 | 6 | `artifacts/bench-report/captures/s2-hmi-operator-trial-*.png`, `.pdf` | `codex/product-integration` |

### To record (offline; no PLC or model call)

| ID | Segment | What |
|---|---|---|
| REC-01 | 2 | Editor clip: spec sections 2 and 4, `world.ts`, `assumptions.md`, `generation.json` (model, duration) |
| REC-02 | 4 | Screen recording of the W4 report export: decision trail, follow-up rationale, fault 12 and fault 21 findings |
| REC-03 | 6 | Screen recording of the S2 report export, including the HTML export action |
| REC-04 | 1 | `npm run view:preview` clip of the generated view (optional; S-01 can replace it) |
| REC-05 | 7 | End card with the repository URL (needs the public repository) |
| REC-06 | all | Voiceover read once in full, captions and an SRT file |

### Needs another lane first

| ID | What | Owner |
|---|---|---|
| ARC-01 | HMI frames from the W4 pass run, from its local capture store under `.worktrees/w4-live-readiness/artifacts/w4-paid/2026-11-03T13-11-03-480Z/live-host/runs/2026-11-03T13-12-52-676Z-live_plc/portal-hmi/hmi-frames/`. Not committed. Archive the chosen frames with hashes before use. | Live lane |
| ARC-02 | A capture of the generated view during a live campaign (P-03). None is committed. | Live lane |
| ARC-03 | The import/review flow, only after its acceptance checkpoint (P-06) | Onboarding lane |

### Not available; do not fake

Original screen recordings of any live run; moving footage of the M10 run; HMI frames showing fault 12, 21 or 23 (unless ARC-01 archives them); a portal view of the W3 checkpoint; any frame of an HMI command in a pending state.

## Never on screen

- `.env`, the API key, or any terminal or editor showing credentials. **`.env` was the active editor tab during this audit; close it before recording.** The PLC password prompt and its contents.
- Raw JSON with absolute local paths, such as M10 `result.json` and the W4 `live-audit.json`, `timing-audit.json` and paid `result.json`. The report exports and `report.json` files checked in the audit are clean.
- The preview portal: its header reads "LIVE host · fake connector".
- `artifacts/wonder-verification/…/portal/recorded-review.png` presented as the W3 checkpoint; it shows the offline fixture provider.
- UI-03's extra screenshot citation presented as valid.
- The HMI's own "LIVE PLC" badge without the recorded label.
- Browser profiles, bookmarks, email addresses and notifications.
- Any number not in the claims checklist, or a number from a different run than the one on screen.
