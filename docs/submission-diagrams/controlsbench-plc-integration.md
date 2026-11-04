# One integration contract, platform-specific adapters

**Caption:** The connector and PLC-side library share a versioned signal/session contract; the selected demo bindings supply concrete implementations.

**Alt text:** A generated environment sends native raw signals through a configurable connection adapter to generic PLC input interceptors before the existing application. Authentic output observers return commands and status to the world. Optional physical-sink override is separate. Controller and connector slots are populated with CODESYS Control Win and OPC UA, while implementation-status panels distinguish the live M8 demo from compiled reusable Core and future bindings.

**Claim boundary:** The PLC integration may be by I/O type, channel or a centralized wrapper according to platform capability. Hardware passthrough is the default; simulation supplies the full configured input image. Native controller scaling, filtering and sequence logic remain under test. DI/AI/DO/AO describes the contract; only the demonstrated M8 capabilities are live-proven. Core0.2.0.0 and its optional sink gate remain compiled-only. Editable/rebuildable PLC source is required.

**Files:** Editable SVG presentation master, 1920×1080 PNG, and matching Mermaid semantic source. Mermaid is reviewed as text; PNG rendering uses isolated headless Chrome.

**Revision:** Generalized at Steve's request: agnostic connector and platform interfaces with populated demo choices, rather than demo-specific components defining the architecture.
