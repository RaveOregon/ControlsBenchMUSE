# Three-minute demo storyboard

Internal preparation document. Status snapshot: 2026-11-01 19:12 EST (2026-11-02 00:12 UTC). W3 is partial; W4 is pending. Claim IDs (C-xx, P-xx) refer to `claims-checklist.md`.

## Goals and limits

- **Length.** Target 2:50 of picture, leaving 10 seconds under the three-minute limit given in the brief. Confirm the limit in the signed-in form.
- **Narration.** About 395 words, roughly 150 words per minute. Read it in the builder's voice. **[BUILDER]** adjust the wording, but keep every factual claim inside its claim row.
- **Rubric order.** Impact first (shot 1), then Meta tooling (shots 2, 3, 7), technical depth (shots 4–6), and a working demo throughout.
- **Rule.** Every shot that is not live footage gets a visible label. Use the labels in [Labels](#labels).
- **W4 slots.** Shots marked `W4 SLOT` have a reserved place for the W4 run. Fill a slot only from the audited W4 run directory, and only if the audit passes that slot's obligation. Until then, cut the ready fallback into the edit. Never fill a slot with a preview, a fixture, the W3 recording, an unaudited attempt or a mock-up.

## Labels

Put these as a lower-third on every shot they apply to, in the same position and style throughout.

| Label | Use when |
|---|---|
| `LIVE · CODESYS Control Win · M8 build 8001` | Screen-recorded during a live run, for example the W4 campaign. Add `· muse-wonder-1.0` when the model directs that run. |
| `RECORDED LIVE PLC RUN · <UTC time> · replay` | Replaying saved evidence from a live run, for example the M10 run on the read-only replay page |
| `RECORDED LIVE PLC EVIDENCE · real muse-wonder-1.0 calls · no new PLC run` | The W3 checkpoint: real model calls reasoning over the recorded M10 run |
| `GENERATED WORLD ONLY · NO PLC` | Gate A–D evidence |
| `MUSE-GENERATED VIEW · SIMULATED WORLD · NOT THE PLC HMI` | Any frame that shows the generated machine view |
| `PREVIEW · fake connector · HMI fixture · no PLC` | The integrated application's default preview. Use only to orient the viewer in the UI, never as evidence for a claim. |

Add `2× SPEED` (or the actual factor) to any sped-up segment.

## Shot list

**READY** means the footage can be captured now from committed work. **W4 SLOT** means the shot is reserved for W4 evidence; its fallback is READY and is what the edit uses until the slot is filled.

| # | Time | Shot | Status |
|---|---|---|---|
| 1 | 0:00–0:12 | Cold open: the real controller and the portal | W4 SLOT `[W4-01]`; fallback READY |
| 2 | 0:12–0:30 | Spec in, Muse writes the world | READY |
| 3 | 0:30–0:44 | Muse draws the machine view and corrects it from screenshots | READY |
| 4 | 0:44–0:58 | The controller and the raw I/O boundary | CODESYS part READY; portal identity W4 SLOT `[W4-02]`; fallback READY |
| 5 | 0:58–1:30 | Live loop: normal operation, stop and coast | W4 SLOT `[W4-03]`; fallback READY |
| 6 | 1:30–1:44 | Fault case | W4 SLOT `[W4-04]`; fallback READY |
| 7 | 1:44–2:18 | Muse runs the investigation | W4 SLOT `[W4-05]`; W3 version READY; generated-world version READY |
| 8 | 2:18–2:32 | The actual operator HMI | W4 SLOT `[W4-06]`; fallback READY |
| 9 | 2:32–2:50 | Evidence report and close | W4 SLOT `[W4-07]`; W3 and M10 versions READY |

## W4 slot register

Each slot names what the shot must show, what must be true in the W4 audit before the slot may be used, and which numbers come from the run. `[W4 RUN DIR]` is the audited run directory named in Lane D's handoff. Do not guess file names inside it; take them from that handoff.

| Slot | Shot | Shows | Use only if the W4 audit shows | Numbers and text to take from the run | If not met |
|---|---|---|---|---|---|
| `[W4-01]` | 1 | CODESYS online with `conveyordemo` in RUN beside the production portal during the W4 campaign, with the generated view moving | The campaign was started from the production portal's Start Campaign; runtime ownership and source identities recorded | UTC start time; build/interface identity as recorded | Shot 1 fallback |
| `[W4-02]` | 4 | Portal header or Setup panel with the live connector identity, simulation selected, and security mode | Identities in the run match the portal frame | Connector name, build, interface, security mode, as recorded | Shot 4 fallback |
| `[W4-03]` | 5 | The normal-operation part of the W4 campaign, with PLC completions appearing as they are acknowledged | Normal operation passed; raw commits and acknowledgements coherent | Each completion's item, route and disposition; coast counts, if a Stop is shown; effective rate, if quoted | Shot 5 fallback |
| `[W4-04]` | 6 | The W4 fault case: the commanded actuator not reaching its limit, the PLC fault, no false completion | The fault case passed and its injected truth was recorded before the run | Fault code and text; completion record | Shot 6 fallback |
| `[W4-05]` | 7 | Muse reasoning, then a new investigation that cites PLC outputs it just received, then its result and finding | The adjudication marks at least one investigation as **new and evidence-prompted**, not preselected; native response/tool-result lineage valid | Response ID(s); the cited `plc.output` IDs; the follow-up's stated rationale; finding text; per-request and campaign caps; conservative and estimated usage | Shot 7 W3 version, then generated-world version |
| `[W4-06]` | 8 | The actual HMI tile from the **same** capture session, with a command pending then acknowledged, frame time and age visible | HMI frames and command outcomes are on the same hosted ledger as the PLC acknowledgements | Session identity, frame times, command outcome | Shot 8 fallback |
| `[W4-07]` | 9 | The W4 report and its independent audit summary | Audit complete; overall pass, or the partial obligations named on screen | Per-obligation result; acknowledged-image count; audit check count; final observed PLC state | W3 report, then M10 report |

A partial W4 may fill only the slots whose own obligation passed. Show its other parts with their fallbacks, and say on screen which W4 obligation did not pass.

## Shots

### Shot 1 · 0:00–0:12 · Cold open

- **Screen.** Split 50/50. Left: CODESYS Development System online to the local Control Win target, with `conveyordemo` in RUN. Right: the portal Campaign view with the generated machine view moving. Title overlay: "ControlsBench Muse".
- **Narration (≈30 words).** "This is a real CODESYS controller running a conveyor program. Everything it senses comes from a machine that Meta's Muse Wonder wrote from a spec. This is ControlsBench Muse."
- **Claims.** C-12; P-01 for the live portal half.
- **Status.** W4 SLOT `[W4-01]`. **Fallback, READY:** left, the CODESYS project tree for `conveyordemo.project`; right, the read-only replay page of the recorded M10 run (`/m10-replay.html` on the product launcher, `http://127.0.0.1:5190/m10-replay.html`; check it loads before capture), labeled `RECORDED LIVE PLC RUN · 2026-11-01 00:58 UTC · replay`. Change the narration to "ran against a real CODESYS controller".

### Shot 2 · 0:12–0:30 · Spec in, Muse writes the world

- **Screen, in order.**
  1. `docs/conveyor-machine-spec.md`, section 2 layout diagram, then the section 4 I/O table, scrolled slowly (5 s).
  2. `artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts` at the carton-motion and divert-position code (5 s).
  3. `assumptions.md` from the same folder (3 s).
  4. `generation.json` with `"model": "muse-wonder-1.0"` and `durationMs: 102105` highlighted (3 s).
- **Overlay.** `muse-wonder-1.0 · generated 2026-10-29 · preserved artifact`
- **Narration (≈45 words).** "I give it what a controls engineer has: a functional spec and the raw I/O list. Muse Wonder wrote the world in TypeScript: belt, cartons, photoeyes, divert travel and raw encoder counts. It wrote down its assumptions and its own tests. ControlsBench checked them independently."
- **Claims.** C-01, C-02.
- **Status.** READY.

### Shot 3 · 0:30–0:44 · Muse draws the view and corrects it

- **Screen, in order.** All files are under `artifacts/machine-view/` on the view branch.
  1. `2026-11-01T02-31-53-148Z-muse-wonder-1.0/audit/a-diverted.png`: the first view, annotated with overlapping labels (3 s).
  2. `2026-11-01T02-50-31-845Z-muse-wonder-1.0-refine-01/audit/divert1-extended.png`: labels fixed, but the extended paddle cuts through the carton (3 s).
  3. `2026-11-01T03-07-45-147Z-muse-wonder-1.0-refine-02/audit/divert1-extended.png`: the promoted view, clean (2 s).
  4. `npm run view:preview` playing a routed-A replay (6 s).
- **Overlay.** `MUSE-GENERATED VIEW · SIMULATED WORLD · NOT THE PLC HMI`, plus `GENERATED WORLD ONLY · NO PLC` on the replay.
- **Narration (≈35 words).** "Muse also drew the machine view. Then it looked at screenshots of its own drawing, fixed overlapping labels, and moved the divert paddles out of the carton's path. The view only displays recorded state."
- **Claims.** C-14.
- **Status.** READY.

### Shot 4 · 0:44–0:58 · The controller and the raw I/O boundary

- **Screen, in order.**
  1. CODESYS editor on the interceptor and bench GVL in `codesys/demo/source/` (5 s).
  2. The portal header or Setup panel with the live connector identity (9 s).
- **Overlay.** `Hardware passthrough is the default; simulation is selected deliberately`
- **Narration (≈35 words).** "The controller program is the system under test. An interceptor at the raw I/O image takes simulated inputs. The workstation sends complete input images over authenticated OPC UA, at most ten times a second, and reads back the real outputs."
- **Claims.** C-08, C-10, C-12.
- **Status.** CODESYS part READY. Portal part W4 SLOT `[W4-02]`. **Fallback, READY:** the M10 `precheck.json` identity values (`M8 build 8001 · interface 1`, connector `m8-opcua`, `Basic256Sha256 / SignAndEncrypt`), labeled with the M10 replay label.
- **Do not** use the preview-mode portal header here; it reads as a fake connector.

### Shot 5 · 0:58–1:30 · Live loop: normal operation, stop and coast

- **Screen.** Portal Live view at 1920×1080. Machine view in the center, actual HMI tile on the right, activity text and ledger timeline at the bottom. Hold on each PLC completion as it appears. During a Stop, zoom on the encoder count still rising while the motor command is off, then holding.
- **Overlay.** The live label for `[W4-03]`, or the replay label for the fallback.
- **Narration, fallback (≈70 words).** "Here the generated world ran against the live controller. A carton assigned to A diverts at D1. B passes D1 and diverts at D2. An unassigned carton runs out, which is normal. An A carton that reaches runout is a misroute, and the controller reports it as one. On Stop the PLC drops the motor command. The belt coasts 116 encoder counts, then holds still."
- **Narration, W4.** Write it from the W4 ledger: `[W4: completions shown, in order]`, `[W4: coast counts, if a Stop is shown]`. Use no number from M10 over W4 footage.
- **Claims.** C-12 for the fallback; P-01 for W4.
- **Status.** W4 SLOT `[W4-03]`. **Fallback, READY:** the read-only replay page of the recorded M10 run, labeled as a replay. Completions there: `item 101 · A · Sorted`, `item 102 · B · Sorted`, `item 0 · Runout · RunoutUnassigned`, `item 103 · Runout · Misrouted`. The 116-count figure belongs to that run.

### Shot 6 · 1:30–1:44 · Fault case

- **Screen.** The divert paddle stays home while its command is on. The HMI tile's fault strip shows the fault. The ledger shows the faulted completion and no exit count.
- **Overlay.** `Injected fault · truth recorded before the run`
- **Narration, fallback (≈30 words).** "Next, a jammed divert. The controller commands D1, never sees it extend, raises fault 23 and stops the motor. The carton is recorded as faulted. No false sort is counted."
- **Narration, W4.** From the W4 run: `[W4: fault injected, fault code and text, completion record]`.
- **Claims.** C-12 for the fallback; P-01 for W4.
- **Status.** W4 SLOT `[W4-04]`. **Fallback, READY:** the failed-divert scenario on the replay page.

### Shot 7 · 1:44–2:18 · Muse runs the investigation

This is the main Meta-model shot. Three versions are scripted. Use the first one whose status allows it.

**Version A: W4 live, `[W4-05]`.**
- **Screen.** Activity text shows `Muse is reasoning · <elapsed>`. A decision card follows with the response ID, the hypothesis and the cited `plc.output` IDs. A new investigation appears in the plan and runs. The resulting finding shows evidence links and confidence. Keep the budget meter visible.
- **Overlay.** `LIVE · CODESYS Control Win · M8 build 8001 · muse-wonder-1.0`
- **Narration (≈70 words), written from the W4 ledger.** Skeleton: "Now Muse runs the campaign. It reads the PLC's outputs, `[W4: what it noticed]`, and adds its own investigation: `[W4: follow-up rationale, citing the observed outputs]`. ControlsBench validates every tool call before it touches the bench. A finding must cite the exact PLC outputs it relies on. Muse works inside hard limits: `[W4: per-request cap]` per request, `[W4: campaign cap]` per campaign, and no silent retries."
- **Claims.** P-01 only after its audit.
- **Status.** W4 SLOT. Empty until the audit marks an evidence-prompted investigation as passed.

**Version W3: recorded live PLC evidence, real model calls. READY.**
- **Screen, in order.** All on `codex/wonder-campaign`, under `artifacts/wonder/checkpoint-2026-11-01T22-14-56-275Z/`.
  1. `wonder-exchanges.jsonl` or `assessment.json`, highlighting the three response IDs and the three `inspect_evidence_window` calls in turn 1 (8 s).
  2. `report.json`, finding `finding-d1-timeout-201`: D1 commanded for item 201 in Auto, later fault 23 with motor and D1 commands off (10 s).
  3. The finding's cited `plc.output` records in `campaign.jsonl` (6 s).
  4. `report.json` assumptions: recorded, not live; source quality unknown (5 s).
  5. Optional: `artifacts/wonder-verification/2026-11-01T22-28-48-134Z/portal/recorded-review.png`, the portal showing the replayed checkpoint offline, with the extra label `offline replay · no new model call` (5 s).
- **Overlay.** `RECORDED LIVE PLC EVIDENCE · real muse-wonder-1.0 calls · no new PLC run`
- **Narration (≈70 words).** "Here Muse Wonder works from a recording of the live controller run. In its first response it planned two experiments and chose three windows of PLC evidence to inspect. ControlsBench returned the exact recorded outputs. Muse wrote two findings, and all 30 PLC values they cite match the record. It kept what it could not know, such as signal quality. It did not add a new experiment after seeing the results. That is the live step still ahead."
- **Claims.** C-20, C-18.
- **Never** call this live operation, an adaptive follow-up or a new test of the controller.

**Version B: generated world. READY.**
- **Screen.** Portal replay of the Gate C evidence, or the JSON files shown in order: `gate-c/hidden-truth-commitment.json`, `final-sealed-diagnosis.json`, `followup-observations.json`, `truth-reveal.json`.
- **Overlay.** `GENERATED WORLD ONLY · NO PLC · recorded 2026-10-29`
- **Narration (≈70 words).** "Against the generated world, without the PLC, the fault was hidden from Muse, and its answer was sealed before the truth was revealed. Muse found the entry sensor but refused to name a cause from one trace. It designed its own belt-motion experiment and raised its confidence from 0.35 to 0.78. Running that kind of follow-up against the live controller is the next step."
- **Claims.** C-03, C-04.
- **Edit note.** If W4 does not fill `[W4-05]`, version W3 and a shortened version B can share the 34 seconds: W3 shows real calls over real PLC evidence, and B shows the model-chosen follow-up, each with its own label.

### Shot 8 · 2:18–2:32 · The actual operator HMI

- **Screen.** The HMI tile expanded over the portal, on the Operation page. The fault strip is visible. A command goes to `pending`, then `applied` from the PLC acknowledgement. Show the frame time, the frame age and the session identity.
- **Overlay.** `ACTUAL HMI SESSION · captured frames` plus the live or recorded label.
- **Narration (≈35 words).** "This is the actual operator HMI, a browser page connected to the same PLC. Reset stays pending until the controller acknowledges it. The click, the screen frame and the PLC acknowledgement are stored as separate evidence."
- **Claims.** C-16 for the fallback; P-04 or P-01 for the hosted version.
- **Status.** W4 SLOT `[W4-06]`. **Fallback, READY:** a timed sequence of H2 frames from `docs/screenshots/hmi/live-index.json` on the HMI branch: `live-operation-fault`, `live-operation-reset-rejected`, `live-operation-completion`. Label them `RECORDED LIVE HMI RUN · 2026-11-01 · scripted clicks`.
- **Stretch.** Only if S2 passes after W4: Muse presses a command itself, and the four separate records (requested, delivered, frame, PLC acknowledgement) are shown.

### Shot 9 · 2:32–2:50 · Evidence report and close

- **Screen.**
  1. The Results view or `report.json`, with its sections for injected truth, observed PLC evidence, inference and uncertainty (8 s).
  2. The audit summary of the run actually shown (4 s).
  3. End card: `[REPO URL]`, "Built during the Meta Global AI Developer Hackathon · see HACKATHON_WORK.md" (6 s).
- **Narration (≈45 words).** "The report keeps what was injected, what the PLC did, what Muse inferred and what is still uncertain apart. Each line links to the raw trace. Everything shown, apart from the CODESYS tools, was built during the hackathon. The code and evidence are in the repository."
- **Claims.** C-18, plus C-12, C-20 or P-01 for the report shown.
- **Status.** W4 SLOT `[W4-07]`. **Fallbacks, READY:** the W3 `report.json` (label: recorded live PLC evidence), or the M10 report with `10/10 checks · 302 acknowledged images` (label: replay).

## Capture plan

Kiro does not own runtime or live sessions. Lane D is the single live owner for W4. Never reset unexplained PLC state to make a shot work.

1. **Before W4.** Agree with Lane D how the W4 campaign is screen-recorded: OBS at 1920×1080 and 30 fps on the production portal, started before Start Campaign. The run's own timing evidence decides whether timing held; a late step stays late in the edit.
2. **W4 session (Lane D).** One continuous take covers slots `[W4-01]` to `[W4-07]`. Keep the raw recording beside the run directory. Paid generation starts only after Lane D has the new spend and data-transfer authorization.
3. **After the W4 audit.** Fill each slot whose obligation passed. Take every number from that run's audit and ledger. Update `claims-checklist.md` with a new completed row before any W4 narration is final.
4. **B-roll, any time.** Shots 2, 3, the W3 and generated-world versions of shot 7, shot 9 fallbacks, and every other fallback.
5. **Edit.** Lay narration over picture. Add labels and burned-in captions, and export an SRT. Use no music unless it is licensed for this use.
6. **Publish.** Upload to the host the form accepts. Open the link in a signed-out browser and play it to the end.

## Never on screen

- `.env`, the API key, or any terminal or editor showing credentials. **`.env` was the active editor tab while this storyboard was revised; close it before recording.**
- The password prompt contents, browser profiles, bookmarks, email addresses and notifications.
- The preview-mode portal, the HMI fixture or the stand-in capture page presented as live.
- The W3 recording presented as a live run or as an adaptive follow-up.
- A portal header reading `fake connector` next to footage described as a live campaign.
- A mock-up or reconstructed screenshot in a W4 slot.
- Any number not in the claims checklist, or a number from a different run than the one on screen.
