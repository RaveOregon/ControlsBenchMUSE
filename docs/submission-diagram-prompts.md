# Claude prompts for ControlsBench Muse submission diagrams

Use one Claude chat. Paste the shared brief once, then request each diagram. Use the first diagram as the main submission architecture visual; the other two support the demo or README.

## Shared brief — paste first

```text
You are creating submission-quality architecture diagrams for ControlsBench Muse, a Meta hackathon product for controls engineers. Use this brief as the factual source. Produce editable SVG artifacts with selectable text and a matching Mermaid source where useful. Keep the diagrams visually consistent. Work directly toward finished artifacts without a design-approval round.

Product: an engineer supplies a functional machine specification and I/O information. Meta Muse Wonder 1.0 generates a reactive machine-world model, plans experiments, requests meaningful interventions, observes the real PLC's response, chooses further investigations from evidence, and produces findings and a report.

Architecture facts:
1. Meta API: Muse Wonder reasons and uses tools. It does not generate each individual PLC scan or stream directly into PLC I/O.
2. Engineer workstation: the ControlsBench app shows plan, progress, live evidence, findings and report. It has separate tiles for the spec-derived machine visualization and the actual captured operator HMI.
3. Workstation execution: the campaign runtime manages model/tool turns and evidence. An isolated child process continuously executes the generated TypeScript world: motion, inertia/deceleration, cartons, sensors, actuators, faults and raw signal production. World continuity and I/O streaming continue independently of model request latency, according to explicit hold/continue/condition-deadline leases. Holding world time does not stop the PLC's scan or timers.
4. Connector: a transport-independent logical-signal boundary; the implemented demo uses OPC UA at its qualified 10 Hz operating point. It exchanges complete raw input images, authentic PLC outputs/status and applied-image acknowledgements using epoch/sequence correlation. A WCS test adapter also exercises route offers and completion acknowledgements through the controller's supervisory interface.
5. PLC: the demo runs actual CODESYS Control Win application logic. Its integrated interceptor selects hardware inputs by default and workstation raw inputs in simulation mode, before PLC application scaling/filtering/conditioning. Show encoder counts as a concrete raw-input example. Application outputs are tapped for world feedback. Physical outputs pass through normally; optional engineering overrides suppress selected hardware sinks without hiding the authentic application commands.
6. Installation requires an editable/rebuildable PLC project. It is an intentional library/FB integration step, not an attachment to an untouched protected binary.
7. Evidence: simulated physical truth, requested stimulus, acknowledged raw image, PLC observations, HMI pixels/actions and model interpretation remain distinct. Timestamped, hash-linked records support findings and an auditable report.

Status as of this brief:
- Proven live: generated world ↔ streaming engine ↔ OPC UA ↔ actual CODESYS logic; normal A sorting in an earlier campaign; Muse-driven drive-feedback fault 12, an evidence-dependent D1 contradiction follow-up producing fault 21, clear/reset recovery, two findings and 31 verified PLC claims in the latest campaign.
- Actual browser HMI observation is working and was tested live. This demo HMI is served by a local Node service reading the PLC; it is not native CODESYS WebVisu.
- Muse HMI operation: separately live-proven for Auto/Start/Stop/Reset and UI-01/02/03; UI-04 stale/disconnect remains inconclusive and one extra frame citation was invalid. It uses images from the same browser session displayed in the portal and labelled controls resolved to trusted CDP clicks. Requested action, delivered input, page receipt, PLC ack and rendered result are separate evidence.
- Reusable ControlsBench Core library 0.2.0.0: built/compiled, not runtime-validated or deployed in the live demo. DI/AI/DO/AO blocks and versioned adapter/mapping contracts are the intended reusable integration architecture. The active demo still uses its integrated FB interceptor.
- Other PLC vendors, faster connectors, acquisition/recording for PID tuning and signal processing are future directions, not demonstrated capabilities. A native CODESYS file-based-storage library pilot compiled; full demo-project migration has not occurred.

Visual direction: polished technical product design, white/light background, navy text, purple for Muse, blue for workstation execution, teal for PLC/I/O, amber for evidence. Simple geometric shapes, deliberate spacing, few crossing arrows, restrained icon use. Avoid stock isometric clouds, decorative gears, random AI imagery, walls of text and tiny labels. Use explicit arrow labels. Make statuses clear with text and line style, not colour alone. Prefer a 1920×1080 canvas and readable text around 22–28 px.

Deliver each diagram as an editable SVG; also export PNG if your environment supports it. Include a short caption, alt text, and a brief check that the visual's claims match the status above. Keep implementation detail in the technical diagrams rather than overwhelming the main product visual. Do not invent measured speed, latency, accuracy, vendor support, cost savings, certification or production readiness.
```

## Prompt 1 — main architecture diagram

```text
Create Diagram 1: “ControlsBench Muse — from specification to evidence.”

Audience: hackathon judges who should understand the product in ten seconds. This is the main submission architecture visual.

Show three clear boundaries:
- Meta API: Muse Wonder 1.0.
- Engineer workstation: engineer spec + I/O input, ControlsBench app, campaign runtime, isolated generated-world execution, connector, and evidence/report.
- PLC target: raw I/O interception, actual CODESYS application, and output capture.

Make the main closed loop obvious: PLC outputs → generated world evolves → simulated raw inputs → interceptor → PLC application → new outputs. Muse connects to the campaign runtime with “plans and interventions” outward and “observations and findings” back. Model reasoning belongs outside the continuous I/O loop.

Within the app, show two distinct views: “Generated machine view” and “Actual HMI session.” Give the app a concise “Plan · Progress · Evidence · Report” label. Show the actual HMI’s separate supervisory connection to the PLC. Add a small dashed Muse-to-HMI action path labelled “Separate live operator proof; coverage limits apply.”

Label the active connector “OPC UA · qualified 10 Hz demo.” Label the PLC “CODESYS Control Win · actual application logic.” Label its active integration “Demo interceptor FB.” Use a small footer to explain that reusable library deployment and other vendor adapters are separate next steps.

Limit this overview to roughly 10–12 primary boxes; group details rather than drawing every class. Use a strong left-to-right reading order with the feedback loop clearly returning. Suggested caption: “Muse authors the world and investigations; ControlsBench executes raw signals against the real controller and preserves the evidence.”

Deliver controlsbench-architecture.svg, PNG if available, a short caption, alt text and optional Mermaid source.
```

