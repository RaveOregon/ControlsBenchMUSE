# UI portal remediation handoff

Branch: `ui/campaign-workspace`. Initially reconciled with `main` at `cc4395e` in merge `287c979`; UI remediation is `cd3b5e7`. Also merged the additive M9 lane from main `f1a5420` after it landed during verification. Remediation changes are confined to `ui/`; CODESYS files and campaign-runtime implementation were not edited.

Delivered Setup / Campaign / Results, a focused experiment and readable finding, explicit Simulated World vs PLC HMI surfaces, versioned context/assumptions, report coverage/export, collapsible diagnostics, keyboard access, focus management and reduced motion.

P0: V1 maps the real flattened M7 coordinator shape, retaining every image, output, epoch, sequence, cycle and latency. Live commands have request IDs and pending/applied/rejected/timed-out outcomes; confirmation precedes display changes. Raw image and SimulationApplied still require actual observations. Source events and live health share one clock; replay uses its playhead. Completed observations retain their original PLC provenance after health expectations end.

Evidence: 10 Hz passed; 20/50 Hz failed; M4/M5 passed; M6 passed only its reduced 10 Hz scope; M7 passed using the measurement DUT. Final routing requirements remain not run. The schematic is explicitly a diagnostic world projection. HMI remains “HMI not observed/tested” without real timestamped observation. No live values or HMI imagery were fabricated.

Validation:
- UI tests: 40/40, including all 88 preserved M7 acknowledgements and failed/late/timed-out command paths.
- Runtime tests after M9 reconciliation: 31/31; root and UI typechecks passed; production Vite build passed.
- Chrome desktop: Setup context/scope, complete replay, report evidence classes/limitations, focused M7 observation, keyboard device inspection and Escape verified.
- Export verified: 32 campaign checks, 23 final requirements all not run, HMI unobserved, and bounded trace disclosure (12,000 retained of 27,692 received events).
- Screenshots: `docs/screenshots/setup.jpg`, `campaign.jpg`, `world-hmi.jpg`, `results.jpg`.

Walkthrough: Setup → review context/scope → Campaign → Play recorded campaign → inspect devices/evidence/finding → Results → inspect untested requirements / export report. Replay never operates a PLC. See README for the V1 attachment API and external HMI capture interface.

Remaining integration: a real command transport must call the exposed portal bridge and return application acknowledgements; a real HMI URL or controlled capture producer must be configured. The UI supplies these interfaces, not a replacement campaign server. Vision-driven HMI operation is deferred. M7 missing source/server timestamps and quality remain unknown; derived send timing is labeled. In-memory review/configuration resets with page reload.

M9 integration note: `docs/m9-ui-contract.md` and the campaign ledger/projection are now present from main. The portal bridge consumes the unchanged `src/live` coordinator shape; it is not a decoder for `controlsbench.campaign.v1` envelopes. A future host should use the authoritative M9 projection/report and explicitly adapt its commands/evidence to the portal, rather than passing journal envelopes as coordinator records.

Next product slice: [Spec-driven machine visualization and HMI portal](docs/spec-driven-visuals-plan.md). The user confirmed that ControlsBench is machine-independent: Muse must generate a state-bound view during spec ingestion (or reuse supplied diagrams), and the separate HMI tile must show the actual configured/controlled HMI session. This supersedes the original first-proof limit against generated renderer code. The new document is an implementation plan, not a claim that generation or live HMI streaming has shipped.

Hackathon priority update: the user parked the full spec-driven visualization platform for now. The immediate demonstration should use Muse to generate the conveyor visual artifact from the accepted spec, bind it to the existing world/PLC state, preserve generation provenance, and show the actual HMI alongside where connected. See the plan’s “Immediate hackathon scope”; the broader multi-machine gates are deferred.
