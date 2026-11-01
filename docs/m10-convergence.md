# M10 convergence: M8 campaign, hosted portal and promoted machine view

Branch: `codex/m10-convergence`. Worktree: `C:/Users/steve/.codex/worktrees/m10-convergence/ControlsBenchMuse`.

Integrated lane commits: A `3ab99ff`, B `7886dfd`, C `042cc6a`. Merge commits are `5d67a91` and `4a74296`; the M8 factory is `9f14327`, and the view mount/evidence bridge is `e9b5729`. The root checkout's uncommitted HMI direction documents were preserved. Claude's HMI and Lane C's worktrees were not edited.

The hosted portal can now start the same six-case deterministic M8 campaign that Lane A proved. This integration was verified offline; **no new PLC connection, operation, reset/download or paid call was performed**. The generated SVG/bindings were selected from `artifacts/machine-view/latest.json`, never regenerated or changed.

## Runtime and evidence

`src/host/m8-campaign-factory.ts` implements `CampaignFactory`. It assembles Lane A's M8 connector, `m8WorldBindings`, controller action adapter, coordinator, elapsed-time driver and frozen provenance through `createM10Session`. It uses exactly the host-supplied `CampaignLedger` and `HmiAdapter`; it does not run a second provider or create a parallel ledger.

`HostedCampaign.run()` is an optional executor hook. Fixture factories retain their existing provider loop. M8 uses the single-flight `executeM10Rehearsal`: A sort, B sort, unassigned runout, assigned-runout misroute, Stop/coast/hold, failed divert. Its provider throws if called. Start authorizes this fixed full scope; a deselected/partial scope is rejected before connection. The portal's broader checklist is not a claim that additional requirements were tested.

The original evidence path remains:

1. `action.requested`, followed by one explicit terminal outcome.
2. Controller/WCS receipt (`controller.action`) or world control/effect/entity record.
3. Complete image, exact flattened coordinator `commit.acknowledged`, correlated PLC capture.
4. Derived `world.raw_image`, `plc.acknowledged`, `plc.output` referencing that original source.
5. Experiment activity, exact-evidence findings, deterministic projection and report, all under the same campaign ID.

The host sends cited events before command acknowledgements, deduplicates request IDs and transports its authoritative projection verbatim. POST acceptance remains a receipt, not an applied command. Scope payloads must be boolean-selection objects. The runtime's six action outcomes remain requested/applied/rejected/timed_out/stale/inconclusive.

Pause suspends the executor's current observation and freezes world time while refreshing the held image. Resume continues it once, without replaying Reset/Start or creating another plan. If an intervention was interrupted with uncertain application, Resume is refused with a reconciliation reason. Stop drains the executor, finalizes and holds. Reset acknowledges a zero image in simulation and requires a new campaign; Exit Simulation separately selects **and observes** passthrough. Closing a connector does neither.

The 100 ms driver and connector commit-start limiter retain the 10 Hz ceiling. Elapsed world steps remain bounded at 300 ms, operations at 5 s and initialization at 60 s. No cadence qualification is inferred from offline tests. The accepted budget guard remains visible ($3 warning, $5 hard stop, five-minute model timeout); this factory issues zero model requests and spends zero dollars.

## Generated-view mount

`ui/src/components/GeneratedMachineView.tsx` mounts Lane C's `MachineViewController` in a scripts-only sandboxed iframe, with the controller's nonce/token/CSP and ready/frame acknowledgement handling. A load/validation/runtime failure is visible; a valid contract supplies Lane C's equipment/signal fallback. It never substitutes a new drawn machine.

`ui/src/adapters/machine-view-package.ts` reads `latest.json` at build time and loads only the promoted package's four files. `validatePackage` checks the contract, hashes and preserved world manifest. Current package: `conveyor-demo-baseline.view.386c365a96d8`, directory `2026-11-01T03-07-45-147Z-muse-wonder-1.0-refine-02`.

`workspaceViewSnapshot` calls Lane C's `buildSnapshot` with:

- acknowledged raw inputs and observed PLC outputs;
- coordinator entity publish/remove events, their exact ledger references, and source world time;
- campaign sequence, mode/evidence class, channel quality/observation times and link/hold state;
- channel evidence references and explicit absence of an entity source.

Cartons are **not** reconstructed from the public M9 projection or inferred from PLC signals. Coordinator world records remain engineer-only truth and are not added to blind diagnosis context. Missing entities stay unknown. Equipment/carton selection preserves its evidence references; the inspector can open the original host envelope even when a dense entity record is absent from the bounded timeline.

New M8 observations carry optional verified `outputQuality`. The coordinator's existing flat acknowledgement carries this additive field, including held-image receipts; the strict source validator accepts it. Older flat events remain valid. Historical M10 ledgers contain no per-field quality, so those five PLC channels stay unknown-quality in the view; their exact recorded values remain in the evidence/report. World raw values are identified as acknowledged simulated truth. Bad, unknown, stale, held, disconnected and passthrough states retain Lane C's display rules.

## Reproduce the offline gate

From this worktree:

```powershell
npm ci
npm --prefix ui ci
npm run verify:convergence
```

The verifier records logs, source hashes, source commit, working-tree status, browser and read-only preflight under a new `artifacts/m10-convergence/<UTC>/`. `artifacts/m10-convergence/latest.json` points to its result. Tests run one file at a time to avoid unrelated CPU/browser work triggering the qualified 300 ms observation-gap guard. No timing limit in the live driver is relaxed.

