# M8 PLC lane handoff

**A–D passed on the running PLC; both independent audits passed.** WebVisu is deferred. RESULTS.md records proof and limits.

- New project: `codesys/conveyordemo.project`, build 8001 / interface 1. SHA-256 `6c2a1eb6c9c83485b75cb9bcefc1be237a94c8727ecf8098ad57a4d680516628`.
- Versioned ST: `source/`. All ten IDE objects match the files; official MCP precheck and full compile returned no diagnostics.
- Contract: `signal-map-v1.json`, `m8-conveyor-1.0.2`. Original 20 raw inputs / five authentic outputs plus sequenced operator/WCS requests and controller status. Actual opaque UA IDs, paths, types and access are retained per run.
- Primary evidence: `evidence/2026-10-31T18-45-47-430Z-All/`: 104 acknowledged images, A/B/unknown/runout-misroute, Stop, failed divert, Reset; nine audit checks.
- Supplemental motor/overload evidence: `evidence/2026-10-31T18-50-43-488Z-B/`: seven audit checks.
- Reproduce with SMOKE.md and the masked `run-smoke.ps1`. No .env loading or model API exists in this path.

Hardware is the cold default. Simulation owns the complete raw image and enters at zero. The retained slot/epoch/sequence/boot handshake runs first in the application task. Connector loss holds the image and exposes stale without a machine fault. Updates stay at the qualified 10 Hz limit.

The controller implements modes and sequenced Start/Stop/Reset/Auto, motor/overload and divert supervision, single-carton A/B/runout, late/unavailable-route exceptions, exactly-once observed-exit completion, faulted abort, counts, WCS offer/ack/completion acknowledgement, and raw encoder rollover/scaling. The external world owns coast and actual feedback.

The server exposes 68 intended read-only fields as writable. The user authorized proceeding without writing them; the runner allowlist and artifact audit enforce that direction. Server read-only enforcement is unproven. Counter resets look like rollover to the diagnostic decoder; physical speed/travel across resets is unqualified. The accepted smoke is methodical live raw-I/O evidence, not a continuous world campaign or new timing qualification.

M8-E requires manual native visualization authoring, unsupported by the official MCP. WEBVISU.md supplies exact minimal controls/bindings; no screen or HMI-video proof is claimed.

Accepted testing ends Stopped with motor off, simulation still selected, and the last normal input image held. Closing the operator test session clears its credential buffer; ConnectorStale subsequently asserts as designed. It is not a machine fault or a return to hardware.

The frozen `gngnf.project` remains SHA-256 `2e9774d1782e82fff0a9383779be517ee94afc1a48cdfcdce6ee6c5fa31a73b7`. No M0–M7 evidence, `src/live`, campaign/UI lane, or root handoff was edited. Reproduce M7 using its own frozen fixture, not this new controller.
