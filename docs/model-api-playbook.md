# Model API Playbook

This playbook translates the official Meta Model API cookbook patterns into the ControlsBench architecture.

## What We Are Proving

ControlsBench must show that a frontier model can turn an accepted controls specification into a useful virtual commissioning campaign while deterministic software remains responsible for safety, execution, measurement, and proof.

Muse may:

- propose executable plant behavior and experiments;
- control all simulated field inputs on the sequestered bench;
- generate, modify, and execute experiment code inside a disposable bench runner;
- reset, branch, accelerate, and replay campaigns;
- choose the next experiment and create new fault strategies without a pre-enumerated scenario list;
- interpret grounded evidence and explain likely causes;
- decide when additional evidence is needed.

Muse may not:

- silently alter the PLC program under test during a validation campaign;
- bypass trace capture, action journaling, or snapshot/restore;
- invent pass/fail facts, counts, timestamps, or requirement coverage;
- declare the campaign complete without deterministic acceptance checks;
- directly replace the hard-timed PLC exchange loop with autoregressive token generation.

## Recommended Architecture

1. **Deterministic runtime** exchanges I/O with the PLC and enforces safety and timing limits.
2. **Evidence engine** derives counts, transitions, timing measurements, invariant results, and exact trace references.
3. **Campaign ledger** records every proposal, authorization, side effect, observation, and terminal outcome in append-only form.
4. **Muse campaign agent** has broad authority inside a disposable, fully instrumented bench environment.
5. **Independent completion oracle** decides whether requirements and coverage goals have been satisfied.

Muse should reason between experiments, not on every PLC scan.

## Workstation and Optional Self-Hosted Lane

ControlsBench is an engineer-workstation product, not an embedded edge controller. The first product path therefore uses the strongest suitable model, hosted Muse Wonder, while keeping the PLC adapter, behavior runtime, evidence engine, and safety boundary local on the workstation.

The relevant self-hosted Meta model is **Muse Glimmer**, not Llama. Glimmer is a 30B multimodal agent model distilled from Muse Spark and designed for a single capable GPU. A Q4 deployment has been measured at about 24.1 GiB at one request and 16K context, so a practical product target is a workstation with at least 32 GB of GPU memory and additional system headroom. The present development machine's 8 GB RTX 2080 Super is not a realistic Glimmer host.

Muse Spark Open is not a workstation model. It has 816B total parameters with 42B active parameters, and published deployment examples use eight datacenter GPUs. It is outside the ControlsBench desktop deployment target.

An optional Glimmer backend could serve customers that require offline or on-premises processing and could make the experiment loop faster, continuous, and free of network dependence. It should implement the same provider interface and tool contracts as Wonder so self-hosting is a deployment choice rather than a second product architecture. A Glimmer feasibility spike is a hackathon stretch differentiator after the first complete end-to-end proof.

No language model should generate individual I/O values on every PLC scan. Muse operates at experiment and meaningful-event boundaries while the deterministic runtime continues uninterrupted. Adapt explicit plant-model parameters such as delays, speeds, debounce, travel time, and fault probabilities during a campaign; do not modify model weights live.

Model specialization is a real product opportunity, not merely deployment polish. Collect campaign rollouts and train versioned Glimmer LoRA/QLoRA adapters for controls terminology, tool use, experiment choice, and causal diagnosis. ControlsBench is also unusually well suited to GRPO because the bench supplies programmatic rewards: requirement coverage, injected-fault discovery, correct diagnosis, evidence validity, experiment count, and time-to-discovery.

Do not rewrite the base model on every PLC observation. Instead, update a small adapter between episodes or campaigns, compare it with the frozen incumbent on held-out seeded benches, and promote it atomically only when it wins. This is continual bench learning while preserving reproducibility and rollback. Meta's published Glimmer QLoRA experiments used roughly 27--29 GiB of GPU memory, so post-training requires a substantially larger GPU than the current development machine and may need a second GPU or a pause between inference and training.

## Bench Autonomy Posture

The sequestered bench should be permissive. The agent may create arbitrary simulated faults, write and execute experimental helpers, alter the virtual world's structure and parameters, run repeated or accelerated trials, and pursue unexpected hypotheses. We should not reduce that capability to a fixed menu of canned tests.

The remaining boundaries exist for scientific validity and recovery rather than paternalistic safety:

- the PLC program under test is immutable during a campaign, with repair mode treated separately;
- every action and world-model revision is timestamped and attributable;
- campaigns begin from restorable snapshots and can be killed or reset;
- generated code runs inside the disposable bench environment rather than the developer workstation host;
- the runtime preserves hard-timed I/O even while the agent reasons or retrains;
- conclusions remain independently checkable against the trace.

Within that envelope, let the agent explore aggressively.

## Model Calls

Use `muse-wonder-1.0` with high reasoning for:

- initial model and experiment generation;
- ambiguous failures with competing hypotheses;
- selecting the next experiment when evidence dependencies matter;
- final engineering synthesis.

Do not spend Wonder/high reasoning on deterministic calculations, scan-by-scan control, formatting, or simple retrieval. A smaller model can be evaluated later for low-risk summaries, but only against a ControlsBench-specific fixture set.