| Check | Result |
|---|---|
| Combined runtime, contract, host and view tests | 66/66 |
| UI tests | 51/51 |
| Runtime / UI / view-under-portal-flags TypeScript checks | Pass |
| Frozen view contract freshness (`--check`) | Pass |
| Vite production build, portal plus read-only M10 replay page | Pass |
| Preserved-M10 mounted browser audit | 13/13 |
| Preserved M10 import | 302 exact acknowledgements, six experiments/findings; A/B entities and evidence selection checked |
| New combined live campaign / actual HMI / Wonder | Not run |

The browser gate uses local Chrome, rendered iframe frames, A/B screenshots, equipment evidence opening, a labeled link-loss presentation probe and a forced runtime-error fallback probe. Selection/fallback probes exercise the host protocol; they are not human HMI actions or new controller evidence. Unit tests additionally check stale-by-age, unknown/bad quality and held/disconnected handling. Edge exited before DevTools on this machine; the verifier and masked launch prefer installed Chrome unless `CONTROLSBENCH_HMI_BROWSER` is explicitly set.

For interactive preserved evidence, run `npm run host` and visit `http://127.0.0.1:5179/m10-replay.html`. The separate page is read-only, uses the production view component and authenticates the original ledger chain. It has no PLC/model/command transport. `npm run proof:convergence:view` repeats the browser audit after building `ui/`.

## Prepare the later live rehearsal

These are launch instructions, **not actions performed during convergence**.

```powershell
npm run host:m8:preflight
# Later, with the runtime owner ready and Claude's HMI service available:
npm run host:m8 -- -OpcUser PLC -HmiUrl 'http://127.0.0.1:5181/?capture=portal#/operation'
```

The PowerShell wrapper prompts for a masked password, passes it only in the server environment, then clears it on exit. Credentials are not portal parameters, URLs, ledger data or command-line arguments. The wrapper runs offline preflight before starting the host. A missing credential is an expected failure of the standalone preflight, not an offline-test failure. The portal binds to loopback; launching it does not auto-start the campaign. Discovery/initial image establishment begins only after **Start Campaign**.

Preflight checks frozen PLC bytes, native OPC package availability, credentials presence, shared runtime lock and legacy operator/watch sessions without contacting the PLC. Native dependencies resolve from the main checkout's existing relay installation; `CONTROLSBENCH_OPCUA_MODULE` can supply another installed module path. It does not inspect live RUN state, credentials validity or the machine baseline.

The shared ownership lease is the main checkout's `artifacts/m10/live.lock`, even from this worktree. A second campaign/CLI owner cannot acquire it. Retained locks after a crash require inspection, not deletion/retry by the launcher. Stop and close confirm disconnection before releasing ownership.

The last saved Lane A proof ended with fault 23/completion 7 and a held simulated image. **Do not assume a fresh baseline or reuse its specialized stale-trial preparation script for this state.** The connector refuses a dirty initial state before simulation writes. A later authorized runtime owner must inspect the current machine and establish a clean stopped/no-fault/no-item/no-pending-completion baseline separately. Do not download/reset the PLC to make the integration pass.

## Claude HMI connection and remaining boundary

Claude's separate HMI branch was inspected read-only at `71007b3`; it is not merged here. Its documented service URL is `http://127.0.0.1:5181/`, pages `#/operation`, `#/alarms`, `#/engineering`; the captured client uses `?capture=portal`. The custom three-page browser HMI is the intended operator surface. Native CODESYS WebVisu authoring is not a prerequisite.

Start that implementation from its own lane using its documented launch procedure. For this six-case campaign it must be an **observer with commands disabled**, shared polling at 1000 ms, and a LIVE PLC identity confirmed through its `/api/identity`. Do not run its separate H2 command runner or `--commands enabled` alongside this factory. Its `auto` policy honors the shared runtime lock, but explicitly disabled commands make this rehearsal's single command owner unambiguous.

Lane B's existing `HmiHub`/controlled browser opens the supplied page, captures the exact rendered bytes and records browser-session/frame identity, URL, timestamps, hashes and delivered engineer input. Use that captured window for page navigation; another HMI window is another client session. The HMI service footer/journal provides its client identity. Check that it says LIVE PLC rather than fixture. The generated view remains a separate surface and has no command authority.

The factory receives the host's runtime HMI adapter; its `capture_hmi_evidence(frame)` returns the same frame reference, verified with an injected capture source. The deterministic six-case oracle itself uses direct sequenced controller/WCS tools, not HMI clicks. Hub periodic frames are available separately; they do not establish screen/PLC congruence. This host's Muse HMI-operation and clip tools remain inconclusive. Claude's richer `PortalSessionBridge`/H2 runner is separately owned and has not been combined or live-qualified here.

Remaining rehearsal work: authorize and inspect the current runtime baseline; run the six-case host with the real HMI observer; inspect all three pages and correlate session/frame/PLC evidence while confirming cadence; then evaluate the result. Only after that should a separately authorized Wonder checkpoint be considered. No final conveyor-controller requirement coverage, HMI live pass or paid Muse pass is claimed by this integration.

Later coordination: `docs/wonder-convergence-interface.md` records the Wonder lane's verified `13c55b3` base, current host/provider boundaries, the distinction between Claude's H2-specific child process and a completed Wonder lease interface, and the newer recorded HMI held-state handoff. It does not change this proof or authorize live use/recovery.
