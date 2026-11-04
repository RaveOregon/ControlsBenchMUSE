# Diagram brief — agnostic interfaces with populated demo choices

Create editable1920×1080 SVGs, PNGs and Mermaid semantic sources for ControlsBench Muse. White background, navy text, purple for model adapters, blue for workstation execution, teal for controller/I/O and amber for evidence. Prefer readable23–28px labels and uncluttered directional arrows.

## Required conceptual structure

The product is platform-neutral through explicit contracts. Show **AI model adapter**, **Campaign coordinator**, **World runtime**, **Connection adapter**, **PLC integration adapter** and **Controller platform** as the primary component names. Put concrete values in smaller **Demo selection** labels: Muse Wonder / Meta API, OPC UA, integrated M8 FB and CODESYS Control Win. Do not replace the generic role with its selected implementation. Other bindings require implementation/qualification; do not list unimplemented vendor logos as supported.

Engineer input is machine specification, typed raw I/O, connected-service contracts and expected behavior. The workstation coordinates generation, project/plan review, world execution, tools, evidence and reporting. Separate generated machine visualization from actual operator-interface capture. HMI actions route through coordinator tools and an interface adapter.

World behavior includes physical/device response and connected-service emulation. Connection adapters translate shared signals/messages to platform-native exchange. PLC library/FB adapters intercept raw inputs before the existing program's scaling/filtering and observe authentic outputs/status. Preserve real PLC scan/timers, hardware passthrough by default, full simulated input ownership and link-loss hold with bench diagnostics. Library layout can be by I/O type, channel or platform-supported centralized wrapper. Physical-sink overrides are an optional platform capability and must not obscure observed commands.

## Three diagrams

1. Product architecture: input, model adapter, app, coordinator, world runtime, connection adapter, controller-platform/library slots and evidence/report. Populate the actual demo choices.
2. Execution pattern: asynchronous model decisions around a continuous raw-signal/service loop and authentic acknowledgements. Use neutral choose/apply/observe/adapt/evaluate/report steps. Put the specific conveyor investigation only in an example strip.
3. Integration contract: generic raw-I/O interception and output observation, platform-specific implementation and selected connector. Explain versioned contracts/mappings/library artifacts; distinguish reusable semantics from vendor implementations.

## Evidence boundaries

The populated CODESYS/OPC UA demo is live-tested at10Hz; this is neither a universal cadence nor the PLC scan rate. A separate Muse W4 campaign demonstrated drive-feedback fault12, recovery, an evidence-dependent D1 contradiction test/fault21, recovery and31 exact finding claims. HMI operation passed a separate scoped checkpoint; stale/disconnect remains inconclusive, and an extra frame citation was invalid. The browser HMI is locally served rather than native WebVisu. Reusable Core0.2.0.0 DI/AI/DO/AO and optional sink override are compiled-only, not deployed. Other platform/transport and acquisition/PID analysis bindings remain extensions. Uploaded-project preparation is currently being integrated; diagram the product responsibilities without claiming every arbitrary input is already live-qualified.

Return SVG, PNG, Mermaid, caption, alt text and concise claim notes. Check rendering for clipped or overlapping labels.
