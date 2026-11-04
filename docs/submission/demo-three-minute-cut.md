# Three-minute video — explain the problem, then show the proof

Target **2:50**, leaving ten seconds below the supplied three-minute limit. Lead with the engineer's problem and the product's job in twenty seconds. Let the screen do most of the explaining after that. The story is **specification → reactive machine world → model-directed controller test → evidence report**.

Use separate chapter labels for preparation, the recorded normal-operation trial, the recorded adaptive trial and the recorded HMI trial. These are different saved runs. Remove long reasoning waits and label the cut “model waiting time removed.” Keep text large enough to read in the final video.

## Shot list and ready-to-read narration

| Time | Show | Narration |
| --- | --- | --- |
| **0:00–0:20** | Running machine view and actual HMI. Title: **ControlsBench Muse — test the controller before the machine is available**. | “Before a machine is available, controls engineers still need to test its PLC logic. Building the simulated machine and realistic fault tests takes time. ControlsBench uses Muse to build that world from engineering information, investigate the controller, and produce a report.” |
| **0:20–0:40** | Actual supported spec import, preparation status and resulting plan. Zoom to one physical parameter and one source-linked expected check. If onboarding acceptance is unfinished, show the saved spec and genuine generation result under **Model preparation — saved result**. | “Here is the machine specification and its raw I/O. Muse creates executable machine behavior and a test plan, including assumptions. This conveyor world models motion, sensor positions and encoder counts. Stop makes the belt decelerate.” |
| **0:40–0:55** | Brief architecture crop or three labels: **Muse chooses experiments → engine runs the world ↔ PLC executes its program**. Secondary caption: **Demo: Wonder / OPC UA / CODESYS Control Win**. | “Muse chooses experiments. The workstation engine maintains the I/O loop while it reasons. The PLC runs its own program: outputs drive the simulated world, and the world returns raw feedback.” |
| **0:55–1:15** | One normal-operation segment: moving carton, derived sensor, actual controller completion. Label **Recorded live controller trial — normal operation**. | “In this recorded trial, the executing controller sorts a simulated carton. Its commands move the mechanism; the resulting sensor signals return through our PLC interceptor. The controller records the completion.” |
| **1:15–1:55** | Hero: W4 missing drive feedback → fault 12 → clear/reset → Muse's new D1 follow-up rationale → fault 21 → clear/reset. Use readable callouts and the saved report/decision trail if original live video is unavailable. Label **Recorded live Muse trial — adaptive investigation**. | “Now Muse removes drive-running feedback and observes fault twelve. After recovery, it chooses a new investigation from that result: contradictory divert feedback, which was absent from its initial plan. It runs the experiment, observes the distinct fault twenty-one, clears the condition and resets. The saved evidence links its decisions to actual PLC observations.” |
| **1:55–2:15** | S2 received Start, Stop/coast, overload and Reset frames. Show acknowledgements/results. Label **Separate recorded live Muse trial — browser HMI**. | “In a separate trial, Muse operates the browser HMI and receives the actual screen images. It checks Start, Stop, the overload alarm and Reset against independently observed PLC state.” |
| **2:15–2:40** | Results: expected/observed finding, exact evidence, HMI image and inconclusive result. Show HTML/PDF export. | “The engineer gets a bench report with findings, screenshots, source evidence and remaining checks. Here, the stale-display check is inconclusive, and a citation issue remains visible. We retain partial attempts too, so the report reflects what was observed.” |
| **2:40–2:50** | Title, payoff, repository/evidence link. | “The goal is fast, useful bench testing from engineering information. Our model, connection and controller interfaces are separate; this demonstration uses Muse Wonder and CODESYS. The reports and supporting traces are in the repository.” |

## The minimum recording you need

Capture five short segments rather than an uninterrupted full campaign:

1. Spec/preparation/plan: one parameter and one check, tied to the actual selected project.
2. Normal operation: controller causality and one completion.
3. Adaptive investigation: first result, Muse's new question, second PLC result. **This is the hero.**
4. Actual received HMI frames and an acknowledged outcome.
5. Report finding → evidence → export, with a visible remaining check.

Record the voiceover separately. Trim words rather than speed-reading. A small transition label identifies separate trials. Do not spend the opening minute describing every subsystem.

## Exact source material

| Segment | Source |
| --- | --- |
| Architecture | [Agnostic diagram](../submission-diagrams/controlsbench-architecture.png); use a brief crop. |
| Normal operation | [M10 explanation](../m10-live-integration.md), `artifacts/m10/2026-11-01T00-58-43-185Z/`; `/m10-replay.html` presents historical measurements. Label newly captured playback as recorded-evidence review. |
| Adaptive result | [W4 PDF](../../evidence/reports/adaptive-plc-investigation.pdf), [HTML](../../evidence/reports/adaptive-plc-investigation.html), campaign `portal-20261103131442735-1`. Original decision/tool trail: [proof note](../w4-live-proof.md). |
| HMI images | Campaign `portal-20261103232137992-1`, `vision-frames/`: `2-2-action.jpg` Start, `2-3-action.jpg` Stop/coast, `3-current.jpg` overload, `4-2-action.jpg` Reset/stopped. [Received overload frame](../../evidence/images/muse-received-overload.jpg). |
| Report | [S2 PDF](../../evidence/reports/muse-hmi-operation.pdf), [HTML](../../evidence/reports/muse-hmi-operation.html). [Partial attempt](../../evidence/reports/partial-hmi-attempt.pdf) is separate. |

## Boundaries to keep accurate

CODESYS Control Win is the executing PLC runtime; no physical PLC CPU or machinery is shown. The HMI is locally served, not native CODESYS WebVisu. A newly recorded replay/report review is not original live footage. Prepared-conveyor live proofs do not qualify every uploaded world; complete the selected-world live handoff before presenting that as one accepted end-to-end run.

Keep detailed architecture, library internals, transport benchmarks, other vendors, PID/filtering and local-model work in the repository. The viewer should leave able to say: **“Muse built the machine's external behavior, actively tested its controller, and showed the engineer evidence.”**
