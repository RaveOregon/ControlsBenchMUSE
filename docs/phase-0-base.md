# Phase 0 shared M10 base

Date: 2026-10-31. The `m10-base` Git tag identifies the verified common starting point for the next lanes. All lanes should branch from that tag after fetching it. Phase 0 integrates existing work and records scope; it does not claim a new live PLC or paid Muse run.

## Included work

- M0-M7 measurement and live closed-loop evidence.
- M8 conveyor demo controller and audited methodical live smoke (`40a544c`).
- M9 campaign runtime, ledger, schemas, offline proofs and UI contract (`f1a5420`).
- Remediated engineering portal from `ui/campaign-workspace` (`0897bc5`).
- Core promotion: Muse-generated operating machine view and actual HMI observation tile. Muse HMI operation is the first stretch.

## Verification on the merged checkout

- Root TypeScript check: pass; runtime tests: 31/31 pass.
- UI TypeScript check and Vite production build: pass; UI tests: 40/40 pass.
- M9 offline proof: pass for normal/adaptive fake campaigns and all 88 preserved M7 acknowledgements; zero paid calls. Evidence: `artifacts/m9/2026-10-31T19-12-51-652Z/`.
- Existing M8 primary and supplemental evidence audits: 9/9 and 7/7 checks pass. Original audit files and PLC projects retain their frozen content.
- UI dependencies installed from `ui/package-lock.json` with `npm ci`; no dependency versions changed.

The build includes a separately loaded 3.30 MB preserved-fixture chunk (231 KB gzip), appropriate for current replay development; the later live host should load only the data it needs. No production server or live PLC was operated during this convergence.

## Lane contracts and ownership

| Lane | Owns | Handoff gate |
|---|---|---|
| A — live integration | Reusable M8 OPC UA connector, operator/WCS actions, controller observations, deterministic M10 runner/audit | Generated continuous world runs A/B/runout/failed-divert against M8 with attributable raw commits and PLC responses; then enable bounded Wonder |
| B — portal and HMI | Campaign host, M9 projection/report adapter, acknowledged command transport, actual HMI session/capture producer and tile | Live portal follows authoritative M9 state and real HMI frames/actions with timestamps, freshness and evidence links |
| C — generated machine view | View package schema, validator, isolated read-only host component, Muse generation/provenance and artifact | Spec-derived machine artifact follows world/PLC snapshots, supports evidence selection, and handles unknown/stale state |

Lane C owns its new generated-view host module and tests; Lane B owns mounting that module in the portal. Agree the read-only snapshot interface before either edits the other's files. Use separate branches/worktrees and focused commits. One integrator merges shared package/configuration changes.

Only one lane operates the live CODESYS runtime at a time. Lane A coordinates access; manual WebVisu authoring/redeployment must be scheduled with it and recorded as a new tested project/build where applicable. Preserve existing PLC and evidence snapshots. Keep all raw updates within the qualified 10 Hz operating point.

Use `docs/m9-ui-contract.md`, `src/campaign/contracts.ts`, and the M9 projection/report as campaign truth. Use the actual flattened `src/live` coordinator records for raw commit mapping. Resolve exact M8 IEC paths/types using `codesys/demo/signal-map-v1.json`; per-deployment node IDs are discovered and retained.

## Completion gates after this base

1. Deterministic end-to-end live rehearsal through the M8 controller and M9 runtime.
2. Portal host convergence with requested/applied/rejected command evidence.
3. Bounded Wonder-directed live campaign with an evidence-driven follow-up and report.
4. Required generated operating view and actual HMI observation tile verified together.
5. First stretch: Muse operates the same HMI session and verifies screen/PLC congruence.

Read `hackathon-stretch-goals.md` for full feature proof gates and deferred frontier work. The broader arbitrary-machine visualization platform remains deferred; the conveyor generated artifact and narrow reusable host are the accepted hackathon scope.
