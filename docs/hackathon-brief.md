# Meta Global AI Developer Hackathon brief

The project-specific Model API operating rules are captured in [model-api-playbook.md](./model-api-playbook.md).

Status: consolidated from the participant guide, rendered event details, official rules/waiver, and linked Meta Model API documentation on 2026-10-29.

This document is the project-facing source of truth for event strategy and submission readiness. Event organizers may change dates or rules; re-check the live pages before submission.

## Entry decision

- **Competition track:** Indie Developer.
- **Problem statement:** Build for Your World.
- **Project:** ControlsBench Muse.
- **Core story:** bring Meta's models into industrial controls engineering, a domain the builder knows firsthand. Turn a functional specification and signal information into a live external process model and adaptive bench-test campaign around actual executing PLC logic. Reduce the manual effort of constructing simulators, devising fault campaigns, correlating evidence, and explaining failures.

“Push the Frontier” also describes parts of the implementation, but it is not the selected submission path. The pitch should remain grounded in the real controls-engineering workflow and user benefit.

## What the event requires

Projects must address one of two problem statements:

1. **Build for Your World:** bring Meta models into a domain known firsthand, save time and mental effort, and enable something that was not previously practical.
2. **Push the Frontier:** use Meta models in software, robotics, manufacturing, energy, materials, science, or physical-system control to create a new capability.

The project must incorporate Meta models. Eligible options include hosted Muse Wonder, Muse Spark, Muse Image, Muse Voice Transcribe, and SAM 3.1 through Meta Model API; open-weight Muse Glimmer and Muse Spark Open; and Muse Code as a development agent.

ControlsBench's judged Meta use must be visible in the product. Using Muse Code only to develop the repository is not enough to establish the product claim.

## Schedule — Eastern Time

| Date | Event |
|---|---|
| Mon, Oct 26, 12:00 PM | Kickoff: rules, prizes, judging, and Meta speaker session |
| Tue, Oct 27, 12:00–12:30 PM | Agents 101: Build a Multimodal AI Agent |
| Wed, Oct 28, 12:00–12:30 PM | Agents 102: Best Practices for Verifiable Agents |
| Fri, Oct 30, 12:00–12:30 PM | Building Specialized Intelligence on Fireworks: From Inference to Training with Muse Open Models |
| Weekdays during build, 10:00–11:00 AM | Text office hours with Meta in Discord `#office-hours` |
| Tue, Nov 3 | Last full day for submission questions and technical troubleshooting |
| Wed, Nov 4, 9:00 PM | Final office hours; submission and Meta credit-claim deadline |
| Thu, Nov 5–Sun, Nov 8 | Judging period |
| Mon, Nov 9, 12:00 PM | Closing ceremony; top ten announced, five per track; live finals and winners |
| Mon, Nov 16 | Community-vote winner announced in Discord |

The stated building period is Oct 27 through Nov 4. Dates may change at Meta's discretion; check the event page and Discord announcements.

## Rules that directly affect this repository

### Public repository

The submission repository **must be public**. This repository is private during development and therefore must be made publicly accessible before submission. Verify the URL from a signed-out browser.

### New work and provenance

The demo may highlight only features, code, and functionality built during the hackathon. Existing products or codebases may be used, but newly developed work must be clearly identified. Failure to make the original contribution clear can cause immediate disqualification.

ControlsBench implications:

- Preserve commit history from the hackathon build window.
- Maintain a concise `HACKATHON_WORK.md` or equivalent submission section that lists what was created during the event.
- If code or patterns are adapted from the builder-owned Machine Agent or HMaI projects, identify the source, pre-existing revision, license/ownership basis, and the new ControlsBench work.
- Do not present CODESYS, OPC UA libraries, Meta SDKs, or other dependencies as original work.
- Do not copy Machine Agent or HMaI wholesale.

### Rights and acceptable material

Projects may be disqualified for violating legal, ethical, or platform policies or using code, data, or assets without the necessary rights. The submission must be original or properly licensed, and applicable open-source licenses must be followed.

The official rules state that the entrant retains ownership of the submission, while granting the organizers a perpetual, irrevocable, worldwide, royalty-free, non-exclusive license to use and adapt it. Materials shared in connection with the event are not treated as confidential. This is an event-summary note, not legal advice; consult the official rules for the controlling language.

### Team and entry

- Indie allows solo builders and teams of up to four.
- A project can enter one track only.
- A team must appoint one representative and list every contributor.
- The representative submits once for the team and handles any prize-allocation instructions.

### Anti-project guidance

Avoid generic or policy-sensitive projects such as basic RAG applications, simple image analyzers, generic education chatbots, medical-advice systems, job screeners, personality analyzers, sports analyzers/coaches, and political or war-related projects.

ControlsBench is differentiated by executable closed-loop behavior, a real controller boundary, adaptive experiments, and trace-grounded evidence. Do not reduce the demo to document Q&A or a static generated test list.

