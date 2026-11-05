# Submission text drafts

Internal preparation document. Evidence pinned at `codex/product-integration` `9033bae` (2026-11-03 20:54 EST). W3 is partial; W4 passed in a scoped form; S2 passed with limitations. Audit: `claims-audit.md`.

The signed-in form's field names and character limits were not visible during drafting (see `official-requirements.md`). Copy the real field list here, then trim each block to its limit. Every factual sentence maps to a row in `claims-checklist.md`.

## Fixed fields

| Field | Draft |
|---|---|
| Project name | ControlsBench Muse |
| Track | Indie Developer |
| Problem statement | Build for Your World |
| Repository URL | `[REPO URL]` |
| Demo video URL | `[VIDEO URL]` |
| Team members | `[BUILDER NAME(S)]`. The Official Rules require the Representative to name every other team member. |
| Representative | `[NAME]` |
| Meta models used | Muse Wonder 1.0 (`muse-wonder-1.0`, Standard mode) in the product. Muse Spark 1.3 was used once, for model selection. |
| Optional: X post for Most Viral | `[X POST URL]`, only if the builder chooses to post |

## Tagline

Pick one. Each is under 15 words.

1. Muse Wonder writes the machine. Your real PLC program runs against it.
2. A Muse-written plant model for bench-testing real PLC programs.
3. From a machine spec to live PLC experiments that Muse chooses itself.

## Value proposition

- **For** controls engineers and system integrators who test PLC programs before they reach a machine. **[BUILDER]** confirm or narrow the audience.
- **The job today.** Before a PLC program meets a machine, someone has to build something that behaves like that machine, write test cases, run them, and explain each failure from traces. **[BUILDER]** add one sentence from your own experience. Add no numbers you cannot cite.
- **What ControlsBench Muse does.** Muse Wonder writes the machine's external world from the functional spec and the raw I/O list. The real controller program, running on a CODESYS Control Win soft PLC, reads that world through an interceptor at its raw I/O image. Muse then plans experiments against the live controller, chooses follow-ups from what the PLC does, and can operate the browser HMI. A hash-chained ledger and an engineer-facing report keep the evidence.
- **What is different.** The system under test is the real executing PLC program, not a software copy. The plant model is written by Muse, not built by hand. The evidence keeps what was injected apart from what the PLC did and what the model inferred.

## Short description (about 60 words)

> ControlsBench Muse turns a machine's functional spec and I/O list into a simulated plant that real PLC code is bench-tested against. Muse Wonder writes the plant as TypeScript, then plans and runs experiments against a live CODESYS soft PLC, choosing follow-ups from what the controller does. The evidence keeps simulated truth, PLC behavior and model inference apart. Built for one conveyor.

## Long description, organized by judging criterion

### What it is

> ControlsBench Muse is a bench-test workstation for PLC programs. An engineer supplies what they already have: a functional specification and the raw signal list. Meta's Muse Wonder writes the machine's external world from them: belt motion, cartons, photoeyes, diverter travel and raw encoder counts, as TypeScript, with its assumptions and its own tests. The real controller program runs against that world on a CODESYS Control Win soft PLC. Muse Wonder then plans experiments against the running controller, reads what it does, and reports findings that cite the exact PLC outputs.

### Impact

> Testing PLC logic before commissioning means building something that behaves like the machine, writing the tests, and explaining failures from traces. ControlsBench Muse gives the plant-building and much of the investigation to Muse, while the real controller program stays the system under test. During the hackathon this was shown for one machine, a conveyor with two sequential diverts and a runout, in separate recorded runs: Muse wrote the plant from the spec; the controller program ran against it on a live soft PLC; Muse ran fault tests there and chose a follow-up test from the results; in another trial it operated the browser HMI; and each run produced a report an engineer can check line by line. [BUILDER: one sentence on why this matters in your own work.] The design targets controls engineers, system integrators and machine builders. It has not been used by anyone outside this project yet.

### Use of Meta AI tooling

