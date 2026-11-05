# Submission form — current draft

Prepared November 3, 2026 from integrated proof commit544adcd and the actual form fields supplied by Steve. This supersedes the older Kiro submission snapshot for W4/S2 status. Final report presentation is being developed separately; this draft claims only the existing evidence-linked report. No form was submitted and no repository visibility was changed.

## Team Name

ControlsBench Muse

## Team Members

Steve Burns — steeezykaneeezy

## Which track are you submitting to?

Indie Developer

## Which problem statement did you build towards?

Build for Your World

## Most Viral Track X post

Leave blank unless entering that category with an actual published post URL.

## Project Description

ControlsBench Muse turns a machine specification and raw I/O list into an AI-authored world for bench-testing industrial control software.

Controls engineers often spend substantial effort building simulators, devising fault scenarios and interpreting traces before a machine is ready. Muse Wonder generates an executable model of the machine's behavior, then actively investigates how the controller responds. A local engine streams raw sensor signals and encoder counts into an interceptor in the PLC program, reads its outputs, and updates the simulated world while Muse reasons about the next experiment.

Our conveyor demonstration runs against an actual executing CODESYS Control Win application. Muse has chosen fault experiments and an evidence-dependent follow-up, operated the browser HMI, compared screenshots with PLC observations, and produced evidence-linked findings and a report. The workstation shows the generated machine view alongside the actual HMI session.

The goal is to make useful controls bench testing quick to set up from engineering information, without first constructing a detailed CAD-based simulation. CODESYS is the demonstrated platform; additional PLC adapters and reusable-library deployment are future extensions.

## Public GitHub Repository

https://github.com/RaveOregon/ControlsBenchMUSE

Configured Git remote, not yet independently verified as publicly accessible in this review. Before submission, confirm anonymous access and publish the final integrated code/README to the intended default branch. Current local integration is544adcd; reporting work follows separately.

## 3-Minute Demo Video

[Add the actual uploaded video URL after recording.]

## Describe your use of Meta products to build the submitted project

Muse Wonder 1.0 (muse-wonder-1.0), accessed through the Meta Model API, is embedded in the product's authoring and investigation workflow.

It generated the conveyor's executable TypeScript world, signal manifest, assumptions and tests, and repaired its own compilation/test issue. It also generated the lightweight machine visualization and refined it using screenshot feedback.

During live PLC testing, Wonder used structured tool calls to choose experiments, inspect observations and select a new investigation based on returned evidence. In a separate live HMI trial, it chose Auto, Start, Stop and Reset actions through labelled browser controls, received actual screenshot pixels, compared those with independent PLC observations, and recorded its assessments and findings. Our engine preserves requests, actions, acknowledgements, images and evidence references for review.

Muse Spark 1.3 was evaluated during model selection; Wonder powers the demonstrated generation and investigation workflows.

## Why are Meta's models important to your solution?

The expensive part of controls bench testing is translating engineering intent into a believable external machine, deciding what to test, and explaining what the results mean. Those tasks require reasoning across specifications, executable behavior, raw signals and operator screens.

Muse Wonder provides that connection: it writes the reactive world, uses tools to investigate the executing controller, and interprets screenshots alongside signal evidence. The local engine maintains the continuous I/O loop while the model reasons and chooses its next action.

This makes the model an active part of the testing workflow. Our live evidence includes a new fault experiment selected after earlier PLC observations and HMI assessments supported by actual received images. Findings retain their assumptions, evidence and untested areas so the engineer can review the conclusions.

## Final checks before pasting

- Team name is a proposed consistent project/team name; Steve can use another team name.
- Do not replace the missing video URL with a placeholder in the submitted form.
- Verify public repository access and final integrated default branch.
- Match any character limits visible in the form; none were provided here.
- Keep recorded demonstrations labelled as recorded. Browser HMI is locally served, not native CODESYS WebVisu. CODESYS Control Win is the live-tested runtime; other vendors and local-model/weight training are not demonstrated features.
- S2 stale/disconnect assessment remains inconclusive and one extra screenshot citation was invalid. Detailed audit/review records preserve that boundary; no exhaustive HMI or controller coverage is claimed.

Track/theme wording checked against https://dev.meta.ai/events/global-hackathon .
