# Hackathon Stretch Goals

Updated 2026-10-31. The user promoted the Muse-generated operating machine view and actual HMI observation tile into the core demo scope. S1 and S3 below retain stable identifiers for existing lane prompts, but are now required features. Other goals extend the main M10 path.

## Main path — not a stretch goal

The submission must first prove one complete loop:

1. load the accepted specification, signal contract, generated world, and M8 controller identity;
2. connect the generated world to the actual running PLC at the qualified 10 Hz cadence;
3. run normal A, B, and unassigned-runout behavior plus a failed-divert case;
4. let Muse choose and execute at least one evidence-driven follow-up;
5. preserve raw stimulus, applied acknowledgement, PLC response, model activity, finding, limitations, and report;
6. show the campaign truthfully in the ControlsBench portal;
7. show a Muse-generated, state-bound machine view derived from the specification and declared world assumptions (S3);
8. show the actual PLC HMI/WebVisu session in a separate tile with timestamped observation and evidence (S1).

No stretch goal may replace this with a surrogate, fixed animation, static test list, or HMI-only demonstration.

## Core promotions and ranked stretch ladder

| Rank | Stretch goal | Demo impact | Dependency / risk |
|---|---|---|---|
| S1 — CORE | Actual WebVisu and live HMI portal tile | Required demo feature | Manual CODESYS visualization work and a real browser/capture session |
| S2 | Muse operates and verifies the HMI | Signature feature | Medium; depends on S1 and reliable screen/action evidence |
| S3 — CORE | Muse-generated, state-bound machine view | Required demo feature | One bounded generation and a narrow view-host contract |
| S4 | Blind live fault diagnosis with adaptive follow-up | Very high | Medium; depends on the complete M10 live loop and truth isolation |
| S5 | Live world revision with validated hot reload | Frontier | High; existing surrogate proof must be connected to the live campaign safely |
| S6 | Persistent local Glimmer provider | Frontier / deployment | High; requires a suitable 32 GB-class GPU or external infrastructure |
| S7 | Training-ready reward loop and adapter experiment | Moonshot | Very high; useful dataset/reward export is acceptable even without successful training |

## S1 — CORE: Actual WebVisu and live HMI portal tile

Create the minimal CODESYS WebVisu specified in `codesys/demo/WEBVISU.md`. It must expose stable Start, Stop, Reset, and Auto controls and visibly distinguish command from feedback, machine mode, active fault text, current carton/route/disposition, counts, and connector-stale state.

The ControlsBench Campaign workspace shows the actual HMI alongside the simulated-world view. Prefer the configured WebVisu URL when embedding is permitted; otherwise mirror a persistent controlled browser session. The tile shows source/session identity, capture timestamp, frame age, connection state, and recording state. On loss, hold the last frame under a stale/disconnected overlay. Never recreate the HMI from OPC UA tags and present that recreation as the actual screen.

**Pass gate:** an engineer operates Start, Stop, Reset, and Auto on the visible WebVisu; timestamped frames/actions are attached to the same campaign timeline as the corresponding OPC UA command acknowledgement and PLC state change. The portal can expand the HMI without losing the campaign context.

## S2 — Muse operates and verifies the HMI

Give Muse a controlled HMI-observation/action tool, separate from raw-I/O and WCS tools. Muse sees the same live HMI session shown in the portal, chooses a labeled control, performs an action, and evaluates the resulting screen state together with the PLC evidence.

The evidence model keeps four facts separate:

1. Muse requested an HMI action;
2. the browser delivered a click or input to the identified control;
3. a later frame showed a visible HMI result;
4. OPC UA showed the corresponding PLC acknowledgement/state transition.

Muse must not infer PLC success solely from a visual animation, nor call the HMI defective solely because the PLC did not accept an invalid command. Screen, action, PLC, and world clocks remain correlated but distinct.

**Pass gate:** Muse performs at least Start, Stop, and Reset through WebVisu, verifies command/feedback congruence through both pixels and PLC evidence, and records a grounded UI-01 through UI-04 result. The portal plays back the exact session the agent operated.

**Amazing version:** introduce one honest HMI discrepancy—such as stale status, missing alarm presentation, or a control without visible acknowledgement—without revealing it to the diagnosing context. Muse detects the disagreement, runs a follow-up, and reports whether the issue is HMI presentation, command delivery, controller behavior, or insufficient evidence.

## S3 — CORE: Muse-generated, state-bound machine view

Ask Muse to author the conveyor's lightweight SVG/HTML machine artifact from the accepted specification, equipment identities, declared geometry assumptions, signal contract, and view-binding schema. Preserve the prompt, response, model identity, duration/cost accounting, assumptions, hashes, validation, and any repair lineage.