> Muse Wonder 1.0 is part of the product, called through the Responses API under hard per-request and per-campaign budgets. World and view generation use strict JSON-schema output; campaign decisions arrive as function calls that the runtime validates before anything reaches the bench.
>
> - **It wrote the machine.** From the spec it wrote the conveyor world package. It fixed a compile error in its own tests and rewrote its manifest; a later rewrite that would have removed the belt's coast was rejected after the engineer confirmed a real belt decelerates. The behavior code stayed as first generated.
> - **It investigated a live controller.** In one live campaign Wonder planned a drive-feedback-failure test, injected it, and saw the PLC raise fault 12 with the motor command off, then return to Stopped after Reset without restarting. It then proposed a different feedback-consistency test that was not in its initial plan, contradictory divert limit switches, ran it, and observed a distinct fault 21 and recovery. Its two findings make 31 exact PLC claims, each traced to the controller's OPC UA reads. Nine model requests, with no engineer intervention during the campaign. In earlier live runs its decisions also ran normal A sorts end to end.
> - **It operated the HMI.** In a separate live trial Wonder operated the browser HMI through trusted clicks on its labelled controls (Auto, Start, Stop, Reset), received 17 real screenshots, and compared them with independently observed PLC state. Three of four screen requirements were supported; the stale/disconnect display check stayed inconclusive, and one invalid screenshot citation was excluded from the engineering conclusion.
> - **It reasoned before acting.** In a blind test against the generated world, with the fault committed before the call, it localized the entry sensor, declined to name a cause from one trace, then designed its own belt-motion experiment and raised its confidence from 0.35 to 0.78.
> - **It reviewed and drew.** It reviewed the OPC UA measurement plan adversarially (its first answer was rejected as unsupported; the retry's four findings were incorporated). It drew the machine view as validated SVG with data bindings, then in two refinement calls reviewed four screenshots of its own rendering each time, fixing overlapping labels and divert paddles that cut through cartons.
> - Wonder was chosen over Muse Spark 1.3 after both received the same spec.

### Technical depth and execution

> The controller is real CODESYS Control Win logic, kept separate from the generated plant. A thin interceptor at the raw I/O image selects simulated inputs; hardware passthrough is the default, although no physical I/O is wired on this bench. The workstation sends complete input images over authenticated OPC UA (Basic256Sha256, SignAndEncrypt) using an epoch and sequence handshake. In a 10,000-image coherence test no torn image was applied, and duplicate, stale, skipped and incomplete commits were each handled as specified.
>
> Rates were measured, not assumed. 10 Hz passed 6,000 of 6,000 images over ten minutes; 20 Hz and 50 Hz failed. On link loss the PLC held the last image and recovered only on a complete new commit. At 10 Hz the PLC's p99 scan interval was 21.250 ms against a 21.180 ms baseline.
>
> The generated world runs in an isolated child process that owns the bench timing, so a slow model call or a stalled parent process does not pause the inputs the PLC sees. In two live commissioning runs with the HMI observing, no observation gap exceeded 300 ms, the child kept streaming through a 1.5 s parent stall, and a 400 ms decision lease expired at 401 ms. Live runs that stopped early (a timing gap, an output-token limit, a model-service error, a rejected decision) were kept as evidence beside their recovery records.
>
> Earlier, with a fixed experiment script and no model call, the Muse-written world drove six scenarios against the conveyor controller: A, B, unassigned runout, misroute, a Stop during which the simulated belt coasted 116 encoder counts before holding, and a jammed divert raising fault 23 with no false sort. All 302 input images were acknowledged coherently, and an independent audit passed 10 of 10 checks.
>
> The Muse-generated view runs in a sandboxed, CSP-locked iframe with no command authority. HMI commands count only when the PLC acknowledges them. One launcher serves the portal, the generated view and the captured HMI, and Results exports a standalone HTML report.

### Demo

> The video walks through the workflow with evidence from several recorded live runs, each labelled with its source and time: the spec and the Muse-written world, the controller program running against it, Muse's live fault test and evidence-driven follow-up, Muse operating the HMI in a separate trial, and the engineer's report. Recorded evidence reviewed after the fact is labelled as a review, not new footage.

## What was built during the hackathon

> The repository's first commit is dated Oct 29, 2026, and every commit falls inside the event. New work includes the generated-world runtime and proofs, the OPC UA connector and its measurements, the CODESYS conveyor controller, the campaign runtime and ledger, the isolated live runtime, the portal, the Muse-generated machine view, the operator HMI, the bench report, and all preserved evidence. `HACKATHON_WORK.md` lists each component with its commits. It also lists the reused material: the builder's earlier CODESYS notes, used as reference and as the install location of the third-party `node-opcua` package, and third-party tools.

**[BUILDER TO CONFIRM]** the final date range and the open items in `HACKATHON_WORK.md` before using this paragraph.

## How to try it

> Without a PLC or API key: clone the repository, run `npm ci` and `npm --prefix ui ci`, then `npm start`. It opens a labelled preview with a fake connector, a fixture provider and a recorded HMI fixture; nothing contacts a PLC or a model. `npm run app:recorded` reviews the recorded M10 run instead. `npm test` and `npm run typecheck` run the offline checks. The live path needs CODESYS Control Win with the included conveyor project and its OPC UA credentials; the README lists the steps.

**[CHECK]** Run these commands on a fresh clone of the final branch before submitting. They have not been verified that way, and recent full test runs had one or two failures that passed on rerun.

## What's next (roadmap, not claims)

- Importing a new machine's spec and I/O list through the app (in development).
- Broader live coverage: blind fault diagnosis on the controller, divert timing and misroute experiments, and the HMI's stale/disconnect display.
- The reusable CODESYS interceptor library: a prototype compiles offline with independent consumers; deploying it in place of the demo's integrated interceptor is a later step.
- Other PLC platforms implementing the same adapter contract. Only CODESYS Control Win runs today.
- Passive signal recording during normal operation, for later PID tuning and signal-processing tools. The library reserves hooks for it; none of those tools exists yet.
- A local Muse Glimmer provider for on-premises benches.