## Submission requirements

- Submit through the Cerebral Valley portal by **Wednesday, Nov 4 at 9:00 PM ET**.
- Late submissions are not considered.
- Provide one submission for the project.
- Repository must be public and accessible.
- Video link must be accessible without requesting permission.
- List everyone who worked on the project.
- Provide a **three-minute demo video** showing the specific features, code, and functionality built during the hackathon.
- Judges use the video as a primary artifact alongside the code and live product.

The authenticated submission form's exact field list was not exposed by the public page during this review. Re-open it while signed in before the final day and prepare every text field in advance.

## Judging process

### Stage one — viability gate

Pass/fail review asks whether the project reasonably fits a problem statement and reasonably uses Meta Model API and/or Meta open-weight models in work built during the hackathon.

ControlsBench must make the following immediately obvious:

- Build for Your World fit;
- live use of Muse inside the product;
- new work created during the event; and
- a functioning result rather than an architecture proposal.

### Stage two — weighted rubric

| Category | Weight | ControlsBench evidence |
|---|---:|---|
| Impact | 30% | Controls engineers, system integrators, OEMs, and commissioning teams can create and run richer PLC bench tests with far less simulator/test-authoring effort; earlier defect discovery reduces commissioning risk and rework. |
| Use of Meta AI Tooling | 25% | Muse Wonder transforms the engineer's specification into a reactive external world, creates experiments, uses tools to run them, observes the PLC response, chooses follow-ups, and explains evidence. Structured output, tool calling, multimodal HMI observation, and long-horizon reasoning are used as parts of one coherent product. |
| Technical Depth & Execution | 20% | Actual executing CODESYS logic remains separate from the generated plant; OPC UA transports logical signals; timing/quality/staleness are measured; the deterministic host preserves physical invariants and evidence. |
| Demo | 25% | A concise, visible end-to-end run: spec → generated world → connected PLC → A/B/runout → injected fault → Muse-selected follow-up → evidence-backed report. |

### Stage three — finals

The five highest-scoring projects in each track advance. Final judges watch the demo videos live and rank projects using the same rubric.

## Prize context

### Indie Developer — $400,000 total

| Place | Prize |
|---|---:|
| 1st | $150,000 |
| 2nd | $100,000 |
| 3rd | $75,000 |
| 4th | $50,000 |
| 5th | $25,000 |

### Bonus categories — $50,000 total

| Bonus | Prize | Relevance |
|---|---:|---|
| Most Viral Project | $20,000 | Optional. Requires posting the demo on X and submitting the post link; engagement counted through Nov 8 EOD. Do not optimize the product around this before the core demo works. |
| Best Build on Meta Open Weight Models | $10,000 | Not targeted. Requires Muse Glimmer or Muse Spark Open on eligible infrastructure and partner verification. Do not change architecture only to chase this bonus. |
| Community Vote | $10,000 | Public-gallery votes, one per verified account; winner announced Nov 16. |
| Best Agentic Use-Case | $5,000 | Strong natural fit: autonomous model creation, experiment choice, tool-driven execution, follow-up investigation, and reporting. |
| Best Creative Build | $5,000 | Plausible fit because the project uses Muse Wonder in an original final experience. |

The official rules give organizers discretion over bonus categories and allocations. Track prizes are the primary goal.

## Credits and community resources

### Meta Model API credit

- Accepted participants may claim **$150** in Meta Model API credits.
- Claim through the event's linked form by Nov 4 at 9:00 PM ET.
- Every participant claims individually; credits cannot be claimed for someone else.
- Credits are distributed in batches.
- A valid payment card is required to make calls; a temporary preauthorization may appear and should be released automatically.
- Verify the credit on the Billing page and configure a spend-limit notification if desired.

The credit-terms PDF linked by the official rules had an expired signed URL during this review. Re-open the live rules page before relying on credit expiration or other terms not reproduced in the participant guide.

### Optional inference partners

- **Baseten:** $100 credits and a 2M TPM limit for up to 2,000 selected participants; use `meta-models/muse-spark-open-1026`, not the generic model ID shown in ordinary docs.
- **Modal:** $100 for the first 1,000 participants for open-weight model infrastructure.
- **Fireworks:** $100 for selected teams using open-weight models.

ControlsBench currently uses hosted Muse Wonder. Partner credits and open-weight infrastructure are not required for the selected path.

### Discord

Use:

- `#announcements` for official changes and reminders;
- `#questions` for event questions not covered by the guide;
- `#office-hours` for Meta technical questions;
- `#intros` and `#general` for community visibility; and
- `#team-search` only if adding teammates.

## Meta Model API capabilities relevant to ControlsBench

### Chosen model

`muse-wonder-1.0` in Standard mode is the primary model. See `docs/model-selection.md` for the direct Wonder-versus-Spark evaluation. Standard mode is the selected data-use posture for PLC programs, specifications, traces, and HMI media.

### Responses API

