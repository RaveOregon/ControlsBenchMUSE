# M10 operator HMI lane: CV-1 browser HMI for the M8 controller

Branch `hmi/m10-operator-hmi`, worktree `.claude/worktrees/m10-operator-hmi`. Base: merge `2db3f24` of Lane A `3ab99ff` (live M8 connector, deterministic M10 proof) and Lane B `7886dfd` (portal host, HMI hub, controlled-browser capture, HMI tile). The only merge conflict was the `package.json` test list, resolved as the union.

This lane supplies the **actual operator HMI**: a three-page browser application connected to M8 build 8001/interface 1 through the qualified M8 OPC UA transport. It does not build a capture service or a portal host. Lane B's host captures this page through its controlled browser, and its tile shows those frames. Lane C's Muse-generated machine view stays separate. No CODESYS project, PLC program, `src/live`, `src/campaign`, `src/host`, `ui/` or historical evidence file was modified.

## Launch

```powershell
npm run hmi                 # fixture: recorded M10 final held state, http://127.0.0.1:5181/
npm run hmi:portal          # fixture HMI + Lane B portal host (:5179) showing the captured HMI session
npm run hmi:live            # live M8, masked password prompt, http://127.0.0.1:5181/
npm run hmi:live:portal     # live M8 HMI shown in the portal from one controlled session
powershell -File scripts/run-hmi-h2-live.ps1 [-Headed]   # H2 live verification (see below)
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

One batched read of the 103 required map fields runs every 250 ms: no overlap, no catch-up bursts, and a 5 s operation timeout.

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

`test/hmi-commands.test.ts`, `test/hmi-alarms.test.ts` and `test/hmi-freshness.test.ts` contain 24 tests over a scripted protocol transport (`test/fixtures/hmi/scripted-transport.ts`). That transport answers sequences as each test scripts them; it is not a copy of the conveyor logic. They cover:
- Command acknowledgement: applied, rejected with preconditions, the Stop echo, timeout, ambiguous other-writer, Auto readback, ownership, read-only, stale, identity and in-flight refusals, idempotency, and the write allowlist.
- Alarm transitions: start-of-observation basis, raise and clear windows, ConnectorStale and bad quality not becoming alarms, exceptions, the review marker, persistence and restart continuity, gap-labelled clears, and boot change to unresolved.
- Freshness: unchanged values staying fresh, stale with held values, reconnect with a fresh session, no retry after an auth rejection, scan check, and boot change.
- HTTP: identity, cross-origin refusal, TypeScript stripping and path confinement, fixture-only controls, and journal hash-chain verification.

The full suite is 68/68 (`npm test`), and typecheck is clean.

## Gate status

| Gate | Status | Evidence |
|---|---|---|
| H0 interfaces and fixture rendering | **Pass** | Three pages render against labelled fixtures seeded from the recorded M10 trace (`test/fixtures/hmi/m10-recorded-states.json`, sha256 of the source trace inside). The desktop layout was inspected at 1280×800, and screenshots are in `docs/screenshots/hmi/`. |
| H1 live observations and commands | **Not run — blocked** | The CODESYS Control Win V3 service was *Stopped* (nothing listening on :4840) during this session. |
| H2 Start/Stop/Reset/Auto, faults, alarms, disconnect | **Not run — blocked** | Same blocker. `scripts/run-hmi-h2-live.ps1` is ready. |
| H3 portal session and correlated evidence | **Pass on fixture; live pending** | The portal tile showed the captured HMI session (observing and recording). A scripted `cmd.reset` click produced requested, delivered, page-input, rendered, frame and fixture-acknowledgement records. The fixture acknowledgement is not PLC evidence. |

### H2 runner

`run-hmi-h2-live.ps1` (`node scripts/run-hmi-h2-live.js`) runs in one process with three separately attributable roles: the field inputs from the preserved world through Lane A's connector session, the WCS from the coordinator's tools, and the operator, which is HMI clicks in the portal's controlled browser on a second OPC UA session. Steps:
1. Read-only baseline inspection. It stops if the state is not clean and stopped. It never resets unexplained state.
2. Start the portal session, then the coordinator.
3. Auto on, Start (motor command and running feedback), and Stop (coast to Stopped).
4. Start, then Auto off (stops), then Start with Auto off (PLC rejection).
5. Injected world overload: fault 10 is raised, Reset is rejected while overloaded, the cause is cleared, Reset is applied, the alarm clears, and the machine stays Stopped.
6. Auto and Start, then WCS item 301/A through D1 to exit A, with completion and WCS acknowledgement, then Stop.
7. HMI-session read interruption through a transport proxy (the PLC is unaffected): stale, then a Start target that is disabled or refused, then reconnect.
8. Stop the coordinator: ConnectorStale shows as a banner with no alarm.
9. Visit the three pages in the portal session.

Evidence goes to `artifacts/hmi/h2/<ts>/`: `result.json`, the HMI journal, the per-run alarm history, `campaign.jsonl`, `world-transport.jsonl.gz`, and the cited frames in `evidence-frames/`. The per-second frame stream is not committed.

## Untested and limitations

- **No live PLC connection was made by this lane.** H1/H2 and the live part of H3 are unverified until the runtime runs.
- The fixture's command acknowledgements emulate a small subset of `FB_DemoConveyor` rules for rendering only.
- Lane A's native transport uses the client application name `NodeOPCUA-Client` for both sessions. Attribution comes from the HMI journal (request, client session, origin) and the separate session, not from the PLC, which cannot tell writers apart. A future Lane A option could set a distinct application name.
- The HMI's single read batch is not cycle-bracketed like Lane A's commit evidence. `sameScanBracket` reports only whether PlcCycle equals OutputCaptureCycle within the batch.
- No hardware-passthrough commissioning, multi-operator conflict resolution, or user authentication on the HMI page is implemented. The HMI is loopback-only.
- Lane B observations:
  - Its `portal-host` live test failed once under concurrent headless-browser load and then passed 3/3.
  - A hard-killed host or test leaves headless Edge processes (`controlsbench-hmi-*` profiles). This session's orphans were identified by a dead parent process and closed.
  - Under the browser pane's 1280×800 emulation, the expanded tile image appeared cropped. This was not seen in normal use.
- Paid Muse visual operation (S2) has not been run.