Use the Responses API as a stateful reasoning chain across an investigation. Preserve the response lineage with `previous_response_id`, while keeping the authoritative state in the campaign ledger rather than relying on model memory.

## Prompt and Context Design

Prompt caching is automatic and matches identical leading tokens. Arrange each request in this order:

1. stable developer instructions and safety policy;
2. stable tool and structured-output schemas;
3. accepted controls specification and I/O contract;
4. compact current campaign state;
5. volatile evidence, trace window, and current question.

Do not put timestamps, random request IDs, or changing observations near the beginning. Track cached-token ratios. Use a stable `prompt_cache_key` for a campaign only if routing at scale warrants it; do not create a unique key for every call.

A large context window is not permission to send the entire trace repeatedly. Re-read exact source evidence when needed and normally send:

- the compact campaign state;
- deterministic evidence summaries;
- the smallest exact trace window that supports the decision;
- references allowing the runtime to retrieve more evidence.

## Tool Loop Guardrails

The agent loop is bounded by:

- maximum turns per experiment decision;
- token and dollar budgets;
- wall-clock deadline;
- stuck/repetition detection;
- operator cancellation;
- an allowlist of experiment and evidence tools.

Every tool argument is schema-validated and then semantically validated. Structured output guarantees shape, not truth.

Handle all valid model outcomes: one tool call, multiple tool calls, a text response, malformed or unsafe arguments, and a request for unavailable evidence.

## Evidence and Truth

Critical measurements come from deterministic code, not model arithmetic over a large raw trace. The evidence engine should calculate:

- transition counts and exact timestamps;
- dwell and response times;
- sequence and state-machine violations;
- invariant results;
- requirement and experiment coverage;
- uncertainty caused by missing or unreadable evidence.

Muse receives those values with trace references. Any numeric or pass/fail claim in its output must be validated against the evidence ledger before it appears in the report.

The completion test is an external oracle: required artifacts exist, required experiments ran, acceptance checks pass, and every conclusion has evidence. Model confidence or a prose statement of completion is never sufficient.

## Side Effects and Recovery

Before applying a fault, world change, operator command, or other side effect, append:

- stable action ID and intended effect;
- originating experiment and requirement;
- policy/risk classification;
- authorization result;
- preconditions and expected observation.

Afterward, append the observed result or terminal failure. If execution is interrupted after intent is recorded but before a terminal record exists, inspect the real PLC/world state before retrying. Never assume the action did or did not occur.

## Reliability

- Retry only rate limits, server failures, timeouts, and connection failures.
- Use capped exponential backoff with jitter.
- Do not retry authentication, invalid-request, or not-found failures without changing the request.
- Branch on HTTP status and error type; the error `code` may be null.
- Add a circuit breaker after repeated Model API failures.
- Keep deterministic PLC exchange running safely while model decisions are paused.
- Inspect rate-limit headers and record latency, input tokens, cached tokens, output tokens, reasoning tokens, and estimated cost for every call.

## Generated Behavior Safety

Prefer a bounded, schema-validated behavior IR interpreted by our runtime. If arbitrary generated code is ever supported, a child process alone is not a sandbox. It needs a hardened isolation boundary, minimal tool access, resource limits, timeouts, and independent post-run validation.

## Replay and Regression

Exact live PLC timing need not be reproducible, but evidence processing must be. Preserve append-only events and build golden fixtures that can replay offline without a model, network, or PLC. Compare the reconstructed campaign state and conclusions with expected projections.

## Immediate Build Order

1. Define the executable behavior IR and semantic validator.
2. Define the allowlisted campaign tools and append-only action/evidence ledger.
3. Implement the deterministic behavior runtime and evidence engine.
4. Add offline golden replay fixtures and completion checks.
5. Connect Wonder through a bounded tool loop.
6. Run one end-to-end requirement-to-evidence scenario and measure quality, latency, cached-token use, and cost.

## Cookbook Sources

- [Prompt caching](https://github.com/meta-models/meta-model-cookbook/blob/main/01_api_fundamentals/05_prompt_caching.ipynb)
- [Error handling](https://github.com/meta-models/meta-model-cookbook/blob/main/01_api_fundamentals/09_error_handling.ipynb)
- [Agent loop basics](https://github.com/meta-models/meta-model-cookbook/tree/main/02_agent_patterns/01_agent_loop_basics)
- [Interleaved reasoning](https://github.com/meta-models/meta-model-cookbook/tree/main/02_agent_patterns/02_interleaved_reasoning)
- [Managing context](https://github.com/meta-models/meta-model-cookbook/blob/main/02_agent_patterns/03_managing_context/README.md)
- [Alert fatigue copilot](https://github.com/meta-models/meta-model-cookbook/tree/main/02_agent_patterns/05_alert_fatigue_copilot)
- [Sandbox execution](https://github.com/meta-models/meta-model-cookbook/tree/main/03_use_cases/07_sandbox_execution)
- [Append-only audit log](https://github.com/meta-models/meta-model-cookbook/tree/main/04_muse_code/01_append_only_audit_log)
- [Deterministic replay](https://github.com/meta-models/meta-model-cookbook/tree/main/04_muse_code/02_deterministic_replay)
- [Goal tracking](https://github.com/meta-models/meta-model-cookbook/tree/main/04_muse_code/07_goal_tracking)
