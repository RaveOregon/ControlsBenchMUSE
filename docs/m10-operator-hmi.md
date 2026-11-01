# M10 operator HMI lane: CV-1 browser HMI for the M8 controller

Branch `hmi/m10-operator-hmi`, worktree `.claude/worktrees/m10-operator-hmi`. Base: merge `2db3f24` of Lane A `3ab99ff` (live M8 connector, deterministic M10 proof) and Lane B `7886dfd` (portal host, HMI hub, controlled-browser capture, HMI tile). The only merge conflict was the `package.json` test list, resolved as the union.

This lane supplies the **actual operator HMI**: a three-page browser application connected to M8 build 8001/interface 1 through the qualified M8 OPC UA transport. It does not build a capture service or a portal host. Lane B's host captures this page through its controlled browser, and its tile shows those frames. Lane C's Muse-generated machine view stays separate. No CODESYS project, PLC program, `src/live`, `src/campaign`, `src/host`, `ui/` or historical evidence file was modified.

## Launch

```powershell
npm run hmi                 # fixture: recorded M10 final held state, http://127.0.0.1:5181/
npm run hmi:portal          # fixture HMI + Lane B portal host (:5179) showing the captured HMI session
npm run hmi:live            # live M8, masked password prompt, http://127.0.0.1:5181/
npm run hmi:live:portal     # live M8 HMI shown in the portal from one controlled session
powershell -File scripts/run-hmi-h2-live.ps1 [-Watch]   # H2 live verification (see Gate status)
npm run hmi:audit           # independent audit of the latest saved H2 run (no PLC)
```

Fixture states: `m10-final-held`, `m10-sorting-a` and `m10-stopped-ready`. Pass them as `node scripts/run-hmi.js --fixture <id>`; add `--no-emulate` to disable fixture command acknowledgements. The portal needs `ui/dist`, which you build with `cd ui; npm run build`. Options include `--port`, `--poll-ms 250`, `--shared-poll-ms 1000`, `--commands auto|enabled|disabled` and `--artifacts artifacts/hmi`. If the existing Lane B host already uses :5179, pass `--portal-port 5189`.

## Two views

| View | Owner | Truth source |
|---|---|---|
| Generated machine view | Lane C | Muse world physical truth (cartons, motion) |
| **Operator HMI** (this lane) | this lane | Observed PLC samples only: the active input image, PLC outputs and controller status |

The HMI overview is drawn from the PLC's active input image and its output commands. It never animates or infers carton position. Each value shown is an observed OPC UA sample, with its quality, its source, server and receipt timestamps, and its age.

## Pages

**Persistent header.** It shows:
- Machine identity, plus the observed BuildId, interface and map version.
- The actual PLC mode, and data freshness (`Fresh · 120 ms`, `Stale`, `Reconnecting`, `Disconnected`, `Not scanning`).
- The input source (simulation or hardware, flagged when the request and applied state differ).
- The active-alarm summary, which links to Alarms.
- The source badge (`LIVE PLC` or a hatched `FIXTURE · NOT A PLC`).
- Navigation.

The banners are: fixture label, HMI service lost, PLC link stale or lost, **ConnectorStale (bench diagnostic, not a machine alarm)**, and read-only ownership.

**Operation.** It contains:
- A prominent active-fault strip with a link to Alarms.
- An I/O overview: the photo-eye beams, the D1/D2 paddle drawn from its limit feedback, the command-versus-feedback tags, destination readiness, the motor command, running feedback and overload, and the stack lamps.
- PLC counts.
- A command-versus-feedback table.
- The current item with its requested and effective route, plus the last actual exit and disposition.
- Release, WCS offer and completion.
- Controls: START, STOP, RESET, and an AUTO ON/OFF selector. Each command shows its lifecycle. A pre-check line lists Start conditions that are not met, labelled as the HMI's reading of the M8 rule, because the PLC decides.

**Alarms.** It has four parts:
- A capability note: M8 latches only its first fault and has no alarm list, timestamps or acknowledgement.
- Active alarm cards. Each card has the PLC text, the plain-language cause and controller response, the first-observed time with its basis, the onset window, the boot, and links back to Operation and to the related Engineering signals.
- A recovery path that keeps Review, clearing the cause, Reset and Start separate, with the live Reset preconditions.
- A filterable recorded history: state, type, period and text.

