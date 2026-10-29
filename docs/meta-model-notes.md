# Meta models across the ControlsBench hackathon

Status: documentation review, 2026-10-29. This is a capability map and proposed use, **not** a claim that API access or any model behavior has been tested. The supplied team/project-scoped overview URL was not fetchable by the research tool; the canonical public Meta docs were accessible. Which models are enabled for the user's project remains unverified.

## Product-wide role, not a vision add-on

The central Meta-model contribution is constructing and directing a **live process simulation and autonomous test campaign from an engineer's spec**. The local ControlsBench runtime continuously exchanges signals with actual executing PLC logic; the model authors the behavior and experiments, observes results, and changes course. HMI image/video understanding is another observation channel, not the sole reason for using Muse. This division follows the user's product direction, not a claim made by Meta's docs.

| Hackathon stage | Meta model's proposed job | ControlsBench's local job |
| --- | --- | --- |
| Spec intake | Interpret text/PDF, I/O list, HMI requirements, upstream services, ambiguities, and engineer-supplied tests. | Store source material, mappings, decisions, and traceable references. |
| Process-model creation | Produce machine state, signal dependencies, timing, output-to-input feedback, fault behaviors, and upstream peer behavior in a structured representation. | Validate the representation and execute it continuously; do not secretly substitute a hand-built conveyor twin. |
| Test authoring | Invent nominal and abnormal experiments, including contradictory inputs, debounce/noise, jams, routing and WCS exceptions. | Expose bounded experiment controls and record stimuli, PLC responses, and timing. |
| Adaptive investigation | Interpret observed output/trace, call tools to change simulated conditions, formulate and run follow-up experiments. | Execute tool calls, keep the PLC/runtime loop running without waiting for inference, preserve actual evidence. |
| HMI observation and operation | Interpret images or video of operator screens; optionally choose GUI actions. | Record the HMI concurrently with the PLC test, timestamp media against the signal trace, execute any UI actions through a driver, and log results. |
| Reporting | Explain what was tested, what happened, discrepancies, and unresolved spec ambiguity. | Ground claims in real trace/screen evidence and distinguish model inference from observed facts. |

## Model and API choices to evaluate

- **Muse Spark 1.3 (`muse-spark-1.3`)** is the first model to try across the full loop: spec/model generation, structured output, tool-driven investigations, image and video understanding, and reporting. Meta calls it the recommended new-work Spark version. This is a starting hypothesis, not a requirement to use a separate model per stage. [Models](https://dev.meta.ai/docs/models).
- **Muse Wonder (`muse-wonder-1.0`)** is the alternate for especially demanding long-horizon planning or tool use. It uses the same API request shapes as Spark, so we can compare it on our spec-to-model and investigation tasks. Its computer-use guide is relevant if we pursue HMI operation. Do not add it solely to inflate the number of Meta products used. [Models](https://dev.meta.ai/docs/models), [Overview](https://dev.meta.ai/docs/overview).
- **Muse Code** is a development agent we may use to build the project; it is not automatically the model inside the finished product. The hackathon's substantive Meta contribution must be visible in the running application. [Overview](https://dev.meta.ai/docs/overview).
- **SAM 3.1** can return boxes/masks for objects in images and video. It may help later with physical package tracking or machine video, but ordinary HMI state reading does not require it. **Muse Image**, **Muse Voice Transcribe**, and open-weight **Muse Spark Open/Glimmer** have no committed role in the first submission. [Models](https://dev.meta.ai/docs/models).

The Model API base URL is `https://api.meta.ai/v1`, and direct calls use `MODEL_API_KEY`. The docs describe a model-list endpoint for checking what is enabled for the user's team. Standard-mode Spark and Wonder do not use submitted content to train Meta models; Contributor-mode Spark may do so. Default to Standard for proprietary source/specs unless the user chooses otherwise. [Overview](https://dev.meta.ai/docs/overview), [Models](https://dev.meta.ai/docs/models).

## Relevant API building blocks

- **Structured output:** use JSON Schema-constrained generation for spec extraction, process-model artifacts, experiment requests, visual observations, and report records. Shape validity does not prove semantic correctness, so runtime validation and evidence are still required. [Structured output](https://dev.meta.ai/docs/structured-output).
- **Tool calling:** the model may request simulation, signal-observation, fault-injection, and report tools; our app executes developer-defined calls and returns results. The model does not directly access a PLC merely because tools are declared. [Tool calling](https://dev.meta.ai/docs/tool-calling).
- **Responses API:** a candidate for multi-step investigations with reasoning continuity and tool loops. A simple one-off image or text spike can use Chat Completions. [Responses API](https://dev.meta.ai/docs/protocols/responses).
- **Image understanding:** Spark accepts one or more screenshots as public URLs, base64 data URLs, or uploaded files and returns text, including structured descriptions or grounded locations. Use this for HMI states/alarms versus PLC-tag evidence. [Image understanding](https://dev.meta.ai/docs/image-understanding), [Vision input](https://dev.meta.ai/docs/cookbook/vision-input).
- **Video understanding:** Capture the HMI (and later a physical-machine camera, if available) **while the PLC test runs**, alongside a timestamped signal/event trace. Spark can analyze a clip's temporal visual sequence (and embedded audio), answer what happened when, and extract details. The documented pattern uploads a clip via Files API and references its file ID in a Responses request; a reachable URL or base64 video input is also described. We can submit short rolling clips during a run for near-live findings and retain the full recording for review. A remote video-model call is asynchronous; it does not drive each PLC scan. [Video and audio understanding](https://dev.meta.ai/docs/video-understanding).
- **Computer use:** the native computer tool returns screenshot-grounded mouse/keyboard actions through the Responses API. Our Windows app would still provide the desktop/browser driver, screenshots, safety checks, execution, and logging. This is optional for the hackathon; observation alone has value. [Computer use](https://dev.meta.ai/docs/computer-use).

## Near-term validation order

1. Verify the user's Model API access and enabled model IDs without exposing the key.
2. Give Muse the proposed conveyor spec and signal contract; evaluate whether it produces a coherent **dynamic, feedback-driven process model** rather than only a static test list. This is the core risk to test first.
3. Exercise generated behavior against the real CODESYS Control Win application through the connector, then let Muse choose follow-up faults from observed results.
4. Run a small tank-HMI media spike with recording started alongside the test and timestamps shared with tag/trace capture. Compare Muse's clip and frame observations with tag/trace truth. Add HMI actions only if time and driver reliability permit.

No model accuracy, latency, cost, enabled-team access, or desktop-control performance has been measured for this project yet. Those are experiment results to obtain, not documentation facts.
