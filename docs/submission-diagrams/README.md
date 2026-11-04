# ControlsBench Muse — submission diagrams

Open index.html for the gallery. Every diagram has an editable SVG master, PNG and Mermaid source, plus caption and claim notes.

The primary architecture is **agnostic interfaces with populated demo choices**. The main boxes say AI model adapter, Connection adapter, Controller platform and PLC integration adapter. Smaller Demo selection labels contain Muse Wonder / Meta API, OPC UA, CODESYS Control Win and M8 demo FB. Those are the current configuration, rather than definitions of the product architecture.

1. controlsbench-architecture: the product's component and evidence flow.
2. controlsbench-live-loop: generic execution and adaptation pattern, with the actual conveyor investigation confined to an example strip.
3. controlsbench-plc-integration: common raw-I/O/session semantics and platform-specific library implementations.

Other adapter bindings require implementation and qualification; the diagrams do not claim all vendor support exists. The reusable Core0.2.0.0 is compiled, not deployed. The optional sink gate and AO support are prototype capabilities. Native PLC scan, model reasoning and connector cadence stay independent.

Rebuild the masters: node scripts/build-submission-diagrams.mjs
Render PNGs and hash manifest: node scripts/render-submission-diagrams.mjs

The reusable generation brief is ../submission-diagram-prompts.md.
