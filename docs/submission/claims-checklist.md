# Evidence and claims checklist

Internal preparation document. Review it, or remove it, before the repository is made public.

**Snapshot: 2026-11-01 21:38 EST (2026-11-02 02:38 UTC).** W3 is **partial** and W4 is **pending**. The W4 lanes in `docs/w4-parallel-lanes.md` (on `codex/product-integration`) were dispatched at `a5f3261`. At this snapshot the offline lanes A–C had committed work; the live W4 lane D had not started, so no W4 run or audit exists. Re-run the refresh commands at the end before relying on any status below.

## Rules for every submission text, README line and narration line

1. A statement may appear only if it maps to a **Completed** row below and stays inside that row's boundary.
2. **Pending** work may be described only as in progress, using the placeholder text given in its row.
3. Anything in [Not claimed](#not-claimed) must not appear in any form, including the video.
4. Every on-screen recording or replay of earlier evidence needs a visible label: live, recorded live PLC run (replay), recorded live PLC evidence with real model calls, preview fixture, or generated world without a PLC. The labels are defined in `demo-storyboard.md`.
5. W4 slots in the storyboard stay empty until an audited W4 run directory exists. Do not fill them from a preview, a fixture, the W3 recording or an unaudited attempt.

## Where the evidence lives

| Lane | Branch | Tip at snapshot | State |
|---|---|---|---|
| Shared base | `main`, tag `m10-base` | `fa8d2ee` | Gates A–D, M0–M9, M8, replay portal merged |
| M10 live integration | `codex/m10-live-integration` | `3ab99ff` | Live six-scenario run passed; audit 10/10; offline 38/38 |
| Portal host | `ui/m10-portal-host` | `7886dfd` | Verified with a fake connector and a stand-in page |
| Machine view | `view/m10-machine-view` | `042cc6a` | Package valid; audits clean; replay only |
| Convergence and independent reviews | `codex/m10-convergence` | `de0a796` | Offline gates; review of the W3 checkpoint (`docs/wonder-review-7e7c3fb.md`) |
| Operator HMI | `hmi/m10-operator-hmi` | `8e9d325` | Live H1–H3 passed earlier; review corrections committed; suite 115/115; the three H2 passes re-audit 13/13 |
| Wonder campaign | `codex/wonder-campaign` | `91c868d` | W0–W2 pass offline; **W3 partial** (real paid checkpoint over recorded M10 evidence); W4 not run |
| Product integration | `codex/product-integration` | `b78e654` (verified source `de89a87`, evidence commit `44b12aa`) | Integrated application and launcher; offline gate 155/51/13; launcher witness 10/10, fixture class; W4 lanes defined; review of Lane A's adapter |
| W4 lane A: isolated process adapter | `codex/w4-process-adapter` | `85da842` (implementation pin `9e98da7`) | Offline implementation and tests committed; "not live-qualified" per its handoff `docs/w4-process-handoff.md` |
| W4 lane B: integration | `codex/w4-convergence` | `ce592ff` | Merging Wonder, Lane A and Lane C fixes; candidate not yet pinned at snapshot |
| W4 lane C: product QA | `codex/w4-product-qa` | `f43dd05` | Preliminary offline QA with a must-fix list (`docs/w4-product-qa.md`); no signoff of a final candidate |
| W4 lane D: live commissioning | — | — | Not started. Needs A–C handoffs and a new spend/data-transfer authorization |
| Interceptor library | `codex/plc-library` | `2b404aa` | Prototype 0.2.0.0 compiled offline with consumers and a File-Based Storage round trip; harness not executed; not deployed |
| Submission docs | `docs/hackathon-submission` | this commit | Documents only |

None of these lanes is merged into `main` at the snapshot. Paths cited below are paths on the listed branch.

## Completed claims

| ID | Allowed claim | Evidence | Boundary: must say or must not imply |
|---|---|---|---|
| C-01 | Muse Wonder 1.0 wrote the conveyor world from the spec: TypeScript behavior, a manifest, stated assumptions and 8 tests. One compiler/test self-repair followed. | `artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/generation.json` (102.1 s; 8,066 input / 17,287 output tokens), `gate-a-result.json` | Generated once, on 2026-10-29. The demo shows that preserved package. Do not imply it was generated live in the video. |
| C-02 | Independent checks CP-0 to CP-7 passed on the generated world with no further model call: startup, drive causality, raw encoder, carton geometry, sensors, coast and hold, A/B/runout routing, sensor/drive/divert faults and recovery. | `gate-a-result.json`, `gate-b-result.json` | Generated world only, no PLC. |
| C-03 | In a blind test, the fault truth was committed before the diagnosis call. Muse localized the entry sensor, proposed stuck-high, and declined to name a cause because a physically held carton could not be ruled out (`insufficient_evidence`). | `gate-c/hidden-truth-commitment.json`, `final-sealed-diagnosis.json`, `truth-reveal.json` | Generated world only. Do not say Muse "diagnosed the fault". |
| C-04 | Muse then designed and ran its own belt-motion follow-up experiment. Its confidence went from 0.35 to 0.78. | `gate-c-result.json` (CP-9) | Generated world only, no PLC. This is the only demonstrated model-chosen follow-up. |
| C-05 | A world revision was compiled, shadow-checked and activated while the incumbent ran. A deliberately failing successor rolled back. | `gate-c-result.json` (CP-10) | Generated world only. No conveyor physics changed. |
| C-06 | Budget and stall guards: request timeout, repair and campaign cost stops, heartbeat stall detection, legitimate waits. | `gate-c-result.json` (CP-11), `src/proof/budget-guard.ts` | Offline. |
| C-07 | A deterministic audit checked 3,802 preserved events with 12 checks and disclosed six warnings. Muse reviewed the connector plan adversarially. Its first verdict was rejected as unsupported; the retry found four issues, all incorporated. | `gate-d-result.json`, `gate-d/` | Surrogate and contract evidence. |
| C-08 | Authenticated OPC UA (Basic256Sha256, SignAndEncrypt) to CODESYS Control Win with coherent double-buffered images. 10 Hz passed: 6,000/6,000 images over ten minutes. 20 Hz and 50 Hz failed. Output observation passed. On link loss the PLC held the last image and recovered only on a complete commit. At 10 Hz, p99 scan interval was 21.250 ms against a 21.180 ms baseline. | `codesys/README.md`, `docs/codesys-environment-inventory.md`, `codesys/artifacts/` | Measurement fixture project. Reduced M6 scope, 10 Hz only. Not scan-synchronous. |
| C-09 | First live closed loop: the generated world against a running PLC. Motor started, carton arrived, photoeye cleared, motor stopped, the belt coasted 56 counts and held. 88 acknowledged images; p99 acknowledgement 34.031 ms; audit 12 checks. | `artifacts/m7/`, `docs/m7-live-run.md` | Measurement program, not the conveyor controller. |
| C-10 | The M8 conveyor controller (build 8001, interface 1) passed methodical live tests. Modes and Start/Stop/Reset; A, B and runout routing; misroute; failed divert; WCS handshake. 104 acknowledged images; audits 9/9 and 7/7. | `codesys/demo/RESULTS.md`, `codesys/demo/evidence/` | Step-by-step raw I/O, not a continuous world. One carton at a time. |
| C-11 | Campaign runtime with an append-only, hash-chained ledger; bounded tools; budgets; pause, stop, reset and exit semantics; an adaptive follow-up loop. M9-A to M9-E passed. | `docs/m9-campaign-runtime.md`, `artifacts/m9/` | Fake provider and connector. The follow-up loop was exercised by a deterministic stub, not by Muse. |
| C-12 | **The Muse-generated world and the campaign runtime ran six scenarios against the live M8 controller:** A sort, B sort, unassigned runout, assigned-runout misroute, Stop with 116 counts of coast then a stationary hold, and a failed divert (fault 23, motor off, no false sort). 302/302 coherent acknowledged images; independent audit 10/10. | `artifacts/m10/2026-11-01T00-58-43-185Z/` (`audit.json`, `report.json`), `docs/m10-live-integration.md` | Deterministic experiment script. Its provider throws if called, so no model call was made. Effective rate 6.52 Hz with a 10 Hz ceiling; not a new rate qualification. Two earlier failed attempts are preserved. Counts are judged by deltas. |
| C-13 | The portal shows the campaign ledger verbatim after hash-chain checks. Commands count as applied only after the ledger events they cite. The HMI tile shows only captured pixels, or "HMI not observed/tested". | `docs/m10-portal-host.md` | Verified with a fake connector and a stand-in page. |
| C-14 | Muse Wonder drew the machine view (SVG plus bindings) in three bounded calls. The first was valid on the first try. Two refinement calls sent four screenshots of the rendered view as image input; Wonder fixed overlapping labels and redesigned the divert paddles. The final presentation audit found 0 errors and 0 warnings. | `artifacts/machine-view/` (three generation directories, `latest.json`, `promotion.json`), `docs/m10-machine-view.md` | Shows simulated world truth, not the PLC HMI. Verified on replays. Accounted cost $3.50 as conservative reservations, about $2.32 at published rates; neither is a billing record. The lane doc says "four view calls" but lists three amounts; three generation directories exist. |
| C-15 | The convergence portal hosts the M8 six-scenario campaign and mounts the Muse-generated view on campaign evidence. A read-only page replays the recorded M10 run with the view. Offline gate: 66/66 runtime/view tests, 51/51 UI tests, typechecks, production build, 13/13 mounted-browser checks. | `docs/m10-convergence.md`, `artifacts/m10-convergence/latest.json` (convergence) | Offline only. Superseded for current counts by C-21. The hosted live campaign has not run. |
| C-16 | A browser operator HMI for the M8 controller ran live. Start, Stop, Auto and Reset were applied or rejected from PLC acknowledgements; Start with Auto off was rejected by the PLC. An injected overload raised fault 10, Reset was rejected until the cause cleared, then applied without restarting the machine. Item 301 was sorted to exit A. A link interruption disabled Start. ConnectorStale appeared only as a bench banner. H2 passed three times. After review corrections (`8e9d325`), the stricter auditor re-audits all three runs 13/13. | `docs/m10-operator-hmi.md`, `artifacts/hmi/h2/2026-11-01T14-02-24-720Z/`, `…T14-07-10-579Z/`, `…T15-12-23-772Z/`, `docs/screenshots/hmi/live-index.json` | Commands were scripted trusted clicks in the portal's controlled headless browser, not Muse and not a person. The runner used its own campaign ledger and a fixed plan; the portal's campaign header in those runs reads "fake connector". For the re-audit, three cited agent-action frames per run were added from each run's own capture store only on hash match, listed in `evidence-frames-supplement.json`. Failed attempts are preserved. |
| C-17 | Wonder was chosen over Spark 1.3 after both received the same spec. Wonder covered 23/23 requirements with experiments; Spark covered 21/23. Spark was faster and cheaper. | `docs/model-selection.md`, `artifacts/model-spikes/` | One spec. Costs are estimates. |
| C-18 | Reports keep injected truth, observed PLC outputs, model inference and uncertainty apart. A finding must cite exact PLC output records. | `src/campaign/`, M9, M10 and W3 `report.json` | A finding is an observation, not a requirement verdict. |
| C-19 | A reusable CODESYS interceptor library, prototype 0.2.0.0, compiles with zero errors and zero warnings, together with a consumer library and a two-domain consumer application, one domain mapped from a non-conveyor example. A copy converted to native CODESYS File-Based Storage reopens with source text identical to Git, compiles, and rebuilds both consumers. | `codex/plc-library` at `2b404aa`: `codesys/library/builds/prototype-0.2.0.0/result.json`, `codesys/library/CAPABILITIES.md`, `node codesys/library/scripts/audit-build.mjs` | **Compiled only.** Its 46-case conformance harness has not run on any PLC. Not deployed, not used by the demo, not wire-compatible with M8. Its observation hooks are extension points, not recording or tuning features. Mention only as in-progress engineering, if at all. See [Platform scope](#platform-scope-keep-these-four-statements-separate). |
| C-20 | **W3, partial: real Muse Wonder 1.0 calls reasoned over a recorded live controller run.** From the spec and the recorded M10 evidence, Wonder wrote a two-experiment plan and, in its first response, chose three evidence windows to inspect. The exact recorded results came back through native tool-result pairing. Wonder wrote two findings: the D1 command for item 201 followed by fault 23 with motor and divert commands off, and the recorded exit/runout/misroute counts. All 30 PLC signal/value claims in those findings match the cited recorded outputs. It completed both experiments and finished the campaign; all six semantic actions applied. It kept unknown source quality, sparse-window timing and missing HMI evidence as stated uncertainty. | `codex/wonder-campaign`: `docs/wonder-w3-checkpoint.md`, `artifacts/wonder/checkpoint-2026-11-01T22-14-56-275Z/` (`assessment.json`, `report.json`, `campaign.jsonl`, `wonder-exchanges.jsonl`), `artifacts/wonder/w3-latest.json`, `test/wonder-paid-replay.test.ts`. Independent review: `codex/m10-convergence` `docs/wonder-review-7e7c3fb.md`, `artifacts/wonder-review/7e7c3fb/` | **Recorded historical PLC data.** No new physical experiment, no live PLC or HMI, no fault injection. **Not adaptive proof:** every inspection was chosen in the first response, and no follow-up was added after the results arrived. Three generation responses (`resp_6ae7b9f984353c4e4a42485c`, `resp_6ae7ba164034f75534ce49d7`, `resp_6ae7ba25976ca7d6ad3a43ac`). An earlier attempt was rejected at token counting (HTTP 400 for named `tool_choice`, zero generation requests) and is preserved. The approved $4 conservative allowance is fully consumed ($1 for the failed preflight, $3 for three decisions). Reported usage estimates about $0.63 at published prices. Neither figure is a billing record. Final offline gate at `3ba9e2b`: 89/89 root tests, 51/51 UI tests, 13/13 browser checks; the reviewer reran a focused 17/17 set. |
| C-21 | **One integrated application.** A single launcher serves the portal, the Muse-generated machine view and captured browser-HMI frames (`npm start`, portal `:5190`, HMI `:5191`). Opening it does not start a campaign. Modes: a zero-cost preview, a hosted review of the recorded M10 run, the live deterministic M8 campaign, and a gated Wonder mode that refuses to launch without its missing process adapter. Offline gate against `de89a87`: 155/155 runtime tests, 51/51 UI tests, three TypeScript configurations, production build, 13/13 mounted preserved-M10 browser checks. A launcher/browser witness passed 10/10 through the real portal Start button. | `codex/product-integration`: `docs/product-integration.md`, `artifacts/m10-convergence/2026-11-01T20-08-23-610Z/`, `artifacts/product-integration/2026-11-01T20-10-12-120Z/` | **Fixture class.** The preview uses a fake connector and a deterministic fixture provider; its HMI pixels come from a labelled recorded/emulated fixture, not a PLC. No PLC or Meta call was made. The live M8 composition and the Wonder mode have not run in this application. |

## Pending: required core features

Do not present these as done. Use the placeholder text until each one's closing evidence exists.

| ID | Feature | State at snapshot | Evidence that closes it | Placeholder text |
|---|---|---|---|---|
| P-01 | **W4: Wonder-directed live campaign against the M8 controller.** Muse runs one campaign from the production portal: a normal operation, a fault case and an investigation it chooses because of PLC evidence it has just received. | **Pending, not run.** W3 is partial (C-20). Lane A's isolated runtime adapter (`controlsbench.wonder-process.v1`) is implemented and tested offline, not live-qualified. Lane B's integration pin and Lane C's QA signoff are not final. Lane D, the single live owner, has not started. The W3 allowance is consumed, so W4 needs a new, explicit spend and data-transfer authorization. | One W4 run directory from the production portal with: source and build identities; raw commits and acknowledgements; authentic outputs with quality and timing; frames from the same actual HMI capture session; native model/tool-result lineage tied to response IDs; UI command outcomes; reasoning-lease receipts; conservative and actual usage kept separate; at least one investigation added after, and citing, returned PLC evidence; a report; and an independent audit giving pass, partial or fail per W4 obligation. | `[PENDING W4: Wonder-directed live campaign against the M8 controller]` |
| P-02 | **Hosted live rehearsal** of the six-scenario M8 campaign from the portal (`npm run app:m8`), with the generated view and the actual HMI | The launcher mode exists (C-21). Not run in the integrated application and not newly qualified. Needs runtime ownership and a fresh clean baseline. The last recorded clean state (HMI lane, 10:16 EST) is not a current observation. Lane D may subsume this inside W4. | A run directory with ledger, audit, HMI frames and cadence; the portal header shows the live M8 connector | `[PENDING: hosted live campaign in the portal]` |
| P-03 | **Generated view following live state** (S3 gate: replay *and* live) | Replay verified (C-15, C-21). Live is part of P-01 or P-02. | Frames from P-01 or P-02 showing the view following live snapshots, plus a selection that opens evidence | `[PENDING: generated view on live PLC data]` |
| P-04 | **Actual HMI inside the hosted live campaign** (S1 gate, restated for the browser HMI) | Met inside the HMI lane's own runner (C-16). Not yet on a hosted campaign's timeline. | Frames and actions on the same hosted ledger as the PLC acknowledgements in P-01 or P-02 | `[PENDING: actual HMI within the hosted live campaign]` |
| P-05 | Demo footage of P-01 to P-04 | No footage recorded. W4 slots are reserved in `demo-storyboard.md`. | Final video | `[FOOTAGE PENDING]` |

**[BUILDER DECISION]** The S1 gate in `docs/hackathon-stretch-goals.md` still names WebVisu. The current direction is the browser HMI. Restate the gate before claiming it.

### If a pending item is not finished by the deadline

- **P-01 not done, or W4 partial.** Say plainly that the live controller runs used a deterministic experiment script with no model call (C-12). Say that real Wonder calls reasoned over a recorded live run, planned and inspected evidence and wrote grounded findings, and that it did not add a follow-up there (C-20). Say that Muse's own follow-up experiment was shown only against the generated world without a PLC (C-03, C-04). A partial W4 is described only by the obligations its audit marks as passed.
- **P-02 to P-04 not done.** Show the recorded M10 run on the read-only replay page or in the hosted recorded review (C-12, C-15, C-21), labeled as a recording. Show the HMI separately from its H2 evidence (C-16), labeled as scripted clicks.

## Platform scope: keep these four statements separate

These are different facts. Never merge them into one sentence such as "a vendor-neutral library that records PID data".

| Statement | What is true at the snapshot | Allowed wording | Evidence |
|---|---|---|---|
| **Vendor support that actually runs** | One platform: CODESYS Control Win V3 (CODESYS 3.5.22.30) on Windows, with the interceptor integrated into the M8 project (`FB_BenchIntercept` in `conveyordemo.project`), over authenticated OPC UA. One machine. | "first and only tested target: CODESYS Control Win" | C-08, C-10, C-12 |
| **Platform-neutral architecture** | A draft adapter standard (`docs/plc-adapter-standard.md`) defines the raw-I/O semantics a vendor implementation must meet. No second vendor is implemented or tested. | "designed so other PLC platforms can implement the same adapter contract" (design intent) | `docs/plc-adapter-standard.md` on `codex/plc-library` |
| **CODESYS prototype library** | `ControlsBench Core` 0.2.0.0 compiles offline, in binary and native File-Based Storage form, with independent Library Manager consumers. It is not deployed, not used by the demo, not wire-compatible with the M8 map, and its 46 conformance cases have been compiled but not executed on a target. | "a reusable CODESYS library prototype compiles; deploying it is a later step" | C-19, `codesys/library/` on `codex/plc-library` |
| **Future passive recording, PID tuning and signal processing** | Accepted requirements in the standard. The library has compile-only extension points: a passive per-cycle observation frame, read-only PID observation taps declared in a machine map, and source gap counters. A recording format is reserved as a draft schema. No frame reader, recorder, qualified sampling rate, PID tool or signal-processing feature exists. | "the library reserves observation hooks for later recording and tuning tools" (roadmap) | `codesys/library/CAPABILITIES.md`, `docs/plc-adapter-standard.md` |

## Stretch goals (claim only if completed)

| ID | Goal | State at snapshot |
|---|---|---|
| S2 | Muse operates and verifies the same actual HMI session | First stretch after a genuine W4 pass, with its own scoped checkpoint and evidence. Not assumed from a browser click seam. Not run. |
| S4 | Blind live fault diagnosis with adaptive follow-up | Not run against the PLC. Only the generated-world Gate C version exists (C-03, C-04). |
| S5 | Live world revision with hot reload | Not run live. Only the Gate C version exists (C-05). |
| S6 | Local Glimmer provider | Not started |
| S7 | Reward loop and adapter training | Not started |

## Not claimed

None of these may appear in the README, the submission text or the video.

- **Live autonomy before W4.** No "Muse runs the live campaign", "Muse operates the PLC", "adaptive live testing" or "autonomous coverage" until an audited W4 run supports it, and then only within that audit. W3 is recorded evidence and its inspections were chosen up front.
- **Performance.** No time saved, speed-up, cost reduction, or defect-detection rate. No "real-time" or "scan-synchronous" exchange. Quote rates only as measured, with their boundary: the 10 Hz qualification and the 6.52 Hz effective rate of the M10 run.
- **Customers and users.** No users, pilots, customers, testimonials, partners or adoption.
- **Generality.** One machine (a single-lane conveyor with two diverts), one PLC platform (CODESYS Control Win on Windows), one transport (OPC UA). Do not say "any machine", "any PLC" or "vendor-neutral" as an achievement. Designed-for-generality statements must be labeled as design intent.
- **Library and analysis features.** No deployed library, no library-based demo, no other vendor's library, no signal recording, PID tuning, filtering or signal-processing feature.
- **Test coverage.** No coverage percentage. The automated tests check contracts and protocols with injected or scripted transports and preserved evidence; they do not test the controller logic. Do not say "passes N requirements": the runtime records experiments as observed or inconclusive and does not compute requirement verdicts. The spec has 23 requirements, and the live M10 run exercised six scenarios.
- **Safety and hardware.** Not a safety validation. No field wiring; hardware passthrough has not been tested with physical I/O.
- **Exact spend.** Dollar figures are conservative reservations or estimates from published rates, not billing records.
- **Muse Code.** Not claimed as product use or development use.

## Wording to avoid and what to say instead

| Avoid | Say |
|---|---|
| "Muse tests your PLC" | "Muse Wonder writes the world your real PLC program runs against" (plus the P-01 placeholder until W4 passes) |
| "Muse ran the campaign against the PLC" | "Real Muse Wonder calls reasoned over a recorded live controller run" (C-20) |
| "Muse adapted its plan to what it saw" (about W3) | "Muse chose three evidence windows up front, then wrote findings that cite the exact recorded PLC values" |
| "real-time", "every scan" | "up to 10 updates per second, the qualified rate" |
| "Muse diagnosed the fault" | "Muse localized the entry sensor, held back a verdict, and designed a follow-up experiment" (generated world) |
| calling the generated view "the HMI" | "the Muse-generated machine view (simulated world, not the PLC HMI)" |
| "Muse clicked the HMI" | "scripted clicks in the controlled browser" (until S2 passes) |
| "all tests pass" | the specific checks with counts, such as "audit 10/10 over 302 acknowledged images" |
| "works with any PLC", "vendor-neutral library" | "first target: CODESYS Control Win; a draft adapter standard is meant for other platforms" |
| "records signals for PID tuning" | "the library reserves observation hooks for later recording and tuning tools" |

## Before the repository is made public

- [ ] **Rights review of `codesys/codesys_handoff/`** (see `HACKATHON_WORK.md`). Confirm or exclude. If excluded, `node-opcua` needs a new install location first; that is a code change.
- [ ] **License decision.** None chosen. Do not add one without the builder's decision.
- [ ] **Secret scan of full history.** A pattern scan of branch tips on 2026-10-31 found only the masked-password prompt code in the runner scripts and no tracked `.env`. Run a dedicated history scanner before publishing.
- [ ] **Personal data.** Commit metadata contains the author's personal email address. Some docs contain local Windows paths that include the username. Decide whether that is acceptable.
- [ ] **Branch set.** Merge the lanes to be published, and decide which branches to push. Untracked agent worktrees (`.claude/`, `.codex/`, `.kiro/`, `.worktrees/`) are not part of the repository.
- [ ] **PLC project identity.** The main checkout has a modified `codesys/conveyordemo.project` and an untracked File-Based Storage conversion (`codesys/FileBasedConveyorDemo/`). The tested integration worktree keeps the frozen project, SHA-256 `6c2a1eb6c9c83485b75cb9bcefc1be237a94c8727ecf8098ad57a4d680516628`. Decide which form is published, and keep evidence tied to the project it actually tested.
- [ ] **README.** The integration branch's README now leads with `npm start` (the product launcher). Re-check every README command on the final merged branch; `npm run dev` and `npm run legacy:start` still launch the historical scaffold `src/server.js`.
- [ ] **Evidence side effects.** `proof:gate-a`, `proof:gate-b`, `proof:gate-d`, `proof:m7:audit` and `proof:m10:audit` rewrite committed result or audit files, and `proof:m9` adds a directory. Warn about this in the README.
- [ ] **Internal documents.** Decide whether `HANDOFF.md`, lane prompts and `docs/submission/` stay public. They are accurate provenance, but they include internal planning notes.
- [ ] Repository size is about 50 MB on the convergence branch. The largest file is `codesys/artifacts/m3-traces.zip` at 12.2 MB. No file is near GitHub's 100 MB limit. Re-check after the library and W4 artifacts merge.

## Before submitting

- [ ] Video recorded, no longer than the limit (three minutes per the brief), and playable signed out. `[VIDEO URL]`
- [ ] Repository public and checked signed out. `[REPO URL]`
- [ ] Team members and Representative entered. `[BUILDER NAME(S)]`
- [ ] Every form field reviewed while signed in (see `official-requirements.md`).
- [ ] Meta credit balance and expiry checked before any paid W4 run. The Official Rules give a 10-day validity window.
- [ ] Submitted before **2026-11-04 9:00 PM EST (2026-11-05 02:00 UTC)**, with a buffer.

## Refreshing this checklist

```powershell
git fetch --all --tags
git branch -a --format='%(refname:short) %(objectname:short) %(committerdate:iso)'
git log --all --date-order --format='%h %aI %D %s' -n 30
```

Then re-read each lane's handoff at its new tip: `docs/product-integration.md`, `docs/w4-parallel-lanes.md` and any `docs/w4-*.md` handoffs on the W4 branches, `docs/wonder-w3-checkpoint.md`, `docs/m10-operator-hmi.md`, `codesys/library/HANDOFF.md`. Update the tables above.
