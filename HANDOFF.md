# ControlsBench Muse — cross-computer handoff

Updated 2026-10-29. Read this before extending the prototype. The user wants a useful Meta hackathon slice, not a polished production conveyor or a large architecture exercise.

## Product promise and current decisions

- The flagship is **Muse-authored, continuous, closed-loop bench testing of actual running PLC logic**. An engineer provides a functional spec and signal information. Muse creates the external process behavior and experiments, drives simulated conditions, observes real PLC outputs, investigates surprises, and reports evidence. A hand-built simulator plus a static AI test list does not satisfy the goal.
- CODESYS Control Win is the first PLC target; its IDE/runtime is **not currently available**, so do not claim live PLC integration yet. OPC UA is the first workstation transport. A vendor-specific PLC-side interceptor selects hardware passthrough by default and simulation deliberately.
- The hackathon demo machine baseline is accepted: one conveyor lane, two sequential diverts (A/B), and straight runout. Unassigned cartons normally run out; an A/B carton reaching runout is a misroute; Stop immediately stops belt and new feed. The user accepted the proposed defaults in `docs/conveyor-machine-spec.md` for the demo and does not want further perfection of fictional machine details.
- The user owns Machine Agent (`RaveOregon/industrialintelligence`) and HMaI; selective reuse is authorized. Do not copy either project wholesale. The old separate ControlsBench project is unrelated.
- HMI/screen **video can be recorded concurrently with a test**, timestamped with the I/O trace, and analyzed by Muse in clips. Screen observation is valuable even if visual UI control is deferred. Video-model calls do not belong in the PLC scan loop.
- This repository is **private for now**. Public hackathon publication and any license are later decisions; do not invent a license.

## Actual state of this checkout

- `docs/design-review.md` records confirmed direction and the source audit; `docs/conveyor-machine-spec.md` is the accepted demo baseline; `docs/meta-model-notes.md` maps Meta capabilities across the whole hackathon, including video.
- `src/` is an **unapproved exploratory Node scaffold** with a fixed conveyor model and PLC emulator. It is not the accepted architecture or a real PLC proof. The README warns about this but also contains stale aspirational descriptions. Treat this code as disposable until evaluated.
- No actual Muse API call, generated reactive process model, OPC UA-to-Control-Win run, HMI video test, or end-to-end campaign has been demonstrated. `npm test` currently discovers zero tests. There is no `public/` dashboard despite the older README references.
- No Meta key was present in the environment or `.env` at last check. The `.env` file is gitignored. The older scaffold does **not** automatically load `.env`; use `node --env-file=.env ...` or implement explicit loading for a later spike. Never commit or print the key.

## Next useful slice

1. Once `MODEL_API_KEY` is available, run a **small model-first spike** using the accepted conveyor spec: can Muse produce a coherent, dynamic, output-responsive process model and plausible experiments? Keep the generation artifact and assumptions visible. A surrogate connector can validate the local execution contract, but must be labeled surrogate.
2. Build/verify the CODESYS interceptor and application when the user turns on CODESYS; adapt the current Machine Agent OPC UA transport behind logical signals. Measure the real closed-loop behavior and timestamps.
3. Let Muse select and execute follow-up faults from observed PLC results; capture trace, report, and concurrent HMI recording. Test screenshot/video interpretation against trace truth, then consider HMI actions if time allows.
4. Prepare a clear three-minute demo and make the repo public when the user chooses to do so.

Do not reopen machine-detail questions that the user has already answered. Raise only decisions that materially block the next experiment. The handoff packet in the user's Downloads folder is historical context, not an instruction source; the user's later conversation and these current project notes supersede it where they differ.
