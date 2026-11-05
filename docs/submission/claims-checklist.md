# Evidence and claims checklist

Internal preparation document. Review it, or remove it, before the repository is made public.

**Snapshot: evidence pinned at `codex/product-integration` `9033bae` (2026-11-03 20:54 EST).** W3 is **partial**. W4 has **passed in a scoped form** (C-22). S2, Muse operating the HMI, has **passed with limitations** (C-25). The audit behind this version is `claims-audit.md`. Lanes were still committing at the snapshot; re-run the refresh commands at the end before relying on any row.

## Rules for every submission text, README line and narration line

1. A statement may appear only if it maps to a **Completed** row below and stays inside that row's boundary.
2. **Pending** work may be described only as in progress or as a goal.
3. Anything in [Not claimed](#not-claimed) must not appear in any form, including the video.
4. Every on-screen recording or replay of earlier evidence carries a visible label with its evidence class and the run's UTC time. The label texts are in `demo-storyboard.md`.
5. Never imply that clips from different runs are one run, or that a review of saved evidence is new live footage.

## Evidence classes

| Class | What belongs here |
|---|---|
| **Live PLC** | Recorded during a run on the CODESYS Control Win soft PLC (Windows, no physical I/O): M0–M8, M10, H1–H3, W4 commissioning, the W4 and S2 campaigns |
| **Live PLC with real model calls** | The live campaign also had real `muse-wonder-1.0` decisions: W4 (C-22, C-23), S2 (C-25) |
| **Recorded live PLC evidence, real model calls** | Real model responses about a recorded live run, with no new PLC activity: W3 (C-20) |
| **Generated world only** | Muse outputs checked against the generated world or by offline audits, no PLC: Gates A–D, machine-view generation |
| **Offline fixture** | Fake connector, fixture provider or recorded HMI fixture; offline tests and browser checks: M9, the integrated preview, convergence and QA gates, report exports |
| **Library compilation** | CODESYS library compiled offline, never executed: `ControlsBench Core` 0.1.0.0 and 0.2.0.0 |
| **Pending or future** | Not run or not built: see [Pending](#pending) and [Not claimed](#not-claimed) |

## Where the evidence lives

| Lane | Branch | Tip at snapshot | State |
|---|---|---|---|
| Shared base | `main`, tag `m10-base` | `fa8d2ee` | Gates A–D, M0–M9, M8, replay portal. Nothing later is merged to `main`. |
| M10 live integration | `codex/m10-live-integration` | `3ab99ff` | Live six-scenario run; audit 10/10 |
| Machine view | `view/m10-machine-view` | `042cc6a` | Package valid; final audit clean |
| Operator HMI | `hmi/m10-operator-hmi` | `8e9d325` | Live H1–H3; three H2 runs re-audit 13/13 |
| Wonder campaign (W3) | `codex/wonder-campaign` | `91c868d` | W3 partial |
| Independent reviews | `codex/m10-convergence` | `de0a796` | Review of the W3 checkpoint |
| W4 lanes A–C | `codex/w4-process-adapter`, `codex/w4-convergence`, `codex/w4-product-qa` | `85da842`, `80a8019`, `7dcae34` | Offline adapter, integration and QA signoff |
| W4 live | `codex/w4-live-readiness` | `49d2c99` | Two zero-model commissioning passes; partial trials; scoped W4 pass |
| S2 HMI operation | `codex/s2-hmi` | `544adcd` | Pass with limitations |
| Bench report | `codex/bench-report` | `df8908c` | Engineer-facing report and saved exports |
| Product integration | `codex/product-integration` | `9033bae` | Contains every lane above except the W3 review (`de0a796`), the final QA signoff note (`7dcae34`), onboarding and the library. Also holds the integrator's three-minute cut and the submission diagrams. |
| Onboarding | `codex/spec-onboarding`, `codex/onboarding-review` | `fd59a1e`, `cb635a6` | In development; "live use pending". Not claimed. |
| Interceptor library | `codex/plc-library` | `2b404aa` | Prototype 0.2.0.0 compiled offline; not deployed |
| Submission docs | `docs/hackathon-submission` | this commit | Documents only |

Paths below are paths on the listed branch. Most are also on `codex/product-integration`; the exceptions are named in the table.

## Completed claims

| ID | Allowed claim | Evidence | Boundary: must say or must not imply |
|---|---|---|---|
| C-01 | Muse Wonder 1.0 wrote the conveyor world from the spec: TypeScript behavior, a manifest, stated assumptions and 8 tests. Two of its repair responses were accepted (a compile fix in its own tests and a rewritten manifest). Two were rejected: an invalid placeholder, and a rewrite that would have removed the belt's coast, rejected after the engineer confirmed a real belt decelerates. The behavior code stayed as first generated. | `artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/generation.json` (102.1 s; 8,066 input / 17,287 output tokens; `repairAttempts` 1–4), `gate-a-result.json` | Generated once, on 2026-10-29. Do not imply it was generated live in the video. Repair 3's recorded diagnosis text is not meaningful; describe that repair by its effect only. The spec changed after generation; sections 2 and 4 (layout, I/O) are unchanged. |
| C-02 | Independent checks CP-0 to CP-7 passed on the generated world with no further model call: startup, drive causality, raw encoder, carton geometry, sensors, coast and hold, A/B/runout routing, sensor/drive/divert faults and recovery. | `gate-a-result.json`, `gate-b-result.json` | Generated world only, no PLC. |
| C-03 | In a blind test, the fault truth was committed before the diagnosis call. Muse localized the entry sensor, proposed stuck-high, and declined to name a cause because a physically held carton could not be ruled out. | `gate-c/hidden-truth-commitment.json`, `final-sealed-diagnosis.json`, `truth-reveal.json` | Generated world only. Do not say Muse "diagnosed the fault". |
| C-04 | Muse then designed and ran its own belt-motion follow-up experiment. Its confidence went from 0.35 to 0.78. | `gate-c-result.json` (CP-9) | Generated world only, no PLC. The live counterpart is C-22. |
| C-05 | A world revision was compiled, shadow-checked and activated while the incumbent ran. A deliberately failing successor rolled back. | `gate-c-result.json` (CP-10) | Generated world only. |
| C-06 | Budget and stall guards: request timeout, repair and campaign cost stops, heartbeat stall detection, legitimate waits. | `gate-c-result.json` (CP-11), `src/proof/budget-guard.ts` | Offline. |
| C-07 | A deterministic audit checked 3,802 preserved events with 12 checks and disclosed six warnings. Muse reviewed the connector plan adversarially; its first verdict was rejected as unsupported, and the retry's four findings were incorporated. | `gate-d-result.json`, `gate-d/` | Surrogate and contract evidence. |
| C-08 | Authenticated OPC UA (Basic256Sha256, SignAndEncrypt) to CODESYS Control Win with coherent double-buffered images: 10,000 images with no torn image applied (M2). 10 Hz passed, 6,000/6,000 images over ten minutes; 20 Hz and 50 Hz failed (M3). Output observation passed (M4). On link loss the PLC held the last image and recovered only on a complete commit (M5). At 10 Hz, p99 scan interval was 21.250 ms against a 21.180 ms baseline (M6). | `codesys/README.md`, `codesys/artifacts/m2-opcua-result.json` … `m6-hackathon-result.json` (M6 values stored in µs), `src/live/m8-native-transport.ts` | Measurement fixture project. Reduced M6 scope, 10 Hz only. Not scan-synchronous. |
| C-09 | First live closed loop: the generated world against a running PLC. Motor started, carton arrived, photoeye cleared, motor stopped, the belt coasted 56 counts and held. 88 acknowledged images; p99 acknowledgement 34.031 ms; audit 12 checks. | `docs/m7-live-run.md`, `artifacts/m7/` | Measurement program, not the conveyor controller. |
| C-10 | The M8 conveyor controller (build 8001, interface 1) passed methodical live tests: modes and Start/Stop/Reset; A, B and runout routing; misroute; failed divert; WCS handshake. 104 acknowledged images; audits of 9 and 7 checks. | `codesys/demo/RESULTS.md`, `codesys/demo/evidence/` | Step-by-step raw I/O, not a continuous world. One carton at a time. |
| C-11 | Campaign runtime with an append-only, hash-chained ledger; bounded tools; budgets; pause, stop, reset and exit semantics; an adaptive follow-up loop. M9-A to M9-E passed. | `docs/m9-campaign-runtime.md`, `src/campaign/ledger.ts` | Fake provider and connector. The M9 follow-up was a deterministic stub. |
| C-12 | The Muse-generated world and the campaign runtime ran six scenarios against the live M8 controller: A sort (item 101), B sort (102), unassigned runout (item 0), assigned-runout misroute (103), Stop with 116 encoder counts of simulated coast then a stationary hold, and a failed divert (item 201, fault 23, motor off, no false sort). 302/302 coherent acknowledged images; independent audit 10/10. | `artifacts/m10/2026-11-01T00-58-43-185Z/` (`audit.json`, `report.json`), `docs/m10-live-integration.md` | Fixed experiment script; zero model calls; its findings are scripted oracle checks. Effective rate 6.52 Hz under a 10 Hz ceiling. No HMI in this run. `/m10-replay.html` shows three still states of it (final held state, exit A, exit B) with 5 of 25 signals unknown; there is no moving footage. The coast is the generated world's physics. |
| C-13 | The portal shows the campaign ledger verbatim after hash-chain checks. Commands count as applied only after the ledger events they cite. | `docs/m10-portal-host.md` | Verified with a fake connector and a stand-in page. |
| C-14 | Muse Wonder drew the machine view (SVG plus bindings) in three bounded calls. The first passed contract validation; a presentation audit then found overlapping labels. Each of two refinement calls sent four screenshots of the rendered view as image input; Wonder fixed the labels and redesigned the divert paddles. The final presentation audit found 0 errors and 0 warnings. | `artifacts/machine-view/` (three generation directories; each refinement `generation/request.json` has four images), `docs/m10-machine-view.md` | Shows simulated world truth and observed PLC outputs, not the PLC HMI, with no controls. Accounted cost $3.50 as conservative reservations, about $2.32 at published rates; neither is a billing record. |
| C-15 | The portal hosts campaigns and mounts the Muse-generated view on campaign evidence; a read-only page shows the recorded M10 run with the view. | `docs/m10-convergence.md` | Offline at the time. Counts superseded by C-21. |
| C-16 | A browser operator HMI for the M8 controller ran live with scripted clicks. Start, Stop, Auto and Reset were applied or rejected from PLC acknowledgements; Start with Auto off was rejected. An injected overload raised fault 10; Reset was rejected while the overload was active, then applied without restarting the machine. Item 301 was sorted to exit A. Three H2 runs, each re-audited 13/13. | `docs/m10-operator-hmi.md`, `artifacts/hmi/h2/`, `docs/screenshots/hmi/live-index.json` | Scripted trusted clicks, not Muse and not a person. The frames show Reset rejected and then applied; no frame shows a pending state. `live-operation-completion.jpg` shows the machine back in Auto with the next item-301 carton in transit; the completion it lists happened before the fault. The local browser HMI is not CODESYS WebVisu. |
| C-17 | Wonder was chosen over Spark 1.3 after both received the same spec. Wonder covered 23/23 requirements with experiments; Spark covered 21/23 and was faster and about a fifth of the estimated cost. | `docs/model-selection.md`, `artifacts/model-spikes/` | One spec. Costs are estimates. |
| C-18 | Reports keep injected truth, observed PLC outputs, model inference and uncertainty apart. A finding must cite exact PLC output records. | `src/campaign/`, the M10, W3, W4 and S2 `report.json` files | A finding is an observation, not a requirement verdict. |
| C-19 | A reusable CODESYS interceptor library, prototype 0.2.0.0, compiles with zero errors and zero warnings, with a consumer library and a two-domain consumer application. A copy converted to native CODESYS File-Based Storage reopens with source identical to Git, compiles, and rebuilds both consumers. | `codex/plc-library` `2b404aa`: `codesys/library/builds/prototype-0.2.0.0/result.json`, `CAPABILITIES.md` | **Compiled only.** Its 46-case conformance harness has not run on a PLC. Not deployed, not used by the demo, not wire-compatible with M8. Not merged into the integration branch. |
| C-20 | **W3, partial.** Three real Muse Wonder responses reviewed the recorded M10 run: a two-experiment plan, three evidence-window inspections chosen in the first response, two findings whose 30 PLC values all match the recorded outputs, and a finished campaign. | `codex/wonder-campaign`: `docs/wonder-w3-checkpoint.md`, `artifacts/wonder/checkpoint-2026-11-01T22-14-56-275Z/`; review `de0a796:docs/wonder-review-7e7c3fb.md` | Recorded data; no new PLC run. No follow-up after results. No portal capture of this checkpoint exists: `artifacts/wonder-verification/…/portal/recorded-review.png` shows the offline fixture provider. Superseded in the video by C-22. |
| C-21 | **One integrated application.** One launcher serves the portal, the Muse-generated view and captured browser-HMI frames; opening it does not start a campaign. Offline gates: 155/155 runtime, 51/51 UI and 13/13 browser checks at `de89a87`; 189/189 runtime and 51/51 UI at `e3469af`. | `docs/product-integration.md`, `docs/w4-live-readiness.md`, `artifacts/m10-convergence/`, `artifacts/w4-convergence/` | Fixture class for the preview. Later full suites were not green in one run: 231/233 at the S2 validation and 237/238 at the bench report, each failure passing on an isolated rerun. Never say "all tests pass". |
| C-22 | **W4, passed in a scoped form.** In one live campaign, Muse Wonder planned and ran a drive-feedback-failure test: the PLC raised fault 12 with the motor command off, then returned to Stopped after clear and Reset without restarting. Muse then proposed a different feedback-consistency test that was not in its initial plan, contradictory D1 limit switches, ran it, and observed a distinct fault 21 and recovery. Two findings make 31 exact PLC claims, each traced to native OPC UA reads. Nine model requests; no engineer intervention during the campaign. | `docs/w4-live-proof.md`; `artifacts/w4-paid/2026-11-03T13-11-03-480Z/live-host/runs/2026-11-03T13-12-52-676Z-live_plc/portal-host/portal-20261103131442735-1/` (`report.json`, `campaign-audit.json`, `engineering-review.json` status `pass`); report export `artifacts/bench-report/saved-exports/w4-adaptive-plc-investigation/` | Campaign 2026-11-03 13:14 UTC. The review calls the follow-up "a modest evidence-dependent extension, not discovery of an unknown fault". Muse injected both faults itself through the world's fault controls. Normal operation was not repeated in this campaign (see C-23). The first same-turn follow-up attempt was refused and corrected on the next turn. No carton in the follow-up; divert timing, misroute handling and detection deadlines not measured. The report shows the in-app engineer review as "Unreviewed"; the separate engineering review is a file. Token estimate about $3.50 uncached; not an invoice. |
| C-23 | **Wonder-directed normal operation on the live controller**, in earlier partial campaigns: one Wonder decision ran a normal A sort (carton 101, PLC Sorted) on 2026-11-02 23:43 UTC; two decisions ran another (carton 201, count 1 → 2) on 2026-11-03 00:08 UTC, with a finding whose seven PLC values were verified. | `docs/w4-paid-trial.md`; `paid-retry-audit.json` and `expanded-trial-audit.json` (both `status: partial`) under `artifacts/w4-paid/` | Separate campaigns from C-22; each ended early (an output-token limit; a Meta HTTP 503). Other preserved partial attempts: 2026-11-02 18:18 UTC stopped on a 336 ms world-update gap; 2026-11-03 02:05 UTC a Wonder-chosen fault (fault 12) whose follow-up decision was rejected before anything ran; 2026-11-03 03:16 UTC an aborted D1-jam campaign. Each stopped trial has recorded recovery evidence beside it. |
| C-24 | Before the paid trials, the isolated W4 runtime passed scripted zero-model commissioning on the live controller with the portal and HMI observing, twice: no observation gap over 300 ms (maxima 218 ms and 181 ms), a 1.5 s parent-process stall during which the child kept streaming, and a 400 ms decision lease that expired at 401 ms. | `docs/w4-live-readiness.md`, `docs/w4-paid-trial.md`; `artifacts/w4-readiness/e3469af/live-audit.json`; `artifacts/w4-paid/timing-2026-11-02T18-29-41-137Z/timing-audit.json` | Scripted, no model call; its findings are scripted. One timing pass does not guarantee future timing. |
| C-25 | **S2, passed with limitations.** In a separate live trial, Muse Wonder operated the actual browser HMI connected to CODESYS Control Win: it chose Auto On, Start, Stop, Start again, an overload injection and clear, Reset and Auto Off; HMI commands were trusted clicks on labelled controls. It received 17 real screenshots and compared them with independently observed PLC state. UI-01 to UI-03 were supported; UI-04 (stale/disconnect display) is inconclusive. | `docs/s2-hmi-proof.md`; `artifacts/s2/2026-11-03T23-19-41-497Z-live-retry/host/runs/2026-11-03T23-21-03-238Z-live_plc/portal-host/portal-20261103232137992-1/` (`s2-audit.json` `reference_review_required`, `engineering-review.json` `pass_with_limitations`, `vision-frames/`) | Campaign 2026-11-03 23:21 UTC. Local Node-served browser HMI, not WebVisu. Known labelled controls, not arbitrary HMI discovery. One extra screenshot citation in UI-03 points at a frame Muse never received; it is excluded. Only the overload alarm was exercised. The first attempt failed on a heartbeat lapse before any click. |
| C-26 | Results is an engineer-facing bench report: separate execution, experiment, verdict and review counts; experiments; findings with exact PLC values; HMI assessments with screenshots marked sent-to-Muse or captured-only; gaps; reservations versus estimates; standalone HTML export. | `docs/bench-report.md`, `docs/reviews/bench-report-review.md`, `artifacts/bench-report/` | Built after the runs and applied to their saved evidence; the exports are offline. |
| C-27 | Architecture diagrams show agnostic interfaces with the demo's populated choices (Muse Wonder, OPC UA, CODESYS Control Win, the in-project interceptor). | `docs/submission-diagrams/` | Design intent. Only the demo bindings are implemented and qualified. |

## Pending

| ID | Item | State at snapshot | What closes it |
|---|---|---|---|
| P-03 | Generated view shown following a live run | No committed capture of the generated view during a live campaign | A capture archived with its run, or label the view as a replay |
| P-05 | Demo video | Nothing recorded. The working cut is `docs/submission/demo-three-minute-cut.md` on `codex/product-integration`; the shot-level plan is `demo-storyboard.md` | Final video, under three minutes, playable signed out |
| P-06 | Spec-to-project onboarding (import and review flow) | In development; not review-complete; live use pending | Its own acceptance checkpoint. Until then show the source spec and preserved package with a preparation label. |
| P-07 | HMI UI-04 (stale/unknown/WCS-disconnect display) under Muse operation | Inconclusive in S2 | A stimulus run with its own audit |

**[BUILDER DECISION]** The S1 gate in `docs/hackathon-stretch-goals.md` still names WebVisu. The delivered HMI is the browser HMI; restate the gate before claiming it.

## Platform scope: keep these four statements separate

| Statement | What is true at the snapshot | Allowed wording | Evidence |
|---|---|---|---|
| **Vendor support that actually runs** | One platform: CODESYS Control Win V3 (3.5.22.30) on Windows, with the interceptor inside the M8 project, over authenticated OPC UA. One machine. | "first and only tested target: CODESYS Control Win" | C-08, C-10, C-12, C-22 |
| **Platform-neutral architecture** | Agnostic interfaces with demo choices populated (C-27); a draft adapter standard on the library branch. No second vendor implemented. | "designed so other PLC platforms can implement the same adapter contract" (design intent) | `docs/submission-diagrams/`, `docs/plc-adapter-standard.md` on `codex/plc-library` |
| **CODESYS prototype library** | Compiles offline in binary and native File-Based Storage form; not deployed, harness not executed | "a reusable CODESYS library prototype compiles; deploying it is a later step" | C-19 |
| **Future recording, PID tuning, signal processing** | Requirements plus compile-only hooks in the library; no reader, recorder or tool | "the library reserves observation hooks for later recording and tuning tools" (roadmap) | `codesys/library/CAPABILITIES.md` |

## Stretch goals

| ID | Goal | State at snapshot |
|---|---|---|
| S2 | Muse operates and verifies the HMI | **Done with limitations** (C-25) |
| S4 | Blind live fault diagnosis with adaptive follow-up | Not done. In W4 Muse injected the faults itself; the blind version exists only against the generated world (C-03). |
| S5 | Live world revision with hot reload | Not run live (C-05 is offline). |
| S6 | Local Glimmer provider | Not started |
| S7 | Reward loop and adapter training | Not started |

## Not claimed

None of these may appear in the README, the submission text or the video.

- **Breadth of W4.** No "Muse found a bug", "discovered an unknown fault" or "tests the whole controller". Do not imply normal, fault and follow-up ran in one campaign, or that every requirement passed. W3 stays described as recorded and partial.
- **HMI breadth.** No native WebVisu, arbitrary-HMI navigation, UI-04 pass, or carton/divert/WCS-disconnect HMI coverage.
- **Performance.** No time saved, speed-up, cost reduction or defect-detection rate. No "real-time" or "scan-synchronous" exchange. Quote rates only as measured, with their boundary.
- **Customers and users.** No users, pilots, customers, testimonials, partners or adoption.
- **Generality.** One machine, one PLC platform, one transport. No "any machine", "any PLC" or "vendor-neutral" as an achievement.
- **Library and analysis.** No deployed library, no other vendor's library, no signal recording, PID tuning, filtering or signal-processing feature.
- **Test coverage.** No coverage percentage, no "all tests pass". The runtime records experiments as observed or inconclusive; it does not compute requirement verdicts.
- **Safety and hardware.** Not a safety validation. No physical PLC CPU, field wiring or machinery; hardware passthrough has not been tested with physical I/O.
- **Exact spend.** Dollar figures are conservative reservations or token estimates, not billing records.
- **Onboarding.** No import-from-spec flow until P-06 closes.
- **Muse Code.** Not claimed.

## Wording to avoid and what to say instead

| Avoid | Say |
|---|---|
| "Muse tests your PLC" | "Muse Wonder writes the world your PLC program runs against, then plans experiments against it" |
| "Muse found a bug" / "discovered a fault" | "Muse ran a fault test, then chose a different follow-up test from what the PLC did" |
| "Muse ran a full test campaign" | "In one live campaign Muse ran two fault tests, the second chosen from the first's results; normal sorting was shown in earlier runs" |
| "Muse adapted its plan" (about W3) | "Muse chose three evidence windows up front, then wrote findings that cite the exact recorded values" |
| "the real controller", "a real PLC" | "a CODESYS Control Win soft PLC running the real conveyor program" |
| "the belt coasted" (M10) | "the simulated belt coasted 116 encoder counts" |
| "real-time", "every scan" | "up to 10 updates per second, the qualified rate" |
| calling the generated view "the HMI" | "the Muse-generated machine view (simulated world, not the PLC HMI)" |
| "Muse operates any HMI" | "Muse operated the browser HMI through its labelled controls" |
| "all tests pass" | specific checks with counts, such as "audit 10/10 over 302 acknowledged images" |
| "works with any PLC", "vendor-neutral library" | "first target: CODESYS Control Win; the interfaces are designed for other platforms" |
| "records signals for PID tuning" | "the library reserves observation hooks for later recording and tuning tools" |

## Before the repository is made public

- [ ] **Rights review of `codesys/codesys_handoff/`** (see `HACKATHON_WORK.md`). The live path loads `node-opcua` from its relay folder; excluding the folder needs a new install location first.
- [ ] **License decision.** None chosen.
- [ ] **Secret scan of full history.** Run a dedicated scanner. Spot checks of the files shown on screen found no credentials.
- [ ] **Personal data.** Commit metadata contains the author's email. Many committed evidence files contain absolute Windows paths with the username, including M10 `result.json` and several W4 audit files.
- [ ] **Branch set.** Merge the lanes to publish (including or excluding `codex/plc-library`) and pick the published branch. Untracked agent worktrees are not part of the repository.
- [ ] **PLC project identity.** The main checkout holds a modified `codesys/conveyordemo.project` and an untracked File-Based Storage conversion. The tested project is SHA-256 `6c2a1eb6c9c83485b75cb9bcefc1be237a94c8727ecf8098ad57a4d680516628`. Decide which form is published.
- [ ] **README.** Replace the root README with `docs/submission/README-draft.md`, checked on the final branch.
- [ ] **Fresh clone.** Run the README's install, start and test commands on a fresh clone of the final branch.
- [ ] **Evidence side effects.** `proof:gate-a`, `proof:gate-b`, `proof:gate-d`, `proof:m7:audit`, `proof:m10:audit` and `hmi:audit` rewrite committed files; `verify:convergence`, `verify:w4:offline` and `proof:m9` add directories.
- [ ] **Internal documents.** Decide whether `HANDOFF.md`, lane prompts and `docs/submission/` stay public.
- [ ] **Size.** Re-check repository size after the W4 and S2 evidence merges.

## Before submitting

- [ ] Video recorded, under three minutes, playable signed out. `[VIDEO URL]`
- [ ] Repository public and checked signed out. `[REPO URL]`
- [ ] Team members and Representative entered. `[BUILDER NAME(S)]`
- [ ] Every form field reviewed while signed in (see `official-requirements.md`).
- [ ] Submitted before **2026-11-04 9:00 PM EST (2026-11-05 02:00 UTC)**, with a buffer.

## Refreshing this checklist

```powershell
git fetch --all --tags
git branch -a --format='%(refname:short) %(objectname:short) %(committerdate:iso)'
git log --all --date-order --format='%h %aI %D %s' -n 40
```

Then re-read `HANDOFF.md`, `docs/w4-live-proof.md`, `docs/s2-hmi-proof.md`, `docs/bench-report.md` and `docs/submission/demo-three-minute-cut.md` at the new integration tip, and `codesys/library/HANDOFF.md` on the library branch.
