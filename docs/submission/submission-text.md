# Submission text drafts

Internal preparation document. Status snapshot: 2026-11-01 19:12 EST (2026-11-02 00:12 UTC). W3 is partial; W4 is pending.

The signed-in form's field names and character limits were not visible during drafting (see `official-requirements.md`). The blocks below are written for the fields a form like this usually has. Copy the real field list here, then trim each block to its limit. Every factual sentence maps to a row in `claims-checklist.md`. Replace each `[PENDING …]` sentence with its final text only after the closing evidence exists; otherwise use the fallback wording given.

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
3. From a machine spec to a live bench test of real PLC code.

## Value proposition

- **For** controls engineers and system integrators who test PLC programs before they reach a machine. **[BUILDER]** confirm or narrow the audience.
- **The job today.** Before a PLC program meets a machine, someone has to build something that behaves like that machine, write test cases, run them, and explain each failure from traces. **[BUILDER]** add one sentence from your own experience. Add no numbers you cannot cite.
- **What ControlsBench Muse does.** Muse Wonder writes the machine's external world from the functional spec and the raw I/O list. The real controller program runs against that world through an interceptor at its raw I/O image. A hash-chained ledger records every input, acknowledgement, output and finding. `[PENDING W4: Muse also directs the campaign against the live controller, choosing experiments and follow-ups from what the PLC does.]`
- **What is different.** The system under test is the real executing PLC program, not a software copy. The plant model is written by Muse, not built by hand. The evidence keeps what was injected apart from what the PLC did and what the model inferred.

## Short description (about 60 words)

> ControlsBench Muse turns a machine's functional spec and I/O list into a bench test for real PLC code. Muse Wonder writes the plant model as executable TypeScript. ControlsBench runs it against a live CODESYS controller over authenticated OPC UA and records evidence that keeps simulated truth, PLC behavior and model inference apart. Built for one conveyor during the hackathon.

## Long description, organized by judging criterion

### What it is

> ControlsBench Muse is a bench-test workstation for PLC programs. An engineer supplies what they already have: a functional specification and the raw signal list. Meta's Muse Wonder writes the machine's external world from them. That means belt motion, cartons, photoeyes, diverter travel and raw encoder counts as TypeScript, with its assumptions and its own tests. The real controller program runs against that world on a CODESYS Control Win runtime. It receives raw inputs and its actual outputs are read back. Everything is recorded in a hash-chained ledger.

### Impact

> Testing PLC logic before commissioning means building something that behaves like the machine, writing the tests, and explaining failures from traces. ControlsBench Muse gives the plant-building work to Muse and keeps the real controller program as the system under test. During the hackathon this worked end to end for one machine: a conveyor with two sequential diverts and a runout. [BUILDER: one sentence on why this matters in your own work.] The design targets controls engineers, system integrators and machine builders. It has not been used by anyone outside this project yet.

### Use of Meta AI tooling

> Muse Wonder 1.0 is part of the product, called through the Responses API with strict JSON-schema output and hard per-request and per-campaign budgets.
>
> - It wrote the conveyor world package from the spec, then repaired its own compiler and test failure.
> - In a blind test against that world, with the fault committed before the call, it localized the entry sensor and declined to name a cause from one trace. It then designed its own belt-motion experiment and raised its confidence from 0.35 to 0.78.
> - It reviewed the OPC UA measurement plan adversarially. Its first answer was rejected as unsupported; the retry found four issues that were incorporated.
> - It drew the machine view as validated SVG with data bindings. It then reviewed screenshots of its own rendering as image input, fixing overlapping labels and divert paddles that cut through cartons.
> - In a paid checkpoint over a recorded run of the live controller, Wonder planned two experiments and chose three evidence windows through function calls. It wrote two findings, and all 30 PLC values they cite match the recorded outputs. It chose those windows in its first response; it did not add a follow-up after seeing the results.
> - Wonder was chosen over Muse Spark 1.3 after both received the same spec.
>
> `[PENDING W4: In the live campaign, Wonder chooses experiments through function calls, reads the PLC's responses and adds follow-up investigations. Each finding must cite exact PLC outputs.]`

Fallback, if W4 does not close: "A multi-turn, tool-calling Wonder campaign provider runs on real Muse Wonder responses. Against a recorded live controller run it planned, inspected evidence and wrote grounded findings. Its live, adaptive run against the controller was not completed in time." If W4 is partial, describe only the obligations its audit passed.

### Technical depth and execution

> The controller is real CODESYS Control Win logic, kept separate from the generated plant. A thin interceptor at the raw I/O image selects simulated inputs; hardware passthrough is the default. The workstation sends complete input images over authenticated OPC UA (Basic256Sha256, SignAndEncrypt) with an epoch and sequence handshake, so a torn or stale image is never applied.
>
> Rates were measured, not assumed. 10 Hz passed 6,000 of 6,000 images over ten minutes; 20 Hz and 50 Hz failed. Link loss holds the last image. At 10 Hz the PLC's p99 scan interval was 21.250 ms against a 21.180 ms baseline.
>
> In the live integration run, the Muse-written world and the campaign runtime drove six scenarios against the conveyor controller: A, B, unassigned runout, misroute, stop with physical coast, and a jammed divert raising fault 23 with no false sort. All 302 input images were acknowledged coherently, and an independent audit passed 10 of 10 checks. That run used a fixed experiment script, with no model call.
>
> A browser operator HMI drives the same controller. Start, Stop and Reset count only when the PLC acknowledges them, and Auto is confirmed by readback. Three live runs each passed a 13-check audit. The Muse-generated view runs in a sandboxed, CSP-locked iframe with no command authority. One launcher serves the portal, the generated view and the captured HMI. Failed attempts are kept as evidence and never relabeled as passes.

### Demo

> The video follows one run: spec, Muse-written world, Muse-drawn view, the real controller, A/B/runout sorting, a misroute, stop and coast, a jammed divert, `[PENDING W4: Muse's live follow-up investigation]`, the actual operator HMI, and the evidence report. Every replayed or offline segment is labeled on screen.

If W4 does not close, replace the pending item with: "Muse's reasoning over a recorded live run, and its own follow-up experiment against the generated world".

## What was built during the hackathon

> The repository's first commit is dated Oct 29, 2026, and every commit falls inside the event. New work includes the generated-world runtime and proofs, the OPC UA connector and its measurements, the CODESYS conveyor controller, the campaign runtime and ledger, the portal, the Muse-generated machine view, the operator HMI, and all preserved evidence. `HACKATHON_WORK.md` lists each component with its commits. It also lists the reused material: the builder's earlier CODESYS notes, used as reference and as the install location of the third-party `node-opcua` package, and third-party tools.

**[BUILDER TO CONFIRM]** the final date range and the open items in `HACKATHON_WORK.md` before using this paragraph.

## How to try it

> Without a PLC or API key: clone the repository, run `npm install`, `npm test` and the preserved-evidence audits listed in the README, and open the portal replay. The live path needs CODESYS Control Win with the included conveyor project; the README lists the steps.

## What's next (roadmap, not claims)

- Muse directing live campaigns against the controller (W4), then operating the HMI it observes.
- Hierarchical generation for machines too large for one generation call.
- The reusable CODESYS interceptor library: a prototype compiles offline with independent consumers; deploying it in place of the demo's integrated interceptor is a later step.
- Other PLC platforms implementing the same draft adapter contract. Only CODESYS Control Win runs today.
- Passive signal recording during normal operation, for later PID tuning and signal-processing tools. The library reserves hooks for it; none of those tools exists yet.
- A local Muse Glimmer provider for on-premises benches.
