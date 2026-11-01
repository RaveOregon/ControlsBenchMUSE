# M10 operator HMI lane: CV-1 browser HMI for the M8 controller

Branch `hmi/m10-operator-hmi`, worktree `.claude/worktrees/m10-operator-hmi`. Base: merge `2db3f24` of Lane A `3ab99ff` (live M8 connector, deterministic M10 proof) and Lane B `7886dfd` (portal host, HMI hub, controlled-browser capture, HMI tile). The only merge conflict was the `package.json` test list, resolved as the union.

This lane supplies the **actual operator HMI**: a three-page browser application connected to M8 build 8001/interface 1 through the qualified M8 OPC UA transport. It does not build a capture service or a portal host. Lane B's host captures this page through its controlled browser, and its tile shows those frames. Lane C's Muse-generated machine view stays separate. No CODESYS project, PLC program, `src/live`, `src/campaign`, `src/host`, `ui/` or historical evidence file was modified.

## Launch

```powershell
npm run hmi                 # fixture: recorded M10 final held state, http://127.0.0.1:5181/
npm run hmi:portal          # fixture HMI + Lane B portal host (:5179) showing the captured HMI session
npm run hmi:live            # live M8, masked password prompt, http://127.0.0.1:5181/
npm run hmi:live:portal     # live M8 HMI shown in the portal from one controlled session
powershell -File scripts/run-hmi-h2-live.ps1 [-Watch] [-RecoverFrom <failed run>]   # H2 live verification (see Gate status)
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

Every sample a decision rests on (the request sequence before the write, the acknowledgement, the accepted flag, the Auto readback) must be Good quality, carry parseable source and server timestamps, and have the expected type (unsigned integer or BOOL). Those samples, with their quality, are kept on the command as `confirmation` and in its terminal journal record. State shown "at acknowledgement" uses Good samples only.

Outcomes:
- `refused`: not sent. Causes are read-only mode, another owner, stale data, a frozen PlcCycle, an unexpected controller identity, another command in flight, held operator writes (below), or a request sequence that could not be read with Good quality.
- `delivered`: written, awaiting acknowledgement.
- `applied` or `rejected`: from a Good-quality PLC acknowledgement.
- `unconfirmed`: the PLC decision could not be established. Either a confirmation sample was missing, not Good, untimestamped or of the wrong type; or the acknowledgement moved between the two reads; or the write itself outlived its timeout. Never treated as applied or rejected.
- `timed_out`: written, with no acknowledgement within 2 s while the acknowledgement read Good. The command may still apply, so inspect before retrying.
- `failed`: the transport rejected the write, the readback differs, or another writer's later sequence made the outcome ambiguous.

**Held operator writes.** A write that outlives its 5 s timeout is not cancelled; it may still land. The link then quarantines operator writes (`link.quarantined`). Nothing else is issued on that session until the write settles, or until the 10 s drain deadline, when the session is closed. Every command is refused while the quarantine holds. It clears only after the write has settled (`link.write_settled`) **and** a PLC read issued after the settlement succeeds (`link.quarantine_cleared`). Opening a new session does not clear it. The header shows a "Writes held" banner and the controls give the reason.

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

This lane's tests are 71 of the suite: `test/hmi-commands.test.ts`, `test/hmi-confirmation.test.ts`, `test/hmi-alarms.test.ts`, `test/hmi-freshness.test.ts`, `test/hmi-coordinator-process.test.ts` and `test/hmi-audit.test.ts`. They run over a scripted protocol transport (`test/fixtures/hmi/scripted-transport.ts`), which answers sequences as each test scripts them; it is not a copy of the conveyor logic. It also enforces the observed 72-node Read limit, and can return any sample with non-Good quality, no timestamps, the wrong type, or not at all. The tests cover:
- Command acknowledgement: applied, rejected with preconditions, the Stop echo, timeout, ambiguous other-writer, Auto readback, ownership, read-only, stale, identity and in-flight refusals, idempotency, the write allowlist, and superseded follow-up windows.
- Confirmation quality: Uncertain, Bad, missing and untimestamped acknowledgements on Start, Stop and Reset; the same, plus wrong types, on StartAccepted, ResetAccepted and the Auto readback; a non-Good request sequence refused before any write. All are `unconfirmed` or `refused`, never applied or rejected.
- Held writes: a delayed Start write that outlives its timeout cannot be overtaken by a later Stop; the drain deadline closes the session, but the new session does not clear the quarantine.
- H2 audit evidence, on a temporary copy of a preserved run: one cited frame missing, all frames missing, an empty frame and changed frame bytes each fail.
- Alarm transitions: start-of-observation basis, raise and clear windows, ConnectorStale and bad quality not becoming alarms, exceptions, the review marker, persistence and restart continuity, gap-labelled clears, and boot change to unresolved.
- Freshness: unchanged values staying fresh, stale with held values, reconnect with a fresh session, no retry after an auth rejection, scan check, boot change, batched reads under the node limit, and a stale threshold that follows the poll rate.
- HTTP: identity, cross-origin refusal, TypeScript stripping and path confinement, fixture-only controls, and journal hash-chain verification.
- The H2 coordinator process: start, world tool, carton query and stop over IPC, using Lane A's fake connector.

The full suite is 115/115 (`npm test`, twice in a row after the Codex review fixes; the two Lane B CDP tests need a non-sandboxed shell to launch Edge, and failed in the reviewer's sandbox with "Browser exited before exposing DevTools"), and typecheck is clean.

## Gate status

| Gate | Status | Evidence |
|---|---|---|
| H0 interfaces and fixture rendering | **Pass** | Three pages render against labelled fixtures seeded from the recorded M10 trace (`test/fixtures/hmi/m10-recorded-states.json`; the source trace's SHA-256 is inside). The desktop layout was inspected at 1280×800. Screenshots: `docs/screenshots/hmi/fixture-1280-*.png`. |
| H1 live observations and commands | **Pass** | Live M8 boot `1580380594210`, after the user rebooted the PLC. The HMI read a clean baseline on its own OPC UA session (103 fields in batches of at most 60 nodes) and issued PLC-acknowledged operator requests. |
| H2 Start/Stop/Reset/Auto, faults, alarms, disconnect | **Pass (3 runs), each independently audited 13/13** (re-audited after the review's stricter frame check; see "Codex review at 1a4a986") | `artifacts/hmi/h2/2026-11-01T14-02-24-720Z` and `…T14-07-10-579Z` (single-process runner); `…T15-12-23-772Z` (**coordinator in its own process**). Re-check with `npm run hmi:audit -- <run>`; no PLC needed. |
| H3 portal session and correlated evidence | **Pass (live)** | The live HMI was operated in the portal's controlled (headless) browser session. Every click has five linked records, and each frame's SHA-256 matches Lane B's session log. Live portal pages with the HMI tile: `live-portal-fault.png` (during fault 10) and `live-portal-final.png` (isolated run). |

**H2, verified live through trusted clicks in the portal session, in all three passing runs:**
- Auto on: confirmed by readback.
- Start: `StartAccepted=TRUE`. Mode Auto, motor command on, running feedback on, encoder advancing.
- Stop: acknowledged by `StopAck` echo. Mode went Stopping then Stopped, with physical coast.
- Auto off while running: Mode Stopped.
- Start with Auto off: **rejected by the PLC**, with the unmet observed precondition listed.
- Injected drive overload: **fault 10 raised**, by an observed transition with an onset window.
- Reset while overloaded: **rejected** (`ResetAccepted=FALSE`).
- Overload cleared, then Reset: **applied**. The alarm cleared on an observed transition, and the machine stayed Stopped with the motor off until the next request.
- Auto and Start, then WCS item 301/A: tracked with route A requested and effective, completed at **Exit A / Sorted**, exit-A count +1. The completion was acknowledged by the WCS peer, not the HMI.
- HMI-session read interruption: link went to reconnecting. Start was **disabled on screen**, so no command was sent and nothing was written. The link recovered after one reconnect.
- Coordinator stopped: the PLC asserted `ConnectorStale=TRUE`, shown only as the bench banner, and **no alarm was created**.
- All three pages were visited in the same portal session.

The isolated run's coordinator ran as pid 57920 at OS priority −7 (above normal), over 286 commits: gap p50 114, p95 222, p99 246, max 267 ms.

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

Live screenshots, frames of the portal's controlled HMI session plus the two portal-page captures, are indexed with SHA-256 in `docs/screenshots/hmi/live-index.json`.

### Every live attempt is retained, failures included

| # | Run (`artifacts/hmi/h2/2026-11-01T…`) | Result and cause | Fix |
|---|---|---|---|
| 1 | `13-33-45-242Z` | Every 103-node Read refused with `BadTooManyOperations`. No write. | Reads batched (≤60 nodes). |
| 2 | `13-38-06-654Z` | The ConnectorStale banner cleared and the controls moved, so the first click missed. No write. | Fixed-height message bar, always-present fault strip, target refresh before each click. |
| 3 | `13-46-58-698Z` | Passed through Reset, then the headed window scaled injected input ×1.25 and a click hit empty space. | Headless capture by default, plus a coordinate-mismatch diagnostic. |
| 4 | `14-02-24-720Z` | **Pass.** | Its audit found a follow-up window absorbing a later command; now closed with `supersededBy`. |
| 5 | `14-07-10-579Z` | **Pass.** | — |
| 6 | `14-08-43-860Z` | An ~855 ms event-loop stall in the single-process runner, right after a mid-run portal-page viewer loaded. The coordinator heartbeat lapsed. **Held: carton in Auto, then fault 33.** | Coordinator moved to its own process; reconciliation script. |
| 7 | `14-54-26-866Z` | Isolated coordinator. Its first tick was late and the link bracket retried under slow OPC reads, so the heartbeat lapsed. **Held: fault 11.** | Above-normal priority, quiet HMI polling during coordinator start-up. |
| 8 | `14-58-54-546Z` | The HMI stale threshold stayed at 1.5 s while start-up polling was 3 s, so the page disabled its controls. Nothing sent; PLC clean. | Stale threshold follows the poll rate; H2 waits for fresh data. |
| 9 | `15-00-59-962Z` | One coordinator tick took 342 ms (Lane A's 300 ms bound) while the mid-run portal viewer loaded. **Held: injected overload, fault 10.** | Mid-run portal viewer removed. |
| 10, 11 | `15-03-56-819Z`, `15-04-28-721Z` | Reconciliation refused before connecting: its precondition named only the ConnectorStale signature, then a regex escape bug. No PLC contact. | Precondition accepts both diagnosed timing signatures. |
| 12 | `15-04-59-374Z` | Passed through Reset, then one coordinator tick took 321 ms in the carton stage. **Held: belt running in Auto, no carton.** | Lighter observation load (HMI poll 2 s, periodic frames 3 s). |
| 13 | `15-12-23-772Z` | **Pass, with the isolated coordinator.** Audit 13/13. | — |

### Held-state reconciliation

`scripts/recover-hmi-h2-baseline.js <failed run>` follows Lane A's `prepare-m10-baseline.js` pattern. It reconciles one saved failed run, and only one of the diagnosed coordinator-timing failures ("ConnectorStale=true" or Lane A's "World step gap … 300 ms observation bound").

Before writing anything, it requires:
- the same boot;
- the same applied epoch and sequence;
- the same held raw image as the run's last acknowledged commit;
- unchanged exit counters;
- the fault and state predicted for that run's path.

| Path | Held state | Actions |
|---|---|---|
| transit-timeout | Carton held, fault 33 | Stop, fresh world at rest, WCS acknowledges the aborted completion, Reset |
| start-feedback-timeout | Start accepted on a held at-rest image, fault 11 | Stop, Reset |
| injected-overload | The run's own overload held, fault 10 | Stop, fresh world at rest, Reset |
| held-running | Belt running in Auto, no carton | Stop, fresh world at rest within M8's 4 s stop window, verify Stopped |

All four recorded reconciliations passed (`artifacts/hmi/h2/recovery-*/result.json`, `transport.jsonl.gz`). Each matched exactly and ended Stopped, fault-free, with no tracked item and nothing pending.

**Final PLC state:** M8 boot `1580380594210`, Stopped, no fault, no item, completion acknowledged, simulation held at rest, and ConnectorStale TRUE because no coordinator is running. AutoRequest is TRUE, set by the last Auto click. The runtime lock is released and the watcher's credential is cleared.

### Timing margin (finding for Lane A / review)

Lane A's coordinator runs about 30 ms under its own 300 ms observation bound on this laptop:
- Lane A's clean M10: max gap 267 ms.
- The passing H2 runs here: p99 227–246 ms, max 228–267 ms.

Concurrent work pushes individual ticks over the bound: a second OPC UA client, frame capture, and especially a browser loading the full portal UI. Moving the coordinator to its own process with above-normal priority, and lightening the HMI's observation load, made the passing run possible. **They do not guarantee every run.**

Options for Lane A:
- Lighter per-tick evidence (fewer bracket retries).
- A bound sized for attended runs.
- An OPC UA subscription for the HMI instead of polling.

The H2 runner never retries and never recovers by itself. Each held state needed an explicit reconciliation.

### H2 runner

`run-hmi-h2-live.ps1 [-Headed] [-Watch] [-RecoverFrom <failed run>]` runs `node scripts/run-hmi-h2-live.js`, with three separately attributable roles:
- Field inputs: the preserved world through Lane A's connector, in **its own process** (`scripts/hmi-h2-coordinator.js` via `src/hmi/coordinator-process.ts`, above-normal priority).
- WCS: the coordinator's tools.
- Operator: HMI clicks in the portal's controlled browser, on the HMI's OPC UA session.

It claims `artifacts/m10/live.lock` in the main checkout and refuses an active Lane A or M8 operator session. Steps:
1. Optional reconciliation of a named failed run; H2 starts only if it passes.
2. Read-only baseline inspection; stop unless cleanly stopped.
3. Portal session (headless).
4. Coordinator start, with HMI polling quiet during start-up.
5. Auto, Start, Stop.
6. Start, Auto off, Start rejected.
7. Overload: fault raised, Reset rejected, cause cleared, Reset applied.
8. Item 301/A sort with completion and WCS acknowledgement, then Stop.
9. HMI-session read interruption, then reconnect.
10. Coordinator stopped: ConnectorStale.
11. Page views, then a portal-page capture after the coordinator has stopped.

`-Watch` keeps the masked credential in that PowerShell process for explicit follow-up requests written to `artifacts/hmi/h2/operator-request.json`:
- `{"id":"<new>","action":"run"}` runs H2 again.
- Adding `"recoverFrom":"<failed run>"` reconciles first, and `"recoverOnly":true` stops after reconciling.
- `{"action":"stop"}` ends the watcher.

The watcher never retries by itself, and clears the credential after 30 minutes idle, on `stop`, or on Ctrl+C. Evidence goes to `artifacts/hmi/h2/<ts>/`: `result.json`, `audit.json`, the HMI journal and alarm history, `campaign.jsonl`, `world-transport.jsonl.gz` (written by the coordinator process), Lane B's `hmi-session.jsonl`, the cited frames, and `portal-page-final.png`. Cited frames are those referenced by the steps **and** by every agent-action screen in the journal; any that cannot be found are listed in `result.missingCitedFrames`, and the audit then fails. The per-second frame stream is not committed. `artifacts/hmi/.gitattributes` keeps evidence bytes exact.

## Codex review at 1a4a986

Review: `docs/reviews/m10-hmi-1a4a986.md` (main checkout). All three findings are fixed on this branch and checked offline with the reviewer's reproductions (`.worktrees/hmi-review/reproduce.mjs`, scripted transports and temporary evidence copies only). No PLC connection, command or recovery was made.

| Finding | Fix | Reproduction now |
|---|---|---|
| P1: an Uncertain acknowledgement could be labelled applied | Decision samples must be Good, timestamped and correctly typed, or the outcome is `unconfirmed`; the samples are kept as evidence (see Commands). | Start with Uncertain StartAck and StartAccepted → `unconfirmed` |
| P1: a timed-out write could land after a later acknowledged Stop | The write timeout quarantines operator writes until the write settles and a later read succeeds; the queue holds the session meanwhile (see Held operator writes). | Start `unconfirmed`, Stop `refused`, writes: StartSequence only |
| P2: the audit passed with every cited frame removed | `cited-frames-preserved` derives the required set from agent-action screens and result steps, and requires each frame's bytes, non-empty, matching both Lane B's log and the action record. | Empty `evidence-frames` → audit fails |

**Preserved runs, supplemented.** The stricter check showed that all three passing runs lacked three cited frames each. These were the agent-action screens for the second Auto on, Start and Stop, whose steps did not carry the frame reference, so the runner never copied them. The original bytes were still in each run's gitignored capture store, and their SHA-256 matched both values recorded during the run: Lane B's `hmi-session.jsonl` and the HMI journal's `agent.action.screen` record. They were copied into `evidence-frames/` on that basis only; no existing file changed. Each run's `evidence-frames-supplement.json` lists the frames, hashes, citing records and the reason. All three runs then re-audit 13/13. The runner now copies agent-action screens too.

**Timing decision** (from the review): keep `maximumStepMs = 300`. A wider bound would be a separately declared profile with its own evidence. The next integrated gate is a repeatable attended campaign with the portal displayed, measuring cadence, step gaps and missed transitions under the HMI's load.

**Merge target** (from the review): integrate into `codex/m10-convergence`, not `main` or the old Lane A/B branches. A simulated merge reports conflicts in `.gitignore`, `package.json`, `tsconfig.json` and `test/portal-host.test.ts`; keep the union of both sides, and in the portal-host test keep the convergence version's frame-snapshot hashing.

## Untested and limitations

- **Coordinator timing margin:** see above. Repeating H2 can still fail on a late coordinator tick. It fails safely and needs an explicit reconciliation.
- **Headed-window input scaling** (×1.25) is unresolved. Headed operation by an engineer is fine, but scripted clicks must use the headless session or accept the mismatch diagnostic.
- **Standalone live service:** `hmi:live` / `hmi:live:portal` were exercised only inside H2's composition, not as separate long-running processes against the live PLC.
- **Fixture command acknowledgements** emulate a small subset of `FB_DemoConveyor` rules for rendering only, and are labelled "fixture ack".
- **Attribution:** Lane A's native transport uses the client application name `NodeOPCUA-Client` for every session. Attribution comes from the HMI journal (request, client session, origin) and the separate sessions, not from the PLC.
- **Read coherence:** the HMI read is batched, not cycle-bracketed like Lane A's commit evidence. `sameScanBracket` reports only whether PlcCycle equals OutputCaptureCycle within one batch.
- **Header freshness:** header values come from the last poll (2 s during H2; 1 s by default while another lane owns the runtime). After an acknowledgement the link polls immediately.
- **Not implemented:** hardware-passthrough commissioning, multi-operator conflict resolution, and user authentication on the HMI page. The HMI is loopback-only.
- **Lane B notes:**
  - A race in its portal-host test (the held frame was read before an in-flight capture landed) is fixed in `test/portal-host.test.ts`. This is the only edit in a Lane B file.
  - Hard-killed hosts leave headless Edge processes (`controlsbench-hmi-*`). This session closed its own orphans by checking for a dead parent process.
  - The portal's campaign factory is still the fixture, so the header reads "fake connector" beside the live HMI tile. That is accurate.
- **Muse:** the paid visual-operation checkpoint (S2) has not been run. The seam (`/api/agent-actions/execute`) and semantic targets are ready.