Use `POST https://api.meta.ai/v1/responses` with bearer authentication from `MODEL_API_KEY`. Responses supports server-managed multi-turn work, `previous_response_id`, reasoning continuity, structured output, tools, and multimodal content. Reasoning remains outside the hard-timing path.

### Structured output

Use `text.format` with a strict JSON Schema on the Responses API. Schema validity guarantees shape, not engineering correctness. ControlsBench must additionally validate references, types, authority, bounded execution, physical invariants, and unapproved assumptions before executing a generated model.

### Tool calling

Define narrowly scoped developer tools with typed JSON Schema arguments. The model returns function calls; ControlsBench validates and executes them locally, then returns `function_call_output` with the matching call ID. Bound the loop by turns, time, and action authority. The model never receives unrestricted PLC writes.

Expected experiment tools include:

- inspect current model/assumptions;
- observe logical signals and recent evidence;
- start/stop a bounded experiment;
- schedule a virtual carton or WCS message;
- activate/clear an allowed fault knob;
- request an evidence slice;
- mark a result pass/fail/inconclusive with citations; and
- propose a follow-up for execution or engineer review.

### Files and documents

Images, video, audio, and PDFs can be sent inline for one-off calls or uploaded through the Files API with `purpose=user_data` and referenced by file ID. Inline content is limited to 50 MB; file uploads can be as large as 1 GiB, with a 100 GiB team storage limit. Uploaded files do not expire unless `expires_after` is set, so ControlsBench should set an expiration or explicitly delete campaign media when no longer required.

### Images and video

Use image inputs for individual HMI states and short video clips for temporal UI behavior. Record HMI video concurrently with the signal trace, then pass short clips with a prompt that includes the corresponding time window and relevant trace facts. Model observations are an evidence channel, not a substitute for PLC-tag truth and never part of the PLC scan loop.

### Cost and rate-limit handling

- Record per-call model, response ID, duration, and token usage.
- Set explicit output limits.
- Use the input-token endpoint for expensive multimodal requests when helpful.
- Implement bounded retry with backoff for 429 and transient server failures.
- Respect team-level rate limits.
- Keep model inference outside deterministic signal exchange.

## Product and demo commitments

The minimum credible demonstration remains:

1. Import or show the accepted conveyor specification and signal contract.
2. Show Muse Wonder generate the external reactive model and expose its assumptions.
3. Validate the generated artifact and connect it to the execution host.
4. Confirm the real CODESYS controller, logical map, and deliberate bench mode.
5. Sort one carton to A, one to B, and one unassigned carton to runout.
6. Inject one meaningful fault or contradictory input.
7. Let Muse inspect the actual result and choose at least one follow-up experiment.
8. Show an evidence-backed report that separates simulated ground truth, observed PLC evidence, model inference, and uncertainty.
9. If HMI media is ready, show a correlated clip or screenshot; do not let vision block the core closed-loop proof.

Do not claim success from a surrogate connector, predetermined trace, hard-coded conveyor investigator, static AI test list, or the simulator's own expected state. Label every fallback plainly.

## Submission readiness checklist

### Product

- [ ] Muse-generated model is executable through a bounded, general runtime.
- [ ] CODESYS application is separate and actually executing.
- [ ] OPC UA connector measures quality, timestamps, freshness, and latency.
- [ ] Normal A/B/runout sequence works.
- [ ] Fault and observation-driven follow-up work.
- [ ] Evidence report cites actual trace points.
- [ ] HMI media is included only if reliable.

### Repository and rights

- [ ] Repository is public and accessible signed out.
- [ ] Hackathon-new work is explicitly documented.
- [ ] Reused code and dependencies are identified with rights/licenses.
- [ ] No secrets, credentials, private customer data, or proprietary artifacts are committed.
- [ ] README is truthful and matches the live demo.
- [ ] License/publication decision is made before public release.

### Submission

- [ ] Three-minute video is complete and accessible signed out.
- [ ] Submission text maps directly to the four rubric categories.
- [ ] Live product/demo instructions are short and verified on a clean machine/session.
- [ ] Repository URL, video URL, participant list, and representative are correct.
- [ ] Submission form reviewed while signed in before Nov 3.
- [ ] Final submission completed before Nov 4 at 9:00 PM ET.

## Sources

- [Participant guide and event details](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details)
- [Official rules and waiver](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver)
- [Submission portal](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit)
- [Meta Model API overview](https://dev.meta.ai/docs/overview)
- [Models](https://dev.meta.ai/docs/models)
- [Responses API](https://dev.meta.ai/docs/protocols/responses)
- [Structured output](https://dev.meta.ai/docs/structured-output)
- [Tool calling](https://dev.meta.ai/docs/tool-calling)
- [File handling](https://dev.meta.ai/docs/file-handling)
- [Image understanding](https://dev.meta.ai/docs/image-understanding)
- [Video and audio understanding](https://dev.meta.ai/docs/video-understanding)
- [Pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits)