## Prompt 2 — live execution and adaptive investigation

```text
Create Diagram 2: “How a live ControlsBench investigation works.”

Use a readable swimlane/sequence diagram with five lanes: Muse Wonder, campaign runtime/evidence, isolated world engine, OPC UA connector, actual PLC application. Show the engineer's spec/I/O submission as the starting input.

Separate generation/setup from the running loop. Muse generates the reactive world package; the workstation validates it and starts execution. The PLC scan and workstation streaming then continue while Muse reasons between semantic decisions.

Show the feedback cycle: coherent raw image commit → PLC consumes it → applied epoch/sequence ack plus authentic outputs/status → world updates physics and sensors → next image. Use a loop region labelled “Continuous workstation execution; demo transport 10 Hz.” Do not depict the PLC scan as 10 Hz.

Overlay the actual latest live campaign as a higher-level investigation:
1. Muse chooses drive-feedback failure.
2. Engine changes the simulated field response; PLC reports fault 12 and motor command off.
3. Muse clears the condition and requests Reset; PLC returns Stopped without auto-restart.
4. After that returned evidence, Muse proposes a new D1 contradictory-limit experiment.
5. Engine applies it; PLC reports distinct fault 21.
6. Muse clears/resets, records two findings with 31 verified PLC claims, and completes the report.

Make the adaptive choice visibly occur after its motivating observation. The runtime executes the chosen tools; it does not invent the test strategy or patch the PLC.

Add a compact timing note: “Model requests are asynchronous. Hold freezes world evolution, not PLC scan/timers; continue and condition/deadline policies are bounded.” Keep it legible without exposing source-code details.

Put the separate historical normal-sort proof in a small note, not in the latest campaign sequence. Keep HMI-agent operation out of this proven-live sequence; a dashed side note may identify its separate scoped live proof.

Deliver controlsbench-live-loop.svg, a Mermaid sequence source, PNG if available, caption and alt text. Ensure the result reads at presentation size without zooming.
```

## Prompt 3 — PLC integration and reusable ecosystem

```text
Create Diagram 3: “One raw-I/O contract, platform-specific PLC integration.”

Audience: a controls engineer or technical judge evaluating the product architecture and expansion path. Use a clear primary PLC data-path diagram and a smaller ecosystem/roadmap inset.

Primary data path:
- Hardware DI/AI image enters DI/AI interceptors.
- A mode selector passes hardware values in normal mode and chooses the complete workstation raw input image in simulation mode.
- Selected raw inputs flow into the existing PLC application, including its own scaling, filtering, input conditioning, sequence and control logic.
- Authentic application DO/AO commands are tapped back to ControlsBench's generated world.
- The same commands continue to hardware outputs by default. An optional physical-sink override is a separate downstream gate; it does not rewrite the commands observed by the workstation.
- Show “BOOLs · native raw numeric/device values · encoder counts” at the simulation boundary. Keep the AI and world physics outside the PLC blocks.

Attach a small session/diagnostics block: simulation selection, boot identity, epoch/sequence, applied-image acknowledgement and connection freshness. Include “Link loss: hold last simulated image + bench connection diagnostic.” Do not show a mandatory machine/HMI alarm or automatic force-to-zero on disconnect.

Ecosystem inset:
“Functional spec + I/O information → versioned logical-signal contract and mapping → vendor adapter/library → ControlsBench connector/runtime.” Communicate that portability comes from common semantics with platform-specific implementations.

Distinguish these statuses accurately:
- Live demo: CODESYS with the integrated interceptor FB and OPC UA connector.
- Compiled prototype: ControlsBench Core 0.2.0.0 reusable DI/AI/DO/AO/session/observation library; not deployed in the live demo.
- Future: other PLC vendor adapters, alternative faster transports, and acquisition/recording extensions for PID tuning and signal processing.

Show version/configuration/provenance metadata associated with contracts, mappings and library builds. Add an unobtrusive integration prerequisite: “Editable/rebuildable PLC project required.” The diagram should communicate a small repeatable engineering hook, not an AI replacement for PLC logic.

Deliver controlsbench-plc-integration.svg, optional Mermaid source, PNG if available, caption and alt text. Avoid giving future capabilities the same visual treatment as the proven demo.
```

## Optional refinement prompt — after reviewing all three

```text
Review the three diagrams as one submission set. Check that they tell one coherent story: specification → Muse-authored reactive world → authentic PLC loop → evidence-driven investigation → report.

Make typography, colour roles, arrow semantics, boundaries and component names consistent. Remove duplicated explanation and unsupported claims. Keep the main diagram simple enough for a three-minute demo, and move low-level detail into the integration diagram. Confirm that the actual HMI is distinct from the generated machine visualization and that scoped HMI-agent proof, undeployed reusable library and future vendor/analysis capabilities are labelled accurately. Return revised SVGs and a short list of substantive corrections.
```
