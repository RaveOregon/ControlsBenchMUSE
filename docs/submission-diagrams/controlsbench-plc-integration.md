# One raw-I/O contract, platform-specific PLC integration

**Caption:** ControlsBench selects simulated raw inputs before the PLC's existing scaling and control logic, and returns authentic output commands to the generated world. The live CODESYS demo uses an integrated interceptor FB; the reusable library is a separate compiled prototype.

**Alt text:** A ControlsBench workstation supplies a complete simulated DI/AI image to a mode selector inside an actual CODESYS PLC. Hardware raw inputs pass through by default. The selected raw image enters existing PLC scaling, filtering, sequence and control logic. Authentic DO/AO commands feed the workstation world and normally continue to hardware. A separate optional gate changes only the physical output sink. Boot identity, epoch/sequence, applied-image acknowledgements and freshness accompany the signal boundary. Link loss holds the last simulated image and exposes a bench diagnostic. Below, a versioned contract and mapping connect the specification to platform adapters and the runtime. Solid, dashed and dotted cards distinguish the live demo, compiled-only Core 0.2.0.0 library and future vendor/transport/PID-analysis extensions.

**Use:** The SVG is the presentation-ready 1920×1080 artifact with editable text. The Mermaid source preserves the technical semantics but is not intended to reproduce the exact slide layout.

**Claim check:**

- The active demo is CODESYS Control Win with the integrated interceptor FB and qualified 10 Hz OPC UA transport. This is not a claim that the PLC scans at 10 Hz.
- Simulation owns the complete raw input image. PLC scaling, filtering and control logic remain under test; encoder counts are supplied as raw values.
- Authentic output commands are captured before any optional physical-sink override. Physical output passthrough remains the default.
- Output status is explicit: Boolean DO capture is live in the M8 demo; AO support and the optional physical-sink gate are Core compiled-prototype capabilities, not deployed live features.
- Link loss retains the last simulated image and provides a bench connection diagnostic, rather than depicting automatic zeroing or a required machine alarm.
- ControlsBench Core 0.2.0.0 is compiled only and not deployed in the live demo. Its live validation is not inferred from integrated-FB evidence.
- Other vendor adapters, faster transports, acquisition/recording, PID tuning and signal processing are future directions.
- Intentional integration requires an editable/rebuildable PLC project.

**Sources:** `docs/submission-diagram-prompts.md`, `docs/architecture-decisions.md`, and `.worktrees/plc-library/codesys/library/HANDOFF.md` / `CAPABILITIES.md`.

**Verification:** SVG parsed as XML; PNG rendered at 1920×1080 in a separate temporary headless Chrome profile and visually inspected after technical review. Text is selectable in the SVG. Mermaid source is provided semantically and has not been rendered; its layout may differ.
