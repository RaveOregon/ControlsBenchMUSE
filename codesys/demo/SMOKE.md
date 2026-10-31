# M8 reproducible live smoke

## Prepare

1. Open only codesys/conveyordemo.project in CODESYS. Do not download gngnf.project for this procedure. Ensure no other lane owns the runtime.
2. Confirm MainTask remains 20 ms and calls PLC_PRG once. The official MCP has prechecked and fully compiled this application.
3. In the native OPC UA Symbol Set retain GVL_BenchWrite read/write and GVL_BenchRead read-only. Add every GVL_DemoWrite member as read/write. Add GVL_DemoRead.BuildId, InterfaceVersion, and every Status member as read-only. Keep the inherited transport symbols. The existing PlcCycle leaf in GVL_M0Probe is not the bench cycle; the runner validates full paths.
4. Save the latest project before downloading. Download a fresh application to the local Control Win target, RUN, and leave the signed/encrypted username OPC UA endpoint available.
5. From a terminal at the repository root run:

```powershell
powershell -ExecutionPolicy Bypass -File codesys/demo/run-smoke.ps1 -Gate All
```

Enter the PLC password only in that masked terminal prompt. Do not paste it into chat. Default username is PLC; override with -OpcUser if necessary. No .env loading or model API exists in this runner.

Read-only is the intended publication setting. The tested server reported access flags 3 for 68 intended read-only fields even after the operator confirmed the setting and cleanly redeployed. The user authorized proceeding without writing them. The runner records this discrepancy and enforces a write allowlist; only missing read access or missing required input/request write access blocks setup. It never probes write access by writing PLC outputs/state. The audit checks every recorded write against the permitted IEC groups.

For agent-assisted iteration, append `-Watch`. It runs the selected gate once and keeps the terminal open, awaiting a new explicit request in the ignored operator-request.json file. Requests can select only this fixed smoke runner and one of A/B/C/D/All, or stop the session; they cannot supply shell commands. A failed gate does not automatically retry. The password is passed only to the fixed child runner and removed from the child-launch environment afterward; it is never written to either operator JSON file. Close with Ctrl+C, or a stop request. Keep the demo active in the IDE for each official MCP precheck.

## Breakpoints

All runs A, then B, then C, then D, stopping at the first exception. Each breakpoint calls the official installed MCP bridge for an application precheck and retains the exact response. Leave the demo active in the IDE and do not edit/save it during the run; the runner also checks that its project-file hash remains unchanged. Individual gates use -Gate A/B/C/D for investigation; do not continue past an unexplained failed gate. A requires a freshly downloaded/reset application in hardware-default mode. B–D explicitly establish normal simulation inputs, acknowledge an old completion, Stop, and Reset before testing.

- A: build/interface identity and type/access checks; cold hardware default and outputs off; explicit simulation selection publishes the complete zero image; complete normal image acknowledgement; heartbeat silence causes stale while holding exactly the last applied image and simulation authority; explicit complete commit restores freshness.
- B: Start asserts authentic motor command; external running feedback establishes Auto/release; Stop removes command with feedback still on and leaves Stopping; explicit raw encoder coast and eventual feedback/rest produce Stopped. A missing-motor-feedback start produces fault 11. An overload during running produces fault 10 without inventing a carton completion. Cleared-cause Reset does not auto restart.
- C: normal A, normal B, and an unoffered/unknown carton at runout each increment only their observed exit count and exactly one completion. Holding each exit for 300 ms does not repeat completion. An A assignment with A blocked reaches runout as a misroute, with no false successful-sort count.
- D: an A carton with D1 permanently between limits produces fault 23, motor off, one Faulted completion, no successful exit count; a later runout edge cannot rewrite or duplicate that completion. After explicit removal/normal input restoration and completion acknowledgement, Reset returns Stopped with motor off.

Each input image is committed at no more than 10 Hz with a unique epoch/sequence and boot guard. Stimuli are intentionally methodical field states. The stop test's encoder increments are explicit external device stimuli, not a physics model. This M8 smoke must not be described as a repeat of M7's continuous-world deceleration proof.

## Inspect and audit

Each run creates a new timestamped folder under codesys/demo/evidence containing:

- result.json: passed checkpoints or first failure, tested project/map/runner hashes, boot identity, and limitations;
- resolved-symbols.json: actual OPC UA node IDs, IEC paths, types, and access observed for that deployment;
- trace.jsonl: non-secret writes, complete raw frames, acknowledgements, bracketed observations, Good quality, source/server/receipt timestamps.
- tested-conveyordemo.project: exact on-disk project snapshot hashed before the run (the operator must save/download that project; a matching live build/interface marker is required).
- signal-map-used.json, smoke-used.cjs, precheck-used.cjs: exact non-secret map and test implementation snapshots; hashes are checked by the audit.

A failure closes only the client and leaves the final raw image and PLC state available for inspection. It does not auto-reset, continue to the next breakpoint, or switch to hardware. The stale diagnostic subsequently asserts as the connector closes.

Run the independent artifact audit after a completed smoke:

```powershell
node codesys/demo/tests/audit.cjs codesys/demo/evidence/<timestamp>-All
```

Do not rerun only to average away a failure. Record a specific cause/fix and rerun from the relevant clean breakpoint. Keep failed and successful runs. A–D do not qualify 20/50 Hz, physical hardware, arbitrary multi-carton flow, every late-route/readiness edge case, all timer combinations, or WebVisu. The static passthrough assignment is source-proven; arbitrary nonzero physical I/O is not live-proven on this unwired Control Win project.