**Engineering (read-only).** It shows:
- The raw active input image, with value, quality, age and source time.
- The actuator commands against the limit and drive feedback.
- The PLC-derived encoder delta, speed and travel next to the raw count.
- The operator request readbacks against the PLC acknowledgements.
- WCS offer and completion fields.
- Controller identity.
- Simulation requested against applied, ConnectorStale, heartbeat, the requested and applied epoch/sequence with the lag, the commit counters, and the same-scan bracket.
- The HMI's own OPC UA session: endpoint, security, latency, polls, failures, reconnects, last error, scan check, boot change, ownership, clients and journal path.

The page has no write, force or image control.

Screenshots are in `docs/screenshots/hmi/`, captured at 1280×800 through Lane B's CDP source: `fixture-1280-{operation,alarms,engineering,portal}.png` with an index of SHA-256 hashes. Live captures are added by H2 (see the Gate status section).

## Commands: pending, applied and rejected

Only `GVL_DemoWrite.StartSequence`, `StopSequence`, `ResetSequence` and `AutoRequest` may be written. `PlcLink.write` enforces this allowlist in addition to Lane A's transport allowlist. The HMI never writes field images, the bench handshake, `SimRequest` or WCS fields.

| Action | Write | Applied when | Rejected when |
|---|---|---|---|
| Start | `StartSequence := n+1` (does **not** set AutoRequest) | `StartAck = n+1` and `StartAccepted = TRUE`, confirmed by a second read | `StartAck = n+1`, `StartAccepted = FALSE` |
| Stop | `StopSequence := n+1` | `StopAck = n+1` (M8 has no StopAccepted) | — |
| Reset | `ResetSequence := n+1` | `ResetAck = n+1`, `ResetAccepted = TRUE` | `ResetAccepted = FALSE` |
| Auto on/off | `AutoRequest := TRUE/FALSE` | labelled **readback** (M8 has no Auto acknowledgement field) | readback differs (`failed`) |

Outcomes:
- `refused`: not sent. Causes are read-only mode, another owner, stale data, a frozen PlcCycle, an unexpected controller identity, or another command in flight.
- `delivered`: written, awaiting acknowledgement.
- `applied` or `rejected`: from the PLC acknowledgement.
- `timed_out`: written, with no acknowledgement within 2 s. The command may still apply, so inspect before retrying.
- `failed`: the write did not complete, the readback differs, or another writer's later sequence made the outcome ambiguous.

One command runs at a time, and request IDs are idempotent. After an acknowledgement, the resulting mode, fault, motor command, running feedback and AutoRequest are followed until they are stable for 1 s, or for at most 5 s.

On a rejection the HMI lists the observed Start or Reset preconditions from `FB_DemoConveyor`, labelled as an HMI evaluation. The PLC reports only the accepted flag. Reset never starts the machine. Start is a separate request that needs Auto on.

## Alarms

`src/hmi/alarms.ts` derives instances from observed `FaultCode` and `ExceptionCode` transitions:
- **Time basis.** Times are the HMI service wall clock at receipt of the OPC UA read that first showed the state. Onset lies after the previous good read (`onsetAfterIso`). A fault already latched when observation starts is marked `active_at_observation_start` with an unknown onset. OPC source timestamps are server sampling times, not fault-onset times.
- **Clears** are recorded only from observed transitions. A clear seen after a link or HMI outage is labelled `observed_after_gap`. A PLC boot change leaves the old boot's alarm `unresolved` rather than inventing a clear.
- **Persistence.** Live history is append-only at `artifacts/hmi/live/alarm-history.jsonl`. After an HMI restart the same instance continues, with a recorded gap. Fixture runs keep history in memory only.
- **Review** is an HMI-local marker with the time and client session. It does not acknowledge, clear or reset anything in the PLC.
- **Exceptions** (route unavailable or misroute) are a separate non-stopping kind.
- **ConnectorStale** and link health never create alarms.

## Freshness and disconnect handling

