# ControlsBench Muse

ControlsBench Muse is a controls-engineer workstation concept for autonomous bench testing of executing PLC logic. Muse generates a behaviorally sufficient external world from a functional specification and raw I/O contract, operates the system under test, adapts its investigation, and preserves traceable evidence.

## Current proof status

Gates A and B passed on 2026-10-29 using the same untouched `muse-wonder-1.0` behavioral world:

- Wonder generated a complete TypeScript conveyor world, manifest, assumptions, and tests.
- Strict compilation and eight Wonder-authored physical tests passed after one compiler-test self-repair.
- Independent CP-0 through CP-4 checks passed: package integrity, zero-image startup, drive causality, raw encoder behavior, carton geometry, sensor derivation, physical deceleration, and stationary hold.
- Independent CP-5 through CP-7 checks passed without another model call: actual-position routing to A, missed-A runout, B routing, unassigned runout, sensor stuck/bounce, missing drive feedback, divert jam, and fault cleanup/recovery.
- The results are in `artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-a-result.json` and `gate-b-result.json`.

This is surrogate/contract evidence only. It does **not** prove CODESYS, OPC UA, a real PLC interceptor, active campaign reasoning, blind diagnosis, hot reload, or the product UI.

## Verify locally

Requires Node.js 22 or newer.

```powershell
npm install
npm run typecheck
npm test
npm run proof:gate-a
npm run proof:gate-b
```

`proof:generate`, `proof:repair`, and the targeted repair commands make paid Meta Model API calls. They require a local `.env` containing `MODEL_API_KEY` and should not be run merely to verify the preserved package.

## Proof structure

- `src/proof/contracts.ts` — generated-world and instrumented-context contract
- `src/proof/world-context.ts` — generic raw I/O, time, seeded randomness, evidence, entities, activity, and scheduling chassis
- `src/proof/manifest.ts` — independent manifest validation and semantic signal lookup
- `scripts/generate-world-package.js` — bounded Wonder package generation
- `scripts/run-gate-a.js` — independent CP-0 through CP-4 runner
- `scripts/run-gate-b.js` — independent CP-5 through CP-7 routing and fault runner
- `scripts/repair-world-package.js` — preserved compiler/test repair loop
- `artifacts/generated-world/` — generated source, tests, assumptions, lineage, repair history, and checkpoint result
- `docs/first-proof-contract.md` — staged proof contract and later gates
- `docs/architecture-decisions.md` — authoritative design decisions and repair guardrails

The older `src/core`, `src/connectors`, `src/providers`, and `src/server.js` files are historical exploratory scaffold, not the accepted generated-world architecture.

## Behavioral repair rule

A failing test is not automatically permission to rewrite simulated physics. Before a behavior repair, classify whether the failure is an accepted-requirement violation, a defect against a declared assumption, an unresolved assumption, or a faulty test oracle. Ambiguous physics goes back to the engineer. Compiler and structural repairs may remain automatic within hard budgets.
