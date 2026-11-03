# ControlsBench Muse — submission diagrams

Open `index.html` to review the set. Each diagram has an editable SVG master, a 1920×1080 PNG export, a Mermaid source and a Markdown caption/alt-text/claim note.

| Diagram | Use | Files |
| --- | --- | --- |
| From specification to evidence | Main submission architecture; lead with this in the README or demo | `controlsbench-architecture.*` |
| How a live investigation works | Explain continuous execution and the demonstrated evidence-dependent follow-up | `controlsbench-live-loop.*` |
| Raw I/O and platform integration | Technical detail for controls engineers and the reusable ecosystem | `controlsbench-plc-integration.*` |

Three full-context agents produced the diagrams in parallel. The main agent reviewed all three rendered PNGs and checked the capability labels against the live proof and reusable-library handoff. SVGs parse as XML; each SVG and PNG is 1920×1080. Mermaid is provided as editable semantic source and was not rendered.

The status labels deliberately distinguish the live CODESYS demo, compiled-only reusable Core 0.2.0.0, live-proven HMI operator slice (stale/disconnect inconclusive), and future vendor/transport/analysis extensions. The integration diagram specifically distinguishes live Boolean DO capture from compiled AO support and the optional physical-sink gate. Update these labels only when the corresponding proof or deployment has actually changed.

The editable SVG is the presentation master. Font fallbacks are Segoe UI and Arial; PNG exports preserve the reviewed rendering. No app source, PLC program or live runtime was changed to create these files.

The original common brief and diagram prompts are in `../submission-diagram-prompts.md`.