The 103 required map fields are read every 250 ms in batches of at most 60 nodes per OPC UA Read request (CODESYS rejected a single 103-node Read with `BadTooManyOperations`; Lane A's 72-node reads pass): no overlap, no catch-up bursts, and a 5 s operation timeout.

- **Fresh** means a good read within `max(1500 ms, 4 × interval)`. Unchanged values never count as stale just because they stopped changing.
- **Read failure.** On a failed read the link goes stale and holds the last values. After 3 consecutive failures it closes the session and reconnects with backoff (1, 2, 5, 10, 15 s), each time with a fresh session.
- **Credential or security rejection** sets `disconnected` with no automatic retry.
- **Scan check.** PlcCycle is compared across at least 100 ms, so a frozen cycle shows as `Not scanning`.
- **Boot change** is recorded and passed to the alarm recorder.
- **Commands** are disabled whenever data is not fresh.
- **HMI service connection lost.** The page freezes, shows a banner, and its buttons are disabled.

## Runtime ownership

Each live HMI writes `artifacts/hmi/runtime-claim.json`; a second live HMI refuses to start. In `--commands auto` mode, commands are disabled, and polling slows to `--shared-poll-ms` (1000 ms), whenever any of these is present in this checkout or the main worktree:
- `artifacts/m10/live.lock` (Lane A runner)
- an active `artifacts/m10/operator-status.json` (Lane A watch)
- an active `codesys/demo/operator-status.json` (M8 smoke)

This keeps HMI reads from competing with a campaign heartbeat, and the HMI writes no image. The H2 runner holds `artifacts/m10/live.lock`, with JSON content naming `hmi-h2-live`, so Lane A's runner (`openSync(lock, "wx")`) refuses to start concurrently. The H2 HMI is started with `--commands enabled` because it is the authorised operator in that run.

## Portal integration (agreed interfaces with Lane B)

| Interface | Value |
|---|---|
| HMI page URL | `http://127.0.0.1:5181/` with `#/operation`, `#/alarms`, `#/engineering`. The portal session uses `?capture=portal`. |
| Session identity | `GET /api/identity` returns the service session, the source (`live_plc` or `fixture` plus basis), map version and journal. Each page load registers a `clientSessionId`, shown in the footer and recorded with every input and command. Lane B's frames carry `hmi-frame:<browserSession>:<n>`. |
| Portal mounting | `scripts/run-hmi-portal.js` starts Lane B's `CampaignHost` and `createPortalServer` in-process, passing Lane B's documented `hmi` (HmiHub) and `hmiSourceFactory` options. The `CdpWebVisuSource` it creates is the session the tile shows, so no Lane B code changed. With two processes you can instead run `npm run host -- --hmi-url "http://127.0.0.1:5181/?capture=portal"`. |
| Operator-command adapter | `POST /api/commands {requestId, action, clientSessionId, target, input}` returns the command record. The lifecycle streams on `GET /api/stream` (SSE `state`). |
| Evidence | The HMI journal is a hash-chained JSONL per service session, written as `artifacts/hmi/.../runs/<ts>-<source>/journal.jsonl` and checked by `verifyJournal`. It records the requested action, page input, PLC acknowledgement, resulting state, rendered outcome, and the portal session, inputs and frames (`portal.*`). Lane B preserves the frames themselves (`portal-hmi/hmi-frames`, plus `hmi-session.jsonl`). The M9 `capture_hmi_evidence` tool cites the same `hmi-frame:` references. |

Lane B's tile has no pop-out. Expand works, and the HMI URL itself is the independent pop-out. An independently opened HMI window is a different client session from the portal's captured session, and the footer shows which session is which.

## Muse readiness: semantic targets and the operation seam

Every control has a stable `data-hmi-target`:
- `cmd.start`, `cmd.stop`, `cmd.reset`, `cmd.auto.on`, `cmd.auto.off`
- `nav.operation`, `nav.alarms`, `nav.engineering`
- `status.alarm-summary`, `link.active-fault`, `link.controls`, `alarm.review`, `alarms.filter.*`

Status elements carry `data-hmi-status` (mode, link, simulation, active-fault, overview, devices, item.*, count.*, command-log, and others). Each page publishes its visible target rectangles and enabled state to `POST /api/targets`. `GET /api/targets?client=<id>` returns them for a controlled-browser agent. Pages build their DOM once and update it in place, so a control is never replaced under a pointer. Rendering uses `setTimeout` rather than rAF, so occluded or captured windows stay current.

`POST /api/agent-actions/execute {"targetId":"cmd.stop","requester":"..."}` is available under `run-hmi-portal.js`. It produces separate, correlated records:
1. **Requested HMI action:** `agent.action.requested`, with the target rectangle as published by the page.
2. **Delivered browser action:** `agent.action.delivered`, a trusted CDP `Input.dispatchMouseEvent` press and release on the portal's controlled browser, with the dispatch start time.
3. **Page input:** `ui.input`, recorded by the page with `isTrusted`, the hit target and coordinates.
4. **PLC acknowledgement and resulting state:** the `command.*` records, as above.
5. **Observed screen result:** `ui.rendered` (the outcome text the page rendered, with time), plus a Lane B frame captured after it (`agent.action.screen`, with reference and SHA-256).

A disabled target makes the action `inconclusive`, and nothing is delivered. The paid Muse visual-operation checkpoint has not been run. The seam is pixel-agnostic: a vision model can choose coordinates itself and still use `deliverPointer`.

## Tests

`test/hmi-commands.test.ts`, `test/hmi-alarms.test.ts` and `test/hmi-freshness.test.ts` contain 26 tests over a scripted protocol transport (`test/fixtures/hmi/scripted-transport.ts`). That transport answers sequences as each test scripts them; it is not a copy of the conveyor logic. They cover:
- Command acknowledgement: applied, rejected with preconditions, the Stop echo, timeout, ambiguous other-writer, Auto readback, ownership, read-only, stale, identity and in-flight refusals, idempotency, and the write allowlist.
- Alarm transitions: start-of-observation basis, raise and clear windows, ConnectorStale and bad quality not becoming alarms, exceptions, the review marker, persistence and restart continuity, gap-labelled clears, and boot change to unresolved.
- Freshness: unchanged values staying fresh, stale with held values, reconnect with a fresh session, no retry after an auth rejection, scan check, and boot change.
- HTTP: identity, cross-origin refusal, TypeScript stripping and path confinement, fixture-only controls, and journal hash-chain verification.

The full suite is 70/70 (`npm test`; the two Lane B CDP tests need a non-sandboxed shell to launch Edge), and typecheck is clean. 26 of the tests are this lane's.

## Gate status

| Gate | Status | Evidence |
|---|---|---|
| H0 interfaces and fixture rendering | **Pass** | Three pages render against labelled fixtures seeded from the recorded M10 trace (`test/fixtures/hmi/m10-recorded-states.json`; the source trace's SHA-256 is inside). The desktop layout was inspected at 1280×800. Screenshots: `docs/screenshots/hmi/fixture-1280-*.png`. |
| H1 live observations and commands | **Pass** | Live M8 boot `1580380594210`, after the user rebooted the PLC. The HMI read a clean baseline on its own OPC UA session (103 fields in batches of at most 60 nodes) and issued PLC-acknowledged operator requests. |
| H2 Start/Stop/Reset/Auto, faults, alarms, disconnect | **Pass (twice), independently audited** | Runs `artifacts/hmi/h2/2026-11-01T14-02-24-720Z` and `…T14-07-10-579Z`. `npm run hmi:audit -- <run>` (`scripts/audit-hmi-h2.js`) passes 13/13 checks on each, with no PLC needed. Details below. |
| H3 portal session and correlated evidence | **Pass (live)** | The live HMI was operated in the portal's controlled (headless) browser session. Every click has five linked records, and each frame's SHA-256 matches Lane B's session log. The live portal page with the HMI tile during fault 10 is `docs/screenshots/hmi/live-portal-fault.png`. |

**H2, verified live through trusted clicks in the portal session, in both passing runs:**
- Auto on: confirmed by readback.
- Start: `StartAccepted=TRUE`. Mode Auto, motor command on, running feedback on, encoder advancing.
- Stop: acknowledged by `StopAck` echo. Mode went Stopping then Stopped; the second run shows 141 counts of physical coast.
- Auto off while running: Mode Stopped.
- Start with Auto off: **rejected by the PLC**, with the unmet observed precondition listed.
- Injected drive overload: **fault 10 raised**, by an observed transition with an onset window.
- Reset while overloaded: **rejected** (`ResetAccepted=FALSE`).
- Overload cleared, then Reset: **applied**. The alarm cleared on an observed transition, and the machine stayed Stopped with the motor off until the next request.
- Auto and Start, then WCS item 301/A: tracked with route A requested and effective, completed at **Exit A / Sorted**, exit-A count +1. The completion was acknowledged by the WCS peer, not the HMI.
- HMI-session read interruption: link went to reconnecting. Start was **disabled on screen**, so no command was sent and nothing was written. The link recovered after one reconnect.
- Coordinator stopped: the PLC asserted `ConnectorStale=TRUE`, shown only as the bench banner, and **no alarm was created**.
- All three pages were visited in the same portal session.

**The audit checks:**
- Provenance: the frozen M8 project hash, the map and world hashes, and zero model calls.
- The HMI journal's hash chain.
- The HMI wrote only the four operator paths, all with Good status.
- The coordinator session never wrote an operator path; it wrote only bench and WCS fields.
- The command sequence and PLC outcomes.
- Acknowledgement semantics.
- Reset did not start the machine, judged from raw observations up to the next request.
- Five records for every click: requested, CDP delivery, trusted page input on the intended target, the linked command, and the rendered outcome with a later frame.
- The cited frame bytes.
- The alarm transitions.
- No command was sent while the link was not fresh.
- ConnectorStale did not create an alarm.
- Item/route completion, replayed from keyframe plus changes.

Live screenshots, 1280×800 frames of the portal's controlled HMI session, are indexed with SHA-256 in `docs/screenshots/hmi/live-index.json`: `live-operation-running`, `-fault`, `-reset-rejected`, `-completion`, `-link-lost`, `-connector-stale`, `live-alarms`, `live-engineering` and `live-portal-fault`.

**Every live attempt is retained unchanged, failures included.** Each failure found a real defect:
1. `T13-33-45-242Z`: authenticated, but every 103-node Read was refused with `BadTooManyOperations`. Fixed by batching reads. No write.
2. `T13-38-06-654Z`: the ConnectorStale banner cleared, the controls moved, and the first click missed its target. Fixed with a fixed-height message bar, an always-present fault strip, and target refresh before each click. No write.
3. `T13-46-58-698Z`: passed through Reset. Then the **headed** capture window began scaling injected input ×1.25 (dispatched at 999,334; the page saw 1249,418), and a Start click hit empty space with nothing actuated. Fixed by capturing headless and adding a coordinate-mismatch diagnostic.
4. `T14-02-24-720Z`: **pass.** Its audit exposed a follow-up window that absorbed a later command's effect, now closed with `supersededBy`.
5. `T14-07-10-579Z`: **pass**, confirming the fix live.
6. `T14-08-43-860Z`: **failed and left the PLC held (see below).** This run added a separate headless viewer of the portal page. During the item-301 trial the runner's Node event loop stalled for about 855 ms, with no PLC reads, HMI polls or frame captures. The coordinator heartbeat lapsed, the PLC asserted ConnectorStale, Lane A's driver faulted, and the runner stopped without any recovery. The cause of the stall is not proven. Candidates are synchronous file I/O, a GC pause, and scanning of new frame files. The structural defect is that this runner hosts the simulation coordinator in the same process as the HMI service, portal host and capture.

**PLC state after attempt 6 (not recovered by this lane):**
- **What the run left:** M8 boot `1580380594210` in **Auto**, motor command on, item 301 tracked, simulation held at the last image (running feedback TRUE, carton on the beams), and ConnectorStale TRUE.
- **Expected since then, not observed:** with inputs frozen, M8's 30 s transit timer is expected to have latched fault 33. No later observation was made.
- **What recovery needs:** an explicit, recorded baseline procedure: restore the field image (fresh world at rest), have the WCS acknowledge the aborted completion, then Reset.
- **Why the H2 runner won't start:** it refuses this dirty baseline by design. Repetition needs that explicit procedure, not automatic recovery.
- **Hazard:** none. This is CODESYS Control Win with no physical I/O.

**Required change before more live H2 runs:** move the simulation coordinator into its own process, so HMI, portal or capture work cannot starve the heartbeat, as in Lane A's runner. The passed runs stand, because their coordinator never went stale and their audits pass. Attempt 6 shows the margin is not guaranteed.

### H2 runner

`run-hmi-h2-live.ps1 [-Headed] [-Watch]` runs `node scripts/run-hmi-h2-live.js` with three separately attributable roles:
- Field inputs: the preserved world through Lane A's connector, on its own OPC UA session.
- WCS: the coordinator's tools.
- Operator: HMI clicks in the portal's controlled browser, on the HMI's OPC UA session.

It claims `artifacts/m10/live.lock` in the main checkout and refuses an active Lane A or M8 operator session. Steps:
1. Read-only baseline inspection. It stops unless the PLC is cleanly stopped, and it never resets unexplained state.
2. Start the portal session (headless by default), then the coordinator.
3. Auto on, Start, Stop.
4. Start, Auto off, Start rejected.
5. Overload: fault raised, Reset rejected, cause cleared, Reset applied.
6. Item 301/A sort with completion and WCS acknowledgement, then Stop.
7. HMI-session read interruption, then reconnect.
8. Coordinator stopped: ConnectorStale.
9. Page views and portal-page captures.

`-Watch` keeps the masked credential in that PowerShell process for explicit follow-up runs, requested by writing `{"id":"<new>","action":"run"|"stop"}` to `artifacts/hmi/h2/operator-request.json`. It never retries by itself and clears the credential after 30 minutes idle, on `stop`, or on Ctrl+C. Evidence goes to `artifacts/hmi/h2/<ts>/`: `result.json`, `audit.json` (from the audit script), the HMI journal and alarm history, `campaign.jsonl`, `world-transport.jsonl.gz`, Lane B's `hmi-session.jsonl`, and the cited frames. The per-second frame stream is not committed. `artifacts/hmi/.gitattributes` keeps evidence bytes exact.

## Untested and limitations

- **The PLC was left in a held Auto state with item 301** after failed attempt 6, as described above. It needs an explicit recovery decision.
- The coordinator is not yet isolated in its own process inside the H2 runner. Fix this before more live runs.
- The headed-window input scaling (×1.25) is unresolved. Headed operation by an engineer is fine, but scripted clicks must use the headless session or accept the mismatch diagnostic.
- `hmi:live` / `hmi:live:portal` as standalone services were exercised only inside H2's in-process composition, not as separate long-running processes against the live PLC.
- The fixture's command acknowledgements emulate a small subset of `FB_DemoConveyor` rules for rendering only, and are labelled "fixture ack".
- Lane A's native transport uses the client application name `NodeOPCUA-Client` for both sessions. Attribution comes from the HMI journal (request, client session, origin) and the separate session, not from the PLC, which cannot tell writers apart.
- The HMI read is a batched read, not cycle-bracketed like Lane A's commit evidence. `sameScanBracket` reports only whether PlcCycle equals OutputCaptureCycle within one batch.
- Header values come from the last poll (500 ms while a lane owns the runtime). After an acknowledgement the link now polls immediately; before that change, an outcome frame could show "Applied" beside the previous poll's mode.
- No hardware-passthrough commissioning, multi-operator conflict resolution, or user authentication on the HMI page is implemented. The HMI is loopback-only.
- Lane B observations:
  - Its `portal-host` live test failed once under concurrent headless-browser load, then passed 3/3.
  - A hard-killed host or test leaves headless Edge processes (`controlsbench-hmi-*` profiles). This session's orphans were identified by a dead parent process and closed.
  - Under the browser pane's emulation, the expanded tile image appeared cropped.
  - The portal's own campaign factory is still the fixture, so its header reads "fake connector" beside the live HMI tile. That is accurate.
- Paid Muse visual operation (S2) has not been run. The seam (`/api/agent-actions/execute`) and semantic targets are ready.