The artifact is a process/world view, not the PLC HMI. It receives read-only snapshots from the host and may emit equipment-selection requests. It has no credentials, direct PLC access, physics ownership, or command authority. Motion, sensors, actuators, faults, unknown values, and stale values come from the recorded/live snapshot rather than independent animation.

**Pass gate:** the portal loads the generated artifact, validates all required bindings, follows both replay and live state, and opens relevant evidence when the user selects equipment. A failed view leaves the campaign running and falls back visibly rather than fabricating state.

**Amazing version:** show the preparation transition from imported spec to Muse-authored world plus machine view, then run the same artifact against the real PLC campaign. This makes generality visible without attempting a CAD or 3D platform.

## S4 — Blind live fault diagnosis with adaptive follow-up

Commit a hidden fault truth before execution, then start a fresh diagnosing Muse context that cannot see the injection mechanism, fault parameters, hidden world entities, or earlier authoring response. The diagnosis context receives only the evidence an engineer could receive: raw/applied inputs, PLC outputs/status, world-visible observations allowed by the experiment, and optional HMI evidence.

Muse must distinguish a hypothesis from a verdict and may create a new experiment when the first trace cannot disambiguate competing causes. Reveal and score truth only after the diagnosis is sealed.

**Pass gate:** against the actual M8 controller, Muse identifies the relevant device/symptom, creates and executes at least one non-pre-scripted follow-up, changes its confidence or hypothesis from evidence, and receives a deterministic score for localization, mechanism, evidence validity, and unsupported claims.

## S5 — Live world revision with validated hot reload

When live evidence reveals a world-model omission or bad assumption, Muse prepares a candidate world revision while the incumbent continues or the coordinator deliberately holds the current image. Compile and contract-test the candidate, migrate or explicitly reset state, activate it at a coordinator boundary, and roll back automatically if activation or shadow health fails.

This stretch is about adapting the external world, not editing the PLC program under test. A failed PLC requirement is not by itself authority to rewrite physics.

**Pass gate:** preserve before/after world hashes, reason for revision, state-migration disposition, activation time, evidence continuity, and rollback behavior. Demonstrate one useful live revision and one rejected/rolled-back candidate without losing the valid campaign record.

## S6 — Persistent local Glimmer provider

Implement the existing `CampaignProvider` contract for Muse Glimmer and run the same bounded campaign fixture locally on suitable hardware. The local model chooses experiments at meaningful boundaries; it does not generate scan-by-scan I/O. Hosted Wonder remains available for escalation.

**Pass gate:** compare local versus hosted time-to-first-action, action cadence, valid-tool-call rate, campaign completion, fault discovery, and unsupported-claim rate on identical seeded campaigns. Record model/build/hardware provenance. The current 8 GB development GPU is not a credible target; use suitable 32 GB-class GPU capacity or label the result a feasibility plan.

## S7 — Reward loop and adaptive Muse weights

Export complete campaign trajectories and compute a programmatic reward from requirement coverage, valid evidence, injected-fault discovery, correct localization, novel valid experiment choice, elapsed experiments/time, and penalties for unsupported claims or repeated invalid actions.

The first deliverable is a training-ready dataset, held-out seeded evaluation set, and reward-hacking review. If appropriate GPU/time remains, train a small versioned Glimmer QLoRA or GRPO adapter between episodes and compare it with the frozen base model. Never update model weights on each PLC observation or promote an adapter without a held-out win and rollback path.

**Pass gate:** reproduce reward calculation from preserved trajectories and compare base/candidate behavior on held-out seeds. A credible dataset and evaluation pipeline count as a completed stretch even if training is not run during the hackathon.

## Recommended execution order

1. Complete repository/UI convergence and M10-A connector binding.
2. Build the required S1 WebVisu/HMI observation and S3 generated machine view in parallel with M10 integration.
3. Run the deterministic live rehearsal, then the core Wonder-directed M10 campaign with both views and grounded results.
4. Add S2 HMI operation as the first stretch; it operates the same observed session and verifies screen/PLC congruence.
5. Add S4 blind diagnosis if the live campaign is stable.
6. Attempt S5 only with enough time to preserve and test rollback.
7. Treat S6/S7 as post-core frontier work requiring suitable compute.

## Explicitly deferred unless the core exposes a need

- EtherNet/IP or another faster transport;
- PLC-resident scheduled-pattern playback;
- a general CAD, 3D, or scene-editor product;
- production multi-vendor PLC support;
- PID/filtering optimization and physical-hardware commissioning;
- multi-carton controller redesign solely to add another demo scenario.

These remain legitimate product paths, but they contribute less to the current submission than proving that Muse can create, operate, observe, adapt, and explain one complete real bench campaign.
