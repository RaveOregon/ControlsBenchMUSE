# Meta model selection for ControlsBench

Status: decided for the first hackathon slice, 2026-10-29.

## Decision

Use **Muse Wonder 1.0 (`muse-wonder-1.0`) in Standard mode** as the primary ControlsBench model for:

- specification interpretation;
- reactive-world generation and revision;
- experiment planning and adaptive follow-up selection;
- complex trace investigation; and
- evidence-grounded report generation.

Keep the provider/model boundary configurable so **Muse Spark 1.3 (`muse-spark-1.3`) in Standard mode** can later handle proven high-volume or latency-sensitive tasks. Do not add model routing to the first slice. First make the complete workflow correct with Wonder, then benchmark the actual adaptive tool loop before delegating any part of it to Spark.

Do not use Contributor-mode model IDs for imported PLC programs, specifications, traces, or HMI media by default. Standard mode is the selected data-use posture.

## Why

Meta describes Wonder as its most capable API model for complex, long-horizon agentic work, and Spark as the lower-cost, latency-sensitive choice for tighter or higher-volume loops. Both accept the same request shapes and support the Responses API, structured output, tool use, multimodal input, and a 1,048,576-token context window.

ControlsBench's highest-risk model tasks are not classification or chat. They require the model to preserve a detailed engineering contract, separate PLC logic from plant physics, generate a coherent executable world, distinguish facts from assumptions, and choose follow-up experiments from evidence. Capability and instruction fidelity matter more than token cost at this stage.

## Direct project comparison

Both models received the same accepted conveyor specification, developer instructions, strict JSON schema, and `high` reasoning request through `scripts/run-model-spike.js`.

| Measure | Muse Wonder 1.0 | Muse Spark 1.3 |
|---|---:|---:|
| Duration | 163.2 s | 83.0 s |
| Input tokens | 6,972 | 8,046 |
| Output tokens | 19,048 | 16,666 |
| Reasoning tokens | 617 | 3,790 |
| Estimated Standard-mode API cost | $0.4088 | $0.0809 |
| Required field I/O covered | 20 / 20 | 20 / 20 |
| Requirements represented by experiments | 23 / 23 | 21 / 23 |
| Reactive behaviors | 11 | 9 |
| Fault models | 11 | 11 |
| Explicit invariants | 10 | 7 |
| Experiments | 16 | 13 |

Costs are estimates from the published Standard-mode token rates, not billing records.

### Shared strengths

Both models correctly established that:

- the PLC application is the system under test;
- carton motion depends on modeled actual drive behavior;
- actual divert position at the decision point determines the exit;
- photoeyes derive from physical occupancy except during explicit sensor faults;
- Stop freezes cartons and inhibits feed;
- Reset does not restart;
- unassigned runout is normal while an assigned carton at runout is a misroute;
- injected ground truth must remain separate from PLC-visible observations; and
- unspecified thresholds must not silently become acceptance limits.

### Material difference

Wonder produced complete R-01 through R-23 experiment coverage and explicit invariants for stale evidence, ground-truth isolation, and prohibition on scoring TBD thresholds. It also modeled transport failure, WCS irregularities, evidence closure, and adaptive follow-up choices as first-class behaviors.

Spark produced a coherent and useful artifact faster and at roughly one-fifth the estimated cost, but its experiment catalog omitted explicit requirement coverage for:

- **R-10:** stuck/failed photoeye; and
- **R-22:** HMI action/display/PLC-state congruence.

Spark discussed both topics elsewhere, so this was an instruction-coverage miss rather than complete misunderstanding. For the central model-authoring task, Wonder's more complete contract is worth the additional latency and cost.

## Other Meta models

- **Muse Spark 1.2 / 1.1:** superseded for this text-and-vision workflow by Spark 1.3. Spark 1.2 may matter only if an audio-specific limitation in 1.3 becomes relevant.
- **Muse Wonder Full:** unavailable through Model API, so it cannot be the embedded product model.
- **Muse Spark Contributor variants:** substantially cheaper but use submitted content to improve Meta products; not the default for proprietary engineering artifacts.
- **Muse Glimmer:** self-hosted and not needed for the hackathon path.
- **Muse Image, SAM, and Muse Voice Transcribe:** specialized models with no role in the first closed-loop proof. Revisit only for a concrete media requirement.

## Implementation consequence

The default remains:

```text
META_MODEL=muse-wonder-1.0
```

The runtime must read the model ID from configuration rather than hard-code it. A future decision to route bounded, repetitive work to Spark requires a task-specific A/B evaluation against the same evidence and coverage criteria used here. Cost alone is not sufficient.

## Evidence

- Wonder artifact: `artifacts/model-spikes/2026-10-29T14-08-01-990Z-muse-wonder-1.0/artifact.json`
- Wonder metadata: `artifacts/model-spikes/2026-10-29T14-08-01-990Z-muse-wonder-1.0/metadata.json`
- Spark artifact: `artifacts/model-spikes/2026-10-29T14-14-46-340Z-muse-spark-1.3/artifact.json`
- Spark metadata: `artifacts/model-spikes/2026-10-29T14-14-46-340Z-muse-spark-1.3/metadata.json`

## Sources

- [Meta Model API models](https://dev.meta.ai/docs/models)
- [Meta Model API pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits)
- [Meta Model API reasoning](https://dev.meta.ai/docs/reasoning)
- [Meta Model API Responses protocol](https://dev.meta.ai/docs/protocols/responses)
