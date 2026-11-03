# How a live ControlsBench investigation works

**Caption:** Muse chooses the experiments and evidence-dependent follow-up; the workstation continuously maintains the generated world and exchanges raw signals with the real PLC. The proven campaign progressed from drive-feedback fault 12 to a newly chosen D1 contradiction test, fault 21, recovery, and an auditable report.

**Alt text:** Five lanes separate Muse Wonder, the campaign runtime and evidence, an isolated world engine, OPC UA and the actual CODESYS PLC application. Setup starts with the engineer's specification and I/O information, followed by a Muse-authored world package and workstation validation. A continuous loop carries complete raw images into the PLC and returns applied acknowledgements and authentic outputs to the world and evidence journal. Below it, six numbered cards show the actual live investigation: choose drive-feedback failure, observe fault 12 with motor off, clear and reset to Stopped without restarting, choose a new D1-limit contradiction test from that returned evidence, observe distinct fault 21, then recover and report two findings containing 31 verified PLC claims.

**Files:** `controlsbench-live-loop.svg` is an editable 1920×1080 vector artifact with selectable text. `controlsbench-live-loop.mmd` provides a more detailed Mermaid sequence using the same responsibilities and evidence ordering. The PNG is a rendered presentation preview, when present.

**Claim check:**

- The API model makes semantic decisions outside the continuous workstation I/O loop.
- The qualified 10 Hz value describes the OPC UA demo transport; it does not describe or accelerate the PLC scan.
- Holding world evolution does not hold PLC scan execution or timers; continue and condition/deadline policies are bounded.
- The D1 contradiction experiment is shown after the motivating drive-feedback/recovery evidence.
- The latest live campaign's two findings and 31 exact PLC claims are scoped evidence, not certified or exhaustive coverage.
- Normal A sorting belongs to a separate earlier live campaign.
- Muse HMI operation passed a separate live checkpoint (UI-01/02/03 supported, UI-04 inconclusive, one extra invalid frame citation); it is not inserted into this earlier campaign.

**Source:** shared submission brief and Prompt 2 in `docs/submission-diagram-prompts.md`; live proof record in `.worktrees/product-integration/docs/w4-live-proof.md`. No PLC, application or model execution is part of diagram generation.

**Visual verification:** SVG parsed as XML and was rendered to a 1920×1080 PNG in an isolated headless Chrome process. The PNG was inspected for readable labels, clipping, arrow/label collisions and correct evidence ordering. The Mermaid source was reviewed as text; a Mermaid renderer was not available in this lane.
