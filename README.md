# ControlsBench Muse

ControlsBench Muse is a controls-engineer workstation for AI-assisted bench testing of executing PLC logic. Muse generates an external machine world from a functional specification and raw I/O contract, operates the system under test, adapts its investigation, and preserves traceable evidence.

## Submission — start here

**[Evidence and readable reports](evidence/README.md)** · [Architecture diagrams](docs/submission-diagrams/README.md) · [Three-minute demo plan](docs/submission/demo-three-minute-cut.md)

The live demonstration uses **Muse Wonder 1.0, an isolated workstation world engine, OPC UA and CODESYS Control Win**. The model chose a new fault investigation after observing the controller, operated the browser HMI in a separate trial, and produced evidence-linked findings. The evidence folder provides PDFs, portable HTML reports, original results/audits and a claim-to-source map, including limitations and a partial attempt.

Model, connection and controller bindings are separate interfaces. CODESYS/OPC UA are the demonstrated choices; additional vendor support and deployed reusable-library adoption remain future work. The new app-based specification-upload workflow is in final integration and needs its own selected-world live acceptance.

## Integrated application — current entry point

On `codex/product-integration`, run `npm ci`, `npm --prefix ui ci`, then `npm start`. This builds and serves the combined portal, generated machine view and captured browser HMI at `http://127.0.0.1:5190/` (HMI service `:5191`). The default is an explicitly labelled zero-cost preview with a fake connector/provider and recorded HMI fixture. Start Campaign begins the preview; opening the application alone does not start it. Ctrl+C shuts down its services.

See [docs/product-integration.md](docs/product-integration.md) for the exact full-path command, recorded review, live M8 launch, verification and outstanding live-Wonder adapter gate. The historical proof sections below retain their original scope and do not supersede that integration status.

## Historical first proof — generated world and surrogate checks

Gates A, B, C, and D passed on 2026-10-29 using the same `muse-wonder-1.0` behavioral world:

- Wonder generated a complete TypeScript conveyor world, manifest, assumptions, and tests.
- Strict compilation and eight Wonder-authored physical tests passed after one compiler-test self-repair.
- Independent CP-0 through CP-4 checks passed: package integrity, zero-image startup, drive causality, raw encoder behavior, carton geometry, sensor derivation, physical deceleration, and stationary hold.
- Independent CP-5 through CP-7 checks passed without another model call: actual-position routing to A, missed-A runout, B routing, unassigned runout, sensor stuck/bounce, missing drive feedback, divert jam, and fault cleanup/recovery.
- CP-8 sealed a blind diagnosis before truth reveal. Wonder localized the entry sensor and explicitly described a stuck-high mechanism, but correctly retained an `insufficient_evidence` outcome because the raw trace alone could not exclude an object physically held at entry.
- CP-9 proved active investigation: Wonder authored and executed a bounded belt-motion experiment through the same world, moving diagnosis confidence from 0.35 to 0.78 while exposing the decisive discrepancy.
- CP-10 proved compile, state-preserving shadow migration, atomic activation, valid revision evidence, and rollback of a deliberately failing successor. Two wrapper-contract defects were caught before acceptance and repaired without changing conveyor physics.
- CP-11 proved request timeout, repair/campaign cost stops, world-heartbeat stall detection, legitimate condition-wait classification, and preservation of the active healthy world.
- CP-12 deterministically audited final hashes, generation and hot-reload lineage, blind-truth commitment, 3,802 preserved trace events, model-call accounting, and checkpoint verdicts. Disclosed rejected-artifact gaps remain warnings rather than being hidden.
- Gate D accepted a CODESYS/OPC UA measurement plan with a double-buffered epoch/sequence commit handshake, concrete timing tiers, disconnect behavior, and stop conditions. Two bounded Wonder reviews cost a conservative $1.00; an unsupported first verdict was rejected and four findings from the retry were incorporated.
- The results are in `artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/gate-a-result.json` through `gate-d-result.json`.

This is surrogate/contract evidence only. It does **not** prove CODESYS, OPC UA, a real PLC interceptor, HMI observation, or the product UI.

## Verify locally

Requires Node.js 22 or newer.

```powershell
npm install
npm run typecheck
npm test
npm run proof:gate-a
npm run proof:gate-b
npm run proof:gate-c:verify
npm run proof:gate-d
```

`proof:generate`, `proof:repair`, and the targeted repair commands make paid Meta Model API calls. They require a local `.env` containing `MODEL_API_KEY` and should not be run merely to verify the preserved package.

## Proof structure

- `src/proof/contracts.ts` — generated-world and instrumented-context contract
- `src/proof/world-context.ts` — generic raw I/O, time, seeded randomness, evidence, entities, activity, and scheduling chassis
- `src/proof/manifest.ts` — independent manifest validation and semantic signal lookup
- `scripts/generate-world-package.js` — bounded Wonder package generation
- `scripts/run-gate-a.js` — independent CP-0 through CP-4 runner
- `scripts/run-gate-b.js` — independent CP-5 through CP-7 routing and fault runner
- `scripts/run-gate-c.js` — bounded paid CP-8 through CP-11 agentic proof runner
- `scripts/continue-gate-c.js` — local verification of preserved Gate C artifacts without API calls
- `src/proof/hot-reload.ts` — snapshot/migration/shadow-check/atomic-activation coordinator
- `src/proof/budget-guard.ts` — request, repair, campaign, heartbeat, and condition-wait limits
- `scripts/run-gate-d.js` — deterministic CP-12 provenance, trace, verdict, and plan audit
- `docs/codesys-opcua-measurement-plan.md` — accepted M0-M7 connector measurement contract
- `scripts/repair-world-package.js` — preserved compiler/test repair loop
- `artifacts/generated-world/` — generated source, tests, assumptions, lineage, repair history, and checkpoint result
- `docs/first-proof-contract.md` — staged proof contract and later gates
- `docs/architecture-decisions.md` — authoritative design decisions and repair guardrails

The older `src/core`, `src/connectors`, `src/providers`, and `src/server.js` files are historical exploratory scaffold, not the accepted generated-world architecture.

## Behavioral repair rule

A failing test is not automatically permission to rewrite simulated physics. Before a behavior repair, classify whether the failure is an accepted-requirement violation, a defect against a declared assumption, an unresolved assumption, or a faulty test oracle. Ambiguous physics goes back to the engineer. Compiler and structural repairs may remain automatic within hard budgets.
