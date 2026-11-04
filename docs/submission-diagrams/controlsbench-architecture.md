# ControlsBench Muse — agnostic product architecture

**Caption:** A common workstation architecture with selected model, connection and controller-platform bindings.

**Alt text:** Generic AI model adapter, campaign coordinator, world runtime, connection adapter, platform-specific PLC integration and actual controller logic. Separate generated machine and actual HMI views feed a reviewable evidence report. Secondary demo selections populate the slots: Muse Wonder via Meta API, OPC UA, CODESYS Control Win and the integrated M8 FB.

**Claim boundary:** The interfaces are agnostic by design. Named demo selections identify the exercised implementation, not the only possible architecture. Other bindings are not claimed implemented. The reusable Core library remains compiled-only. HMI tools route through the coordinator and interface adapter. The project-preparation workflow remains under integration; this architecture is not a claim that arbitrary uploaded machines are live-qualified.

**Files:** Editable SVG presentation master, 1920×1080 PNG, and matching Mermaid semantic source. Mermaid is reviewed as text; PNG rendering uses isolated headless Chrome.

**Revision:** Generalized at Steve's request: agnostic connector and platform interfaces with populated demo choices, rather than demo-specific components defining the architecture.
