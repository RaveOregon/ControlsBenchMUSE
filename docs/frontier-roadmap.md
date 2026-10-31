# Frontier Roadmap

This is the deliberate boundary-pushing track for ControlsBench. It supplements the end-to-end hackathon slice; it is not a reason to reduce the product to a conventional scripted test harness.

## Thesis

A sequestered PLC bench is a rare environment where an agent can receive broad authority, generate its own experiments, modify its simulated world, observe objective consequences, and improve from verifiable rewards. ControlsBench should exploit that advantage.

## 1. Persistent Local Muse Agent

Target Muse Glimmer on a 32 GB or larger workstation GPU. Keep the agent resident beside the PLC adapter so it can:

- consume events and trace windows without uploading the complete stream;
- maintain an uninterrupted campaign loop without API cost or network jitter;
- hot-reload world-model revisions between episodes;
- create and execute new experiment helpers in the disposable bench workspace;
- escalate unusually difficult synthesis or diagnosis to hosted Muse Wonder.

The model does not need to emit every scan's I/O. It authors or revises an executable policy and plant model; the hard-timed runtime executes that artifact at scan rate. This combines model creativity with real-time behavior.

## 2. High-Autonomy Bench Mode

Give Muse broad control of the simulated side of the bench:

- all simulated field inputs and timing;
- arbitrary fault composition, including faults not named in the original spec;
- resets, snapshots, branches, accelerated time, and repeated trials;
- generation and execution of analysis or experiment code;
- modification of the virtual plant topology and parameters;
- selection of follow-up experiments from observed outcomes.

Keep the device under test immutable during validation, record every action, and preserve a physical/operator kill switch. These constraints protect the experiment; they do not constrain the agent to a canned scenario list.

## 3. Adaptive World Model

Continuously estimate explicit world parameters from the trace: transport delays, actuator latency, sensor debounce, timing distributions, fault probabilities, and other observable dynamics. Let Muse decide which experiment best disambiguates competing parameter or topology hypotheses.

Show before/after beliefs, the evidence that caused each update, and a verification experiment. This is the first form of visible online learning.

## 4. Adaptive Muse Weights

Use the immutable Muse Glimmer base plus versioned adapters:

1. Record full campaign trajectories: prompt/state, tool calls, observations, outcomes, and evidence.
2. Build supervised examples from accepted expert behavior and successful Wonder campaigns.
3. Train a QLoRA adapter for ControlsBench tool use and domain behavior.
4. Define a programmatic reward for campaign performance.
5. Train with GRPO when enough diverse seeded tasks exist.
6. Evaluate candidate adapters against the frozen incumbent on held-out benches.
7. Promote, roll back, or retain adapters atomically with complete provenance.

Candidate reward components:

- requirement and transition coverage gained;
- injected fault found and correctly localized;
- causal diagnosis supported by trace evidence;
- novel valid experiment or fault discovered;
- fewer experiments and less elapsed bench time;
- penalties for unsupported claims, repeated failed actions, and missed faults.

Adapter updates may run between episodes or asynchronously on a second GPU. Updating weights on every scan is neither necessary nor the most useful definition of online learning.

## Hackathon Stretch Gates

The current ordering is in `hackathon-stretch-goals.md`: the generated machine view and actual HMI observation are core demo features. Muse HMI operation, blind live diagnosis, and live world hot reload precede local-model and weight-adaptation stretches. This roadmap remains the longer-term compute/training track.

After one complete Wonder-driven spec-to-evidence campaign works:

1. Add a Glimmer-compatible local provider interface and measure the same campaign locally on suitable rented or borrowed hardware.
2. Enable high-autonomy bench mode with generated experiment code, snapshot/restore, and unrestricted simulated fault composition.
3. Implement the programmatic campaign reward and export training-ready trajectories even if training cannot be completed during the event.
4. If suitable GPU capacity and time remain, run a small QLoRA or GRPO experiment and compare the adapter with the base model on held-out seeded campaigns.

The stretch result is valuable even if it is only a measured feasibility report plus a training-ready dataset. A successful tuned adapter is the upside case.

## Evidence Required

- local time-to-first-action and action cadence;
- campaign success and fault-discovery rate;
- coverage gained per experiment;
- base versus adapted model on identical held-out seeds;
- reward curve and examples checked for reward hacking;
- full action and model-version provenance.
