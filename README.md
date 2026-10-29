# ControlsBench Muse

> **Current status:** this is an unapproved, untested exploratory scaffold. The browser dashboard and tests described below have not been implemented, and the fixed conveyor/investigator do not establish AI-created simulation. The current source audit and proposed foundation are in [the design review](docs/design-review.md). The conveyor demo baseline is now accepted, but live Muse and PLC integration have not been run. For a truthful cross-computer status and next steps, read [HANDOFF.md](HANDOFF.md). The original scaffold notes below are historical intentions, not verified capabilities.

ControlsBench is a competition prototype for AI-authored, closed-loop PLC testing. An engineer supplies a functional specification; Muse Spark turns it into a bounded process model and investigation plan; the runtime continuously drives simulated field signals into executing control logic and reacts to the outputs.

This repository currently includes a dependency-free vertical slice:

- a continuously running conveyor plant model;
- a separate PLC control-program emulator used only for workstation development;
- an adaptive investigation loop that establishes a baseline, injects sensor chatter, forces a stuck-sensor jam, and verifies recovery;
- a live evidence stream and judge-friendly dashboard;
- a Meta Model API provider that can compile a natural-language specification into the declarative runtime model;
- a connector contract ready for a real OPC UA adapter.

The development connector is deliberately labeled **PLC emulator** in the UI. It does not pretend to be the competition's final real-PLC proof. The next hardware milestone is to replace that connector with CODESYS Control Win over OPC UA while keeping the simulation runtime and UI unchanged.

## Run

Requires Node.js 22 or newer. No package installation is needed.

```powershell
npm start
```

Open <http://localhost:4310>. Press **Start autonomous run** to watch ControlsBench establish normal behavior, choose fault experiments from observations, and verify recovery.

## Connect Muse Spark

Copy `.env.example` to `.env`, remove the accidental example space if present, and set `MODEL_API_KEY`. Environment variables can also be supplied directly. The server uses Meta's OpenAI-compatible Responses endpoint and defaults to `muse-spark-1.3`.

Without a key, **Build with Muse** uses the bundled conveyor model so the whole demo remains runnable. The UI always shows whether a model came from Meta or the bundled fallback.

## Test

```powershell
npm test
```

## Repository map

- `src/core/simulation-engine.js` — deterministic closed-loop execution and evidence ledger
- `src/core/demo-model.js` — bundled declarative model and source specification
- `src/core/investigator.js` — observation-driven experiment policy
- `src/connectors/simulated-plc.js` — replaceable development connector
- `src/providers/meta-model-api.js` — Muse Spark model compiler
- `public/` — live competition dashboard
- `docs/architecture.md` — contracts, boundaries, and next vertical slice

## Scope truth

Working now: live process simulation, closed-loop control interaction, adaptive experiments, evidence, report generation, and optional Muse-authored model compilation.

Not implemented yet: OPC UA transport, CODESYS interceptor blocks, HMI computer use, authentication, or hosted deployment.
